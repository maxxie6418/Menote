/**
 * Markdown 预览（架构 §3.4）。单独一个组件，便于与编辑器一起被**动态导入**成独立分包
 * （架构 §14.1 要求 Markdown 渲染不进首屏）。
 *
 * M4-10：附件引用要能"看出是什么"——非图片附件补大小、找不到对象时标"不可用"（界面稿 §7.4）。
 * 元数据由调用方从本地库读好后传进来（预览层不碰数据访问，与"UI 只做展示"的分工一致）。
 */
import { useEffect, useMemo, useRef } from "react";
import { highlightToHtml } from "./code-highlight";
import {
  decorateAttachmentSizes,
  renderMarkdown,
  type AttachmentRenderMeta,
} from "./markdown";

export interface MarkdownPreviewProps {
  source: string;
  /** 本地已知的附件（`sha256 -> 元数据`）：标"不可用"与补大小用 */
  attachments?: Record<string, AttachmentRenderMeta>;
  /** 放行 `blob:` 图片（分享查看器用；见 `markdown.ts` 的 `allowBlobUris`） */
  allowBlobUris?: boolean;
}

export function MarkdownPreview({ source, attachments, allowBlobUris = false }: MarkdownPreviewProps) {
  /*
    **必须记忆化**：`renderMarkdown` 是 markdown-it 全文解析 + DOMPurify 净化 + 附件大小正则，
    而这个组件在正文区的**每次渲染**都会跑（切换条目重挂一次、分隔屏下每个键都还要再跑一次）。
    实测（jsdom，4KB 中文）：单次 `renderMarkdown` 约 23ms —— 2000 篇的库上叠加列表重渲染，
    就是用户感觉到的"卡"（2026-09-27 实测）。依赖只有 `source` 与附件元数据，
    两者不变时结果完全一致，没有记忆化的风险。
  */
  const html = useMemo(() => {
    const rendered = renderMarkdown(source, { attachments, allowBlobUris });
    return attachments ? decorateAttachmentSizes(rendered, attachments) : rendered;
  }, [source, attachments, allowBlobUris]);

  const hostRef = useRef<HTMLDivElement | null>(null);
  /*
    补色 effect 依赖 `html`（渲染结果变了才重跑）；`htmlRef` 是它的防竞态读数——
    **在 effect 里**同步（lint 的 no-ref-access-during-render），不在渲染期写。
  */
  const htmlRef = useRef(html);
  useEffect(() => {
    htmlRef.current = html;
  }, [html]);

  /*
    代码块高亮补色（P2-2）。markdown-it 的 `highlight` 选项是同步的，而 Prism 必须
    动态 `import()`（首屏不付语言包的代价），所以走**渲染后补色**（inkstone `enhance.ts`
    同一路数）： Prism 没加载完前代码就是纯文本，加载完把 `tok-*` span 替换进去——
    类名与即时渲染的 mark 装饰同批，配色在 `app.css` 只写一份。
  */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let alive = true;
    void (async () => {
      const blocks = [...host.querySelectorAll<HTMLElement>("pre code[class*='language-']")];
      for (const block of blocks) {
        const lang = /language-([\w+#-]+)/.exec(block.className)?.[1] ?? "";
        if (lang === "") continue;
        const text = block.textContent ?? "";
        if (text.trim() === "") continue;
        const colored = await highlightToHtml(text, lang);
        // 等待期间组件可能重渲染/卸载，或者内容已经换了一版：都不写
        if (!alive || !colored) continue;
        if (block.isConnected && htmlRef.current === html && (block.textContent ?? "") === text) {
          block.innerHTML = colored;
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [html]);

  return (
    <div
      ref={hostRef}
      className="markdown-body"
      // 内容已经 markdown-it（不放行原始 HTML）+ DOMPurify 双重处理
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
