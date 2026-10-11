/**
 * 单篇导出（M15 剩余的「单篇 Markdown」，用户 2026-10-02 拍板做、附件可选）。
 *
 * 与备份同一个哲学（设计 §2.1）：**`.md` 本身就是这篇笔记**——front matter 与正文
 * 原样、一个字不改，任何编辑器都能打开；附件引用是 `/api/attachments/h/<sha>` 链接，
 * 要"发给别人也能看"就选「含附件」，把引用的附件按备份同样的
 * `attachments/<sha256>--<文件名>` 布局打进 zip（内容寻址天然去重）。
 *
 * 正文走 `getEditableBody`（**草稿优先**）：导出的就是用户此刻看到的内容，
 * 刚敲还没同步的字不能丢——理由与备份导出相同（设计 §三）。
 *
 * 归宿在 `features/backup/`：M5 的「备份与导出」同属一个功能模块，
 * 下载与附件下载两个 IO 助手直接同源复用（`export.ts`）。
 */
import { sha256Hex } from "@menote/shared";
import { getEditableBody } from "../../data/db";
import { extractAttachmentRefsWithNames } from "../attachments/model";
import { defaultSaveBlob, fetchAttachmentBytes } from "./export";

export interface ExportNoteOptions {
  id: string;
  /** 条目标题：导出文件名的来源（空标题退回「未命名」） */
  title: string | null;
  /** 打包引用的附件（zip）；缺省只导出 `.md` 本体 */
  includeAttachments?: boolean;
  /** 注入用：测试里替掉附件网络请求 */
  fetchAttachment?: (sha256: string) => Promise<Uint8Array>;
  /** 注入用：测试里替掉「触发浏览器下载」 */
  saveBlob?: (blob: Blob, fileName: string) => void;
}

/** Windows 保留字符与控制字符不能进文件名；过长截到 80 字，留扩展名余地 */
export function noteExportFileName(title: string | null): string {
  // 控制字符逐码位看（no-control-regex；与 shared backup.ts 的路径校验同一手法）
  const base = [...(title ?? "")]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x20 || "\\/:*?\"<>|".includes(ch)) return "_";
      return ch;
    })
    .join("")
    .trim();
  const safe = (base.length > 0 ? base : "未命名").slice(0, 80).trimEnd();
  return `${safe}.md`;
}

export async function exportNoteMarkdown(options: ExportNoteOptions): Promise<void> {
  const {
    id,
    title,
    includeAttachments = false,
    fetchAttachment = fetchAttachmentBytes,
    saveBlob = defaultSaveBlob,
  } = options;

  const { body } = await getEditableBody(id);
  const fileName = noteExportFileName(title);

  if (!includeAttachments) {
    saveBlob(new Blob([body], { type: "text/markdown" }), fileName);
    return;
  }

  // 附件逐个取原始字节：单个失败就整次失败——「含附件」的语义是拿走就能打开，
  // 缺一个附件的包比不给包更容易被误当成完整的
  const files: Record<string, Uint8Array> = {
    [fileName]: new TextEncoder().encode(body),
  };
  for (const ref of extractAttachmentRefsWithNames(body)) {
    const bytes = await fetchAttachment(ref.sha256);
    const actual = await sha256Hex(bytes);
    if (actual !== ref.sha256) {
      throw new Error(`附件内容与引用不符：${ref.filename}（${ref.sha256.slice(0, 8)}…）`);
    }
    files[`attachments/${ref.sha256}--${ref.filename}`] = bytes;
  }

  const { zip } = await import("fflate");
  const packed = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, (error, data) => (error ? reject(error) : resolve(data)));
  });
  saveBlob(
    new Blob([packed as BlobPart], { type: "application/zip" }),
    fileName.replace(/\.md$/, ".zip"),
  );
}
