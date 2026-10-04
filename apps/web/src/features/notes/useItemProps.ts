/**
 * 属性卡片的编排（2026-10-04，《笔记属性卡片》设计稿 §6）。
 *
 * ## 为什么编排要单独一个 hook，而不是塞进组件
 *
 * 卡片的每一次改动要走**两条通道**，各管各的字段：
 *
 * 1. **md 那一路走编辑器**：`updateMenoteKeys` 算出新 front matter →
 *    `EditorHandle.replaceFrontmatter` 推进编辑器 → 编辑器既有的自动保存落草稿、入队 body。
 * 2. **派生列那一路走 meta 补丁**：`items.tags` / 任务三列各自更新、入队 `patch_meta`。
 *
 * 组件自己存草稿的话会和编辑器的自动保存打架：卡片写下带新标签的 md，编辑器那份文本
 * 还是旧的，用户接着敲一个字就把标签覆盖掉了——界面上看着还在，刷新就没。**这条是
 * 本设计最要紧的一条，用例钉在 `notes-title-md.test.tsx` 旁边那条防回归上。**
 *
 * 「完全没有 front matter」也走同一条路：此时 `expected` 是空串，
 * `replaceFrontmatter("", 新的)` 就是在文档开头插入——省掉一条分支。
 */
import { useCallback } from "react";
import {
  frontmatterText,
  removeForeignKey,
  updateMenoteKeys,
  writeForeignKey,
} from "@menote/mdcore";
import type { EditorHandle } from "../../app/editor/Editor";
import { patchItemTags, patchItemTaskFields } from "./actions";

/** 清掉清单标记 = 三个字段都空（`tasks.ts`：有无 `menote.task` 键就是标记本身） */
export type TaskPatch = { status: string | null; due: string | null; priority: string | null } | null;

export interface UseItemPropsInput {
  itemId: string | null;
  /** 编辑器当前文本（含 front matter） */
  body: string;
  /** 编辑器句柄；`null` = 预览档或编辑器还没挂上 → 属性只读 */
  handle: EditorHandle | null;
  /** 校验没过 / 写不进去时把理由报上来（错误必须可见） */
  onError?: (message: string) => void;
}

const NO_EDIT_REASON = "切到「仅编辑」才能改属性";

export function useItemProps(input: UseItemPropsInput) {
  const { itemId, body, handle, onError } = input;
  const editable = itemId !== null && handle !== null;

  /**
   * 把新 front matter 推进编辑器。**对不上就报出来，不装作成功**——
   * 这就是句柄那个方法不退回插入的原因（见 `EditorHandle.replaceFrontmatter`）。
   */
  const applyMd = useCallback(
    (nextBody: string): boolean => {
      const next = frontmatterText(nextBody);
      if (next === null) {
        onError?.("算不出新的属性段，请重新打开这一篇再试。");
        return false;
      }
      const expected = frontmatterText(body) ?? "";
      if (!handle?.replaceFrontmatter(expected, next)) {
        onError?.("正文已经变了，没写进去；重新打开这一篇再试。");
        return false;
      }
      return true;
    },
    [body, handle, onError],
  );

  /*
    派生列那一路**必须自己兜住异常**。md 已经改进编辑器了，列却没跟上时会静默分叉：
    列表 / 标签视图读的是 `items.tags`，用户看着标签没加上，而正文里其实已经写了。
    所以这里报错出去，而不是让 promise 悬着（悬着的结果是 unhandled rejection，
    界面上什么都不说）。
  */
  const patchColumns = useCallback(
    async (run: () => Promise<boolean>) => {
      try {
        await run();
      } catch (error) {
        onError?.(
          `属性已经写进正文，但没能存到本地记录：${error instanceof Error ? error.message : "未知原因"}`,
        );
      }
    },
    [onError],
  );

  const onTagsChange = useCallback(
    (tags: string[]) => {
      if (!itemId) return;
      if (!applyMd(updateMenoteKeys(body, { tags }))) return;
      void patchColumns(() => patchItemTags(itemId, tags));
    },
    [applyMd, body, itemId, patchColumns],
  );

  const onTaskChange = useCallback(
    (next: TaskPatch) => {
      if (!itemId) return;
      if (!applyMd(updateMenoteKeys(body, { task: next }))) return;
      void patchColumns(() => patchItemTaskFields(itemId, next));
    },
    [applyMd, body, itemId, patchColumns],
  );

  const onForeignChange = useCallback(
    (key: string, value: string, block: boolean) => {
      if (!applyMd(writeForeignKey(body, key, { value, block }))) return;
    },
    [applyMd, body],
  );

  const onForeignRemove = useCallback(
    (key: string) => {
      if (!applyMd(removeForeignKey(body, key))) return;
    },
    [applyMd, body],
  );

  const onForeignAdd = useCallback(
    (key: string, value: string) => {
      if (!applyMd(writeForeignKey(body, key, { value, block: false }))) return;
    },
    [applyMd, body],
  );

  return {
    editable,
    readOnlyReason: editable ? undefined : NO_EDIT_REASON,
    onTagsChange,
    onTaskChange,
    onForeignChange,
    onForeignRemove,
    onForeignAdd,
  };
}
