/**
 * 编辑器键位表（编辑器专项优化 P1，蓝本：inkstone `shortcuts.ts` 的组织方式）。
 *
 * **只服务正文编辑器内部**，不进 `app/shortcuts/` 那张全局和弦表——DESIGN.md §6.3 规则 4
 * 写明"编辑器内部的命令是输入触发/编辑器内生效，不进全局表"。
 *
 * 两条刻意的不绑：
 * - **`Mod-K` 不绑**：全局表里 `Ctrl/Cmd+K` 是"聚焦顶栏搜索框"（DESIGN §6.3 定稿），
 *   编辑器里抢走它，全局口径就破了一半。插入链接走工具栏按钮。
 * - **`Mod-F` / `Mod-H` 不绑**：查找替换面板在 P3 落地时一起接，按钮先于键位出现
 *   就是"点了没反应的控件"（DESIGN §6.1 禁止）。
 *
 * 键位格式用 CodeMirror 的 `Mod-`：macOS 上是 `Cmd`，其余平台是 `Ctrl`，一套写法两边生效。
 */
import { deleteLine, indentLess, indentMore, moveLineDown, moveLineUp } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import {
  applyFormatCommand,
  minimalChange,
  type FormatCommandArg,
  type FormatCommandId,
} from "./format-commands";

/** 是不是苹果系平台（键位提示的写法随它变：`⌘B` vs `Ctrl+B`） */
const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** 把键位表里的 `mod+b` 写法转成给人看的提示（`title` 用，DESIGN §6.3 规则 3） */
export function comboDisplay(combo: string): string {
  const pretty = combo
    .split("+")
    .map((part) => {
      if (part === "mod") return IS_MAC ? "⌘" : "Ctrl";
      if (part === "shift") return IS_MAC ? "⇧" : "Shift";
      if (part === "alt") return IS_MAC ? "⌥" : "Alt";
      return part.toUpperCase();
    })
    .join(IS_MAC ? "" : "+");
  return pretty;
}

/** 把键位表里的 `mod+b` 写法转成 CodeMirror 的 `Mod-b`（大写首字母即可） */
function toCodeMirrorKey(combo: string): string {
  return combo
    .split("+")
    .map((part) => (part.length === 1 ? part.toUpperCase() : part))
    .join("-");
}

/**
 * 在当前主选区执行一条格式命令，并按**最小变更区间**落盘（`format-commands.minimalChange`）。
 *
 * 返回 `true` 表示键已处理（即使命令没改任何字——比如对普通行按「正文」），
 * 别让同一个键再落到 CodeMirror 默认键位上。
 */
function runFormat(view: EditorView, command: FormatCommandId, arg?: FormatCommandArg): boolean {
  if (view.state.readOnly) return false;
  const before = view.state.doc.toString();
  const { from, to } = view.state.selection.main;
  const result = applyFormatCommand(before, { from, to }, command, arg);
  if (result.text === before) return true;
  view.dispatch({
    changes: minimalChange(before, result.text),
    selection: { anchor: result.selection.from, head: result.selection.to },
    scrollIntoView: true,
    userEvent: "input.format",
  });
  return true;
}

/** 键位与提示共用的一行：工具栏按钮的 `title` 也从这里取（键位只有一份口径） */
export interface EditorShortcutSpec {
  /** 稳定 id：工具栏按它反查提示（`hintFor("bold")`） */
  id: string;
  /** 本表内部的写法：`mod+b` / `alt+arrowup` */
  combo: string;
  /** 中文名（提示里的动作名） */
  label: string;
  command?: FormatCommandId;
  arg?: FormatCommandArg;
}

/** 编辑器内生效的格式与行编辑键位（顺序即优先级：格式命令先于行编辑） */
export const EDITOR_SHORTCUTS: readonly EditorShortcutSpec[] = [
  { id: "bold", combo: "mod+b", label: "加粗", command: "bold" },
  { id: "italic", combo: "mod+i", label: "斜体", command: "italic" },
  { id: "inline-code", combo: "mod+e", label: "行内代码", command: "inline-code" },
  { id: "strikethrough", combo: "mod+shift+x", label: "删除线", command: "strikethrough" },
  { id: "heading-0", combo: "mod+alt+0", label: "正文", command: "heading", arg: { headingLevel: 0 } },
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
    id: `heading-${level}`,
    combo: `mod+alt+${level}`,
    label: `标题 ${level}`,
    command: "heading" as const,
    arg: { headingLevel: level },
  })),
  { id: "ordered-list", combo: "mod+shift+7", label: "有序列表", command: "ordered-list" },
  { id: "bullet-list", combo: "mod+shift+8", label: "无序列表", command: "bullet-list" },
  { id: "task-list", combo: "mod+shift+9", label: "任务清单", command: "task-list" },
  { id: "quote", combo: "mod+shift+.", label: "引用", command: "quote" },
];

/** 按 id 反查键位提示（工具栏 `title` 用）；没有键位的命令返回 undefined */
export function shortcutHint(id: string): { label: string; combo: string } | undefined {
  const found = EDITOR_SHORTCUTS.find((spec) => spec.id === id);
  return found ? { label: found.label, combo: found.combo } : undefined;
}

/** 按钮提示文案：`加粗（Ctrl+B）`；没有键位的就只有名字 */
export function hintFor(id: string, label: string): string {
  const found = shortcutHint(id);
  return found ? `${label}（${comboDisplay(found.combo)}）` : label;
}

/** 带格式命令的键位（类型收窄：`command` 一定在） */
const FORMAT_KEYBINDINGS = EDITOR_SHORTCUTS.filter(
  (spec): spec is EditorShortcutSpec & { command: FormatCommandId } => spec.command !== undefined,
);

/** 交给 CodeMirror 的键位（`Editor.tsx` 挂在 defaultKeymap 之前） */
export const editorKeymap = [
  ...FORMAT_KEYBINDINGS.map((spec) => ({
    key: toCodeMirrorKey(spec.combo),
    run: (view: EditorView) => runFormat(view, spec.command, spec.arg),
  })),
  { key: "Alt-ArrowUp", run: moveLineUp },
  { key: "Alt-ArrowDown", run: moveLineDown },
  { key: "Mod-Shift-k", run: deleteLine },
  { key: "Mod-]", run: indentMore },
  { key: "Mod-[", run: indentLess },
];
