/**
 * 「空白种子」：新建了一篇、却还没写出任何可见内容的那条本机条目（用户 2026-10-11 口径）。
 *
 * 三条口径：
 * 1. **算内容的只有可见文字与标题**——正文剥掉 YAML 后还有非空白字符，或标题不再是新建占位。
 *    属性（标签 / 状态 / 截止 / 优先级 / 外来键）**不算内容**：只改属性、不写正文的条目
 *    按用户口径**不保存**。
 * 2. **判据只有这一份**（`isBlankSeed`）：新建时决定要不要延后上传、两个入队口子决定要不要
 *    发第一条 `create`、离开时决定要不要回收，三处都调它。散成三份早晚会漂（v0.8.31 的教训）。
 * 3. **只作用于"从没上传过"的条目**：调用方按 `pending === "create"` 判（见 `repository.ts`
 *    的 `holdBlankSeed`）。已存在的笔记清空到空白仍是正常编辑——那是用户的存量内容，
 *    不在本模块的管辖范围。
 *
 * 这样安排的结果：空白种子**服务端从头到尾没见过它**。不用"先建再删"是因为同步引擎推得
 * 比人点得快，那样服务端会先多出一篇空笔记、回收站里还得留个记录。
 */
import { stripFrontmatter } from "@menote/mdcore";
import { db } from "./database";
import { getCachedBody, getDraft } from "./bodies";
import { purgeLocalItems } from "./trash";
import type { LocalItem } from "./schema";

/** 新建笔记的默认标题（`items.title` 派生列的初值，**不写进 md**，设计 §9） */
export const DEFAULT_NOTE_TITLE = "未命名笔记";

/** 新建表格的默认标题（表格界面不收标题，先给一个能认出来的，之后在标题栏改） */
export const DEFAULT_TABLE_TITLE = "未命名表格";

/**
 * 启动兜底清扫的宽限期：**刚建的种子先留着**。
 *
 * 两个标签页同开时会话时，A 标签页刚建的一篇可能正在被写（草稿还没落盘），B 标签页启动
 * 一扫就把它删了。留一点时间就没有这个抢删窗口；反正用户离开它时（切换条目）还会收一次。
 */
const SEED_GRACE_MS = 30_000;

/** 与新建占位标题相同（或空）都算"没写标题" */
const PLACEHOLDER_TITLES: ReadonlySet<string> = new Set([
  DEFAULT_NOTE_TITLE,
  DEFAULT_TABLE_TITLE,
]);

/** 正文里还有可见字符吗（剥掉 front matter 后没有非空白字符 = 空） */
export function isBlankBody(body: string): boolean {
  return !/\S/.test(stripFrontmatter(body));
}

/** 标题还是新建时的占位（或空）吗 */
export function isPlaceholderTitle(title: string | null): boolean {
  const value = (title ?? "").trim();
  return value === "" || PLACEHOLDER_TITLES.has(value);
}

/** 判据本体：标题没写过、正文也没有可见字符 */
export function isBlankSeed(item: Pick<LocalItem, "title">, body: string): boolean {
  return isPlaceholderTitle(item.title) && isBlankBody(body);
}

/** 读这一条当前"算不算内容"的正文：**草稿优先**（刚敲的字还没进正文缓存） */
async function readBody(itemId: string): Promise<string> {
  const draft = await getDraft(itemId);
  if (draft) return draft.body;
  const cached = await getCachedBody(itemId);
  return cached?.body ?? "";
}

/** 这一条现在还是不是空白种子（条目 + 当前正文一起看） */
export async function isBlankSeedItem(item: LocalItem): Promise<boolean> {
  return isBlankSeed(item, await readBody(item.id));
}

/**
 * 回收一条"从没上传过、现在仍然全空"的条目：本体、正文、草稿、队列项、搜索索引、附件行
 * 一起清掉，像没建过一样（`purgeLocalItems` 与永久删除同一套口径）。
 *
 * **两处必须同时成立**：
 * - `pending !== "create"` 一律不动——那是已上传的正常笔记，清空它是用户的编辑行为；
 * - **队列里有行就一律不动**——入队的条目（备份恢复的 `create`、冲突副本那次 `create`）
 *   哪怕正文空白也是"真的"，回收它会丢东西。空白种子永远没有队列行，这条不误伤它。
 *
 * 条目不存在（已被回收）时返回 false。返回是否真的回收了。
 */
export async function purgeBlankSeed(itemId: string): Promise<boolean> {
  const item = await db.items.get(itemId);
  if (!item || item.pending !== "create") return false;
  const queued = await db.outbox.where("[entity+entity_id]").equals(["item", item.id]).count();
  if (queued > 0) return false;
  if (!(await isBlankSeedItem(item))) return false;
  await purgeLocalItems([item.id]);
  return true;
}

/**
 * 启动兜底：扫掉本机残留的空白种子（建完直接关标签页那种，服务端从没收到过它）。
 *
 * 返回清掉的条目 id。宽限期见 `SEED_GRACE_MS`。
 */
export async function purgeBlankSeeds(now: number = Date.now()): Promise<string[]> {
  const rows = await db.items.toArray();
  const seeds = rows.filter(
    (row) => row.pending === "create" && now - row.created_at >= SEED_GRACE_MS,
  );
  const purged: string[] = [];
  for (const row of seeds) {
    if (await purgeBlankSeed(row.id)) purged.push(row.id);
  }
  return purged;
}
