// @vitest-environment jsdom
/**
 * 正文格式工具栏（编辑器专项优化 P1）。
 *
 * 工具栏**只做呈现与转发**：不认识 CodeMirror、不拼 Markdown——所以这里只钉交互契约：
 * 每个按钮把正确的命令 id 交回 `onCommand`、标题菜单能把级别交回去、禁用态整体不响应
 * 且给得出原因（DESIGN §6.1：禁用必须说明）。
 *
 * 键位提示进 `title`（DESIGN §6.3 规则 3）：加粗按钮的 title 里应出现 `Ctrl+B`（jsdom 的
 * userAgent 不是 macOS，走 `Ctrl+` 写法）。
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorToolbar } from "../src/app/editor/EditorToolbar";

afterEach(cleanup);

function setup(overrides: Partial<Parameters<typeof EditorToolbar>[0]> = {}) {
  const onCommand = vi.fn();
  const onFind = vi.fn();
  render(<EditorToolbar onCommand={onCommand} onFind={onFind} {...overrides} />);
  return { onCommand };
}

describe("工具栏：按钮转发命令", () => {
  it("每枚按钮的 title 带键位提示（DESIGN §6.3 规则 3）", () => {
    setup();
    expect(screen.getByTitle("加粗（Ctrl+B）")).toBeTruthy();
    expect(screen.getByTitle("斜体（Ctrl+I）")).toBeTruthy();
    expect(screen.getByTitle("行内代码（Ctrl+E）")).toBeTruthy();
    expect(screen.getByTitle("删除线（Ctrl+Shift+X）")).toBeTruthy();
  });

  it("点击按钮把命令 id 交回 onCommand（无参数命令只传 id）", () => {
    const { onCommand } = setup();
    fireEvent.click(screen.getByTitle("加粗（Ctrl+B）"));
    expect(onCommand).toHaveBeenCalledWith("bold");
    fireEvent.click(screen.getByTitle("任务清单（Ctrl+Shift+9）"));
    expect(onCommand).toHaveBeenCalledWith("task-list");
    fireEvent.click(screen.getByTitle("代码块"));
    expect(onCommand).toHaveBeenCalledWith("code-block");
  });

  it("标题菜单能选出级别：正文 / H1–H6 都带 headingLevel", async () => {
    const { onCommand } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "标题样式" }));
    const menu = screen.getByRole("menu", { name: "标题样式" });
    await user.click(within(menu).getByText("正文"));
    expect(onCommand).toHaveBeenCalledWith("heading", { headingLevel: 0 });
    await user.click(screen.getByRole("button", { name: "标题样式" }));
    await user.click(within(screen.getByRole("menu", { name: "标题样式" })).getByText("### 标题 3"));
    expect(onCommand).toHaveBeenCalledWith("heading", { headingLevel: 3 });
  });
});

describe("工具栏：禁用态（DESIGN §6.1：禁用必须说明原因）", () => {
  it("整条 aria-disabled，按钮禁用且 title 说明原因，点了不发命令", () => {
    const { onCommand } = setup({ disabled: true, disabledReason: "解锁后才能编辑正文" });
    const bar = screen.getByRole("toolbar", { name: "格式" });
    expect(bar.getAttribute("aria-disabled")).toBe("true");
    const bold = screen.getByLabelText("加粗") as HTMLButtonElement;
    expect(bold.disabled).toBe(true);
    expect(bold.title).toBe("解锁后才能编辑正文");
    fireEvent.click(bold);
    expect(onCommand).not.toHaveBeenCalled();
  });
});
