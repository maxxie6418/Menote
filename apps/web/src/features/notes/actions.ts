/**
 * 改标题的数据层动作（features/notes；直接用 `data/db`）。
 *
 * **为什么标题要同时改 md 和条目行**（2026-10-04）：为了跟外部 Markdown 工具
 * （Obsidian 等）互通、往返不丢标题，标题进了 md 的**顶层 `title:` 键**——
 * `items.title` 从此只是**派生列**（与 `tags` / `task` 同一套哲学：规范数据在 md，列供列表、
 * 搜索、MCP 筛选用）。所以改标题不再是纯元数据操作。
 *
 * 两边必须一致：只改 md 会让列表 / 搜索立刻显示旧标题；只改列会在下次同步被 md 覆盖回去
 * （客户端按 md 重新派生）。**写入顺序照 `features/tasks/actions.ts` 的 `writeTaskFields`**：
 * 先 `saveDraft` 落 md、入队 body，再更新派生列入队 meta——反过来会出现"列已新、正文未新"的
 * 中间态，那一下同步就会把标题弹回去。
 *
 * **存量笔记不受影响**：它们的 md 里没有 `title:` 键，`deriveTitle` 报 `present: false`，
 * 派生逻辑照旧沿用列——本模块不主动给它们补 `title:`，改标题时才是它们第一次接管。
 *
 * **Memo 不适用**：`items.title` 对 Memo 必须为 null（`assertItemShape`），
 * 所以这里对 `type === "memo"` 直接不动。
 */
import { updateMenoteKeys } from "@menote/mdcore";
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
 * 写标题：md 顶层 `title:` + 派生列，一起。
 *
 * 返回是否真的写了——`false` 表示条目不存在、是 Memo、或值没变（防抖会重复提交同一个值，
 * 白写一次 outbox 只是浪费）。调用方据此决定要不要刷新列表。
 */
export async function writeItemTitle(itemId: string, title: string): Promise<boolean> {
  const item = await getLocalItem(itemId);
  if (!item || item.type === "memo") return false;
  if ((item.title ?? "") === title) return false;

  const now = Date.now();
  const body = updateMenoteKeys(await readRawBody(itemId), { title });
  await saveDraft(itemId, body, now);
  await enqueueBodySave(itemId, item.rev, now);

  await db.items.update(itemId, { title, updated_at: now });
  await enqueueMetaPatch(itemId, item.meta_rev, now);
  return true;
}
