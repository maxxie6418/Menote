import { describe, expect, it } from "vitest";
import {
  buildDocument,
  deriveTitle,
  frontmatterText,
  parseMenoteMeta,
  readForeignKeys,
  removeForeignKey,
  stripFrontmatter,
  updateMenoteKeys,
  writeForeignKey,
} from "../src/frontmatter";
import { parseTableDocument, renderTableDocument } from "../src/table";

const DOC = `---
menote:
  type: note
  tags: [工作, dev]
  task:
    status: todo
    due: 2026-09-30
    priority: high
---

# 正文标题

内容。
`;

describe("解析之间不共享状态（2026-09-27 修复）", () => {
  /**
   * 早先这里是 `const EMPTY_META = {...}` + `{ ...EMPTY_META }`——**浅拷贝**，于是每次解析
   * 都往同一个 `preservedLines` / `tags` 数组里累计。单篇文档的单测完全看不出来；
   * 表格式编解码开始读 `preservedLines` 后立刻暴露：同一进程里第二份文档会带上第一篇的保留行。
   */
  it("连续解析两篇文档，preservedLines 不累计", () => {
    const table = "---\nmenote:\n  type: table\n  columns:\n    - { id: c1, name: 甲, type: text }\n---\n\n正文";
    const note = "---\nmenote:\n  type: note\n---\n\n另一篇";

    const first = parseMenoteMeta(table);
    expect(first.meta.preservedLines.some((line) => line.includes("columns"))).toBe(true);

    const second = parseMenoteMeta(note);
    expect(second.meta.preservedLines).toEqual([]);
  });

  it("tags 数组也不共享：改一篇不影响下一篇", () => {
    const markdown = "---\nmenote:\n  type: note\n---\n\n正文";
    const first = parseMenoteMeta(markdown);
    first.meta.tags.push("污染");

    expect(parseMenoteMeta(markdown).meta.tags).toEqual([]);
  });
});

describe("front matter 解析", () => {  it("取出 type / tags / task 与正文", () => {
    const { meta, body } = parseMenoteMeta(DOC);
    expect(meta.type).toBe("note");
    expect(meta.tags).toEqual(["工作", "dev"]);
    expect(meta.task).toEqual({ status: "todo", due: "2026-09-30", priority: "high" });
    expect(body.startsWith("# 正文标题")).toBe(true);
  });

  it("没有 front matter：整篇都是正文（不抛错）", () => {
    const parsed = parseMenoteMeta("# 只有正文");
    expect(parsed.raw).toBeNull();
    expect(parsed.meta.type).toBeNull();
    expect(parsed.body).toBe("# 只有正文");
  });

  it("围栏没闭合 → 降级为正文（需求 §10.2 的容错要求）", () => {
    const broken = "---\nmenote:\n  type: note\n\n# 正文";
    const parsed = parseMenoteMeta(broken);
    expect(parsed.raw).toBeNull();
    expect(parsed.body).toBe(broken);
  });

  it("tags 也支持块序列写法", () => {
    const parsed = parseMenoteMeta("---\nmenote:\n  tags:\n    - a\n    - b\n---\n\n正文");
    expect(parsed.meta.tags).toEqual(["a", "b"]);
  });

  it("task 键存在但字段为空也算清单条目（有无键就是清单标记本身）", () => {
    const parsed = parseMenoteMeta("---\nmenote:\n  task:\n---\n\n正文");
    expect(parsed.meta.task).toEqual({ status: null, due: null, priority: null });
  });

  it("stripFrontmatter 只回正文", () => {
    expect(stripFrontmatter(DOC)).toContain("# 正文标题");
    expect(stripFrontmatter(DOC)).not.toContain("menote:");
  });
});

describe("front matter 改写（安全底线：不认识的键不能丢）", () => {
  const TABLE = `---
menote:
  type: table
  row_id_column: _id
  columns:
    书名: { type: text }
    评分: { type: number }
  views:
    gallery: { image: 封面 }
  tags: [书单]
---

| _id | 书名 |
|---|---|
| a | 三体 |
`;

  it("只改命中的键，表格的 columns / views 原样保留", () => {
    const updated = updateMenoteKeys(TABLE, { tags: ["书单", "科幻"] });

    // tags 平铺到**顶层**（对齐定稿 §528 / 功能拆解 §333 的「YAML `tags` 字段」）
    expect(updated).toContain("\ntags: [书单, 科幻]\n");
    // 未知键连嵌套内容一字不动
    expect(updated).toContain("  row_id_column: _id");
    expect(updated).toContain("  columns:");
    expect(updated).toContain("    书名: { type: text }");
    expect(updated).toContain("  views:");
    expect(updated).toContain("    gallery: { image: 封面 }");
    expect(updated).toContain("| a | 三体 |");
  });

  it("patch 里没有的键不动；新增的键追加到末尾", () => {
    const updated = updateMenoteKeys("---\nmenote:\n  type: note\n---\n\n正文", {
      tags: ["a"],
    });
    expect(updated).toContain("  type: note");
    expect(updated).toContain("\ntags: [a]\n");
    // tags 在顶层，排在 menote 块之前
    expect(updated.indexOf("tags: [a]")).toBeLessThan(updated.indexOf("  type: note"));
  });

  it("task: null 删除整个 task 块（Q23：去掉清单标记即删除字段）", () => {
    const updated = updateMenoteKeys(DOC, { task: null });
    expect(updated).not.toContain("task:");
    expect(updated).not.toContain("status: todo");
    expect(updated).toContain("tags: [工作, dev]"); // 其它键不受影响
    expect(updated).toContain("# 正文标题");
  });

  it("原本没有 front matter 时按 patch 新建一个", () => {
    const updated = updateMenoteKeys("# 正文", { type: "note", tags: ["x"] });
    // 顶层先写 tags，再开 menote 块
    expect(updated.startsWith("---\ntags: [x]\nmenote:\n")).toBe(true);
    expect(updated).toContain("  type: note");
    expect(updated.endsWith("# 正文")).toBe(true);
  });

  it("含逗号的标签会加引号，且能原样解析回来", () => {
    const built = buildDocument(
      { type: null, tags: ['a,b', "c"], task: null, preservedLines: [], foreignLines: [] },
      "正文",
    );
    expect(built).toContain('tags: ["a,b", c]');
    expect(parseMenoteMeta(built).meta.tags).toEqual(["a,b", "c"]);
  });

  it("buildDocument 在没有任何 meta 时直接返回正文", () => {
    expect(buildDocument({ type: null, tags: [], task: null, preservedLines: [], foreignLines: [] }, "正文")).toBe(
      "正文",
    );
  });
});

/**
 * 外来 front matter（2026-10-04 修复 P0）。
 *
 * 这里的样本是**用户真实从 Obsidian 导出的那一份**（原样），不是构造的最小用例——
 * 最小用例只放一个 `title:` 的话，看不出 `author:` 这种带缩进子行的块会不会被劈开。
 *
 * 修复前 `updateMenoteKeys` 会往最前面塞一个**不带冒号**的裸 `menote`（`MENOTE_KEY` 是裸
 * 字符串），于是外来键变成它的兄弟行 → 整块 frontmatter 变成非法 YAML，而且新写的
 * `  tags:` 挂在不存在的父键下，**再解析读不回来（写进去的值自己丢了）**。
 * 83 个旧用例全绿是因为没有一个覆盖这条分支。
 */
const OB = `---
title: "Anatomy of the .claude/ folder"
url: "https://x.com/akshay_pachaar/status/2035341800739877091"
author:
  - "Unknown"
captured: 2026-03-25
tags: []
like: false
comment: 
status: unread
---

正文第一段。
`;

describe("外来 front matter（Obsidian 等外部工具的平铺 YAML）", () => {
  it("解析：外来键进 foreignLines，白名单键（title / tags）被取走", () => {
    const parsed = parseMenoteMeta(OB);
    // 外来键一个不少、一个不少字；title / tags 不在其中（它们归 MeNote 管，否则重建会写两遍）
    expect(parsed.meta.foreignLines).toEqual([
      'url: "https://x.com/akshay_pachaar/status/2035341800739877091"',
      "author:",
      '  - "Unknown"',
      "captured: 2026-03-25",
      "like: false",
      "comment: ",
      "status: unread",
    ]);
    // 白名单键取到了
    expect(parsed.meta.title).toBe("Anatomy of the .claude/ folder");
    expect(parsed.meta.tags).toEqual([]);
    // 关键：preservedLines 只装 menote: 块内的行（这里没有 menote 块，所以是空）
    expect(parsed.meta.preservedLines).toEqual([]);
    expect(parsed.body).toBe("正文第一段。\n");
  });

  it("改写 tags：落顶层，外来键原样在前，且不凭空造 menote 块", () => {
    const updated = updateMenoteKeys(OB, { tags: ["claude"] });

    // tags 平铺到顶层
    expect(updated).toContain("\ntags: [claude]\n");
    // 外来键逐字保留，含带缩进子行的 author 块
    expect(updated).toContain('url: "https://x.com/akshay_pachaar/status/2035341800739877091"');
    expect(updated).toContain('author:\n  - "Unknown"');
    expect(updated).toContain("comment: \nstatus: unread"); // 空值行也不许被吃掉
    // 外来 title 保留在顶层（没打 patch 就不动它）
    expect(updated).toContain('title: "Anatomy of the .claude/ folder"');
    // 没有 menote 子键就不该出现 menote:（更不该出现不带冒号的裸 menote）
    expect(updated.split("\n")).not.toContain("menote");
    expect(updated).not.toContain("menote:");
    expect(updated).toContain("正文第一段。");
  });

  it("改写后能再解析回来——写进去的值不许自己丢", () => {
    const updated = updateMenoteKeys(OB, { tags: ["claude"] });
    const reparsed = parseMenoteMeta(updated);
    expect(reparsed.meta.tags).toEqual(["claude"]);
    expect(reparsed.meta.title).toBe("Anatomy of the .claude/ folder");

    // 任务字段同理（features/tasks/actions.ts 的任务开关就走这条路径）
    const withTask = updateMenoteKeys(OB, { task: { status: "todo", due: null, priority: null } });
    const taskParsed = parseMenoteMeta(withTask);
    expect(taskParsed.meta.task).toEqual({ status: "todo", due: null, priority: null });
    expect(withTask).toContain("menote:\n  task:\n    status: todo");
    expect(withTask).toContain('title: "Anatomy of the .claude/ folder"');
    // menote: 必须在所有外来键之后，且带冒号
    expect(withTask.indexOf("status: unread")).toBeLessThan(withTask.indexOf("menote:"));
  });

  it("外来键与 menote 块并存时，menote 块不被劈成两半", () => {
    // 此前 head[0] 判断的是"第一行含不含 menote"，外来键在前就会误判 → 前置一个裸 menote
    const mixed = `---\ntitle: 外来标题\nmenote:\n  type: note\n---\n\n正文`;
    const updated = updateMenoteKeys(mixed, { tags: ["x"] });

    expect(updated.split("\n").filter((line) => line === "menote:")).toHaveLength(1);
    expect(updated).toContain("title: 外来标题");
    expect(updated).toContain("  type: note");
    const parsed = parseMenoteMeta(updated);
    expect(parsed.meta.type).toBe("note");
    expect(parsed.meta.tags).toEqual(["x"]);
    expect(parsed.meta.title).toBe("外来标题");
  });

  it("buildDocument 重建时把外来键顶在 menote 之前", () => {
    // 表格的单元格编辑与"降级为笔记"都会整篇重建，走的就是这一条
    const built = buildDocument(
      {
        type: "note",
        tags: ["x"],
        task: null,
        preservedLines: [],
        foreignLines: ["status: unread"],
      },
      "正文",
    );
    expect(built).toBe("---\nstatus: unread\ntags: [x]\nmenote:\n  type: note\n---\n\n正文");
  });

  it("只有外来键、没有 menote 子键时，不产出空的 menote: 映射", () => {
    const built = buildDocument(
      { type: null, tags: [], task: null, preservedLines: [], foreignLines: ["status: unread"] },
      "正文",
    );
    expect(built).toBe("---\nstatus: unread\n---\n\n正文");
  });
});

/**
 * 标题进 md（2026-10-04）：**md 为准，`items.title` 只是派生列**。
 *
 * 最要紧的是 `present` 这个三态——存量笔记 md 里没有 `title:` 键，
 * 必须**完全不受影响**（沿用列），否则一上线全库标题集体变空。
 */
describe("标题入档（顶层 title）", () => {
  it("deriveTitle：没有 title: 键 → 不接管", () => {
    expect(deriveTitle("# 正文\n\n没有 front matter")).toEqual({ present: false, value: null });
    expect(deriveTitle("---\nmenote:\n  type: note\n---\n\n正文")).toEqual({
      present: false,
      value: null,
    });
  });

  it("deriveTitle：有键且有值 → md 权威", () => {
    expect(deriveTitle('---\ntitle: "三体读书笔记"\n---\n\n正文')).toEqual({
      present: true,
      value: "三体读书笔记",
    });
  });

  it("deriveTitle：有键但空着 → present 为真、value 为 null（回落兜底）", () => {
    expect(deriveTitle("---\ntitle:\n---\n\n正文")).toEqual({ present: true, value: null });
    expect(deriveTitle('---\ntitle: ""\n---\n\n正文')).toEqual({ present: true, value: null });
  });

  it("写入与读回往返一致", () => {
    const updated = updateMenoteKeys("# 正文", { title: "读书笔记" });
    expect(updated).toBe('---\ntitle: 读书笔记\n---\n\n# 正文');
    expect(deriveTitle(updated).value).toBe("读书笔记");
  });

  it("含冒号 / 逗号的标题必须加引号，否则产出非法 YAML", () => {
    // YAML 纯量里 `: ` 会截断——`title: 第 3 章: 笔记` 直接是非法 YAML
    const updated = updateMenoteKeys("# 正文", { title: "第 3 章: 笔记, 重读" });
    expect(updated).toContain('title: "第 3 章: 笔记, 重读"');
    expect(deriveTitle(updated).value).toBe("第 3 章: 笔记, 重读");
  });

  it("改标题不动其它键（外来键与 menote 块都保住）", () => {
    const updated = updateMenoteKeys(OB, { title: "新标题" });
    expect(updated).toContain('title: 新标题');
    expect(updated).toContain('url: "https://x.com/akshay_pachaar/status/2035341800739877091"');
    expect(updated).toContain("status: unread");
    expect(deriveTitle(updated).value).toBe("新标题");
  });

  it("title: null 删掉键 → 回到「不接管」（交给 items.title 列）", () => {
    const withTitle = updateMenoteKeys("# 正文", { title: "临时" });
    expect(deriveTitle(withTitle).present).toBe(true);
    const removed = updateMenoteKeys(withTitle, { title: null });
    expect(deriveTitle(removed).present).toBe(false);
  });

  it("Memo 的 md 里不该出现 title: 键", () => {
    // buildDocument 的 meta 不带 title → 不写这一行（assertItemShape 要求 items.title 为 null）
    const memo = buildDocument({ type: "memo", tags: [], task: null, preservedLines: [], foreignLines: [] }, "随手记");
    expect(memo).not.toContain("title:");
    expect(deriveTitle(memo).present).toBe(false);
  });

  it("表格的 title 与 menote 块并存不冲突，且单元格编辑后仍保住", () => {
    const doc = renderTableDocument({
      columns: [{ id: "c1", name: "书名", type: "text" }],
      rowIdColumn: "_id",
      views: { default: "table" },
      rows: [{ _id: "aaa111", c1: "三体" }],
      attachments: [],
      notices: [],
      preservedLines: [],
      tags: ["书单"],
      title: "我的书单",
      foreignLines: [],
    });
    expect(doc).toContain("title: 我的书单");
    expect(doc).toContain("tags: [书单]");
    expect(doc).toContain("menote:\n  type: table");

    const parsed = parseTableDocument(doc);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.title).toBe("我的书单");
    expect(renderTableDocument(parsed.doc)).toContain("title: 我的书单");
  });
});

describe("Memo 转笔记的关联键（Q10）", () => {
  it("converted_to 能写出并读回", () => {
    const built = buildDocument(
      {
        type: "memo",
        tags: ["工作"],
        task: null,
        convertedTo: "01JCXNOTE0000000000000000",
        preservedLines: [],
        foreignLines: [],
      },
      "随手记",
    );
    expect(built).toContain("  converted_to: 01JCXNOTE0000000000000000");
    expect(parseMenoteMeta(built).meta.convertedTo).toBe("01JCXNOTE0000000000000000");
  });

  it("没有该键时读回 undefined（绝大多数条目如此）", () => {
    expect(parseMenoteMeta("---\nmenote:\n  type: memo\n---\n\n正文").meta.convertedTo).toBeUndefined();
  });

  it("改写：加键不破坏其它键；传 null 删键", () => {
    const source = "---\nmenote:\n  type: memo\n  tags: [工作]\n---\n\n随手记";

    const added = updateMenoteKeys(source, { convertedTo: "01JCXNOTE" });
    expect(added).toContain("  converted_to: 01JCXNOTE");
    expect(added).toContain("  tags: [工作]");
    expect(parseMenoteMeta(added).meta.tags).toEqual(["工作"]);

    const removed = updateMenoteKeys(added, { convertedTo: null });
    expect(removed).not.toContain("converted_to");
    expect(removed).toContain("  tags: [工作]");
  });
});

/**
 * 外来顶层键的读 / 写 / 删（2026-10-04，《笔记属性卡片》设计稿 §4-§5）。
 *
 * **核心底线是「按原格式」**：不把值解析成结构再拼回去（那才要引 YAML 库），
 * 只认出这个键占哪几行，然后把用户写的原文按原样写回同一位置。所以下面每条用例
 * 都在盯两件事：**形状不变**（块仍是块、单行仍是单行）与**原位**（不挪到别处）。
 */
describe("外来顶层键：读 / 写 / 删", () => {
  it("列出外来键，MeNote 自己的三个键不在其中", () => {
    const keys = readForeignKeys(OB);
    expect(keys.map((k) => k.key)).toEqual([
      "url",
      "author",
      "captured",
      "like",
      "comment",
      "status",
    ]);
    // title / tags 是 MeNote 的（各有专门的行），menote 是表格结构
    expect(keys.map((k) => k.key)).not.toContain("title");
    expect(keys.map((k) => k.key)).not.toContain("tags");
    expect(keys.map((k) => k.key)).not.toContain("menote");
  });

  it("认出单行与块两种形状，值是原文不加工", () => {
    const keys = readForeignKeys(OB);
    const url = keys.find((k) => k.key === "url");
    const author = keys.find((k) => k.key === "author");
    const comment = keys.find((k) => k.key === "comment");

    expect(url?.block).toBe(false);
    expect(url?.value).toBe('"https://x.com/akshay_pachaar/status/2035341800739877091"');
    // 块序列：子行连缩进一起原样给出（外来文件可能是 4 空格，剥掉再补就改了格式）
    expect(author?.block).toBe(true);
    expect(author?.value).toBe('  - "Unknown"');
    // 空值也是值，不能因为空就当没有这个键
    expect(comment?.value).toBe("");
  });

  it("没有外来键 / 没有 front matter 时返回空数组（不抛错）", () => {
    expect(readForeignKeys("# 正文")).toEqual([]);
    expect(readForeignKeys("---\ntitle: 只有标题\ntags: [a]\n---\n\n正文")).toEqual([]);
  });

  it("单行键原位改写：形状不变，其它键与 menote 块一字不动", () => {
    const next = writeForeignKey(OB, "status", { value: "read", block: false });

    expect(next).toContain("status: read");
    // 原位：url 仍在 author 之前
    expect(next.indexOf("url:")).toBeLessThan(next.indexOf("author:"));
    // 别人的值与块序列一字不改
    expect(next).toContain('author:\n  - "Unknown"');
    expect(next).toContain("captured: 2026-03-25");
    expect(next).toContain("正文第一段。");
  });

  it("块序列改写后仍是块序列（这是「按原格式」最容易被做坏的一条）", () => {
    const next = writeForeignKey(OB, "author", { value: '- "Alice"\n- "Bob"', block: true });

    expect(next).toContain('author:\n  - "Alice"\n  - "Bob"');
    // 写完仍是块（值行以缩进的 - 开头，不是 author: - "Alice"）
    expect(next).not.toContain('author: - "Alice"');
    expect(readForeignKeys(next).find((k) => k.key === "author")?.block).toBe(true);
  });

  it("引号与空格原样保留——不解析、不重新转义、不自动加引号", () => {
    const next = writeForeignKey(OB, "url", { value: "'https://a.b/c?x=1'", block: false });
    expect(next).toContain("url: 'https://a.b/c?x=1'");
  });

  it("键不存在时追加到外来段末尾，位置仍在 menote 块之前", () => {
    // OB 那篇没有 menote 块，所以拿一篇有块的来验位置
    const withBlock = '---\ntitle: T\nurl: u\nmenote:\n  type: note\n---\n\n正文';
    const next = writeForeignKey(withBlock, "rating", { value: "5", block: false });

    expect(next).toContain("rating: 5");
    expect(next.indexOf("rating:")).toBeLessThan(next.indexOf("menote:"));
    expect(parseMenoteMeta(next).meta.type).toBe("note");
  });

  it("外来文件用 4 空格缩进时，读写往返不改缩进", () => {
    const wide = '---\nauthor:\n    - "Alice"\n---\n\n正文';
    const key = readForeignKeys(wide).find((k) => k.key === "author");
    expect(key?.block).toBe(true);
    // 值带着原缩进，写回时原样落回——不能补成 2 格
    expect(writeForeignKey(wide, "author", { value: key?.value ?? "", block: true })).toContain(
      'author:\n    - "Alice"',
    );
  });

  it("删一个键：只删它自己和缩进子行，其余一字不动", () => {
    const next = removeForeignKey(OB, "author");

    expect(next).not.toContain("author");
    expect(next).not.toContain('- "Unknown"');
    expect(next).toContain("url:");
    expect(next).toContain("captured: 2026-03-25");
    expect(next).toContain("正文第一段。");
  });

  it("删 MeNote 自己的键要拒绝（menote 删了等于毁表格结构）", () => {
    for (const key of ["title", "tags", "menote"]) {
      expect(() => removeForeignKey(OB, key)).toThrow(/是 MeNote 自己的键/);
    }
  });

  it("键名非法要拒绝，并说清为什么（不是默默不写）", () => {
    for (const key of ["my key", "a:b", "", "带空格 的键"]) {
      expect(() => writeForeignKey(OB, key, { value: "x", block: false })).toThrow(/字母、数字/);
    }
  });

  it("撞上 MeNote 自己的键要拒绝，指向上面已有的行", () => {
    expect(() => writeForeignKey(OB, "title", { value: "x", block: false })).toThrow(
      /MeNote 自己的键/,
    );
  });

  it("单行值里含「: 」或「 #」要拒绝（写出去就是非法 YAML）", () => {
    expect(() => writeForeignKey(OB, "url", { value: "a: b", block: false })).toThrow(/引号/);
    expect(() => writeForeignKey(OB, "url", { value: "a # b", block: false })).toThrow(/引号/);
    // 块序列里缩进了，冒号不截断 —— 放行
    expect(() => writeForeignKey(OB, "author", { value: "- a: b", block: true })).not.toThrow();
    // 网址不带冒号加空格，安全
    expect(() => writeForeignKey(OB, "url", { value: "https://a.b/c", block: false })).not.toThrow();
  });

  it("frontmatterText 取出整段原文（含围栏与收尾换行），没有则为 null", () => {
    const text = frontmatterText(OB);
    expect(text?.startsWith("---\n")).toBe(true);
    expect(text?.endsWith("---\n")).toBe(true);
    expect(OB.startsWith(text ?? "x")).toBe(true);
    expect(frontmatterText("# 正文")).toBeNull();
  });

  it("外来键的往返：读 → 改 → 读，形状与位置都稳", () => {
    const edited = writeForeignKey(OB, "status", { value: "read", block: false });
    const keys = readForeignKeys(edited);
    expect(keys.find((k) => k.key === "status")?.value).toBe("read");
    expect(keys.find((k) => k.key === "author")?.value).toBe('  - "Unknown"');
    expect(parseMenoteMeta(edited).body.trim()).toBe("正文第一段。");
  });
});
