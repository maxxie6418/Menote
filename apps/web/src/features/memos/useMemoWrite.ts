/**
 * Memo 的写入动作（从 `useNotesWorkspace` 拆出：那里有 500 行预算，2026-09-27 的身份稳定化改动顶到了线）。
 *
 * 两条口径与拆分前完全一致：
 * 1. **发布**（`publishMemo`）：`type: memo` **不写进正文**（type 是条目的元数据列，md 只承载内容与
 *    结构化字段），只有存在标签或清单标记时才写 front matter——纯文本 Memo 的正文就是用户写的那几行，
 *    原位编辑时不会看到 YAML；
 * 2. **原位编辑**（`updateMemo`，Q19）：用户编辑的是**内容**，front matter 由这里按"是否清单 + 新标签"
 *    重新生成，所以正文里的 YAML 永远不会被用户改坏；`memo_at` 不动（编辑不改变时间轴位置）。
 *
 * 与其它子 hook 一样，**依赖只收稳定的回调**（`refresh` / `onLocalWrite` 由 `useNotesWorkspace`
 * 做过身份稳定化）：返回值会被放进工作区的 `useMemo` 依赖，身份不稳会让下游列表 `memo` 失效。
 */
import { useCallback, useMemo } from "react";
import { newUlid } from "@menote/shared";
import { buildDocument, deriveTags, deriveTaskFields } from "@menote/mdcore";
import {
  createLocalItem,
  db,
  enqueueBodySave,
  enqueueMetaPatch,
  getLocalItem,
  saveDraft,
} from "../../data/db";

export interface MemoWriteInput {
  /** 重读本地库并刷新界面（稳定引用） */
  refresh: () => Promise<void>;
  /** 本地写入成功后叫醒同步引擎（稳定引用） */
  onLocalWrite: () => void;
}

export interface MemoWrite {
  publishMemo: (
    text: string,
    options?: { asTask?: boolean; due?: string | null; priority?: string | null },
  ) => Promise<void>;
  updateMemo: (itemId: string, text: string) => Promise<void>;
}

export function useMemoWrite(input: MemoWriteInput): MemoWrite {
  const { refresh, onLocalWrite } = input;

  const publishMemo = useCallback(
    async (
      text: string,
      options?: { asTask?: boolean; due?: string | null; priority?: string | null },
    ) => {
      const tags = deriveTags(text);
      const asTask = options?.asTask ?? false;
      const task = asTask
        ? {
            // M2-5：新建清单默认"待办"；优先级默认"中"，截止可空（M07-03）
            status: "todo",
            due: options?.due ?? null,
            priority: options?.priority ?? "medium",
          }
        : null;
      const body =
        tags.length > 0 || asTask
          ? buildDocument({ type: "memo", tags, task, preservedLines: [], foreignLines: [] }, text)
          : text;

      const id = newUlid();
      const now = Date.now();
      await createLocalItem(
        {
          id,
          type: "memo",
          title: null,
          folder_id: null,
          tags,
          memo_at: now,
          body,
          task: deriveTaskFields(body),
        },
        now,
      );
      await refresh();
      onLocalWrite();
    },
    [onLocalWrite, refresh],
  );

  const updateMemo = useCallback(
    async (itemId: string, text: string) => {
      const item = await getLocalItem(itemId);
      if (!item) return;

      const tags = deriveTags(text);
      // 清单标记与三个字段由条目元数据承载：编辑正文不改它们（Q19 只改内容）
      const taskFields =
        item.is_task === 1
          ? { status: item.task_status, due: item.task_due, priority: item.task_priority }
          : null;
      const body =
        tags.length > 0 || taskFields !== null
          ? buildDocument(
              { type: "memo", tags, task: taskFields, preservedLines: [], foreignLines: [] },
              text,
            )
          : text;

      const now = Date.now();
      await saveDraft(itemId, body, now);
      await enqueueBodySave(itemId, item.rev, now);
      await db.items.update(itemId, { tags, updated_at: now });
      if (item.tags.join("\u0000") !== tags.join("\u0000")) {
        await enqueueMetaPatch(itemId, item.meta_rev, now);
      }
      await refresh();
      onLocalWrite();
    },
    [onLocalWrite, refresh],
  );

  return useMemo(() => ({ publishMemo, updateMemo }), [publishMemo, updateMemo]);
}
