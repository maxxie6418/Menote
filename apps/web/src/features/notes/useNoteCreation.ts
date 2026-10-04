/**
 * 新建动作（M3-6 从 `useNotesWorkspace` 抽出，为那个 hook 的 500 行预算让位）。
 *
 * 四件事：新建笔记、新建笔记本文件夹、**导入本地 Markdown**（v0.6.16）、**新建表格**（v0.6.16）。
 * 四条口径：
 * - **新建笔记落在"当前选中的笔记本"**（2026-09-28 修复，用户反馈的问题 1）：`view.kind === "notebook"`
 *   时取 `view.folderId`；最近编辑 / 收藏 / 标签这些视图**没有笔记本上下文**，落根目录；
 * - **加密空间里的文件夹**新建时**直接带空间标记**（`in_enc_space`）建在那里，
 *   不走"先建在根目录再移进去"（与普通笔记本现在是**同一条路径**，只是多一个标记）；
 * - 文件夹深度超限时**客户端先抛错**（界面本该不给出入口，真出现了也不该把脏数据写进本地库）。
 *
 * **落点解析抽成 `resolveTarget`**：新建笔记 / 导入笔记 / 新建表格三条路径的落点必须**完全一致**，
 * 各写一份早晚会漂。抽成模块级纯函数顺带让它可单测。条目不受两层文件夹限制，所以这里
 * **不套** `beginCreate` 那套父层推导（那是建文件夹的规则）。
 *
 * **返回一整组动作（`NoteCreationActions`）而不是四个散字段**：`useNotesWorkspace` 正好卡在
 * 500 行预算上（架构 §2.3.1），逐个往它的返回体与依赖数组里加字段会顶破。让 `NotesWorkspace`
 * `extends` 这个接口、调用方 spread 一行，既过了预算，也让"创建类动作"成为一个整体。
 * 返回值用 `useMemo` 包住：身份不稳定会让调用方的 effect 每次渲染都变。
 */
import { useCallback, useMemo } from "react";
import { newUlid } from "@menote/shared";
import { renderTableDocument, updateMenoteKeys, type TableDoc } from "@menote/mdcore";
import { createLocalFolder, createLocalItem } from "../../data/db";
import type { LocalFolder } from "../../data/db";
import { folderDepthFor, MAX_FOLDER_DEPTH } from "./folders";
import { isInVault } from "../privacy/vault";
import { DEFAULT_NOTE_TITLE, importMarkdownFiles, type ImportNotesSummary } from "./import-md";
import type { NotesView } from "./views";

/** 新建表格的默认标题：表格界面不收标题，先给一个能认出来的，之后在标题栏改 */
const DEFAULT_TABLE_TITLE = "未命名表格";

/** 条目的落点：当前选中的笔记本（没有笔记本上下文的视图 → 根目录）+ 是否在加密空间内 */
export function resolveTarget(
  folders: readonly LocalFolder[],
  view: NotesView,
): { folderId: string | null; inVault: boolean } {
  const folderId = view.kind === "notebook" ? (view.folderId ?? null) : null;
  return { folderId, inVault: folderId !== null && isInVault(folders, folderId) };
}

/** "创建类动作"这一组（`NotesWorkspace` 直接 extends 它，字段说明住在这里） */
export interface NoteCreationActions {
  /** 新建笔记：落当前选中的笔记本，建完打开它 */
  createNote: (options?: { title?: string; body?: string }) => Promise<string>;
  /** 新建文件夹（深度超限时抛错，界面本该不给出入口） */
  createFolder: (name: string, parentId: string | null) => Promise<void>;
  /**
   * 导入本地 `.md`（v0.6.16）：落点 = 当前选中的笔记本，逐个文件建一条。
   * 建完**不打开**任何一篇（多选时不该把编辑器刷过去），要哪篇在列表里点。
   */
  importNotes: (files: readonly File[]) => Promise<ImportNotesSummary>;
  /**
   * 新建表格（v0.6.16）：列定义面板交回文档后建条目，条目 `type` 是 `table`。
   * 建完打开它（与新建笔记一致）。
   */
  createTable: (doc: TableDoc) => Promise<string>;
}

export interface UseNoteCreationInput {
  folders: readonly LocalFolder[];
  view: NotesView;
  refresh: () => Promise<void>;
  open: (id: string) => Promise<void>;
  setView: (view: NotesView) => void;
  onLocalWrite?: () => void;
}

export function useNoteCreation(input: UseNoteCreationInput) {
  const { folders, view, refresh, open, setView, onLocalWrite } = input;

  const createNote = useCallback(
    async (options?: { title?: string; body?: string }): Promise<string> => {
      const id = newUlid();
      /*
        **落点 = 当前选中的笔记本**。此前只有加密空间那条分支带 `folder_id`，
        普通笔记本一律走 `createLocalNote`（= 根目录）：选中「工作」新建时会落进「全部笔记」，
        用户反馈的"其他新建要附属于笔记本"就是这一条。
      */
      const target = resolveTarget(folders, view);
      const title = options?.title ?? DEFAULT_NOTE_TITLE;

      await createLocalItem(
        {
          id,
          type: "note",
          title,
          folder_id: target.folderId,
          /*
            标题同时写进 md 的顶层 `title:`（2026-10-04，md 为准、列是派生列）。
            用 `updateMenoteKeys` 而不是 `buildDocument`：`options.body` 可能已经是带
            front matter 的完整文档（快速录入框带标签时会），`buildDocument` 会把它整块重建掉。
          */
          body: updateMenoteKeys(options?.body ?? "", { title }),
          inEncSpace: target.inVault,
        },
        Date.now(),
      );

      await refresh();
      await open(id);
      onLocalWrite?.();
      // 返回新 id：调用方要用它给"打开这一篇"的轻提示动作（2026-09-28）
      return id;
    },
    [folders, onLocalWrite, open, refresh, view],
  );

  const createFolder = useCallback(
    async (name: string, parentId: string | null) => {
      const parent =
        parentId === null ? null : (folders.find((row) => row.id === parentId) ?? null);
      const depth = folderDepthFor(parent);
      if (depth > MAX_FOLDER_DEPTH) {
        throw new Error(`最多支持 ${MAX_FOLDER_DEPTH} 层文件夹`);
      }
      const id = newUlid();
      await createLocalFolder(id, name, parentId, depth, Date.now());
      await refresh();
      setView({ kind: "notebook", folderId: id });
      onLocalWrite?.();
    },
    [folders, onLocalWrite, refresh, setView],
  );

  /**
   * 导入本地 `.md`（v0.6.16）。落点与新建笔记**同一套** `resolveTarget`——
   * 用户是从"这个笔记本"的 `+` 菜单点进来的，落别处就是 bug。
   *
   * 一个文件一条笔记，**不打开任何一篇**：多选时逐篇打开会把编辑器刷过去；
   * 要看哪篇用户在列表里点。建完只 `refresh()` 一次（循环里 refresh N 次会让
   * 大批量导入卡在渲染上）。
   */
  const importNotes = useCallback(
    async (files: readonly File[]): Promise<ImportNotesSummary> => {
      const target = resolveTarget(folders, view);
      const summary = await importMarkdownFiles(files, async (draft) => {
        await createLocalItem(
          {
            id: newUlid(),
            type: draft.type,
            title: draft.title,
            folder_id: target.folderId,
            tags: draft.tags,
            body: draft.body,
            inEncSpace: target.inVault,
            task: draft.task,
          },
          Date.now(),
        );
      });
      if (summary.created > 0) {
        await refresh();
        onLocalWrite?.();
      }
      return summary;
    },
    [folders, onLocalWrite, refresh, view],
  );

  /**
   * 新建表格（v0.6.16）：列定义面板（`TableColumnManager` 的 `mode="create"`）交回文档，
   * 这里渲染成正文再建条目。
   *
   * **`type` 必须是 `"table"`**：`NoteWorkspace` 是按 `item.type` 决定走不走表格界面的，
   * 不是按正文解析。建成 `"note"` 的话用户会看到一篇装着表格源码的纯文本笔记。
   */
  const createTable = useCallback(
    async (doc: TableDoc): Promise<string> => {
      const target = resolveTarget(folders, view);
      const id = newUlid();
      await createLocalItem(
        {
          id,
          type: "table",
          title: DEFAULT_TABLE_TITLE,
          folder_id: target.folderId,
          // 标题也进 md 顶层（与笔记同一条口径）：`TableDoc.title` 缺省即不写这一行
          body: renderTableDocument({ ...doc, title: DEFAULT_TABLE_TITLE }),
          inEncSpace: target.inVault,
        },
        Date.now(),
      );
      await refresh();
      await open(id);
      onLocalWrite?.();
      return id;
    },
    [folders, onLocalWrite, open, refresh, view],
  );

  return useMemo<NoteCreationActions>(
    () => ({ createNote, createFolder, importNotes, createTable }),
    [createFolder, createNote, createTable, importNotes],
  );
}
