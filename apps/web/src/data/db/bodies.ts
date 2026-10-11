/**
 * 正文与草稿的本地读写（编辑器专项优化 v0.8.25 从 `repository.ts` 抽出——那边贴着
 * 500 行预算，而这一组函数本来就是一个域：正文缓存（`bodies`）与未上传草稿（`drafts`）
 * 的全部读写，加上"本地有哪些正文可读"的键集合）。
 */
import { db } from "./database";
import type { BodyRow, DraftRow } from "./schema";

export async function getCachedBody(id: string): Promise<BodyRow | undefined> {
  return db.bodies.get(id);
}

export async function getDraft(id: string): Promise<DraftRow | undefined> {
  return db.drafts.get(id);
}

/**
 * 本地**有正文可读**的条目 id 集合（正文缓存 ∪ 未上传草稿）。
 *
 * 用途（编辑器专项优化 v0.8.25）：`open()` 要在**同步**路径上决定"要不要抬『正在打开…』占位"
 * ——缓存命中的切换一次提交就能换上正文，不该闪占位；而要等服务端补拉的必须立刻给反馈
 * （M2-9 钉住的取舍，用例钉在 `notes-open-feedback`）。IndexedDB 的读取本身是异步的，
 * 判定要同步就只能靠**内存里的键集合**：工作区挂载/每轮刷新时读一次主键
 * （`primaryKeys` 只取键不取值，几千条也就毫秒级），之后由各写入点增量维护。
 */
export async function listLocalBodyIds(): Promise<Set<string>> {
  const [bodyIds, draftIds] = await Promise.all([
    db.bodies.toCollection().primaryKeys(),
    db.drafts.toCollection().primaryKeys(),
  ]);
  return new Set<string>([...bodyIds, ...draftIds].map(String));
}

/** 编辑器初始内容：优先未上传草稿，其次正文缓存 */
export async function getEditableBody(id: string): Promise<{ body: string; fromDraft: boolean }> {
  const draft = await db.drafts.get(id);
  if (draft) return { body: draft.body, fromDraft: true };
  const cached = await db.bodies.get(id);
  return { body: cached?.body ?? "", fromDraft: false };
}

/** 本地草稿：**每 2 秒**写一次，与上传节奏无关（拆解 M04-04） */
export async function saveDraft(itemId: string, body: string, now: number): Promise<void> {
  await db.drafts.put({ item_id: itemId, body, updated_at: now });
}

/** 缓存已确认的正文（上传成功或从服务端取回时调用） */
export async function putCachedBody(
  itemId: string,
  body: string,
  rev: number,
  contentHash: string,
  now: number,
): Promise<void> {
  await db.bodies.put({ item_id: itemId, body, rev, content_hash: contentHash, cached_at: now });
}
