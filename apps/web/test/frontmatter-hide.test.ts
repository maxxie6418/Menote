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
import { EditorState } from "@codemirror/state";
import type { Decoration, DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  buildFrontmatterDecorations,
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

