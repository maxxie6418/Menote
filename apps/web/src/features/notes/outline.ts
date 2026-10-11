/**
 * 右侧大纲面板的纯逻辑（2026-10-11，设计稿 `docs/modules/MeNote-属性卡与大纲悬浮-设计-v1.md` §4）。
 *
 * ## 判据只有一份
 *
 * 标题从哪来、什么算标题，**全在 `mdcore` 的 `listHeadings`**（它自己复用 `section.ts` 的
 * `scanHeadings`，与 MCP 的 `read_item(section)` 同源）。这里只做两件本地的事：
 * 给条目编序号、把"滚到哪了"换算成"现在在第几节"。
 *
 * **不要在这里另写一个标题正则**：v0.8.31 已经吃过一次"两份判据分叉"的亏，而这一处的表现
 * 更隐蔽——大纲里列出的标题和能定位到的标题不是同一批时，用户看到的是"点了大纲跳到了别处"。
 */
import { listHeadings } from "@menote/mdcore";

export interface OutlineItem {
  /** 在列表里的序号（0 起）：React key 与「当前节」的比较都用它 */
  index: number;
  level: number;
  heading: string;
  /** **原文**里的起始偏移（编辑档点击定位用） */
  start: number;
}

/** 一到三级标题，顺序即文中顺序 */
export function buildOutline(markdown: string): OutlineItem[] {
  return listHeadings(markdown, 3).map((hit, index) => ({
    index,
    level: hit.level,
    heading: hit.heading,
    start: hit.start,
  }));
}

/**
 * 编辑 / 即时渲染档的「当前节」：起始偏移不超过 `topOffset`（可见区上沿那一处）的最后一条。
 *
 * **一条都没滚过时把第一节当当前节**：文档刚打开（`topOffset` 还在第一个标题之前）时，
 * 大纲上一条高亮都没有会让人以为这个面板坏了或没生效；高亮第一节同时也不说谎——那正是
 * 用户现在看的地方。列表为空才返回 `null`。
 */
export function activeOutlineIndex(
  items: readonly OutlineItem[],
  topOffset: number,
): number | null {
  if (items.length === 0) return null;
  let active = items[0]!.index;
  for (const item of items) {
    if (item.start > topOffset) break;
    active = item.index;
  }
  return active;
}

/**
 * 把大纲条目对应到预览 DOM 里的那枚标题。
 *
 * **不能按序号取**：预览走完整的 markdown-it，Setext（`===` / `---` 下划线式）也会渲染成
 * `h1` / `h2`，而大纲只认 ATX——按序号取会让"点第二个标题跳到第三个"。这里按「级别 + 文字」
 * 找，同名多处的取第一枚，与 `scanHeadings` 的"同名取第一个"同口径。
 */
export function matchPreviewHeading(
  item: OutlineItem,
  nodes: readonly HTMLElement[],
): HTMLElement | null {
  for (const node of nodes) {
    if (node.tagName.toLowerCase() !== `h${item.level}`) continue;
    if ((node.textContent ?? "").trim() === item.heading) return node;
  }
  return null;
}

/** 预览档的「当前节」：逐个映射到 DOM，取最后一枚已经滚过可见区上沿的（一条都没过就取第一节） */
export function activeOutlineIndexInPreview(
  items: readonly OutlineItem[],
  container: HTMLElement,
): number | null {
  if (items.length === 0) return null;
  const nodes = [...container.querySelectorAll<HTMLElement>("h1, h2, h3")];
  // +8 是正文纸面的上内边距量级：让"刚好看不见标题行"也算进入这一节
  const line = container.getBoundingClientRect().top + 8;
  let active = items[0]!.index;
  for (const item of items) {
    const node = matchPreviewHeading(item, nodes);
    if (!node) continue;
    if (node.getBoundingClientRect().top <= line) active = item.index;
    else break;
  }
  return active;
}
