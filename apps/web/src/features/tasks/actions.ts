/**
 * 待办的数据层动作（features/tasks；直接用 `data/db`，由 `App` 组装到界面）。
 *
 * **规范数据在条目的 YAML 里**（2026-10-11 起是**顶层** `status` / `due` / `priority` 三键，
 * 旧写法 `menote.task:` 只读不写），条目的 `is_task` / `task_status` / `task_due` /
 * `task_priority` 只是服务端的冗余派生列（供 MCP 筛选）。所以每次改动都要**同时**：
 * 1. 改 md 的 front matter（用 mdcore 的行级改写，保留其它键）；
 * 2. 修条目行上的派生列并入队一条元数据补丁。
 *
 * 三者必须一致：只改 YAML 会让服务端筛选失准；只改派生列会在下次同步被 YAML 覆盖。
 *
 * 去掉清单标记（Q23）= 把 `task` 字段整个删掉 + 清空三个派生列；**不能只置 is_task=0**——
 * 0002 的约束要求 is_task=0 时字段必须为空。
 */
import { hasTaskValues, updateMenoteKeys, type TaskFields } from "@menote/mdcore";
import {
  db,
  enqueueBodySave,
  enqueueMetaPatch,
  getCachedBody,
  getDraft,
  getLocalItem,
  saveDraft,
  type LocalItem,
} from "../../data/db";

async function readRawBody(itemId: string): Promise<string> {
  const draft = await getDraft(itemId);
  if (draft) return draft.body;
  const cached = await getCachedBody(itemId);
  return cached?.body ?? "";
}

/** 从条目行取当前的三个任务字段 */
function taskFieldsOf(item: LocalItem): TaskFields {
  return {
    status: item.task_status,
    due: item.task_due,
    priority: item.task_priority,
  };
}

/**
 * 写回任务字段：`next` 为 `null` 表示去掉清单标记（Q23）。
 * 派生列与 md 一起更新，任一步失败都不会留下"md 与列不一致"的中间态之外的东西（同一条 outbox 语义）。
 */
export async function writeTaskFields(
  itemId: string,
  next: TaskFields | null,
): Promise<void> {
  const item = await getLocalItem(itemId);
  if (!item) throw new Error("条目不存在");

  const raw = await readRawBody(itemId);
  const now = Date.now();
  const body = updateMenoteKeys(raw, { task: next });

  await saveDraft(itemId, body, now);
  await enqueueBodySave(itemId, item.rev, now);

  await db.items.update(itemId, {
    // 平铺后「有值才有键」：三值全空写不出清单条目，列也跟着回落 0（见 `hasTaskValues`）
    is_task: hasTaskValues(next) ? 1 : 0,
    task_status: next?.status ?? null,
    task_due: next?.due ?? null,
    task_priority: next?.priority ?? null,
    updated_at: now,
  });
  await enqueueMetaPatch(itemId, item.meta_rev, now);
}

/** 改状态（看板点卡片 / 列表勾选都走它） */
export async function setTaskStatus(
  itemId: string,
  status: TaskFields["status"],
): Promise<void> {
  const item = await getLocalItem(itemId);
  if (!item) throw new Error("条目不存在");
  await writeTaskFields(itemId, { ...taskFieldsOf(item), status });
}

/** 改截止日期（`null` = 清除） */
export async function setTaskDue(itemId: string, due: string | null): Promise<void> {
  const item = await getLocalItem(itemId);
  if (!item) throw new Error("条目不存在");
  await writeTaskFields(itemId, { ...taskFieldsOf(item), due });
}

/** 改优先级（`null` = 清除） */
export async function setTaskPriority(
  itemId: string,
  priority: TaskFields["priority"],
): Promise<void> {
  const item = await getLocalItem(itemId);
  if (!item) throw new Error("条目不存在");
  await writeTaskFields(itemId, { ...taskFieldsOf(item), priority });
}

/** 去掉清单标记（Q23）：删掉 task 字段并清空派生列 */
export async function clearTaskMarker(itemId: string): Promise<void> {
  await writeTaskFields(itemId, null);
}
