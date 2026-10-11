/**
 * 改标题的数据层动作（features/notes；直接用 `data/db`）。
 *
 * **2026-10-11 起：标题的家是 `items.title` 派生列，不是 md**（设计 §9）。
 * 新建笔记**不再**往 md 写 `title:`——不设置属性就不该有 YAML；而新建一篇必然带标题
 * （`items.title NOT NULL`），所以从前每篇新笔记出生就带一段 front matter。
 *
 * **但外部导入的稿自带 `title:` 时（Obsidian 习惯），那个键要跟着改**：md 有键的时候
 * 它就是权威（`deriveTitle` 的 `present: true` 分支），只改列会在下次按 md 重新派生时
 * 把标题弹回去。所以这里的规则是「md 有键才回写 md，没键一行都不加」。
 *
 * **存量笔记不受影响**：它们的 md 里没有 `title:` 键，`deriveTitle` 报 `present: false`，
 * 派生逻辑照旧沿用列——本模块不主动给它们补 `title:`。
 *
 * **Memo 不适用**：`items.title` 对 Memo 必须为 null（`assertItemShape`），
 * 所以这里对 `type === "memo"` 直接不动。
 */
import { hasTaskValues, parseMenoteMeta, updateMenoteKeys } from "@menote/mdcore";
import {
  db,
  enqueueBodySave,
  enqueueMetaPatch,
  getCachedBody,
  getDraft,
  getLocalItem,
  saveDraft,
} from "../../data/db";

/** 取当前正文：**草稿优先**（刚敲还没同步的字不能被服务端旧正文盖掉） */
async function readRawBody(itemId: string): Promise<string> {
  const draft = await getDraft(itemId);
  if (draft) return draft.body;
  const cached = await getCachedBody(itemId);
  return cached?.body ?? "";
}

/**
 * 写标题：**派生列是必写的那一份**，md 只有本来就有顶层 `title:` 时才回写（设计 §9）。
 *
 * 返回是否真的写了——`false` 表示条目不存在、是 Memo、或值没变（防抖会重复提交同一个值，
 * 白写一次 outbox 只是浪费）。调用方据此决定要不要刷新列表。
 */
export async function writeItemTitle(itemId: string, title: string): Promise<boolean> {
  const item = await getLocalItem(itemId);
  if (!item || item.type === "memo") return false;
  if ((item.title ?? "") === title) return false;

  const now = Date.now();
  const raw = await readRawBody(itemId);
  /*
    判据是「md 里有没有这个**键**」，不是「标题值像不像」：`meta.title === undefined`
    就是没写过（新建的笔记全属这类），此时只改列、一个字都不加进正文。
    有键的（外部导入）必须两个一起改，否则两边分叉，下次按 md 派生会把标题弹回去。
  */
  if (parseMenoteMeta(raw).meta.title !== undefined) {
    await saveDraft(itemId, updateMenoteKeys(raw, { title }), now);
    await enqueueBodySave(itemId, item.rev, now);
  }

  await db.items.update(itemId, { title, updated_at: now });
  await enqueueMetaPatch(itemId, item.meta_rev, now);
  return true;
}

/**
 * 只更新**派生列**并入队 meta 补丁——**不碰草稿**（2026-10-04）。
 *
 * 属性卡片改的是 md，而**md 那一路走编辑器**（设计稿 §6）：卡片算出新的 front matter，
 * 交给 `EditorHandle.replaceFrontmatter` 推进编辑器，编辑器既有的自动保存负责落草稿与入队 body。
 * 那样草稿永远只有一个写者，标签不会被「下一次自动保存」用旧正文覆盖掉。
 *
 * 所以这里只管**列**：列是派生的第二份拷贝，与正文通道各写各的字段，本来就是两回事。
 *
 * 标签这一列尤其要跟上——它进 `items.tags`（列表、标签视图、搜索都读它）。
 */
export async function patchItemTags(itemId: string, tags: readonly string[]): Promise<boolean> {
  const item = await getLocalItem(itemId);
  if (!item || item.type === "memo") return false;
  const next = [...tags];
  if (JSON.stringify(item.tags) === JSON.stringify(next)) return false;

  const now = Date.now();
  await db.items.update(itemId, { tags: next, updated_at: now });
  await enqueueMetaPatch(itemId, item.meta_rev, now);
  return true;
}

/**
 * 只更新**清单字段的派生列**并入队 meta 补丁——**不碰草稿**（理由同 `patchItemTags`）。
 *
 * 与 `features/tasks/actions.ts` 的 `writeTaskFields` 分工：那个自己管 md（待办视图里
 * 没有编辑器句柄，正文那一路只能它自己走）；这个只管列，md 交给编辑器（属性卡片在正文区，
 * 那边有句柄）。**两者不要混用**——都写 md 会互相覆盖。
 */
export async function patchItemTaskFields(
  itemId: string,
  next: { status: string | null; due: string | null; priority: string | null } | null,
): Promise<boolean> {
  const item = await getLocalItem(itemId);
  if (!item || item.type === "memo") return false;
  const now = Date.now();
  await db.items.update(itemId, {
    // 平铺后「有值才有键」：三值全空写不出清单条目，列也跟着回落 0（见 `hasTaskValues`）
    is_task: hasTaskValues(next) ? 1 : 0,
    task_status: next?.status ?? null,
    task_due: next?.due ?? null,
    task_priority: next?.priority ?? null,
    updated_at: now,
  });
  await enqueueMetaPatch(itemId, item.meta_rev, now);
  return true;
}
