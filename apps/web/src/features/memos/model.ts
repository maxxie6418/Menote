/**
 * Memo 的时间轴逻辑（功能拆解 M06-03；需求 §8.4）。
 *
 * 三条要点：
 * 1. **按天分组**，天边界要按**设置时区**算（默认 `Asia/Shanghai`）——不能用本机时区，
 *    否则同一批 Memo 在不同设备上会分到不同的日子（用户会看到"每天都不一样"）。
 * 2. 置顶的 Memo 抽出来**独立成块**放在时间轴最上方（Q9），**不参与日期排序**——日期块
 *    严格按 `memo_at` 倒序，置顶不把它所在的整组拽到最前（见 `sortMemos` 的注释）。
 * 3. 顶部支持标签筛选与日期范围筛选（需求 §8.4），两者是纯函数、便于单测。
 *
 * 这里只用 `Intl.DateTimeFormat`，不引时区库：只需要"某个时刻落在哪个日历日"。
 */

import { buildDocument, splitFirstLineAsTitle } from "@menote/mdcore";
import { MEMO_SIDEBAR_MODULES } from "@menote/shared";

/** 设置项的默认时区（M2-7 设置页接入后从用户设置读） */
export const DEFAULT_TIME_ZONE = "Asia/Shanghai";

export interface MemoLike {
  id: string;
  memo_at: number | null;
  pinned: number;
  tags: string[];
  is_task: number;
}

/** 取某个时刻在指定时区下的日历日键（`YYYY-MM-DD`） */
export function dayKeyInZone(epochMs: number, timeZone: string = DEFAULT_TIME_ZONE): string {
  // en-CA 的短日期就是 ISO 形式，省掉手工拼装
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochMs));
}

/** 时间轴上的日期标题，如「9月26日 周六」 */
export function dayLabelInZone(epochMs: number, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(epochMs));
}

/**
 * 日期与星期**分开**取（原型 `tl__date` + `tl__wd` 是两行）。
 *
 * 为什么要拆：`dayLabelInZone` 把两者拼成一个字符串，界面上无法给它们不同的字号/颜色。
 */
export function dayPartsInZone(
  epochMs: number,
  timeZone: string = DEFAULT_TIME_ZONE,
): { date: string; weekday: string } {
  const instant = new Date(epochMs);
  return {
    date: new Intl.DateTimeFormat("zh-CN", { timeZone, month: "long", day: "numeric" }).format(
      instant,
    ),
    weekday: new Intl.DateTimeFormat("zh-CN", { timeZone, weekday: "short" }).format(instant),
  };
}

/** 时刻文案，如「14:05」 */
export function timeLabelInZone(epochMs: number, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(epochMs));
}

/**
 * 按 `memo_at` 倒序——**纯时间序，不掺置顶**。
 *
 * 置顶曾经在这里以「全局插队」实现（`pinned` 大的排前面）。因为 `groupMemosByDay` 的**天序
 * 来自数组的插入序**，插队的那条会把**它所在的那一整组连同日期标题**顶到时间轴最前面，
 * 于是日期不再单调（实测 5 条 Memo 排出 `09-03 → 10-26 → 10-25 → 08-15`），
 * 而且**置顶越多越乱**（两条置顶排成 `10-01 → 08-01 → 10-27`）。
 * 现在置顶是**分块维度**，由 `groupMemosByDay` 单独抽成一块，不再参与行内排序。
 */
export function sortMemos<T extends MemoLike>(memos: readonly T[]): T[] {
  return [...memos].sort((a, b) => (b.memo_at ?? 0) - (a.memo_at ?? 0));
}

export interface MemoDay<T extends MemoLike> {
  dayKey: string;
  dayLabel: string;
  memos: T[];
}

export interface MemoTimelineGroups<T extends MemoLike> {
  /** 置顶的 Memo（按 `memo_at` 倒序）。空数组 = 没有置顶，时间轴不渲染这一块。 */
  pinned: T[];
  /** 其余 Memo 的日期分组；天序严格倒序且单调 */
  days: Array<MemoDay<T>>;
}

/**
 * 时间轴分组：置顶块 + 按天严格倒序的日期块（Q9）。
 *
 * 三条纪律：
 * 1. **置顶独立成块，且不再出现在自己的日期分组里**——否则同一天会裂成两块、日期标题也会重复；
 * 2. 日期块的顺序**只由 `memo_at` 决定**。天序来自「已按时间倒序的数组的插入序」，
 *    所以入参一旦是倒序的，天序必然单调，不会被置顶之类的因素搅乱（这正是旧实现的病根）；
 * 3. `memo_at` 为空的条目两处都不进（时间轴按时刻组织，没时刻就没有位置）。
 */
export function groupMemosByDay<T extends MemoLike>(
  memos: readonly T[],
  timeZone: string = DEFAULT_TIME_ZONE,
): MemoTimelineGroups<T> {
  const dated = sortMemos(memos).filter((memo) => memo.memo_at !== null);
  return {
    pinned: dated.filter((memo) => memo.pinned === 1),
    days: bucketByDay(
      dated.filter((memo) => memo.pinned !== 1),
      timeZone,
    ),
  };
}

/** **已按时间倒序**的数组 → 天序单调倒序的分组（`Map` 保持插入序，别再往里塞别的排序依据） */
function bucketByDay<T extends MemoLike>(sorted: readonly T[], timeZone: string): Array<MemoDay<T>> {
  const days = new Map<string, MemoDay<T>>();

  for (const memo of sorted) {
    const at = memo.memo_at ?? 0;
    const dayKey = dayKeyInZone(at, timeZone);
    const existing = days.get(dayKey);
    if (existing) {
      existing.memos.push(memo);
      continue;
    }
    days.set(dayKey, { dayKey, dayLabel: dayLabelInZone(at, timeZone), memos: [memo] });
  }

  return [...days.values()];
}

export const MEMO_RANGES = [
  { value: "all", label: "全部" },
  { value: "today", label: "今天" },
  { value: "week", label: "近 7 天" },
  { value: "month", label: "近 30 天" },
] as const;

export type MemoRange = (typeof MEMO_RANGES)[number]["value"];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MemoFilter {
  tag: string | null;
  range: MemoRange;
}

export const EMPTY_FILTER: MemoFilter = { tag: null, range: "all" };

// ——————————————— 侧栏的派生值（B3 批；全部纯函数，便于单测） ———————————————

/**
 * 侧栏模块的**可见顺序**（用户自定义：只做隐藏与调位置）。
 *
 * 三条纪律（与契约注释一一对应，见 `MemoSidebarSettingsSchema`）：
 * 1. 显式 `order` 里**只认已知 id**，未知/已下线的直接忽略（不报错）；
 * 2. `order` 里没出现的模块，按 `MEMO_SIDEBAR_MODULES` 的默认顺序补在后面；
 * 3. `hidden` 里的去掉；`hidden` 里的未知 id 同样只是忽略。
 */
export function orderedSidebarModules(
  sidebar: { order?: readonly string[]; hidden?: readonly string[] } | undefined,
  all: readonly string[] = MEMO_SIDEBAR_MODULES,
): string[] {
  const hidden = new Set(sidebar?.hidden ?? []);
  const explicit = (sidebar?.order ?? []).filter((id) => all.includes(id));
  const rest = all.filter((id) => !explicit.includes(id));
  return [...explicit, ...rest].filter((id) => !hidden.has(id));
}

/** 概述（原型 `.stat3`）：总条数 / 本月新增 / 记录天数 */
export function summarizeMemos(
  memos: readonly MemoLike[],
  now: number,
  timeZone: string = DEFAULT_TIME_ZONE,
): { total: number; thisMonth: number; activeDays: number } {
  const month = dayKeyInZone(now, timeZone).slice(0, 7);
  const days = new Set<string>();
  let thisMonth = 0;
  let total = 0;

  for (const memo of memos) {
    if (memo.memo_at === null) continue;
    total += 1;
    const key = dayKeyInZone(memo.memo_at, timeZone);
    days.add(key);
    if (key.startsWith(month)) thisMonth += 1;
  }

  return { total, thisMonth, activeDays: days.size };
}

/** 随机漫步（原型 `.subact--solo`）：从**当前筛选后**的 Memo 里随机挑一条 */
export function pickRandomMemo<T>(memos: readonly T[], random: () => number = Math.random): T | null {
  if (memos.length === 0) return null;
  const index = Math.min(memos.length - 1, Math.max(0, Math.floor(random() * memos.length)));
  return memos[index] ?? null;
}

/** 热力图的一格（原型 `.hm` / `.hm--1..4`） */
export interface HeatCell {
  dayKey: string;
  count: number;
  /** 0 = 没有记录；1–4 对应原型的四档底色（阈值见下面的注释） */
  level: 0 | 1 | 2 | 3 | 4;
}

/** 热力图（原型 `.heat`）：近 12 周 × 7 天，**一列一周、一行一天** */
export interface Heatmap {
  /**
   * 84 格，索引 = `周 * 7 + 星期几（周一为 0）`。
   * 这个顺序是给 `grid-auto-flow: column` 用的——原型 `.heat` 正是这么铺的，改顺序会让图转 90°。
   */
  cells: HeatCell[];
  /** 这 12 周里的总条数（不是全部 Memo 的条数） */
  total: number;
  label: string;
}

/** 每天的条数 → 5 档（原型四档底色 + "没有"）：0 / 1 / 2–3 / 4–5 / 6+ */
function heatLevel(count: number): HeatCell["level"] {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

export function heatmap12w(
  memos: readonly MemoLike[],
  now: number,
  timeZone: string = DEFAULT_TIME_ZONE,
): Heatmap {
  const todayStart = startOfDayInZone(now, timeZone);
  /*
    周一为一周之首（原型的一列就是一周）。
    **必须用"日历日的日键"去问星期几**：`todayStart` 是时区下的 0 点，它的 UTC 表示往往落在前一天
    （北京 0 点 = UTC 前一天 16 点），直接 `getUTCDay()` 会整体错一天——本函数第一版就是这么错的。
  */
  const todayKey = dayKeyInZone(now, timeZone);
  const weekdayIndex = (new Date(`${todayKey}T00:00:00Z`).getUTCDay() + 6) % 7;
  const gridStart = todayStart - (weekdayIndex + 11 * 7) * DAY_MS;

  const counts = new Map<string, number>();
  for (const memo of memos) {
    if (memo.memo_at === null) continue;
    const key = dayKeyInZone(memo.memo_at, timeZone);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const cells: HeatCell[] = [];
  let total = 0;
  for (let index = 0; index < 12 * 7; index += 1) {
    // 加半天再取日键：gridStart 是本地 0 点，跨夏令时也不会掉到前一天
    const dayKey = dayKeyInZone(gridStart + index * DAY_MS + DAY_MS / 2, timeZone);
    const count = counts.get(dayKey) ?? 0;
    total += count;
    cells.push({ dayKey, count, level: heatLevel(count) });
  }

  return { cells, total, label: `近 12 周 · 共 ${total} 条` };
}

/** 那年今日（原型 `.otd`）：往年同月日里离今天最近的一天 */
export interface OnThisDay {
  /** 那一天（含年份）的日键 `YYYY-MM-DD` */
  dayKey: string;
  /** 定位用：那一天**最早**一条 Memo */
  itemId: string;
  /** 定位用：那一条的时刻 */
  at: number;
  count: number;
}

/** 把 `MM-DD` 换成一年的第几天（用平年，只为比较远近） */
function monthDayOrdinal(monthDay: string): number {
  const [month, day] = monthDay.split("-").map(Number);
  return Math.round((Date.UTC(2001, (month ?? 1) - 1, day ?? 1) - Date.UTC(2001, 0, 1)) / DAY_MS);
}

/**
 * 挑历史上「月-日」离今天最近的一天。三条口径照原型（`index.html` L2049-2051）：
 * 1. **排除今年**（"那年今日"看的是往年）；
 * 2. 前后等距时**取更早的那一天**；
 * 3. 同一个「月-日」有多个年份时，取**最近的那一年**。
 *
 * 没有任何往年记录时返回 `null`（侧栏那一块就不渲染，不给空壳）。
 */
export function onThisDay<T extends MemoLike>(
  memos: readonly T[],
  now: number,
  timeZone: string = DEFAULT_TIME_ZONE,
): OnThisDay | null {
  const todayKey = dayKeyInZone(now, timeZone);
  const todayYear = Number(todayKey.slice(0, 4));
  const todayOrdinal = monthDayOrdinal(todayKey.slice(5));

  const byDay = new Map<string, { count: number; earliest: number; itemId: string }>();
  for (const memo of memos) {
    if (memo.memo_at === null) continue;
    const key = dayKeyInZone(memo.memo_at, timeZone);
    if (Number(key.slice(0, 4)) === todayYear) continue;
    const existing = byDay.get(key);
    if (existing) {
      existing.count += 1;
      if (memo.memo_at < existing.earliest) {
        existing.earliest = memo.memo_at;
        existing.itemId = memo.id;
      }
      continue;
    }
    byDay.set(key, { count: 1, earliest: memo.memo_at, itemId: memo.id });
  }

  if (byDay.size === 0) return null;

  let best: OnThisDay | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestOrdinal = Number.POSITIVE_INFINITY;
  let bestYear = Number.NEGATIVE_INFINITY;

  for (const [dayKey, entry] of byDay) {
    const ordinal = monthDayOrdinal(dayKey.slice(5));
    const raw = Math.abs(ordinal - todayOrdinal);
    const distance = Math.min(raw, 365 - raw);
    const year = Number(dayKey.slice(0, 4));

    const better =
      distance < bestDistance ||
      // 等距取更早的那一天
      (distance === bestDistance && ordinal < bestOrdinal) ||
      // 同月日跨年：取最近的一年
      (distance === bestDistance && ordinal === bestOrdinal && year > bestYear);

    if (better) {
      best = { dayKey, at: entry.earliest, count: entry.count, itemId: entry.itemId };
      bestDistance = distance;
      bestOrdinal = ordinal;
      bestYear = year;
    }
  }

  return best;
}

/**
 * 正文首行摘要（时间轴的卡片脚 / 图册的说明 / 列表的副标题都用它）。
 *
 * 与 `data/db` 里那份"列表摘要"口径一致：剥掉标题号与前缀记号、去掉强调符号、压掉空行，
 * 取第一行有效的文字，超过 `limit` 截断加省略号。**剥 front matter 不在这里**（那是数据层的事）。
 */
export function memoPreview(content: string, limit = 60): string {
  for (const rawLine of content.split("\n")) {
    const line = rawLine
      .replace(/^#{1,6}\s*/, "")
      .replace(/^[-*+]\s+(\[[ xX]\]\s*)?/, "")
      .replace(/[`*_>]/g, "")
      .trim();
    if (line === "") continue;
    return line.length > limit ? `${[...line].slice(0, limit).join("")}…` : line;
  }
  return "";
}

/**
 * 标签 + 日期范围筛选。
 *
 * 日期范围的边界按**时区下的当天 0 点**起算：`today` = 与"现在"同一个日历日；
 * `week`/`month` 从当天 0 点往前推 6/29 天（"近 7 天"含今天）。
 */
export function filterMemos<T extends MemoLike>(
  memos: readonly T[],
  filter: MemoFilter,
  now: number,
  timeZone: string = DEFAULT_TIME_ZONE,
): T[] {
  const startOfToday = startOfDayInZone(now, timeZone);
  const lowerBound =
    filter.range === "all"
      ? Number.NEGATIVE_INFINITY
      : filter.range === "today"
        ? startOfToday
        : filter.range === "week"
          ? startOfToday - 6 * DAY_MS
          : startOfToday - 29 * DAY_MS;

  return memos.filter((memo) => {
    if (filter.tag !== null && !memo.tags.includes(filter.tag)) return false;
    if (memo.memo_at === null) return filter.range === "all";
    return memo.memo_at >= lowerBound;
  });
}

/** 某个时刻所在时区的当天 0 点（用"时区下的日期 + 时区偏移"反解，避免手工算偏移） */
export function startOfDayInZone(epochMs: number, timeZone: string = DEFAULT_TIME_ZONE): number {
  const dayKey = dayKeyInZone(epochMs, timeZone); // YYYY-MM-DD
  // 把该日期的 00:00 当作 UTC 解析，再按"该时刻在目标时区的时差"校正
  const asUtc = Date.parse(`${dayKey}T00:00:00Z`);
  const offsetMs = zonedOffsetMs(asUtc, timeZone);
  return asUtc - offsetMs;
}

/** 目标时刻在给定时区相对 UTC 的偏移（毫秒） */
function zonedOffsetMs(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(epochMs));

  const pick = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(
    pick("year"),
    pick("month") - 1,
    pick("day"),
    pick("hour") % 24,
    pick("minute"),
    pick("second"),
  );
  return asIfUtc - epochMs;
}

/** 时间轴顶部标签筛选的可选项（按出现次数倒序） */
export function collectMemoTags(memos: readonly MemoLike[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const memo of memos) {
    for (const tag of memo.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-Hans-CN"));
}

// ——————————————————————————— Memo 转笔记（Q10） ———————————————————————————

/** Q10：标题取正文第一行，**最多 50 字**（与录入框"笔记"模式一致） */
export const NOTE_TITLE_MAX = 50;

/**
 * 由 Memo 的正文构造新笔记的标题与正文（Q10）。
 *
 * - 标题取正文第一行（≤50 字，按**码点**截断，避免把汉字切半）；
 * - 正文 = 去掉首行之后的内容；
 * - **清单字段从 YAML 去掉**（笔记不带 `task`），标签原样带走（Q10：内容、标签原样带走）；
 * - 新笔记落根目录、直接打开由调用方负责。
 */
export function buildNoteFromMemo(
  content: string,
  tags: readonly string[],
): { title: string; body: string } {
  const { title, body } = splitFirstLineAsTitle(content);
  const chars = [...title];
  const trimmed = chars.length > NOTE_TITLE_MAX ? chars.slice(0, NOTE_TITLE_MAX).join("") : title;

  const noteBody =
    tags.length > 0
      ? buildDocument(
          {
            type: "note",
            tags: [...tags],
            task: null,
            convertedTo: null,
            preservedLines: [],
            foreignLines: [],
          },
          body,
        )
      : body;

  return { title: trimmed.trim() === "" ? "未命名笔记" : trimmed.trim(), body: noteBody };
}
