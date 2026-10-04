/**
 * `@menote/mdcore` —— Markdown 核心（架构 §2.3：`packages/*` 只放纯函数与共享类型）。
 *
 * 职责：条目 md 的 **front matter 读写**、**标签派生**、**任务字段派生**、标题与首行的取值。
 * 前后端共用同一份实现（服务端写派生列、前端本地算显示），因此这里**不得**出现任何
 * 浏览器或 Worker 专有 API，也不依赖 `apps/*`。
 *
 * 字面量口径：任务状态写入 `todo / doing / done`、优先级写入 `high / medium / low`
 * （与既有 YAML 英文键约定一致），读取时兼容中文写法，详见 `tasks.ts`。
 */
export {
  FRONTMATTER_FENCE,
  MENOTE_KEY,
  buildDocument,
  deriveTitle,
  parseMenoteMeta,
  renderInlineArray,
  stripFrontmatter,
  updateMenoteKeys,
  type DerivedTitle,
  type MenoteMeta,
  type MenotePatch,
  type ParsedDocument,
  type TaskFields,
} from "./frontmatter";

export {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  deriveTaskFields,
  normalizeTaskFields,
  parseTaskDue,
  parseTaskPriority,
  parseTaskStatus,
  taskToYamlLines,
  type DerivedTask,
  type TaskPriority,
  type TaskStatus,
} from "./tasks";

export {
  deriveTags,
  extractInlineTags,
  mergeTags,
  normalizeTag,
} from "./tags";

export { firstHeading, splitFirstLineAsTitle } from "./markdown";

export {
  findSectionRange,
  readSection,
  replaceSection,
  type SectionRange,
} from "./section";

export {
  CELL_NOTICE_CHARS,
  COLUMN_NOTICE_COUNT,
  ROW_ID_COLUMN,
  TABLE_COLUMN_TYPES,
  TABLE_VIEWS,
  ensureRowIds,
  escapeCell,
  isRowId,
  makeRowId,
  normalizeAttachmentNames,
  parseTableDocument,
  renderRow,
  renderTableDocument,
  sameRowId,
  splitRow,
  unescapeCell,
  type EnsureRowIdsResult,
  type ParseTableResult,
  type TableAttachmentLine,
  type TableColumn,
  type TableColumnType,
  type TableDoc,
  type TableNotice,
  type TableNoticeKind,
  type TableViewKind,
  type TableViews,
} from "./table";
