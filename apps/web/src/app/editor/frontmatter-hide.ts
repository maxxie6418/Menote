/**
 * 编辑器里把 front matter 藏起来（2026-10-04）。
 *
 * ## 装饰必须挂在 StateField 上，不能挂 ViewPlugin
 *
 * 首版这里用的是 `ViewPlugin.fromClass` + `Decoration.replace`，结果**编辑器一挂载就抛**：
 *
 * ```
 * Uncaught RangeError: Decorations that replace line breaks may not be specified via plugins
 * ```
 *
 * CodeMirror 6 的硬约束：**插件（plugin）只能提供块级（不跨行）的 replace 装饰**；
 * 凡是**跨过行边界**的 `Decoration.replace`，必须由 **StateField** 经
 * `EditorView.decorations.from(field)` 提供。而 front matter 天然跨行（`---` 到收尾
 * `---` 那一整段），所以它只能走 StateField。
 *
 * 这个坑当初没被任何用例挡住：`frontmatter-hide.test.ts` 只测了下面那两个**纯函数**，
 * 而 jsdom 里 CodeMirror 是被替身顶掉的（仓库早就写着「jsdom 跑不了真的 CodeMirror」），
 * 于是插件本身**一次都没被真正执行过**。教训是：纯函数测得再全，也不能代表扩展能挂上。
 *
 * ## 为什么不「让编辑器只存正文、保存时再贴回 front matter」
 *
 * 那条路有个会丢数据的坑：标签、清单字段、标题都是**菜单动作直接改 md 的**
 * （`features/tasks/actions.ts` 等各自 `readRawBody` 取最新草稿再改）。编辑器若持有
 * 一份自己的 front matter 副本、每次打字回贴，就会把那些刚写进去的改动**抹回去**。
 * 要根治得让所有菜单动作改走宿主，是一次大改。所以这里只动「看得见」这一层：
 * **文档内容一字不改，保存链路完全不经过本模块。**
 *
 * ## 三条配套
 *
 * 1. **判据与 mdcore 的 `splitFences` 一致**：第一行必须是 `---`、必须能闭合；
 *    没闭合就不隐藏（用户可能正在写第一行，此时隐藏只是干扰）。
 * 2. **光标不许钻进被藏起来的那一段**：否则用户会「明明看不见却能改，改完还找不到」。
 *    选区落进去就顶到隐藏区末尾；已经在该位置就不再派发，避免自激循环。
 * 3. **可展开**：芯片是真正的 `<button>`，点一下还原原文——front matter 是数据，
 *    用户有权看见和改它。芯片上显示藏起来的顶层键名，用户才知道自己藏了什么。
 */
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
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

/** 藏起来那一段里出现过哪些顶层键 —— 芯片上显示它，用户才知道自己藏了什么 */
export function frontmatterKeyNames(frontmatter: string): string[] {
  const names: string[] = [];
  for (const line of frontmatter.split("\n")) {
    const matched = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
    if (matched?.[1] && !names.includes(matched[1])) names.push(matched[1]);
  }
  return names;
}

class FrontmatterChip extends WidgetType {
  constructor(private readonly names: readonly string[]) {
    super();
  }

  override eq(other: FrontmatterChip): boolean {
    return other.names.length === this.names.length && other.names.every((n, i) => n === this.names[i]);
  }

  /** `toDOM` 收 view，所以展开动作在这里派发即可，不必把 view 存进字段 */
  override toDOM(view: EditorView): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-fm-chip";
    button.textContent = this.names.length > 0 ? this.names.join(" · ") : "属性";
    button.title = "显示属性（YAML front matter）";
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      view.dispatch({ effects: setRevealed.of(true) });
    });
    return button;
  }

  /** 按钮自己处理点击，编辑器不必再解释一次 */
  override ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(text: string, revealed: boolean): DecorationSet {
  if (revealed) return Decoration.none;
  const range = frontmatterRange(text);
  if (!range) return Decoration.none;

  const names = frontmatterKeyNames(parseMenoteMeta(text).raw ?? "");
  return Decoration.set([Decoration.replace({ widget: new FrontmatterChip(names) }).range(range.from, range.to)]);
}

interface FrontmatterHideState {
  decorations: DecorationSet;
  revealed: boolean;
}

/**
 * 装饰**必须**由 StateField 提供（见文件头「装饰必须挂在 StateField 上」）。
 *
 * `tr.newDoc` 而不是 `tr.state.doc`：字段更新时新文档已经算好了，用它省一次拼接。
 */
const frontmatterField = StateField.define<FrontmatterHideState>({
  create: (state) => ({ decorations: buildDecorations(state.doc.toString(), false), revealed: false }),
  update(value, tr) {
    let revealed = value.revealed;
    for (const effect of tr.effects) {
      if (effect.is(setRevealed)) revealed = effect.value;
    }
    // 文档没动、展开状态也没变 → 复用上一次的装饰集（每次移光标都重建没有意义）
    if (!tr.docChanged && revealed === value.revealed) return value;
    return { decorations: buildDecorations(tr.newDoc.toString(), revealed), revealed };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/**
 * 选区落进隐藏区时把它顶到隐藏区末尾；已经在该位置就不派发（否则自激）。
 *
 * **必须走 `updateListener` 而不是字段的 `update`**：字段更新期间再 dispatch 是不允许的。
 */
function keepCursorOut(update: ViewUpdate): void {
  if (!update.docChanged && !update.selectionSet) return;
  if (update.state.field(frontmatterField).revealed) return;

  const range = frontmatterRange(update.state.doc.toString());
  if (!range) return;

  const { selection } = update.state;
  const inside = selection.ranges.some((one) => one.from < range.to && one.to > range.from);
  if (!inside) return;
  if (selection.main.from === range.to && selection.main.to === range.to) return;

  update.view.dispatch({ selection: { anchor: range.to, head: range.to }, scrollIntoView: false });
}

/** 装到编辑器上的那一个扩展（`Editor.tsx` 把它放进扩展列表） */
export function frontmatterHide(): Extension {
  return [frontmatterField, EditorView.updateListener.of(keepCursorOut)];
}
