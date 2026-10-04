/**
 * 附件的服务端闭环（M4-4；《M4 设计》§3）。
 *
 * 四条业务规则（都在这里，不在适配层）：
 * 1. **去重按 `(user_id, sha256, kind)`**：同一用户传同一个文件只会有一行（秒传），
 *    缩略图沿用原图的 `sha256`，`parent_id` 指原图；
 * 2. **先登记后落元数据**：上传前写 `pending_uploads`（24 小时有效），落元数据时删登记；
 *    每日维护把"登记了却没落元数据"的对象当孤儿——这样**不需要 `ListObjects`**；
 * 3. **Worker 不缓冲、不算哈希**：请求体直接写桶，`sha256` 由客户端在查询串里给并用于拼键；
 * 4. **引用由客户端上报**：服务端不解析正文，也不去读 `## 附件` 章节的语义。
 *
 * 与隐私锁的关系：附件**仍按明文存储**（《隐私锁设计》§6.11），锁定时界面占位、不渲染；
 * 服务端不做额外过滤——附件按哈希寻址、不可枚举，猜不到就等于拿不到。
 */
import {
  ATTACHMENT_LIST_DEFAULT_LIMIT,
  ATTACHMENT_LIST_MAX_LIMIT,
  DAY_MS,
  MAX_ATTACHMENT_BYTES,
  PENDING_UPLOAD_TTL_HOURS,
  newUlid,
} from "@menote/shared";
import {
  attachmentKey,
  getBlob,
  putBlob,
  type AttachmentKind,
  type BlobRange,
} from "../adapters/r2";
import {
  SQL_DELETE_ATTACHMENT,
  SQL_DELETE_PENDING_UPLOAD,
  SQL_INSERT_ATTACHMENT,
  SQL_INSERT_ATTACHMENT_REF,
  SQL_INSERT_PENDING_UPLOAD,
  SQL_INSERT_R2_GC,
  SQL_MARK_ORPHANS_OF_USER,
  SQL_SELECT_ATTACHMENT_BY_SHA,
  SQL_SELECT_ATTACHMENT_REFS,
  SQL_SELECT_ATTACHMENTS_OF_USER,
  SQL_SELECT_ORPHANED_DUE,
  SQL_SELECT_ORPHANED_DUE_ALL,
  SQL_SELECT_PENDING_UPLOAD,
} from "../db/tables";
import { DomainError } from "../errors";
import type { StorageEnv } from "../types";

/** 附件类型也从服务层再导出一次：路由只依赖服务层，不必知道适配层 */
export type { AttachmentKind };

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** `POST /api/attachments/check` 的入参（客户端算出哈希与大小后先问一句） */
export interface AttachmentCheckInput {
  sha256: string;
  size: number;
  kind?: AttachmentKind;
}

export interface AttachmentCheckResult {
  /** 元数据已存在 → 客户端不用再传（秒传） */
  exists: boolean;
  /** 登记过但还没落元数据 → 客户端可以续传 */
  pending: boolean;
}

/** 校验 sha256 形状：拼进对象键的字符串必须是**严格的十六进制哈希**，否则就是路径注入 */
export function requireSha256(value: string | null): string {
  const trimmed = (value ?? "").trim().toLowerCase();
  if (!SHA256_PATTERN.test(trimmed)) {
    throw new DomainError("invalid", "sha256 参数不合法");
  }
  return trimmed;
}

/** `check`：先看元数据有没有，再看有没有未完成的登记 */
export async function checkAttachment(
  db: D1Database,
  userId: string,
  input: AttachmentCheckInput,
): Promise<AttachmentCheckResult> {
  const sha256 = requireSha256(input.sha256);
  if (input.size > MAX_ATTACHMENT_BYTES) {
    throw new DomainError("too_large", `单个附件不能超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
  }
  const kind: AttachmentKind = input.kind === "thumb" ? "thumb" : "original";

  const existing = await db
    .prepare(SQL_SELECT_ATTACHMENT_BY_SHA)
    .bind(userId, sha256, kind)
    .first<{ id: string }>();
  if (existing) return { exists: true, pending: false };

  const pending = await db
    .prepare(SQL_SELECT_PENDING_UPLOAD)
    .bind(attachmentKey(userId, sha256, kind))
    .first<{ r2_key: string }>();
  return { exists: false, pending: pending !== null };
}

/**
 * `PUT /api/attachments/blob`：登记 + 写入桶。
 *
 * 顺序是刻意的——**先登记再写对象**：反过来的话，"写成功但登记失败"的对象永远不会被清理
 * （桶不可枚举，没人知道它在）。先登记的话，最坏情况只是一条到期被清掉的登记。
 */
export async function putAttachmentBlob(
  env: StorageEnv,
  userId: string,
  input: { sha256: string; kind: AttachmentKind; contentType: string | null; body: ReadableStream },
  now: number,
): Promise<{ key: string; size: number }> {
  const sha256 = requireSha256(input.sha256);
  const key = attachmentKey(userId, sha256, input.kind);

  await env.DB.prepare(SQL_INSERT_PENDING_UPLOAD)
    .bind(key, userId, now, now + PENDING_UPLOAD_TTL_HOURS * 60 * 60 * 1000)
    .run();

  // 请求流直接写桶：Worker 不缓冲、也不算哈希（大小上限由客户端 check 与落库 CHECK 一起兜）
  const object = await putBlob(env, key, input.body, {
    httpMetadata: input.contentType ? { contentType: input.contentType } : undefined,
  });

  return { key, size: object.size };
}

export interface FinalizeAttachmentInput {
  sha256: string;
  size: number;
  mime: string | null;
  width: number | null;
  height: number | null;
  filename: string | null;
  /** 缩略图那一行（`kind='thumb'`，`parent_id` 指原图） */
  thumb?: { size: number; width: number | null; height: number | null; mime: string | null } | null;
  /** 这次上传要挂到哪条条目上（客户端显式上报的引用） */
  itemId?: string | null;
}

/**
 * 落元数据：**一个 D1 batch** 里插原图行（+缩略图行）、删登记、可选插引用。
 *
 * 去重靠唯一索引 `(user_id, sha256, kind)`：重复上传同一个文件时用 `INSERT OR IGNORE`，
 * 已有的行不动（不能把旧行的 `created_at` 改掉，否则"谁先传的"就乱了）。
 */
export async function finalizeAttachment(
  db: D1Database,
  userId: string,
  input: FinalizeAttachmentInput,
  now: number,
): Promise<{ attachmentId: string; thumbId: string | null }> {
  const sha256 = requireSha256(input.sha256);
  if (input.size > MAX_ATTACHMENT_BYTES) {
    throw new DomainError("too_large", `单个附件不能超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
  }

  const existing = await db
    .prepare(SQL_SELECT_ATTACHMENT_BY_SHA)
    .bind(userId, sha256, "original")
    .first<{ id: string }>();
  const attachmentId = existing?.id ?? newUlid();

  const statements = [
    db
      .prepare(SQL_INSERT_ATTACHMENT)
      .bind(
        attachmentId,
        userId,
        "original",
        null,
        sha256,
        attachmentKey(userId, sha256, "original"),
        input.mime,
        input.size,
        input.width,
        input.height,
        input.filename,
        now,
        now,
      ),
    db.prepare(SQL_DELETE_PENDING_UPLOAD).bind(attachmentKey(userId, sha256, "original")),
  ];

  if (input.thumb) {
    statements.push(
      db
        .prepare(SQL_INSERT_ATTACHMENT)
        .bind(
          `${attachmentId}-t`,
          userId,
          "thumb",
          attachmentId,
          // 缩略图沿用原图的哈希：身份 = (user, sha256, kind)
          sha256,
          attachmentKey(userId, sha256, "thumb"),
          input.thumb.mime,
          input.thumb.size,
          input.thumb.width,
          input.thumb.height,
          input.filename,
          now,
          now,
        ),
      db.prepare(SQL_DELETE_PENDING_UPLOAD).bind(attachmentKey(userId, sha256, "thumb")),
    );
  }

  if (input.itemId) {
    statements.push(db.prepare(SQL_INSERT_ATTACHMENT_REF).bind(input.itemId, null, attachmentId, now));
  }

  await db.batch(statements);

  const thumbRow = await db
    .prepare(SQL_SELECT_ATTACHMENT_BY_SHA)
    .bind(userId, sha256, "thumb")
    .first<{ id: string }>();

  return { attachmentId, thumbId: thumbRow?.id ?? null };
}

/** 下载：按哈希取对象（`thumb` 取缩略图），支持 `Range` */
export async function serveAttachment(
  env: StorageEnv,
  userId: string,
  sha256Raw: string,
  options: { thumb?: boolean; range?: BlobRange } = {},
): Promise<{
  body: ReadableStream | null;
  size: number;
  range?: { offset: number; length: number; total: number };
}> {
  const sha256 = requireSha256(sha256Raw);
  const kind: AttachmentKind = options.thumb ? "thumb" : "original";

  // 先确认元数据存在且属于本用户：桶里可能有别的用户的对象，键由服务端拼（不信任客户端给的全键）
  const row = await env.DB.prepare(SQL_SELECT_ATTACHMENT_BY_SHA)
    .bind(userId, sha256, kind)
    .first<{ id: string }>();
  if (!row) throw new DomainError("not_found", "附件不存在");

  const object = await getBlob(env, attachmentKey(userId, sha256, kind), options.range);
  if (!object) throw new DomainError("not_found", "附件对象不存在");
  return object;
}

/**
 * 某条目引用了哪些附件（客户端据此显示图片列与 `## 附件`）。
 *
 * 引用**由客户端显式上报**（服务端不解析正文）：上传时 `finalize` 带 `itemId` 即落一条，
 * 所以这里只需要"读"。
 */
export async function listAttachmentRefs(
  db: D1Database,
  itemId: string,
): Promise<Array<{ attachmentId: string; versionId: string | null }>> {
  const rows = await db
    .prepare(SQL_SELECT_ATTACHMENT_REFS)
    .bind(itemId)
    .all<{ attachment_id: string; version_id: string | null }>();
  return rows.results.map((row) => ({ attachmentId: row.attachment_id, versionId: row.version_id }));
}

/** 列表的过滤条件（都可省，省 = 不限） */
export interface ListAttachmentsOptions {
  kind?: AttachmentKind | null;
  state?: "active" | "orphaned" | null;
  limit?: number | null;
}

export interface AttachmentListRow {
  id: string;
  sha256: string;
  kind: AttachmentKind;
  filename: string | null;
  mime: string | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: number;
  updatedAt: number;
  orphanedAt: number | null;
  refCount: number;
}

/** 数据库行（snake_case）→ 线上形状（camelCase）：转换只在这一处，别把列名漏到响应里 */
interface AttachmentListDbRow {
  id: string;
  sha256: string;
  kind: AttachmentKind;
  filename: string | null;
  mime: string | null;
  size_bytes: number;
  width: number | null;
  height: number | null;
  created_at: number;
  updated_at: number;
  orphaned_at: number | null;
  ref_count: number;
}

/**
 * `GET /api/attachments`：列出**本用户**的附件（M6 批 2c 的附件管理页）。
 *
 * **只列本用户**是硬约束：附件按哈希寻址、不可枚举，但这份列表是直接可枚举的元数据，
 * 漏掉 `user_id` 就是跨租户泄漏。
 *
 * `has_more` 按 `limit + 1` 判定：多取的那一行在这里裁掉，**不进响应**。
 * 分页（游标）本轮不做，但 `limit` 位留着——以后加游标不必改契约（设计 §4.3）。
 */
export async function listAttachments(
  db: D1Database,
  userId: string,
  options: ListAttachmentsOptions = {},
): Promise<{ rows: AttachmentListRow[]; hasMore: boolean }> {
  const limit = clampListLimit(options.limit);
  const kind = options.kind === "thumb" ? "thumb" : options.kind === "original" ? "original" : "";
  const state = options.state === "orphaned" ? "orphaned" : options.state === "active" ? "active" : "";

  const result = await db
    .prepare(SQL_SELECT_ATTACHMENTS_OF_USER)
    .bind(userId, kind, kind, state, state, limit + 1)
    .all<AttachmentListDbRow>();

  const hasMore = result.results.length > limit;
  return {
    rows: result.results.slice(0, limit).map((row) => ({
      id: row.id,
      sha256: row.sha256,
      kind: row.kind,
      filename: row.filename,
      mime: row.mime,
      sizeBytes: row.size_bytes,
      width: row.width,
      height: row.height,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      orphanedAt: row.orphaned_at,
      refCount: row.ref_count,
    })),
    hasMore,
  };
}

/** `limit` 收口：缺省走契约默认值，超出上限按上限截（一条请求拉太多会顶到 D1 的返回体上限） */
function clampListLimit(limit: number | null | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return ATTACHMENT_LIST_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), ATTACHMENT_LIST_MAX_LIMIT);
}

/**
 * `POST /api/attachments/gc`：手动清理**本用户**的孤儿附件（附件管理页的接口位在 M6）。
 *
 * 两步：标孤儿（没有任何引用的）+ 清到期的（标满 30 天）——与每日维护同一套判定，
 * 只是不等到那一轮。**只清本用户**：跨用户串数据是红线，用例里专门有一条。
 *
 * ⚠️ **所以第一次调它一个文件都不会被删**（v0.8.2 记）：`marked` 是"开始 30 天倒计时"，
 * `removed` 才是"真删了"。界面必须把这两者分开说——早期版本统一承诺"空间会真正释放"，
 * 于是用户点了发现什么都没发生，判定按钮坏了。
 */
export async function gcAttachments(
  db: D1Database,
  userId: string,
  now: number,
  retentionDays = 30,
): Promise<{ marked: number; removed: number }> {
  const marked = await db.prepare(SQL_MARK_ORPHANS_OF_USER).bind(now, now, userId).run();

  const due = await db
    .prepare(SQL_SELECT_ORPHANED_DUE)
    .bind(userId, retentionDays, DAY_MS, now)
    .all<{ id: string; r2_key: string; user_id: string }>();

  let removed = 0;
  for (const row of due.results) {
    await db.batch([
      db.prepare(SQL_INSERT_R2_GC).bind(row.r2_key, row.user_id, "orphan", now, now),
      db.prepare(SQL_DELETE_ATTACHMENT).bind(row.id, userId),
    ]);
    removed += 1;
  }

  return { marked: marked.meta.changes ?? 0, removed };
}

/** 每日维护用：把所有用户里到期孤儿的对象登记进 GC 队列并删行 */
export async function sweepOrphanedAttachments(
  db: D1Database,
  now: number,
  retentionDays = 30,
): Promise<number> {
  const rows = await db
    .prepare(SQL_SELECT_ORPHANED_DUE_ALL)
    .bind(retentionDays, DAY_MS, now)
    .all<{ id: string; r2_key: string; user_id: string }>();

  for (const row of rows.results) {
    await db.batch([
      db.prepare(SQL_INSERT_R2_GC).bind(row.r2_key, row.user_id, "orphan", now, now),
      db.prepare(SQL_DELETE_ATTACHMENT).bind(row.id, row.user_id),
    ]);
  }
  return rows.results.length;
}

