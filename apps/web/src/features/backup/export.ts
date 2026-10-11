/**
 * 备份导出编排（客户端；设计 §三）。
 *
 * **为什么在客户端跑**：数据本来就在 IndexedDB（离线优先），在这里导出不占 Worker 的
 * CPU/内存配额；服务端导出会撞响应体积与流式限制，还要额外设计导出任务。
 *
 * **为什么必须能中断**：全量导出会很久（每篇正文 + 每个附件都要过一遍），
 * `DESIGN.md` §5.4-3 要求实时状态**必须可见**，§6.1 要求操作要有可见反馈。
 * 所以这里每个阶段都回报进度，并且全程认 `AbortSignal`。
 */
import {
  BACKUP_VERSION,
  attachmentPath,
  completePath,
  foldersPath,
  manifestPath,
  notePath,
  renderComplete,
  sha256Hex,
} from "@menote/shared";
import { APP_VERSION } from "../../app/about";
import { getEditableBody, listLocalFolders, listLocalItems } from "../../data/db";
import { attachmentUrl } from "../attachments/model";
import { buildManifest, collectAttachments, type BackupSourceItem } from "./build";

export type ExportPhase = "collecting" | "attachments" | "packing" | "done";

export interface ExportProgress {
  phase: ExportPhase;
  done: number;
  total: number;
  /** `done` 阶段才有 */
  fileName?: string;
  bytes?: number;
}

export interface ExportOptions {
  includeTrashed?: boolean;
  includeVersions?: boolean;
  onProgress: (progress: ExportProgress) => void;
  signal?: AbortSignal;
  /** 注入用：测试里替掉网络与下载 */
  fetchAttachment?: (sha256: string) => Promise<Uint8Array>;
  /** 注入用：测试里替掉「触发浏览器下载」 */
  saveBlob?: (blob: Blob, fileName: string) => void;
}

export function backupFileName(now: number): string {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  return `menote-backup-${stamp}.zip`;
}

/** 触发浏览器下载（单篇导出同源复用，`export-note.ts` 也用它） */
export function defaultSaveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // 立刻撤销会让部分浏览器来不及开始下载，给它一拍
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 按 sha256 下载附件原始字节（内容寻址接口，与备份导出共用一条通道） */
export async function fetchAttachmentBytes(sha256: string): Promise<Uint8Array> {
  const response = await fetch(attachmentUrl(sha256));
  if (!response.ok) {
    throw new Error(`附件下载失败（${response.status}）：${sha256.slice(0, 8)}…`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("导出已取消", "AbortError");
}

/**
 * 导出一份完整备份并触发下载。
 *
 * 顺序刻意是「先取完本地数据 → 再下附件 → 最后打包」：附件下载是网络往返，最慢，
 * 放在前面能让进度条尽快动起来；打包放最后，因为它是一次性的 CPU 计算。
 */
export async function exportBackup(options: ExportOptions): Promise<void> {
  const {
    includeTrashed = true,
    includeVersions = false,
    onProgress,
    signal,
    fetchAttachment = fetchAttachmentBytes,
    saveBlob = defaultSaveBlob,
  } = options;

  // —— 1. 收集本地条目与正文 ——
  onProgress({ phase: "collecting", done: 0, total: 0 });
  const [items, folders] = await Promise.all([listLocalItems(), listLocalFolders()]);
  throwIfAborted(signal);

  const sources: BackupSourceItem[] = [];
  for (let index = 0; index < items.length; index += 1) {
    throwIfAborted(signal);
    const item = items[index];
    if (!item) continue;
    /*
      必须是 `getEditableBody`（草稿优先），不是 `getCachedBody`：草稿每 2 秒写一次、
      内容是用户刚敲的，而缓存里的正文要等上传成功才更新。用后者会**静默丢掉**用户
      还没同步的那些改动——备份最不能出的错就是"看着导出了，其实少了东西"。
    */
    const { body } = await getEditableBody(item.id);
    sources.push({ meta: item, body });
    onProgress({ phase: "collecting", done: index + 1, total: items.length });
  }

  // —— 2. 下载附件 ——
  const refs = collectAttachments(sources);
  const attachments = new Map<string, { bytes: Uint8Array; filename: string }>();
  for (let index = 0; index < refs.length; index += 1) {
    throwIfAborted(signal);
    const ref = refs[index];
    if (!ref) continue;
    try {
      const bytes = await fetchAttachment(ref.sha256);
      attachments.set(ref.sha256, { bytes, filename: ref.filename });
    } catch (error) {
      /*
        单个附件下不到**不能**让整次导出失败：正文已经拿到了，缺附件的备份仍然
        可用（那篇笔记的图会缺）。但要说出来——所以把失败记下来，最后一并回报。
      */
      attachments.set(ref.sha256, { bytes: new Uint8Array(0), filename: ref.filename });
      void error;
    }
    onProgress({ phase: "attachments", done: index + 1, total: refs.length });
  }

  // —— 3. manifest → COMPLETE → zip ——
  throwIfAborted(signal);
  onProgress({ phase: "packing", done: 0, total: 2 });
  const manifest = buildManifest({
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    items: sources,
    attachments,
    includeTrashed,
    includeVersions,
  });
  // 清单里 folder 树单独成文件：条目索引里只有 folder_id，树的形状在这里
  const foldersJson = JSON.stringify(folders, null, 2);
  const manifestText = JSON.stringify(manifest, null, 2);

  // 所有包内路径都由 shared 的那几个函数产出，不在这里手拼字符串——
  // 手拼过一次就出现过「清单写 `notes/x.md`、包里却是 `snapshot/notes/x.md`」的错位。
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {
    [manifestPath()]: encoder.encode(manifestText),
    [foldersPath()]: encoder.encode(foldersJson),
  };
  for (const [sha256, value] of attachments) {
    files[attachmentPath(sha256, value.filename)] = value.bytes;
  }
  for (const { meta, body } of sources) {
    if (!includeTrashed && meta.deleted_at !== null) continue;
    files[notePath(meta.id)] = encoder.encode(body);
  }

  /*
    `COMPLETE` 的哈希算的是 `manifestText` 的 **UTF-8 字节**，与包里那个文件
    **逐字节一致**——`verifySnapshot` 那边也是拿读到的原始字节算的。
    这里若改成「先 JSON.stringify 再编码」以外的任何路径，两边就会对不上。
  */
  const manifestSha = await sha256Hex(encoder.encode(manifestText));
  // 放最后一个：解包到一半的包不会有它
  files[completePath()] = encoder.encode(renderComplete(BACKUP_VERSION, manifestSha));
  onProgress({ phase: "packing", done: 1, total: 2 });
  throwIfAborted(signal);

  const zipped = await zipFiles(files);
  const fileName = backupFileName(Date.now());
  saveBlob(new Blob([zipped as BlobPart], { type: "application/zip" }), fileName);
  onProgress({ phase: "done", done: 2, total: 2, fileName, bytes: zipped.byteLength });
}

/**
 * 打包成 zip。
 *
 * 用 fflate 的**异步** zip 而不是 `zipSync`：全量备份动辄几百个文件，同步压缩会把主
 * 线程堵死几百毫秒到几秒——那正是这个功能最不该出现的卡顿。
 */
function zipFiles(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    void import("fflate").then(({ zip }) => {
      zip(files, { level: 6 }, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    }, reject);
  });
}
