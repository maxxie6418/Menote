/**
 * 即时渲染（live preview）：正文直接呈现渲染样式，**光标进到标记里才显现那一小段源码**。
 *
 * 这是 `wiki/` 里早已定下的需求与技术路线，不是新发明：
 * - 设计文档 §7.1：类 Typora / Obsidian 的即时渲染，四档编辑模式之一（默认仍是双栏）；
 * - 项目架构 §3.3：**基于 Lezer 语法树的装饰**（`Decoration.replace` / `widget`），
 *   **只对视口内的节点计算装饰**。
 *
 * 「光标所在行显示源码」已于 v0.8.37 按《编辑器体验优化设计 v1》§2 收窄为
 * 「**光标落进某个标记 → 显现包含该标记的最小受支持节点**」（设计稿 §2.3）：
 * 光标停在内容文字里（哪怕停在已经格式化过的文字内部）语法保持渲染，
 * 停在 `**` / `[` / `#` 这类被藏起来的标记里时才回那一小段源码。
 *
 * 三条实现纪律（每条都对应一个真实的坑）：
 * 1. **只算视口**：Lezer 的树是**懒解析**的（建 state 后只覆盖开头一小段），所以插件里用
 *    `ensureSyntaxTree(state, 视口末端, 预算)` 把可见区补上；预算不够就退回部分树——
 *    那一屏先按源码显示，下一帧再渲染。**不要对整篇算装饰**。另见插件类上的
 *    「重算时机」表：打字路径还要等停手 90ms 才重算。
 * 2. **中文输入法**：`view.composing` 期间**不重算**装饰，只把已有装饰按变更映射
 *    （`RangeSet.map`）。重算会把输入法正在组合的字/候选区替换掉，中文优先的产品不能踩这条。
 * 3. **不给隐藏标记挂 `atomicRanges`**（v0.8.37 起）：标记本身已随光标显现，方向键与退格
 *    可以正常走过去、也看得见自己停在哪。挂成原子区间反而让上面那条规则**永远触发不了**
 *    ——`atomicRanges` 是在 `moveByChar` / 鼠标选区的 `skipAtoms` 里被跳过的，
 *    光标根本进不到标记内部（§4.2 的结论）。
 *
 * 首期（2026-09-28）覆盖**文本级**元素：标题 / 强调 / 删除线 / 行内代码 / 链接 / 引用 /
 * 列表 / 分隔线 / 代码块底色；**图片给占位块**。表格与代码围栏保持源码——
 * 逐项覆盖表与后续计划见 `docs/modules/Menote-即时渲染-设计-v1.md`。
 */
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { highlightSpans, type TokenSpan } from "./code-highlight";
import { HEADING_CLASSES, childrenOf, revealSpansFor } from "./live-preview-reveal";
import { searchPanelOpen } from "@codemirror/search";

/** 补解析的时间预算（超出就先用部分树；与 CM6 自带高亮器同一量级） */
const PARSE_BUDGET_MS = 50;

/**
 * 标记类节点：即时渲染把它们藏起来，只留内容。
 *
 * **`CodeMark` 不在这一组**（它同时用于行内代码与代码围栏，处理方式不同）：见下面 switch 里的
 * `CodeMark` 分支——行内代码的反引号藏起来，**代码块的围栏保留可见**（首期不做围栏折叠）。
 */
const HIDDEN_MARKS = new Set(["HeaderMark", "EmphasisMark", "StrikethroughMark", "QuoteMark"]);

/**
 * 内容类节点 → 装饰类名。
 *
 * **不给表格与代码围栏做装饰**（首期有意不做）：它们的源码原样保留，
 * 免得"看着像表格但不能编辑"这种半成品。
 */
const CONTENT_CLASSES: Record<string, string> = {
  StrongEmphasis: "cm-live-strong",
  Emphasis: "cm-live-em",
  Strikethrough: "cm-live-strike",
  InlineCode: "cm-live-code",
};

/**
 * 标题层级 → 行装饰类名：`HEADING_CLASSES` 在 `./live-preview-reveal`（认"标题节点的标记属主"
 * 也要用这张表，**同一份表只能有一处**）。
 *
 * 字号只用现有 6 档刻度（`tokens.css` 的 `--fs-display/title/body-lg/body/small/micro`），
 * 不新增令牌、不写裸 px：h1 20 / h2 17 / h3 14 / h4 13 / h5 12 / h6 11。
 * h5/h6 比正文小是刻意的（与 Obsidian 一致：小标题本就比正文小）。
 */

/** 列表的项目符号（换成 `•`）；有序列表的数字保留——数字本身有信息量 */
const BULLET_MARKS = new Set(["-", "*", "+"]);

/** 链接的样式（内联链接给 label，裸 URL 给自己） */
const linkMark = Decoration.mark({ class: "cm-live-link" });
/** 引用行的行样式（左侧一条竖线） */
const quoteLine = Decoration.line({ class: "cm-live-quote" });
/** 代码块的行样式（底色；围栏与语言保持源码可见） */
const codeBlockLine = Decoration.line({ class: "cm-live-codeblock" });
/** 分隔线所在行（藏掉 `---` 之后靠它画一条线） */
const ruleLine = Decoration.line({ class: "cm-live-hr" });

/** 项目符号占位 */
class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-bullet";
    span.textContent = "•";
    return span;
  }
}

/**
 * 图片占位块（首期不做内联图片）。
 *
 * **只显示 alt 文本**：alt 里本来就带着附件状态（上传中写的是「上传中：文件名」），
 * 而地址里的 sha256 是内部标识，界面不该出现（M4 界面稿 §7.4）。
 */
class ImagePlaceholderWidget extends WidgetType {
  readonly alt: string;

  constructor(alt: string) {
    super();
    this.alt = alt;
  }

  override eq(other: ImagePlaceholderWidget): boolean {
    return other.alt === this.alt;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-image";
    span.textContent = this.alt.trim() === "" ? "图片" : `图片 · ${this.alt}`;
    span.title = "图片暂不内联显示；光标移到这一行可以看源码";
    return span;
  }
}

/**
 * 任务清单的真复选框（编辑器专项优化 P2-1；即时渲染设计 §七-6 销账）。
 *
 * `TaskMarker`（`- [ ]` 里的 `[ ]` 三个字符）换成一枚真复选框，点击即改文档（`[ ]` ⇄ `[x]`）
 * ——DESIGN.md 禁止"点了没反应"的控件，所以首期宁可保持源码也不放假框。
 * 点击后走一次正常的文档变更：自动保存、撤销、同步整条链路照旧。
 *
 * 行号在**构建装饰时**记下，点击时按行号**重新定位**标记（期间文档可能已位移，
 * 位置不可信；行内的任务标记正则只有一份，与命令层的 `task-list` 语义一致）。
 */
class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly lineNumber: number,
  ) {
    super();
  }

  override eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked && other.lineNumber === this.lineNumber;
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-task-checkbox";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.setAttribute("aria-label", this.checked ? "取消完成这条任务" : "勾选完成这条任务");
    box.addEventListener("click", (event) => {
      if (view.state.readOnly) {
        event.preventDefault();
        return;
      }
      // 原生勾选立即生效；90ms 后的重建会用文档里的真实状态重画这一枚
      const line = view.state.doc.line(Math.min(this.lineNumber, view.state.doc.lines));
      const match = TASK_MARKER_RE.exec(line.text);
      if (!match) return;
      const at = line.from + (match[1]?.length ?? 0);
      view.dispatch({
        changes: { from: at, to: at + 1, insert: match[2] === " " ? "x" : " " },
        userEvent: "input",
      });
    });
    wrap.append(box);
    return wrap;
  }
}

/** 行内任务标记的唯一正则（引用块与多级列表里的也算）；与命令层的语义一致 */
const TASK_MARKER_RE = /^((?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\])/;

/**
 * 内联图片（编辑器专项优化 P2-3，即时渲染设计 §七-4 销账）。
 *
 * 真实地址（`/api/attachments/h/<sha>` 或外链）→ 渲染**真图**：懒加载（同预览的
 * `loading="lazy"` 口径）、加载失败降级成虚线占位（可见、可读，不静默烂图）。
 * 地址里的 sha 是内部标识，**不进界面文字**（M4 界面稿 §7.4）——只进 `src`，
 * 用户可见的文字只有 alt（title）。
 *
 * 上传中的 `#pending` 占位**不**走这里：地址还不是真的，保持原有的文字占位块
 * （alt 就是「上传中：文件名」），上传完成队列会把地址换成真实 sha，widget 随之换图。
 */
class ImageInlineWidget extends WidgetType {
  constructor(
    readonly alt: string,
    readonly src: string,
  ) {
    super();
  }

  override eq(other: ImageInlineWidget): boolean {
    return other.alt === this.alt && other.src === this.src;
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-live-img";
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    if (this.alt !== "") img.title = this.alt;
    /* 属性用 setAttribute：`loading` 属性在 jsdom 里不反射，测试要能断言到它 */
    img.setAttribute("loading", "lazy");
    img.setAttribute("decoding", "async");
    /* 失败可见（DESIGN §6.1 错误态）：虚线框 + 保留 alt 文字，不静默 */
    img.addEventListener("error", () => {
      wrap.classList.add("cm-live-img--broken");
      const note = document.createElement("span");
      note.className = "cm-live-img__alt";
      note.textContent = this.alt === "" ? "图片" : this.alt;
      wrap.append(note);
    });
    img.addEventListener("load", () => wrap.classList.remove("cm-live-img--broken"));
    wrap.append(img);
    return wrap;
  }
}

const bulletWidget = Decoration.replace({ widget: new BulletWidget() });

export interface LivePreviewInput {
  state: EditorState;
  /** 装饰区间（浏览器里是视口；测试里可传全文） */
  from: number;
  to: number;
  /**
   * 要**显现源码**的位置（设计稿 §2.3）。通常只有一个：折叠光标所在的位置。
   *
   * 位置落进某个隐藏标记的**半开区间** `[from, to)` 时，显现「包含该标记的最小受支持节点」
   * 的全部标记（嵌套时显现最内层）；位置在内容文字里时什么都不显现——这就是
   * 「光标停在已格式化的文字内部也保持渲染」。
   */
  revealAt: readonly number[];
  /**
   * 代码块的语法高亮区间（P2-2，**绝对坐标**）：由插件层异步算好（`code-highlight.ts`）
   * 传进来，纯函数只负责拼装成 mark 装饰。不进 `atomicRanges`——它们只是上色，
   * 光标停进去是合法的。语言不支持 / 还没加载完时调用方不传，代码保持纯文本。
   */
  codeTokenMarks?: ReadonlyArray<{ from: number; to: number; className: string }>;
  /**
   * 已补解析的语法树（v0.8.25 可选）：插件层在一次重建里要把**同一棵树**喂给
   * 装饰构建与代码块收集——各自 `ensureSyntaxTree` 会把补解析预算付两遍（重文档
   * 挂载最多多 50ms）。纯函数自己也会在没传时兜底取树（jsdom 用例不传照样能跑）。
   */
  tree?: ReturnType<typeof syntaxTree>;
}

export interface LivePreviewDecorations {
  /** 作用于文档的装饰 */
  decorations: DecorationSet;
}

/**
 * **纯函数**：`EditorState` + 区间 → 装饰集。
 *
 * 单独抽出来的理由（重要）：全仓测试都把 CodeMirror 整个 mock 掉（真实 CM6 要布局 API，
 * jsdom 跑不动），而"哪些标记被藏了、光标进标记有没有露源码"这条逻辑必须能进 CI。
 * 装饰构建只依赖 state 与语法树，不需要视图，所以能在 jsdom 里逐条断言。
 */
export function buildLivePreviewDecorations(input: LivePreviewInput): LivePreviewDecorations {
  const { state, from, to, revealAt, codeTokenMarks, tree: prebuiltTree } = input;
  const tree = prebuiltTree ?? (ensureSyntaxTree(state, to, PARSE_BUDGET_MS) ?? syntaxTree(state));
  const doc = state.doc;
  const ranges: Range<Decoration>[] = [];
  const reveal = revealSpansFor(tree, from, to, doc, revealAt);

  /** 这一段标记要按源码显现吗（§2.3：光标落在它里面） */
  const isRevealed = (start: number, stop: number): boolean =>
    reveal.some((span) => span.from <= start && stop <= span.to);

  const hide = (start: number, end: number, prefix = false): void => {
    const stop = prefix && doc.sliceString(end, end + 1) === " " ? end + 1 : end;
    if (stop <= start || isRevealed(start, stop)) return;
    ranges.push(Decoration.replace({}).range(start, stop));
  };

  /**
   * 藏标记时**连它后面那个空格一起藏**（标题 `## ` 与引用 `> `）。
   *
   * 不藏那个空格的话，渲染出来的标题/引用会带一个前导空格——比"少藏一个字符"显眼得多。
   * 列表名目不需要（`- ` 的空格正好是 `•` 与文字之间的间距）。
   */
  const hideMarkWithSpace = (start: number, end: number): void => hide(start, end, true);

  const addLine = (lineDecoration: Decoration, pos: number): void => {
    ranges.push(lineDecoration.range(doc.lineAt(Math.min(pos, doc.length)).from));
  };

  /** 内联链接 `[label](url)` 的 label 区间；不是内联链接时返回 null */
  const inlineLabelRange = (link: { from: number; to: number; firstChild: unknown }): {
    from: number;
    to: number;
  } | null => {
    if (doc.sliceString(link.from, Math.min(link.from + 1, link.to)) !== "[") return null;
    const marks: Array<{ from: number; to: number }> = [];
    let child = link.firstChild as { name: string; from: number; to: number; nextSibling: unknown } | null;
    while (child) {
      if (child.name === "LinkMark") marks.push({ from: child.from, to: child.to });
      child = child.nextSibling as typeof child;
    }
    const first = marks[0];
    const second = marks[1];
    return first && second ? { from: first.to, to: second.from } : null;
  };

  tree.iterate({
    from,
    to,
    enter: (node) => {
      const heading = HEADING_CLASSES[node.name];
      if (heading) {
        addLine(Decoration.line({ class: heading }), node.from);
        return;
      }

      const contentClass = CONTENT_CLASSES[node.name];
      if (contentClass) {
        ranges.push(Decoration.mark({ class: contentClass }).range(node.from, node.to));
        return;
      }

      if (HIDDEN_MARKS.has(node.name)) {
        // 标题 `##` 与引用 `>` 后面那个空格一起藏（否则渲染结果带前导空格）
        if (node.name === "HeaderMark" || node.name === "QuoteMark") {
          hideMarkWithSpace(node.from, node.to);
        } else {
          hide(node.from, node.to);
        }
        return;
      }

      switch (node.name) {
        case "CodeMark": {
          // 行内代码的反引号藏起来；**代码块的围栏保留**（藏了会在块头留一个空行，很难看）
          if (node.node.parent?.name !== "FencedCode") hide(node.from, node.to);
          return;
        }
        case "Blockquote": {
          // 引用的每一行都画左侧竖线（跨多行的引用也成立）
          const last = doc.lineAt(Math.min(node.to, doc.length));
          for (let line = doc.lineAt(node.from); line.number <= last.number; line = doc.line(line.number + 1)) {
            addLine(quoteLine, line.from);
            if (line.number === last.number) break;
          }
          return;
        }
        case "FencedCode": {
          const last = doc.lineAt(Math.min(node.to, doc.length));
          for (let line = doc.lineAt(node.from); line.number <= last.number; line = doc.line(line.number + 1)) {
            addLine(codeBlockLine, line.from);
            if (line.number === last.number) break;
          }
          return;
        }
        case "HorizontalRule": {
          hide(node.from, node.to);
          addLine(ruleLine, node.from);
          return;
        }
        case "Image": {
          if (isRevealed(node.from, node.to)) return; // 光标进到图片语法里：整段看源码（含地址）
          const alt = altOf(doc, node.from, node.to);
          const urlNode = childrenOf(node.node).find((child) => child.name === "URL");
          const raw = urlNode ? doc.sliceString(urlNode.from, urlNode.to) : "";
          // 尖括号包地址（`![a](<u x>)`）剥掉壳；`#pending`/空地址是上传中占位，保持文字占位块
          const src = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
          const isPending = src === "" || src.includes("#pending") || src.startsWith("#");
          ranges.push(
            Decoration.replace({
              widget: isPending ? new ImagePlaceholderWidget(alt) : new ImageInlineWidget(alt, src),
            }).range(node.from, node.to),
          );
          return;
        }
        case "ListMark": {
          const text = doc.sliceString(node.from, node.to);
          /*
            任务清单项的符号整个让位给复选框（P2-1）：`• ☐ 待办` 会让人以为有**两级**列表，
            Obsidian / Typora 都是"任务项只有复选框"。父级 `ListItem` 带 `Task` 子节点即任务项。
          */
          if (node.node.parent?.getChild("Task")) {
            hideMarkWithSpace(node.from, node.to);
            return;
          }
          if (BULLET_MARKS.has(text)) {
            if (isRevealed(node.from, node.to)) return;
            ranges.push(bulletWidget.range(node.from, node.to));
          }
          return;
        }
        case "TaskMarker": {
          // 任务复选框（P2-1）：光标进到 `[x]` 里面时看源码，与其余替换同一口径
          if (isRevealed(node.from, node.to)) return;
          const marker = doc.sliceString(node.from, node.to);
          ranges.push(
            Decoration.replace({
              widget: new TaskCheckboxWidget(/x/i.test(marker), doc.lineAt(node.from).number),
            }).range(node.from, node.to),
          );
          return;
        }
        case "Link": {
          const label = inlineLabelRange(node.node);
          if (label) {
            ranges.push(linkMark.range(label.from, label.to));
            // 方括号与地址一起藏起来（地址里的 sha256 是内部标识，界面上不该出现）
            for (const child of childrenOf(node.node)) {
              if (child.name === "LinkMark" || child.name === "URL") hide(child.from, child.to);
            }
          }
          return;
        }
        case "Autolink": {
          // `<https://…>`：语法树是独立的 `Autolink` 节点（不是 `Link`），只藏尖括号，
          // 地址本身就是要显示的文字
          for (const child of childrenOf(node.node)) {
            if (child.name === "LinkMark") hide(child.from, child.to);
          }
          const url = node.node.getChild("URL");
          if (url) ranges.push(linkMark.range(url.from, url.to));
          return;
        }
        case "URL": {
          // 裸 URL（GFM autolink）：父级不是 Link，文字本身要留着，只上链接样式
          if (node.node.parent?.name !== "Link") ranges.push(linkMark.range(node.from, node.to));
          return;
        }
        default:
          return;
      }
    },
  });

  /*
    代码块高亮区间（P2-2）最后拼进去：它们是纯上色的 mark，不隐藏内容，光标停进去是合法的。
    坐标由插件层换算好（绝对坐标），这里不认识"第几个围栏"。
  */
  if (codeTokenMarks) {
    for (const mark of codeTokenMarks) {
      if (mark.to > mark.from && mark.to <= doc.length) {
        ranges.push(Decoration.mark({ class: mark.className }).range(mark.from, mark.to));
      }
    }
  }

  return { decorations: Decoration.set(ranges, true) };
}

/** 图片的 alt：`![alt](url)` 里两个 LinkMark 之间的内容（没有就空串） */
function altOf(doc: EditorState["doc"], from: number, to: number): string {
  const text = doc.sliceString(from, to);
  const matched = /^!\[([\s\S]*?)\]/.exec(text);
  return (matched?.[1] ?? "").replace(/\n/g, " ").trim();
}

/**
 * 视口里的一个代码块：语言、代码文本与**内容区**的文档起点。
 * token 区间是相对代码文本的，落盘时要加上 `contentFrom`。
 */
interface FenceSpan {
  lang: string;
  code: string;
  contentFrom: number;
}

const FENCE_INFO_RE = /^[ \t]*(?:`{3,}|~{3,})\s*([A-Za-z0-9_+#-]*)/;
const FENCE_MARK_RE = /^[ \t]*(?:`{3,}|~{3,})/;

/** 收集视口内的代码块（P2-2）；活动行里的围栏跳过——那一片按源码显示。树由调用方传入（一次重建只补一次解析） */
function fenceSpansIn(
  state: EditorState,
  from: number,
  to: number,
  tree: ReturnType<typeof syntaxTree>,
): FenceSpan[] {
  const doc = state.doc;
  const spans: FenceSpan[] = [];
  tree.iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== "FencedCode") return;
      const text = doc.sliceString(node.from, node.to);
      const firstBreak = text.indexOf("\n");
      if (firstBreak < 0) return;
      const lang = FENCE_INFO_RE.exec(text.slice(0, firstBreak))?.[1] ?? "";
      if (lang === "") return;
      const lastBreak = text.lastIndexOf("\n");
      if (lastBreak <= firstBreak) return;
      // 末行必须是收尾围栏（没闭合的块不做高亮——内容还长着）；内容不含它前头那个换行
      if (!FENCE_MARK_RE.test(text.slice(lastBreak + 1))) return;
      const code = text.slice(firstBreak + 1, lastBreak);
      if (code.trim() === "") return;
      spans.push({ lang, code, contentFrom: node.from + firstBreak + 1 });
    },
  });
  return spans;
}

/**
 * 打字之后的静默窗口：停手这么久才重算装饰。
 *
 * 取 90ms 是跟着"一个连打停顿"的经验值定的：短了没效果（长文档里一次
 * `ensureSyntaxTree` 的补解析预算就是几十毫秒），长了会看见"敲完的那一行迟迟不渲染"。
 * 这段窗口里**不会**出现"敲了字没反应"——光标停在内容文字里时本来就只有样式、
 * 没有等待渲染的标记（§2.1），而新敲出来的标记在语法树里还不存在，本来就该以源码示人。
 */
const REBUILD_IDLE_MS = 90;

/**
 * 视图里那个只算视口的插件。
 *
 * **重算时机**（2026-10-01 改，原先是无条件同步重算）：
 *
 * | 触发 | 策略 | 为什么 |
 * |---|---|---|
 * | `docChanged` | 停手 `REBUILD_IDLE_MS` 后重算 | 连续打字时一次都不补解析语法树。位置已由上面的 `map` 保住，装饰不会指向已消失的区间 |
 * | `selectionSet` / `focusChanged` | 下一帧重算（同帧多次合并成一次） | "光标进标记露源码"是即时渲染的核心交互，必须跟手；但一帧内的多次更新只需算一次 |
 * | 语法树引用变了 | 下一帧重算 | 后台 ParseWorker 补完一段（v0.8.37）：不重算的话滚到的那一片会一直停在源码形态 |
 * | `viewportChanged` | 下一帧重算 | 滚进新区域要有装饰，延迟一帧不可见 |
 *
 * 与外部项目 inkstone 的 `live-preview.ts` 同一思路（那边是块级缓存 + 90ms 防抖），
 * 差别是我们装饰的是**语法节点**而不是渲染好的 HTML，所以没有"复用未变块的 HTML"这一层，
 * 只做时机上的合并。
 */
class LivePreviewPlugin {
  decorations: DecorationSet;
  /**
   * 上次见过的**语法树引用**（`syntaxTree(state)` 换过对象才算变过）：后台 ParseWorker
   * 补完一段就会换一次树，装饰得跟着重算（设计稿 §4.3）。
   *
   * 基准必须是「state 当前的树」而不是「上次 build 用的树」：本插件自己也在补解析
   * （`ensureSyntaxTree`），拿 build 结果当基准会永远对不上，形成逐帧重建的环。
   */
  private treeRef: ReturnType<typeof syntaxTree>;
  /** 打字重算的定时器（0 = 当前没有排期） */
  private idleTimer = 0;
  /** 帧合并的句柄（0 = 当前没有排期） */
  private frame = 0;
  /**
   * 代码高亮的**内容级缓存**（P2-2）：键是 `语言\0代码文本`，值是**相对代码文本**的
   * token 区间——所以文档怎么编辑、位置怎么变都不失效，只有内容本身变了才重算。
   * 上限 40 块：一篇里几十个代码块是极端，滚回去重新请求一次也就一个 promise。
   */
  private codeSpans = new Map<string, TokenSpan[]>();
  /** 已经发出去还没回来的高亮请求（防止同一块重复请求） */
  private pendingHighlights = new Set<string>();

  constructor(view: EditorView) {
    this.treeRef = syntaxTree(view.state);
    const tree = ensureSyntaxTree(view.state, view.viewport.to, PARSE_BUDGET_MS) ?? syntaxTree(view.state);
    this.decorations = buildFor(view, this.collectCodeMarks(view, tree), tree).decorations;
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      // 先映射位置：这样即使下面不重算，装饰也不会指向已经不存在的区间
      this.decorations = this.decorations.map(update.changes);
    }
    // 输入法组合期间**不重算**（位置已由映射保住）：重算会把组合中的字替换掉、光标乱跳
    if (update.view.composing) return;
    /*
      语法树推进了：后台 ParseWorker 补完一段会 dispatch `Language.setState`（换掉 state 上的树），
      装饰得跟着重算，否则滚到的那一片会一直停在"还没解析"的源码形态（设计稿 §4.3）。
      这里只认**树引用变化**，不引入 `parseProgressEffect` 那套 generation / taskSeq 协议。
    */
    const tree = syntaxTree(update.state);
    if (update.docChanged) {
      this.treeRef = tree;
      this.scheduleIdle(update.view);
      return;
    }
    if (tree !== this.treeRef) {
      this.treeRef = tree;
      this.scheduleFrame(update.view);
      return;
    }
    if (update.viewportChanged || update.selectionSet || update.focusChanged) {
      this.scheduleFrame(update.view);
    }
  }

  /** 停手后再算：连续打字期间一次都不重解析 */
  private scheduleIdle(view: EditorView): void {
    if (this.idleTimer) globalThis.clearTimeout(this.idleTimer);
    this.idleTimer = globalThis.setTimeout(() => {
      this.idleTimer = 0;
      this.rebuild(view, true);
    }, REBUILD_IDLE_MS);
  }

  /** 同一帧里的多次更新合并成一次重算 */
  private scheduleFrame(view: EditorView): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.rebuild(view, true);
    });
  }

  /**
   * 重算装饰。`notify` 表示这次重算发生在**定时器回调里**（打字停手 90ms / 下一帧）：
   *
   * 插件字段是在 `update()` 之外改的，而 CodeMirror 只在**下一次 update** 时才重读
   * `decorations`——不主动触发一次 update，重算结果就一直躺在字段里不被画出来。
   * 打字场景每次按键都会带出一次 update，把上一次的重建"顺带"刷出去，所以平时看不出来；
   * **粘贴**这类"编辑之后不再有任何输入"的场景就永远停在源码（v0.6.5 改重建时机时引入的
   * 回归，2026-10-11 用真 CM6 + 探针实证：重建跑了、装饰算出来了、DOM 没变）。
   *
   * 空事务（`dispatch()` 无参）只走一遍 update 循环、不改文档与选区，代价可忽略；
   * update 里没有任何分支会再排期，不会成环。
   */
  private rebuild(view: EditorView, notify = false): void {
    // 一次重建只补一次解析：同一棵树喂给代码块收集与装饰构建（v0.8.25 前各付一遍 50ms 预算）
    const tree = ensureSyntaxTree(view.state, view.viewport.to, PARSE_BUDGET_MS) ?? syntaxTree(view.state);
    this.decorations = buildFor(view, this.collectCodeMarks(view, tree), tree).decorations;
    this.treeRef = syntaxTree(view.state);
    if (notify) view.dispatch();
  }

  destroy(): void {
    if (this.idleTimer) globalThis.clearTimeout(this.idleTimer);
    if (this.frame) cancelAnimationFrame(this.frame);
  }

  /**
   * 视口内代码块的高亮区间（P2-2）。缓存命中的立即换算成绝对坐标；
   * 没命中的发一次异步请求，回来后**重建一次**把颜色画上去（内容级缓存，
   * 文档编辑不失效——键是代码文本本身）。
   *
   * 空语言 / 不支持的语言 / Prism 加载失败都返回空，代码保持纯文本。
   */
  private collectCodeMarks(
    view: EditorView,
    tree: ReturnType<typeof syntaxTree>,
  ): Array<{ from: number; to: number; className: string }> {
    const marks: Array<{ from: number; to: number; className: string }> = [];
    for (const fence of fenceSpansIn(view.state, view.viewport.from, view.viewport.to, tree)) {
      const key = `${fence.lang}\u0000${fence.code}`;
      const cached = this.codeSpans.get(key);
      if (cached) {
        for (const span of cached) {
          marks.push({
            from: fence.contentFrom + span.start,
            to: fence.contentFrom + span.end,
            className: span.cls,
          });
        }
        continue;
      }
      if (this.pendingHighlights.has(key)) continue;
      this.pendingHighlights.add(key);
      void highlightSpans(fence.code, fence.lang).then((result) => {
        this.pendingHighlights.delete(key);
        if (!result || result.length === 0) return;
        if (this.codeSpans.size >= 40) {
          const oldest = this.codeSpans.keys().next().value;
          if (oldest !== undefined) this.codeSpans.delete(oldest);
        }
        this.codeSpans.set(key, result);
        // 异步回来时文档可能已经又变了：重建用当时的文档现算，键按内容命中，位置不会错
        this.rebuild(view, true);
      });
    }
    return marks;
  }
}

function buildFor(
  view: EditorView,
  codeTokenMarks: ReadonlyArray<{ from: number; to: number; className: string }> = [],
  tree: ReturnType<typeof syntaxTree>,
): LivePreviewDecorations {
  const { from, to } = view.viewport;
  return buildLivePreviewDecorations({
    state: view.state,
    from,
    to,
    revealAt: revealAtOf(view),
    codeTokenMarks,
    tree,
  });
}

/**
 * 该显现源码的位置（设计稿 §2.3）。
 *
 * - **失焦**：一个位置都没有 → 整篇按渲染呈现。否则刚打开一篇笔记（CM6 的选区默认落在
 *   文档开头）会让第一行一直露着 `##`，看着像"没渲染"。
 * - **折叠光标**：一个位置；落进哪个标记就显现哪个节点。
 * - **展开的选区**：不显现，整篇保持渲染——复制拿到的仍是底层 Markdown（那是 `Editor`
 *   的剪贴板规则管的）。例外：查找面板打开时按选区两端显现，命中的那一段能对着源码看；
 *   以前这里是把**整篇**回落成源码，与"完整语法立即呈现"直接打架（P3 的旧口径）。
 */
function revealAtOf(view: EditorView): number[] {
  if (!view.hasFocus) return [];
  const main = view.state.selection.main;
  if (main.empty) return [main.head];
  return searchPanelOpen(view.state) ? [main.from, main.to] : [];
}

/**
 * 即时渲染扩展（`Editor` 按模式挂它）。
 *
 * **不再挂 `EditorView.atomicRanges`**（v0.8.37）：标记要"进得去、看得见"才谈得上 §2.3 的
 * 显现规则；挂成原子区间后方向键被 `moveByChar` 跳过、鼠标点进去也一样够不着，
 * 那条规则永远触发不了。见文件头纪律 3。
 */
export function livePreview(): Extension {
  return ViewPlugin.fromClass(LivePreviewPlugin, {
    decorations: (instance) => instance.decorations,
  });
}
