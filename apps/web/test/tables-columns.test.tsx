// @vitest-environment jsdom
/**
 * 列定义面板（M4-9；《M4 界面稿》§三）。
 *
 * 要点：新建时**不可点遮罩关闭**（Esc 仍等于取消）、默认已有「名称（文字）」一列、
 * 重名提示、改类型的解析失败汇总、删除列确认框（写明后果与可恢复性）、
 * 只剩 `_id` 时「确定」禁用并说明原因。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROW_ID_COLUMN, type TableDoc } from "@menote/mdcore";
import { TableColumnManager } from "../src/features/tables/ui/TableColumnManager";

afterEach(cleanup);

function doc(overrides: Partial<TableDoc> = {}): TableDoc {
  return {
    columns: [
      { id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true },
      { id: "c1", name: "名称", type: "text" },
    ],
    rowIdColumn: ROW_ID_COLUMN,
    views: { default: "table" },
    rows: [
      { [ROW_ID_COLUMN]: "aaa111", c1: "甲" },
      { [ROW_ID_COLUMN]: "bbb222", c1: "乙" },
    ],
    attachments: [],
    notices: [],
    preservedLines: [],
    tags: [],
    foreignLines: [],
    ...overrides,
  };
}

function renderPanel(overrides: Partial<Parameters<typeof TableColumnManager>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <TableColumnManager
      open
      mode="edit"
      doc={doc()}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onConfirm, onCancel };
}

describe("列清单", () => {
  it("列出数据列（不含 `_id`）与 `_id` 固定行；十种类型都可选", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog", { name: "列设置" });
    expect(within(dialog).getByLabelText("第 1 列的名称")).toBeTruthy();
    expect(within(dialog).getByText("_id")).toBeTruthy();
    expect(within(dialog).getByText("稳定行 ID（6–8 位）")).toBeTruthy();

    const radios = within(dialog).getAllByRole("radio");
    expect(radios).toHaveLength(10);
    // 每个类型带一行说明（不是只给名字）
    expect(within(dialog).getByText(/单元格只写文件名/)).toBeTruthy();
  });

  it("重命名即时生效；重名给可见提示（允许重名，用列 ID 定位）", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderPanel();

    const nameInput = screen.getByLabelText("第 1 列的名称");
    await user.clear(nameInput);
    await user.type(nameInput, "同名");

    const addButton = screen.getAllByRole("button", { name: /添加一列/ })[0] as HTMLElement;
    await user.click(addButton);
    const second = screen.getByLabelText("第 2 列的名称");
    await user.clear(second);
    await user.type(second, "同名");

    expect(screen.getByText(/已有同名列/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "确定" }));
    const next = onConfirm.mock.calls[0]?.[0] as TableDoc;
    expect(next.columns.map((column) => column.name)).toEqual(["ID", "同名", "同名"]);
  });

  it("添加一列：默认名「列 N」+ 文字类型，插在末列右侧", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderPanel();

    await user.click(screen.getAllByRole("button", { name: /添加一列/ })[0] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "确定" }));

    const next = onConfirm.mock.calls[0]?.[0] as TableDoc;
    expect(next.columns.map((column) => column.id)).toEqual([ROW_ID_COLUMN, "c1", "c2"]);
    expect(next.columns.at(-1)).toMatchObject({ name: "列 2", type: "text" });
  });

  it("左移 / 右移调序（键盘可达的等价入口）", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderPanel();

    await user.click(screen.getAllByRole("button", { name: /添加一列/ })[0] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "「列 2」左移" }));
    await user.click(screen.getByRole("button", { name: "确定" }));

    const next = onConfirm.mock.calls[0]?.[0] as TableDoc;
    expect(next.columns.map((column) => column.name)).toEqual(["ID", "列 2", "名称"]);
  });
});

describe("类型选择", () => {
  it("单选组改的是**选中的那一列**；改类型不动单元格文本", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderPanel();

    await user.click(screen.getByRole("radio", { name: /纯数字/ }));
    await user.click(screen.getByRole("button", { name: "确定" }));

    const next = onConfirm.mock.calls[0]?.[0] as TableDoc;
    expect(next.columns[1]?.type).toBe("number");
    // 文本一字未动（读宽容：解析不了显示原文）
    expect(next.rows.map((row) => row.c1)).toEqual(["甲", "乙"]);
  });

  it("按新类型解析不了时给可见汇总", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("radio", { name: /纯数字/ }));
    expect(screen.getByText("2 个单元格无法按新类型解析，已保留原文")).toBeTruthy();
  });
});

describe("删除列与空状态", () => {
  it("删除列要确认，确认框写明「将被移除」与「可在版本历史中找回」", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderPanel();

    // 先加一列（只删到剩 0 列时「确定」会被禁用，那是另一条用例的事）
    await user.click(screen.getAllByRole("button", { name: /添加一列/ })[0] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "删除列「名称」" }));
    const confirm = screen.getByRole("dialog", { name: "删除列" });
    expect(within(confirm).getByText(/此列在所有行里的数据将被移除/)).toBeTruthy();
    expect(within(confirm).getByText(/可在版本历史中找回/)).toBeTruthy();

    await user.click(within(confirm).getByRole("button", { name: "删除这一列" }));
    await user.click(screen.getByRole("button", { name: "确定" }));

    const next = onConfirm.mock.calls[0]?.[0] as TableDoc;
    expect(next.columns.map((column) => column.id)).toEqual([ROW_ID_COLUMN, "c2"]);
    // 数据也跟着那一列一起没了
    expect(next.rows[0]).not.toHaveProperty("c1");
  });

  it("只剩 `_id` 时给空状态，「确定」禁用并说明原因", async () => {
    const user = userEvent.setup();
    renderPanel({
      doc: doc({
        columns: [{ id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true }],
      }),
    });

    expect(screen.getByText("至少需要一列数据列")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "确定" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(confirm.getAttribute("title")).toBe("至少需要一列数据列");

    // 出口可用
    await user.click(screen.getAllByRole("button", { name: /添加一列/ })[0] as HTMLElement);
    expect(screen.queryByText("至少需要一列数据列")).toBeNull();
    expect((screen.getByRole("button", { name: "确定" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("开关与容器行为", () => {
  it("`_id` 行的「显示此列」开关改的是 hidden", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderPanel();

    await user.click(screen.getByRole("checkbox", { name: "显示此列" }));
    await user.click(screen.getByRole("button", { name: "确定" }));

    const next = onConfirm.mock.calls[0]?.[0] as TableDoc;
    expect(next.columns[0]?.hidden).toBe(false);
  });

  it("编辑态可点遮罩关闭；新建态**不可**（Esc 仍等于取消）", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderPanel({ mode: "edit" });
    await user.click(document.querySelector(".overlay") as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(1);

    cleanup();
    const creating = renderPanel({ mode: "create" });
    expect(screen.getByRole("dialog", { name: "定义列结构" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建表格" })).toBeTruthy();

    await user.click(document.querySelector(".overlay") as HTMLElement);
    expect(creating.onCancel).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(creating.onCancel).toHaveBeenCalledTimes(1);
  });

  it("新建态默认已有一列「名称（文字）」", () => {
    renderPanel({ mode: "create" });
    expect((screen.getByLabelText("第 1 列的名称") as HTMLInputElement).value).toBe("名称");
    expect((screen.getByRole("radio", { name: /文字/ }) as HTMLInputElement).checked).toBe(true);
  });
});
