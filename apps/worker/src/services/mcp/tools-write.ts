/**
 * MCP 的三个写类工具：`create_item` / `append_to_item` / `trash_item`（M6 批 3；设计 §六-3）。
 *
 * 这三个的共同点是**必须带 `operation_id`**（设计 §17.4），共同行为：
 * 幂等三态 → 预检 → 一次 batch（主写入 + 审计行 + 幂等行）。
 * 三个修改类在 `tools-write-edit.ts`，共用的零件在 `write-parts.ts`。
 *
 * ## 一处刻意偏离同步路径的口径
 *
 * **服务端自己算 `content_hash`**。`services/items.ts` 同步路径刻意不重算（省大文档上
 * 一次 SHA-256，因为有客户端替它算），但 MCP **就是那个客户端**——没人替它算，
 * 而 `saveItemBody` 的重放判定与幂等都依赖哈希准确。
 */
import {
  MCP_PERM_CREATE,
  MCP_PERM_LABELS,
  MCP_PERM_TRASH,
  MCP_SECTION_MAX_BYTES,
  MCP_TABLE_MAX_BYTES,
  MCP_WRITE_MAX_BYTES,
  newUlid,
  sha256Hex,
  utf8ByteLength,
  type ItemType,
} from "@menote/shared";
import { findSectionRange, makeRowId, parseTableDocument, renderTableDocument } from "@menote/mdcore";
import { createItem, saveItemBody } from "../items";
import { softDeleteItem } from "../trash";
import type { StorageEnv } from "../../types";
import { assertMcpPerm, type McpPrincipal } from "./auth";
import { auditStatement, operationStatement, writeAudit } from "./audit";
import { fail, pickId } from "./parts";
import { sealMcpVersionIfNeeded } from "./seal";
import { assertWritableFolder } from "./scope";
import {
  beginIdempotent,
  buildItemBody,
  conflictMessage,
  isReplay,
  isRevConflict,
  onLostWriteRace,
  pickOperationId,
  requireExpectedRev,
  requireVisibleWrite,
  type WriteItemBase,
} from "./write-parts";

const NOT_VISIBLE = "条目不存在或不在可见范围内";

function deviceLabel(principal: McpPrincipal): string {
  return `mcp:${principal.name}`;
}

async function loadBody(env: StorageEnv, itemId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT body FROM item_bodies WHERE item_id = ?")
    .bind(itemId)
    .first<{ body: string }>();
  if (!row) fail(NOT_VISIBLE);
  return row.body;
}

// ———————————————————————————————————————— 6. create_item

export async function runCreateItem(
  env: StorageEnv,
  principal: McpPrincipal,
  args: Record<string, unknown>,
): Promise<unknown> {
  assertMcpPerm(principal, MCP_PERM_CREATE, MCP_PERM_LABELS[MCP_PERM_CREATE]!);

  const type = args.type;
  if (type !== "note" && type !== "table" && type !== "memo") fail("type 必须是 note / table / memo");
  const content = typeof args.content === "string" ? args.content : "";
  if (utf8ByteLength(content) > MCP_WRITE_MAX_BYTES) {
    fail(`单次写入不超过 ${MCP_WRITE_MAX_BYTES / 1024} KB`);
  }

  // 文件夹必须已存在且在范围内（设计 §17.5：create_item 不自动创建文件夹）
  const folderId = typeof args.folder_id === "string" && args.folder_id !== "" ? args.folder_id : null;
  await assertWritableFolder(env.DB, principal, type === "memo" ? null : folderId);

  const operationId = pickOperationId(args, true);
  const started = await beginIdempotent(env, principal, operationId, args);
  if (isReplay(started)) return started.replay;

  const now = Date.now();
  const title =
    type === "memo" ? null : typeof args.title === "string" && args.title !== "" ? args.title : null;
  if (type !== "memo" && title === null) fail("笔记与表格必须带 title");

  const tags = Array.isArray(args.tags) ? args.tags.filter((tag): tag is string => typeof tag === "string") : [];
  const task = args.task as Record<string, unknown> | undefined;
  const id = newUlid();
  const response = { id, rev: 1, type, title };

  /*
    标题 / 标签 / 清单字段**一并写进 md 的 front matter**（2026-10-04，见 `buildItemBody`）。
    否则它们只是服务端派生列，客户端按 md 派生时读不到，导出的 `.md` 也不带——
    与外部 Markdown 工具的互通就断在这里。Memo 不写 `title:`。
  */
  const body = buildItemBody({ content, title, tags, task });
  if (utf8ByteLength(body) > MCP_WRITE_MAX_BYTES) {
    fail(`单次写入不超过 ${MCP_WRITE_MAX_BYTES / 1024} KB`);
  }

  try {
    const written = await createItem(
      env.DB,
      principal.userId,
      {
        id,
        type: type as ItemType,
        title,
        folderId: type === "memo" ? null : folderId,
        tags,
        memoAt: type === "memo" ? now : null,
        isTask: task ? 1 : 0,
        taskStatus: typeof task?.status === "string" ? task.status : null,
        taskDue: typeof task?.due === "string" ? task.due : null,
        taskPriority: typeof task?.priority === "string" ? task.priority : null,
        contentHash: await sha256Hex(body),
        body,
        deviceLabel: deviceLabel(principal),
      },
      now,
      [
        auditStatement(env.DB, {
          userId: principal.userId,
          tokenId: principal.tokenId,
          tool: "create_item",
          itemId: id,
          revBefore: null,
          revAfter: 1,
          result: "ok",
          operationId,
          now,
        }),
        operationStatement(env.DB, {
          userId: principal.userId,
          operationId: operationId!,
          tool: "create_item",
          requestHash: started.hash,
          response: JSON.stringify(response),
          now,
        }),
      ],
    );
    return { ...response, rev: written.rev };
  } catch (error) {
    // 同批的幂等行已经落库了（写函数是"先跑 batch 再看 changes"），要清掉才能重试
    if (isRevConflict(error)) {
      await onLostWriteRace(env, principal, {
        tool: "create_item",
        itemId: id,
        revBefore: null,
        operationId,
        now,
      });
    }
    throw error;
  }
}

// ———————————————————————————————————————— 7. append_to_item

export async function runAppendToItem(
  env: StorageEnv,
  principal: McpPrincipal,
  args: Record<string, unknown>,
): Promise<unknown> {
  assertMcpPerm(principal, MCP_PERM_CREATE, MCP_PERM_LABELS[MCP_PERM_CREATE]!);

  const itemId = pickId(args.id);
  const operationId = pickOperationId(args, true);
  const started = await beginIdempotent(env, principal, operationId, args);
  if (isReplay(started)) return started.replay;

  // 追加不要求 expected_rev（设计 §17.4）：服务端在**最新版本**上追加，
  // 条件写入失败时重试一次（架构 §十一：保证单请求的 D1 语句数可控）
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const head = await requireVisibleWrite(env, principal, itemId);
    const now = Date.now();
    await sealMcpVersionIfNeeded(env, principal.userId, itemId, now);

    const body = await loadBody(env, itemId);
    const nextBody = head.type === "table" ? appendTableRows(head, body, args) : appendToNote(head, body, args);
    const hash = await sha256Hex(nextBody);

    // 审计 + 幂等与正文写入同批（架构 §十一）
    const extra = [
      auditStatement(env.DB, {
        userId: principal.userId,
        tokenId: principal.tokenId,
        tool: "append_to_item",
        itemId,
        revBefore: head.rev,
        revAfter: head.rev + 1,
        result: "ok",
        operationId,
        now,
      }),
      operationStatement(env.DB, {
        userId: principal.userId,
        operationId: operationId!,
        tool: "append_to_item",
        requestHash: started.hash,
        response: JSON.stringify({ id: itemId, rev: head.rev + 1, appended: true }),
        now,
      }),
    ];

    try {
      const written = await saveItemBody(
        env,
        principal.userId,
        itemId,
        head.rev,
        hash,
        nextBody,
        deviceLabel(principal),
        now,
        undefined,
        extra,
      );
      return { id: itemId, rev: written.rev, appended: true };
    } catch (error) {
      if (!isRevConflict(error)) throw error;
      // 同批的幂等行已落库 → 清掉，否则同一个 operation_id 之后重试会拿到这次失败
      await onLostWriteRace(env, principal, {
        tool: "append_to_item",
        itemId,
        revBefore: head.rev,
        operationId,
        now,
      });
      if (attempt === 1) throw error;
    }
  }
  // 循环里两条路径都会 return 或 throw，走到这里说明逻辑有漏——抛出来比静默返回 null 好
  return fail("追加失败：条件写入重试后仍未成功");
}

/**
 * 追加到笔记末尾或某小节末尾。
 *
 * 小节模式要切出小节，所以只对 512 KB 以内的条目开放。**节尾那个分隔空行不算小节的内容**
 * （`findSectionRange` 的 `end` 是下一标题行首），所以先缩回换行再拼，别把分隔吃掉
 * ——理由与 mdcore 的 `replaceSection` 完全一样。
 */
function appendToNote(head: WriteItemBase, body: string, args: Record<string, unknown>): string {
  const text = typeof args.text === "string" ? args.text : "";
  if (text === "") fail("追加到笔记必须带 text");
  if (utf8ByteLength(text) > MCP_WRITE_MAX_BYTES) {
    fail(`单次写入不超过 ${MCP_WRITE_MAX_BYTES / 1024} KB`);
  }

  const section = typeof args.section === "string" ? args.section.trim() : "";
  if (section === "") return `${body}${text}`;

  if (head.size_bytes > MCP_SECTION_MAX_BYTES) {
    fail(`条目超过 ${MCP_SECTION_MAX_BYTES / 1024} KB，无法按小节追加；请改用不带 section 的追加`);
  }
  const range = findSectionRange(body, section);
  if (!range) fail(`没有找到标题为「${section}」的小节`);

  let end = range.end;
  while (end > range.start && (body[end - 1] === "\n" || body[end - 1] === "\r")) end -= 1;
  return `${body.slice(0, end)}\n${text}${body.slice(end)}`;
}

/** 追加到表格：按列名给值的若干行，**行 ID 由服务端分配**（设计 §17.5） */
function appendTableRows(head: WriteItemBase, body: string, args: Record<string, unknown>): string {
  if (head.size_bytes > MCP_TABLE_MAX_BYTES) {
    fail(`表格超过 ${MCP_TABLE_MAX_BYTES / 1024} KB，请在应用中编辑`);
  }
  const rows = Array.isArray(args.rows) ? args.rows : [];
  if (rows.length === 0) fail("追加到表格必须带 rows（每项是「列名 → 单元格值」的对象）");

  const parsed = parseTableDocument(body);
  if (!parsed.ok) fail(`表格结构有问题：${parsed.reason}`);

  const columnIds = new Set(parsed.doc.columns.map((column) => column.id));
  const appended = rows.map((raw) => {
    if (typeof raw !== "object" || raw === null) fail("rows 的每一项必须是「列名 → 值」的对象");
    // 行 ID 服务端分配（`makeRowId` 走 mdcore，与界面侧同一套格式与长度）
    const cells: Record<string, string> = { [parsed.doc.rowIdColumn]: makeRowId(Math.random) };
    for (const [column, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!columnIds.has(column)) fail(`没有名为「${column}」的列`);
      cells[column] = String(value);
    }
    return cells;
  });

  return renderTableDocument({ ...parsed.doc, rows: [...parsed.doc.rows, ...appended] });
}

// ———————————————————————————————————————— 11. trash_item

export async function runTrashItem(
  env: StorageEnv,
  principal: McpPrincipal,
  args: Record<string, unknown>,
): Promise<unknown> {
  assertMcpPerm(principal, MCP_PERM_TRASH, MCP_PERM_LABELS[MCP_PERM_TRASH]!);

  const itemId = pickId(args.id);
  const operationId = pickOperationId(args, true);
  const started = await beginIdempotent(env, principal, operationId, args);
  if (isReplay(started)) return started.replay;

  const head = await requireVisibleWrite(env, principal, itemId);
  const now = Date.now();
  const expectedRev = requireExpectedRev(args, "expected_rev");

  // 预检冲突 → **一行都不写**（设计 §六-4 第 2 步）。连幂等行也不写：
  // 否则 agent 重新读取后用同一个 operation_id 重试，会永远拿回这次冲突
  if (expectedRev !== head.rev) {
    await writeAudit(env.DB, {
      userId: principal.userId,
      tokenId: principal.tokenId,
      tool: "trash_item",
      itemId,
      revBefore: head.rev,
      revAfter: null,
      result: "conflict",
      operationId,
      now,
    });
    fail(conflictMessage(head.rev));
  }

  const response = { id: itemId, trashed: true };
  // 软删顺带撤销分享（M6 批 1 补的），对 MCP 一样成立
  try {
    await softDeleteItem(env.DB, principal.userId, itemId, now, [
      auditStatement(env.DB, {
        userId: principal.userId,
        tokenId: principal.tokenId,
        tool: "trash_item",
        itemId,
        revBefore: head.rev,
        revAfter: null,
        result: "ok",
        operationId,
        now,
      }),
      operationStatement(env.DB, {
        userId: principal.userId,
        operationId: operationId!,
        tool: "trash_item",
        requestHash: started.hash,
        response: JSON.stringify(response),
        now,
      }),
    ]);
  } catch (error) {
    if (isRevConflict(error)) {
      await onLostWriteRace(env, principal, {
        tool: "trash_item",
        itemId,
        revBefore: head.rev,
        operationId,
        now,
      });
    }
    throw error;
  }
  return response;
}
