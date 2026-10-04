/**
 * 极简 hash 路由（架构 §2.3.1：`main.tsx` 装配路由表；不引入路由库，M1 只有四个目的地）。
 *
 * 目的地：`#/login`、`#/register`、`#/notes`（默认）、`#/settings/<page>`。
 */
import { useEffect, useState } from "react";

/**
 * 设置分类清单——**唯一一份真源**：URL 解析的白名单、设置页的导航顺序、分类 id 的类型都出自它。
 *
 * 踩过的坑（2026-09-27 修复）：原先 `SettingsPageId`（联合类型）与这份白名单是**两份手维护的清单**，
 * M2 加「编辑器」、M3 加「隐私锁」与「版本与回收站」时只动了联合类型与设置页的 `PAGE_META`，
 * 忘了动白名单——于是 `#/settings/privacy` 匹配不到，`parseRoute` **静默**回落到 `general`：
 * 点「隐私锁」显示「通用」，M3-9 的设置页在界面上根本进不去，而且不报错、不白屏。
 *
 * 现在类型由清单推导（`as const` + `typeof [number]`），所以**新增分类只可能在一个地方发生**，
 * 漏改的另一半会直接编译不过（设置页的 `PAGE_META: Record<SettingsPageId, …>` 就是那另一半的守卫）。
 *
 * **【v0.8.4 调整】11 类 → 9 类**（决定与影响面见 `docs/modules/Menote-M8-设置页信息架构-v1.md`）：
 * 「编辑器」并入「通用」（那三个开关与「通用」同属"界面偏好"，且体量差 12 倍）、
 * 「关于」并入「通用」底部（版本号 + 仓库地址，低频查阅）、原「数据管理」**改名「附件」**
 * （它本来就只管附件占用与孤儿清理，原名承诺了比实际更多的东西；**id 仍是 `data`**，老书签与深链不失效）。
 * 顺序：通用 / 账户与安全 / 隐私锁 / 版本与回收站 / 备份与导出 / 分享 / MCP / 附件 / 实例管理。
 *
 * **撤销的两类要显式重定向**（`LEGACY_SETTINGS_PAGES`）：从清单里拿掉而不补一条映射，
 * `#/settings/editor` 会走进 `parseRoute` 那个"匹配不到就静默回落 `general`"的分支——
 * 表现与 2026-09-27 修过的那个 bug **完全同形**（点进去不是白屏、是不报错地落到别处，最难查）。
 */
export const SETTINGS_PAGES = [
  "general",
  "account",
  // 「编辑试验」2026-10-01 暂时收起（用户 2026-10-01）：试验区按桌面稿排布，
  // 在窄面板里会挤成一条，且本轮改为直接在正式编辑器上迭代。**试验代码全部保留**，
  // 恢复只需把这一行放回来 + 恢复 `SettingsPanel` 里的两处（PAGE_META 与渲染分支）。
  // "editor-lab",
  "privacy",
  "versions",
  "backup",
  "shares",
  "mcp",
  "data",
  "instance",
] as const;

/**
 * 已被撤销的分类 → 现在的落地页。
 *
 * 存在的理由：分类从清单里消失**不等于**它的老 URL 该变成死链。撤销的那两类的内容都没丢，
 * 只是搬了家，所以老 hash 应当落到新家而不是默默消失。
 */
export const LEGACY_SETTINGS_PAGES: Readonly<Record<string, SettingsPageId>> = {
  editor: "general",
  about: "general",
};

/** 设置分类 id：**从清单推导**，不再手写第二份 */
export type SettingsPageId = (typeof SETTINGS_PAGES)[number];

export type Route =
  | { name: "login" }
  | { name: "register" }
  | { name: "notes" }
  | { name: "trash" }
  | { name: "settings"; page: SettingsPageId };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").replace(/\/$/, "");

  if (path === "login") return { name: "login" };
  if (path === "register") return { name: "register" };
  // 回收站是**独立页**（功能拆解 Q2：不进功能栏），所以有自己的一档路由
  if (path === "trash") return { name: "trash" };

  if (path.startsWith("settings")) {
    const page = path.split("/")[1] ?? "";
    const matched = SETTINGS_PAGES.find((candidate) => candidate === page);
    if (matched) return { name: "settings", page: matched };
    // 撤销的分类走重定向（见 `LEGACY_SETTINGS_PAGES`），不是静默落到 default
    return { name: "settings", page: LEGACY_SETTINGS_PAGES[page] ?? "general" };
  }

  return { name: "notes" };
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case "login":
      return "#/login";
    case "register":
      return "#/register";
    case "trash":
      return "#/trash";
    case "settings":
      return `#/settings/${route.page}`;
    default:
      return "#/notes";
  }
}

/** 订阅 `hashchange`；`navigate` 只改 hash，由订阅统一触发重渲染 */
export function useRoute(): { route: Route; navigate: (route: Route) => void } {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    function onHashChange(): void {
      setRoute(parseRoute(window.location.hash));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  return {
    route,
    navigate(next: Route): void {
      const hash = routeToHash(next);
      if (window.location.hash === hash) {
        setRoute(next);
        return;
      }
      window.location.hash = hash;
    },
  };
}
