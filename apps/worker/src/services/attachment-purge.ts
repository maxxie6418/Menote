/**
 * 孤儿附件的「**跳过保留期立即删除**」（v0.8.3；用户 2026-10-04 拍板要这个入口）。
 *
 * ## 为什么单独一个文件
 *
 * 30 天保留期那条路是 M4 的既有安全属性（"删错了还有救"），**本轮没有动它**——
 * 补的是**另一条并存的路**：用户明确知道自己要放弃这层保护时才走。
 * 两条路后果不同、判定口径也不同（一条按 `orphaned_at`、一条根本不看它），
 * 放同一个文件里迟早会被后一个人混起来读。
 *
 * ## 不可撤销，因此三道闸（各有用例钉住）
 *
 * 1. **只删无引用的**：判定与预告、与"标记孤儿"是**同一个** `NOT EXISTS(attachment_refs)`。
 *    允许跳过保留期，但**不跳过"在用"这个判定**。
 * 2. **删的时候再判一次**（`SQL_DELETE_UNREFERENCED_ATTACHMENT` 里那个 `NOT EXISTS`）：
 *    预告与真正删除之间可能隔着几秒，用户可能刚好把附件插回某篇笔记。
 *    那一行会 `changes = 0`，**留着**——否则会出现"刚插回去就被删"。
 * 3. **只清本用户**：`user_id` 条件在取与删两处都在，跨用户串数据是红线。
 *
 * ## 为什么删除前要单独问一次预告
 *
 * 列表是**截断的**（上限 200 行），界面自己数出来的孤儿数**可能少报**。
 * 让用户确认一个偏小的数、服务端删掉比那更多的，**比不做这个功能糟得多**。
 * 所以数量由服务端给，且与真删用同一套判定——用例里有一条专门钉「预告的数 == 真删的数」。
 *
 * **R2 对象不当场删**：照旧登记进 `r2_gc_queue`（`due_at = now`）由 Cron ② 删，
 * 这样请求不会卡在对象存储上。
 */
import { DAY_MS } from "@menote/shared";
import {
  SQL_DELETE_UNREFERENCED_ATTACHMENT,
  SQL_INSERT_R2_GC,
  SQL_PURGE_PLAN_OF_USER,
  SQL_SELECT_PURGEABLE_OF_USER,
} from "../db/tables";

/** `GET /api/attachments/purge-plan` 的返回形状 */
export interface AttachmentPurgePlan {
  count: number;
  bytes: number;
  /** 其中还在保留期里的那部分——界面要拿它说「其中 N 个你要放弃 30 天补救窗口」 */
  withinRetention: number;
}

export async function planAttachmentPurge(
  db: D1Database,
  userId: string,
  now: number,
  retentionDays = 30,
): Promise<AttachmentPurgePlan> {
  const row = await db
    .prepare(SQL_PURGE_PLAN_OF_USER)
    .bind(retentionDays, DAY_MS, now, userId)
    .first<{ count: number; bytes: number; within_retention: number }>();
  return {
    count: row?.count ?? 0,
    bytes: row?.bytes ?? 0,
    withinRetention: row?.within_retention ?? 0,
  };
}

export async function purgeOrphanedAttachments(
  db: D1Database,
  userId: string,
  now: number,
): Promise<{ removed: number; bytes: number }> {
  const rows = await db
    .prepare(SQL_SELECT_PURGEABLE_OF_USER)
    .bind(userId)
    .all<{ id: string; r2_key: string; size_bytes: number }>();

  let removed = 0;
  let bytes = 0;
  for (const row of rows.results ?? []) {
    const result = await db.batch([
      db.prepare(SQL_INSERT_R2_GC).bind(row.r2_key, userId, "orphan", now, now),
      db.prepare(SQL_DELETE_UNREFERENCED_ATTACHMENT).bind(row.id, userId),
    ]);
    // 第 2 条 `changes === 0` = 它在取出来到删它之间被重新引用了 → 那一行留着
    if ((result[1]?.meta.changes ?? 0) > 0) {
      removed += 1;
      bytes += row.size_bytes;
    }
  }
  return { removed, bytes };
}
