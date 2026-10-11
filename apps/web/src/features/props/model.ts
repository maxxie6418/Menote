/**
 * 属性库的纯函数（2026-10-11，《MeNote 属性库设计 v1》v2.1）。
 *
 * ## 它是什么
 *
 * 属性库 = 一份**账号级**、全站唯一的属性定义表：每个条目是一个键（+ 可选类型与候选取值）。
 * 本模块只管**库的结构运算**（增 / 改 / 删 / 登记取值 / 规范化），不认识 React、不碰存储——
 * 存储是 `user_settings.prop_library`（`packages/shared/src/settings.ts`），读写由
 * `features/settings/useUserSettings` 一处收口。
 *
 * ## 四条它必须守住的边界（设计 §3.4）
 *
 * 1. **不参与 md 解析**：`mdcore` 不读库；库里没有的值照样写得进去，原格式原样往返；
 * 2. **不做键名中文化**：`url` 就叫 `url`，不贴「来源链接」这种猜出来的显示名；
 * 3. **不自动收录**：渲染卡片不往库里塞东西，只有用户主动动过（新建键 / 改过值 / 导入时点了录入）
 *    才记（设计 §6.4）；
 * 4. **不定义清单语义**：`status` / `due` / `priority` 的语义仍在清单功能里——本模块只把
 *    它们当**内置键**拦住（不让进库、不让当外来属性新增），值域不动（设计 §5 走路 A）。
 *
 * ## 为什么内置键不落库
 *
 * `title` / `tags` / `status` / `due` / `priority` 的定义由 {@link BUILTIN_PROP_ENTRIES}
 * **现成给出**，库里只存用户自建的条目。否则老账号（`prop_library: []`）打开管理页会缺五行，
 * 管理页得同时处理"库里有 / 没有内置键"两种状态——现成给出则只有一种。
 */
import {
  readForeignKeys,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
} from "@menote/mdcore";
import type { PropLibraryEntry, PropType } from "@menote/shared";

/**
 * 这一层的类型出口：调用方只从 `features/props/model` 取，不必各自去 import `@menote/shared`
 * （同步下来的一份 `PropLibraryEntry` 形状只该有一个来源）。
 */
export type { PropLibraryEntry, PropType };

/** 一个键最多留多少个候选取值（超出丢最旧的）。用户可见的行为，改了要写进设计稿 */
export const VALUE_CANDIDATE_LIMIT = 20;

/** 类型的显示名（管理页的类型选择、卡片菜单与录入步共用一份，避免三处各写一遍） */
export const PROP_TYPE_LABELS: Readonly<Record<PropType, string>> = {
  text: "单行文本",
  multiline: "多行 / 列表",
  date: "日期",
  number: "数字",
  boolean: "是 / 否",
  choice: "定值（枚举）",
};

/**
 * 五个内置键：它们有专用控件（标题输入框、标签 chip、清单三行），不是「其他属性」。
 *
 * `menote` 也拦（它是私有块，不是属性），但它**不在**这份清单里——管理页列的是"属性"，
 * `menote` 不是一个属性。拦住新增与入库的完整集合见 {@link RESERVED_PROP_KEYS}。
 */
export const BUILTIN_PROP_ENTRIES: readonly PropLibraryEntry[] = [
  { key: "title", builtin: true, type: "text", values: [] },
  { key: "tags", builtin: true, type: "multiline", values: [] },
  { key: "status", builtin: true, type: "choice", values: [] },
  { key: "due", builtin: true, type: "date", values: [] },
  { key: "priority", builtin: true, type: "choice", values: [] },
];

/** 内置键（管理页标「内置」、库不接纳它们当自建条目） */
export const BUILTIN_PROP_KEYS: ReadonlySet<string> = new Set(
  BUILTIN_PROP_ENTRIES.map((entry) => entry.key),
);

/**
 * 不能再当外来属性新增 / 不能进库的键：内置五个 + `menote`。
 * 与 `ItemProps` 里那份判定的口径**必须一致**，所以只在这里定义一份。
 */
export const RESERVED_PROP_KEYS: ReadonlySet<string> = new Set([...BUILTIN_PROP_KEYS, "menote"]);

/** 键名可用字符。含冒号或空格的键写进去会让整块 YAML 坏掉（与 `mdcore` 的 `assertForeignKey` 同一口径） */
export const PROP_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * 内置键的候选值域（管理页「候选取值」列只读展示用，2026-10-11 重设计 §3.2）。
 *
 * 它是**功能语义的一部分**（清单三键的归一档在 `mdcore` 里），既不在属性库里存、也不在
 * 管理页改：扩展内置键的值域是设计稿 §8 的「路 B」，尚未做。展示出来只是为了让那一列
 * 有话说——读者能看到「这些值是功能给定的」，而不是一个空框。
 */
export function builtinValueOptions(key: string): readonly string[] {
  if (key === "status") return Object.keys(TASK_STATUS_LABELS);
  if (key === "priority") return Object.keys(TASK_PRIORITY_LABELS);
  return [];
}

const PROP_TYPES: readonly PropType[] = ["text", "multiline", "date", "number", "boolean", "choice"];

export function isPropType(value: unknown): value is PropType {
  return typeof value === "string" && (PROP_TYPES as readonly string[]).includes(value);
}

export function isBuiltinKey(key: string): boolean {
  return BUILTIN_PROP_KEYS.has(key);
}

/** 这个键能不能进库 / 能不能当外来属性新增（形状对、且不是保留键） */
export function isPropKey(key: string): boolean {
  return PROP_KEY_PATTERN.test(key) && !RESERVED_PROP_KEYS.has(key);
}

export function typeLabel(type: PropType): string {
  return PROP_TYPE_LABELS[type];
}

/**
 * 内置键的默认显示名（2026-10-11，《属性卡片与属性库-设计》v1 §4.2）。
 *
 * 没设 `prop_labels` 的键用它。**自建键没有默认值**——直接显示源名，
 * 这是"键名原样、不替用户猜一个中文名"那条底线的显示层版本。
 */
export const BUILTIN_PROP_LABELS: Readonly<Record<string, string>> = {
  title: "标题",
  tags: "标签",
  status: "状态",
  due: "截止",
  priority: "优先级",
};

/** 显示名表：键 → 界面叫法（存 `user_settings.prop_labels`，账号级、跟账号同步） */
export type PropLabels = Readonly<Record<string, string>>;

/**
 * 一个键在界面上叫什么（设计 §4.2）：
 *
 * 1. 设了显示名 → 用它；
 * 2. 内置键 → {@link BUILTIN_PROP_LABELS} 里的中文名；
 * 3. 其余 → **就是源名本身**。
 *
 * 只影响界面：md 正文与 front matter、预览、分享页、导出、备份、MCP 一律源名（设计 §4.3）。
 */
export function labelFor(labels: PropLabels | undefined, key: string): string {
  const custom = labels?.[key]?.trim();
  if (custom) return custom;
  return BUILTIN_PROP_LABELS[key] ?? key;
}

/**
 * 设 / 清一个键的显示名，返回**新表**（不改传进来的那份）。
 *
 * 空串、以及"写成源名本身"都视为**清掉**——`url → url` 存进去只会让界面与默认值同形，
 * 存着它等于给 `prop_labels` 留一条永远读不出差别的行。
 */
export function withPropLabel(
  labels: PropLabels | undefined,
  key: string,
  value: string,
): Record<string, string> {
  const next: Record<string, string> = { ...(labels ?? {}) };
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === key) delete next[key];
  else next[key] = trimmed;
  return next;
}

/**
 * 把存下来的数组收成一条条可用的条目。
 *
 * - 重复键**后者覆盖内容、保留先出现的位置**（`Map` 的插入顺序就是首次出现顺序）；
 * - 内置键与非法键名直接剔掉（用户绕不过去，也不该在界面上看到它们）；
 * - 类型不认识回落 `text`；`values` 去空、去重、截到 {@link VALUE_CANDIDATE_LIMIT}。
 *
 * 读盘 / 同步下来的旧数据一律先过这一道，界面就只面对一种形状。
 */
export function normalizeLibrary(entries: readonly PropLibraryEntry[]): PropLibraryEntry[] {
  const byKey = new Map<string, PropLibraryEntry>();
  for (const raw of entries) {
    const key = raw.key;
    if (!isPropKey(key)) continue;
    const type = isPropType(raw.type) ? raw.type : "text";
    const values: string[] = [];
    for (const value of raw.values ?? []) {
      if (typeof value !== "string" || value === "" || values.includes(value)) continue;
      if (values.length >= VALUE_CANDIDATE_LIMIT) break;
      values.push(value);
    }
    byKey.set(key, { key, builtin: false, type, values });
  }
  return [...byKey.values()];
}

export function entryFor(
  library: readonly PropLibraryEntry[],
  key: string,
): PropLibraryEntry | undefined {
  return library.find((entry) => entry.key === key);
}

/** 已经在库里的键（大小写敏感——`url` 与 `URL` 是两个键，与 YAML 一致） */
export function knownKeySet(library: readonly PropLibraryEntry[]): ReadonlySet<string> {
  return new Set(library.map((entry) => entry.key));
}

function moveToFront(
  library: readonly PropLibraryEntry[],
  entry: PropLibraryEntry,
): PropLibraryEntry[] {
  return [entry, ...library.filter((one) => one.key !== entry.key)];
}

/**
 * 新建一个条目（键已存在时**只把它提到最前**，类型与取值都不动——已存在的定义说了算）。
 *
 * 键名不合法（含保留键）时原样返回：调用方负责报错，纯函数不抛——它还要在渲染期被调用。
 */
export function addEntry(
  library: readonly PropLibraryEntry[],
  key: string,
  type: PropType = "text",
): PropLibraryEntry[] {
  if (!isPropKey(key)) return [...library];
  const existing = entryFor(library, key);
  if (existing) return moveToFront(library, existing);
  return [{ key, builtin: false, type, values: [] }, ...library];
}

export function removeEntry(
  library: readonly PropLibraryEntry[],
  key: string,
): PropLibraryEntry[] {
  return library.filter((entry) => entry.key !== key);
}

export function updateEntry(
  library: readonly PropLibraryEntry[],
  key: string,
  patch: Partial<Pick<PropLibraryEntry, "type" | "values">>,
): PropLibraryEntry[] {
  const entry = entryFor(library, key);
  if (!entry) return [...library];
  const next: PropLibraryEntry = {
    ...entry,
    type: patch.type && isPropType(patch.type) ? patch.type : entry.type,
    values: patch.values ?? entry.values,
  };
  return library.map((one) => (one.key === key ? next : one));
}

/**
 * 改键名（**只影响库，不回写任何文档**：已经用了旧键的笔记里那一行 md 不动，只是变成"未入库"）。
 * 目标键已存在或形状不合法时原样返回。
 */
export function renameEntry(
  library: readonly PropLibraryEntry[],
  from: string,
  to: string,
): PropLibraryEntry[] {
  if (from === to) return [...library];
  if (!isPropKey(to) || entryFor(library, to)) return [...library];
  const entry = entryFor(library, from);
  if (!entry) return [...library];
  return library.map((one) => (one.key === from ? { ...one, key: to } : one));
}

/**
 * 登记一个"用户填过的值"（设计 §3.3 的「登记值」）。
 *
 * 键不在库里时**建条目**——这是"改过某个键的值"这条收录时机的落地（设计 §6.4）。
 * 类型按 `block ? multiline : text` 推：**只影响控件**，不参与解析，猜错也只是控件不顺手
 * （用户可以在管理页改），所以不做更花哨的类型推断。
 */
export function registerValue(
  library: readonly PropLibraryEntry[],
  key: string,
  value: string,
  block = false,
): PropLibraryEntry[] {
  if (!isPropKey(key)) return [...library];
  if (value === "") return [...library];
  const existing = entryFor(library, key);
  const values = [value, ...(existing?.values ?? []).filter((one) => one !== value)].slice(
    0,
    VALUE_CANDIDATE_LIMIT,
  );
  const next: PropLibraryEntry = existing
    ? { ...existing, values }
    : { key, builtin: false, type: block ? "multiline" : "text", values };
  return moveToFront(library, next);
}

/** 取某个键的候选取值（键不在库里就是空数组——不是错误） */
export function candidateValues(
  library: readonly PropLibraryEntry[],
  key: string,
): readonly string[] {
  return entryFor(library, key)?.values ?? [];
}

/**
 * 统计"哪些键被多少篇用到"（管理页的「被 N 篇用到」）。
 *
 * 纯函数：只读传进来的正文，**不改写任何东西**。内置键也一起统计（管理页要用它说明
 * "内置键不能被删，但它们确实在被用"）。
 */
export function collectUsedKeys(bodies: readonly string[]): Map<string, number> {
  const used = new Map<string, number>();
  for (const body of bodies) {
    const keys = new Set(readForeignKeys(body).map((one) => one.key));
    for (const key of keys) used.set(key, (used.get(key) ?? 0) + 1);
  }
  return used;
}
