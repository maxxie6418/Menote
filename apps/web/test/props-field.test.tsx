// @vitest-environment jsdom
/**
 * 属性库的两件界面件（2026-10-11，《MeNote 属性库设计 v1》v2.1 §6.1）。
 *
 * 1. **值控件按类型给，但值不认识就回落纯文本**——`date` 控件拿到 `2026/10/11` 会把它显示成空、
 *    失焦再写回空值，那是**抹数据**，比控件不顺手严重得多，所以 `controlFor` 逐条钉住；
 * 2. **只在真的改过时才交回**：交回一次意味着"这一行重写一次"、还被算作"用户动过"（设计 §6.4），
 *    点进来又点出去不该留痕。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemProps } from "../src/features/notes/ui/ItemProps";
import { PropValueField, controlFor } from "../src/features/props/ui/PropValueField";
import type { PropLibraryEntry, PropType } from "../src/features/props/model";

afterEach(cleanup);

function entry(key: string, type: PropType, values: string[] = []): PropLibraryEntry {
  return { key, builtin: false, type, values };
}

describe("controlFor：类型给控件，值不认识就回落", () => {
  it("未入库（没有定义）按原形状给框", () => {
    expect(controlFor(undefined, "https://x", false)).toBe("text");
    expect(controlFor(undefined, '  - "Unknown"', true)).toBe("multiline");
  });

  it("date / number / boolean：形状对的才给类型控件，空值也给", () => {
    expect(controlFor(entry("d", "date"), "2026-10-11", false)).toBe("date");
    expect(controlFor(entry("d", "date"), "", false)).toBe("date");
    // 认不出的值 → 回落：交给 date 控件会被清空
    expect(controlFor(entry("d", "date"), "2026/10/11", false)).toBe("text");
    expect(controlFor(entry("n", "number"), "-12.5", false)).toBe("number");
    expect(controlFor(entry("n", "number"), "十二", false)).toBe("text");
    expect(controlFor(entry("b", "boolean"), "true", false)).toBe("boolean");
    expect(controlFor(entry("b", "boolean"), "是", false)).toBe("text");
  });

  it("choice 没有候选时回落（空下拉会把值藏起来）", () => {
    expect(controlFor(entry("c", "choice", ["a", "b"]), "a", false)).toBe("choice");
    expect(controlFor(entry("c", "choice"), "a", false)).toBe("text");
  });

  it("声明成 text 却长着子行 → 仍给多行框（形状是用户的，类型只是建议）", () => {
    expect(controlFor(entry("t", "text"), "  - a", true)).toBe("multiline");
    expect(controlFor(entry("m", "multiline"), "a", false)).toBe("multiline");
  });
});

describe("PropValueField", () => {
  it("值真的变了才交回；同值失焦什么都不发生", () => {
    const onCommit = vi.fn();
    render(
      <PropValueField propKey="url" value="a" block={false} disabled={false} onCommit={onCommit} />,
    );
    const input = screen.getByLabelText("url 的值") as HTMLInputElement;

    fireEvent.blur(input, { target: { value: "a" } });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.blur(input, { target: { value: "b" } });
    expect(onCommit).toHaveBeenCalledWith("b", false);
  });

  it("多行框交回时把 block 报成 true（形状变化是有意的）", () => {
    const onCommit = vi.fn();
    render(
      <PropValueField propKey="author" value={"- a"} block disabled={false} onCommit={onCommit} />,
    );
    const textarea = screen.getByLabelText("author 的值") as HTMLTextAreaElement;
    expect(textarea.tagName).toBe("TEXTAREA");
    fireEvent.blur(textarea, { target: { value: "- a\n- b" } });
    expect(onCommit).toHaveBeenCalledWith("- a\n- b", true);
  });

  it("只读时给的是只读框 + 为什么（不隐藏，用户要知道值还在）", () => {
    render(
      <PropValueField
        propKey="url"
        value="a"
        block={false}
        disabled
        readOnlyReason="切到「仅编辑」才能改属性"
        onCommit={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("url 的值") as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute("title")).toBe("切到「仅编辑」才能改属性");
  });

  it("候选值挂在纯文本框上（datalist）；类型控件不挂", () => {
    render(
      <PropValueField
        propKey="url"
        entry={entry("url", "text", ["https://a", "https://b"])}
        value="https://c"
        block={false}
        disabled={false}
        onCommit={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("url 的值") as HTMLInputElement;
    expect(input.getAttribute("list")).toBe("propcand-url");
    expect(document.querySelectorAll("#propcand-url option")).toHaveLength(2);
  });

  it("choice：当前值不在候选里也把它列出来（否则下拉显示成空、像丢了）", () => {
    render(
      <PropValueField
        propKey="shelf"
        entry={entry("shelf", "choice", ["a", "b"])}
        value="z"
        block={false}
        disabled={false}
        onCommit={vi.fn()}
      />,
    );
    const select = screen.getByLabelText("shelf 的值") as HTMLSelectElement;
    expect(select.value).toBe("z");
    expect([...select.options].map((one) => one.value)).toEqual(["z", "a", "b"]);
    // 空值才有「未设置」占位
    cleanup();
    render(
      <PropValueField
        propKey="shelf"
        entry={entry("shelf", "choice", ["a"])}
        value=""
        block={false}
        disabled={false}
        onCommit={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("shelf 的值") as HTMLSelectElement).options[0]?.text).toBe("未设置");
  });
});

describe("「+ 用一个属性」菜单（前台的唯一入口，设计 §6.1）", () => {
  const noop = {
    onTagsChange: () => undefined,
    onTaskChange: () => undefined,
    onForeignChange: () => undefined,
    onForeignRemove: () => undefined,
    onForeignAdd: () => undefined,
  };
  const BODY = "---\ntitle: T\nurl: a\n---\n\n正文";

  it("只列库里**还没用到**的键，末尾是「新建键…」", async () => {
    const user = userEvent.setup();
    render(
      <ItemProps
        body={BODY}
        editable
        {...noop}
        library={[entry("url", "text"), entry("source", "date")]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "用一个属性" }));
    const menu = screen.getByRole("menu", { name: "用一个属性" });
    // `url` 这一篇已经在用了，点它不会有任何变化，所以不列
    expect(menu.textContent).toContain("source · 日期");
    expect(menu.textContent).not.toContain("url · 单行文本");
    expect(menu.textContent).toContain("新建键…");
  });

  it("选中库里的键 → 只把它写进这一篇（空值），库不动", async () => {
    const user = userEvent.setup();
    const onForeignAdd = vi.fn();
    const onLibraryChange = vi.fn();
    render(
      <ItemProps
        body={BODY}
        editable
        {...noop}
        onForeignAdd={onForeignAdd}
        onLibraryChange={onLibraryChange}
        library={[entry("source", "date")]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "用一个属性" }));
    await user.click(screen.getByRole("menuitem", { name: "source · 日期" }));
    expect(onForeignAdd).toHaveBeenCalledWith("source", "");
    expect(onLibraryChange).not.toHaveBeenCalled();
  });

  it("「新建键…」→ 问键名、进库、写进这一篇", async () => {
    const user = userEvent.setup();
    const onForeignAdd = vi.fn();
    const onLibraryChange = vi.fn();
    vi.spyOn(window, "prompt").mockReturnValue("source");
    render(
      <ItemProps
        body={BODY}
        editable
        {...noop}
        onForeignAdd={onForeignAdd}
        onLibraryChange={onLibraryChange}
        library={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "用一个属性" }));
    await user.click(screen.getByRole("menuitem", { name: "新建键…" }));
    expect(onForeignAdd).toHaveBeenCalledWith("source", "");
    expect(onLibraryChange).toHaveBeenCalledWith([entry("source", "text")]);
  });

  it("键名不合法 / 是保留键 → 报错且什么也不写", async () => {
    const user = userEvent.setup();
    const onForeignAdd = vi.fn();
    const onLibraryChange = vi.fn();
    const onError = vi.fn();
    vi.spyOn(window, "prompt").mockReturnValue("a b");
    render(
      <ItemProps
        body={BODY}
        editable
        {...noop}
        onForeignAdd={onForeignAdd}
        onLibraryChange={onLibraryChange}
        onError={onError}
        library={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "用一个属性" }));
    await user.click(screen.getByRole("menuitem", { name: "新建键…" }));
    expect(onError).toHaveBeenCalled();
    expect(onForeignAdd).not.toHaveBeenCalled();
    expect(onLibraryChange).not.toHaveBeenCalled();
  });
});
