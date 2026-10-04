/**
 * 顶栏：全宽、固定高、**6 块且顺序不可变**（DESIGN.md §2.5-1）：
 * 品牌 · 面包屑 · 搜索框 · 同步胶囊 · 隐私锁胶囊 · 账户与设置。
 *
 * M1 的取舍（见 `docs/modules/Menote-M1-界面稿-v1.md`）：
 * - 搜索框**保留占位**（位置固定，避免 M2 再动顶栏结构），禁用并说明原因；
 * - 隐私锁胶囊**不渲染**（未启用隐私锁时整个不显示，拆解 M02-05）。
 */
import type { ReactNode } from "react";
import type { UserSettings } from "@menote/shared";
import { Pill } from "../ui/Controls";
import { AccountQuickMenu } from "./AccountQuickMenu";
import { SearchBox } from "./SearchBox";
import type { ThemeMode } from "../theme/useTheme";
import type { SyncIndicator } from "../useSyncStatus";
import type { AccountQuickMenuProps } from "./AccountQuickMenu";

export interface TopbarUser {
  username: string;
  role: "owner" | "member";
}

export interface TopbarProps {
  user: TopbarUser;
  breadcrumb: ReactNode;
  sync: SyncIndicator;
  /** 搜索框的值（M2-6）；由 App 持有，清空即回到进入搜索前的视图 */
  searchQuery: string;
  onSearchChange: (value: string) => void;
  /** 账户快捷菜单（M2-7）：显示哪些功能项由设置决定 */
  userSettings: UserSettings;
  themeMode: ThemeMode;
  onThemeMode: (mode: ThemeMode) => void;
  /** 菜单里的「搜索」项：把焦点送到搜索框 */
  onFocusSearch: () => void;
  /** 菜单里的「立即锁定」项（M3 已交付）：由 `App` 接到隐私锁组装层 */
  onLock: () => void;
  /** 菜单里的「回收站」项（M4 已交付）：由 `App` 接路由 */
  onOpenTrash: () => void;
  /** 菜单里的「立即备份」项（2026-10-04 接线）：由 `App` 接路由到「备份与导出」页 */
  onOpenBackup: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  /** 头像外圈使用的隐私状态；未启用时不显示状态圈 */
  privacyStatus?: AccountQuickMenuProps["privacyStatus"];
  /**
   * ⑤ 隐私锁胶囊（M3）。**由 `App` 组装后按插槽传入**：顶栏不认识隐私锁状态机，
   * 未启用时传 `null`（整个槽位不渲染，符合"未启用不显示"）。
   */
  privacy?: ReactNode;
}

export function Topbar({
  user,
  breadcrumb,
  sync,
  searchQuery,
  onSearchChange,
  userSettings,
  themeMode,
  onThemeMode,
  onFocusSearch,
  onLock,
  onOpenTrash,
  onOpenBackup,
  onOpenSettings,
  onLogout,
  privacy,
  privacyStatus,
}: TopbarProps) {
  return (
    <header className="topbar">
      {/* ① 品牌 */}
      <div className="topbar__brand">
        <img className="brandmark" src="/icon.svg" alt="" aria-hidden="true" />
        <span>Menote</span>
      </div>

      {/* ② 面包屑 */}
      <nav className="topbar__crumb" aria-label="当前位置">
        {breadcrumb}
      </nav>

      {/* ③ 搜索框（M2-6 启用） */}
      <SearchBox value={searchQuery} onChange={onSearchChange} />

      <div className="topbar__actions">
        {/* ④ 同步胶囊 */}
        <Pill tone={sync.tone} icon={sync.icon} title={sync.title}>
          {sync.label}
        </Pill>

        {/* ⑤ 隐私锁胶囊：由 App 组装后按插槽传入；未启用时为 null */}
        {privacy}

        {/* ⑥ 账户快捷菜单（M2-7：账户头 → 可配置功能项 → 定底设置/退出） */}
        <AccountQuickMenu
          user={user}
          settings={userSettings}
          themeMode={themeMode}
          onThemeMode={onThemeMode}
          onFocusSearch={onFocusSearch}
          onLock={onLock}
          onOpenTrash={onOpenTrash}
          onOpenBackup={onOpenBackup}
          onOpenSettings={onOpenSettings}
          onLogout={onLogout}
          privacyStatus={privacyStatus}
        />
      </div>
    </header>
  );
}
