/**
 * Markdown 渲染与安全（架构 §3.4）。
 *
 * - `html: false`：markdown-it **不放行原始 HTML**；
 * - 渲染结果再过一遍 DOMPurify：双保险，且未来若放开白名单标签时仍有兜底；
 * - 外链统一加 `rel="noopener noreferrer"`（不给 `target`，避免把用户带出应用）。
 *
 * M4-10 追加：**附件引用**按界面稿 §7.3 / §7.4 处理——
 * - 图片加 `loading="lazy"`：一篇里几十张图时不该一次性全拉（缩略图也只是"能看"的级别）；
 * - 非图片附件走**链接样式**（`.link` + 文件名），并**补一个大小**（`SizeTag`），
 *   **不显示哈希**（哈希是内部标识，界面不该出现）；
 * - 引用在、但本地元数据里找不到这个附件 → 标 `--missing` 并给 `title="附件不可用"`，
 *   点了不下载（界面稿 §7.4 的"找不到附件"分支）。
 */
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});

const defaultLinkOpen = md.renderer.rules.link_open;
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token) {
    token.attrSet("rel", "noopener noreferrer");
    const href = String(token.attrGet("href") ?? "");
    const sha = attachmentShaFromHref(href);
    if (sha) {
      const known = attachmentsOf(env)[sha];
      token.attrSet("class", known ? "link attachment-link" : "attachment-link attachment-link--missing");
      token.attrSet("data-attachment", sha);
      if (known) token.attrSet("download", "");
      else token.attrSet("title", UNAVAILABLE_TITLE);
    }
  }
  if (defaultLinkOpen) return defaultLinkOpen(tokens, idx, options, env, self);
  return self.renderToken(tokens, idx, options);
};

const defaultImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token) {
    // 懒加载：图片多了不该一次性拉全（也避免离开这一篇后还在下载）
    token.attrSet("loading", "lazy");
    token.attrSet("decoding", "async");
    const src = String(token.attrGet("src") ?? "");
    const sha = attachmentShaFromHref(src);
    if (sha) token.attrSet("data-attachment", sha);
  }
  if (defaultImage) return defaultImage(tokens, idx, options, env, self);
  return self.renderToken(tokens, idx, options);
};

/*
 * 代码块的 `<pre>` 补 `class="hscroll"` 与 `tabindex="0"`（2026-10-04）。
 *
 * `hscroll` 的理由：正文代码块此前**唯独没挂**细滚动条类，于是同一屏里表格是细条、
 * 代码块是系统默认那根 15–17px 粗条（`app.css` 里 `.markdown-body pre.hscroll` 那组规则）。
 * ⚠️ **这行与 `app.css` 是一条契约**：类名由这里发出、样式在那里，两边必须一起改——
 * 只改 CSS 会让选择器永远匹配不上（症状是「改了没反应」，不报错）。
 *
 * `tabindex` 的理由：横条从「常显」改成「悬停/聚焦才显形」（`app.css` 的 `.hscroll`），
 * 而 `<pre>` 原本**不可聚焦**——键盘用户 Tab 进正文根本到不了代码块，`:focus-within`
 * 永不触发，那条提示对键盘就等于不存在（`DESIGN.md` §6.1「不以悬停为唯一入口」）。
 *
 * **为什么是改字符串而不是 `token.attrSet`**（踩过的坑）：两条规则的落点不一样——
 * `code_block` 把 token 属性写到 `<pre>` 上，而 `fence` 写到**内层 `<code>`** 上
 * （带语言时它还会另建一个临时 token）。所以对 `fence` 用 `attrSet` 的话，
 * 属性落在 `<code>`，真正能横向滚的 `<pre>` 拿不到。
 * 内容里的字面 `<pre>` 早就被 `escapeHtml` 转义成 `&lt;pre&gt;`，不会误伤。
 */
const PRE_ATTRS = '<pre class="hscroll" tabindex="0"';

for (const rule of ["fence", "code_block"] as const) {
  const fallback = md.renderer.rules[rule];
  md.renderer.rules[rule] = (tokens, idx, options, env, self) => {
    const html = fallback
      ? fallback(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
    /* 负向断言保证不重复注入；两条规则实际都不会给 `<pre>` 自带属性 */
    return html.replace(/<pre(?![^>]*\btabindex=)/, PRE_ATTRS);
  };
}

/** 附件地址里的 sha256（正文里就是 `/api/attachments/h/<sha>`） */
export function attachmentShaFromHref(href: string): string | null {
  const matched = /\/api\/attachments\/h\/([0-9a-f]{64})/i.exec(href);
  return matched?.[1]?.toLowerCase() ?? null;
}

export interface AttachmentRenderMeta {
  size: number;
  hasThumb: boolean;
}

export interface RenderMarkdownOptions {
  /** 本地已知的附件（`sha256 -> 元数据`）：用来标"不可用"与补大小 */
  attachments?: Record<string, AttachmentRenderMeta>;
  /**
   * 放行 `blob:` 图片（M5-S3 分享查看器专用）。
   *
   * DOMPurify 默认的 URI 白名单里**没有** `blob:`，所以分享页把附件取回后改写成的
   * object URL 会被净化掉、`src` 直接消失（本开关正是为此而加）。只给查看器开：
   * 那些 blob URL 全部由本会话用令牌现取的字节 `createObjectURL` 造出来，
   * 页面里没有别的 blob 源。
   */
  allowBlobUris?: boolean;
}

interface MarkdownEnv {
  attachments?: Record<string, AttachmentRenderMeta>;
}

const UNAVAILABLE_TITLE = "附件不可用";

function attachmentsOf(env: unknown): Record<string, AttachmentRenderMeta> {
  return (env as MarkdownEnv | undefined)?.attachments ?? {};
}

/** 大小文案（与 `features/attachments/model.ts` 同口径，但这里不引 feature 层——预览是 app 层） */
function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/**
 * DOMPurify 默认 URI 白名单 + `blob:`（语义与默认值一致，只多放行一种协议）。
 * 整体抄一遍默认正则容易随库升级漂移，所以这里只明确"多一条 blob"。
 */
const BLOB_ALLOWED_URI_REGEXP =
  /^(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|mid|xmpp|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$)/i;

/** Markdown → 安全 HTML 字符串（仅供 `dangerouslySetInnerHTML` 使用） */
export function renderMarkdown(source: string, options: RenderMarkdownOptions = {}): string {
  const html = md.render(source, { attachments: options.attachments } satisfies MarkdownEnv);
  return options.allowBlobUris
    ? DOMPurify.sanitize(html, { ALLOWED_URI_REGEXP: BLOB_ALLOWED_URI_REGEXP })
    : DOMPurify.sanitize(html);
}

/**
 * 给附件链接补上大小（渲染后处理，比改 markdown-it 的 token 流简单且稳定）。
 *
 * 放在 DOMPurify **之后**是有意的：注入的 `<span>` 是我们自己拼的、内容只有数字，
 * 不经过净化也不会有风险；反过来（先生成再净化）还得保证 `span` 在白名单里。
 */
export function decorateAttachmentSizes(
  html: string,
  attachments: Record<string, AttachmentRenderMeta>,
): string {
  return html.replace(
    /<a([^>]*?)data-attachment="([0-9a-f]{64})"([^>]*)>/gi,
    (match, _before: string, sha: string) => {
      const meta = attachments[sha];
      if (!meta) return match;
      // 大小紧跟在结束标签后（链接后面一个灰色小字，不抢链接本身的视觉）
      return `${match}<span class="size-tag">${sizeLabel(meta.size)}</span>`;
    },
  );
}
