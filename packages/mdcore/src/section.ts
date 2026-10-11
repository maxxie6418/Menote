/**
 * Markdown 小节切分（MCP `read_item(section)` / `replace_section` / `append_to_item(section)`
 * 的共同底座；纯函数，不依赖浏览器或 Worker）。
 *
 * ## 放在 mdcore 而不是 worker 本地
 *
 * 表格（`table.ts`）与 front matter（`frontmatter.ts`）都在这里，性质相同；而"按标题定位一段"
 * 这个能力前端将来做"跳到小节"也用得上。与其让服务端一份、客户端日后重写一份，不如现在同源。
 *
 * ## 口径（写错了会静默改错正文，所以逐条钉死）
 *
 * 1. **ATX 标题**（`#` ~ `######`）：井号后必须有空格或行尾，Setext（`===` / `---` 下划线式）
 *    **不认**——MCP 的入参是 agent 给的标题文本，规则越少越不会出意外。
 * 2. **匹配是精确的**：`## 结论` 不会被 `### 结论` 命中，反之亦然。去掉井号与首尾空白后比对。
 * 3. **范围 = 标题行行首 → 下一个同级或更高级标题的行首**（没有则到文末）。
 *    注意是"同级或更高级"：`### 子节` 属于 `## 父节`，所以父节的范围要含住全部子节。
 * 4. **同名多处取第一个**，并置 `ambiguous: true`——让 agent 知道它可能拿错了小节，
 *    而不是给它一段看起来很确定、其实是第二个同名小节的内容。
 * 5. **front matter 不算小节**：先剥掉再定位，偏移换算回原串，所以调用方拿到的是
 *    能在**原文**上直接 `slice` 的下标。
 */

import { frontmatterRange } from "./frontmatter";

export interface SectionRange {
  /** 在**原文**里的起始字符下标（含标题行本身） */
  start: number;
  /** 在**原文**里的结束字符下标（不含下一个同级 / 更高级标题那一行的行首） */
  end: number;
  /** 标题文本（不含井号） */
  heading: string;
  /** 该标题文本在正文里出现过不止一次 */
  ambiguous: boolean;
}

/** 剥掉 YAML front matter，返回剩余正文与它的起始偏移 */
function stripFrontmatter(markdown: string): { body: string; offset: number } {
  // 判据只此一份：`frontmatter.ts` 的 `frontmatterRange`（认 BOM、认前导空行、必须闭合）。
  // 以前这里另写了一份严格版，2026-10-11 因此漏认「开头多一个空行」的 front matter——
  // 表现是 MCP 的 `section` 偏移落在 front matter 里，比编辑器露 YAML 更难察觉。
  const range = frontmatterRange(markdown);
  if (!range) return { body: markdown, offset: 0 };
  return { body: markdown.slice(range.to), offset: range.to };
}

export interface HeadingHit {
  level: number;
  heading: string;
  /**
   * 起始下标。注意两种口径：
   * - `scanHeadings` 返回的是**正文**（剥掉 front matter 后）里的下标；
   * - `listHeadings` 返回的是**原文**里的下标（已换算），可以直接喂给编辑器定位。
   */
  start: number;
}

function scanHeadings(body: string): HeadingHit[] {
  const hits: HeadingHit[] = [];
  let lineStart = 0;
  for (const raw of body.split("\n")) {
    /*
      CRLF：按 `\n` 切开后每行尾部会留一个 `\r`，直接拿去匹配正则就认不出标题
      （`[ \t]*$` 不吃 `\r`）。所以**匹配用去掉 `\r` 的那份，算偏移仍用原行**——
      `\r` 那一格是正文的一部分，不能凭空少算。
    */
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    // 行首整行匹配才算是标题：正文里的 `#tag`、行内的 `a # b` 都不会命中
    const match = /^(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (match) {
      hits.push({
        level: match[1]!.length,
        heading: (match[2] ?? "").trim(),
        start: lineStart,
      });
    }
    lineStart += raw.length + 1; // +1 是换行本身
  }
  return hits;
}

/**
 * 列出文中的标题（大纲用）。默认只取一到三级——正文区右侧的大纲面板只要这些；
 * 要全部六级的调用方显式传 `maxLevel: 6`。
 *
 * 口径与 `findSectionRange` **完全同源**（同一个 `scanHeadings`）：先剥 front matter、
 * 只认 ATX、井号后必须有空格或行尾、Setext 不认。**不要在前端另写一份标题正则**——
 * 两份判据迟早会分叉（v0.8.31 的教训），而"大纲里的标题"和"能定位到的小节"不是同一批时，
 * 表现是"点了大纲跳到了别处"，极难察觉。
 *
 * 返回的 `start` 已换算回**原文**偏移，可直接用它做编辑器定位。
 */
export function listHeadings(markdown: string, maxLevel: number = 3): HeadingHit[] {
  const { body, offset } = stripFrontmatter(markdown);
  return scanHeadings(body)
    .filter((hit) => hit.level <= maxLevel)
    .map((hit) => ({ ...hit, start: hit.start + offset }));
}

/**
 * 定位一个标题的小节范围。找不到返回 `null`（**不抛错**——调用方要区分"没有这个小节"，
 * 而抛错会被路由层翻译成 500）。
 */
export function findSectionRange(markdown: string, heading: string): SectionRange | null {
  const wanted = heading.trim();
  if (wanted === "") return null;

  const { body, offset } = stripFrontmatter(markdown);
  const hits = scanHeadings(body);
  const target = hits.find((hit) => hit.heading === wanted);
  if (!target) return null;

  const ambiguous = hits.filter((hit) => hit.heading === wanted).length > 1;
  const next = hits.find((hit) => hit.start > target.start && hit.level <= target.level);
  const endInBody = next ? next.start : body.length;

  return {
    start: target.start + offset,
    end: endInBody + offset,
    heading: target.heading,
    ambiguous,
  };
}

/** 小节的纯文本（不含下一节；含自己的标题行） */
export function readSection(markdown: string, heading: string): string | null {
  const range = findSectionRange(markdown, heading);
  return range ? markdown.slice(range.start, range.end) : null;
}

/**
 * 替换一个小节（连标题行一起换成 `replacement`）。
 *
 * `replacement` 给的是**整节**（含自己的标题行），不是只有正文——这样 agent 换标题
 * 或换整节结构时不用先自己拆一遍，而"只改正文、保留标题"则是 `replacement` 里带上原标题。
 *
 * ## 为什么要把结尾的换行让出来
 *
 * `findSectionRange` 的 `end` 是**下一个标题的行首**，所以节与节之间的**空行属于前一节**。
 * 直接按 [start, end) 替换会把这些换行吃掉，于是 `## 甲\n\nnew` 紧贴下一节变成
 * `## 甲\n\nnew## 乙`——标题被粘在正文末尾，是静默的正文损坏。
 * 所以这里把 `end` 往前收过尾随换行，让分隔留在原地。
 */
export function replaceSection(markdown: string, heading: string, replacement: string): string | null {
  const range = findSectionRange(markdown, heading);
  if (!range) return null;

  let end = range.end;
  while (end > range.start && (markdown[end - 1] === "\n" || markdown[end - 1] === "\r")) {
    end -= 1;
  }
  return markdown.slice(0, range.start) + replacement + markdown.slice(end);
}
