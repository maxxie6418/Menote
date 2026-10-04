/**
 * 表格业务模型（M4-9；《M4 设计》§二、《M4 界面稿》§二/§三）。
 *
 * 编解码本身在 mdcore 的 `table.test.ts` 里测过，这里只测"界面视角的状态变换"：
 * 列/行的增删改、筛排、大小与提示、降级。
 */
import { describe, expect, it } from "vitest";
import { CELL_NOTICE_CHARS, COLUMN_NOTICE_COUNT, ROW_ID_COLUMN, type TableDoc } from "@menote/mdcore";
import {
  addColumn,
  addRow,
  blocksSave,
  cellValue,
  changeColumnType,
  changeColumnTypeWithReport,
  checkDegrade,
  duplicateColumnNames,
  filterRows,
  galleryAvailability,
  galleryCards,
  hasDataColumn,
  insertRow,
  isProtectedColumn,
  matchesFilter,
  moveColumn,
  moveRow,
  removeColumn,
  removeRow,
  renameColumn,
  reorderRow,
  setCell,
  setColumnOptions,
  sortRows,
  stripTableMeta,
  tableBytes,
  tableHints,
  tableSize,
  toggleColumnHidden,
  unparsableCount,
  visibleColumns,
  visibleRows,
  windowRange,
  VIRTUAL_ROW_THRESHOLD,
  type TableViewState,
} from "../src/features/tables/model";
import { renderTableDocument } from "@menote/mdcore";

function doc(overrides: Partial<TableDoc> = {}): TableDoc {
  return {
    columns: [
      { id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true },
      { id: "c1", name: "名称", type: "text" },
      { id: "c2", name: "数量", type: "number" },
    ],
    rowIdColumn: ROW_ID_COLUMN,
    views: { default: "table" },
    rows: [
      { [ROW_ID_COLUMN]: "aaa111", c1: "甲", c2: "10" },
      { [ROW_ID_COLUMN]: "bbb222", c1: "乙", c2: "9" },
    ],
    attachments: [],
    notices: [],
    preservedLines: [],
    tags: [],
    foreignLines: [],
    ...overrides,
  };
}

const sequence = (values: number[]) => {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
};

describe("列操作", () => {
  it("新增列：id 自动避开已用的，类型写进列定义", () => {
    const result = addColumn(doc(), "状态", "status");
    expect(result.columnId).toBe("c3");
    expect(result.doc.columns.at(-1)).toMatchObject({ id: "c3", name: "状态", type: "status" });
  });

  it("改列名不动数据；改类型只换标识、值一个不动（读宽容）", () => {
    const renamed = renameColumn(doc(), "c1", "标题");
    expect(renamed.columns[1]?.name).toBe("标题");
    expect(renamed.rows[0]?.c1).toBe("甲");

    const retyped = changeColumnType(doc(), "c1", "number");
    expect(retyped.columns[1]?.type).toBe("number");
    // 关键：`甲` 不是数字，但**不清理**——解析不了就显示原文（设计 §2.3）
    expect(retyped.rows[0]?.c1).toBe("甲");
    expect(retyped.rows).toEqual(doc().rows);
  });

  it("`_id` 列不可删、不可改类型（受保护列）", () => {
    const base = doc({
      columns: [
        { id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true },
        { id: "c1", name: "名称", type: "text" },
      ],
    });
    expect(isProtectedColumn(base, ROW_ID_COLUMN)).toBe(true);
    expect(removeColumn(base, ROW_ID_COLUMN)).toEqual(base);
    expect(removeColumn(base, "c1").columns.map((column) => column.id)).toEqual([ROW_ID_COLUMN]);
  });

  it("删列连带删掉每行那一格", () => {
    const result = removeColumn(doc(), "c2");
    expect(result.columns.some((column) => column.id === "c2")).toBe(false);
    expect(result.rows[0]).not.toHaveProperty("c2");
    expect(result.rows[0]?.c1).toBe("甲");
  });

  it("移动列不越界；设置候选项与隐藏开关都落在列定义上", () => {
    const moved = moveColumn(doc(), "c2", -1);
    expect(moved.columns.map((column) => column.id)).toEqual([ROW_ID_COLUMN, "c2", "c1"]);
    expect(moveColumn(doc(), "c1", -1)).toEqual(doc()); // 已经是最左，不动
    expect(moveColumn(doc(), "c2", 1)).toEqual(doc()); // 已经是最右，不动

    expect(setColumnOptions(doc(), "c1", ["a", "b"]).columns[1]?.options).toEqual(["a", "b"]);
    expect(toggleColumnHidden(doc(), ROW_ID_COLUMN).columns[0]?.hidden).toBe(false);
  });

  it("visibleColumns 按 hidden 过滤 `_id`（默认隐藏）", () => {
    expect(visibleColumns(doc()).map((column) => column.id)).toEqual(["c1", "c2"]);
    expect(visibleColumns(toggleColumnHidden(doc(), ROW_ID_COLUMN)).map((column) => column.id)).toEqual([
      ROW_ID_COLUMN,
      "c1",
      "c2",
    ]);
  });
});

describe("行操作", () => {
  it("新增行会补一个合法行 ID", () => {
    const { doc: next, rowId } = addRow(doc(), sequence([0.5]));
    expect(rowId).toMatch(/^[0-9a-z]{6,8}$/);
    expect(next.rows).toHaveLength(3);
    expect(next.rows.at(-1)?.[ROW_ID_COLUMN]).toBe(rowId);
  });

  it("按行 ID 删行（大小写不敏感）", () => {
    expect(removeRow(doc(), "AAA111").rows.map((row) => row.c1)).toEqual(["乙"]);
  });

  it("上移 / 下移与拖动落位；越界不动", () => {
    expect(moveRow(doc(), "bbb222", -1).rows.map((row) => row.c1)).toEqual(["乙", "甲"]);
    expect(moveRow(doc(), "aaa111", -1)).toEqual(doc());
    expect(moveRow(doc(), "aaa111", 1).rows.map((row) => row.c1)).toEqual(["乙", "甲"]);

    // 拖到末尾
    const toEnd = reorderRow(doc(), "aaa111", null);
    expect(toEnd.rows.map((row) => row.c1)).toEqual(["乙", "甲"]);
    // 拖到指定行之前
    const before = reorderRow(toEnd, "aaa111", "bbb222");
    expect(before.rows.map((row) => row.c1)).toEqual(["甲", "乙"]);
  });

  it("在上方 / 下方插入行", () => {
    const above = insertRow(doc(), "bbb222", "above", sequence([0.5]));
    expect(above.doc.rows.map((row) => row.c1)).toEqual(["甲", undefined, "乙"]);
    expect(above.doc.rows[1]?.[ROW_ID_COLUMN]).toBe(above.rowId);

    const below = insertRow(doc(), "aaa111", "below", sequence([0.5]));
    expect(below.doc.rows.map((row) => row.c1)).toEqual(["甲", undefined, "乙"]);
  });

  it("写一格只动那一格", () => {
    const next = setCell(doc(), "aaa111", "c1", "改过的");
    expect(next.rows[0]?.c1).toBe("改过的");
    expect(next.rows[1]?.c1).toBe("乙");
    expect(next.rows[0]?.c2).toBe("10");
  });
});

describe("筛选与排序", () => {
  it("包含 / 等于 / 为空 / 不为空 / 大于 / 小于", () => {
    const row = { [ROW_ID_COLUMN]: "aaa111", c1: "苹果 派", c2: "10", c3: "" };
    expect(matchesFilter(row, { columnId: "c1", operator: "contains", value: "苹果" })).toBe(true);
    expect(matchesFilter(row, { columnId: "c1", operator: "equals", value: "苹果 派" })).toBe(true);
    expect(matchesFilter(row, { columnId: "c3", operator: "empty", value: "" })).toBe(true);
    expect(matchesFilter(row, { columnId: "c1", operator: "not_empty", value: "" })).toBe(true);
    expect(matchesFilter(row, { columnId: "c2", operator: "gt", value: "9" })).toBe(true);
    expect(matchesFilter(row, { columnId: "c2", operator: "lt", value: "9" })).toBe(false);
  });

  it("数字比较解析不了就当不命中（不拿字符串比大小）", () => {
    const row = { c2: "甲" };
    expect(matchesFilter(row, { columnId: "c2", operator: "gt", value: "9" })).toBe(false);
    expect(matchesFilter(row, { columnId: "c2", operator: "lt", value: "9" })).toBe(false);
  });

  it("多条件取与；空条件不筛", () => {
    const rows = doc().rows;
    expect(filterRows(rows, [])).toHaveLength(2);
    expect(filterRows(rows, [{ columnId: "", operator: "contains", value: "x" }])).toHaveLength(2);
    expect(
      filterRows(rows, [
        { columnId: "c1", operator: "not_empty", value: "" },
        { columnId: "c2", operator: "gt", value: "9" },
      ]),
    ).toHaveLength(1);
  });

  it("排序：数字列按数值（10 排在 9 后面），降序反转；无排序保持手动顺序", () => {
    expect(sortRows(doc().rows, { columnId: "c2", direction: "asc" }).map((row) => row.c2)).toEqual([
      "9",
      "10",
    ]);
    expect(sortRows(doc().rows, { columnId: "c2", direction: "desc" }).map((row) => row.c2)).toEqual([
      "10",
      "9",
    ]);
    expect(sortRows(doc().rows, null).map((row) => row.c1)).toEqual(["甲", "乙"]);
  });

  it("visibleRows = 先筛后排", () => {
    const state: Pick<TableViewState, "doc" | "filters" | "sort"> = {
      doc: doc(),
      filters: [{ columnId: "c2", operator: "gt", value: "9" }],
      sort: { columnId: "c2", direction: "desc" },
    };
    expect(visibleRows(state).map((row) => row.c1)).toEqual(["甲"]);
  });

  it("cellValue 对缺列返回空串（列被删过时不该抛）", () => {
    expect(cellValue(doc().rows[0] ?? {}, "gone")).toBe("");
  });
});

describe("大小与提示", () => {
  it("大小按序列化后的字节数算，档位与文案齐全", () => {
    const size = tableSize(doc());
    expect(size.bytes).toBe(tableBytes(doc()));
    expect(size.level).toBe("ok");
    expect(size.label).toMatch(/B \/ 1\.9 MB$/);
    expect(blocksSave(size)).toBe(false);
  });

  it("超过软上限提示但仍可保存；到硬上限阻止保存", () => {
    const padded = (length: number): TableDoc =>
      doc({ rows: [{ [ROW_ID_COLUMN]: "aaa111", c1: "字".repeat(length), c2: "1" }] });

    const soft = tableSize(padded(400_000)); // 中文 3 字节/字 → 约 1.2MB
    expect(soft.level).toBe("soft");
    expect(blocksSave(soft)).toBe(false);

    const hard = tableSize(padded(700_000)); // 约 2.1MB
    expect(hard.level).toBe("hard");
    expect(blocksSave(hard)).toBe(true);
  });

  it("列数 >50 与单元格超长都只提示、不拒绝", () => {
    const manyColumns: TableDoc = {
      ...doc(),
      columns: [
        { id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true },
        ...Array.from({ length: COLUMN_NOTICE_COUNT + 1 }, (_, index) => ({
          id: `c${index + 1}`,
          name: `列${index + 1}`,
          type: "text" as const,
        })),
      ],
    };
    expect(tableHints(manyColumns).some((hint) => hint.kind === "too_many_columns")).toBe(true);

    const longCell = doc({
      rows: [{ [ROW_ID_COLUMN]: "aaa111", c1: "字".repeat(CELL_NOTICE_CHARS + 1) }],
    });
    expect(tableHints(longCell).some((hint) => hint.kind === "long_cell")).toBe(true);
    expect(tableHints(doc())).toEqual([]);
  });
});

describe("图册", () => {
  it("没有图片列时不可用（按钮置灰 + 出口）", () => {
    expect(galleryAvailability(doc())).toEqual({ available: false, imageColumnId: null });
    const withImage = doc({
      columns: [...doc().columns, { id: "c9", name: "封面", type: "image" }],
    });
    expect(galleryAvailability(withImage)).toEqual({ available: true, imageColumnId: "c9" });
  });

  it("卡片取标题列 + 图片列 + 最多两个属性胶囊", () => {
    const withImage = doc({
      columns: [
        { id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true },
        { id: "c1", name: "名称", type: "text" },
        { id: "c2", name: "数量", type: "number" },
        { id: "c3", name: "状态", type: "status" },
        { id: "c4", name: "日期", type: "date" },
        { id: "c9", name: "封面", type: "image" },
      ],
      rows: [
        {
          [ROW_ID_COLUMN]: "aaa111",
          c1: "甲",
          c2: "10",
          c3: "todo",
          c4: "2026-09-27",
          c9: "a/u1/h1.t",
        },
      ],
    });

    const cards = galleryCards(withImage);
    expect(cards[0]).toMatchObject({ rowId: "aaa111", title: "甲", image: "a/u1/h1.t" });
    expect(cards[0]?.chips.map((chip) => chip.label)).toEqual(["数量", "状态"]);
  });
});

describe("列定义面板要用的判定", () => {
  it("unparsableCount：只对纯数字列算，其它类型一律 0（不为凑数字去猜）", () => {
    const target = doc();
    expect(unparsableCount(target, "c2", "number")).toBe(0); // 10 / 9 都能解析
    expect(unparsableCount(target, "c1", "number")).toBe(2); // 甲 / 乙 解析不了
    expect(unparsableCount(target, "c1", "text")).toBe(0);
    expect(unparsableCount(target, "c1", "tags")).toBe(0);
    // 空值不算解析失败
    expect(unparsableCount(doc({ rows: [{ [ROW_ID_COLUMN]: "aaa111", c1: "" }] }), "c1", "number")).toBe(0);
  });

  it("changeColumnTypeWithReport 同时给新文档与失败格数", () => {
    const result = changeColumnTypeWithReport(doc(), "c1", "number");
    expect(result.unparsable).toBe(2);
    expect(result.doc.columns[1]?.type).toBe("number");
  });

  it("duplicateColumnNames 列出重名（允许重名，只提示）", () => {
    expect(duplicateColumnNames(doc())).toEqual([]);
    const dup = doc({
      columns: [
        { id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true },
        { id: "c1", name: "同名", type: "text" },
        { id: "c2", name: "同名", type: "text" },
      ],
    });
    expect(duplicateColumnNames(dup)).toEqual(["同名"]);
  });

  it("hasDataColumn：只剩 `_id` 时为假（面板据此禁用「确定」）", () => {
    expect(hasDataColumn(doc())).toBe(true);
    expect(hasDataColumn(doc({ columns: [{ id: ROW_ID_COLUMN, name: "ID", type: "text" }] }))).toBe(false);
  });
});

describe("大表窗口（虚拟滚动）", () => {
  it("小表不窗口化（全渲染）", () => {
    const range = windowRange({ rowCount: 20, rowHeight: 36, scrollTop: 500, viewportHeight: 400 });
    expect(range).toEqual({ start: 0, end: 20, topPad: 0, bottomPad: 0 });
  });

  it("量不出视口时不窗口化（jsdom 的 clientHeight 恒为 0，宁可全渲染也不露白）", () => {
    const range = windowRange({ rowCount: 5000, rowHeight: 36, scrollTop: 0, viewportHeight: 0 });
    expect(range.start).toBe(0);
    expect(range.end).toBe(5000);
  });

  it("行高不合法时不窗口化（算错不如不算）", () => {
    expect(windowRange({ rowCount: 5000, rowHeight: 0, scrollTop: 0, viewportHeight: 400 }).end).toBe(5000);
  });

  it("大表：只渲染可见段 + 上下占位行，且占位高度之和 = 未渲染行数 × 行高", () => {
    const rowCount = 10_000;
    const rowHeight = 36;
    const viewportHeight = 720;
    const overscan = 8;
    const middle = windowRange({ rowCount, rowHeight, scrollTop: 36 * 5000, viewportHeight, overscan });

    expect(middle.start).toBe(5000 - overscan);
    const rendered = middle.end - middle.start;
    expect(rendered).toBe(Math.ceil(viewportHeight / rowHeight) + overscan * 2);
    // 占位行撑住总高度：上下占位 + 已渲染 = 全表
    expect(middle.topPad).toBe(middle.start * rowHeight);
    expect(middle.bottomPad).toBe((rowCount - middle.end) * rowHeight);
    expect(middle.topPad + rendered * rowHeight + middle.bottomPad).toBe(rowCount * rowHeight);
  });

  it("滚到顶部与底部都不越界", () => {
    const top = windowRange({ rowCount: 1000, rowHeight: 36, scrollTop: -50, viewportHeight: 400 });
    expect(top.start).toBe(0);
    expect(top.topPad).toBe(0);

    const bottom = windowRange({ rowCount: 1000, rowHeight: 36, scrollTop: 36 * 999, viewportHeight: 400 });
    expect(bottom.end).toBe(1000);
    expect(bottom.bottomPad).toBe(0);
  });

  it("阈值边界：恰好 100 行不窗口化，101 行开始窗口化", () => {
    const at = windowRange({ rowCount: VIRTUAL_ROW_THRESHOLD, rowHeight: 36, scrollTop: 0, viewportHeight: 400 });
    expect(at.end).toBe(VIRTUAL_ROW_THRESHOLD);
    const over = windowRange({
      rowCount: VIRTUAL_ROW_THRESHOLD + 1,
      rowHeight: 36,
      scrollTop: 0,
      viewportHeight: 400,
    });
    expect(over.end).toBeLessThan(VIRTUAL_ROW_THRESHOLD + 1);
  });
});

describe("降级为普通笔记", () => {
  it("结构正常时不需要降级", () => {
    const markdown = renderTableDocument(doc());
    expect(checkDegrade(markdown).degrade).toBe(false);
  });

  it("结构损坏 → 需要降级，并且只动 front matter（正文一字不改）", () => {
    // 整行删掉分隔行（片段替换会留下半行，仍然像分隔行——这一点在 M4-3 的用例里踩过）
    const lines = renderTableDocument(doc()).split("\n");
    const separatorIndex = lines.findIndex((line) => line.includes("--- |"));
    lines.splice(separatorIndex, 1);

    const check = checkDegrade(lines.join("\n"));
    expect(check.degrade).toBe(true);
    expect(check.reason).toBe("broken_structure");
    // 管道表格原文仍在（用户能自己复制走）
    expect(check.markdown).toContain("| aaa111 | 甲 | 10 |");
  });

  it("不是表格类型也走降级路径（reason = not_table）", () => {
    const markdown = renderTableDocument(doc()).replace("type: table", "type: note");
    const check = checkDegrade(markdown);
    expect(check.degrade).toBe(true);
    expect(check.reason).toBe("not_table");
  });

  it("stripTableMeta：去掉 columns / row_id_column / views / type，保留正文与其它自定义键", () => {
    const markdown = renderTableDocument(doc()).replace("  views:", "  custom_key: 保留我\n  views:");
    const stripped = stripTableMeta(markdown);

    expect(stripped).toContain("type: note");
    expect(stripped).not.toContain("row_id_column");
    expect(stripped).not.toContain("columns:");
    expect(stripped).not.toContain("views:");
    expect(stripped).toContain("custom_key: 保留我"); // 不认识的键不能丢
    expect(stripped).toContain("| aaa111 | 甲 | 10 |"); // 正文原样

    // 降级后再解析：应当是一个普通笔记（没有 front matter 结构错误）
    expect(stripped.startsWith("---\n")).toBe(true);
    expect(stripped.split("\n").filter((line) => line.trim() === "---")).toHaveLength(2);
  });
});
