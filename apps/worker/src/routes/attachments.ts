/**
 * 附件路由（M4-4；《M4 设计》§3.2 / §3.4 / §3.5；列表接口见 M6 批 2c）。只做参数校验与转服务层。
 *
 * 全部端点都**会话鉴权**：附件按哈希寻址、不可枚举，但"知道哈希就能取"仍然要挡在登录之后。
 */
import { AttachmentCheckSchema, AttachmentFinalizeSchema, MAX_ATTACHMENT_BYTES } from "@menote/shared";
import { Hono } from "hono";
import * as v from "valibot";
import { BlobStoreUnavailableError, type BlobRange } from "../adapters/r2";
import { DomainError } from "../errors";
import { requireSession } from "../middleware/session";
import {
  checkAttachment,
  finalizeAttachment,
  gcAttachments,
  listAttachmentRefs,
  listAttachments,
  putAttachmentBlob,
  serveAttachment,
  type AttachmentKind,
} from "../services/attachments";
import { planAttachmentPurge, purgeOrphanedAttachments } from "../services/attachment-purge";
import type { AppEnv } from "../types";
import { readJsonBody } from "../validation";

const app = new Hono<AppEnv>();

/** 缺存储绑定时的明确答复（fail-closed，但只说附件不可用，不影响其它功能） */
app.onError((error, c) => {
  if (error instanceof BlobStoreUnavailableError) {
    return c.json({ code: "retry_later", message: error.message }, 503);
  }
  throw error;
});

/** `POST /api/attachments/check`：客户端先问"这个文件传过没有" */
app.post("/attachments/check", requireSession, async (c) => {
  const parsed = v.safeParse(AttachmentCheckSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");

  const result = await checkAttachment(c.env.DB, c.get("user").id, parsed.output);
  return c.json(result);
});

/**
 * `PUT /api/attachments/blob?sha256=…&kind=original|thumb`：**请求体直写桶**。
 *
 * Worker 不缓冲、自己不算哈希（`sha256` 由客户端给并用于拼键）——这是"大文件不占 Worker 内存"
 * 的关键，也是设计 §3.2 第 2 步的原话。
 */
app.put("/attachments/blob", requireSession, async (c) => {
  const kind: AttachmentKind = c.req.query("kind") === "thumb" ? "thumb" : "original";
  const sha256 = c.req.query("sha256") ?? "";
  const contentType = c.req.header("Content-Type");

  const body = c.req.raw.body;
  if (!body) throw new DomainError("invalid", "请求体为空");

  const result = await putAttachmentBlob(
    c.env,
    c.get("user").id,
    { sha256, kind, contentType: contentType ?? null, body },
    Date.now(),
  );
  return c.json(result);
});

/** `POST /api/attachments/finalize`：落元数据（原图 + 缩略图两行，删登记，可选挂引用） */
app.post("/attachments/finalize", requireSession, async (c) => {
  const parsed = v.safeParse(AttachmentFinalizeSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");

  const input = parsed.output;
  if (input.size > MAX_ATTACHMENT_BYTES) {
    throw new DomainError("too_large", `单个附件不能超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
  }

  const result = await finalizeAttachment(c.env.DB, c.get("user").id, input, Date.now());
  return c.json(result);
});

/** `GET /api/attachments/h/:sha256?thumb=1`：流式下载，支持 `Range` */
app.get("/attachments/h/:sha256", requireSession, async (c) => {
  const range = parseRange(c.req.header("Range"));
  const result = await serveAttachment(c.env, c.get("user").id, c.req.param("sha256"), {
    thumb: c.req.query("thumb") === "1",
    range,
  });

  const headers: Record<string, string> = {
    // 内容寻址：同一哈希的内容永不变化，可以长缓存；`private` 保证不进共享缓存
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Type": c.req.query("thumb") === "1" ? "image/webp" : "application/octet-stream",
    "Accept-Ranges": "bytes",
  };
  if (result.range) {
    headers["Content-Range"] = `bytes ${result.range.offset}-${result.range.offset + result.range.length - 1}/${result.range.total}`;
    headers["Content-Length"] = String(result.range.length);
  } else {
    headers["Content-Length"] = String(result.size);
  }

  return new Response(result.body, { status: result.range ? 206 : 200, headers });
});

/**
 * `GET /api/attachments?kind=&state=&limit=`：**本用户**的附件列表（M6 批 2c；附件管理页）。
 *
 * M4 只给了 check / blob / finalize / h / refs / gc——「列出全部附件」这一条是本批新加的
 * （《M4 设计》§3.6 明确把管理页留到 M6）。过滤参数非法时**按"不过滤"处理**而不是报错：
 * 这是个只读的管理视图，让它因为一个拼错的查询参数整个打不开不划算。
 */
app.get("/attachments", requireSession, async (c) => {
  const kind = c.req.query("kind");
  const state = c.req.query("state");
  const limit = Number.parseInt(c.req.query("limit") ?? "", 10);

  const { rows, hasMore } = await listAttachments(c.env.DB, c.get("user").id, {
    kind: kind === "thumb" || kind === "original" ? kind : null,
    state: state === "active" || state === "orphaned" ? state : null,
    limit: Number.isFinite(limit) ? limit : null,
  });

  return c.json({
    attachments: rows.map((row) => ({
      id: row.id,
      sha256: row.sha256,
      kind: row.kind,
      filename: row.filename,
      mime: row.mime,
      size_bytes: row.sizeBytes,
      width: row.width,
      height: row.height,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      orphaned_at: row.orphanedAt,
      ref_count: row.refCount,
    })),
    has_more: hasMore,
  });
});

/** `GET /api/attachments/refs/:itemId`：某条目引用了哪些附件（图片列 / `## 附件` 要用） */
app.get("/attachments/refs/:itemId", requireSession, async (c) => {
  const refs = await listAttachmentRefs(c.env.DB, c.req.param("itemId"));
  return c.json({ refs });
});

/** `POST /api/attachments/gc`：手动清理**本用户**的孤儿附件（管理页入口在 M6，接口先就绪） */
app.post("/attachments/gc", requireSession, async (c) => {
  const result = await gcAttachments(c.env.DB, c.get("user").id, Date.now());
  return c.json(result);
});

/**
 * `GET /api/attachments/purge-plan`：预告「立即删除」会删多少（v0.8.3）。
 *
 * **删除前必须先问一次服务端**：列表是截断的，界面自己数的孤儿数可能少报，
 * 而这是不可撤销的删除。**与 `purge` 分成两个端点**而不是一个带 `force` 标志的端点，
 * 就是为了让"预告"与"真删"在日志与代码里是两件看得见分开的事。
 */
app.get("/attachments/purge-plan", requireSession, async (c) => {
  const plan = await planAttachmentPurge(c.env.DB, c.get("user").id, Date.now());
  return c.json(plan);
});

/**
 * `POST /api/attachments/purge`：**跳过 30 天保留期，立刻删掉本用户的孤儿附件**（v0.8.3）。
 *
 * 不可撤销，所以前端必须先拿 `purge-plan` 展示真实数量、再让用户确认。
 * 服务端这一侧的三道闸写在 `purgeOrphanedAttachments` 的文件头（只删无引用 / 删时再判一次 / 只清本用户）。
 */
app.post("/attachments/purge", requireSession, async (c) => {
  const result = await purgeOrphanedAttachments(c.env.DB, c.get("user").id, Date.now());
  return c.json(result);
});

/**
 * 解析 `Range: bytes=start-end`。
 *
 * 只支持**单段**（多段 Range 的响应体是 multipart，客户端极少用；
 * 不支持时按规范回 200 全量，而不是装作支持）。
 */
function parseRange(header: string | undefined): BlobRange | undefined {
  if (!header) return undefined;
  const matched = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!matched) return undefined;

  const offset = Number.parseInt(matched[1] ?? "0", 10);
  const end = matched[2] === "" ? undefined : Number.parseInt(matched[2] ?? "", 10);
  if (!Number.isFinite(offset) || offset < 0) return undefined;
  if (end !== undefined && (!Number.isFinite(end) || end < offset)) return undefined;

  return { offset, length: end === undefined ? undefined : end - offset + 1 };
}

export default app;
