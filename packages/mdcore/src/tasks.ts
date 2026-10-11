/**
 * 任务字段（功能拆解 M07-03；需求 §9.3）。
 *
 * 规范数据是**条目 md 里的 YAML**（`status` / `due` / `priority` 三个**顶层键**，2026-10-11
 * 从 `menote.task:` 平铺上来——设计《属性栏与清单字段平铺》§3），服务端的 `task_status` /
 * `task_due` / `task_priority` 只是冗余派生列（仅用于 MCP 筛选），所以字面量的定义放这里、由两端共用。
 *
 * **字面量口径（M2-1 定）**：写入用英文 `todo / doing / done` 与 `high / medium / low`——
 * 与既有 YAML 约定一致（`type: table`、`row_id_column` 等都是英文键值），md 可移植、MCP 好筛。
 * **读取容错**：同时接受中文（待办 / 进行中 / 已完成、高 / 中 / 低），因为 md 允许手工编辑。
 * 界面文案用 `TASK_STATUS_LABELS` / `TASK_PRIORITY_LABELS`，不要把中文写进数据。
 *
 * 日期为 ISO 形式 `YYYY-MM-DD`；状态、日期、优先级**都可以为空**（M07-03）。
 */
import { parseMenoteMeta, type TaskFields } from "./frontmatter";

export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["high", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** 界面文案（数据里只存英文；README/需求里的中文语义在这里落成标签） */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

/** 中文写法 → 规范字面量（读取容错用；写入永远用规范值） */
const STATUS_ALIASES: Record<string, TaskStatus> = {
  todo: "todo",
  doing: "doing",
  done: "done",
  待办: "todo",
  进行中: "doing",
  已完成: "done",
};

const PRIORITY_ALIASES: Record<string, TaskPriority> = {
  high: "high",
  medium: "medium",
  low: "low",
  高: "high",
  中: "medium",
  低: "low",
};

/** 去掉包裹引号与首尾空白（YAML 里 `status: "todo"` 也常见） */
function scalar(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^["']|["']$/g, "").trim();
}

export function parseTaskStatus(value: unknown): TaskStatus | null {
  return STATUS_ALIASES[scalar(value)] ?? null;
}

export function parseTaskPriority(value: unknown): TaskPriority | null {
  return PRIORITY_ALIASES[scalar(value)] ?? null;
}

/**
 * 解析日期：只接受 `YYYY-MM-DD`，并校验它是**真实存在的公历日期**
 * （`2026-02-30` 这种要判掉，否则派生列里会留下垃圾）。
 */
export function parseTaskDue(value: unknown): string | null {
  const text = scalar(value);
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!matched) return null;

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // 用 UTC 构造再回读，能挡掉 2 月 30 日、4 月 31 日这类
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return text;
}

/** 规范化后的任务字段（枚举已收窄，坏值归零） */
export interface NormalizedTaskFields {
  status: TaskStatus | null;
  due: string | null;
  priority: TaskPriority | null;
}

/** 规范化一组任务字段：无法识别的值一律归零（不抛错——md 允许手工编辑，坏值当没有） */
export function normalizeTaskFields(
  input: Partial<TaskFields> | undefined,
): NormalizedTaskFields {
  return {
    status: parseTaskStatus(input?.status),
    due: parseTaskDue(input?.due),
    priority: parseTaskPriority(input?.priority),
  };
}

export interface DerivedTask extends NormalizedTaskFields {
  /** 是否带清单标记（`is_task`） */
  isTask: boolean;
}

/**
 * 从条目 md 派生清单字段（服务端写派生列、前端本地算显示，**同一份实现**）。
 *
 * 判定"是否清单"的依据是 **YAML 里有没有清单键**（M07-04：去掉清单标记时连这些键一起删除，
 * 于是"有无该键"就是标记本身）。2026-10-11 起键位是**顶层** `status` / `due` / `priority`，
 * 旧写法 `menote.task:` 仍认（懒迁移）——`parseMenoteMeta` 已经把两种写法合成同一个 `meta.task`，
 * 所以这里只需看它是否为 `null`。键在但三个字段都为空也仍算清单条目。
 */
export function deriveTaskFields(markdown: string): DerivedTask {
  const { meta } = parseMenoteMeta(markdown);
  if (!meta.task) {
    return { isTask: false, status: null, due: null, priority: null };
  }
  const normalized = normalizeTaskFields(meta.task);
  return { isTask: true, ...normalized };
}

/**
 * **写侧**口径的「这是不是一个清单条目」：平铺之后**有值才有键**，三值全空写不出来。
 *
 * 与读侧（`deriveTaskFields` 看键在不在）刻意不同：读侧那种「键在但三个值都空」的条目
 * 只有旧写法 `menote.task:` 表示得出来，新写法里没有对应的形状。所以前端写 `is_task`
 * 派生列时要按这条判——否则 md 说"不是清单"、列说"是"，下次同步又把值弹回去。
 *
 * 判据与 `renderTaskLines` 逐行对齐（同样是真值判断，空串算没有）。
 */
export function hasTaskValues(fields: TaskFields | null | undefined): boolean {
  return Boolean(fields && (fields.status || fields.due || fields.priority));
}
