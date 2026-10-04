// @vitest-environment node
/**
 * 导入本地 Markdown 的纯逻辑（v0.6.16）。
 *
 * 覆盖五件容易出错的事：
 * - 标题优先取 front matter 的 `title:`，其次文件名、空名退化；
 * - **BOM 剥掉**（Windows 编辑器存的 `.md` 常带，不剥正文首行会多个不可见字符）；
 * - **类型由正文显式定**（`type: "table"`）——表格界面看的是 `item.type`，
 *   光把表格源码当普通笔记导进来，用户会看到一堆 YAML；
 * - 单个失败不中断整批，且失败项带名字与原因（不静默）。
 */
import { describe, expect, it, vi } from "vitest";
import { buildDocument, renderTableDocument, ROW_ID_COLUMN } from "@menote/mdcore";
import {
  DEFAULT_NOTE_TITLE,
  importMarkdownFiles,
  isMarkdownFileName,
  noteTitleFromFileName,
  stripBom,
  titleForImport,
  type ImportedNoteDraft,
} from "../src/features/notes/import-md";

function md(name: string, text: string): File {
  return new File([text], name, { type: "text/markdown" });
}

describe("文件名 → 标题", () => {
  it("去掉 .md 就是标题（大小写不敏感）", () => {
    expect(noteTitleFromFileName("读书笔记.md")).toBe("读书笔记");
    expect(noteTitleFromFileName("周报.MD")).toBe("周报");
  });

  it("空名退化到默认标题，不留空白标题", () => {
    expect(noteTitleFromFileName(".md")).toBe(DEFAULT_NOTE_TITLE);
    expect(noteTitleFromFileName("   .md")).toBe(DEFAULT_NOTE_TITLE);
  });

  it("只认 .md", () => {
    expect(isMarkdownFileName("a.md")).toBe(true);
    expect(isMarkdownFileName("a.MD")).toBe(true);
    expect(isMarkdownFileName("a.txt")).toBe(false);
    expect(isMarkdownFileName("a.md.txt")).toBe(false);
  });
});

describe("BOM", () => {
  it("剥掉开头的 U+FEFF，其余一字不动", () => {
    expect(stripBom("\uFEFF# 标题\n正文")).toBe("# 标题\n正文");
    // 正文里出现 BOM 字符不该被动（只有开头那一个是文件编码标记）
    expect(stripBom("正文\uFEFF中间")).toBe("正文\uFEFF中间");
    expect(stripBom("")).toBe("");
  });
});

describe("importMarkdownFiles", () => {
  it("一个文件建一条：标题取文件名，正文原样（BOM 除外）", async () => {
    const create = vi.fn<(draft: ImportedNoteDraft) => Promise<void>>(async () => undefined);
    const summary = await importMarkdownFiles(
      [md("会议纪要.md", "# 会议纪要\n\n- 一条\n")],
      create,
    );

    expect(summary).toEqual({ created: 1, skipped: [] });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      title: "会议纪要",
      body: "# 会议纪要\n\n- 一条\n",
      type: "note",
    });
  });

  it("正文是合法表格文档 → 建出来就是 `type: table`（导出再导入能还原成表格）", async () => {
    const create = vi.fn<(draft: ImportedNoteDraft) => Promise<void>>(async () => undefined);
    const body = renderTableDocument({
      columns: [
        { id: ROW_ID_COLUMN, name: ROW_ID_COLUMN, type: "text", hidden: true },
        { id: "c1", name: "事项", type: "text" },
      ],
      rowIdColumn: ROW_ID_COLUMN,
      views: { default: "table" },
      rows: [{ [ROW_ID_COLUMN]: "a1b2c3", c1: "买菜" }],
      attachments: [],
      notices: [],
      preservedLines: [],
      tags: [],
      foreignLines: [],
    });

    await importMarkdownFiles([md("清单.md", body)], create);

    expect(create.mock.calls[0]?.[0]).toMatchObject({ type: "table", title: "清单" });
  });

  it("带待办 front matter → 派生出清单标记与字段", async () => {
    const create = vi.fn<(draft: ImportedNoteDraft) => Promise<void>>(async () => undefined);
    const body = buildDocument(
      {
        type: "note",
        tags: ["生活"],
        task: { status: "doing", due: null, priority: "high" },
        preservedLines: [],
        foreignLines: [],
      },
      "买菜",
    );

    await importMarkdownFiles([md("待办.md", body)], create);

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      type: "note",
      tags: ["生活"],
      task: { isTask: true, status: "doing", priority: "high" },
    });
  });

  it("非 .md 跳过并说明原因，不静默吞", async () => {
    const create = vi.fn<(draft: ImportedNoteDraft) => Promise<void>>(async () => undefined);
    const summary = await importMarkdownFiles(
      [md("好的.md", "x"), md("照片.png", "y")],
      create,
    );

    expect(summary.created).toBe(1);
    expect(summary.skipped).toEqual([{ name: "照片.png", reason: "不是 .md 文件" }]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  /**
   * 标题优先取 front matter 的 `title:`（2026-10-04）。
   *
   * 这一条是为了外部工具（Obsidian 等）导出的 `.md`：它们把标题写在 `title:` 里，
   * 文件名却是 slug 或一串 status id——照文件名取会得到 `2035341800739877091` 这种没法读的标题。
   */
  it("front matter 的 title: 优先于文件名", async () => {
    const obFile = `---
title: "Anatomy of the .claude/ folder"
url: "https://x.com/akshay_pachaar/status/2035341800739877091"
tags: [claude]
---

正文。
`;
    expect(titleForImport("2035341800739877091.md", obFile)).toBe("Anatomy of the .claude/ folder");

    const create = vi.fn<(draft: ImportedNoteDraft) => Promise<void>>(async () => undefined);
    await importMarkdownFiles([md("2035341800739877091.md", obFile)], create);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      title: "Anatomy of the .claude/ folder",
      tags: ["claude"],
    });
  });

  it("md 里没有 title: 键 → 仍取文件名（存量笔记行为不变）", () => {
    expect(titleForImport("读书笔记.md", "# 正文")).toBe("读书笔记");
    expect(titleForImport("读书笔记.md", "---\nmenote:\n  type: note\n---\n\n正文")).toBe("读书笔记");
  });

  it("title: 空着 → 回落到文件名，不留空白标题", () => {
    expect(titleForImport("读书笔记.md", "---\ntitle:\n---\n\n正文")).toBe("读书笔记");
    expect(titleForImport("读书笔记.md", '---\ntitle: ""\n---\n\n正文')).toBe("读书笔记");
  });

  it("一个文件建失败不中断整批：其余照常建，失败项带原因", async () => {
    const create = vi.fn<(draft: ImportedNoteDraft) => Promise<void>>(async (draft) => {
      if (draft.title === "坏的") throw new Error("库写入失败");
    });

    const summary = await importMarkdownFiles(
      [md("好的.md", "a"), md("坏的.md", "b"), md("也好.md", "c")],
      create,
    );

    expect(summary.created).toBe(2);
    expect(summary.skipped).toEqual([{ name: "坏的.md", reason: "库写入失败" }]);
  });

  it("按选择顺序串行建（outbox 是 FIFO，顺序不能乱）", async () => {
    const order: string[] = [];
    await importMarkdownFiles(
      [md("一.md", "1"), md("二.md", "2"), md("三.md", "3")],
      async (draft) => {
        order.push(draft.title);
      },
    );

    expect(order).toEqual(["一", "二", "三"]);
  });
});
