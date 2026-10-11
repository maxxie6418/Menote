/**
 * 冲突关联的本地仓储（M2-9 的对比 UI 用）。
 *
 * 单独一个文件：`repository.ts` 已贴着 500 行预算（架构 §2.3.1），且这块只服务冲突对比这一件事。
 */
import { db } from "./database";
import type { ConflictRow } from "./schema";

/** 记下"这个副本出自哪条"（`handleConflict` 生成副本时调用） */
export async function recordConflict(
  copyId: string,
  originalId: string,
  now: number,
): Promise<void> {
  await db.conflicts.put({ copy_id: copyId, original_id: originalId, created_at: now });
}

/** 全部冲突关联（按时间倒序） */
export async function listConflicts(): Promise<ConflictRow[]> {
  const rows = await db.conflicts.toArray();
  return rows.sort((a, b) => b.created_at - a.created_at);
}

/** 某条原条目是否有冲突副本（多条时取最新的一条） */
export async function findConflictForOriginal(
  originalId: string,
): Promise<ConflictRow | undefined> {
  const rows = await db.conflicts.where("original_id").equals(originalId).toArray();
  return rows.sort((a, b) => b.created_at - a.created_at)[0];
}

/**
 * 横幅要显示的冲突视图（v0.8.24 从 `useNotesWorkspace` 下沉）：原条目的最新冲突副本
 * 加上它的标题（副本行可能已被清掉，标题回落到"冲突副本"）。没有冲突时返回 `null`。
 */
export async function findConflictView(
  originalId: string,
): Promise<{ copyId: string; copyTitle: string } | null> {
  const conflict = await findConflictForOriginal(originalId);
  if (!conflict) return null;
  const rows = await db.items.get(conflict.copy_id);
  return { copyId: conflict.copy_id, copyTitle: rows?.title ?? "冲突副本" };
}

/** 冲突已处理（不论保留哪一份），把关联记录清掉 */
export async function clearConflict(copyId: string): Promise<void> {
  await db.conflicts.delete(copyId);
}

/** 条目被删除/清空本地内容时，顺带清掉与它相关的冲突记录 */
export async function clearConflictsForItems(itemIds: readonly string[]): Promise<void> {
  const ids = new Set(itemIds);
  const rows = await db.conflicts.toArray();
  const stale = rows.filter((row) => ids.has(row.copy_id) || ids.has(row.original_id));
  if (stale.length > 0) await db.conflicts.bulkDelete(stale.map((row) => row.copy_id));
}
