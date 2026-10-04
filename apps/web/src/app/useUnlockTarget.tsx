/**
 * 解锁框的目标状态与自动弹窗（2026-10-04 从 `App.tsx` 抽出，为入口文件的行数预算让位）。
 *
 * 抽出来的理由不只是行数：`App.tsx` 有 500 行硬上限（ESLint `max-lines`），而"解锁有
 * 哪几种、各自走哪条密码校验路径"是一组独立的业务规则，值得有名字、值得能被单测直接覆盖。
 *
 * ## 为什么不能只有一个 `unlockOpen: boolean`
 *
 * 原先确实只有一个布尔量，顶栏胶囊、空间节点、Memo/待办占位、单篇占位全都指向它，
 * 于是**单篇加密弹出来的也是范围解锁框**：输对密码只开了范围门禁，而范围门禁按设计
 * **不动单篇集合**（`model.ts` 头注），所以这一篇永远进不了 `unlockedItems`，
 * 占位面板纹丝不动——按钮看着能点，实际什么也没解开。
 *
 * `UnlockModal` 的 `variant="item"` 分支（标题「解锁此篇」、不显示档位）其实早就写好了，
 * 界面稿也这么定（`Menote-M3-界面稿-v1.md` §二），只是**界面从未传过这个值**。
 *
 * ## 两道门禁正交
 *
 * `{kind:"scope"}` → `privacy.unlock`：开范围门禁（加密空间 + 范围内 Memo）。
 * `{kind:"item", itemId}` → `privacy.decryptItem`：**只**解开这一篇，范围门禁维持原状。
 * 想看一篇不必顺带解锁整个空间；想解锁空间请走胶囊 / 空间节点。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { UserSettings } from "@menote/shared";
import type { LocalItem } from "../data/db";
import type { PrivacyLockState } from "../features/privacy/usePrivacyLock";
import { UnlockDialog } from "./SessionDialogs";

/** `null` = 关闭；`scope` = 隐私锁范围；`item` = 逐篇解密（带上条目 id） */
export type UnlockTarget = { kind: "scope" } | { kind: "item"; itemId: string } | null;

export interface UseUnlockTargetResult {
  /** 范围解锁：顶栏胶囊、空间节点、Memo/待办占位 */
  requestUnlock: () => void;
  /** 逐篇解密：单篇占位上的「解锁此篇」按钮 */
  requestItemUnlock: (itemId: string) => void;
  /**
   * 装配好的解锁弹窗元素。
   *
   * 之所以返回元素而不是让人用 `target` 自己拼：变体与条目 id 的推导规则（`kind === "item"`
   * 时才传 id、漏传 id 就退回范围形态）必须和状态放在同一处，否则接线层很容易只传一半。
   * `App.tsx` 有 500 行硬上限，少铺五行也是收益。
   */
  dialog: ReactNode;
}

export function useUnlockTarget(
  privacy: PrivacyLockState,
  settings: UserSettings,
  selected: LocalItem | null,
  onForgot: () => void,
): UseUnlockTargetResult {
  const [target, setTarget] = useState<UnlockTarget>(null);
  const requestUnlock = useCallback((): void => setTarget({ kind: "scope" }), []);
  const requestItemUnlock = useCallback(
    (itemId: string): void => setTarget({ kind: "item", itemId }),
    [],
  );
  const closeUnlock = useCallback((): void => setTarget(null), []);

  /**
   * 选中一条「已加密且本次未解密」的笔记时**直接弹出解密窗**（2026-10-04，用户要求）。
   *
   * 此前要点正文区占位面板上的「解锁此篇」才弹窗，多一步；现在点开就是解密窗。
   *
   * 两个必须处理的细节：
   * 1. **同一篇不重复弹**。`unlockedItems` 在解密成功后会变，于是依赖数组天然会让本
   *    effect 再跑一次——若不加 `autoPromptedFor`，解密成功的瞬间会立刻再弹一次窗。
   *    所以用 ref 记住"已为哪一篇弹过"，同一篇只在选中变化时弹一次。
   * 2. **关掉窗不等于放弃**。用户按 `Esc` / 点遮罩关掉后，占位面板上的「解锁此篇」按钮
   *    仍在（DESIGN.md §5.4-3「空状态必须给出口」），随时能再打开；此时不再自动弹第二次，
   *    否则用户刚关掉就被重新糊一脸。
   *
   * 未启用隐私锁时不可能存在加密条目，判据天然为假，不必额外判 `enabled`。
   */
  const autoPromptedFor = useRef<string | null>(null);
  useEffect(() => {
    if (selected === null || selected.enc_self !== 1) {
      autoPromptedFor.current = null;
      return;
    }
    if (privacy.gate.unlockedItems.has(selected.id)) {
      autoPromptedFor.current = null;
      return;
    }
    if (autoPromptedFor.current === selected.id) return;
    autoPromptedFor.current = selected.id;
    requestItemUnlock(selected.id);
  }, [selected, privacy.gate.unlockedItems, requestItemUnlock]);

  return {
    requestUnlock,
    requestItemUnlock,
    dialog: (
      <UnlockDialog
        open={target !== null}
        variant={target?.kind === "item" ? "item" : "scope"}
        itemId={target?.kind === "item" ? target.itemId : undefined}
        privacy={privacy}
        settings={settings}
        onClose={closeUnlock}
        onForgot={() => {
          // 「忘记隐私密码」先关窗再跳设置页（`UnlockDialog` 之外的收尾）
          closeUnlock();
          onForgot();
        }}
      />
    ),
  };
}
