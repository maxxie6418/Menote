/**
 * 条目 md 的 YAML front matter（需求 §10.2、功能拆解 M04-06/M07-03）。
 *
 * 格式约定：文件**开头**是 `---` 包裹的 YAML，应用数据挂在 **`menote:` 根键**下
 * （需求 §10.2 的表格示例即 `menote: { type: table, row_id_column, ... }`）。本模块只认这一层，
 * 不做通用 YAML。
 *
 * **布局（2026-10-11 定）**：外来键（原样保留）→ `title` → `tags` → `status` → `due` →
 * `priority` → `menote:`。清单三字段是**顶层平铺键**，与 Obsidian 等外部工具写法一致；
 * 旧的 `menote.task:` **只读不写**——任何一次 `patch.task` 命中就把它整段搬到顶层（懒迁移，
 * 设计《属性栏与清单字段平铺》§3 / §5）。
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
  /**
   * 清单三字段；`null` = **顶层三个键与旧 `menote.task` 一个都没有**——清单标记的有无就看它（M07-04）。
   *
   * **2026-10-11 平铺**（设计《属性栏与清单字段平铺》§3）：三个字段升为顶层键
   * `status` / `due` / `priority`，与 `tags` / `title` 一样待在 `menote:` 块**之外**，写法与
   * Obsidian 等外部工具一致。**字段名与类型都没变，只是键位改了**——所以本字段的判断
   * 「顶层任意一个键在，就算清单条目」与旧口径（有没有 `menote.task` 键）是同一个意思。
   *
   * 旧写法 `menote.task:` 里的值仍**读**得出来（懒迁移，见 `parseMenoteMeta`），但任何一次
   * `patch.task` 写入都会把它整段搬到顶层。
   */
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
   * **一律原样保留，MeNote 不解释**。顶层只有白名单里的键（`tags`、`title`，以及清单三键
   * `status` / `due` / `priority`）会被取走，它们**不在这个字段里**——否则重建文档时会被写两遍。
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
/**
 * 拆出围栏内的原始文本；没有合法 front matter 时返回 null（此时整篇都是正文）。
 *
 * `stop` = 收尾围栏那一行**之后**的下标（含它自己的换行；文档正好结束在围栏上时就是文末）。
 * `frontmatterText` / `frontmatterRange` 都建立在它之上，别再各算一遍偏移。
 */
function splitFences(markdown: string): { raw: string; body: string; stop: number } | null {
  let text = markdown;
  let offset = 0;
  if (text.startsWith("\uFEFF")) {
    text = text.slice(1);
    offset = 1;
  }

  const lines = text.split("\n");

  /*
    跳过开头的空白行（2026-10-11，用户报的第二种「yaml 没被识别到」）：剪藏 / 导出工具常在
    最前面多写一个空行，严格判据（front matter 必须紧贴文件开头）会因此**整段不认**——
    属性卡片读不到、编辑器也不藏。允许它被若干空行顶下去。这些空行会在下一次写回时被顺手去掉
    （`frontmatterRange` 的起点仍在文件开头），是单向归一，不会来回抖。
  */
  let start = 0;
  while (start < lines.length && (lines[start] ?? "").trim() === "") {
    offset += (lines[start] ?? "").length + 1;
    start += 1;
  }

  // 与从前同一条判据：开场必须是**裸的** `---`（前导空格不接受），只是现在前面允许有空行
  const fence = lines[start];
  if (!fence?.startsWith(FRONTMATTER_FENCE) || fence.trim() !== FRONTMATTER_FENCE) return null;

  const end = lines.findIndex((line, index) => index > start && line.trim() === FRONTMATTER_FENCE);
  if (end === -1) return null; // 没闭合 → 降级为普通正文

  let stop = offset;
  for (let index = start; index <= end; index += 1) stop += (lines[index] ?? "").length + 1;
  // 文档正好结束在收尾围栏上时没有末尾那个换行，上面逐行 +1 会多算一格
  if (stop > markdown.length) stop = markdown.length;

  return {
    raw: lines.slice(start + 1, end).join("\n"),
    body: lines.slice(end + 1).join("\n").replace(/^\n/, ""),
    stop,
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

/**
 * 取**旧写法** `menote.task:` 段（一层嵌套）。
 *
 * 2026-10-11 起清单三字段的家是顶层（`TASK_KEYS`），这里只服务**存量笔记**的读路径；
 * 写完一次就搬走了，不必再往这里加东西。
 */
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

/**
 * 清单三字段的**顶层键**，数组顺序就是写入顺序（`status` → `due` → `priority`）。
 *
 * 2026-10-11 从 `menote.task:` 里平铺上来（设计《属性栏与清单字段平铺》§3）。放进白名单的
 * 直接后果是：这三个键会被 MeNote **无条件接管**，外部文档里同名的普通属性会被吞掉并在
 * 下一次写入时被覆盖——这是用户明确接受的代价（同设计 §4），换的是与 Obsidian 一致的写法。
 */
const TASK_KEYS = ["status", "due", "priority"] as const;

/**
 * 顶层键白名单：只有这些会被 MeNote 取走，其余顶层行一律原样保留（见文件头「两层各管各的」）。
 *
 * **数组顺序就是写入顺序**：`title` → `tags` → 清单三键（设计 §2 的布局）。
 * `updateMenoteKeys` 拿它当排序键，所以这里改顺序就等于改产出文件的键序。
 */
const TOP_LEVEL_KEYS = ["title", "tags", ...TASK_KEYS] as const;

/**
 * 顶层清单键的取值。
 *
 * 空写法（空串 / `null` / `~`）一律当**没有值**（`null`），与 `taskOf` 对旧块的处理同一口径——
 * 于是 `status:`（键在、值为空）算**清单条目但状态没设**，「键存在即清单条目」因此得以成立。
 */
function taskScalarOf(segment: Segment): string | null {
  const value = scalarOf(segment);
  return value === "" || value === "null" || value === "~" ? null : value;
}

/**
 * 拆顶层行：白名单里的键取出来交给 `meta`，其余**原样**留在 `foreignLines`。
 *
 * 顶层键取走而不留在 `foreignLines`，是为了让 `buildDocument` 重建时不会写两遍
 * （外来键 + `meta` 各写一次）。`tags` 与清单三键走这个出口，也就是它们在 MeNote 里的家是**顶层**。
 *
 * 同名的重复键**首次优先**（与 `tags` / `title` 既有口径一致）；清单三键是**逐键**判断的，
 * 只要有一个在就返回非 null 的 `TaskFields`，缺的那些留 `null`。
 */
function takeTopLevelKeys(outerLines: readonly string[]): {
  foreignLines: string[];
  /** `undefined` = 顶层**没有** `title:` 键（md 不接管）；`null` = 有键但取不到值 */
  title: string | null | undefined;
  tags: string[] | null;
  /** `null` = 顶层**三个键一个都没有**（与「键在但值为空」不同，后者是非 null 的 `TaskFields`） */
  task: TaskFields | null;
} {
  const { segments } = splitSegments(outerLines);
  const foreignLines: string[] = [];
  let title: string | null | undefined;
  let tags: string[] | null = null;
  let task: TaskFields | null = null;

  for (const segment of segments) {
    const owned = (TOP_LEVEL_KEYS as readonly string[]).includes(segment.key);
    if (owned) {
      if (segment.key === "tags" && tags === null) tags = tagsOf(segment);
      if (segment.key === "title" && title === undefined) title = scalarOf(segment) || null;
      if ((TASK_KEYS as readonly string[]).includes(segment.key)) {
        if (task === null) task = { status: null, due: null, priority: null };
        const key = segment.key as (typeof TASK_KEYS)[number];
        if (task[key] === null) task[key] = taskScalarOf(segment);
      }
      continue;
    }
    foreignLines.push(...segment.lines);
  }

  return { foreignLines, title, tags, task };
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

  /*
    清单三字段**双读**（懒迁移，设计 §5）：顶层优先，顶层缺哪个字段就回落到旧 `menote.task`
    的同名字段。只要有一处出现就算清单条目——「键存在即清单条目」的判据因此对两种写法都成立。
    顶层一个键都没有（`top.task === null`）时保持上面从旧块读到的结果。
  */
  const legacyTask = meta.task;
  if (top.task) {
    meta.task = {
      status: top.task.status ?? legacyTask?.status ?? null,
      due: top.task.due ?? legacyTask?.due ?? null,
      priority: top.task.priority ?? legacyTask?.priority ?? null,
    };
  }

  return { meta, body: split.body, raw: split.raw };
}

/** 一个外来顶层键（外部 Markdown 工具写进来的那些）的原样视图 */
export interface ForeignKey {
  key: string;
  /**
   * 值的**原文**（不含 `key:` 那一行）。
   *
   * **不解析成结构**——解析了再拼回去就得引 YAML 库，而「拼错了就丢字段」正是本模块
   * 一直避免的事（文件头「为什么自己写解析而不引 YAML 库」）。这里只把原文带着走。
   */
  value: string;
  /** 该键带缩进子行（块形状，如 `author:` 下面跟 `- "Unknown"`） */
  block: boolean;
}

/** 键名只能用字母、数字、下划线、连字符——含 `:` 或空格会让整块 YAML 坏掉 */
const FOREIGN_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 不许通过外来键入口改的键：`title` / `tags` 是 MeNote 自己的（各有专门的行），`menote` 删了等于毁表格 */
const RESERVED_KEYS: ReadonlySet<string> = new Set([...TOP_LEVEL_KEYS, MENOTE_KEY]);

function foreignKeyError(reason: string): Error {
  return new Error(reason);
}

/** 外来键的取值校验。只挡**真的会写出坏 YAML** 的两种，单行值里的 `: ` 与 ` #`（YAML 纯量里会截断） */
function assertForeignValue(value: string, block: boolean): void {
  if (block) return; // 缩进子行里的冒号不截断
  if (value.includes(": ") || value.includes(" #")) {
    throw foreignKeyError("值里有「: 」或「 #」，会截断成别的内容；想保留就在值里自己加引号。");
  }
}

function assertForeignKey(key: string): void {
  if (!FOREIGN_KEY_PATTERN.test(key)) {
    throw foreignKeyError("键名只能用字母、数字、下划线、连字符——含冒号或空格的键写进去会让整块 YAML 坏掉。");
  }
  if (RESERVED_KEYS.has(key)) {
    throw foreignKeyError(`「${key}」是 MeNote 自己的键，上面已经有它的位置了。`);
  }
}

/**
 * 列出 front matter 里**外来**的顶层键（`title` / `tags` / `menote` 不在内）。
 *
 * 给「属性卡片」用：它要把这些键列出来给人看、给人改（设计稿 §4）。
 * 没有 front matter、或只有 MeNote 自己的键时返回空数组——不抛错。
 */
export function readForeignKeys(markdown: string): ForeignKey[] {
  const split = splitFences(markdown);
  if (!split) return [];

  const blockLines = split.raw.split("\n");
  const menoteIndex = blockLines.findIndex((line) => /^menote\s*:/.test(line));
  const outerLines = menoteIndex === -1 ? blockLines : blockLines.slice(0, menoteIndex);
  const { segments } = splitSegments(outerLines);

  const out: ForeignKey[] = [];
  for (const segment of segments) {
    if (RESERVED_KEYS.has(segment.key)) continue;
    const head = segment.lines[0] ?? "";
    const value = head.slice(head.indexOf(":") + 1).trim();
    out.push({
      key: segment.key,
      // 块的子行**连缩进一起原样给出**（不含 `key:` 那一行）：外来文件可能用 4 空格缩进，
      // 剥掉再补 2 格就改了格式，而「按原格式」是这块的全部承诺
      value: segment.lines.length > 1 ? segment.lines.slice(1).join("\n") : value,
      block: segment.lines.length > 1,
    });
  }
  return out;
}

/** 把外来键那一段渲染成写入用的行；`block` 决定是 `key: v` 还是 `key:` + 缩进子行 */
function renderForeignSegment(key: string, value: string, block: boolean): string[] {
  if (!block) return [`${key}: ${value}`];
  /*
    **已经带缩进的行原样写回**——外来文件可能是 4 空格缩进，补成 2 格就改了格式，
    而「按原格式」是这块的全部承诺。调用方给的是未缩进的值时，这里补标准的 2 格。
    **只能去行尾空白**：先 `trim()` 再判断有没有缩进的话，缩进已经被削掉了，判断永远为假。
  */
  const inner = value
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim() !== "");
  return [`${key}:`, ...inner.map((line) => (/^\s/.test(line) ? line : `  ${line}`))];
}

/** 切出「外来段 + menote 段」两块，交给 `compose` 重组 */
function splitBlocks(markdown: string): { foreign: string[]; inner: string[] } | null {
  const split = splitFences(markdown);
  if (!split) return null;
  const blockLines = split.raw.split("\n");
  const menoteIndex = blockLines.findIndex((line) => /^menote\s*:/.test(line));
  return {
    foreign: menoteIndex === -1 ? blockLines : blockLines.slice(0, menoteIndex),
    inner: menoteIndex === -1 ? [] : blockLines.slice(menoteIndex + 1),
  };
}

/** 用重组后的两块重新拼出整篇（外来键在前、`menote:` 在后，与 `updateMenoteKeys` 同一形状） */
function compose(markdown: string, foreign: readonly string[], inner: readonly string[]): string {
  const body = splitFences(markdown)?.body ?? markdown;
  const head = [...foreign];
  if (inner.length > 0) head.push(`${MENOTE_KEY}:`, ...inner);
  if (head.length === 0) return body;
  return `${FRONTMATTER_FENCE}\n${head.join("\n")}\n${FRONTMATTER_FENCE}\n\n${body}`;
}

/**
 * 写一个外来键的值——**原位替换，形状保留**（设计稿 §4）。
 *
 * 值按用户写的原文写入，**不解析、不重新转义、不自动加引号**。所以：
 * - 原来是块序列（带缩进子行）→ 传 `block: true`，仍是块序列；
 * - 原来是一行 → 传 `block: false`，仍是一行。
 *
 * 键不存在则插在**第一个自有键之前**（设计 §2 的布局：外来键在最前，自有键区
 * `title` / `tags` / 清单三键在它之后）；一个自有键都没有时追加到外来段末尾。
 *
 * **没有 front matter 的文档就在这一步建出来**（2026-10-11）：卡片在空白笔记上点
 * 「+ 添加属性」是常规入口，从前这里直接抛错，等于要求用户先用别的办法造一个 front matter。
 */
export function writeForeignKey(
  markdown: string,
  key: string,
  input: { value: string; block: boolean },
): string {
  assertForeignKey(key);
  assertForeignValue(input.value, input.block);

  const blocks = splitBlocks(markdown) ?? { foreign: [], inner: [] };

  const { segments } = splitSegments(blocks.foreign);
  const out: string[] = [];
  let replaced = false;
  let inserted = false;

  /*
    **先问一句「这一段里到底有没有这个键」，不能边扫边决定**。
    2026-10-11 修的那次重复就出在这里：从前只有「扫到一个自有键之前就插一份」这一个岔口，
    于是「被改的外来键排在自有键**之后**」（Obsidian 导出最常见的形状——`title` 在第一行、
    `url` / `author` 跟在后面）会先在 `title` 前面插一份、再在原位置替换出第二份，
    结果是**同一个键两行**（卡片上同名的属性也就出现两条）。判据必须是「整段里有没有」。
  */
  const exists = segments.some((segment) => segment.key === key);

  for (const segment of segments) {
    if (segment.key === key && !replaced) {
      out.push(...renderForeignSegment(key, input.value, input.block));
      replaced = true;
      inserted = true;
      continue;
    }
    if (!exists && !inserted && RESERVED_KEYS.has(segment.key)) {
      out.push(...renderForeignSegment(key, input.value, input.block));
      inserted = true;
    }
    out.push(...segment.lines);
  }
  if (!inserted) out.push(...renderForeignSegment(key, input.value, input.block));

  return compose(markdown, out, blocks.inner);
}

/** 删掉一个外来键（连同它的缩进子行）。其它外来键、`menote:` 块与正文一字不动 */
export function removeForeignKey(markdown: string, key: string): string {
  if (RESERVED_KEYS.has(key)) {
    throw foreignKeyError(`「${key}」是 MeNote 自己的键，不能从这里删。`);
  }
  const blocks = splitBlocks(markdown);
  if (!blocks) return markdown;

  const { segments } = splitSegments(blocks.foreign);
  const out: string[] = [];
  for (const segment of segments) {
    if (segment.key === key) continue;
    out.push(...segment.lines);
  }
  return compose(markdown, out, blocks.inner);
}

/**
 * 从 md 里取出 front matter 整段原文（**含两侧 `---` 与收尾那个换行**）；没有则返回 null。
 *
 * 卡片与编辑器之间靠它对齐（设计稿 §6）：先取出这一段、再算出新的那一段，然后交给
 * `EditorHandle.replaceFrontmatter` 原位替换。所以它必须与 `splitFences` 的判据一致，
 * 否则会算出长度不对的区间。
 */
export function frontmatterText(markdown: string): string | null {
  const split = splitFences(markdown);
  // 起点取 0 而不是围栏处：开头的 BOM 与前导空行也归这一段（写回时会被一并去掉，见 `splitFences`）
  return split ? markdown.slice(0, split.stop) : null;
}

/**
 * front matter 整段在原文里的区间：`from` = 文件开头（BOM 那一格除外），`to` = `splitFences`
 * 的 `stop`（收尾围栏那一行之后）。没有合法 front matter（含"没闭合"）返回 null。
 *
 * **它是这个判据的唯一实现**：编辑器拿它做整段零宽替换
 * （`apps/web/src/app/editor/frontmatter-hide.ts`），`section.ts` 拿它算正文偏移。
 * 从前两边各写一份，2026-10-11 一天里就踩了两次不一致（先漏 BOM、后漏前导空行），
 * 症状都是「属性卡片读得到、编辑器却把 YAML 露在正文里」。
 *
 * `from` 取文件开头（而不是围栏处）是**有意的**：前导空行因此一起被替换掉——第一次改动属性时
 * 这份文件就自己恢复成「front matter 紧贴开头」，外部工具（Obsidian 等）也就能认了。
 * BOM 那一格留着：它是零宽字符，藏不藏都看不见，没必要替用户改文件编码。
 */
export function frontmatterRange(markdown: string): { from: number; to: number } | null {
  const split = splitFences(markdown);
  if (!split) return null;
  return { from: markdown.startsWith("\uFEFF") ? 1 : 0, to: split.stop };
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
 * **2026-10-11 收窄**（《属性栏与清单字段平铺》§9）：MeNote 自己**不再往 md 写 `title:`**，
 * 标题的家是 `items.title` 派生列（不设置属性就不该有 YAML）。所以两边的关系是
 * 「**md 里没有这个键 → 列说了算；有这个键（外部导入的稿）→ md 说了算，改标题要跟着改**」。
 * 从前那句「md 为准，`items.title` 只是派生列」只对后者成立。
 *
 * 三态是这套口径的全部关键，调用方**必须**区分 `present`：
 * - `present: false`（md 里没有 `title:` 键）→ **不接管**，沿用 `items.title` 列。
 *   存量笔记与新建笔记全属这类，所以本函数对它们**行为完全不变**；只有外部导入、
 *   或历史上写过 `title:` 的稿才由 md 承载（`writeItemTitle` 按 `present` 决定要不要回写）。
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
function renderTagsLine(tags: readonly string[]): string | null {
  return tags.length > 0 ? `tags: ${renderInlineArray(tags)}` : null;
}

/** 标题行：含分隔符 / 引号 / 首尾空白时加引号（与标签同一套 `needsQuote` 口径） */
function renderTitleLine(title: string): string {
  return needsQuote(title) ? `title: "${title.replace(/"/g, '\\"')}"` : `title: ${title}`;
}

/**
 * 清单三字段的行——**顶层平铺、无缩进**（2026-10-11，设计《属性栏与清单字段平铺》§3）。
 *
 * 顺序固定为 `status` → `due` → `priority`（= `TASK_KEYS` 的数组顺序），空值不写行；
 * 三值全空时返回空数组，调用方据此整段不写。
 *
 * **一处已知取舍**：`task` 非 null 但三个值都空（只可能来自手写的 `status:` 空值或旧写法里
 * 光秃秃的 `menote.task:`）在平铺形状里**没有对应的写法**——没有「有键但没值」的顶层表示法。
 * 所以整篇重建时这种条目会**退回"不是清单条目"**。属性卡片不会产生这种状态（每次写入至少
 * 带一个值），故不为它单开一种写法。
 *
 * 从前这里是 `  task:` + `    status: …` 三层写法，`menote:` 块的子键。平铺之后块里不再有
 * 它，`type` / `converted_to` 不受影响。
 */
function renderTaskLines(task: TaskFields | null): string[] {
  if (!task) return [];
  const lines: string[] = [];
  if (task.status) lines.push(`status: ${task.status}`);
  if (task.due) lines.push(`due: ${task.due}`);
  if (task.priority) lines.push(`priority: ${task.priority}`);
  return lines;
}

/**
 * 从结构化 meta 生成完整文档（用于新建；已有的文档请用 `updateMenoteKeys` 保内容）。
 *
 * **布局（2026-10-11）**：外来键顶在最前，然后是自有顶层键 `title` / `tags` / 清单三键，
 * 最后才是 `menote:` 块——块里只放 MeNote 私有且**不是顶层键**的东西（`type` /
 * `converted_to` / 表格键），见文件头「两层各管各的」。
 *
 * 这是整篇重建的**唯一咽喉**：表格的单元格编辑与"降级为普通笔记"都走这里，
 * 靠它保住外来属性不丢。`menote:` 只在真的有子键时才写，免得产出 `menote: null` 空映射。
 */
export function buildDocument(meta: MenoteMeta, body: string): string {
  const inner: string[] = [];
  if (meta.type) inner.push(`  type: ${meta.type}`);
  if (meta.convertedTo) inner.push(`  converted_to: ${meta.convertedTo}`);
  inner.push(...meta.preservedLines);

  const head = [...meta.foreignLines];
  if (meta.title) head.push(renderTitleLine(meta.title));
  const tagsLine = renderTagsLine(meta.tags);
  if (tagsLine) head.push(tagsLine);
  head.push(...renderTaskLines(meta.task));
  if (inner.length > 0) head.push(`${MENOTE_KEY}:`, ...inner);
  if (head.length === 0) return body;
  return `${FRONTMATTER_FENCE}\n${head.join("\n")}\n${FRONTMATTER_FENCE}\n\n${body}`;
}

export interface MenotePatch {
  type?: string | null;
  tags?: string[];
  /** 标题。`null` = 删掉 `title:` 键（此后回落 `items.title` 列）；`undefined` = 不动 */
  title?: string | null;
  /** `null` = 删掉全部清单键（三个顶层键与旧 `menote.task:` 一起删）= 去掉清单标记（M07-04） */
  task?: TaskFields | null;
  /** `null` 表示删除该键 */
  convertedTo?: string | null;
}

/**
 * 只改写 patch 命中的键，**其它段原样保留**（含我们不解析的 columns / views，以及全部外来键）。
 * 这是保存路径唯一该用的写法：新建用 `buildDocument`，改写一律走这里。
 *
 * **布局**（2026-10-11 平铺）：外来键 → `title` → `tags` → `status` / `due` / `priority` →
 * `menote:`。被 patch 命中的自有键**丢弃原位置、按上面的顺序追加**，所以每次写入都朝布局收敛；
 * 外来键之间的相对顺序原样不动。
 *
 * 给 `tags` 打 patch 会顺手删掉旧的 `menote.tags`，给 `task` 打 patch 会顺手删掉旧的
 * `menote.task:`——**这就是懒迁移**（设计 §5），不需要迁移脚本。
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

  /*
    —— 顶层：外来键原样留着，自有键按「外来 → title → tags → 清单三键」重排 ——

    被 patch 命中的自有键先**丢弃**，再按固定顺序追加；没命中的自有键留在原地（位置可能因此
    排在外来键后面，但那本来就是被 patch 的这一路顺带收敛，值一字不改）。
    清单三键是**整体重写**：只要 patch 命中 `task`，三个键连同旧 `menote.task:` 一起作废。
  */
  const { header: topHeader, segments: topSegments } = splitSegments(outerLines);
  const foreignLines: string[] = [];
  const ownedSegments: Segment[] = [];
  for (const segment of topSegments) {
    const owned = (TOP_LEVEL_KEYS as readonly string[]).includes(segment.key);
    if (owned && segment.key === "tags" && patch.tags !== undefined) continue;
    if (owned && segment.key === "title" && patch.title !== undefined) continue;
    if (owned && (TASK_KEYS as readonly string[]).includes(segment.key) && patch.task !== undefined) {
      continue;
    }
    if (owned) ownedSegments.push(segment);
    else foreignLines.push(...segment.lines);
  }
  if (patch.title !== undefined && patch.title !== null) {
    ownedSegments.push({ key: "title", lines: [renderTitleLine(patch.title)] });
  }
  if (patch.tags !== undefined) {
    const tagsLine = renderTagsLine(patch.tags);
    if (tagsLine) ownedSegments.push({ key: "tags", lines: [tagsLine] });
  }
  if (patch.task !== undefined) {
    const taskLines = renderTaskLines(patch.task);
    // 段名借 `status` 用（三个键在 `TOP_LEVEL_KEYS` 里是连着的，取第一个的位次即可）
    if (taskLines.length > 0) ownedSegments.push({ key: "status", lines: taskLines });
  }
  /*
    自有键按 `TOP_LEVEL_KEYS` 的顺序排（**稳定排序**，同名的重复键保持原有先后）。
    这样布局与 patch 打了哪些键无关：`title` → `tags` → `status` → `due` → `priority` 永远是这个序。
  */
  ownedSegments.sort(
    (a, b) =>
      (TOP_LEVEL_KEYS as readonly string[]).indexOf(a.key) -
      (TOP_LEVEL_KEYS as readonly string[]).indexOf(b.key),
  );
  // 段头（front matter 顶部的空行 / 注释）也要留住——本函数只该改 patch 命中的键
  const headLines = [
    ...topHeader,
    ...foreignLines,
    ...ownedSegments.flatMap((segment) => segment.lines),
  ];

  // —— `menote:` 块内：只认私有的键 ——
  const { segments } = splitSegments(inner);
  const untouched: Segment[] = [];
  let sawType = false;
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
    // 旧写法的清单块：patch 命中就整段丢掉（值已经搬到顶层），没命中就原样留着给人读
    if (segment.key === "task") {
      if (patch.task === undefined) untouched.push(segment);
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

  // patch 里给了、原本没有的键：追加到 menote 映射末尾（清单三键不在这里，它在顶层）
  const appended: Segment[] = [];
  if (patch.type !== undefined && patch.type !== null && !sawType) {
    appended.push({ key: "type", lines: [`  type: ${patch.type}`] });
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

    **一个键都不剩时整段不要**（2026-10-11 修）：从前 head 为空也照拼围栏，清掉最后一个属性
    就留下 `---\n\n---`，用户看到的是"属性删不掉"，再打开还多一段空 front matter。
  */
  const bodyLines = [...untouched, ...appended].flatMap((segment) => segment.lines);
  if (headLines.length === 0 && bodyLines.length === 0) return split.body;

  const rendered = bodyLines.length > 0 ? [...headLines, `${MENOTE_KEY}:`, ...bodyLines] : headLines;

  return `${FRONTMATTER_FENCE}\n${rendered.join("\n")}\n${FRONTMATTER_FENCE}\n\n${split.body}`;
}
