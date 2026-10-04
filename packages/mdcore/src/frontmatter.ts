/**
 * 条目 md 的 YAML front matter（需求 §10.2、功能拆解 M04-06/M07-03）。
 *
 * 格式约定：文件**开头**是 `---` 包裹的 YAML，应用数据挂在 **`menote:` 根键**下
 * （需求 §10.2 的表格示例即 `menote: { type: table, row_id_column, ... }`）。本模块只认这一层，
 * 不做通用 YAML。
 *
 * **为什么自己写解析而不引 YAML 库**：`packages/mdcore` 定位是零依赖纯函数包；而 md 是我们自己
 * 生成的，读入时只需要一个**有界子集**（一层映射 + 标量 + 内联/块序列 + 一层嵌套）。
 * 引库换来的通用性，代价是一个生产依赖 + 与"纯函数包"的定位冲突；将来真需要再换（接口不变）。
 *
 * **安全底线**：解析**不丢未知内容**。表格的 `columns` / `views` 这类我们不解析的键，
 * 以"整段原始行"保留，改写时原样写回——否则保存一次就会吃掉表格元数据。
 * 格式坏了（没有闭合围栏、缩进错乱）一律**降级**：整篇当正文，不抛错（需求 §10.2「格式坏了可降级」）。
 */

export const FRONTMATTER_FENCE = "---";
export const MENOTE_KEY = "menote";

/** 任务字段（字面量口径见 `tasks.ts`；这里只做字符串承载，不做枚举校验） */
export interface TaskFields {
  status: string | null;
  due: string | null;
  priority: string | null;
}

export interface MenoteMeta {
  type: string | null;
  tags: string[];
  /**
   * 顶层 `title` 的值；`undefined` = **md 里没有 `title:` 这个键**。
   *
   * 三态区分很要紧（`undefined` / `null` / 字符串）：
   * - `undefined`：md 不接管标题 → 沿用 `items.title` 列（**存量笔记**都属这类，行为与从前一致）
   * - 字符串：md 权威
   * - `null`：有 `title:` 键但取不到值 → 当作没有，回落到既有兜底
   *
   * Memo 恒为 `undefined`——Memo 没有独立标题（`assertItemShape` 要求 `items.title` 为 null）。
   */
  title?: string | null;
  /** `null` 表示**没有** `menote.task` 键——清单标记的有无就看它（M07-04） */
  task: TaskFields | null;
  /**
   * Memo 转笔记后的**新笔记 id**（Q10：原 Memo 保留并显示"已转为笔记"的链接）。
   *
   * 可选：绝大多数条目没有这个键。放在 md 里而不是本地表，是因为关联必须跟着数据同步——
   * 否则换一台设备打开时那条链接就没了。
   */
  convertedTo?: string | null;
  /**
   * `menote:` 块内**不解析、但必须原样保留**的行（如表格的 `columns` / `views`）。
   *
   * **只装 `menote:` 块内的行**（2026-10-04 拆语义）。此前它还兼着"外来 front matter 整块"
   * 的职责，于是 `readTableKeys` 按 `columns` / `views` 键名二次解析时，可能把**外来文档**
   * 的同名键当成 MeNote 的表格列定义。外来键改由 `MenoteMeta.foreignLines` 承载。
   */
  preservedLines: string[];
  /**
   * `menote:` 块**之前**的顶层行 —— 外来 front matter（如 Obsidian 的 `url` / `author` / `status`）。
   *
   * **一律原样保留，MeNote 不解释**。顶层只有白名单里的键（`tags`，以及 `title`）会被取走，
   * 它们**不在这个字段里**——否则重建文档时会被写两遍。
   *
   * **为什么挂在 `MenoteMeta` 上、而不是解析结果的旁挂字段**：整篇重建的入口只有
   * `buildDocument` 一处，而表格的单元格编辑（`renderTableDocument`）与降级为笔记
   * （`stripTableMeta`）**都会整篇重建**。挂在这里，重建时经 `{...meta}` 展开自动带过去，
   * 不会像旁挂字段那样要靠每个调用方记得透传——漏一个就是丢一次外来属性。
   */
  foreignLines: string[];
}

export interface ParsedDocument {
  meta: MenoteMeta;
  body: string;
  /** 原文的 front matter 文本（不含两侧围栏）；没有则为 null */
  raw: string | null;
}

/**
 * 空的 meta。
 *
 * **必须是工厂、不能是共享常量**（2026-09-27 修）：早先写的是
 * `const EMPTY_META = {...}` + `{ ...EMPTY_META }`——那是**浅拷贝**，于是每次解析都往
 * **同一个** `preservedLines` / `tags` 数组里累计：同一进程里解析第二篇文档时，会带上上一篇的
 * 保留行（表格的 `columns` / `views` 就在其中）。表格式编解码一开始用 `preservedLines`，
 * 立刻把它照出来了：第二份文档的列定义变成"上一篇 + 这一篇"。
 *
 * 这类 bug 的可怕之处是它**跨文档、跨请求**地污染数据，而单测只解析一篇时完全看不出来。
 */
function emptyMeta(): MenoteMeta {
  return { type: null, tags: [], task: null, preservedLines: [], foreignLines: [] };
}
/** 拆出围栏内的原始文本；没有合法 front matter 时返回 null（此时整篇都是正文） */
function splitFences(markdown: string): { raw: string; body: string } | null {
  const text = markdown.startsWith("\uFEFF") ? markdown.slice(1) : markdown;
  if (!text.startsWith(`${FRONTMATTER_FENCE}\n`) && text.trimEnd() !== FRONTMATTER_FENCE) {
    if (!text.startsWith(FRONTMATTER_FENCE)) return null;
  }

  const lines = text.split("\n");
  if (lines[0]?.trim() !== FRONTMATTER_FENCE) return null;

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === FRONTMATTER_FENCE);
  if (end === -1) return null; // 没闭合 → 降级为普通正文

  return {
    raw: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n").replace(/^\n/, ""),
  };
}

/** `[a, b, "c,d"]` → 数组；不去重、不裁剪语义，交给上层 */
function parseInlineArray(text: string): string[] {
  const inner = text.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (inner.trim() === "") return [];

  const out: string[] = [];
  let current = "";
  let quoted = false;

  for (const char of inner) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current.trim());
  return out.filter((item) => item !== "");
}

/**
 * 需要加引号的值：含分隔符、引号，或首尾空白。
 *
 * **`: ` 与 `#` 也必须算进去**（2026-10-04 补）：YAML 的纯量里这两个会截断——
 * `title: 第 3 章: 笔记` 直接是非法 YAML（"mapping values are not allowed here"），
 * `tags: [a # 注释]` 会被读成 `a` 加一条注释。宁可多打一对引号（YAML 接受带引号标量），
 * 也不能产出解析不回来的文件。
 */
function needsQuote(value: string): boolean {
  return /[,[\]{}"':#]/.test(value) || value.trim() !== value;
}

export function renderInlineArray(values: readonly string[]): string {
  return `[${values.map((value) => (needsQuote(value) ? `"${value.replace(/"/g, '\\"')}"` : value)).join(", ")}]`;
}

/** 去掉标量两侧引号（保留内部内容原样） */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  return trimmed;
}

/**
 * 把一个块（menote 之下）按**顶层键**切成段：每段是 `键 + 其后续缩进行`。
 * 段是原样保留与行级改写的最小单位——只改被 patch 命中的段，其它段一字不动。
 */
interface Segment {
  key: string;
  lines: string[];
}

function splitSegments(lines: readonly string[]): { header: string[]; segments: Segment[] } {
  const header: string[] = [];
  const segments: Segment[] = [];
  let current: Segment | null = null;

  for (const line of lines) {
    const matched = /^(\s*)([A-Za-z0-9_-]+)\s*:/.exec(line);
    const indent = matched?.[1]?.length ?? 0;

    if (matched && indent <= 2) {
      if (current) segments.push(current);
      current = { key: matched[2] ?? "", lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
    else header.push(line);
  }
  if (current) segments.push(current);
  return { header, segments };
}

/** 从某个段里取标量值（`type: note` → `note`） */
function scalarOf(segment: Segment): string {
  const first = segment.lines[0] ?? "";
  const value = first.slice(first.indexOf(":") + 1);
  return unquote(value);
}

/** 取 `tags` 段：支持内联数组与块序列两种写法 */
function tagsOf(segment: Segment): string[] {
  const first = segment.lines[0] ?? "";
  const inline = first.slice(first.indexOf(":") + 1).trim();
  if (inline.startsWith("[")) return parseInlineArray(inline).map(unquote);

  const out: string[] = [];
  for (const line of segment.lines.slice(1)) {
    const matched = /^\s*-\s*(.+)$/.exec(line);
    if (matched?.[1]) out.push(unquote(matched[1]));
  }
  return out;
}

/** 取 `task` 段（一层嵌套） */
function taskOf(segment: Segment): TaskFields {
  const task: TaskFields = { status: null, due: null, priority: null };
  for (const line of segment.lines.slice(1)) {
    const matched = /^\s*(status|due|priority)\s*:\s*(.*)$/.exec(line);
    const key = matched?.[1] as keyof TaskFields | undefined;
    if (!key) continue;
    const value = unquote(matched?.[2] ?? "");
    task[key] = value === "" || value === "null" || value === "~" ? null : value;
  }
  return task;
}

/** 顶层键白名单：只有这些会被 MeNote 取走，其余顶层行一律原样保留（见文件头「两层各管各的」） */
const TOP_LEVEL_KEYS = ["tags", "title"] as const;

/**
 * 拆顶层行：白名单里的键取出来交给 `meta`，其余**原样**留在 `foreignLines`。
 *
 * 顶层键取走而不留在 `foreignLines`，是为了让 `buildDocument` 重建时不会写两遍
 * （外来键 + `meta` 各写一次）。`tags` 走这个出口，也就是它在 MeNote 里的家是**顶层**。
 */
function takeTopLevelKeys(outerLines: readonly string[]): {
  foreignLines: string[];
  /** `undefined` = 顶层**没有** `title:` 键（md 不接管）；`null` = 有键但取不到值 */
  title: string | null | undefined;
  tags: string[] | null;
} {
  const { segments } = splitSegments(outerLines);
  const foreignLines: string[] = [];
  let title: string | null | undefined;
  let tags: string[] | null = null;

  for (const segment of segments) {
    const owned = (TOP_LEVEL_KEYS as readonly string[]).includes(segment.key);
    if (owned) {
      if (segment.key === "tags" && tags === null) tags = tagsOf(segment);
      if (segment.key === "title" && title === undefined) title = scalarOf(segment) || null;
      continue;
    }
    foreignLines.push(...segment.lines);
  }

  return { foreignLines, title, tags };
}

/** 解析条目 md：拿到结构化 meta、正文，以及原始 front matter 文本 */
export function parseMenoteMeta(markdown: string): ParsedDocument {
  const split = splitFences(markdown);
  if (!split) return { meta: emptyMeta(), body: markdown, raw: null };

  const blockLines = split.raw.split("\n");
  const menoteIndex = blockLines.findIndex((line) => /^menote\s*:/.test(line));
  const outerLines = menoteIndex === -1 ? blockLines : blockLines.slice(0, menoteIndex);
  const top = takeTopLevelKeys(outerLines);
  const meta: MenoteMeta = emptyMeta();
  meta.foreignLines = top.foreignLines;
  if (top.title !== undefined) meta.title = top.title;

  if (menoteIndex !== -1) {
    const { segments } = splitSegments(blockLines.slice(menoteIndex + 1));

    for (const segment of segments) {
      if (segment.key === "type") meta.type = scalarOf(segment) || null;
      // 旧位置的 `menote.tags` 仍然读（存量笔记还没有顶层 tags），但**顶层优先**
      else if (segment.key === "tags") {
        if (top.tags === null) meta.tags = tagsOf(segment);
      } else if (segment.key === "task") meta.task = taskOf(segment);
      else if (segment.key === "converted_to") meta.convertedTo = scalarOf(segment) || null;
      else meta.preservedLines.push(...segment.lines);
    }
  }
  if (top.tags !== null) meta.tags = top.tags;

  return { meta, body: split.body, raw: split.raw };
}

/** 只取正文（去掉 front matter） */
export function stripFrontmatter(markdown: string): string {
  return parseMenoteMeta(markdown).body;
}

/** 标题的派生结果（设计《YAML frontmatter 兼容与标题入档》§6.1） */
export interface DerivedTitle {
  /** md 里**有没有** `title:` 这个键——决定 md 是否接管标题 */
  present: boolean;
  /** 键存在时的值；取不到值（`title:` 空着）则为 `null` */
  value: string | null;
}

/**
 * 从条目 md 派生标题。
 *
 * **md 为准，`items.title` 只是派生列**——与 `tags` / `task` 同一套哲学。
 *
 * 三态是这套口径的全部关键，调用方**必须**区分 `present`：
 * - `present: false`（md 里没有 `title:` 键）→ **不接管**，沿用 `items.title` 列。
 *   存量笔记全属这类，所以本函数上线对它们**行为完全不变**；等哪次保存写进了 `title:`，
 *   该条目的标题才改由 md 承载（懒迁移，不需要迁移脚本）。
 * - `present: true` + 字符串 → md 权威。
 * - `present: true` + `null`（`title:` 空着）→ 视为没有，回落调用方的兜底。
 *
 * **服务端不要用它**：`enc_self = 1` 的条目 body 是信封密文，服务端读不到明文，
 * 派生不出标题。标题一律由客户端派生、经既有的 `ItemMetaPatch` 上行
 * （那个补丁本来就带 `title`），与 `tags` / `task` 完全同路。
 */
export function deriveTitle(markdown: string): DerivedTitle {
  const { title } = parseMenoteMeta(markdown).meta;
  if (title === undefined) return { present: false, value: null };
  return { present: true, value: title === "" ? null : title };
}

/**
 * 渲染 `tags` 行；`indent` 为 `""` 即顶层（`tags: [a, b]`），为 `"  "` 即 `menote:` 块的子键。
 *
 * **顶层才是 `tags` 的家**（2026-10-04，对齐定稿 §528 / 功能拆解 §333 的「YAML `tags` 字段」）。
 * `menote.tags` 是 v0.2.4 实现时自选的嵌套，**定稿从未要求**；读仍兼容（存量笔记），
 * 写一律落顶层——改一次即完成懒迁移，不需要迁移脚本。
 */
function renderTagsLine(tags: readonly string[], indent = "  "): string | null {
  return tags.length > 0 ? `${indent}tags: ${renderInlineArray(tags)}` : null;
}

/** 标题行：含分隔符 / 引号 / 首尾空白时加引号（与标签同一套 `needsQuote` 口径） */
function renderTitleLine(title: string): string {
  return needsQuote(title) ? `title: "${title.replace(/"/g, '\\"')}"` : `title: ${title}`;
}

function renderTaskLines(task: TaskFields | null): string[] {
  if (!task) return [];
  const inner: string[] = [];
  if (task.status) inner.push(`    status: ${task.status}`);
  if (task.due) inner.push(`    due: ${task.due}`);
  if (task.priority) inner.push(`    priority: ${task.priority}`);
  return ["  task:", ...inner];
}

/**
 * 从结构化 meta 生成完整文档（用于新建；已有的文档请用 `updateMenoteKeys` 保内容）。
 *
 * **顶层写 `title` 与 `tags`，`menote:` 块只放 MeNote 私有的键**（表格键 / task / converted_to）——
 * 见文件头「两层各管各的」。外来键（`meta.foreignLines`）原样顶在最前。
 *
 * 这是整篇重建的**唯一咽喉**：表格的单元格编辑与"降级为普通笔记"都走这里，
 * 靠它保住外来属性不丢。`menote:` 只在真的有子键时才写，免得产出 `menote: null` 空映射。
 */
export function buildDocument(meta: MenoteMeta, body: string): string {
  const inner: string[] = [];
  if (meta.type) inner.push(`  type: ${meta.type}`);
  inner.push(...renderTaskLines(meta.task));
  if (meta.convertedTo) inner.push(`  converted_to: ${meta.convertedTo}`);
  inner.push(...meta.preservedLines);

  const head = [...meta.foreignLines];
  if (meta.title) head.push(renderTitleLine(meta.title));
  const tagsLine = renderTagsLine(meta.tags, "");
  if (tagsLine) head.push(tagsLine);
  if (inner.length > 0) head.push(`${MENOTE_KEY}:`, ...inner);
  if (head.length === 0) return body;
  return `${FRONTMATTER_FENCE}\n${head.join("\n")}\n${FRONTMATTER_FENCE}\n\n${body}`;
}

export interface MenotePatch {
  type?: string | null;
  tags?: string[];
  /** 标题。`null` = 删掉 `title:` 键（此后回落 `items.title` 列）；`undefined` = 不动 */
  title?: string | null;
  /** `null` 表示删除整个 task 块（= 去掉清单标记，M07-04） */
  task?: TaskFields | null;
  /** `null` 表示删除该键 */
  convertedTo?: string | null;
}

/**
 * 只改写 patch 命中的键，**其它段原样保留**（含我们不解析的 columns / views，以及全部外来键）。
 * 这是保存路径唯一该用的写法：新建用 `buildDocument`，改写一律走这里。
 *
 * 布局：顶层写 `title` 与 `tags`，`menote:` 块只放私有的键（`type` / `task` / `converted_to`
 * / 表格键）。给 `tags` 打 patch 时会**顺手删掉旧的 `menote.tags`**——这就是懒迁移。
 */
export function updateMenoteKeys(markdown: string, patch: MenotePatch): string {
  const split = splitFences(markdown);
  if (!split) {
    // 原本没有 front matter：按 patch 直接建一个
    const meta: MenoteMeta = {
      type: patch.type ?? null,
      tags: patch.tags ?? [],
      task: patch.task ?? null,
      preservedLines: [],
      foreignLines: [],
    };
    if (patch.title !== undefined && patch.title !== null) meta.title = patch.title;
    return buildDocument(meta, markdown);
  }

  const blockLines = split.raw.split("\n");
  const menoteIndex = blockLines.findIndex((line) => /^menote\s*:/.test(line));
  const outerLines = menoteIndex === -1 ? blockLines : blockLines.slice(0, menoteIndex);
  const inner = menoteIndex === -1 ? [] : blockLines.slice(menoteIndex + 1);

  // —— 顶层：外来键原样留着，被 patch 命中的 `title` / `tags` 就地重写 ——
  const { segments: topSegments } = splitSegments(outerLines);
  const headSegments: Segment[] = [];
  for (const segment of topSegments) {
    if (segment.key === "tags" && patch.tags !== undefined) continue; // 丢弃旧的，稍后统一重写
    if (segment.key === "title" && patch.title !== undefined) continue;
    headSegments.push(segment);
  }
  if (patch.title !== undefined && patch.title !== null) {
    headSegments.push({ key: "title", lines: [renderTitleLine(patch.title)] });
  }
  const topTagsLine = renderTagsLine(patch.tags ?? [], "");
  if (patch.tags !== undefined && topTagsLine) {
    headSegments.push({ key: "tags", lines: [topTagsLine] });
  }

  // —— `menote:` 块内：只认私有的键 ——
  const { segments } = splitSegments(inner);
  const untouched: Segment[] = [];
  let sawType = false;
  let sawTask = false;
  let sawConverted = false;

  for (const segment of segments) {
    if (segment.key === "type" && patch.type !== undefined) {
      sawType = true;
      if (patch.type !== null) untouched.push({ key: "type", lines: [`  type: ${patch.type}`] });
      continue;
    }
    // 旧位置的标签：patch 命中就迁到顶层（懒迁移），没命中就原样留着
    if (segment.key === "tags") {
      if (patch.tags === undefined) untouched.push(segment);
      continue;
    }
    if (segment.key === "task" && patch.task !== undefined) {
      sawTask = true;
      const lines = renderTaskLines(patch.task);
      if (lines.length > 0) untouched.push({ key: "task", lines });
      continue;
    }
    if (segment.key === "converted_to" && patch.convertedTo !== undefined) {
      sawConverted = true;
      if (patch.convertedTo !== null) {
        untouched.push({ key: "converted_to", lines: [`  converted_to: ${patch.convertedTo}`] });
      }
      continue;
    }
    untouched.push(segment);
  }

  // patch 里给了、原本没有的键：追加到 menote 映射末尾
  const appended: Segment[] = [];
  if (patch.type !== undefined && patch.type !== null && !sawType) {
    appended.push({ key: "type", lines: [`  type: ${patch.type}`] });
  }
  if (patch.task !== undefined && patch.task !== null && !sawTask) {
    appended.push({ key: "task", lines: renderTaskLines(patch.task) });
  }
  if (patch.convertedTo !== undefined && patch.convertedTo !== null && !sawConverted) {
    appended.push({ key: "converted_to", lines: [`  converted_to: ${patch.convertedTo}`] });
  }

  /*
    组装：`menote:` 永远是块末尾的**平级顶层键**，而且**必须带冒号**。

    此前这里写的是 `head[0]?.includes(MENOTE_KEY) ? head : [MENOTE_KEY, ...head]`——
    用"第一行是否含 menote"来判断有没有 menote 块，而 `MENOTE_KEY` 本身是**裸字符串
    "menote"、不带冒号**。于是两种输入都产出坏文件（2026-10-04 修复）：
      ① 外来 front matter（无 menote 块）：塞一个裸 `menote` 到最前 → 它成了 YAML 标量，
         后面外来键变成它的兄弟 → 整块非法，且新写的 `  tags:` 挂在不存在的父键下，
         **再解析读不回来（写进去的值自己丢了）**；
      ② 外来键 + menote 块并存：同样前置一个裸 `menote`，块被劈成两半。
    判据应当是"有没有 menote 块"（menoteIndex），不是"第一行长什么样"。

    `menote:` 只在真的有子键时才写——否则产出 `menote: null` 这种空映射。
  */
  const headLines = headSegments.flatMap((segment) => segment.lines);
  const bodyLines = [...untouched, ...appended].flatMap((segment) => segment.lines);
  const rendered = bodyLines.length > 0 ? [...headLines, `${MENOTE_KEY}:`, ...bodyLines] : headLines;

  return `${FRONTMATTER_FENCE}\n${rendered.join("\n")}\n${FRONTMATTER_FENCE}\n\n${split.body}`;
}
