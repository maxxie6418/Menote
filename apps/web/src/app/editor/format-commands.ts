/**
 * Markdown 格式命令的**唯一纯函数入口**（编辑拓展阶段 B / Task B1）。
 *
 * 职责只有一个：`(文本, 选区, 命令) → (新文本, 新选区)`。不碰 React、不碰 CodeMirror、
 * 不知道宿主是谁——正文编辑器、快捷输入、将来的移动端都调这里，避免各宿主各拼一份 Markdown。
 *
 * 边界（写死）：
 * - 只产生**标准 Markdown**：没有下划线、HTML、颜色、字号、CSS。命令表是白名单，加命令要改这里。
 * - 不做异步内容动作：`/图片`、`/附件` 需要上传、占位符替换与 `EditorHandle.replace()`，
 *   它们不是同步的 `{ text, selection }`，所以**不在**本注册表里（附件继续走正文的附件按钮）。
 * - 跨行选区按**被覆盖的整行**展开（半行也算整行）；成对标记按精确字符区间包裹。
 *   `to` 是开区间：`to` 正好落在下一行行首时，下一行不算被覆盖。
 * - 重复执行是 **toggle**：成对标记已被完整包裹时再去掉；行前缀命令在所有非空行都已有前缀时统一去掉，
 *   否则只给缺的行补。宁可多包一层，也不要误删用户的内容。
 */

export const FORMAT_COMMANDS = [
  "bold",
  "italic",
  "strikethrough",
  "bullet-list",
  "ordered-list",
  "quote",
  "inline-code",
  "link",
  "heading",
  "code-block",
  "task-list",
] as const;

export type FormatCommandId = (typeof FORMAT_COMMANDS)[number];

/** 选区按 CodeMirror 的习惯用 `to` 开区间（`{ from: 0, to: 8 }` 覆盖索引 0–7）。 */
export type TextSelection = { from: number; to: number };

export type FormatResult = { text: string; selection: TextSelection };

/**
 * 命令的附加参数（编辑器专项优化 P1）：目前只有标题命令的级别。
 * 不带参数时 `heading` 保持既有行为（`##`），所以 `/` 菜单那边一个字都不用改。
 */
export type FormatCommandArg = { headingLevel?: number };

/** 成对标记：包在选区两侧，选区留在标记内（继续打字就是标记里的内容）。 */
const PAIR_MARKERS = {
  bold: "**",
  italic: "*",
  strikethrough: "~~",
  "inline-code": "`",
} as const;

type PairCommandId = keyof typeof PAIR_MARKERS;

function isPairCommand(command: FormatCommandId): command is PairCommandId {
  return command in PAIR_MARKERS;
}

/** 链接模板里的地址占位：给用户一个可以立刻替换的合法 URL，而不是空括号。 */
const LINK_URL = "https://";
const LINK_PLACEHOLDER = "链接文字";
const CODE_FENCE = "```";

interface LineRule {
  /** 这一行是否已经有**本命令**的前缀（要能区分无序列表与任务清单）。 */
  has: (line: string) => boolean;
  /** 给第 `index` 个非空行加前缀（有序列表按非空行次序编号）。 */
  prefix: (index: number) => string;
  /** 去掉已有前缀，行内其余内容一字不动。 */
  strip: (line: string) => string;
}

/**
 * 行前缀命令。`bullet-list` 的 `has` 特意带负向先行断言：`- [ ] 待办` 是**任务清单**，
 * 不能被无序列表当成"已有前缀"而 toggle 掉，否则一条待办会被静默降级成普通列表项。
 */
const LINE_RULES: Record<
  "bullet-list" | "ordered-list" | "quote" | "heading" | "task-list",
  LineRule
> = {
  "bullet-list": {
    has: (line) => /^\s*[-*+]\s+(?!\[[ xX]\]\s)/.test(line),
    prefix: () => "- ",
    strip: (line) => line.replace(/^(\s*)[-*+]\s+/, "$1"),
  },
  "ordered-list": {
    has: (line) => /^\s*\d+[.)]\s+/.test(line),
    prefix: (index) => `${index + 1}. `,
    strip: (line) => line.replace(/^(\s*)\d+[.)]\s+/, "$1"),
  },
  quote: {
    has: (line) => /^\s*>\s?/.test(line),
    prefix: () => "> ",
    strip: (line) => line.replace(/^(\s*)>\s?/, "$1"),
  },
  heading: {
    has: (line) => /^\s*#{1,6}\s+/.test(line),
    prefix: () => "## ",
    strip: (line) => line.replace(/^(\s*)#{1,6}\s+/, "$1"),
  },
  "task-list": {
    has: (line) => /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line),
    prefix: () => "- [ ] ",
    strip: (line) => line.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, "$1"),
  },
};

/** 选区落到的整行区间（`start` 含、`end` 不含，`end` 指到行尾换行符或文末）。 */
function coveredLines(text: string, selection: TextSelection): { start: number; end: number } {
  const from = Math.max(0, Math.min(selection.from, selection.to));
  const to = Math.max(from, Math.max(selection.from, selection.to));
  const start = text.lastIndexOf("\n", from - 1) + 1;
  // 空选区（光标）按光标所在行算；有选区时看**最后一个被覆盖的字符**
  const lastCovered = to > from ? to - 1 : from;
  const newline = text.indexOf("\n", lastCovered);
  const end = newline === -1 ? text.length : newline;
  return { start, end: Math.max(end, start) };
}

function applyPair(text: string, selection: TextSelection, marker: string): FormatResult {
  const { from, to } = selection;
  const length = marker.length;
  const selected = text.slice(from, to);

  if (from === to) {
    // 空选区：插一对标记，光标停在中间
    return {
      text: text.slice(0, from) + marker + marker + text.slice(from),
      selection: { from: from + length, to: from + length },
    };
  }
  if (
    from >= length &&
    text.slice(from - length, from) === marker &&
    text.slice(to, to + length) === marker
  ) {
    // 标记就在选区外两侧 → 去掉
    return {
      text: text.slice(0, from - length) + selected + text.slice(to + length),
      selection: { from: from - length, to: to - length },
    };
  }
  if (selected.length >= 2 * length && selected.startsWith(marker) && selected.endsWith(marker)) {
    // 标记被一起选进来了 → 去掉
    const inner = selected.slice(length, selected.length - length);
    return {
      text: text.slice(0, from) + inner + text.slice(to),
      selection: { from, to: to - 2 * length },
    };
  }
  return {
    text: text.slice(0, from) + marker + selected + marker + text.slice(to),
    selection: { from: from + length, to: to + length },
  };
}

function applyLink(text: string, selection: TextSelection): FormatResult {
  const { from, to } = selection;
  const selected = text.slice(from, to);

  if (from === to) {
    const inserted = `[${LINK_PLACEHOLDER}](${LINK_URL})`;
    return {
      text: text.slice(0, from) + inserted + text.slice(from),
      selection: { from: from + 1, to: from + 1 + LINK_PLACEHOLDER.length },
    };
  }
  // 已经是链接 → 拆回纯文字（toggle），避免层层套链接
  const existing = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(selected);
  if (existing) {
    const label = existing[1] ?? "";
    return {
      text: text.slice(0, from) + label + text.slice(to),
      selection: { from, to: from + label.length },
    };
  }
  const inserted = `[${selected}](${LINK_URL})`;
  const urlStart = from + selected.length + 3; // "[" + 文字 + "]("
  return {
    text: text.slice(0, from) + inserted + text.slice(to),
    selection: { from: urlStart, to: urlStart + LINK_URL.length },
  };
}

function applyLinePrefix(
  text: string,
  selection: TextSelection,
  rule: LineRule,
): FormatResult {
  /*
    空文档：没有"行"可加前缀，但命令**不能变成没反应**——用户是在空录入框里选了「引用」。
    这时插入前缀本身，光标落在前缀之后（接着打字就是这一行的内容）。
  */
  if (text.trim() === "") {
    const prefix = rule.prefix(0);
    return { text: prefix, selection: { from: prefix.length, to: prefix.length } };
  }

  const { start, end } = coveredLines(text, selection);
  const lines = text.slice(start, end).split("\n");
  const filled = lines.filter((line) => line.trim() !== "");
  const allHavePrefix = filled.length > 0 && filled.every((line) => rule.has(line));

  let index = 0;
  const next = lines.map((line) => {
    if (line.trim() === "") return line;
    if (allHavePrefix) return rule.strip(line);
    if (rule.has(line)) {
      index += 1;
      return line;
    }
    const prefixed = rule.prefix(index) + line;
    index += 1;
    return prefixed;
  });

  const block = next.join("\n");
  return { text: text.slice(0, start) + block + text.slice(end), selection: { from: start, to: start + block.length } };
}

function applyCodeBlock(text: string, selection: TextSelection): FormatResult {
  const { from, to } = selection;
  if (from === to) {
    const inserted = `${CODE_FENCE}\n\n${CODE_FENCE}`;
    return {
      text: text.slice(0, from) + inserted + text.slice(from),
      selection: { from: from + CODE_FENCE.length + 1, to: from + CODE_FENCE.length + 1 },
    };
  }
  const { start, end } = coveredLines(text, selection);
  const lines = text.slice(start, end).split("\n");
  const first = lines[0] ?? "";
  const last = lines[lines.length - 1] ?? "";
  const fences = lines.filter((line) => line.trim().startsWith(CODE_FENCE)).length;

  // 已包在围栏里 → 去掉首尾两条围栏（中间内容一字不动）
  if (fences === 2 && first.trim().startsWith(CODE_FENCE) && last.trim().startsWith(CODE_FENCE)) {
    const inner = lines.slice(1, -1).join("\n");
    return { text: text.slice(0, start) + inner + text.slice(end), selection: { from: start, to: start + inner.length } };
  }

  /*
    选区只盖住围栏**里面**的内容时也去掉围栏——与成对标记的「标记就在选区外两侧」同一语义。
    不加这一条，用户选中围栏内的代码再点「代码块」会得到嵌套围栏（``` 套 ```），那不是他想要的。
  */
  const inner = lines.join("\n");
  const prevLine = lineBefore(text, start);
  const nextLine = lineAfter(text, end);
  if (
    prevLine !== null &&
    nextLine !== null &&
    prevLine.trim().startsWith(CODE_FENCE) &&
    nextLine.trim().startsWith(CODE_FENCE)
  ) {
    const prevStart = start - prevLine.length - 1; // 前一行的行首（含它前面的换行符）
    const nextEnd = end + 1 + nextLine.length;
    return {
      text: text.slice(0, prevStart) + inner + text.slice(nextEnd),
      selection: { from: prevStart, to: prevStart + inner.length },
    };
  }

  const block = `${CODE_FENCE}\n${inner}\n${CODE_FENCE}`;
  return {
    text: text.slice(0, start) + block + text.slice(end),
    selection: { from: start + CODE_FENCE.length + 1, to: start + CODE_FENCE.length + 1 + inner.length },
  };
}

/** 取 `at` 这一行**前面**那一行的文本；没有前一行（在文首）时返回 null。 */
function lineBefore(text: string, at: number): string | null {
  if (at <= 0) return null;
  const end = at - 1; // 前一行的换行符位置
  if (text[end] !== "\n") return null;
  return text.slice(text.lastIndexOf("\n", end - 1) + 1, end);
}

/** 取 `at` 这一行**后面**那一行的文本；没有后一行（在文末）时返回 null。 */
function lineAfter(text: string, at: number): string | null {
  if (at >= text.length) return null;
  if (text[at] !== "\n") return null;
  const start = at + 1;
  const end = text.indexOf("\n", start);
  return text.slice(start, end === -1 ? text.length : end);
}

/** 行前缀命令的 id 集合：`LINE_RULES` 的键就是它。 */
type LineCommandId = keyof typeof LINE_RULES;

/**
 * 执行一条格式命令。纯函数：同样的入参永远得到同样的结果，不改动入参。
 *
 * 分支顺序即分类：成对标记 → 链接 → 代码块 → 标题（级别感知）→ 其余行前缀。最后一段的
 * `LINE_RULES[command]` 依赖类型收窄——**新加一个命令 id 却忘了在这里实现，TypeScript 会直接报错**
 * （不是静默不改文本）。
 *
 * 标题的级别语义（编辑器专项优化 P1，对齐工具栏的「标题 ▾」菜单）：
 * **覆盖行全部是这一级 → 统一降回普通行；否则每一行都设成这一级**（已有的别的级别一起改掉）。
 * 这比"已有任意标题就保留"更可预测——菜单里选的是「标题 3」，结果里就该全是三级。
 * 不带参数时级别取 2，`/` 菜单与既有用例的 `##` 行为不变。级别 0（「正文」）只做去掉：
 * 把覆盖行上的标题标记删掉，本来就没有标题时文本原样返回。
 */
export function applyFormatCommand(
  text: string,
  selection: TextSelection,
  command: FormatCommandId,
  arg?: FormatCommandArg,
): FormatResult {
  if (isPairCommand(command)) return applyPair(text, selection, PAIR_MARKERS[command]);
  if (command === "link") return applyLink(text, selection);
  if (command === "code-block") return applyCodeBlock(text, selection);
  if (command === "heading") {
    const level = Math.min(6, Math.max(0, Math.trunc(arg?.headingLevel ?? 2)));
    if (level === 0) return stripHeadingPrefix(text, selection);
    return applyHeading(text, selection, level);
  }
  return applyLinePrefix(text, selection, LINE_RULES[command satisfies LineCommandId]);
}

/** 这一行标题的级别（`#` 的个数）；不是标题行时返回 0。 */
function headingLevelOf(line: string): number {
  const match = /^\s*(#{1,6})\s+/.exec(line);
  return match ? (match[1]?.length ?? 0) : 0;
}

/**
 * 标题命令（级别 1–6）：**覆盖行全部是这一级 → 统一降回普通行；否则每一行都设成这一级**
 * ——先摘掉已有的别的级别标记，再上这一级的（"选了标题 3，结果就该全是三级"）。
 * 不能走通用的 `applyLinePrefix`：它只会往行首加前缀，遇到 `# 旧标题` 会变成 `## # 旧标题`。
 * 空文档时直接给出这一级的前缀（与行前缀命令的空文档分支同一待遇）。
 */
function applyHeading(text: string, selection: TextSelection, level: number): FormatResult {
  if (text.trim() === "") {
    const prefix = `${"#".repeat(level)} `;
    return { text: prefix, selection: { from: prefix.length, to: prefix.length } };
  }
  const { start, end } = coveredLines(text, selection);
  const lines = text.slice(start, end).split("\n");
  const filled = lines.filter((line) => line.trim() !== "");
  const allAtLevel = filled.length > 0 && filled.every((line) => headingLevelOf(line) === level);
  const prefix = `${"#".repeat(level)} `;
  const next = lines.map((line) => {
    if (line.trim() === "") return line;
    if (allAtLevel) return line.replace(/^(\s*)#{1,6}\s+/, "$1");
    return prefix + line.replace(/^(\s*)#{1,6}\s+/, "$1");
  });
  const block = next.join("\n");
  return { text: text.slice(0, start) + block + text.slice(end), selection: { from: start, to: start + block.length } };
}

/**
 * 「正文」（级别 0）：把覆盖行上已有的标题标记去掉。
 * 一行标题都没有时原样返回（调用方据此跳过落盘，不产生空撤销步）。
 */
function stripHeadingPrefix(text: string, selection: TextSelection): FormatResult {
  const { start, end } = coveredLines(text, selection);
  const lines = text.slice(start, end).split("\n");
  let changed = false;
  const next = lines.map((line) => {
    if (headingLevelOf(line) === 0) return line;
    changed = true;
    return line.replace(/^(\s*)#{1,6}\s+/, "$1");
  });
  if (!changed) return { text, selection };
  const block = next.join("\n");
  return { text: text.slice(0, start) + block + text.slice(end), selection: { from: start, to: start + block.length } };
}

/**
 * 两段文本的**最小变更区间**（编辑器专项优化 P1）：公共前缀 + 公共后缀之外的那一小段。
 *
 * 早先命令落盘走的是"整篇替换"（`{from: 0, to: 整篇}`），功能对但代价差：撤销一步的
 * 粒度是整篇、CodeMirror 要重新映射全部行、自动保存的差分也白算。这里只把真正变了
 * 的那一小段交给 CodeMirror。两段完全相同时返回空区间，调用方可据此跳过派发。
 */
export function minimalChange(
  before: string,
  after: string,
): { from: number; to: number; insert: string } {
  if (before === after) return { from: 0, to: 0, insert: "" };
  const commonMax = Math.min(before.length, after.length);
  let from = 0;
  while (from < commonMax && before[from] === after[from]) from += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > from && endAfter > from && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return { from, to: endBefore, insert: after.slice(from, endAfter) };
}

/** 命令的中文名（菜单与提示共用，避免两处各写一份）。 */
export const FORMAT_COMMAND_LABELS: Record<FormatCommandId, string> = {
  bold: "加粗",
  italic: "斜体",
  strikethrough: "删除线",
  "bullet-list": "无序列表",
  "ordered-list": "有序列表",
  quote: "引用",
  "inline-code": "行内代码",
  link: "链接",
  heading: "标题",
  "code-block": "代码块",
  "task-list": "任务清单",
};

/**
 * 快捷输入的**基础命令集**：加粗 / 斜体 / 无序 / 有序 / 引用 / 行内代码 / 链接。
 *
 * `格式能力的产品边界`（设计 v3 §三-2）里快捷输入这一列：标题＝否、代码块＝暂不作为首期要求；
 * **任务清单＝"按 Memo / 待办场景需要提供"**，所以它不在这个基础集里，而由
 * {@link quickFormatCommandsFor} 按场景追加。
 */
export const QUICK_FORMAT_COMMANDS: readonly FormatCommandId[] = [
  "bold",
  "italic",
  "bullet-list",
  "ordered-list",
  "quote",
  "inline-code",
  "link",
];

/** 哪些快捷输入场景要"任务清单"（设计 v3 §三-2：按 Memo / 待办场景需要提供） */
const TASK_LIST_HOSTS: ReadonlySet<QuickFormatHost> = new Set(["memo", "task"]);

/** 快捷输入宿主：`memo` / `task` / `note`（与 `quick-attributes.ts` 的宿主口径一致） */
export type QuickFormatHost = "memo" | "task" | "note";

/**
 * 某个快捷输入场景能用的 `/` 命令：基础集 +（Memo / 待办）任务清单。
 *
 * 与 `attributeCommandsFor(host)` 同一个路子：**按场景给命令**，不在组件里写 if。
 * 笔记快捷录入是长内容的草稿入口，首期不给任务清单（设计 §三-2 那一格只写了 Memo / 待办）。
 */
export function quickFormatCommandsFor(host: QuickFormatHost): readonly FormatCommandId[] {
  return TASK_LIST_HOSTS.has(host)
    ? [...QUICK_FORMAT_COMMANDS, "task-list"]
    : QUICK_FORMAT_COMMANDS;
}
