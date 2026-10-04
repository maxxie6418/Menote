// @vitest-environment jsdom
/**
 * 表格视图（M4-9 界面）。
 *
 * 用例对着《M4 界面稿》§二/§2.8 的可验收条目写：可见/禁用要**带原因**、编辑要能提交与取消、
 * 实时计数与上限提示**必须可见**、筛排"关闭即重置"。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROW_ID_COLUMN, type TableDoc } from "@menote/mdcore";
import { TableEditor } from "../src/features/tables/ui/TableEditor";

afterEach(cleanup);

function doc(overrides: Partial<TableDoc> = {}): TableDoc {
  return {
    columns: [
      { id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true },
      { id: "c1", name: "名称", type: "text" },
      { id: "c2", name: "数量", type: "number" },
      { id: "c3", name: "完成", type: "checkbox" },
      { id: "c4", name: "状态", type: "status", options: ["todo", "doing", "done"] },
    ],
    rowIdColumn: ROW_ID_COLUMN,
    views: { default: "table" },
    rows: [
      { [ROW_ID_COLUMN]: "aaa111", c1: "甲", c2: "10", c3: "", c4: "todo" },
      { [ROW_ID_COLUMN]: "bbb222", c1: "乙", c2: "9", c3: "true", c4: "done" },
    ],
    attachments: [],
    notices: [],
    preservedLines: [],
    tags: [],
    foreignLines: [],
    ...overrides,
  };
}

function renderEditor(overrides: Partial<Parameters<typeof TableEditor>[0]> = {}) {
  const onDocChange = vi.fn();
  const onRequestDegrade = vi.fn();
  render(
    <TableEditor
      title="我的表格"
      doc={doc()}
      onDocChange={onDocChange}
      onRequestDegrade={onRequestDegrade}
      {...overrides}
    />,
  );
  return { onDocChange, onRequestDegrade };
}

describe("表格区", () => {
  it("表头显示列名与列类型文字；`_id` 列默认隐藏", () => {
    renderEditor();
    const headers = [...document.querySelectorAll(".tablegrid__th-name")].map((el) => el.textContent);
    expect(headers).toEqual(["名称", "数量", "完成", "状态"]);
    // 类型以文字呈现（图标不可单独表意）
    expect(screen.getAllByTitle("列类型：文字").length).toBeGreaterThan(0);
    expect(screen.getByTitle("列类型：状态")).toBeTruthy();
  });

  it("点格就地编辑：Enter 提交、Esc 取消", async () => {
    const user = userEvent.setup();
    const { onDocChange } = renderEditor();

    await user.click(screen.getByRole("button", { name: "名称：甲" }));
    const input = screen.getByLabelText("名称（编辑）");
    await user.clear(input);
    await user.type(input, "改过的{Enter}");

    const next = onDocChange.mock.calls[0]?.[0] as TableDoc;
    expect(next.rows[0]?.c1).toBe("改过的");
    expect(next.rows[1]?.c1).toBe("乙");
  });

  it("Esc 取消编辑，不改数据", async () => {
    const user = userEvent.setup();
    const { onDocChange } = renderEditor();

    await user.click(screen.getByRole("button", { name: "名称：甲" }));
    await user.type(screen.getByLabelText("名称（编辑）"), "不要保存{Escape}");
    expect(onDocChange).not.toHaveBeenCalled();
  });

  it("复选列单击即改（无需进入编辑态）", async () => {
    const user = userEvent.setup();
    const { onDocChange } = renderEditor();

    await user.click(screen.getByRole("checkbox", { name: "完成：未勾选" }));
    const next = onDocChange.mock.calls[0]?.[0] as TableDoc;
    expect(next.rows[0]?.c3).toBe("true");
  });

  it("状态列走菜单选一项", async () => {
    const user = userEvent.setup();
    const { onDocChange } = renderEditor();

    // 两行都有这个菜单 → 取第一行那个
    await user.click(screen.getAllByRole("button", { name: "状态：选择值" })[0] as HTMLElement);
    await user.click(screen.getByRole("menuitem", { name: "doing" }));

    const next = onDocChange.mock.calls[0]?.[0] as TableDoc;
    expect(next.rows[0]?.c4).toBe("doing");
  });

  it("行菜单：在上方插入 / 删除此行 / 上移一行", async () => {
    const user = userEvent.setup();
    const { onDocChange } = renderEditor();

    const menus = screen.getAllByRole("button", { name: "行操作" });
    await user.click(menus[0] as HTMLElement);
    await user.click(screen.getByRole("menuitem", { name: "在上方插入" }));
    const inserted = onDocChange.mock.calls[0]?.[0] as TableDoc;
    expect(inserted.rows).toHaveLength(3);
    expect(inserted.rows[0]?.[ROW_ID_COLUMN]).not.toBe("aaa111");

    onDocChange.mockClear();
    await user.click(menus[1] as HTMLElement);
    await user.click(screen.getByRole("menuitem", { name: "删除此行" }));
    const removed = onDocChange.mock.calls[0]?.[0] as TableDoc;
    expect(removed.rows.map((row) => row[ROW_ID_COLUMN])).toEqual(["aaa111"]);

    onDocChange.mockClear();
    await user.click(menus[1] as HTMLElement);
    await user.click(screen.getByRole("menuitem", { name: "上移一行" }));
    const moved = onDocChange.mock.calls[0]?.[0] as TableDoc;
    expect(moved.rows.map((row) => row.c1)).toEqual(["乙", "甲"]);
  });

  it("一行都没有时给空状态与出口（同屏只有一个「新增行」）", async () => {
    const user = userEvent.setup();
    const { onDocChange } = renderEditor({ doc: doc({ rows: [] }) });

    expect(screen.getByText("这张表还没有内容")).toBeTruthy();
    // 空态出现时工具栏的「新增行」让位给空态按钮（界面稿 §2.8）
    const addButtons = screen.getAllByRole("button", { name: /新增行/ });
    expect(addButtons).toHaveLength(1);

    await user.click(addButtons[0] as HTMLElement);
    const next = onDocChange.mock.calls[0]?.[0] as TableDoc;
    expect(next.rows).toHaveLength(1);
  });
});

describe("工具栏与筛选条", () => {
  it("没有图片列时图册置灰、说明可见、并给出「添加图片列」出口（打开列设置）", async () => {
    const user = userEvent.setup();
    renderEditor();

    const gallery = screen.getByRole("button", { name: /图册/ }) as HTMLButtonElement;
    expect(gallery.disabled).toBe(true);
    expect(gallery.getAttribute("title")).toContain("添加图片列");
    expect(screen.getByText(/添加图片列后可使用图册/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "添加图片列" }));
    expect(screen.getByRole("dialog", { name: "列设置" })).toBeTruthy();
  });

  it("筛选条：加条件后实时计数可见；清除全部；收起即重置", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "筛选与排序" }));
    await user.click(screen.getByRole("button", { name: "加一条条件" }));

    // 默认条件：第一个**可见**列（名称）+ 包含 + 空值 → 空值不过滤，仍是全量
    expect(screen.getByText("筛选后 2 / 2 行")).toBeTruthy();

    const valueInput = screen.getByLabelText("第 1 个条件的值");
    await user.type(valueInput, "甲");
    expect(screen.getByText("筛选后 1 / 2 行")).toBeTruthy();
    // 表体确实只剩一行
    const rows = [...document.querySelectorAll(".tablegrid__tr")];
    expect(rows).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "清除全部" }));
    // 清空后不再"筛选中"：行回到两条，计数条随之收起（它只在生效时出现）
    expect(document.querySelectorAll(".tablegrid__tr")).toHaveLength(2);
    expect(screen.queryByText(/筛选后/)).toBeNull();

    // 收起 → 筛排清零（关闭即重置）
    await user.click(screen.getByRole("button", { name: "筛选与排序" }));
    expect(screen.queryByLabelText("第 1 个条件的值")).toBeNull();
  });

  it("没有条件时「清除全部」禁用并说明原因", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "筛选与排序" }));
    const clear = screen.getByRole("button", { name: "清除全部" }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
    expect(clear.getAttribute("title")).toBe("还没有筛选条件");
  });
});

describe("图册档位", () => {
  function withImage(): TableDoc {
    return doc({
      columns: [
        { id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true },
        { id: "c1", name: "名称", type: "text" },
        { id: "c9", name: "封面", type: "image" },
      ],
      rows: [
        { [ROW_ID_COLUMN]: "aaa111", c1: "甲", c9: "a/u1/h1.t" },
        { [ROW_ID_COLUMN]: "bbb222", c1: "乙", c9: "" },
      ],
    });
  }

  it("有图片列时可切到图册；卡片带标题，点卡片打开行详情可编辑", async () => {
    const user = userEvent.setup();
    const onDocChange = vi.fn();
    render(
      <TableEditor
        doc={withImage()}
        onDocChange={onDocChange}
        onRequestDegrade={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /图册/ }));
    expect(screen.getByRole("button", { name: "打开行详情：甲" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "打开行详情：甲" }));
    const dialog = screen.getByRole("dialog");
    const field = within(dialog).getByLabelText("名称");
    await user.clear(field);
    await user.type(field, "改过的{Enter}");

    const next = onDocChange.mock.calls.at(-1)?.[0] as TableDoc;
    expect(next.rows[0]?.c1).toBe("改过的");
  });

  it("有图片列但一张图都没有 → 图册空状态 + 切回表格出口", async () => {
    const user = userEvent.setup();
    render(
      <TableEditor
        doc={doc({
          columns: [
            { id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true },
            { id: "c1", name: "名称", type: "text" },
            { id: "c9", name: "封面", type: "image" },
          ],
          rows: [{ [ROW_ID_COLUMN]: "aaa111", c1: "甲", c9: "" }],
        })}
        onDocChange={vi.fn()}
        onRequestDegrade={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /图册/ }));
    expect(screen.getByText("这张表还没有图片")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "切回表格视图" }));
    expect(screen.getByRole("grid", { name: "表格" })).toBeTruthy();
  });
});

describe("大小与提示", () => {
  it("状态栏常驻「N 行 · M 列」与大小标签", () => {
    renderEditor();
    expect(screen.getByText("2 行 · 5 列")).toBeTruthy();
    expect(screen.getByTitle("按正文实际字节数计算")).toBeTruthy();
  });

  it("列数超过 50 时提示可见但不拒绝保存", () => {
    const many: TableDoc = {
      ...doc(),
      columns: [
        { id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true },
        ...Array.from({ length: 51 }, (_, index) => ({
          id: `c${index + 1}`,
          name: `列${index + 1}`,
          type: "text" as const,
        })),
      ],
      rows: [{ [ROW_ID_COLUMN]: "aaa111", c1: "甲" }],
    };
    render(
      <TableEditor
        doc={many}
        onDocChange={vi.fn()}
        onRequestDegrade={vi.fn()}
      />,
    );
    expect(screen.getByText(/列数已超过 50/)).toBeTruthy();
  });

  it("硬上限时写明「本次改动未保存」并给出口", () => {
    const huge: TableDoc = {
      ...doc(),
      rows: [{ [ROW_ID_COLUMN]: "aaa111", c1: "字".repeat(700_000), c2: "1" }],
    };
    render(
      <TableEditor
        doc={huge}
        onDocChange={vi.fn()}
        onRequestDegrade={vi.fn()}
        onCopyRow={vi.fn()}
      />,
    );
    expect(screen.getByText("已达 1.9 MB 硬上限，本次改动未保存")).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制本行内容" })).toBeTruthy();
  });

  it("到硬上限时编辑被阻止（不提交改动）", async () => {
    const user = userEvent.setup();
    const onDocChange = vi.fn();
    const huge: TableDoc = {
      ...doc(),
      rows: [{ [ROW_ID_COLUMN]: "aaa111", c1: "字".repeat(700_000), c2: "1" }],
    };
    render(
      <TableEditor
        doc={huge}
        onDocChange={onDocChange}
        onRequestDegrade={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "完成：未勾选" }));
    // 提交的是**原文档**（等于没改），而不是超限的新文档
    expect(onDocChange.mock.calls[0]?.[0]).toEqual(huge);
  });
});

describe("更多菜单", () => {
  it("有「列设置…」与「降级为普通笔记」两个入口", async () => {
    const user = userEvent.setup();
    const { onRequestDegrade } = renderEditor();

    await user.click(screen.getByRole("button", { name: "表格的更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "列设置…" }));
    expect(screen.getByRole("dialog", { name: "列设置" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "表格的更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "降级为普通笔记" }));
    expect(onRequestDegrade).toHaveBeenCalledTimes(1);
  });
});
