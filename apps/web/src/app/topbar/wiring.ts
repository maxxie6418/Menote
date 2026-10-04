/**
 * 顶栏的 props 组装（2026-09-28 从 `App.tsx` 抽出，为入口文件的行数预算让位——
 * 与 `NavPanels.fnbarWiring` 同一个做法：**行为仍在 `App` 决定，这里只把零散字段拼成一份 props**）。
 *
 * 抽出来的实际好处：面包屑那串"设置 / 搜索结果 / Memo / 待办 / 当前视图"的三元嵌套，
 * 以及五个动作（搜索聚焦、锁定、回收站、设置、登出）的接线只在这一个地方出现。
 */
import type { UserSettings } from "@menote/shared";
import type { ReactNode } from "react";
import type { ThemeMode } from "../theme/useTheme";
import type { SyncIndicator } from "../useSyncStatus";
import type { BrowsableView } from "../fnbar/NavSegmented";
import type { NotesView } from "../../features/notes/views";
import type { PrivacyTier } from "../../features/privacy/model";
import type { TopbarProps, TopbarUser } from "./Topbar";
import type { PrivacyLockState } from "@menote/shared";

export interface TopbarWiringInput {
  user: TopbarUser;
  /** 当前路由名（`settings` / `notes` / …） */
  routeName: string;
  /** 搜索框里有没有内容（有则面包屑让位给「搜索结果」） */
  searching: boolean;
  /** 分栏浏览的当前项（`home` / `memo` / `task`） */
  browse: BrowsableView | null;
  /** 笔记视图标题（`workspace.viewTitle`） */
  viewTitle: string;
  sync: SyncIndicator;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  /** 一打字就回笔记区（否则结果会被设置/回收站那两个分支挡住） */
  onStartSearch: () => void;
  userSettings: UserSettings;
  themeMode: ThemeMode;
  onThemeMode: (mode: ThemeMode) => void;
  onFocusSearch: () => void;
  onLock: () => void;
  onOpenTrash: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  /** 「立即备份」菜单项（2026-10-04 接线）：去「备份与导出」页 */
  onOpenBackup: () => void;
  /** 隐私锁弹窗/兼容插槽；头像状态单独传入 */
  privacy?: ReactNode;
  privacyStatus?: { lockState: PrivacyLockState; tier: PrivacyTier; expiresAt: number | null; durationMs: number };
}

export type { NotesView };

export function topbarWiring(input: TopbarWiringInput): TopbarProps {
  const breadcrumb =
    input.routeName === "settings"
      ? "设置"
      : input.searching
        ? "搜索结果"
        : input.browse === "memo"
          ? "Memo"
          : input.browse === "task"
            ? "待办"
            : input.viewTitle;

  return {
    user: input.user,
    breadcrumb,
    sync: input.sync,
    searchQuery: input.searchQuery,
    onSearchChange: (next) => {
      if (next.trim() !== "") input.onStartSearch();
      input.onSearchChange(next);
    },
    userSettings: input.userSettings,
    themeMode: input.themeMode,
    onThemeMode: input.onThemeMode,
    onFocusSearch: input.onFocusSearch,
    onLock: input.onLock,
    onOpenTrash: input.onOpenTrash,
    onOpenBackup: input.onOpenBackup,
    onOpenSettings: input.onOpenSettings,
    onLogout: input.onLogout,
    privacy: input.privacy,
    privacyStatus: input.privacyStatus,
  };
}
