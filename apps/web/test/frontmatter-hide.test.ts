// @vitest-environment jsdom
/**
 * 编辑器里藏 front matter（2026-10-04 建，2026-10-11 改成**整段零宽隐藏**）。
 *
 * 最要紧的一条是**「纯视觉」**：本模块只加装饰，文档内容与保存链路一字未动。
 * 这不是洁癖——菜单改标签/清单/标题时是直接改 md 的，编辑器若自己存一份 front matter
 * 副本再回贴，就会把那些刚写进去的改动抹回去。所以这里断言的是「doc 一字没变」。
 *
 * **jsdom 里建不出真的 `EditorView`**（CM6 要布局 API），所以断言只能落在两处：
 * ① 装饰集本身（`buildFrontmatterDecorations` 是刻意留出的纯函数）；
 * ② 扩展能不能装进 `EditorState`（StateField 不需要视图，`ViewPlugin` 才需要——
 *    v0.8.13 那次「点开页面什么都没有」正是用错了扩展类型，这条能钉住类型选对了）。
 */
import { EditorSelection, EditorState } from "@codemirror/state";
import type { Decoration, DecorationSet } from "@codemirror/view";
import { parseMenoteMeta } from "@menote/mdcore";
import { describe, expect, it } from "vitest";
import {
  buildFrontmatterDecorations,
  clampSelectionOut,
  frontmatterHide,
  frontmatterRange,
} from "../src/app/editor/frontmatter-hide";

const OB = `---
title: "Anatomy of the .claude/ folder"
url: "https://x.com/akshay_pachaar/status/2035341800739877091"
tags: [claude]
status: unread
---

正文第一段。
`;

const ME_NOTE = `---
title: 读书笔记
tags: [科幻, 长篇]
menote:
  type: note
---

正文。
`;

interface Piece {
  from: number;
  to: number;
  text: string;
  className: string | null;
  hasWidget: boolean;
}

/** 把装饰集摊成可断言的清单（与 `live-preview.test.ts` 同一手法） */
function pieces(doc: string, set: DecorationSet): Piece[] {
  const out: Piece[] = [];
  set.between(0, doc.length, (from, to, value) => {
    const spec = (value as Decoration).spec as { class?: string; widget?: unknown };
    out.push({
      from,
      to,
      text: doc.slice(from, to),
      className: spec.class ?? null,
      hasWidget: spec.widget !== undefined,
    });
  });
  return out;
}

describe("front matter 区间", () => {
  it("定位到结尾围栏之后（含那个换行）", () => {
    const range = frontmatterRange(OB);
    expect(range).not.toBeNull();
    // 藏起来的那一段正好是 `---` 到第二个 `---` 加换行
    expect(OB.slice(range?.from, range?.to)).toBe(
      '---\ntitle: "Anatomy of the .claude/ folder"\nurl: "https://x.com/akshay_pachaar/status/2035341800739877091"\ntags: [claude]\nstatus: unread\n---\n',
    );
  });

  it("没有 front matter → null（不隐藏）", () => {
    expect(frontmatterRange("正文第一段。")).toBeNull();
  });

  it("围栏没闭合 → null（用户可能正在写第一行，此时隐藏只是干扰）", () => {
    expect(frontmatterRange("---\ntitle: 写了一半\n\n正文。")).toBeNull();
  });

  it("首行不是 --- → null", () => {
    expect(frontmatterRange("正文\n---\n分隔线\n")).toBeNull();
  });

  it("MeNote 自己的笔记同样能定位", () => {
    const range = frontmatterRange(ME_NOTE);
    expect(ME_NOTE.slice(range?.from, range?.to)).toBe(
      "---\ntitle: 读书笔记\ntags: [科幻, 长篇]\nmenote:\n  type: note\n---\n",
    );
  });
});

describe("装饰：整段零宽藏起来，不留任何可点元素（设计 §7）", () => {
  it("恰好一个 replace，盖住整段 front matter，无 widget、无类名", () => {
    const all = pieces(OB, buildFrontmatterDecorations(OB));
    expect(all).toHaveLength(1);
    const [one] = all;
    expect(one?.from).toBe(0);
    expect(one?.to).toBe(frontmatterRange(OB)?.to);
    expect(one?.text.startsWith("---\n")).toBe(true);
    // 零宽替换：没有 widget 就没有 DOM，没有类名就没有样式——一个字都不显示
    expect(one?.hasWidget).toBe(false);
    expect(one?.className).toBeNull();
  });

  it("MeNote 自己的笔记一样被藏（含 menote: 块）", () => {
    const all = pieces(ME_NOTE, buildFrontmatterDecorations(ME_NOTE));
    expect(all).toHaveLength(1);
    expect(all[0]?.text).toContain("menote:");
  });

  it("没有 front matter → 一个装饰都不加（正文原样）", () => {
    const text = "正文第一段。";
    expect(pieces(text, buildFrontmatterDecorations(text))).toHaveLength(0);
  });

  it("围栏没闭合 → 一个装饰都不加（让正在写的那一行原样可见）", () => {
    const text = "---\ntitle: 写了一半\n\n正文。";
    expect(pieces(text, buildFrontmatterDecorations(text))).toHaveLength(0);
  });
});

/*
  判据只有一份（2026-10-11 收口）：`frontmatterRange` 已搬进 mdcore，编辑器与属性卡片用的是
  同一个函数。这之前两边各写一份，**同一天踩了两次**：

  1. 开头带 **BOM** 的文件——卡片照读（mdcore 摘 BOM），编辑器却把整段 YAML 露在正文里；
  2. 开头多一个**空行**（剪藏 / 导出工具的常见多余换行）——同一症状：这里从前要求 `---\n`
     精确开头，mdcore 要求首行 trim 后是 `---`，于是两边一起拒。

  所以下面这些用例钉的不再是「两份判据互相对齐」，而是**放宽后的那一条判据本身**：
  先摘 BOM → 允许若干空白行 → 首个非空行必须是裸的 `---` → 必须闭合。
*/
describe("判据：先摘 BOM、允许前导空行、必须闭合", () => {
  it("开头带 BOM 的文件照藏（藏掉的是 BOM 之后的 front matter，BOM 那一格留着）", () => {
    const text = `\uFEFF${OB}`;
    const range = frontmatterRange(text);
    expect(range).not.toBeNull();
    expect(range?.from).toBe(1);
    expect(text.slice(range?.from, range?.to)).toBe(
      '---\ntitle: "Anatomy of the .claude/ folder"\nurl: "https://x.com/akshay_pachaar/status/2035341800739877091"\ntags: [claude]\nstatus: unread\n---\n',
    );
  });

  it("CRLF 的文档照藏（首行那个 \\r 被 trim 吃掉）", () => {
    const text = "---\r\ntitle: x\r\n---\r\n\r\n正文。";
    const range = frontmatterRange(text);
    expect(text.slice(range?.from, range?.to)).toBe("---\r\ntitle: x\r\n---\r\n");
  });

  it("前导空行：照样认（剪藏 / 导出工具常多写一个空行），且空行也在隐藏区里", () => {
    const text = "\n---\ntitle: x\n---\n\n正文。";
    const range = frontmatterRange(text);
    expect(range).not.toBeNull();
    // 起点仍在文件开头：那个空行会被一并替换掉，所以这篇文件在第一次改动属性时自己恢复正常
    expect(range?.from).toBe(0);
    expect(text.slice(range?.from, range?.to)).toBe("\n---\ntitle: x\n---\n");
  });

  it("只含空白的行也照样认（整段藏掉，包括那几格空白）", () => {
    const text = "   \n---\ntitle: x\n---\n";
    const range = frontmatterRange(text);
    expect(range).not.toBeNull();
    expect(text.slice(range?.from, range?.to)).toBe(text);
  });

  /*
    不变式用例：**编辑器藏 = 解析认**。装饰集是否为空的充要条件就是「这篇有没有可认的 front matter」。
    这条能一次钉住整类偏差（BOM 那次正是被它之外的用例放过去的），所以样本要成对地覆盖「认」与「不认」两侧。
  */
  it("不变式：编辑器藏不藏，与 mdcore 认不认这段 front matter 同进同出", () => {
    const samples = [
      OB,
      ME_NOTE,
      "正文第一段。",
      "",
      "---",
      "---\n",
      "---\ntitle: x\n---\n",
      "---\ntitle: x\n---",
      `\uFEFF${OB}`,
      "\uFEFF---\ntitle: x\n---\n\n正文。",
      "---\r\ntitle: x\r\n---\r\n\r\n正文。",
      "\n---\ntitle: x\n---\n\n正文。",
      "\n\n---\ntitle: x\n---\n\n正文。",
      "   \n---\ntitle: x\n---\n",
      "\uFEFF\n---\ntitle: x\n---\n",
      "\n\n正文。",
      "  ---\ntitle: x\n---\n",
      "---\ntitle: 写了一半\n\n正文。",
      "正文\n---\n分隔线\n",
      "---\rtitle: x\r---\r正文。",
    ];

    for (const one of samples) {
      // mdcore 不认这段 front matter 时，body 就是原文一字不动
      const recognised = parseMenoteMeta(one).body !== one;
      const hidden = buildFrontmatterDecorations(one).size > 0;
      expect(hidden, JSON.stringify(one)).toBe(recognised);
    }
  });
});

describe("扩展能装进 EditorState（扩展类型必须是 StateField，见 v0.8.13 的事故）", () => {
  it("挂上后文档一字未变（纯视觉，保存链路不经过本模块）", () => {
    const state = EditorState.create({ doc: OB, extensions: [frontmatterHide()] });
    expect(state.doc.toString()).toBe(OB);
  });

  it("文档变了之后装饰跟着重算（文档首行不再是 --- 就不再藏）", () => {
    const state = EditorState.create({ doc: OB, extensions: [frontmatterHide()] });
    const next = state.update({ changes: { from: 0, to: 3, insert: "正文" } }).state;
    expect(next.doc.toString().startsWith("正文\ntitle:")).toBe(true);
  });
});


/**
 * 选区落进隐藏区时**只夹落进去的那一端**（v0.8.39）。
 *
 * 旧做法把整个选区换成隐藏区末尾的一个光标，于是"从正文往上拖到顶"和"Ctrl+A 全选"都变成
 * 光标在原地——用户报的"拖拽变成直接拖动光标位置"就是它（真机复现见
 * `docs/modules/MeNote-编辑器交互修复-设计-v1.md` §1.2）。
 *
 * 这里刻意把判定抽成纯函数 `clampSelectionOut`：jsdom 建不出 `EditorView`，
 * 但选区夹取与视图无关，能在这里逐条钉住。返回 `null` 表示"不用派发"（自激循环的防线）。
 */
describe("选区落进隐藏区：只夹落进去的那一端", () => {
  const hidden = frontmatterRange(OB);
  if (!hidden) throw new Error("样本应当有 front matter");

  it("光标落在隐藏区里 → 顶到隐藏区末尾", () => {
    const next = clampSelectionOut(EditorSelection.single(hidden.from + 2), hidden);
    expect(next?.main.from).toBe(hidden.to);
    expect(next?.main.to).toBe(hidden.to);
  });

  it("从正文往上拖进隐藏区 → 只夹那一端，选区保住（不塌成光标）", () => {
    const body = hidden.to + 20;
    const next = clampSelectionOut(EditorSelection.single(hidden.from + 3, body), hidden);
    expect(next?.main.from).toBe(hidden.to);
    expect(next?.main.to).toBe(body);
    expect(next?.main.empty).toBe(false);
  });

  it("Ctrl+A 形状的全选 → 变成选中可见正文（旧做法是选不上）", () => {
    const all = EditorSelection.single(0, OB.length);
    const next = clampSelectionOut(all, hidden);
    expect(next?.main.from).toBe(hidden.to);
    expect(next?.main.to).toBe(OB.length);
    expect(next?.main.empty).toBe(false);
  });

  it("选区整段都在隐藏区里 → 退成隐藏区末尾的光标（保持原行为）", () => {
    const next = clampSelectionOut(EditorSelection.single(hidden.from + 1, hidden.from + 3), hidden);
    expect(next?.main.empty).toBe(true);
    expect(next?.main.head).toBe(hidden.to);
  });

  it("选区本来就在隐藏区之外 → 不派发（null）", () => {
    expect(clampSelectionOut(EditorSelection.single(hidden.to + 5), hidden)).toBeNull();
    expect(clampSelectionOut(EditorSelection.single(hidden.to + 1, hidden.to + 9), hidden)).toBeNull();
  });

  it("已经夹到该在的位置 → 不派发（自激保护）", () => {
    expect(clampSelectionOut(EditorSelection.single(hidden.to), hidden)).toBeNull();
  });

  it("多光标各夹各的，主光标位置不变", () => {
    // 注意：这一版 `EditorSelection.cursor/range` 返回的是 **SelectionRange**（不是 EditorSelection），
    // 所以光标形状要用 `EditorSelection.single(...)`，多光标才用 `create([...SelectionRange])`。
    const selection = EditorSelection.create(
      [EditorSelection.cursor(hidden.from + 1), EditorSelection.cursor(OB.length)],
      1,
    );
    const next = clampSelectionOut(selection, hidden);
    expect(next?.ranges.length).toBe(2);
    expect(next?.ranges[0]?.head).toBe(hidden.to);
    expect(next?.ranges[1]?.head).toBe(OB.length);
    expect(next?.mainIndex).toBe(1);
  });
});
