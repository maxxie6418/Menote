/**
 * 表格编解码（M4-3；《M4 设计》§二）。零依赖纯函数，先于任何 I/O 单测。
 *
 * 用例名与《M4 实施计划》M4-3 的验收清单逐条对应，方便对照。
 */
import { describe, expect, it } from "vitest";
import {
  CELL_NOTICE_CHARS,
  COLUMN_NOTICE_COUNT,
  ROW_ID_COLUMN,
  TABLE_COLUMN_TYPES,
  ensureRowIds,
  escapeCell,
  isRowId,
  normalizeAttachmentNames,
  parseTableDocument,
  renderRow,
  renderTableDocument,
  sameRowId,
  splitRow,
  unescapeCell,
  type TableColumn,
  type TableDoc,
} from "../src/table";

/** 固定随机序列：让"补发 ID"这件事可断言 */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length] ?? 0;
    index += 1;
    return value;
  };
}

function doc(overrides: Partial<TableDoc> = {}): TableDoc {
  const columns: TableColumn[] = [
    { id: "c1", name: "名称", type: "text" },
    { id: "c2", name: "状态", type: "status", options: ["todo", "doing", "done"] },
  ];
  return {
    columns,
    rowIdColumn: ROW_ID_COLUMN,
    views: { default: "table" },
    rows: [{ [ROW_ID_COLUMN]: "abc123", c1: "第一项", c2: "todo" }],
    attachments: [],
    notices: [],
    preservedLines: [],
    tags: [],
    foreignLines: [],
    ...overrides,
  };
}

describe("十种列类型往返编解码一致", () => {
  it("每种类型都能写进 YAML 并原样读回", () => {
    const columns: TableColumn[] = TABLE_COLUMN_TYPES.map((type, index) => ({
      id: `c${index + 1}`,
      name: `列${index + 1}`,
      type,
    }));
    const markdown = renderTableDocument(doc({ columns, rows: [] }));

    const parsed = parseTableDocument(markdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.columns.map((column) => column.type)).toEqual([...TABLE_COLUMN_TYPES]);
    expect(parsed.doc.columns.map((column) => column.id)).toEqual(columns.map((column) => column.id));
  });

  it("union 类型枚举与设计一致（十种）", () => {
    expect(TABLE_COLUMN_TYPES).toHaveLength(10);
    expect([...TABLE_COLUMN_TYPES]).toEqual([
      "text",
      "number",
      "select",
      "multi_select",
      "checkbox",
      "status",
      "url",
      "image",
      "date",
      "tags",
    ]);
  });

  it("不认识的字面量按 text 处理并给出提示（读宽容，不改数据）", () => {
    const markdown = renderTableDocument(doc({ rows: [] })).replace("type: text", "type: richtext");
    const parsed = parseTableDocument(markdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.columns[0]?.type).toBe("text");
    expect(parsed.doc.notices.some((notice) => notice.kind === "unknown_column_type")).toBe(true);
  });
});

describe("YAML 键名与 views.default/gallery 往返一致", () => {
  it("columns 的 options / hidden 与 row_id_column 都能往返", () => {
    const markdown = renderTableDocument(
      doc({
        columns: [
          { id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true },
          { id: "c1", name: "名称", type: "text" },
          { id: "c2", name: "状态", type: "status", options: ["todo", "doing"] },
        ],
        rows: [],
      }),
    );

    const parsed = parseTableDocument(markdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.columns[0]?.hidden).toBe(true);
    expect(parsed.doc.columns[2]?.options).toEqual(["todo", "doing"]);
    expect(parsed.doc.rowIdColumn).toBe(ROW_ID_COLUMN);
  });

  it("views.default = gallery + gallery.image_column 往返一致", () => {
    const markdown = renderTableDocument(
      doc({ views: { default: "gallery", gallery: { image_column: "c2" } }, rows: [] }),
    );
    const parsed = parseTableDocument(markdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.views).toEqual({ default: "gallery", gallery: { image_column: "c2" } });
  });

  it("不归表格管的 front matter 行原样保留（解析不丢未知内容）", () => {
    const markdown = renderTableDocument(doc()).replace(
      "  views:",
      "  custom_key: 自定义值\n  views:",
    );
    const parsed = parseTableDocument(markdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.preservedLines.join("\n")).toContain("custom_key: 自定义值");

    // 再渲染一次也不能把它吃掉
    expect(renderTableDocument(parsed.doc)).toContain("custom_key: 自定义值");
  });

  /**
   * 外来 front matter 的顶层 `columns:` **不能**被当成 MeNote 的表格列定义（2026-10-04）。
   *
   * `readTableKeys` 按 `columns` / `views` / `row_id_column` 三个键名做二次解析，它的输入
   * 曾经是 `preservedLines`——而那个字段当时还兼着"外来 front matter 整块"的职责。
   * 两边一旦在同一个数组里碰面，外部文档的 `columns:` 就会被读成 MeNote 的列定义。
   * 拆语义（外来键走 `foreignLines`）之后，这条从结构上不再可能。
   */
  it("外来 front matter 的 columns: 不被误读成表格列定义", () => {
    const foreign = `---
title: "外来标题"
columns:
  - "这是外部工具的列"
---

| _id | 名称 |
|---|---|
| a | 三体 |
`;
    const parsed = parseTableDocument(foreign);
    // 没有 menote.type: table，本来就该降级——关键是**别** ok:true
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain("不是 table 类型");
  });

  it("外来顶层键在表格重渲染后一字不丢", () => {
    // 表格的任何一次单元格编辑都会整篇重建（renderTableDocument → buildDocument），
    // 外来属性必须跟着 TableDoc 一起流转，否则改一个单元格就丢一次外来键。
    // 标题带半角冒号 + 空格（YAML 纯量里 `: ` 会截断，必须加引号）
    const withForeign = renderTableDocument(doc()).replace(
      "---\nmenote:",
      '---\ntitle: "第 3 章: 笔记"\nurl: "https://example.com/a"\nmenote:',
    );
    const parsed = parseTableDocument(withForeign);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const rerendered = renderTableDocument(parsed.doc);
    expect(rerendered).toContain("url: \"https://example.com/a\"");
    expect(rerendered).toContain('title: "第 3 章: 笔记"');
    // 外来键在 menote 块之前，缩进不被吃掉
    expect(rerendered.indexOf("menote:")).toBeGreaterThan(rerendered.indexOf("url:"));

    // 往返两次仍不丢
    const second = parseTableDocument(rerendered);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(renderTableDocument(second.doc)).toContain("url: \"https://example.com/a\"");
  });

  it("顶层 tags 跟着表格重渲染流转，不被清空", () => {
    // renderTableDocument 早先写死 tags: []，顶层化之后每次重渲染都会清空用户标签
    const withTags = renderTableDocument(doc({ tags: ["科幻", "长篇"] }));
    expect(withTags).toContain("\ntags: [科幻, 长篇]\n");

    const parsed = parseTableDocument(withTags);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.tags).toEqual(["科幻", "长篇"]);
    expect(renderTableDocument(parsed.doc)).toContain("\ntags: [科幻, 长篇]\n");
  });
});

describe("ensureRowIds", () => {
  it("补发缺 ID（并给出提示）", () => {
    const result = ensureRowIds([{ c1: "甲" }, { c1: "乙" }], sequence([0, 0.5]));
    expect(result.rows.every((row) => isRowId(row[ROW_ID_COLUMN] ?? ""))).toBe(true);
    expect(result.notices.filter((notice) => notice.kind === "missing_row_id")).toHaveLength(2);
  });

  it("重复 ID 保留首个、其余重发", () => {
    const result = ensureRowIds(
      [{ [ROW_ID_COLUMN]: "abc123" }, { [ROW_ID_COLUMN]: "abc123" }],
      sequence([0.5]),
    );
    expect(result.rows[0]?.[ROW_ID_COLUMN]).toBe("abc123");
    expect(result.rows[1]?.[ROW_ID_COLUMN]).not.toBe("abc123");
    expect(result.notices.some((notice) => notice.kind === "duplicate_row_id")).toBe(true);
  });

  it("非法长度按缺 ID 处理（3 位 / 9 位都不认）", () => {
    const result = ensureRowIds([{ [ROW_ID_COLUMN]: "abc" }, { [ROW_ID_COLUMN]: "abcdefghi" }], sequence([0]));
    expect(result.notices.filter((notice) => notice.kind === "missing_row_id")).toHaveLength(2);
  });
});

describe("ID 大小写不敏感比较", () => {
  it("sameRowId 忽略大小写；ensureRowIds 也按小写判重", () => {
    expect(sameRowId("ABC123", "abc123")).toBe(true);
    expect(sameRowId("abc123", "abc124")).toBe(false);

    const result = ensureRowIds(
      [{ [ROW_ID_COLUMN]: "ABC123" }, { [ROW_ID_COLUMN]: "abc123" }],
      sequence([0.5]),
    );
    expect(result.rows[1]?.[ROW_ID_COLUMN]?.toLowerCase()).not.toBe("abc123");
  });
});

describe("单元格 | 转义与 <br> 往返", () => {
  it("竖线与换行都能安全往返", () => {
    const value = "含 | 竖线\n与换行";
    const escaped = escapeCell(value);
    expect(escaped).not.toContain("\n");
    expect(escaped).toContain("\\|");
    expect(unescapeCell(escaped)).toBe(value);
  });

  it("切行只看未转义的竖线", () => {
    expect(splitRow("| a\\|b | c |")).toEqual(["a\\|b", "c"]);
    expect(splitRow("| a | b |")).toEqual(["a", "b"]);
  });

  it("表格整体往返：单元格里的竖线与换行不变形", () => {
    const markdown = renderTableDocument(
      doc({ rows: [{ [ROW_ID_COLUMN]: "abc123", c1: "含 | 与\n换行", c2: "done" }] }),
    );
    const parsed = parseTableDocument(markdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.rows[0]?.c1).toBe("含 | 与\n换行");
  });

  it("renderRow 产出规范形状（两侧竖线 + 空格）", () => {
    expect(renderRow(["a", "b"])).toBe("| a | b |");
  });
});

describe("宽容解析与提示位", () => {
  it("表头写列名也能读进来（按 id 优先、名字兜底），并落到列 id 上", () => {
    const markdown = [
      "---",
      "menote:",
      "  type: table",
      "  columns:",
      "    - { id: c1, name: 名称, type: text }",
      "  row_id_column: _id",
      "  views:",
      "    default: table",
      "---",
      "",
      "| _id | 名称 |",
      "| --- | --- |",
      "| abc123 | 手工写的 |",
    ].join("\n");

    const parsed = parseTableDocument(markdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.rows[0]).toEqual({ [ROW_ID_COLUMN]: "abc123", c1: "手工写的" });
  });

  it("单元格超长只提示、不拒绝", () => {
    const long = "字".repeat(CELL_NOTICE_CHARS + 1);
    const markdown = renderTableDocument(
      doc({ rows: [{ [ROW_ID_COLUMN]: "abc123", c1: long, c2: "todo" }] }),
    );
    const parsed = parseTableDocument(markdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.rows[0]?.c1).toHaveLength(CELL_NOTICE_CHARS + 1);
    expect(parsed.doc.notices.some((notice) => notice.kind === "cell_too_long")).toBe(true);
  });

  it("列数超过提示线只提示、不拒绝", () => {
    const columns: TableColumn[] = Array.from({ length: COLUMN_NOTICE_COUNT + 1 }, (_, index) => ({
      id: `c${index}`,
      name: `列${index}`,
      type: "text" as const,
    }));
    const markdown = renderTableDocument(doc({ columns, rows: [] }));
    const parsed = parseTableDocument(markdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.columns).toHaveLength(COLUMN_NOTICE_COUNT + 1);
    expect(parsed.doc.notices.some((notice) => notice.kind === "too_many_columns")).toBe(true);
  });
});

describe("结构损坏判定为降级", () => {
  it("不是 table 类型 → ok: false", () => {
    const markdown = renderTableDocument(doc()).replace("type: table", "type: note");
    expect(parseTableDocument(markdown).ok).toBe(false);
  });

  it("没有管道表格 → ok: false", () => {
    // 整行删掉分隔行（用行定位，别靠字符串片段匹配——片段替换会留下半行，仍然像分隔行）
    const lines = renderTableDocument(doc()).split("\n");
    const separatorIndex = lines.findIndex((line) => line.includes("--- |"));
    expect(separatorIndex).toBeGreaterThan(0);
    lines.splice(separatorIndex, 1);
    expect(parseTableDocument(lines.join("\n")).ok).toBe(false);
  });

  it("表头列数少于列定义 → ok: false（结构对不上，交上层降级）", () => {
    const markdown = renderTableDocument(doc({ rows: [] })).replace(
      `| ${ROW_ID_COLUMN} | c1 | c2 |`,
      `| ${ROW_ID_COLUMN} |`,
    );
    expect(parseTableDocument(markdown).ok).toBe(false);
  });

  it("没有 front matter → ok: false（普通笔记降级路径）", () => {
    expect(parseTableDocument("| a | b |\n| --- | --- |\n| 1 | 2 |").ok).toBe(false);
  });
});

describe("`_id` 列写在列定义里时不重复渲染（界面稿口径）", () => {
  it("columns 已含 `_id` 时表头只有一列 `_id`，往返后行里也只有一个同名字段", () => {
    const withRowId: TableDoc = {
      ...doc(),
      columns: [{ id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true }, ...doc().columns],
      rows: [{ [ROW_ID_COLUMN]: "abc123", c1: "甲", c2: "todo" }],
    };
    const markdown = renderTableDocument(withRowId);
    const header = markdown.split("\n").find((line) => line.startsWith("| _id"));
    expect(header).toBe(`| _id | c1 | c2 |`);

    const parsed = parseTableDocument(markdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.rows[0]).toEqual({ [ROW_ID_COLUMN]: "abc123", c1: "甲", c2: "todo" });
    // 列定义里的 `_id` 也要跟着往返（hidden 保住）
    expect(parsed.doc.columns[0]).toMatchObject({ id: ROW_ID_COLUMN, hidden: true });
  });

  it("columns 不含 `_id` 时补在表头首位（设计 §2.1 的 YAML 示例形状）", () => {
    const bare: TableDoc = {
      ...doc(),
      columns: [
        { id: "c1", name: "名称", type: "text" },
        { id: "c2", name: "状态", type: "status" },
      ],
    };
    const markdown = renderTableDocument(bare);
    const header = markdown.split("\n").find((line) => line.startsWith("| _id"));
    expect(header).toBe(`| _id | c1 | c2 |`);

    const parsed = parseTableDocument(markdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.columns.map((column) => column.id)).toEqual(["c1", "c2"]);
  });
});

describe("## 附件 章节与同名文件", () => {  it("附件行按名称解析，原样保留括号说明", () => {
    const markdown = renderTableDocument(
      doc({
        rows: [],
        attachments: [
          { name: "图.png", raw: "图.png（封面）" },
          { name: "图 2.png", raw: "图 2.png" },
        ],
      }),
    );
    const parsed = parseTableDocument(markdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.attachments).toEqual([
      { name: "图.png", raw: "图.png（封面）" },
      { name: "图 2.png", raw: "图 2.png" },
    ]);
  });

  it("同名图片文件名加序号（扩展名之前插）", () => {
    expect(normalizeAttachmentNames(["图.png", "图.png", "图.png"])).toEqual([
      "图.png",
      "图 2.png",
      "图 3.png",
    ]);
    expect(normalizeAttachmentNames(["无扩展名", "无扩展名"])).toEqual(["无扩展名", "无扩展名 2"]);
    // 大小写不同视为同名（与行 ID 一样按小写判）
    expect(normalizeAttachmentNames(["A.PNG", "a.png"])).toEqual(["A.PNG", "a 2.png"]);
  });
});
