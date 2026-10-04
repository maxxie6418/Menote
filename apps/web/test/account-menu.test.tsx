// @vitest-environment jsdom
/**
 * 账户快捷菜单（M2-7 / M18-03 验收点）：
 * - 结构：账户头 → 可配置功能项 → 定底「设置」「退出登录」（后两项不进配置清单）；
 * - 显示哪些功能项由设置决定，**改设置即时生效**（同一份数据驱动）；
 * - 主题是一排三档，且**切完不收起菜单**。
 *
 * **【2026-10-04】5 个候选至此全部可用**：原文件头那条"未实现的功能禁用并说明原因"
 * 已过期——最后一个「立即备份」接成了**入口**（去「备份与导出」页，推哪个目标由用户自己选），
 * 所以菜单里不再有禁用项，清单上的 `pendingStep` 也应全为 `null`。
 * 下面两条用例就是钉这个：一条钉"它真的可点且真的回调"（防它退回死件），
 * 一条钉"菜单里不再出现已过期的里程碑标记"。
 */
import { DEFAULT_USER_SETTINGS, QUICK_MENU_FEATURES } from "@menote/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountQuickMenu } from "../src/app/topbar/AccountQuickMenu";
import { assertLabelledControls } from "./helpers/a11y";
import { assertSinglePrimaryAction } from "./helpers/design";

afterEach(cleanup);

function renderMenu(overrides: Partial<Parameters<typeof AccountQuickMenu>[0]> = {}) {
  const onOpenSettings = vi.fn();
  const onLogout = vi.fn();
  const onThemeMode = vi.fn();
  const onFocusSearch = vi.fn();
  const onLock = vi.fn();
  const onOpenTrash = vi.fn();
  const onOpenBackup = vi.fn();
  const { container } = render(
    <AccountQuickMenu
      user={{ username: "maxxie", role: "owner" }}
      settings={DEFAULT_USER_SETTINGS}
      themeMode="light"
      onThemeMode={onThemeMode}
      onFocusSearch={onFocusSearch}
      onLock={onLock}
      onOpenTrash={onOpenTrash}
      onOpenBackup={onOpenBackup}
      onOpenSettings={onOpenSettings}
      onLogout={onLogout}
      {...overrides}
    />,
  );
  // 读屏底线（渲染层断言，见 helpers/a11y.ts）：账号菜单是"图标 + 文字"混排，值得钉住
  assertLabelledControls(container, { buttons: 1 });
  assertSinglePrimaryAction(container);
  return { onOpenSettings, onLogout, onThemeMode, onFocusSearch, onLock, onOpenTrash, onOpenBackup };
}

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "账户与设置" }));
  return { user, menu: screen.getByRole("menu", { name: "账户与设置" }) };
}

describe("账户快捷菜单", () => {
  it("账户头显示用户名、角色与实例；定底是「设置」与「退出登录」", async () => {
    renderMenu();
    const { menu } = await openMenu();

    expect(within(menu).getByText("maxxie")).toBeTruthy();
    expect(within(menu).getByText(/owner/)).toBeTruthy();
    expect(within(menu).getByText(/本地实例/)).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "设置" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "退出登录" })).toBeTruthy();
  });

  it("默认只显示主题切换与立即锁定；搜索与回收站不在菜单里（默认关）", async () => {
    renderMenu();
    const { menu } = await openMenu();

    // 主题是一排三档（不是菜单项）
    const themeRow = within(menu).getByRole("group", { name: "主题" });
    expect(within(themeRow).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "浅色",
      "深色",
      "跟随系统",
    ]);

    expect(within(menu).getByRole("menuitem", { name: "立即锁定" })).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: "搜索" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "回收站" })).toBeNull();
  });

  it("设置里启用搜索后菜单立刻出现，点击把焦点送到搜索框", async () => {
    const { onFocusSearch } = renderMenu({
      settings: { ...DEFAULT_USER_SETTINGS, quick_menu: ["theme", "lock", "search"] },
    });
    const { user, menu } = await openMenu();

    await user.click(within(menu).getByRole("menuitem", { name: "搜索" }));
    expect(onFocusSearch).toHaveBeenCalledTimes(1);
  });

  it("「立即备份」启用后**可点**并去备份页（2026-10-04：从禁用接线成入口）", async () => {
    /*
      这条盯的是一个**曾经骗过人的入口**：它此前是 `disabled: true` 的硬编码死件，
      而清单上的 `pendingStep` 写着早已收口的 "M5" —— 两处都在说"还没做"，
      而实际是"M5 早已交付、但这一项从没接线"。

      现在它是**入口不是动作**：点一下去「备份与导出」页，推哪个目标由用户自己选
      （备份目标可以有多个，一键推的话"推哪个"没有答案）。
      断言两件事：**不是 disabled**（否则又变成死件）、**真的回调**（否则又是装饰）。
    */
    const { onOpenBackup } = renderMenu({
      settings: { ...DEFAULT_USER_SETTINGS, quick_menu: ["theme", "lock", "backup"] },
    });
    const { user, menu } = await openMenu();

    const item = within(menu).getByRole("menuitem", { name: "立即备份" }) as HTMLButtonElement;
    expect(item.disabled).toBe(false);

    await user.click(item);
    expect(onOpenBackup).toHaveBeenCalledTimes(1);
  });

  it("菜单里不再出现「将在 M5 生效」这类过期里程碑标记", async () => {
    renderMenu({
      settings: { ...DEFAULT_USER_SETTINGS, quick_menu: ["theme", "lock", "search", "trash", "backup"] },
    });
    const { menu } = await openMenu();

    // 5 个候选至此全部可用，清单上的 pendingStep 应全为 null
    expect(QUICK_MENU_FEATURES.filter((f) => f.pendingStep !== null)).toEqual([]);
    expect(within(menu).queryByText(/将在 .* 生效|将在 M/)).toBeNull();
  });

  it("主题切换**不收起菜单**（便于连续比色）", async () => {
    const { onThemeMode } = renderMenu();
    const { user, menu } = await openMenu();

    await user.click(within(menu).getByRole("button", { name: "深色" }));
    expect(onThemeMode).toHaveBeenCalledWith("dark");
    expect(screen.getByRole("menu", { name: "账户与设置" })).toBeTruthy();
  });

  it("已交付的两项接线可用：立即锁定走回调、回收站去回收站页（2026-09-28 修复死件）", async () => {
    const { onLock, onOpenTrash } = renderMenu({
      settings: { ...DEFAULT_USER_SETTINGS, quick_menu: ["theme", "lock", "trash"] },
    });
    const { user, menu } = await openMenu();

    const lock = within(menu).getByRole("menuitem", { name: "立即锁定" }) as HTMLButtonElement;
    expect(lock.disabled).toBe(false);
    await user.click(lock);
    expect(onLock).toHaveBeenCalledTimes(1);

    // 菜单在选中后收起，重新打开再点回收站
    const { user: user2, menu: menu2 } = await openMenu();
    await user2.click(within(menu2).getByRole("menuitem", { name: "回收站" }));
    expect(onOpenTrash).toHaveBeenCalledTimes(1);
  });

  it("「设置」与「退出登录」都走回调", async () => {
    const { onOpenSettings, onLogout } = renderMenu();
    const { user, menu } = await openMenu();

    await user.click(within(menu).getByRole("menuitem", { name: "设置" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    const { user: user2, menu: menu2 } = await openMenu();
    await user2.click(within(menu2).getByRole("menuitem", { name: "退出登录" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("快捷菜单候选清单始终是 5 个（设置页与菜单同一份数据）", () => {
    expect(QUICK_MENU_FEATURES.map((feature) => feature.id)).toEqual([
      "theme",
      "lock",
      "search",
      "trash",
      "backup",
    ]);
  });
});
