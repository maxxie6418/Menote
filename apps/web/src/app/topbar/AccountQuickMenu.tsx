/**
 * 账户快捷菜单（components.md §五 `AccountEntry` + `AccountQuickMenu`；功能拆解 M18-03、M02-01）。
 *
 * 结构（自上而下）：**账户头**（头像 + 角色 + 实例）→ 分隔线 → **可配置的功能项** → 分隔线 →
 * 定底的「设置」「退出登录」（**不在配置清单里**）。
 *
 * 三条行为：
 * 1. 显示哪些功能项由 设置 › 通用 › 快捷菜单 决定（`quick_menu` 数组），**即时生效**——
 *    菜单与设置页读的是同一份数据；
 * 2. 菜单里的**主题切换是一排三档**，且切完**不收起菜单**（便于连续比色）；
 * 3. **5 个候选至此全部可用**（2026-10-04）。最后一个是「立即备份」——它做成了**入口**
 *    （去「备份与导出」页，推哪个目标由用户自己选），所以"未实现就禁用"这条分支已撤。
 *
 * 【2026-09-28 修复】此前「立即锁定」与「回收站」**硬编码禁用**并写着"将在 M3/M4 提供"——
 * 而 M3、M4 早已交付：菜单里点了没反应、设置页又写着"将在 M4 生效"，同一件事两处口径都是错的。
 * 现在两项都接线（锁定走隐私锁组装层、回收站走路由）。
 */
import type { QuickMenuFeature, UserSettings } from "@menote/shared";
import { QUICK_MENU_FEATURES } from "@menote/shared";
import { APP_VERSION } from "../about";
import { Avatar } from "../ui/Controls";
import { DropdownMenu, type MenuItemSpec } from "../ui/Menu";
import type { ThemeMode } from "../theme/useTheme";
import type { TopbarUser } from "./Topbar";
import { useTicker } from "../ui/useTicker";
import type { PrivacyLockState as LockState } from "@menote/shared";
import type { PrivacyTier } from "../../features/privacy/model";

const THEME_ROW: ReadonlyArray<{ id: ThemeMode; label: string }> = [
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
  { id: "system", label: "跟随系统" },
];

export interface AccountQuickMenuProps {
  user: TopbarUser;
  settings: UserSettings;
  themeMode: ThemeMode;
  onThemeMode: (mode: ThemeMode) => void;
  /** 「搜索」项：把焦点送到顶栏搜索框 */
  onFocusSearch: () => void;
  /** 「立即锁定」项（M3 已交付）：锁上全部已解锁内容 */
  onLock: () => void;
  /** 「回收站」项（M4 已交付）：去回收站页 */
  onOpenTrash: () => void;
  /**
   * 「立即备份」项（**2026-10-04 接线**）：去「备份与导出」设置页。
   * 它是**入口不是动作**——推哪个备份目标由用户在那页自己选（目标可以有多个）。
   */
  onOpenBackup: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  privacyStatus?: { lockState: LockState; tier: PrivacyTier; expiresAt: number | null; durationMs: number };
}

function AvatarStatus({
  username,
  size,
  status,
  now,
}: {
  username: string;
  size: number;
  status?: AccountQuickMenuProps["privacyStatus"];
  now: number;
}) {
  const remaining = status?.expiresAt === null || status?.expiresAt === undefined ? null : Math.max(0, status.expiresAt - now);
  const ratio = status?.durationMs && remaining !== null ? Math.min(1, remaining / status.durationMs) : 1;
  const state = status?.lockState === "locked" ? "locked" : status?.lockState === "unlocked" ? status.tier : "disabled";
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  return (
    <span className={`avatar-status avatar-status--${state}`} aria-label={state === "disabled" ? "账户" : state === "locked" ? "账户，隐私锁已锁定" : "账户，隐私锁已解锁"}>
      {state === "minutes" ? <svg className="avatar-status__ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} /></svg> : null}
      <Avatar username={username} size={size} />
    </span>
  );
}

/** 功能项要用的动作：集中成一份，免得每加一项就多一个位置参数 */
interface FeatureActions {
  onFocusSearch: () => void;
  onLock: () => void;
  onOpenTrash: () => void;
  /** 「立即备份」：去「备份与导出」页（**入口**，不是动作——见下） */
  onOpenBackup: () => void;
}

export function AccountQuickMenu({
  user,
  settings,
  themeMode,
  onThemeMode,
  onFocusSearch,
  onLock,
  onOpenTrash,
  onOpenBackup,
  onOpenSettings,
  onLogout,
  privacyStatus,
}: AccountQuickMenuProps) {
  const now = useTicker(privacyStatus?.lockState === "unlocked" && privacyStatus.tier === "minutes");
  const enabled = QUICK_MENU_FEATURES.filter((feature) =>
    settings.quick_menu.includes(feature.id),
  );

  /** 除主题外的功能项（主题走上面那一排三档的 `blocks`） */
  const items: MenuItemSpec[] = enabled
    .filter((feature) => feature.id !== "theme")
    .map((feature) =>
      featureItem(feature.id, { onFocusSearch, onLock, onOpenTrash, onOpenBackup }),
    );

  // 定底两项：设置与退出登录（不进配置清单）
  items.push(
    { id: "settings", label: "设置", icon: "settings", onSelect: onOpenSettings },
    { id: "logout", label: "退出登录", icon: "logout", onSelect: onLogout },
  );

  return (
    <DropdownMenu
      label="账户与设置"
      align="right"
      trigger={<AvatarStatus username={user.username} size={24} status={privacyStatus} now={now} />}
      header={
        <div className="acct">
          <Avatar username={user.username} size={28} />
          <div className="acct__meta">
            <span className="acct__name">{user.username}</span>
            <span className="acct__sub">
              {user.role === "owner" ? "owner" : "成员"} · 本地实例
            </span>
            <span className="acct__sub">MeNote v{APP_VERSION}</span>
          </div>
        </div>
      }
      blocks={
        settings.quick_menu.includes("theme") ? (
          <div className="menu__theme" role="group" aria-label="主题">
            {THEME_ROW.map((option) => (
              <button
                key={option.id}
                type="button"
                className="menu__theme-item"
                aria-pressed={themeMode === option.id}
                onClick={() => onThemeMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null
      }
      items={items}
    />
  );
}

/**
 * 把功能 id 映射成菜单项。
 *
 * **【2026-10-04】不再接 `pendingStep` 参数**：5 个候选至此全部可用
 * （立即备份做成了「入口」——去备份页推哪个目标由用户自己选），
 * 于是"未实现就禁用并说明里程碑"这条分支**一个都不剩**，留着那个参数只会让人
 * 以为还能配一个未交付的项。清单上的未实现标记仍在 `QUICK_MENU_FEATURES.pendingStep`
 * 那一列——**将来加回未交付的候选时**，把它接回本函数即可。
 */
function featureItem(id: QuickMenuFeature, actions: FeatureActions): MenuItemSpec {
  if (id === "search") {
    return { id, label: "搜索", icon: "search", onSelect: actions.onFocusSearch };
  }
  if (id === "lock") {
    // M3 已交付：锁上全部已解锁内容
    return { id, label: "立即锁定", icon: "lock", onSelect: actions.onLock };
  }
  if (id === "trash") {
    // M4 已交付：去回收站页
    return { id, label: "回收站", icon: "folder", onSelect: actions.onOpenTrash };
  }
  // 「立即备份」**是入口不是动作**（用户 2026-10-04 决定）：去「备份与导出」页，推哪个目标由用户自己选。
  // 为什么不直接一键推：备份目标可以**有多个**（WebDAV / S3 各配一个），
  // "立即备份"推哪个没有答案；真要做成动作得先给契约加"默认目标"概念并动服务端，那是新功能。
  return { id, label: "立即备份", icon: "cloud-ok", onSelect: actions.onOpenBackup };
}
