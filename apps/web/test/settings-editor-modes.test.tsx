// @vitest-environment jsdom
/**
 * 设置 › 通用 › 编辑体验：编辑模式开关组（用户 2026-09-29 拍板"改成可开关显示的，至少留一个"；
 * 同日编辑拓展阶段 A 把产品清单收敛为**仅编辑 / 仅预览**，阶段 C 用户验收即时渲染后扩成三档）。
 *
 * **【v0.8.4】这张卡从「编辑器」分类搬进了「通用」页**（见 `docs/modules/Menote-M8-设置页信息架构-v1.md` §2.1），
 * 所以下面所有渲染都从 `page="general"` 进。行为契约一条没变：开关组的取值与顺序来自
 * `PRODUCT_EDITOR_MODES`（界面不另写一份清单）、老行里存着的 `split` 既不显示也不会被写回、
 * "至少留一档"是禁用 + 原因平铺、只剩"已退出产品的档"这种老行也不能出现"几档都关、点一下就全开"的怪状态。
 *
 * 为什么从 `ui.test.tsx` 拆出来：那边是"设置壳"的逐屏验收，本文件只钉**编辑模式这一张卡**的契约面。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_SETTINGS, PRODUCT_EDITOR_MODES } from "@menote/shared";
import type * as React from "react";
import { SettingsPanel } from "../src/features/settings/ui/SettingsPanel";

afterEach(cleanup);

const baseProps = {
  role: "owner" as const,
  themeMode: "light" as const,
  onThemeMode: vi.fn(),
  userSettings: DEFAULT_USER_SETTINGS,
  onPatchSettings: vi.fn(),
  registrationOpen: false,
  registrationCloseAt: 0,
  onChangeRegistration: vi.fn(async () => undefined),
  onChangePassword: vi.fn(async () => undefined),
  onLogout: vi.fn(),
  onNavigate: vi.fn(),
};

/**
 * 渲染「通用」页并**只返回「编辑体验」那张卡**。
 *
 * 【v0.8.4】这张卡搬进「通用」后，页面上**还有「账户快捷菜单」那张卡的 5 个开关**——
 * 所以旧用例里那个 `getAllByRole("switch")` 的全页计数会从 3 变 8。
 * 这不是产品行为变了，是**测试的作用域**没跟着搬家：断言"开关组有几档"必须限定在那张卡内，
 * 否则同页新增任何开关都会让这条用例莫名失败（它本来就不该关心菜单有几个开关）。
 */
function renderEditorModesCard(props: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  render(<SettingsPanel {...baseProps} page="general" {...props} />);
  const card = screen.getByRole("region", { name: "编辑体验" });
  return within(card);
}

describe("设置 › 通用 › 编辑体验：编辑模式开关组", () => {
  it("产品清单变了，开关组跟着变（界面不另写一份清单）", () => {
    const card = renderEditorModesCard();

    expect(PRODUCT_EDITOR_MODES).toEqual(["edit", "preview", "live"]);
    expect(card.getAllByRole("switch")).toHaveLength(PRODUCT_EDITOR_MODES.length);
  });

  it("开关组只列产品档；三档都在时都能关，关掉「仅预览」写回 ['edit', 'live']", async () => {
    const user = userEvent.setup();
    const onPatchSettings = vi.fn();

    const card = renderEditorModesCard({ onPatchSettings });

    // 单选组退场：不再有"默认编辑模式"这一说（默认档概念整体去掉了）
    expect(card.queryByRole("group", { name: "默认编辑模式" })).toBeNull();

    for (const mode of ["仅编辑", "仅预览", "即时渲染"]) {
      const control = card.getByRole("switch", { name: mode });
      expect(control.getAttribute("aria-checked"), mode).toBe("true");
      expect((control as HTMLButtonElement).disabled, mode).toBe(false);
    }
    // 双栏仍留在产品外，设置里不该再有它的开关
    expect(card.queryByRole("switch", { name: "双栏" })).toBeNull();

    // 关掉「仅预览」：交回去的是**过滤后的数组**，顺序按契约的规范顺序（不随点击次序漂）
    await user.click(card.getByRole("switch", { name: "仅预览" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ editor_modes: ["edit", "live"] });
  });

  it("老行里存着四档时，开关按**产品档**显示，写回也不带老值", async () => {
    const user = userEvent.setup();
    const onPatchSettings = vi.fn();

    const card = renderEditorModesCard({
      userSettings: {
        ...DEFAULT_USER_SETTINGS,
        editor_modes: ["split", "edit", "preview", "live"],
      },
      onPatchSettings,
    });

    expect(card.getAllByRole("switch")).toHaveLength(3);
    expect(card.queryByRole("switch", { name: "双栏" })).toBeNull();

    await user.click(card.getByRole("switch", { name: "仅预览" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ editor_modes: ["edit", "live"] });
  });

  it("只剩一档时，最后那个开关禁用且**原因平铺可见**（DESIGN.md §6.1）", () => {
    const card = renderEditorModesCard({
      userSettings: { ...DEFAULT_USER_SETTINGS, editor_modes: ["edit"] },
    });

    const last = card.getByRole("switch", { name: "仅编辑" }) as HTMLButtonElement;
    expect(last.disabled).toBe(true);
    // 原因必须看得见（不是只挂在 title 上）
    expect(card.getByText(/至少保留一个模式/)).toBeTruthy();

    // 另外两档是关着的、而且可以重新打开
    for (const mode of ["仅预览", "即时渲染"]) {
      const off = card.getByRole("switch", { name: mode }) as HTMLButtonElement;
      expect(off.getAttribute("aria-checked"), mode).toBe("false");
      expect(off.disabled, mode).toBe(false);
    }
  });

  it("老行只开着已退出的档（split）时，不出现「几档都关却一点就全开」的怪状态", () => {
    const card = renderEditorModesCard({
      userSettings: { ...DEFAULT_USER_SETTINGS, editor_modes: ["split"] },
    });

    // 归一化后落到产品全集：三档都显示为开（此时"最后一个不许关"不适用——不是只剩一档）
    for (const mode of ["仅编辑", "仅预览", "即时渲染"]) {
      const control = card.getByRole("switch", { name: mode }) as HTMLButtonElement;
      expect(control.getAttribute("aria-checked"), mode).toBe("true");
      expect(control.disabled, mode).toBe(false);
    }
  });
});
