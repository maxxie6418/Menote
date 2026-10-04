/**
 * 外部备份的推送状态机（M7 第 4 项 批 3；架构 §12.4 子请求上限、§12.1 任务配额；
 * 设计 §二 第 2 / 4 / 5 步）。
 *
 * ## 核心形状：**一轮一批、批内 ≤ 40 个外部 PUT、推不完下一轮续推**
 *
 * 硬依据是架构 §14.3：Cloudflare 免费版**外部子请求 50 个 / invocation**（R2 / D1
 * 才是内部的 1000）。所以「一轮推多少」不是性能调优，是**能不能跑完**的前提。
 *
 * ## 三条不变量
 *
 * 1. **只推快照已经物化到的位置**（`user_snapshot_state.cursor_seq`）。推一个快照还没写
 *    出来的文件必然 404，而 404 若被当成"推过了"就会**永久丢一次备份**。推不满就让
 *    下一轮快照先补上。
 * 2. **游标只推过"连续成功"的那一段**。一批里第 5 个失败了，游标就停在第 4 个——
 *    绝不能因为"后面几个成功了"就把游标推到末尾（那会让失败的那几个永远不再重推）。
 * 3. **`append_only` 绝不执行远端 DELETE**。这是默认档，用户选它就是因为不想让远端
 *    跟着删；`sync` 档才删，而且删只发生在 `export_queue` 里**明确记着"这个路径没了"**
 *    的条目上（那是永久删除时写进去的）。
 */
import {
  BACKUP_BATCH_PUT_LIMIT,
  notePath,
  type BackupDeletePolicy,
} from "@menote/shared";
import { BackupAdapterError, type BackupAdapter, type BackupAdapterTarget } from "../adapters/backup-adapter";
import { createS3Adapter } from "../adapters/s3";
import { createWebdavAdapter } from "../adapters/webdav";
import { SNAP_PREFIX } from "./snapshot";
import { readTargetSecret } from "../services/backup-targets";
import { DELETE_KEY_PREFIX, type BackupTargetRow } from "../db/backup-tables";
import type { EnvBindings } from "../types";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface PushEnv {
  DB: D1Database;
  ATTACHMENTS?: R2Bucket;
  AUTH_PEPPER?: string;
}

export interface PushOutcome {
  /** 跳过的原因；`undefined` = 这一轮真的跑了（或确实没东西可推） */
  skipped?: string;
  targetId: string;
  pushed: number;
  deleted: number;
  /** 本次调用**开始时**还欠多少个（含本轮推掉的）——给客户端算进度比例用 */
  total: number;
  /** 游标落后多少条（`0` = 已跟上） */
  remaining: number;
  /** 本轮因外部子请求预算用尽而停下（下一轮续推） */
  quotaStopped: boolean;
  /** 失败原因（不含凭据；给设置页平铺用，DESIGN.md §5.4-2） */
  error: string | null;
}

export interface PushOptions {
  /**
   * 忽略调度档位（`POST /targets/:id/run` 的「推一次」用）。
   *
   * 用户明确点了"推一次"，那他就是要现在推——`weekly` 档昨天刚推过不该拦住他。
   * **仍然要过"快照有没有新东西"那一关**（不变量 1 与档位无关）。
   */
  ignoreSchedule?: boolean;
}

interface ChangedRow {
  id: string;
  sync_seq: number;
}

/**
 * 给一个目标推一轮。
 *
 * 一轮 = **一个批次**。`quota` 是外部子请求预算（默认 40，留 10 个余量给探测与删除）。
 */
export async function pushOneRound(
  env: PushEnv,
  target: BackupTargetRow,
  now: number,
  quota: number = BACKUP_BATCH_PUT_LIMIT,
  options: PushOptions = {},
): Promise<PushOutcome> {
  const base: PushOutcome = {
    targetId: target.id,
    pushed: 0,
    deleted: 0,
    total: 0,
    remaining: 0,
    quotaStopped: false,
    error: null,
  };

  if (!env.ATTACHMENTS) return { ...base, skipped: "未绑定对象存储（ATTACHMENTS），无快照可推" };
  if (!options.ignoreSchedule && !isDue(target, now)) return { ...base, skipped: "今天不到这一档的推送日" };

  // 快照推到哪了 —— 推送**不许超过**它（不变量 1）
  const snapRow = await env.DB.prepare("SELECT cursor_seq FROM user_snapshot_state WHERE user_id = ?")
    .bind(target.user_id)
    .first<{ cursor_seq: number }>();
  const snapCursor = snapRow?.cursor_seq ?? 0;
  if (snapCursor <= target.cursor_seq) return { ...base, skipped: "快照还没有新东西可推" };

  /*
    本次调用开始时还欠多少：**在动任何东西之前数一次**。
    客户端要拿它算进度比例（`已推 / 总量`），而那个"总量"必须是服务端说的——
    用户一边打字一边推的话，客户端自己累加出来的数会漂移。
  */
  const outstanding = await countRemaining(env, target, snapCursor, target.cursor_seq);

  // 凭据：解开用完即弃，**不进日志、不进错误消息**（设计 §二 第 5 步）
  let adapter;
  try {
    const adapterTarget: BackupAdapterTarget = {
      id: target.id,
      kind: target.kind,
      endpoint: target.endpoint,
      bucket: target.bucket,
      region: target.region,
      username: target.username,
      secret: await readTargetSecret(env as EnvBindings, target),
      delete_policy: target.delete_policy as BackupDeletePolicy,
    };
    adapter = target.kind === "s3" ? createS3Adapter(adapterTarget) : createWebdavAdapter(adapterTarget);
  } catch (error) {
    const message = error instanceof BackupAdapterError ? error.message : "凭据解不开，请检查实例配置";
    await recordRun(env, target, target.cursor_seq, now, "failed", message);
    return { ...base, error: message };
  }

  /*
    多取一条用来判断"还有没有排队的"——**这才是「预算用尽」的真凭据**。
    只按 `LIMIT quota` 取的话，循环会正好在最后一条跑完、根本走不到「预算用尽」的判断，
    于是每一轮都被记成 `ok`，而实际上还有一堆没推（不变量 1 / 2 都会跟着失效）。
  */
  const changed = await env.DB.prepare(
    `SELECT id, sync_seq FROM items
      WHERE user_id = ? AND sync_seq > ? AND sync_seq <= ?
      ORDER BY sync_seq ASC LIMIT ?`,
  )
    .bind(target.user_id, target.cursor_seq, snapCursor, quota + 1)
    .all<ChangedRow>();

  const fetched = changed.results ?? [];
  const rows = fetched.slice(0, quota);
  let quotaStopped = fetched.length > quota;
  let cursor = target.cursor_seq;
  let pushed = 0;
  let deleted = 0;
  let budget = quota;
  let error: string | null = null;

  for (const row of rows) {
    if (budget <= 0) {
      quotaStopped = true;
      break;
    }
    const path = notePath(row.id);
    const object = await env.ATTACHMENTS!.get(`${SNAP_PREFIX}/${target.user_id}/${path}`);
    if (!object) {
      /*
        快照说该有却没有：**停在这里，不要跳过去**。
        跳过去等于"认为它推过了"，而它其实一次都没推成功——下一次游标越过它就永远丢了。
      */
      error = "快照里还没有这个文件，已停在这一条，下一轮继续";
      break;
    }
    try {
      await adapter.put(adapter.objectPath(path), new Uint8Array(await object.arrayBuffer()));
      pushed += 1;
      budget -= 1;
      cursor = row.sync_seq;
    } catch (cause) {
      error = cause instanceof BackupAdapterError ? cause.message : "推送失败，已停在这一条，下一轮继续";
      break;
    }
  }

  // 删除：只有 `sync` 档才做，且只删变更队列里**明确记着没了**的路径
  if (target.delete_policy === "sync" && error === null) {
    const result = await processDeletions(env, target, adapter, budget);
    deleted = result.deleted;
    error = result.error;
    if (result.exhausted) quotaStopped = true;
  }

  // 剩余量按**推完之后的新游标**算：用旧游标算的话，"这轮全推完了"也会显示还有一堆，
  // 状态永远停在 partial——那条 `last_result` 是设置页直接显示给用户看的。
  const remaining = await countRemaining(env, target, snapCursor, cursor);
  /*
    游标就是"最后一个**成功**推完的 sync_seq"——失败发生在哪一条，它就停在那一条**之前**。
    一批里第 5 个失败时，前 4 个确实已经推成功了，游标推过去是对的（它们不会再被重推，
    而它们也不需要被重推）；如果第一个就失败，`cursor` 压根没动过，仍是原值。
  */
  await recordRun(
    env,
    target,
    cursor,
    now,
    error === null ? (remaining > 0 || quotaStopped ? "partial" : "ok") : "failed",
    error,
  );

  return { targetId: target.id, pushed, deleted, total: outstanding, remaining, quotaStopped, error };
}

/** `daily` 每轮都算到期（游标让"没东西可推"的那轮是空转）；`weekly` 距上次满 7 天才算 */
function isDue(target: BackupTargetRow, now: number): boolean {
  if (target.schedule !== "weekly") return true;
  return target.last_run_at === null || now - target.last_run_at >= WEEK_MS;
}

async function processDeletions(
  env: PushEnv,
  target: BackupTargetRow,
  adapter: BackupAdapter,
  budget: number,
): Promise<{ deleted: number; error: string | null; exhausted: boolean }> {
  if (budget <= 0) return { deleted: 0, error: null, exhausted: true };
  // 多取一条用来判断"还有没有排队的"（这才是「预算用尽」的真凭据，不是推了几个）
  const rows = await env.DB.prepare(
    `SELECT key, rev FROM export_queue
      WHERE user_id = ? AND key LIKE ? ORDER BY created_at ASC LIMIT ?`,
  )
    .bind(target.user_id, `${DELETE_KEY_PREFIX}%`, budget + 1)
    .all<{ key: string; rev: number }>();
  const list = rows.results ?? [];
  const exhausted = list.length > budget;
  const batch = list.slice(0, budget);

  let deleted = 0;
  let error: string | null = null;
  for (const row of batch) {
    const path = row.key.slice(DELETE_KEY_PREFIX.length);
    try {
      await adapter.remove(adapter.objectPath(path));
      // **按 rev 条件删**：删的期间又发生新的删除时，这一行会被重新写上新的 rev，
      // 条件不匹配就删不掉 —— 那正是我们要的
      await env.DB.prepare("DELETE FROM export_queue WHERE user_id = ? AND key = ? AND rev = ?")
        .bind(target.user_id, row.key, row.rev)
        .run();
      deleted += 1;
    } catch (cause) {
      error = cause instanceof BackupAdapterError ? cause.message : "删除失败，已停下，下一轮继续";
      break;
    }
  }
  return { deleted, error, exhausted };
}

async function countRemaining(
  env: PushEnv,
  target: BackupTargetRow,
  snapCursor: number,
  fromCursor: number,
): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND sync_seq > ? AND sync_seq <= ?",
  )
    .bind(target.user_id, fromCursor, snapCursor)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * 落账。`last_error` **原样写入**（它已经不含凭据，`BackupAdapterError` 保证过），
 * 设置页要把它**平铺**给用户看（DESIGN.md §5.4-2）。
 */
async function recordRun(
  env: PushEnv,
  target: BackupTargetRow,
  cursor: number,
  now: number,
  result: "ok" | "partial" | "failed",
  error: string | null,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE user_backup_targets SET cursor_seq = ?, last_run_at = ?, last_result = ?, last_error = ? WHERE id = ? AND user_id = ?",
  )
    .bind(cursor, now, result, error, target.id, target.user_id)
    .run();
}
