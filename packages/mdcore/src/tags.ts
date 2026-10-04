/**
 * 标签派生（需求 §7.1-3、功能拆解 M04-06）。
 *
 * 标签来自 md 本身：**YAML 顶层 `tags` 字段 + 正文里的 `#标签`**；服务端只保存派生出的列表
 * （`items.tags` 的 JSON 数组）。同一份实现给 Worker 与前端用，避免两边算出不同结果。
 *
 * **顶层 `tags` 是规范位置**（对齐定稿：设计文档 §528、功能拆解 §333 都写的是「YAML `tags` 字段」，
 * 从未要求嵌套）。旧的 `menote.tags` 仍**读**，但只在顶层没有 `tags:` 键时才作为回退——存量笔记
 * 因此照常有标签，且改一次即被 `updateMenoteKeys` 懒迁移到顶层，不需要迁移脚本。
 *
 * 正文标签的语法（本模块定义，界面提示与文档都以它为准）：
 * - `#` 必须位于**行首或空白/开括号之后**——否则网址里的 `https://x/#frag`、`a#b` 会被误判；
 * - `#` 后紧接标签正文，不得是空白（于是 Markdown 标题 `# 标题`、`## 二级` 都不会被当成标签）；
 * - 标签正文遇到空白或常见标点即结束（中英文标点都算），因此 `#工作。` 取到的是 `工作`；
 * - **代码块与行内代码里的 `#…` 不算标签**（写文档时举例不该污染标签）；
 * - 大小写不敏感去重，保留首次出现的写法。
 */
import { parseMenoteMeta } from "./frontmatter";

/** 行内标签：前置字符必须是行首 / 空白 / 开括号 */
const INLINE_TAG_PATTERN = /(?:^|[\s(（[【])#([^\s#.,;:!?'"`，。；：！？、“”‘’（）【】]+)/gu;

/** 去掉包裹的 `#` 与首尾空白；空串返回 null */
export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().replace(/^#+/, "").trim();
  return tag === "" ? null : tag;
}

/** 取出正文里的行内标签（已剔除代码块与行内代码） */
export function extractInlineTags(body: string): string[] {
  const withoutCode = body
    .replace(/```[\s\S]*?```/g, " ") // 围栏代码块
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\n]*`/g, " "); // 行内代码

  const found: string[] = [];
  for (const matched of withoutCode.matchAll(INLINE_TAG_PATTERN)) {
    const tag = normalizeTag(matched[1] ?? "");
    if (tag) found.push(tag);
  }
  return found;
}

/** 合并两组标签：YAML 在前（作者显式写的优先），大小写不敏感去重 */
export function mergeTags(primary: readonly string[], secondary: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...primary, ...secondary]) {
    const tag = normalizeTag(raw);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** 从条目 md 派生标签列表（= `items.tags` 的内容） */
export function deriveTags(markdown: string): string[] {
  const { meta, body } = parseMenoteMeta(markdown);
  return mergeTags(meta.tags, extractInlineTags(body));
}
