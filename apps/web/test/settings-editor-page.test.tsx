// @vitest-environment jsdom
/**
 * 设置 › 编辑设置：排版三项与六级标题样式的写入契约（v0.8.40）。
 *
 * 这里只钉**写出去的那份值**——值是账号级的、落在 `user_settings.editor_typography`，
 * 界面表现交给 `ui.test.tsx`、CSS 变量口径交给 `editor-typography.test.ts`。
 *
 * 为什么单开一个文件：`headings` 是一层**嵌套**映射，合并写错一次（拿旧 headings 盖新值）
 * 会让三个标题控件改完立刻弹回"跟随"，而组件本身照常渲染、控制台一声不响——
 * 这条用例就是那次真机验收抓到的 bug 的钉子。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_SETTINGS } from "@menote/shared";
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

function renderPage(onPatchSettings = vi.fn()) {
  render(<SettingsPanel {...baseProps} page="editor" onPatchSettings={onPatchSettings} />);
  return onPatchSettings;
}

describe("设置 › 编辑设置 › 正文排版", () => {
  it("正文字号写进 editor_typography；清空 = 跟随主题（键消失）", async () => {
    const user = userEvent.setup();
    const onPatch = renderPage();
    const input = screen.getByRole("textbox", { name: "正文字号" });

    await user.type(input, "18");
    expect(onPatch).toHaveBeenLastCalledWith({ editor_typography: { font_size: 18 } });

    await user.clear(input);
    expect(onPatch).toHaveBeenLastCalledWith({ editor_typography: {} });
  });

  it("越界不写（8 / 99 都超出 11–24），就地给出可见区间提示", async () => {
    const user = userEvent.setup();
    const onPatch = renderPage();
    const input = screen.getByRole("textbox", { name: "正文字号" });

    await user.type(input, "99");
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("11–24");
  });

  it("字体与纸面宽度同一条路（字体是枚举，纸面宽度带区间）", async () => {
    const user = userEvent.setup();
    const onPatch = renderPage();

    await user.selectOptions(screen.getByRole("combobox", { name: "字体" }), "mono");
    expect(onPatch).toHaveBeenLastCalledWith({ editor_typography: { font_family: "mono" } });

    await user.type(screen.getByRole("textbox", { name: "纸面宽度" }), "880");
    expect(onPatch).toHaveBeenLastCalledWith({ editor_typography: { paper_width: 880 } });
  });
});

describe("设置 › 编辑设置 › 标题样式", () => {
  it("改一级标题字号：headings 是**合并**写，不会被旧值盖回去（v0.8.40 真机抓到的 bug）", async () => {
    const onPatch = renderPage();
    // 一次 change 交上整份值：数字框是"每次按键都可能写一次"的，逐键输入在这里只会
    // 钉住"最后一键"，与本条要验的合并语义无关
    fireEvent.change(screen.getByRole("textbox", { name: "一级标题字号" }), {
      target: { value: "28" },
    });
    expect(onPatch).toHaveBeenLastCalledWith({
      editor_typography: { headings: { h1: { size: 28 } } },
    });
  });

  it("改二级标题粗细：既有的一级设置要保住", async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    render(
      <SettingsPanel
        {...baseProps}
        page="editor"
        userSettings={{
          ...DEFAULT_USER_SETTINGS,
          editor_typography: { headings: { h1: { size: 28 } } },
        }}
        onPatchSettings={onPatch}
      />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "二级标题粗细" }), "500");
    expect(onPatch).toHaveBeenLastCalledWith({
      editor_typography: { headings: { h1: { size: 28 }, h2: { weight: 500 } } },
    });
  });

  it("清空某一项后该级回到「跟随主题」；六级全清则 headings 键整个消失", async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    render(
      <SettingsPanel
        {...baseProps}
        page="editor"
        userSettings={{
          ...DEFAULT_USER_SETTINGS,
          editor_typography: { headings: { h3: { weight: 600 } } },
        }}
        onPatchSettings={onPatch}
      />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "三级标题粗细" }), "");
    expect(onPatch).toHaveBeenLastCalledWith({ editor_typography: {} });
  });
});
