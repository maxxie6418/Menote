// @vitest-environment jsdom
/**
 * 即时渲染（live preview）的装饰构建（2026-09-28 首期）。
 *
 * 全仓测试都**不能**创建真实的 `EditorView`（CM6 要布局 API，jsdom 跑不动），所以这一层
 * 刻意做成**纯函数** `buildLivePreviewDecorations(state, …) → DecorationSet`：
 * 只依赖 `EditorState` 与 Lezer 语法树，于是"哪些标记被藏了、活动行有没有露源码、
 * 列表/图片的 widget 长什么样"这些都能进 CI，不必靠肉眼。
 *
 * 覆盖首期的语法清单（与 `docs/modules/Menote-即时渲染-设计-v1.md` 的覆盖表一一对应）：
 * 标题 / 强调 / 删除线 / 行内代码 / 链接 / 引用 / 列表（含有序） / 分隔线 / 图片占位 / 代码块底色，
 * 以及**光标所在行显示源码**这条核心交互。
 */
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  activeRangeOf,
  buildLivePreviewDecorations,
} from "../src/app/editor/live-preview";

interface Piece {
  from: number;
  to: number;
  text: string;
  className: string | null;
  widget: WidgetType | null;
}

function makeState(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  // 短文档一次就能解析完；长文档第一段也够测试用（真浏览器里由插件按视口补解析）
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

/** 把装饰集摊成可断言的清单（文本 / 类名 / widget） */
function pieces(state: EditorState, set: DecorationSet): Piece[] {
  const out: Piece[] = [];
  set.between(0, state.doc.length, (from, to, value) => {
    const spec = (value as Decoration).spec as { class?: string; widget?: WidgetType };
    out.push({
      from,
      to,
      text: state.doc.sliceString(from, to),
      className: spec.class ?? null,
      widget: spec.widget ?? null,
    });
  });
  return out;
}

/**
 * 这次构建里被**藏掉**（replace 且无 widget、也无类名）的文本片段。
 *
 * 三个条件缺一不可：上样式的 `mark` 与行装饰的 `line` 都没有 widget，光看 widget 会把
 * "粗体文字""整行标题"也当成被藏起来的标记（第一版就是这么写错的）。
 */
function hidden(state: EditorState, doc: string, activeRange: { from: number; to: number } | null = null): string[] {
  const built = buildLivePreviewDecorations({
    state,
    from: 0,
    to: state.doc.length,
    activeRange,
  });
  return pieces(state, built.decorations)
    .filter((piece) => piece.widget === null && piece.className === null)
    .map((piece) => doc.slice(piece.from, piece.to));
}

function lineClasses(state: EditorState, doc: string): string[] {
  const built = buildLivePreviewDecorations({ state, from: 0, to: doc.length, activeRange: null });
  return pieces(state, built.decorations)
    .filter((piece) => piece.className !== null && piece.from === piece.to)
    .map((piece) => piece.className as string);
}

/**
 * 上样式的区间**在实际看到的文本上**长什么样：把区间里被藏掉的部分抠掉。
 *
 * 为什么要这样：`**粗体**` 的 `cm-live-strong` 是打在**整个节点**上的（`**` 在节点内部被 replace 掉），
 * 所以直接读区间文本会看到带标记的 `**粗体**`，而用户看到的是粗体的「粗体」。
 * 断言要盯的是**用户看到的东西**，不是装饰的内部区间。
 */
function visibleMarks(state: EditorState, doc: string): Array<{ text: string; className: string }> {
  const built = buildLivePreviewDecorations({ state, from: 0, to: doc.length, activeRange: null });
  const all = pieces(state, built.decorations);
  const hiddenRanges = all.filter((piece) => piece.widget === null && piece.className === null);

  return all
    .filter((piece) => piece.className !== null && piece.from !== piece.to)
    .map((piece) => {
      let text = "";
      for (let index = piece.from; index < piece.to; index += 1) {
        const covered = hiddenRanges.some((range) => index >= range.from && index < range.to);
        if (!covered) text += doc[index];
      }
      return { text, className: piece.className as string };
    });
}

function widgets(state: EditorState, doc: string): Array<{ text: string; node: HTMLElement }> {
  const built = buildLivePreviewDecorations({ state, from: 0, to: doc.length, activeRange: null });
  return pieces(state, built.decorations)
    .filter((piece) => piece.widget !== null)
    .map((piece) => ({
      text: doc.slice(piece.from, piece.to),
      // `WidgetType.toDOM` 的形参是 `EditorView`，但我们的占位块不用它——jsdom 里给个空壳即可
      node: piece.widget!.toDOM({} as EditorView),
    }));
}

describe("即时渲染：标记藏起来、内容留样式", () => {
  it("标题：`#` 与紧跟的空格一起藏起来，整行上 h2 样式（字号只用现有刻度）", () => {
    const doc = "## 小节标题\n\n正文";
    const state = makeState(doc);
    // 空格一起藏是有意的：不藏的话渲染出来的标题带一个前导空格，比"多藏一个字符"显眼得多
    expect(hidden(state, doc)).toEqual(["## "]);
    expect(lineClasses(state, doc)).toContain("cm-live-h2");
    expect(visibleMarks(state, doc)).toEqual([]);
  });

  it("强调：`**` 与 `*` 藏起来，文字分别上粗体/斜体", () => {
    const doc = "**粗体** 与 *斜体*";
    const state = makeState(doc);
    expect(hidden(state, doc)).toEqual(["**", "**", "*", "*"]);
    expect(visibleMarks(state, doc)).toEqual([
      { text: "粗体", className: "cm-live-strong" },
      { text: "斜体", className: "cm-live-em" },
    ]);
  });

  it("删除线：`~~` 藏起来（依赖 GFM 语法树——base 退回默认 CommonMark 这条会红）", () => {
    const doc = "~~删掉了~~";
    const state = makeState(doc);
    expect(hidden(state, doc)).toEqual(["~~", "~~"]);
    expect(visibleMarks(state, doc)).toEqual([{ text: "删掉了", className: "cm-live-strike" }]);
  });

  it("行内代码：反引号藏起来，内容上等宽底色", () => {
    const doc = "看看 `const a = 1` 这段";
    const state = makeState(doc);
    expect(hidden(state, doc)).toEqual(["`", "`"]);
    expect(visibleMarks(state, doc)).toEqual([{ text: "const a = 1", className: "cm-live-code" }]);
  });

  it("链接：`[label](url)` 只留 label，地址与括号都藏起来", () => {
    const doc = "见 [文档](https://example.com/a) 一节";
    const state = makeState(doc);
    expect(hidden(state, doc)).toEqual(["[", "]", "(", "https://example.com/a", ")"]);
    expect(visibleMarks(state, doc)).toEqual([{ text: "文档", className: "cm-live-link" }]);
  });

  it("附件长这样：地址里的 sha256 不许露在界面上（M4 界面稿 §7.4）", () => {
    const sha = "a".repeat(64);
    const doc = `[报告.pdf](/api/attachments/h/${sha})`;
    const state = makeState(doc);
    expect(hidden(state, doc)).toEqual(["[", "]", "(", `/api/attachments/h/${sha}`, ")"]);
    expect(visibleMarks(state, doc)).toEqual([{ text: "报告.pdf", className: "cm-live-link" }]);
  });

  it("裸 URL 与自动链接：文字留着（它本身就是要读的内容），只上链接样式", () => {
    const doc = "看 https://example.com 与 <https://b.example>";
    const state = makeState(doc);
    const marks = visibleMarks(state, doc);
    expect(marks.some((mark) => mark.text.includes("https://example.com"))).toBe(true);
    expect(hidden(state, doc)).toEqual(["<", ">"]);
  });

  it("引用：`>` 与紧跟的空格藏起来，整行左侧一条竖线", () => {
    const doc = "> 先引用一行\n\n正文";
    const state = makeState(doc);
    expect(hidden(state, doc)).toEqual(["> "]);
    expect(lineClasses(state, doc)).toContain("cm-live-quote");
  });

  it("无序列表：项目符号换成 `•`（widget）；有序列表的数字保留", () => {
    const doc = "- 一条\n- 两条\n\n1. 有序";
    const state = makeState(doc);
    const bullets = widgets(state, doc);
    expect(bullets.map((item) => item.text)).toEqual(["-", "-"]);
    expect(bullets.map((item) => item.node.textContent)).toEqual(["•", "•"]);
    // 有序列表的 `1.` 既没被藏、也没有 widget
    expect(hidden(state, doc)).toEqual([]);
  });

  it("分隔线：`---` 藏起来，整行上边框当那条线", () => {
    const doc = "上\n\n---\n\n下";
    const state = makeState(doc);
    expect(hidden(state, doc)).toEqual(["---"]);
    expect(lineClasses(state, doc)).toContain("cm-live-hr");
  });

  it("图片：换成一个占位块，文案只带 alt（上传中的 alt 就是状态）", () => {
    const doc = "![上传中：照片.png](#pending-1)";
    const state = makeState(doc);
    const items = widgets(state, doc);
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe(doc);
    expect(items[0]?.node.textContent).toContain("上传中：照片.png");
    // 地址（含占位标记）不该出现在界面上
    expect(items[0]?.node.textContent).not.toContain("#pending-1");
  });

  /*
    图片内联（编辑器专项优化 P2-3，即时渲染设计 §七-4 销账）：真实地址渲染真图（懒加载）、
    加载失败降级成可见占位、外链照常；sha 是内部标识，不进界面文字。
  */
  it("图片内联：真实地址渲染 <img>（懒加载），sha 不进界面文字", () => {
    const sha = "a".repeat(64);
    const doc = `![工作截图](/api/attachments/h/${sha})`;
    const state = makeState(doc);
    const items = widgets(state, doc);
    expect(items).toHaveLength(1);
    const img = items[0]?.node.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(`/api/attachments/h/${sha}`);
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(items[0]?.node.textContent).not.toContain(sha);
  });

  it("图片内联：加载失败降级成可见占位，不静默烂图", () => {
    const doc = `![坏图](/api/attachments/h/${"b".repeat(64)})`;
    const state = makeState(doc);
    const node = widgets(state, doc)[0]?.node as HTMLElement;
    node.querySelector("img")?.dispatchEvent(new Event("error"));
    expect(node.className).toContain("cm-live-img--broken");
    expect(node.textContent).toContain("坏图");
  });

  it("图片内联：外链地址照常渲染", () => {
    const doc = "![外部](https://example.com/a.png)";
    const state = makeState(doc);
    const img = widgets(state, doc)[0]?.node.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://example.com/a.png");
  });

  it("代码块：围栏与语言保持源码可见，只给行底色（首期不做语言高亮）", () => {
    const doc = "```js\nconst a = 1;\n```";
    const state = makeState(doc);
    expect(hidden(state, doc)).toEqual([]);
    expect(lineClasses(state, doc).filter((name) => name === "cm-live-codeblock")).toHaveLength(3);
  });

  it("表格：源码原样保留（首期有意不做内联表格）", () => {
    const doc = "| A | B |\n| - | - |\n| 1 | 2 |";
    const state = makeState(doc);
    expect(hidden(state, doc)).toEqual([]);
    expect(widgets(state, doc)).toEqual([]);
  });
});

describe("即时渲染：光标所在行显示源码", () => {
  const doc = "# 标题\n\n**粗体** 与 `代码`\n\n- 列表";

  it("光标在强调那一行：那一行的标记不藏，别的行照藏", () => {
    const state = makeState(doc);
    const line3 = state.doc.line(3);
    const hiddenInLine3 = hidden(state, doc, { from: line3.from, to: line3.to });

    // 第 3 行的 `**` 与反引号都露出来了；第 1 行的 `# ` 仍然藏着
    expect(hiddenInLine3).toEqual(["# "]);
  });

  it("光标在列表那一行：项目符号回到源码（不给 widget），标题仍然渲染", () => {
    const state = makeState(doc);
    const line5 = state.doc.line(5);
    const built = buildLivePreviewDecorations({
      state,
      from: 0,
      to: doc.length,
      activeRange: { from: line5.from, to: line5.to },
    });
    const all = pieces(state, built.decorations);
    expect(all.some((piece) => piece.widget !== null)).toBe(false);
    expect(all.some((piece) => piece.className === "cm-live-h1")).toBe(true);
  });

  it("跨行选区：选区覆盖的行都露源码（复制出来仍是带标记的 md）", () => {
    const state = makeState(doc);
    const from = state.doc.line(3).from;
    const to = state.doc.line(5).to;
    expect(hidden(state, doc, { from, to })).toEqual(["# "]);
  });

  it("`activeRangeOf`：单光标就是那一行；跨行选区是整个跨度", () => {
    const state = makeState(doc);
    const single = state.update({ selection: { anchor: state.doc.line(3).from + 2 } }).state;
    expect(activeRangeOf(single)).toEqual({
      from: single.doc.line(3).from,
      to: single.doc.line(3).to,
    });

    const multi = state.update({
      selection: { anchor: state.doc.line(3).from, head: state.doc.line(5).to },
    }).state;
    expect(activeRangeOf(multi)).toEqual({
      from: multi.doc.line(3).from,
      to: multi.doc.line(5).to,
    });
  });
});

describe("即时渲染：原子区间", () => {
  it("藏掉的标记同时进 `atomic`（方向键与退格不许钻进去）", () => {
    const doc = "**粗体**";
    const state = makeState(doc);
    const built = buildLivePreviewDecorations({ state, from: 0, to: doc.length, activeRange: null });

    const atomicText = pieces(state, built.atomic).map((piece) => doc.slice(piece.from, piece.to));
    expect(atomicText).toEqual(["**", "**"]);
    // 只是上样式的文字（粗体内容）不能进原子区间，否则光标跨不过去
    expect(atomicText).not.toContain("粗体");
  });

  it("空文档 / 全空行不炸，返回空装饰", () => {
    const state = makeState("");
    const built = buildLivePreviewDecorations({ state, from: 0, to: 0, activeRange: null });
    expect(built.decorations.size).toBe(0);
    expect(built.atomic.size).toBe(0);
  });
});

/*
  任务清单复选框（编辑器专项优化 P2-1，即时渲染设计 §七-6 销账）：
  `TaskMarker` 换成真复选框 widget、任务项的列表符号让位、光标行保持源码。
  点击改文档的逻辑在 widget 的事件回调里（要真视图），纯函数层只钉"装饰长什么样"。
*/
describe("即时渲染：任务清单复选框", () => {
  it("TaskMarker 换成复选框 widget，勾选状态跟文档走", () => {
    const doc = "- [ ] 待办：买牛奶\n- [x] 已办结";
    const state = makeState(doc);
    const built = buildLivePreviewDecorations({ state, from: 0, to: doc.length, activeRange: null });

    const boxes = pieces(state, built.decorations).filter((piece) => piece.widget !== null && piece.from !== piece.to && doc.slice(piece.from, piece.to).startsWith("["));
    expect(boxes).toHaveLength(2);
    const widgets = boxes.map((piece) => piece.widget as unknown as { checked: boolean; lineNumber: number });
    expect(widgets[0]).toMatchObject({ checked: false, lineNumber: 1 });
    expect(widgets[1]).toMatchObject({ checked: true, lineNumber: 2 });
  });

  it("任务项的列表符号整个让位（不再渲染 •）", () => {
    const doc = "- [ ] 待办：买牛奶\n- 普通项";
    const state = makeState(doc);
    const built = buildLivePreviewDecorations({ state, from: 0, to: doc.length, activeRange: null });

    const hiddenText = pieces(state, built.decorations)
      .filter((piece) => piece.widget === null && piece.className === null)
      .map((piece) => doc.slice(piece.from, piece.to));
    // 第一行的 `- `（符号 + 空格）藏掉；第二行是普通项，`-` 由 • widget 替换、不算"藏"
    expect(hiddenText).toContain("- ");
    expect(hiddenText).not.toContain("[ ]");
  });

  it("光标（活动行）落在任务行时保持源码", () => {
    const doc = "- [ ] 待办：买牛奶";
    const state = makeState(doc);
    const built = buildLivePreviewDecorations({
      state,
      from: 0,
      to: doc.length,
      activeRange: { from: 0, to: doc.length },
    });
    expect(built.decorations.size).toBe(0);
  });

  it("复选框进原子区间（退格不许钻进去）", () => {
    const doc = "- [ ] 待办";
    const state = makeState(doc);
    const built = buildLivePreviewDecorations({ state, from: 0, to: doc.length, activeRange: null });
    const atomicText = pieces(state, built.atomic).map((piece) => doc.slice(piece.from, piece.to));
    expect(atomicText).toContain("[ ]");
    expect(atomicText).toContain("- ");
  });

  /*
    代码块高亮区间（编辑器专项优化 P2-2）：纯函数只负责把插件层算好的 token 区间
    拼成 mark 装饰——上色不藏内容、**不进原子区间**（光标停在 token 上是合法的）。
  */
  it("codeTokenMarks 拼成上色 mark，不进原子区间", () => {
    const doc = "```js\nconst x = 1;\n```";
    const state = makeState(doc);
    const built = buildLivePreviewDecorations({
      state,
      from: 0,
      to: doc.length,
      activeRange: null,
      codeTokenMarks: [{ from: 6, to: 11, className: "tok-keyword" }],
    });
    const marks = pieces(state, built.decorations).filter(
      (piece) => piece.className !== null && piece.from !== piece.to,
    );
    expect(marks.some((piece) => piece.className === "tok-keyword" && piece.text === "const")).toBe(true);
    const atomicText = pieces(state, built.atomic).map((piece) => doc.slice(piece.from, piece.to));
    expect(atomicText).not.toContain("const");
  });
});
