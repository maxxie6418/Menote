/**
 * 即时渲染的**"光标进标记就显现源码"判定**（《编辑器体验优化设计 v1》§2.3）。
 *
 * 从 `live-preview.ts` 拆出来有两个原因：
 * 1. 那一份文件已经贴着 500 行预算（架构 §2.3.1），判定逻辑与装饰构建是两件事，分开更好读；
 * 2. 判定是**纯逻辑**（只要语法树 + 文档 + 位置），与 CodeMirror 的装饰、视图 API 无关，
 *    单独一份更容易被测试直接钉住。
 *
 * 语义要点（与设计稿逐条对应）：
 * - 命中判据是**半开区间** `[from, to)`：位置落在标记起点上也算命中。
 * - 同一位置命中多个属主时取**最内层**（节点跨度最小那个）——嵌套时显现最里面那一层。
 * - **整段被替换的节点**（图片、分隔线）优先：它一旦命中就整段回源码，里层标记无从谈起。
 * - 命中后显现的是**该节点自己的全部标记**（例：链接命中任一 `[]()` 或地址字符，
 *   整个链接节点的 `[`、`](`、`)` 一起显现），不是只显现被碰到的那一个字符。
 * - **内容文字不在标记里**：光标停在已格式化文字内部（如 `**粗体**` 的"体"字上）不该回源码
 *   ——这正是本次改动取代"光标所在行显示源码"的那一半。
 */
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

/** 标题节点名 → 行 class。装饰与"标记属主"两处共用，**别各写一份** */
export const HEADING_CLASSES: Record<string, string> = {
  ATXHeading1: "cm-live-h1",
  ATXHeading2: "cm-live-h2",
  ATXHeading3: "cm-live-h3",
  ATXHeading4: "cm-live-h4",
  ATXHeading5: "cm-live-h5",
  ATXHeading6: "cm-live-h6",
};

/** 半开区间 `[from, to)` */
export interface Span {
  from: number;
  to: number;
}

/** 标记区间；`prefix` 表示它后面紧跟的那个空格也归它管（标题 `# `、引用 `> `、列表 `- `） */
interface MarkSpan extends Span {
  prefix?: boolean;
}

/** 一个受支持语法节点自己会被藏掉的标记，外加它的节点范围（用来判"最内层"） */
interface MarkerOwner extends Span {
  whole: boolean;
  spans: Span[];
}

/**
 * 节点自己**会被藏掉的那些标记**（设计稿 §2.3 的"最小受支持语法节点"靠它认）。
 *
 * 只列会被藏的东西：`**` 这类标记、图片/分隔线的整段、任务标记、列表符号。
 * **内容文字不在里面。**
 */
function ownMarkSpans(node: SyntaxNode): MarkSpan[] {
  const spans: MarkSpan[] = [];
  const children = (names: readonly string[], prefix = false): void => {
    for (const child of childrenOf(node)) {
      if (names.includes(child.name)) spans.push({ from: child.from, to: child.to, prefix });
    }
  };
  switch (node.name) {
    case "Blockquote":
      children(["QuoteMark"], true);
      break;
    case "StrongEmphasis":
    case "Emphasis":
    case "Strikethrough":
      children(["EmphasisMark", "StrikethroughMark"]);
      break;
    case "InlineCode":
      children(["CodeMark"]);
      break;
    case "Link":
      children(["LinkMark", "URL"]);
      break;
    case "Autolink":
      children(["LinkMark"]);
      break;
    case "Image":
    case "HorizontalRule":
    case "TaskMarker":
      spans.push({ from: node.from, to: node.to });
      break;
    case "ListMark":
      spans.push({ from: node.from, to: node.to, prefix: true });
      break;
    default:
      // 标题：`##` 与 Setext 的 `===` / `---` 下划线在树里同样是 `HeaderMark`
      if (HEADING_CLASSES[node.name] || node.name.startsWith("SetextHeading")) {
        children(["HeaderMark"], true);
      }
      break;
  }
  return spans;
}

/** 标记区间按其"是否连后面那个空格一起藏"补全 */
function extendMark(span: MarkSpan, doc: EditorState["doc"]): Span {
  const hasSpace = doc.sliceString(span.to, span.to + 1) === " ";
  return span.prefix && hasSpace ? { from: span.from, to: span.to + 1 } : { from: span.from, to: span.to };
}

/**
 * 这些位置该显现哪些标记。
 *
 * `from`/`to` 是本次扫描的视口范围；`revealAt` 是"当前要显现的位置"（折叠光标只给一个，
 * 展开选区在查找面板打开时给两端）。返回**需要显现的标记区间**，空数组表示"什么都不显现"。
 */
export function revealSpansFor(
  tree: Tree,
  from: number,
  to: number,
  doc: EditorState["doc"],
  revealAt: readonly number[],
): Span[] {
  if (revealAt.length === 0) return [];
  const owners: MarkerOwner[] = [];
  tree.iterate({
    from,
    to,
    enter: (ref) => {
      // 注意：`enter` 给的是 `SyntaxNodeRef`，它**没有** `firstChild`——子节点要从 `.node` 上取
      const node = ref.node;
      const spans = ownMarkSpans(node).map((span) => extendMark(span, doc));
      if (spans.length > 0) {
        owners.push({
          from: node.from,
          to: node.to,
          whole: node.name === "Image" || node.name === "HorizontalRule",
          spans,
        });
      }
    },
  });
  const out: Span[] = [];
  for (const pos of revealAt) {
    const hits = owners.filter((owner) => owner.spans.some((span) => pos >= span.from && pos < span.to));
    if (hits.length === 0) continue;
    const chosen =
      hits.find((owner) => owner.whole) ?? hits.reduce((a, b) => (b.to - b.from < a.to - a.from ? b : a));
    out.push(...chosen.spans);
  }
  return out;
}

/** 直接子节点清单（`SyntaxNode` 的 firstChild/nextSibling 链） */
export function childrenOf(node: {
  firstChild: unknown;
}): Array<{ name: string; from: number; to: number }> {
  const out: Array<{ name: string; from: number; to: number }> = [];
  let child = node.firstChild as { name: string; from: number; to: number; nextSibling: unknown } | null;
  while (child) {
    out.push({ name: child.name, from: child.from, to: child.to });
    child = child.nextSibling as typeof child;
  }
  return out;
}
