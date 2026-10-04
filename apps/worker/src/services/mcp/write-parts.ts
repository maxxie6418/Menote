/**
 * MCP 写类工具共用的零件（M6 批 3）。
 *
 * 与 `parts.ts`（只读侧）分开：只读侧那些是纯数据加工，写类这边要碰 D1、抛乐观锁错误，
 * 混在一起两边都说不清"这个零件到底属哪边"。
 *
 * ## 四条口径钉在这里（批 3 的复杂度大半来自这四条）
 *
 * 1. **乐观锁的判定只有一处**（`checkRev`）：不一致时默认报错 + 给出当前 `rev`，
 *    `on_conflict: "copy"` 才放行去生成副本。三个修改类工具共用它，免得三处判定漂移。
 * 2. **参数摘要按 key 排序后序列化**（`canonicalJson`）：同一个 `operation_id`
 *    换个字段顺序发过来必须算出同一个摘要，否则会被误判成"另一组参数"。
 *    普通的 `JSON.stringify` 在这里有两个坑——**键序**与 **`undefined` 字段**。
 * 3. **幂等三态只有一处**（`beginIdempotent`）：没跑过 / 重放 / 撞 ID 配了别的参数。
 * 4. **可见 + 乐观锁基底只有一处**（`requireVisibleWrite`）：同时拿到 `rev` 与 `meta_rev`。
 */
import { sha256Hex } from "@menote/shared";
import { updateMenoteKeys, type TaskFields } from "@menote/mdcore";
import { DomainError } from "../../errors";
import type { StorageEnv } from "../../types";
import { NOT_VISIBLE, fail } from "./parts";
import { visibilityClause } from "./scope";
import type { McpPrincipal } from "./auth";
import {
  auditStatement,
  classifyOperation,
  forgetOperation,
  operationStatement,
  readOperation,
  writeAudit,
} from "./audit";
import { saveItemBody } from "../items";
import { sealMcpVersionIfNeeded } from "./seal";

/** 写路径要用的条目基底：`rev` 管正文、`meta_rev` 管元数据，两个都要（`organize_item` 只用后者） */
export interface WriteItemBase {
  id: string;
  type: string;
  title: string | null;
  rev: number;
  meta_rev: number;
  size_bytes: number;
}

/** 按 id 取一条**可见**条目；查不到就是不可见（与「不存在」同一句提示） */
export async function requireVisibleWrite(
  env: StorageEnv,
  principal: McpPrincipal,
  itemId: string,
): Promise<WriteItemBase> {
  const visibility = visibilityClause(principal);
  const row = await env.DB.prepare(
    `SELECT i.id, i.type, i.title, i.rev, i.meta_rev, i.size_bytes
     FROM items i WHERE i.id = ? AND ${visibility.sql}`,
  )
    .bind(itemId, ...visibility.params)
    .first<WriteItemBase>();
  if (!row) fail(NOT_VISIBLE);
  return row;
}

/**
 * 乐观锁判定。
 *
 * `onConflict === "copy"` 时**不**抛，由调用方去生成冲突副本；其余情况一律
 * 「抛冲突 + 报出当前 `rev` + 让 agent 重新读取」——设计 §17.4 的默认口径。
 */
export function checkRev(current: number, expected: unknown, onConflict: unknown): void {
  if (typeof expected !== "number" || !Number.isInteger(expected)) {
    fail("必须带 expected_rev（从读取结果里拿）");
  }
  if (expected === current) return;
  if (onConflict === "copy") return;
  fail(`版本冲突：当前 rev = ${current}，请重新读取后再修改`);
}

/**
 * 规范化的 JSON：对象键排序、丢掉 `undefined`、数组保序。
 *
 * 幂等摘要必须用它而不是 `JSON.stringify`——后者对同一个语义对象会因**键序**
 * 给出不同字符串，`{a:1,b:2}` 与 `{b:2,a:1}` 会被当成"两组参数"而误报撞 ID。
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(",")}}`;
}

/**
 * 参数摘要（**不含 `operation_id` 自身**——它是键，不是参数）。
 *
 * 靠"复制出对象再删掉这个键"来实现，而不是让 `canonicalJson` 认识哪些键该忽略：
 * 后者要求每个调用方都记得声明自己的例外，漏一处就多一条误报。
 */
export async function requestHash(args: Record<string, unknown>): Promise<string> {
  const rest: Record<string, unknown> = { ...args };
  delete rest.operation_id;
  return sha256Hex(canonicalJson(rest));
}

/** `operation_id`：必带的工具缺了就报错，可选的缺了返回 null */
export function pickOperationId(args: Record<string, unknown>, required: boolean): string | null {
  const raw = args.operation_id;
  if (typeof raw === "string" && raw !== "") return raw;
  if (required) fail("必须带 operation_id（重复调用靠它去重）");
  return null;
}

export interface IdempotentStart {
  hash: string;
  operationId: string;
}

/**
 * 幂等三态的统一入口：
 * - 重放（同一个 `operation_id` + 同一组参数）→ 返回存下来的结果，调用方直接回；
 * - 撞 ID 配了别的参数 → 报错；
 * - 没跑过 → 返回 `{ hash }` 让调用方继续，并在成功后把幂等行写进同一次 batch。
 */
export async function beginIdempotent(
  env: StorageEnv,
  principal: McpPrincipal,
  operationId: string | null,
  args: Record<string, unknown>,
): Promise<IdempotentStart | { replay: unknown }> {
  if (operationId === null) {
    // 没有 `operation_id` 时也要给调用方一个 hash 吗？不需要——没有键就没有幂等行要写
    return { hash: "", operationId: "" };
  }
  const hash = await requestHash(args);
  const hit = await readOperation(env.DB, principal.userId, operationId);
  const kind = classifyOperation(hit, hash);
  if (kind === "mismatch") {
    fail("同一个 operation_id 之前用于另一组参数；换一个 operation_id，或用原来的参数重试");
  }
  if (kind === "replay" && hit.replay) {
    return { replay: JSON.parse(hit.replay.response) as unknown };
  }
  return { hash, operationId };
}

/** 判断 `beginIdempotent` 的返回是不是"重放" */
export function isReplay(start: IdempotentStart | { replay: unknown }): start is { replay: unknown } {
  return "replay" in start;
}

/**
 * `expected_rev` / `expected_meta_rev` 的统一取法。
 *
 * 两者都必带（`trash_item` 也要 `expected_rev`——设计 §17.5 的参数表里它写的是必填），
 * 所以这里没有"可选"分支。
 */
export function requireExpectedRev(args: Record<string, unknown>, field: string): number {
  const value = args[field];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(`必须带 ${field}（从读取结果里拿）`);
  }
  return value;
}

/** 版本冲突的统一提示（`trash_item` 的预检路径用它，审计那边也要同一个文案） */
export function conflictMessage(currentRev: number): string {
  return `版本冲突：当前 rev = ${currentRev}，请重新读取后再试`;
}

/** `expected_meta_rev` 冲突时把它归一成 `DomainError`，好让上层统一处理 */
export function metaConflict(currentMetaRev: number): DomainError {
  return new DomainError("meta_conflict", "条目已在其他设备更新", { meta_rev: currentMetaRev });
}

/**
 * 「预检通过后被别人抢先」这条极小竞态的善后（设计 §六-4 第 4 步）。
 *
 * 问题在于：写函数是「先跑 batch、再看 `changes`」，所以**主写入没成时，
 * 同批的幂等行已经落库了**。不清理的话，agent 用同一个 `operation_id` 重试会拿到
 * 一次失败的结果，永远走不下去。所以这里把幂等行删掉、记一条 `conflict` 审计，
 * 让这个 ID 之后还能被正常重试。
 */
export async function onLostWriteRace(
  env: StorageEnv,
  principal: McpPrincipal,
  args: {
    tool: string;
    itemId: string | null;
    revBefore: number | null;
    operationId: string | null;
    now: number;
  },
): Promise<void> {
  if (args.operationId !== null) await forgetOperation(env.DB, principal.userId, args.operationId);
  await writeAudit(env.DB, {
    userId: principal.userId,
    tokenId: principal.tokenId,
    tool: args.tool,
    itemId: args.itemId,
    revBefore: args.revBefore,
    revAfter: null,
    result: "conflict",
    operationId: args.operationId,
    now: args.now,
  });
}

/** `DomainError.code === "rev_conflict"` 的类型守卫 */
export function isRevConflict(error: unknown): boolean {
  return error instanceof DomainError && error.code === "rev_conflict";
}

/** 写类工具在正文上留下的设备标识（审计与排查时一眼看出是 agent 改的） */
export function deviceLabel(principal: McpPrincipal): string {
  return `mcp:${principal.name}`;
}

/**
 * 落一次正文修改：写前封存 → 条件写入 → 审计（与正文同批）。
 *
 * `edit_item` 与 `edit_table_rows` 共用它——两条路径的差别只在"怎么算出新正文"，
 * 落库这一段（封存 → `saveItemBody` → 审计）完全一样，抄一份就会漂。
 *
 * 幂等行**只在调用方给了 `operationId` 时**才写（修改类的 `operation_id` 是可选的，
 * 设计 §17.4「修改类由乐观锁保证重试安全，`operation_id` 可选」）。
 */
export async function commitBody(
  env: StorageEnv,
  principal: McpPrincipal,
  tool: string,
  head: WriteItemBase,
  nextBody: string,
  operationId: string | null,
  requestHashValue: string,
  now: number,
): Promise<{ rev: number }> {
  await sealMcpVersionIfNeeded(env, principal.userId, head.id, now);
  const hash = await sha256Hex(nextBody);

  const extra = [
    // 审计与正文同批：写成功但审计丢失，正是审计要防的那类事故
    auditStatement(env.DB, {
      userId: principal.userId,
      tokenId: principal.tokenId,
      tool,
      itemId: head.id,
      revBefore: head.rev,
      revAfter: head.rev + 1,
      result: "ok",
      operationId,
      now,
    }),
  ];
  if (operationId !== null) {
    extra.push(
      operationStatement(env.DB, {
        userId: principal.userId,
        operationId,
        tool,
        requestHash: requestHashValue,
        response: JSON.stringify({ id: head.id, rev: head.rev + 1, changed: true }),
        now,
      }),
    );
  }

  const written = await saveItemBody(
    env,
    principal.userId,
    head.id,
    head.rev,
    hash,
    nextBody,
    deviceLabel(principal),
    now,
    undefined,
    extra,
  );
  return { rev: written.rev };
}

/**
 * 把 `create_item` 的 `title` / `tags` / `task` 参数**写进 md 的 front matter**（2026-10-04）。
 *
 * 这三个在服务端是**派生列**，规范数据在 md。只写列的话，客户端下一次按 md 派生就会看成
 * 「md 里没有」（`deriveTitle` 报 `present: false`、`deriveTags` 读不到），导出的 `.md`
 * 也不带这些字段——与外部 Markdown 工具的互通就断在这里。写法与界面侧同一个
 * `updateMenoteKeys`：agent 自己写的 front matter 原样保留，只改命中的键。
 *
 * **Memo 不写 `title:`**：`assertItemShape` 要求它的 `items.title` 为 null（没有独立标题），
 * 所以传 `title: null` 让那个键被删掉。
 */
export function buildItemBody(input: {
  content: string;
  title: string | null;
  tags: readonly string[];
  task: Record<string, unknown> | undefined;
}): string {
  const { content, title, tags, task } = input;
  const taskFields: TaskFields | null = task
    ? {
        status: typeof task.status === "string" ? task.status : null,
        due: typeof task.due === "string" ? task.due : null,
        priority: typeof task.priority === "string" ? task.priority : null,
      }
    : null;
  return updateMenoteKeys(content, { title, tags: [...tags], task: taskFields });
}
