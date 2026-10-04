/**
 * 表格的编解码（功能拆解 M05；《M4 设计》§二）。
 *
 * 一篇表格就是一条 `items.type = 'table'` 的条目：正文 = front matter（`menote:` 根键）
 * + GFM 管道表格 + 可选的 `## 附件` 章节。**不新增 D1 表**，编解码全在这里（零依赖纯函数，
 * 前后端同一份实现）。
 *
 * 五条口径（都来自设计 §二，实现时逐条落）：
 * 1. **YAML 键名**：`columns`（`{ id, name, type, options?, hidden? }`）/ `row_id_column`（固定 `_id`）/
 *    `views`（`default: table|gallery` + `gallery.image_column`）；
 * 2. **行 ID**：首列 `_id`，6–8 位 base36，**默认隐藏且不可删改**；保存时缺 ID 补发、
 *    重复 ID 保留首个其余重发；**大小写不敏感比较**；
 * 3. **单元格**：不可换行（换行写 `<br>`）；`|` 必须转义；只支持行内格式；
 *    单元格 >2000 字符、列数 >50 → **提示但不拒绝**；
 * 4. **读宽容、写规范**：类型不匹配按新类型宽容解析（编解码这一层只搬字符串，不做类型转换——
 *    "不改数据"就是这么来的）；解析不了显示原文 + 一处灰提示；
 * 5. **结构损坏 → 降级判定**（不静默改数据）：表头与列定义对不上、没有管道表格、围栏没闭合等，
 *    一律返回 `ok: false` 让上层**自动降级为普通笔记**（降级前的版本封存由上层做）。
 *
 * **不解析、但绝不丢**：不归表格管的 front matter 行原样带在 `preservedLines` 里，
 * 渲染时原样写回（与 `frontmatter.ts` 的"解析不丢未知内容"是同一条底线）。
 */
import {
  MENOTE_KEY,
  buildDocument,
  parseMenoteMeta,
  type MenoteMeta,
} from "./frontmatter";

/** 十种列类型（需求 §10.4；顺序即设置面板里的顺序） */
export const TABLE_COLUMN_TYPES = [
  "text",
  "number",
  "select",
  "multi_select",
  "checkbox",
  "status",
  "url",
  "image",
  "date",
  "tags",
] as const;
export type TableColumnType = (typeof TABLE_COLUMN_TYPES)[number];

/** 行 ID 列名：固定 `_id`（保留键名是为了将来能改名而不动结构） */
export const ROW_ID_COLUMN = "_id";

/** 提示级别（都不是拒绝：设计 §2.3 明确"提示但不拒绝"） */
export type TableNoticeKind =
  | "cell_too_long"
  | "too_many_columns"
  | "missing_row_id"
  | "duplicate_row_id"
  | "column_mismatch"
  | "unknown_column_type"
  | "duplicate_attachment_name";

export interface TableNotice {
  kind: TableNoticeKind;
  detail: string;
}

export interface TableColumn {
  id: string;
  name: string;
  type: TableColumnType;
  /** `select` / `multi_select` / `status` 的候选项 */
  options?: string[];
  /** `_id` 列默认隐藏（且不可删改） */
  hidden?: boolean;
}

export const TABLE_VIEWS = ["table", "gallery"] as const;
export type TableViewKind = (typeof TABLE_VIEWS)[number];

export interface TableViews {
  default: TableViewKind;
  gallery?: { image_column: string | null };
}

/** `## 附件` 章节里的一行：`- 名称（可选说明）` */
export interface TableAttachmentLine {
  /** 单元格里引用的名字（同名会加序号，见 `normalizeAttachmentNames`） */
  name: string;
  /** 原始行（原样保留括号注释等细节） */
  raw: string;
}

export interface TableDoc {
  columns: TableColumn[];
  rowIdColumn: string;
  views: TableViews;
  /**
   * 行：**键 = 列 id**（首列 `_id` 存行 ID）。
   *
   * 为什么按 id 而不是表头名字：列名是显示用的，改名不该丢数据。
   * 解析时表头单元格先按列 id 认，认不出再按列名认（宽容读入），所以手工写的表也读得进来。
   */
  rows: Array<Record<string, string>>;
  attachments: TableAttachmentLine[];
  notices: TableNotice[];
  /** 不归表格管的 front matter 行（一字不改地写回）。**只含 `menote:` 块内的行** */
  preservedLines: string[];
  /**
   * 顶层 `tags`。**必须跟着 `TableDoc` 流转**（2026-10-04）：`tags` 平铺到顶层之后，
   * `buildDocument` 会从 `meta.tags` 写顶层行，重渲染时若拿不到就会把用户的标签清空。
   */
  tags: string[];
  /**
   * 顶层 `title`；同 `tags`——`buildDocument` 从 `meta.title` 写顶层行，
   * 重渲染时拿不到就会把外来标题抹掉。
   *
   * `undefined` = 原文没有 `title:` 键（存量表格条目都属这类），重建时不写这一行。
   */
  title?: string | null;
  /**
   * `menote:` 块之前的顶层行（外来 front matter，如 Obsidian 的 `title` / `url`）。
   *
   * 表格的**任何一次单元格编辑都会整篇重建**（`renderTableDocument` → `buildDocument`），
   * 所以外来属性必须跟着 `TableDoc` 一起流转，否则改一个单元格就丢一次外来键。
   */
  foreignLines: string[];
}

export type ParseTableResult =
  | { ok: true; doc: TableDoc }
  | { ok: false; reason: string };

/** 单元格字符数提示线（设计 §2.3） */
export const CELL_NOTICE_CHARS = 2000;
/** 列数提示线（设计 §2.3） */
export const COLUMN_NOTICE_COUNT = 50;

// ——————————————————————————— 行 ID ———————————————————————————

const ROW_ID_PATTERN = /^[0-9a-z]{6,8}$/i;
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** 造一个新行 ID：6–8 位 base36（用 `crypto` 的随机源不可用时的兜底在调用方，这里只要确定性输入） */
export function makeRowId(random: () => number, length = 6): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)] ?? "0";
  }
  return out;
}

/** 行 ID 是否合法（6–8 位 base36） */
export function isRowId(value: string): boolean {
  return ROW_ID_PATTERN.test(value);
}

/** 行 ID 比较：**大小写不敏感**（设计 §2.2），查询/去重都该用它 */
export function sameRowId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export interface EnsureRowIdsResult {
  rows: Array<Record<string, string>>;
  notices: TableNotice[];
}

/**
 * 补齐与去重行 ID（设计 §2.2：**前端不自己造 ID**，读写两用都走这里）。
 *
 * 规则：缺 ID → 补发；重复 ID → **保留首个、后续重新分配**；非法（长度/字符不对）也按缺处理。
 * 随机源由调用方注入，所以这个函数是**确定性的**，测试可以直接喂一个固定序列。
 */
export function ensureRowIds(
  rows: ReadonlyArray<Record<string, string>>,
  random: () => number,
): EnsureRowIdsResult {
  const seen = new Set<string>();
  const notices: TableNotice[] = [];

  const next = rows.map((row, index) => {
    const current = (row[ROW_ID_COLUMN] ?? "").trim();
    if (current === "" || !isRowId(current)) {
      const issued = issueUniqueId(seen, random);
      notices.push({ kind: "missing_row_id", detail: `第 ${index + 1} 行没有合法 _id，已补发 ${issued}` });
      return { ...row, [ROW_ID_COLUMN]: issued };
    }
    if (seen.has(current.toLowerCase())) {
      const issued = issueUniqueId(seen, random);
      notices.push({
        kind: "duplicate_row_id",
        detail: `第 ${index + 1} 行的 _id（${current}）与前面重复，已改为 ${issued}`,
      });
      return { ...row, [ROW_ID_COLUMN]: issued };
    }
    seen.add(current.toLowerCase());
    return { ...row, [ROW_ID_COLUMN]: current };
  });

  return { rows: next, notices };
}

function issueUniqueId(seen: Set<string>, random: () => number): string {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = makeRowId(random, attempt % 3 === 2 ? 7 : 6);
    if (!seen.has(candidate.toLowerCase())) {
      seen.add(candidate.toLowerCase());
      return candidate;
    }
  }
  throw new Error("无法分配唯一的行 ID");
}

// ——————————————————————————— 单元格 ———————————————————————————

/** 转义单元格：`|` → `\|`，换行 → `<br>`（设计 §2.3：不可换行） */
export function escapeCell(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, "<br>")
    .trim();
}

/** 反转义单元格：`\|` → `|`，`<br>` → 换行（大小写不敏感，`<br/>` 也认） */
export function unescapeCell(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\\|/g, "|")
    .trim();
}

/** 按未转义的 `|` 切一行；两侧的竖线与空白都丢掉 */
export function splitRow(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutTail = inner.endsWith("|") && !inner.endsWith("\\|") ? inner.slice(0, -1) : inner;

  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < withoutTail.length; index += 1) {
    const char = withoutTail[index];
    if (char === "\\" && withoutTail[index + 1] === "|") {
      current += "\\|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/** 渲染一行：单元格转义后用 `|` 连接 */
export function renderRow(cells: readonly string[]): string {
  return `| ${cells.map(escapeCell).join(" | ")} |`;
}

// ——————————————————————————— 附件名 ———————————————————————————

/**
 * 同名图片加序号（设计 §2.1：单元格写名称引用，同名要能区分）。
 *
 * 保留第一个的名字，后续加 ` 2`、` 3`……（扩展名之前插序号，便于看图时仍按类型分组）。
 */
export function normalizeAttachmentNames(names: readonly string[]): string[] {
  const used = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const count = (used.get(key) ?? 0) + 1;
    used.set(key, count);
    if (count === 1) return name;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? `${name.slice(0, dot)} ${count}${name.slice(dot)}` : `${name} ${count}`;
  });
}

// ——————————————————————————— front matter 读写 ———————————————————————————

/** `[A-Za-z0-9_-]+:` 开头的行是顶层键；缩进 >2 的是它的内容 */
function segmentize(lines: readonly string[]): Array<{ key: string; lines: string[] }> {
  const segments: Array<{ key: string; lines: string[] }> = [];
  let current: { key: string; lines: string[] } | null = null;
  for (const line of lines) {
    const matched = /^\s*([A-Za-z0-9_-]+)\s*:/.exec(line);
    const indent = matched ? line.length - line.trimStart().length : Number.POSITIVE_INFINITY;
    if (matched && indent <= 2) {
      if (current) segments.push(current);
      current = { key: matched[1] ?? "", lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) segments.push(current);
  return segments;
}

/** 解析内联映射 `{ id: c1, name: 名称, type: text }`（只认一层，值里的冒号按第一次切） */
function parseInlineMap(text: string): Record<string, string> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const inner = trimmed.slice(1, -1);
  const out: Record<string, string> = {};
  let current = "";
  let depth = 0;
  const parts: string[] = [];
  for (const char of inner) {
    if (char === "[" ) depth += 1;
    if (char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);

  for (const part of parts) {
    const index = part.indexOf(":");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key !== "") out[key] = value.replace(/^["']|["']$/g, "");
  }
  return out;
}

function parseInlineList(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter((item) => item !== "");
}

/** 从 front matter 行里取表格的三个键 */
function readTableKeys(lines: readonly string[]): {
  columns: TableColumn[];
  rowIdColumn: string;
  views: TableViews;
  others: string[];
  notices: TableNotice[];
} {
  const notices: TableNotice[] = [];
  const columns: TableColumn[] = [];
  let rowIdColumn = ROW_ID_COLUMN;
  const views: TableViews = { default: "table" };
  const others: string[] = [];

  for (const segment of segmentize(lines)) {
    if (segment.key === "type") continue; // 由调用方校验
    if (segment.key === "columns") {
      for (const raw of segment.lines.slice(1)) {
        const matched = /^\s*-\s*(.+)$/.exec(raw);
        if (!matched?.[1]) continue;
        const map = parseInlineMap(matched[1]);
        if (!map?.id || !map.name) continue;
        const type = (map.type ?? "text") as TableColumnType;
        if (!TABLE_COLUMN_TYPES.includes(type)) {
          notices.push({ kind: "unknown_column_type", detail: `列 ${map.id} 的类型 ${map.type} 不认识，按 text 处理` });
        }
        const column: TableColumn = {
          id: map.id,
          name: map.name,
          type: TABLE_COLUMN_TYPES.includes(type) ? type : "text",
        };
        if (map.options !== undefined) column.options = parseInlineList(map.options);
        if (map.hidden === "true") column.hidden = true;
        columns.push(column);
      }
      continue;
    }
    if (segment.key === "row_id_column") {
      const value = segment.lines[0]?.slice(segment.lines[0].indexOf(":") + 1).trim();
      if (value) rowIdColumn = value;
      continue;
    }
    if (segment.key === "views") {
      for (const raw of segment.lines.slice(1)) {
        const matched = /^\s*(default|gallery)\s*:\s*(.+)$/.exec(raw);
        if (!matched) continue;
        const key = matched[1] ?? "";
        const value = (matched[2] ?? "").trim();
        if (key === "default" && (value === "table" || value === "gallery")) {
          views.default = value as TableViewKind;
        }
        if (key === "gallery") {
          const map = parseInlineMap(value);
          views.gallery = { image_column: map?.image_column ?? null };
        }
      }
      continue;
    }
    others.push(...segment.lines);
  }

  return { columns, rowIdColumn, views, others, notices };
}

function renderTableKeys(doc: TableDoc): string[] {
  const lines: string[] = ["  type: table", "  columns:"];
  for (const column of doc.columns) {
    const parts = [`id: ${column.id}`, `name: ${column.name}`, `type: ${column.type}`];
    if (column.options && column.options.length > 0) parts.push(`options: [${column.options.join(", ")}]`);
    if (column.hidden) parts.push("hidden: true");
    lines.push(`    - { ${parts.join(", ")} }`);
  }
  lines.push(`  row_id_column: ${doc.rowIdColumn}`);
  lines.push("  views:");
  lines.push(`    default: ${doc.views.default}`);
  if (doc.views.gallery) {
    lines.push(
      `    gallery: { image_column: ${doc.views.gallery.image_column ?? "null"} }`,
    );
  }
  return lines;
}

// ——————————————————————————— 解析 / 渲染 ———————————————————————————

const ATTACHMENT_HEADING = "## 附件";

/**
 * 解析表格文档。
 *
 * 返回 `ok: false` 的三种情形（都交给上层降级为普通笔记，**不在这里改数据**）：
 * 1. front matter 里没有 `menote.type: table`（可能是被别的东西改了）；
 * 2. 结构里没有合法的 GFM 管道表格（表头 + 分隔行）；
 * 3. 列定义与表头对不上（列数为 0，或表头比列定义多）。
 */
export function parseTableDocument(markdown: string): ParseTableResult {
  const parsed = parseMenoteMeta(markdown);
  const keys = readTableKeys(parsed.meta.preservedLines);
  if (parsed.meta.type !== "table") {
    return { ok: false, reason: "front matter 里不是 table 类型" };
  }
  if (keys.columns.length === 0) {
    return { ok: false, reason: "没有列定义（columns 为空）" };
  }

  const { tableLines, attachmentLines } = splitBody(parsed.body);
  const table = readPipeTable(tableLines, keys.columns, keys.rowIdColumn, keys.notices);
  if (!table) return { ok: false, reason: "没有合法的管道表格" };

  return {
    ok: true,
    doc: {
      columns: keys.columns,
      rowIdColumn: keys.rowIdColumn,
      views: keys.views,
      rows: table.rows,
      attachments: attachmentLines,
      notices: [...keys.notices, ...table.notices],
      preservedLines: keys.others,
      tags: [...parsed.meta.tags],
      title: parsed.meta.title,
      foreignLines: [...parsed.meta.foreignLines],
    },
  };
}

/** 把正文切成"表格区"与"`## 附件` 区" */
function splitBody(body: string): { tableLines: string[]; attachmentLines: TableAttachmentLine[] } {
  const lines = body.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === ATTACHMENT_HEADING);
  if (headingIndex === -1) return { tableLines: lines, attachmentLines: [] };

  const attachmentLines: TableAttachmentLine[] = [];
  for (const raw of lines.slice(headingIndex + 1)) {
    const matched = /^\s*[-*]\s+(.+)$/.exec(raw);
    if (!matched?.[1]) continue;
    const text = matched[1].trim();
    const name = text.replace(/\s*[（(].*$/, "").trim();
    attachmentLines.push({ name, raw: text });
  }
  return { tableLines: lines.slice(0, headingIndex), attachmentLines };
}

/** 把表头单元格解析成列 id：先按 id 认，认不出再按列名认（宽容读入），都不认就保留原文 */
function resolveColumnId(
  cell: string,
  columns: readonly TableColumn[],
  rowIdColumn: string,
): string {
  const trimmed = cell.trim();
  if (trimmed === rowIdColumn || trimmed.toLowerCase() === ROW_ID_COLUMN) return rowIdColumn;
  const byId = columns.find((column) => column.id === trimmed);
  if (byId) return byId.id;
  const byName = columns.find((column) => column.name === trimmed);
  if (byName) return byName.id;
  return trimmed;
}

function readPipeTable(
  lines: readonly string[],
  columns: readonly TableColumn[],
  rowIdColumn: string,
  notices: TableNotice[],
): { rows: Array<Record<string, string>>; notices: TableNotice[] } | null {
  const start = lines.findIndex((line) => line.trim().startsWith("|"));
  if (start === -1) return null;

  const headerCells = splitRow(lines[start] ?? "");
  const separator = lines[start + 1];
  if (!separator || !/^\s*\|?[\s:|-]+\|?\s*$/.test(separator) || !separator.includes("-")) {
    return null;
  }

  // 表头比数据列还少：结构对不上，交给上层降级（`_id` 那一列可能不写在列定义里，所以只跟数据列比）
  const dataColumns = columns.filter(
    (column) => column.id !== rowIdColumn && column.id !== ROW_ID_COLUMN,
  );
  if (headerCells.length < dataColumns.length) {
    return null;
  }

  const out: TableNotice[] = [...notices];
  const headerKeys = headerCells.map((cell) => resolveColumnId(cell, columns, rowIdColumn));
  // 列数对不上时给提示。`columns` 里可能**没有** `_id`（设计 §2.1 的 YAML 示例就只列数据列），
  // 所以允许表头比列定义多一列（那一列正是 `_id`）
  const expectedLeast = columns.some((column) => column.id === rowIdColumn || column.id === ROW_ID_COLUMN)
    ? columns.length
    : columns.length + 1;
  if (headerCells.length > expectedLeast) {
    out.push({
      kind: "column_mismatch",
      detail: `表头有 ${headerCells.length} 列，列定义有 ${columns.length} 列（多出的列按原样保留）`,
    });
  }
  if (columns.length > COLUMN_NOTICE_COUNT) {
    out.push({ kind: "too_many_columns", detail: `列数 ${columns.length} 超过 ${COLUMN_NOTICE_COUNT}，建议拆表` });
  }

  const rows: Array<Record<string, string>> = [];
  for (let index = start + 2; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim().startsWith("|")) {
      if (line.trim() === "") continue;
      break; // 表格后面还有别的内容：表格就此结束
    }
    const cells = splitRow(line);
    const row: Record<string, string> = {};
    headerKeys.forEach((key, columnIndex) => {
      const value = unescapeCell(cells[columnIndex] ?? "");
      row[key] = value;
      if (value.length > CELL_NOTICE_CHARS) {
        out.push({
          kind: "cell_too_long",
          detail: `单元格「${key}」有 ${value.length} 字符，超过 ${CELL_NOTICE_CHARS}，建议缩短`,
        });
      }
    });
    rows.push(row);
  }

  return { rows, notices: out };
}

/** 渲染表格文档（写规范：列定义、表头、行、附件章节都按固定形状产出） */
export function renderTableDocument(doc: TableDoc): string {
  // 表头恒用**列 id**（首列是行 ID 列）：改名不动数据，读回来时按 id 对上。
  // 两种形状都要认：`_id` 在 `columns` 里（界面稿的口径：它是隐藏且受保护的列）时不重复写，
  // 不在时补在首位——否则会渲染出两列 `_id`，读回来每行多一个同名字段。
  const columnIds = doc.columns.map((column) => column.id);
  const hasRowIdColumn = columnIds.some((id) => id === doc.rowIdColumn || id === ROW_ID_COLUMN);
  const header = hasRowIdColumn ? columnIds : [doc.rowIdColumn, ...columnIds];
  const bodyLines: string[] = [
    renderRow(header),
    `| ${header.map(() => "---").join(" | ")} |`,
  ];
  for (const row of doc.rows) {
    bodyLines.push(renderRow(header.map((key) => row[key] ?? "")));
  }

  let body = bodyLines.join("\n");
  if (doc.attachments.length > 0) {
    body += `\n\n${ATTACHMENT_HEADING}\n${doc.attachments.map((item) => `- ${item.raw}`).join("\n")}`;
  }

  // `columns` / `row_id_column` / `views` 走 preservedLines；`type` 由 buildDocument 统一写
  const meta: MenoteMeta = {
    type: "table",
    tags: doc.tags,
    task: null,
    preservedLines: [...renderTableKeys(doc).slice(1), ...doc.preservedLines],
    foreignLines: [...doc.foreignLines],
  };
  if (doc.title !== undefined) meta.title = doc.title;
  return buildDocument(meta, body);
}

export { MENOTE_KEY };
