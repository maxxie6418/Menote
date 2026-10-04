/**
 * 会话相关的确认框（2026-09-28 从 `App.tsx` 抽出）。
 *
 * 为什么单独一个文件：`App.tsx` 有 500 行预算（ESLint `max-lines`），而"登出要二次确认"
 * 这件事只需要 `open` / `onClose` / `onConfirm` 三个入口——放在组合根里只是把入口文件顶过线。
 * 文案按 `DESIGN.md` §6.5：**影响范围 + 能否恢复**；其中"本机缓存不会被删"是既有边界
 * （架构 §3.2），必须写出来，免得让人误以为"退登就安全了"。
 */
import type { UserSettings } from "@menote/shared";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { AppUnlockModal } from "./PrivacySlot";
import type { PrivacyLockState } from "../features/privacy/usePrivacyLock";

/**
 * 解锁框（全应用唯一出口：顶栏胶囊、Memo/待办占位、单篇加密都指过来）。
 * 「忘记隐私密码」先关框再跳设置页——这一步的接线放这里，`App` 只给"跳到哪"。
 *
 * `variant` / `itemId` 由 `App` 决定：范围解锁没有条目，单篇解锁必须带 id
 * （`AppUnlockModal` 会据此走 `decryptItem` 而不是 `unlock`）。
 */
export function UnlockDialog({
  open,
  privacy,
  settings,
  variant = "scope",
  itemId,
  onClose,
  onForgot,
}: {
  open: boolean;
  privacy: PrivacyLockState;
  settings: UserSettings;
  variant?: "scope" | "item";
  itemId?: string;
  onClose: () => void;
  onForgot: () => void;
}) {
  return (
    <AppUnlockModal
      open={open}
      privacy={privacy}
      settings={settings}
      variant={variant}
      itemId={itemId}
      onClose={onClose}
      onForgot={() => {
        onClose();
        onForgot();
      }}
    />
  );
}

export interface LogoutConfirmProps {
  open: boolean;
  onClose: () => void;
  /** 确认后由调用方真正退出（清会话 + 跳登录页） */
  onConfirm: () => void;
}

export function LogoutConfirm({ open, onClose, onConfirm }: LogoutConfirmProps) {
  return (
    <ConfirmDialog
      open={open}
      title="退出登录"
      desc="本机会话会被清除，需要重新输入登录密码。"
      confirmLabel="确认退出"
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <p>本机已缓存的内容不会被删除；隐私锁的解锁状态会一并失效。</p>
    </ConfirmDialog>
  );
}
