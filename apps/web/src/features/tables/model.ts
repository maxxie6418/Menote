/**
 * 表格的业务模型（M4-9；《M4 设计》§二、《M4 界面稿》§二/§三）。
 *
 * 界面只做展示与交互，**列/行的增删改、筛选排序、大小与降级判定全在这里**（纯函数、可单测）。
 * 编解码与行 ID 规则复用 `@menote/mdcore` 的 `table.ts`——那份是前后端同一实现，
 * 这里只做"界面视角"的状态变换，不重复实现解析。
 *
 * 两条口径值得单独记住：
 * 1. **筛排与档位是纯界面状态**（设计 §2.4）：不写 YAML、关闭即重置，所以它们**不进 `TableDoc`**，
 *    而是作为独立入参传进来；
 * 2. **改列类型不改数据**（设计 §2.3"读宽容、写规范"）：值仍是字符串，只换类型标识，
 *    解析不了由界面显示原文 + 灰提示。
 */
import {
  BODY_HARD_LIMIT_BYTES,
  BODY_SOFT_LIMIT_BYTES,
} from "@menote/shared";
import {
  CELL_NOTICE_CHARS,
  COLUMN_NOTICE_COUNT,
  ROW_ID_COLUMN,
  buildDocument,
  ensureRowIds,
  parseMenoteMeta,
  parseTableDocument,
  renderTableDocument,
  type TableColumn,
  type TableColumnType,
  type TableDoc,
  type TableViewKind,
} from "@menote/mdcore";

/** 大小档位（与笔记同一套阈值：软上限 1MB 变色提示、硬上限 1,900,000 阻止保存） */
export type TableSizeLevel = "ok" | "soft" | "hard";

/**
 * 空白表格文档（v0.6.16）：新建表格时列定义面板的起点。
 *
 * **只有 `_id` 一列、零行**——数据列由用户在面板里加（`hasDataColumn` 没过时
 * 「创建表格」是禁用的并写明原因）。`_id` 是隐藏且受保护的列（`isProtectedColumn`），
 * 面板里只给一个显示开关，删不掉也改不了类型。
 */
export function emptyTableDoc(): TableDoc {
  return {
    columns: [{ id: ROW_ID_COLUMN, name: ROW_ID_COLUMN, type: "text", hidden: true }],
    rowIdColumn: ROW_ID_COLUMN,
    views: { default: "table" },
    rows: [],
    attachments: [],
    notices: [],
    preservedLines: [],
    tags: [],
    foreignLines: [],
  };
}

export interface TableSize {
  bytes: number;
  level: TableSizeLevel;
  /** 状态栏用的一行文字（`742 B / 1.9 MB`） */
  label: string;
}

/** 筛条件：列 + 操作符 + 值（全部纯本地） */
export type FilterOperator =
  | "contains"
  | "equals"
  | "empty"
  | "not_empty"
  | "gt"
  | "lt";

export interface TableFilter {
  columnId: string;
  operator: FilterOperator;
  value: string;
}

export interface TableSort {
  columnId: string;
  direction: "asc" | "desc";
}

/** 界面的表格状态：文档 + 纯界面状态（筛排、档位） */
export interface TableViewState {
  doc: TableDoc;
  filters: TableFilter[];
  /** `null` = 手动顺序（拖动排序落位后就是这个） */
  sort: TableSort | null;
  /** 当前档位；**不写 YAML**（界面稿 §2.5） */
  view: TableViewKind;
}

export const FILTER_OPERATOR_LABELS: Readonly<Record<FilterOperator, string>> = {
  contains: "包含",
  equals: "等于",
  empty: "为空",
  not_empty: "不为空",
  gt: "大于",
  lt: "小于",
};

/** 状态颜色名（`Chip` 的 tone）与状态列的默认候选项；列定义里给了 options 就优先用它 */
export const DEFAULT_STATUS_OPTIONS = ["todo", "doing", "done"] as const;

// ——————————————————————————— 列 ———————————————————————————

/** 新增列：id 由序号生成（`c1`/`c2`…，避开已用 id），并把它插在 `_id` 之后的第一位 */
export function addColumn(doc: TableDoc, name: string, type: TableColumnType): { doc: TableDoc; columnId: string } {
  const columnId = nextColumnId(doc.columns);
  const column: TableColumn = { id: columnId, name, type };
  return { doc: { ...doc, columns: [...doc.columns, column] }, columnId };
}

function nextColumnId(columns: readonly TableColumn[]): string {
  const used = new Set(columns.map((column) => column.id));
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `c${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `c${Date.now()}`;
}

/** 改列名：`_id` 列的名字也允许改（它只是显示名，结构由 `rowIdColumn` 记着） */
export function renameColumn(doc: TableDoc, columnId: string, name: string): TableDoc {
  return {
    ...doc,
    columns: doc.columns.map((column) =>
      column.id === columnId ? { ...column, name } : column,
    ),
  };
}

/**
 * 改列类型：**值一个都不动**（设计 §2.3）。
 *
 * 为什么不动：类型只是"怎么解释这一格"。把 `text` 改成 `number` 时把非数字清掉，
 * 就等于替用户删了数据——而"解析不了显示原文"本来就是允许的状态。
 */
export function changeColumnType(doc: TableDoc, columnId: string, type: TableColumnType): TableDoc {
  return {
    ...doc,
    columns: doc.columns.map((column) => (column.id === columnId ? { ...column, type } : column)),
  };
}

/** `_id` 列不可删、不可改类型（界面稿 §2.2：列头菜单里这三项禁用并写明原因） */
export function isProtectedColumn(doc: TableDoc, columnId: string): boolean {
  return columnId === doc.rowIdColumn || columnId === ROW_ID_COLUMN;
}

/** 删列：连带把每行里那一格删掉；`_id` 列删不动 */
export function removeColumn(doc: TableDoc, columnId: string): TableDoc {
  if (isProtectedColumn(doc, columnId)) return doc;
  return {
    ...doc,
    columns: doc.columns.filter((column) => column.id !== columnId),
    rows: doc.rows.map((row) => {
      const next = { ...row };
      delete next[columnId];
      return next;
    }),
    // 筛排引用被删的列会让界面显示"筛选后 0 行"这种莫名其妙的空——一并清掉
    notices: doc.notices.filter((notice) => !notice.detail.includes(columnId)),
  };
}

/** 左右移动列：**数据列之间**移动，`_id` 固定首位（界面稿 §2.2"首列 `_id`"） */
export function moveColumn(doc: TableDoc, columnId: string, offset: -1 | 1): TableDoc {
  const index = doc.columns.findIndex((column) => column.id === columnId);
  if (index === -1 || isProtectedColumn(doc, columnId)) return doc;
  const target = index + offset;
  if (target < 0 || target >= doc.columns.length) return doc;
  // 第 0 位是 `_id`：不许把数据列挪到它前面
  if (isProtectedColumn(doc, doc.columns[target]?.id ?? "")) return doc;

  const columns = [...doc.columns];
  const [moved] = columns.splice(index, 1);
  if (!moved) return doc;
  columns.splice(target, 0, moved);
  return { ...doc, columns };
}

/** 设置候选项（`select` / `multi_select` / `status` 用） */
export function setColumnOptions(doc: TableDoc, columnId: string, options: string[]): TableDoc {
  return {
    ...doc,
    columns: doc.columns.map((column) =>
      column.id === columnId ? { ...column, options } : column,
    ),
  };
}

/** 切换 `_id` 列的显示（默认隐藏，界面稿 §2.2） */
export function toggleColumnHidden(doc: TableDoc, columnId: string): TableDoc {
  return {
    ...doc,
    columns: doc.columns.map((column) =>
      column.id === columnId ? { ...column, hidden: !column.hidden } : column,
    ),
  };
}

// ——————————————————————————— 行 ———————————————————————————

/** 新增行：补一个合法行 ID（缺 ID 的场景统一走 `ensureRowIds`） */
export function addRow(doc: TableDoc, random: () => number = Math.random): { doc: TableDoc; rowId: string } {
  const { rows, notices } = ensureRowIds([...doc.rows, { [ROW_ID_COLUMN]: "" }], random);
  const added = rows[rows.length - 1];
  return {
    doc: { ...doc, rows, notices: [...doc.notices, ...notices] },
    rowId: added?.[ROW_ID_COLUMN] ?? "",
  };
}

/** 删行（按行 ID） */
export function removeRow(doc: TableDoc, rowId: string): TableDoc {
  return {
    ...doc,
    rows: doc.rows.filter((row) => !sameId(row[ROW_ID_COLUMN] ?? "", rowId)),
  };
}

/** 上移 / 下移一行（拖动排序的键盘等价入口，界面稿 §2.4） */
export function moveRow(doc: TableDoc, rowId: string, offset: -1 | 1): TableDoc {
  const index = doc.rows.findIndex((row) => sameId(row[ROW_ID_COLUMN] ?? "", rowId));
  if (index === -1) return doc;
  const target = index + offset;
  if (target < 0 || target >= doc.rows.length) return doc;

  const rows = [...doc.rows];
  const [moved] = rows.splice(index, 1);
  if (!moved) return doc;
  rows.splice(target, 0, moved);
  return { ...doc, rows };
}

/** 拖动落位：把 `rowId` 移到 `beforeRowId` 之前（`null` = 移到末尾） */
export function reorderRow(doc: TableDoc, rowId: string, beforeRowId: string | null): TableDoc {
  const rows = [...doc.rows];
  const from = rows.findIndex((row) => sameId(row[ROW_ID_COLUMN] ?? "", rowId));
  if (from === -1) return doc;
  const [moved] = rows.splice(from, 1);
  if (!moved) return doc;

  const to = beforeRowId === null
    ? rows.length
    : rows.findIndex((row) => sameId(row[ROW_ID_COLUMN] ?? "", beforeRowId));
  rows.splice(to === -1 ? rows.length : to, 0, moved);
  return { ...doc, rows };
}

/** 在指定行上方/下方插入一行 */
export function insertRow(
  doc: TableDoc,
  anchorRowId: string | null,
  position: "above" | "below",
  random: () => number = Math.random,
): { doc: TableDoc; rowId: string } {
  const { rows, notices } = ensureRowIds([...doc.rows, { [ROW_ID_COLUMN]: "" }], random);
  const added = rows.pop();
  const index = anchorRowId === null
    ? rows.length
    : rows.findIndex((row) => sameId(row[ROW_ID_COLUMN] ?? "", anchorRowId));
  const at = index === -1 ? rows.length : position === "above" ? index : index + 1;
  if (added) rows.splice(at, 0, added);

  return {
    doc: { ...doc, rows, notices: [...doc.notices, ...notices] },
    rowId: added?.[ROW_ID_COLUMN] ?? "",
  };
}

/**
 * 标签格的读写（M4-9 补；界面稿 §2.3 的「标签」类型）。
 *
 * **存储格式就是一个逗号分隔的字符串**（`tags` 类型的单元格值），所以"chip 编辑"只是
 * 显示与输入方式的变化，**不动数据格式**——这也是为什么它能在 M4 补而不牵扯迁移。
 *
 * 三条清洗规则：①去首尾空白；②**去重**（同一个标签写两次没有意义，chip 上会出现两个一样的）；
 * ③丢掉空串。
 */
export function splitTags(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(",")) {
    const tag = raw.trim();
    if (tag === "" || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** 标签数组 → 单元格值（与 `splitTags` 配对；`join(split(x))` 是幂等的） */
export function joinTags(tags: readonly string[]): string {
  return splitTags(tags.join(",")).join(",");
}

/**
 * 写一格。
 *
 * **值一律按字符串存**（编解码层只搬字符串），类型转换留给各类型的控件；
 * 换行写 `<br>`、`|` 转义由 `renderTableDocument` 负责。
 */
export function setCell(doc: TableDoc, rowId: string, columnId: string, value: string): TableDoc {
  return {
    ...doc,
    rows: doc.rows.map((row) =>
      sameId(row[ROW_ID_COLUMN] ?? "", rowId) ? { ...row, [columnId]: value } : row,
    ),
  };
}

/** 行 ID 大小写不敏感比较（mdcore 的口径；这里包一层免得各处各写） */
function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

// ——————————————————————————— 筛选与排序 ———————————————————————————

/** 取某行某列的显示值（`_id` 也能筛，且大小写不敏感地"包含"） */
export function cellValue(row: Record<string, string>, columnId: string): string {
  return row[columnId] ?? "";
}

function toNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 单条筛选是否命中（数字比较解析不了就当不命中，而不是拿字符串比大小） */
export function matchesFilter(row: Record<string, string>, filter: TableFilter): boolean {
  const value = cellValue(row, filter.columnId);
  const trimmed = value.trim();

  switch (filter.operator) {
    case "contains":
      return filter.value === "" || trimmed.toLowerCase().includes(filter.value.trim().toLowerCase());
    case "equals":
      return trimmed.toLowerCase() === filter.value.trim().toLowerCase();
    case "empty":
      return trimmed === "";
    case "not_empty":
      return trimmed !== "";
    case "gt": {
      const left = toNumber(trimmed);
      const right = toNumber(filter.value);
      return left !== null && right !== null && left > right;
    }
    case "lt": {
      const left = toNumber(trimmed);
      const right = toNumber(filter.value);
      return left !== null && right !== null && left < right;
    }
    default:
      return true;
  }
}

/** 多条件**取与**（设计没定义 or 组合，逐条加上去更符合"缩小范围"的直觉） */
export function filterRows(
  rows: ReadonlyArray<Record<string, string>>,
  filters: readonly TableFilter[],
): Array<Record<string, string>> {
  const active = filters.filter((filter) => filter.columnId !== "");
  if (active.length === 0) return [...rows];
  return rows.filter((row) => active.every((filter) => matchesFilter(row, filter)));
}

/**
 * 按列排序。
 *
 * 数字列按数值比（不然 `10 < 9`）；两边都能解析成数字才按数值，否则退回字符串比较
 * （`localeCompare` 用中文环境，`zh` 排序对中文列名/值更符合预期）。
 */
export function sortRows(
  rows: ReadonlyArray<Record<string, string>>,
  sort: TableSort | null,
): Array<Record<string, string>> {
  if (!sort) return [...rows];
  const out = [...rows];
  const factor = sort.direction === "asc" ? 1 : -1;

  out.sort((left, right) => {
    const a = cellValue(left, sort.columnId);
    const b = cellValue(right, sort.columnId);
    const numA = toNumber(a);
    const numB = toNumber(b);
    if (numA !== null && numB !== null) return (numA - numB) * factor;
    return a.localeCompare(b, "zh") * factor;
  });
  return out;
}

/** 界面用的可见行：先筛后排 */
export function visibleRows(state: Pick<TableViewState, "doc" | "filters" | "sort">): Array<Record<string, string>> {
  return sortRows(filterRows(state.doc.rows, state.filters), state.sort);
}

/** 面板里真正渲染的列（`_id` 按 hidden 决定；顺序即 `doc.columns` 顺序） */
export function visibleColumns(doc: TableDoc): TableColumn[] {
  return doc.columns.filter((column) => !(isProtectedColumn(doc, column.id) && column.hidden));
}

// ——————————————————————————— 大小与提示 ———————————————————————————

/** 序列化后的字节数（与保存进 `item_bodies` 的正文一致，所以大小提示才可信） */
export function tableBytes(doc: TableDoc): number {
  return new TextEncoder().encode(renderTableDocument(doc)).length;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < BODY_SOFT_LIMIT_BYTES) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(2)} MB`;
}

export function tableSize(doc: TableDoc): TableSize {
  const bytes = tableBytes(doc);
  const level: TableSizeLevel =
    bytes >= BODY_HARD_LIMIT_BYTES ? "hard" : bytes > BODY_SOFT_LIMIT_BYTES ? "soft" : "ok";
  return { bytes, level, label: `${formatBytes(bytes)} / 1.9 MB` };
}

/** 硬上限时**阻止保存**（返回 true 表示这次改动不该提交） */
export function blocksSave(size: TableSize): boolean {
  return size.level === "hard";
}

/** 会提示但不拒绝的两种情况（列数 >50、单元格 >2000 字符） */
export interface TableHint {
  kind: "too_many_columns" | "long_cell";
  message: string;
}

export function tableHints(doc: TableDoc): TableHint[] {
  const hints: TableHint[] = [];
  if (doc.columns.length > COLUMN_NOTICE_COUNT) {
    hints.push({ kind: "too_many_columns", message: `列数已超过 ${COLUMN_NOTICE_COUNT}，表格会更难读` });
  }

  const long = doc.rows.some((row) =>
    doc.columns.some((column) => cellValue(row, column.id).length > CELL_NOTICE_CHARS),
  );
  if (long) {
    hints.push({ kind: "long_cell", message: "单元格内容过长，建议写成笔记并在单元格中链接" });
  }
  return hints;
}

/**
 * 改类型后**有多少格按新类型解析不了**（界面稿 §3.2：给一处可见汇总，逐格灰提示负责定位）。
 *
 * 只判断"能确定判不了"的类型：`number` 要求能解析成数字。其余类型（文字、标签、状态……）
 * 什么字符串都能放，所以返回 0——**不要为了凑数字去猜**。
 */
export function unparsableCount(doc: TableDoc, columnId: string, type: TableColumnType): number {
  if (type !== "number") return 0;
  return doc.rows.filter((row) => {
    const value = cellValue(row, columnId).trim();
    return value !== "" && toNumber(value) === null;
  }).length;
}

/** 改类型 + 解析失败计数（列定义面板要用它给可见汇总） */
export function changeColumnTypeWithReport(
  doc: TableDoc,
  columnId: string,
  type: TableColumnType,
): { doc: TableDoc; unparsable: number } {
  return { doc: changeColumnType(doc, columnId, type), unparsable: unparsableCount(doc, columnId, type) };
}

/** 列名重复（允许重名，但要在面板里提示"已有同名列，建议区分"） */
export function duplicateColumnNames(doc: TableDoc): string[] {
  const seen = new Map<string, number>();
  for (const column of doc.columns) {
    const key = column.name.trim();
    if (key === "") continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}

/** 至少一列数据列（界面稿 §3.2：不允许 0 列——面板据此禁用「确定」并说明原因） */
export function hasDataColumn(doc: TableDoc): boolean {
  return doc.columns.some((column) => !isProtectedColumn(doc, column.id));
}

/** 图册可用性：没有图片列时按钮置灰 + 说明 + 出口（界面稿 §2.5） */export function galleryAvailability(doc: TableDoc): { available: boolean; imageColumnId: string | null } {
  const imageColumn = doc.columns.find((column) => column.type === "image");
  return { available: imageColumn !== undefined, imageColumnId: imageColumn?.id ?? null };
}

/** 图册卡片：标题取第一列文字列，属性胶囊最多两个（界面稿 §2.6） */
export function galleryCards(doc: TableDoc): Array<{
  rowId: string;
  title: string;
  image: string;
  chips: Array<{ label: string; value: string }>;
}> {
  // 标题取"第一个文字数据列"——**要排掉 `_id`**：它也是 text 类型且默认隐藏，
  // 拿它当标题会让每张卡片都显示一串随机行 ID
  const titleColumn = doc.columns.find(
    (column) => column.type === "text" && !isProtectedColumn(doc, column.id),
  );
  const imageColumn = doc.columns.find((column) => column.type === "image");
  const chipColumns = doc.columns.filter(
    (column) =>
      !isProtectedColumn(doc, column.id) &&
      column.id !== titleColumn?.id &&
      column.id !== imageColumn?.id,
  );

  return doc.rows.map((row) => ({
    rowId: cellValue(row, ROW_ID_COLUMN),
    title: titleColumn ? cellValue(row, titleColumn.id) : "",
    image: imageColumn ? cellValue(row, imageColumn.id) : "",
    chips: chipColumns.slice(0, 2).map((column) => ({
      label: column.name,
      value: cellValue(row, column.id),
    })),
  }));
}

// ——————————————————————————— 大表窗口 ———————————————————————————

/**
 * 虚拟滚动的窗口（M4-9；《M4 界面稿》§2.9「表体虚拟滚动、表头固定」）。
 *
 * **为什么自己算**：`<table>` 里做窗口比 div 列表难——用"上下各一个占位行"撑住滚动条高度，
 * 才能既保住表格语义（`<table>`/`<thead>`/`role=grid`）又只渲染可见的几十行。
 * 上下占位行的高度 = 未渲染行数 × 行高，所以 `rowHeight` 必须是**固定的**：行高按 4px 刻度，
 * 内容变化不改行高（这也是界面稿 §2.9 的要求）。
 *
 * 纯函数、不碰 DOM：真实滚动位置与视口高度由调用方量出来传进来，所以这段逻辑可以单测。
 */
export interface WindowRange {
  /** 第一条要渲染的行（含） */
  start: number;
  /** 最后一条要渲染的行（不含） */
  end: number;
  /** 上方占位行的高度（px） */
  topPad: number;
  /** 下方占位行的高度（px） */
  bottomPad: number;
}

export interface WindowInput {
  rowCount: number;
  rowHeight: number;
  /** 滚动容器当前滚动位置（px） */
  scrollTop: number;
  /** 视口高度（px）；量不出来（如 jsdom）时传 0，表示"不窗口化" */
  viewportHeight: number;
  /** 上下各多渲染几条，滚动时不至于露白 */
  overscan?: number;
}

/** 超过这个行数才窗口化：小表全渲染更简单，也少一层 DOM 结构 */
export const VIRTUAL_ROW_THRESHOLD = 100;

export const DEFAULT_ROW_HEIGHT = 36;

export function windowRange({
  rowCount,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscan = 8,
}: WindowInput): WindowRange {
  const all: WindowRange = { start: 0, end: rowCount, topPad: 0, bottomPad: 0 };
  // 小表、量不出视口、或行高不合法 → 不窗口化（宁可多渲染，也不要露白或算错）
  if (rowCount <= VIRTUAL_ROW_THRESHOLD || viewportHeight <= 0 || rowHeight <= 0) return all;

  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visible = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(rowCount, first + visible);
  return {
    start: first,
    end,
    topPad: first * rowHeight,
    bottomPad: (rowCount - end) * rowHeight,
  };
}

// ——————————————————————————— 降级 ———————————————————————————

export type DegradeReason = "not_table" | "broken_structure";

export interface DegradeCheck {
  degrade: boolean;
  reason: DegradeReason | null;
  /** 降级后的正文：**去掉表格元数据、正文一字不改**（设计 §2.5：不静默改数据） */
  markdown: string;
}

/**
 * 打开时判断要不要降级为普通笔记。
 *
 * **降级只动 front matter**：把 `type: table` 改成 `note` 并去掉表格专有键，
 * 管道表格本身原样留在正文里（用户可以自己复制走）。这也解释了为什么"不提供反向转回"是可接受的。
 */
export function checkDegrade(markdown: string): DegradeCheck {
  const parsed = parseTableDocument(markdown);
  if (parsed.ok) return { degrade: false, reason: null, markdown };

  const reason: DegradeReason = parsed.reason.includes("table 类型") ? "not_table" : "broken_structure";
  return { degrade: true, reason, markdown: stripTableMeta(markdown) };
}

/**
 * 去掉 `menote` 里的表格专有键，并把类型改成 `note`（正文原样保留）。
 *
 * 实现走 mdcore 的解析器而不是自己切字符串：`preservedLines` 是"按段保留"的原始行，
 * 只要把**表格管的三个键**所在的段摘掉，其余未知键（用户自定义、将来新增）一字不动——
 * 手写字符串裁剪很容易把 `columns:` 的子行漏在外面，留下半截 YAML。
 */
export function stripTableMeta(markdown: string): string {
  const parsed = parseMenoteMeta(markdown);
  const kept: string[] = [];
  let skipping = false;

  for (const line of parsed.meta.preservedLines) {
    const key = /^\s*([A-Za-z0-9_-]+)\s*:/.exec(line);
    const indent = line.length - line.trimStart().length;
    if (indent <= 2 && key) {
      // 顶层键：`columns` / `views` 是块，连同其缩进的子行一起跳过；其余原样保留
      skipping = key[1] === "columns" || key[1] === "views" || key[1] === "row_id_column" || key[1] === "type";
      if (!skipping) kept.push(line);
      continue;
    }
    if (!skipping) kept.push(line);
  }

  return buildDocument(
    { ...parsed.meta, type: "note", preservedLines: kept },
    parsed.body,
  );
}
