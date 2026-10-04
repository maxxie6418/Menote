/**
 * 导入本地 Markdown 文件成笔记（笔记本 `+` 菜单 → 导入笔记；用户 2026-10-02 拍板）。
 *
 * **与设置页「从备份恢复」是两件事**：那条是整包 `.zip` 的账户级还原
 * （`features/backup/import.ts`，按 manifest 校验、可覆盖同 id 条目）；本模块只做
 * 「挑几个 `.md` 文件 → 各建一条笔记」，不校验任何东西、也不覆盖任何已有条目。
 *
 * 三条口径：
 * 1. **正文原样入库**（与备份导出同一哲学：`.md` 本身就是这篇笔记），只剥 UTF-8 BOM——
 *    Windows 编辑器存的 `.md` 常带 BOM，不剥的话正文首行会多一个不可见字符；
 * 2. **标题取文件名**。单篇导出（`features/backup/export-note.ts`）导出的 `.md` 是正文原样、
 *    本身不含标题信息，所以不解析 front matter 去猜标题；
 * 3. **条目类型、标签、待办字段由正文派生**（mdcore 的同一份实现，与 `useMemoWrite` 一致）。
 *
 * **为什么类型必须显式定**：表格界面由 `item.type === "table"` 决定
 * （`features/notes/ui/NoteWorkspace.tsx:201`），**光看正文解析不出来**。所以这里显式
 * `parseTableDocument(body).ok ? "table" : "note"`，否则 MeNote 自己导出的表格 `.md`
 * 导回来会退化成一篇纯文本笔记。
 *
 * 落点（哪个笔记本）不在这里定：由调用方把 `create` 注进来，本模块只管
 * 「文件 → 草稿 → 逐个交给上层建」。串行按选择顺序建，因为 outbox 是 FIFO。
 */
import { deriveTags, deriveTaskFields, deriveTitle, parseTableDocument } from "@menote/mdcore";
import type { ItemType } from "@menote/shared";

/** 标题退化时的兜底文案（与新建笔记的默认标题同一个来源） */
export const DEFAULT_NOTE_TITLE = "未命名笔记";

/** 只收 `.md`（大小写不敏感）。系统对话框允许"所有文件"，所以这里必须自己再挡一道 */
export function isMarkdownFileName(fileName: string): boolean {
  return /\.md$/i.test(fileName);
}

/** 文件名去扩展名即标题；空文件名（如 `.md`）退回默认标题 */
export function noteTitleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.md$/i, "").trim();
  return base === "" ? DEFAULT_NOTE_TITLE : base;
}

/**
 * 标题：**front matter 的 `title:` 优先，文件名兜底**（2026-10-04）。
 *
 * 为什么改口径：此前一律取文件名，而外部工具（Obsidian 等）导出的 `.md` 把标题写在
 * `title:` 里、文件名却是 slug 或一串 status id——照文件名取会得到
 * `2035341800739877091` 这种没法读的标题。md 里有 `title:` 就用它，那才是作者写的那个。
 *
 * `title:` 空着（`present` 但取不到值）时**也**回落到文件名，不让一条笔记顶着空标题。
 */
export function titleForImport(fileName: string, body: string): string {
  const derived = deriveTitle(body);
  return derived.present && derived.value ? derived.value : noteTitleFromFileName(fileName);
}

/** 剥掉 UTF-8 BOM（`File.text()` 会把它留在字符串开头） */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** 一个待建的条目（落点等库相关字段由上层补） */
export interface ImportedNoteDraft {
  title: string;
  body: string;
  type: ItemType;
  tags: string[];
  task: { isTask: boolean; status: string | null; due: string | null; priority: string | null };
}

/** 没能导入的：非 `.md`、读不出、或建失败。逐条带名字与原因，结果里可见，不静默吞 */
export interface SkippedFile {
  name: string;
  reason: string;
}

export interface ImportNotesSummary {
  created: number;
  skipped: SkippedFile[];
}

function draftFrom(body: string, title: string): ImportedNoteDraft {
  return {
    title,
    body,
    type: parseTableDocument(body).ok ? "table" : "note",
    tags: deriveTags(body),
    task: deriveTaskFields(body),
  };
}

/**
 * 导入一批 `.md` 文件。
 *
 * `create` 由上层注入（要带上"落到哪个笔记本"），因此本模块**不碰 IndexedDB**、可在 node
 * 环境直接单测。单个文件失败不中断整批：其余照常建，失败项进 `skipped` 最后一起报。
 */
export async function importMarkdownFiles(
  files: readonly File[],
  create: (draft: ImportedNoteDraft) => Promise<void>,
): Promise<ImportNotesSummary> {
  const summary: ImportNotesSummary = { created: 0, skipped: [] };

  for (const file of files) {
    if (!isMarkdownFileName(file.name)) {
      summary.skipped.push({ name: file.name, reason: "不是 .md 文件" });
      continue;
    }
    try {
      const body = stripBom(await file.text());
      await create(draftFrom(body, titleForImport(file.name, body)));
      summary.created += 1;
    } catch (error) {
      summary.skipped.push({
        name: file.name,
        reason: error instanceof Error ? error.message : "读取或写入失败",
      });
    }
  }

  return summary;
}
