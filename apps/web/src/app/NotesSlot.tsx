/**
 * 笔记区在组合根里的接线（M3-8 从 `App.tsx` 抽出，为入口文件的行数预算让位）。
 *
 * 这一层只做"把隐私锁状态与工作区数据接成 `NotesPane` 的 props"，并统一处理提示：
 * - **单篇加密**：加密 / 取消加密（失败时把服务端原因如实弹出来）；
 * - **移入 / 移出加密空间**：锁定时不给内部层级（`folders: []`），于是菜单里只剩"移入空间根"——
 *   这不是前端"偷偷限制"，而是锁定态下那些文件夹本来就不可见（设计 §6.3、走查第 15 行）。
 */
import type { NotesWorkspace } from "../features/notes/useNotesWorkspace";
import { isScopeGateOpen, type EditorMode } from "@menote/shared";
import { useCallback, useMemo } from "react";
import type { DocMode } from "../features/notes/ui/NoteWorkspace";
import { formatCountdown } from "../features/privacy/model";
import type { PrivacyLockState } from "../features/privacy/usePrivacyLock";
import { useTicker } from "./ui/useTicker";
import { NotesPane } from "./workarea/NotesPane";

export interface NotesSlotProps {
  workspace: NotesWorkspace;
  /** 打开笔记时的模式**种子**（设置里的 `editor_mode`） */
  editorMode: DocMode;
  /** 用户在设置里开着哪几档（`editor_modes`）：正文区的切换条只列这些 */
  editorModes: EditorMode[];
  /** 隐私锁组装层的返回值（整份传进来，少一层手工转写） */
  privacy: PrivacyLockState;
  onRequestUnlock: () => void;
  /**
   * 逐篇解密（2026-10-04）：带上条目 id 打开解密窗。
   *
   * 与 `onRequestUnlock`（范围解锁）**分家**：后者开的是隐私锁范围门禁，
   * 对单篇加密条目毫无作用——那正是「解锁此篇」按钮此前点了没反应的原因。
   */
  onRequestItemUnlock: (itemId: string) => void;
  onToast: (message: string, tone: "success" | "warn" | "error") => void;
}

/** 把动作里的异常转成一句能读的提示（服务端 message 已经是中文可读文案） */
function toastError(onToast: NotesSlotProps["onToast"], fallback: string) {
  return (error: unknown): void => {
    onToast(error instanceof Error ? error.message : fallback, "error");
  };
}

export function NotesSlot({
  workspace,
  editorMode,
  editorModes,
  privacy,
  onRequestUnlock,
  onRequestItemUnlock,
  onToast,
}: NotesSlotProps) {
  const gate = privacy.gate;
  const unlocked = isScopeGateOpen(gate);
  const selected = workspace.selected;
  const tier = privacy.runtime.tier;
  const expiresAt = privacy.runtime.expiresAt;

  /**
   * 状态栏里的隐私锁那一句（设计 §9.2-④）。前缀随打开的内容变：
   * 空间内条目说"加密空间"、单篇加密说"加密笔记"、其余说"隐私锁"。
   * 倒计时在这里算（每秒 tick），DocStatusBar 只负责显示。
   */
  const nowMs = useTicker(unlocked && tier === "minutes" && expiresAt !== null);

  /*
    加密空间这一组 props 进列表行的 `memo` 浅比较（`NoteRow`），所以三样都要稳定：
    - 映射出来的文件夹数组（`.map()` 每次渲染都是新数组，必须 memo）；
    - 移入 / 移出两个回调（内联箭头每次渲染都是新函数）；
    - 于是整个对象可以 memo 成稳定引用。
    `workspace.moveItemToVault` 等由 `useNotesWorkspace` 保证身份稳定；`onToast` 由调用方
    直接传模块级的 `pushToast`（App 里已改），不要写成内联箭头。
  */
  const vaultFolders = useMemo(
    () =>
      unlocked ? workspace.vault.folders.map((folder) => ({ id: folder.id, name: folder.name })) : [],
    [unlocked, workspace.vault.folders],
  );
  /** 取出来再包（依赖里不能写 `workspace`：它每次渲染换身份，会让回调跟着换） */
  const { moveItemToVault, moveItemOutOfVault } = workspace;
  const moveIntoVault = useCallback(
    (itemId: string, folderId: string | null) => {
      void moveItemToVault(itemId, folderId)
        .then(() => onToast("已移入加密空间", "success"))
        .catch(toastError(onToast, "移入失败，请稍后重试"));
    },
    [moveItemToVault, onToast],
  );
  const moveOutOfVault = useCallback(
    (itemId: string) => {
      void moveItemOutOfVault(itemId, null)
        .then(() => onToast("已移出加密空间", "success"))
        .catch(toastError(onToast, "移出失败，请稍后重试"));
    },
    [moveItemOutOfVault, onToast],
  );
  const vault = useMemo(
    () => ({
      enabled: privacy.enabled,
      locked: !unlocked,
      id: workspace.vault.id,
      // 锁定时内部层级不可见 → 只留"移入空间根"
      folders: vaultFolders,
      onMoveIn: moveIntoVault,
      onMoveOut: moveOutOfVault,
    }),
    [
      moveIntoVault,
      moveOutOfVault,
      privacy.enabled,
      unlocked,
      vaultFolders,
      workspace.vault.id,
    ],
  );

  const privacyLine = (() => {
    if (privacy.runtime.lockState === "disabled") return null;
    const prefix =
      selected?.in_enc_space === 1 ? "加密空间" : selected?.enc_self === 1 ? "加密笔记" : "隐私锁";
    if (privacy.runtime.lockState === "locked") {
      return { text: `${prefix} · 已锁定`, expiresAt: null };
    }
    if (tier === "device") {
      return {
        text: "本设备始终解锁",
        expiresAt: null,
        onLock: privacy.lockAllItems,
        lockLabel: "锁定此设备",
      };
    }
    if (tier === "minutes" && expiresAt !== null) {
      const remaining = Math.max(0, expiresAt - nowMs);
      return {
        text: `${prefix} · 已解锁 · ${formatCountdown(remaining)} 后自动锁定`,
        expiresAt,
        onLock: privacy.lockAllItems,
        lockLabel: "立即锁定",
      };
    }
    return {
      text: `${prefix} · 已解锁 · 本次会话`,
      expiresAt: null,
      onLock: privacy.lockAllItems,
      lockLabel: "立即锁定",
    };
  })();

  return (
    <NotesPane
      workspace={workspace}
      editorMode={editorMode}
      editorModes={editorModes}
      privacyLine={privacyLine}
      encryption={{
        enabled: privacy.enabled,
        gate,
        unlockedCount: privacy.runtime.unlockedItems.size,
        onRequestUnlock,
        onRequestItemUnlock,
        onLockItem: privacy.lockItem,
        onLockAllItems: privacy.lockAllItems,
      }}
      onToggleEncryption={(itemId, next) => {
        void workspace
          .setItemEncryption(itemId, next)
          .then(() => onToast(next ? "已加密此篇" : "已取消加密", "success"))
          .catch(toastError(onToast, "操作失败，请稍后重试"));
      }}
      onToast={onToast}
      vault={vault}
    />
  );
}
