/**
 * 编辑器里把 front matter 藏起来（2026-10-04）。
 *
 * **为什么不「让编辑器只存正文、保存时再贴回 front matter」**——那条路有个会丢数据的坑：
 * 标签、清单字段、标题都是**菜单动作直接改 md 的**（`features/tasks/actions.ts` 等各自
 * `readRawBody` 取最新草稿再改）。编辑器若持有一份自己的 front matter 副本、每次打字回贴，
 * 就会把那些刚写进去的改动**抹回去**。要根治得让所有菜单动作改走宿主，是一次大改。
 *
 * **所以这里只动「看得见」这一层**：文档内容一字不改，保存链路完全不经过本模块。
 * 实现是 CodeMirror 的 `Decoration.replace`——把 front matter 那一段换成一个可点的
 * 小标签，与折叠（`foldGutter` / `foldKeymap`）同一套机制，本仓库已引入。
 *
 * **光标不许钻进被藏起来的那一段**：那会让用户「明明看不见却能改，改完还找不到」。
 * ViewPlugin 在选区落进隐藏区时把它顶到隐藏区末尾；已经在该位置就不再派发，避免自激循环。
 *
 * **展开状态用 StateEffect 走一趟事务**：直接改插件实例上的字段不会触发重绘（装饰是从
 * facet 读的，宿主不会因为字段变了就来问一次），那正是"点了没反应"的一类。
 *
 * 隐藏**可展开**：标签是真正的 `<button>`，点一下即还原原文——front matter 是数据，
 * 用户有权看见和改它。是否要「默认永不显示」是另一个产品决定，等用户看了效果再定。
 */
import { StateEffect } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { parseMenoteMeta } from "@menote/mdcore";

/** 切换「是否展开」。`true` = 显示 front matter 原文 */
const setRevealed = StateEffect.define<boolean>();

/**
 * front matter 在文档里的区间（`{from, to}`，to 含结尾围栏后的换行）。
 *
 * **判据与 mdcore 的 `splitFences` 保持一致**：第一行必须是 `---`、必须能找到收尾的 `---`；
 * 没闭合就返回 `null`（当没有——用户可能正在写第一行，此时任何隐藏都是干扰）。
 */
export function frontmatterRange(text: string): { from: number; to: number } | null {
  if (!text.startsWith("---\n")) return null;
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return null;

  let to = 0;
  for (let index = 0; index <= end; index += 1) to += (lines[index] ?? "").length + 1;
  return { from: 0, to: Math.min(to, text.length) };
}

/** 藏起来那一段里出现过哪些顶层键 —— 标签上显示它，用户才知道自己藏了什么 */
export function frontmatterKeyNames(frontmatter: string): string[] {
  const names: string[] = [];
  for (const line of frontmatter.split("\n")) {
    const matched = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
    if (matched?.[1] && !names.includes(matched[1])) names.push(matched[1]);
  }
  return names;
}

class FrontmatterChip extends WidgetType {
  constructor(
    private readonly names: readonly string[],
    private readonly view: EditorView,
  ) {
    super();
  }

  override eq(other: FrontmatterChip): boolean {
    return other.names.length === this.names.length && other.names.every((n, i) => n === this.names[i]);
  }

  override toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-fm-chip";
    button.textContent = this.names.length > 0 ? this.names.join(" · ") : "属性";
    button.title = "显示属性（YAML front matter）";
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      this.view.dispatch({ effects: setRevealed.of(true) });
    });
    return button;
  }

  /** 按钮自己处理点击，编辑器不必再解释一次 */
  override ignoreEvent(): boolean {
    return false;
  }
}

interface FrontmatterHideState {
  decorations: DecorationSet;
  revealed: boolean;
}

export function frontmatterHide() {
  return ViewPlugin.fromClass<FrontmatterHideState>(
    class {
      decorations: DecorationSet;
      revealed = false;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate): void {
        for (const effect of update.transactions.flatMap((tr) => tr.effects)) {
          if (effect.is(setRevealed)) this.revealed = effect.value;
        }
        // 只在「文档变了」或「展开状态变了」时重建：每次移光标都重画没有意义
        if (update.docChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(setRevealed)))) {
          this.decorations = this.build(update.view);
        }
        this.keepCursorOut(update);
      }

      /** 选区落进隐藏区时把它顶到隐藏区末尾；已在该位置就不派发（否则自激） */
      private keepCursorOut(update: ViewUpdate): void {
        if (this.revealed) return;
        const range = frontmatterRange(update.state.doc.toString());
        if (!range) return;

        const { selection } = update.state;
        const inside = selection.ranges.some((one) => one.from < range.to && one.to > range.from);
        if (!inside) return;
        if (selection.main.from === range.to && selection.main.to === range.to) return;

        update.view.dispatch({
          selection: { anchor: range.to, head: range.to },
          scrollIntoView: false,
        });
      }

      private build(view: EditorView): DecorationSet {
        if (this.revealed) return Decoration.none;
        const text = view.state.doc.toString();
        const range = frontmatterRange(text);
        if (!range) return Decoration.none;

        const names = frontmatterKeyNames(parseMenoteMeta(text).raw ?? "");
        return Decoration.set([
          Decoration.replace({ widget: new FrontmatterChip(names, view) }).range(range.from, range.to),
        ]);
      }
    },
    { decorations: (value) => value.decorations },
  );
}
