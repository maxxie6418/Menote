/**
 * 笔记工作区的状态编排（列表 + 当前条目 + 自动保存控制器）。
 *
 * 界面上只是"列表 + 正文"，数据流向全部经过本地库（架构 §3.1：界面层不直接访问网络）：
 * 新建 → 写本地 + 入队；编辑 → 草稿 + 入队；标题 → 元数据补丁入队；同步由引擎负责。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearConflict,
  countItemsByFolder,
  db,
  enqueueBodySave,
  findConflictForOriginal,
  getCachedBody,
  getDraft,
  getLocalItem,
  listItemSummaries,
  listLocalFolders,
  listLocalItems,
  listLocalMemos,
  listMemoContents,
  moveLocalFolder,
  refreshSearchIndex,
  renameLocalFolder,
  saveDraft,
  type LocalFolder,
  type LocalItem,
  type MemoContent,
} from "../../data/db";
import { useNoteEditingSession } from "../../app/shortcuts/useNoteEditingSession";
import { createNoteEditor, type NoteEditorController, type NoteEditorSnapshot } from "./model";
import { writeItemTitle } from "./actions";
import { itemsApi } from "../../data/api/endpoints";
import {
  collectTags,
  DEFAULT_VIEW,
  filterByView,
  viewPathOf,
  viewTitle,
  type NotesView,
} from "./views";
import { folderDepthFor, MAX_FOLDER_DEPTH } from "./folders";
import { indexItemsByFolder } from "./groups";
import { useNoteCreation, type NoteCreationActions } from "./useNoteCreation";
import { useVaultScope } from "./useVaultScope";
import { useItemPatchActions } from "./useItemPatchActions";
import { useMemoWrite } from "../memos/useMemoWrite";
import type { BatchProgress, BatchResult } from "./batch";
import { canShowInList, type PrivacyGate } from "@menote/shared";

/** 列表是否等价：只比对界面真正用到的字段 */
function sameItems(left: LocalItem[], right: LocalItem[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b) return false;
    if (
      a.id !== b.id ||
      a.title !== b.title ||
      a.rev !== b.rev ||
      a.meta_rev !== b.meta_rev ||
      a.updated_at !== b.updated_at ||
      a.sync_seq !== b.sync_seq ||
      a.pending !== b.pending ||
      a.content_hash !== b.content_hash
    ) {
      return false;
    }
  }
  return true;
}

/**
 * 工作区的对外形状。
 *
 * `extends NoteCreationActions`：创建类动作（新建笔记 / 文件夹、导入笔记、新建表格）由
 * `useNoteCreation` 整组提供并在下面 spread 进来。逐字段列在这里会让本文件顶破 500 行预算
 * （架构 §2.3.1），字段说明随实现住在 `useNoteCreation.ts`。
 */
export interface NotesWorkspace extends NoteCreationActions {
  /** 当前视图下的条目（已过滤、已排序） */
  items: LocalItem[];
  /** 全部未删除条目（计数与标签云用，不受视图过滤影响） */
  allItems: LocalItem[];
  loading: boolean;
  view: NotesView;
  viewTitle: string;
  /**
   * 当前视图的层级路径（仅「笔记本」视图且选中文件夹时非空；根视图为空数组）。
   * 列表头用它显示父级面包屑（`工作 › 本周`）。
   */
  viewPath: string[];
  /** 按文件夹分好组的条目（B2 批；左侧树"显示条目"用，根目录条目不在此表） */
  itemsByFolder: Record<string, LocalItem[]>;
  setView: (view: NotesView) => void;
  tags: Array<{ tag: string; count: number }>;
  selectedId: string | null;
  selected: LocalItem | null;
  /** 本地文件夹（两层树）与其条目计数 */
  folders: LocalFolder[];
  folderCounts: Record<string, number>;
  /**
   * 笔记本树用的文件夹与计数（M3-6）：**排除整个加密空间子树**——
   * 空间不在笔记本树里，它是导航底部那个贴底节点（设计 §6.2）。
   */
  notebookFolders: LocalFolder[];
  notebookCounts: Record<string, number>;
  /** 加密空间（M3-6）：根行 / 空间内子夹 / 空间内条目数 */
  vault: {
    /** 空间根文件夹 id；服务端补建完成前可能为 null（此时不给建入口） */
    id: string | null;
    name: string;
    /** 空间内的子夹（不含根自己；根就是列表的"根目录"） */
    folders: LocalFolder[];
    /** 空间内条目总数（含子夹里的） */
    count: number;
  };
  /** 在空间内新建笔记（创建请求天然带 `in_enc_space`，不走"先建后移"） */
  createNoteInVault: (options?: { folderId?: string | null }) => Promise<void>;
  /** 在空间内新建文件夹（与笔记本同一套两层限制） */
  createVaultFolder: (name: string, parentId: string | null) => Promise<void>;
  /** 列表行的摘要（取自已缓存正文的第一行） */
  summaries: Record<string, string>;
  initialBody: string;
  /**
   * **当前选中项的正文还没到**（`true` = 正文区该显示"正在打开"）。
   *
   * 服务于"点下去立刻有反馈"：`open()` 会**同步**落选中态（列表高亮立刻动），
   * 正文则要等本地缓存读到 / 正文不在本机时去服务端补拉一次（一次网络往返）——
   * 这段时间就是 `true`，界面据此给占位，而不是"看起来根本没点动"。
   * 首次进页面（还没成功打开过任何条目）恒为 `false`：那时没有选中项，走空状态。
   */
  docLoading: boolean;
  /**
   * **正文版本号**：每有一份正文到位（打开、重新载入同一篇）就 +1；还没开过任何条目时为 `0`。
   *
   * 正文区拿它当重载信号——同一篇被重新打开时 `selectedId` 不变，光看 id 认不出"正文换了"。
   */
  docEpoch: number;
  snapshot: NoteEditorSnapshot | null;
  refresh: () => Promise<void>;
  open: (id: string) => Promise<void>;
  changeTitle: (title: string) => Promise<void>;
  /** 时间轴上的 Memo（不含已删除的；按 memo_at 倒序，置顶由界面层再排） */
  memos: LocalItem[];
  /** Memo 的正文（已剥 front matter）与已转笔记关联，供时间轴渲染 */
  memoContents: Record<string, MemoContent>;
  /**
   * 发布 Memo（乐观：先落本地并标"待上传"，出队由 outbox 后台上传；写入**永远免密**）。
   * `asTask` = 用户在录入框确认了"设为清单？"或走的是待办档；正文会带上 `menote.task` 标记，
   * 新建清单**默认状态"待办"**（M2-5）。
   */
  publishMemo: (
    text: string,
    options?: { asTask?: boolean; due?: string | null; priority?: string | null },
  ) => Promise<void>;
  /** 编辑 Memo 正文（Q19：`memo_at` 不变，只改正文与派生标签） */
  updateMemo: (itemId: string, text: string) => Promise<void>;
  /** 重命名文件夹（走 meta_rev，不生成冲突副本） */
  renameFolder: (folderId: string, name: string) => Promise<void>;
  /** 移动文件夹到某个父级（`null` = 根目录） */
  moveFolder: (folderId: string, parentId: string | null) => Promise<void>;
  /** 把条目移入文件夹（`null` = 根目录） */
  moveItemToFolder: (itemId: string, folderId: string | null) => Promise<void>;
  /** 移入加密空间（`folderId = null` = 空间根；锁定态只有这一个目标可用） */
  moveItemToVault: (itemId: string, folderId: string | null) => Promise<void>;
  /** 移出加密空间（`folderId = null` = 根目录） */
  moveItemOutOfVault: (itemId: string, folderId: string | null) => Promise<void>;
  /** 整夹移入加密空间（含内部条目批量打标）；返回失败清单供「重试」 */
  moveFolderToVault: (
    folderId: string,
    options?: { onProgress?: (progress: BatchProgress) => void },
  ) => Promise<BatchResult<LocalItem>>;
  /** 整夹移出加密空间 */
  moveFolderOutOfVault: (
    folderId: string,
    options?: { onProgress?: (progress: BatchProgress) => void },
  ) => Promise<BatchResult<LocalItem>>;
  /**
   * 单篇加密开关（M3-7）：`true` = 给这一篇加锁（**锁定态也能开**，Q25），
   * `false` = 取消加密（调用方必须先确认该篇已解锁）。
   */
  setItemEncryption: (itemId: string, encrypted: boolean) => Promise<void>;
  /** 置顶 / 收藏：都走元数据补丁（服务端白名单已含这两列） */
  togglePinned: (itemId: string) => Promise<void>;
  toggleStarred: (itemId: string) => Promise<void>;
  /**
   * **降级为普通笔记**（M4-9；`table → note` 单向）。
   *
   * **需要联网**（直连 API，不走 outbox——理由见 `useItemPatchActions.degradeToNote`），
   * 离线时会把错误抛给调用方，由界面提示。
   */
  degradeToNote: (itemId: string) => Promise<void>;
  input: (text: string) => void;
  notifyUploaded: () => void;
  notifyFailed: () => void;
  notifyConflict: () => void;
  /** 打开着的这条被别的标签页改过（M2-9 的事前提示；保存仍会走冲突副本路径） */
  remoteChanged: boolean;
  /** 打开着的这条的冲突副本（M2-9 对比 UI）；`null` = 没有冲突 */
  conflictCopy: { copyId: string; copyTitle: string } | null;
  /** 查看冲突副本（在正文区打开它，便于与当前版本对照） */
  openConflictCopy: () => Promise<void>;
  /**
   * 处理冲突：
   * - `mine`：把副本的内容写回原条目（原条目产生新版本，副本作为普通笔记保留，便于事后核对）；
   * - `server`：保留服务端版本，副本作为普通笔记保留。
   * 两种都清掉冲突关联。**删除副本要等 M4 的回收站**——现在删就是不可逆。
   */
  resolveConflict: (keep: "mine" | "server") => Promise<void>;
  /** 放弃本地改动、按服务端最新内容重新打开 */
  reloadSelected: () => Promise<void>;
  /** 同步跑完后按本地库的真实状态重算编辑器的保存态 */
  refreshEditorState: () => Promise<void>;
}

export function useNotesWorkspace(
  options: {
    onLocalWrite?: () => void;
    /**
     * 隐私门禁（M3-5）：列表过滤要用；由 `App` 从隐私锁组装层传进来。
     *
     * **必须是稳定引用**（`usePrivacyLock` 返回的 `gate` 是 memo 过的）：它会进 `items` 的
     * `useMemo` 依赖，每次新建对象都会让列表每渲染重算（`notes-hook` 有用例钉住这一点）。
     */
    gate: PrivacyGate;
  },
): NotesWorkspace {
  const [allItems, setAllItems] = useState<LocalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [initialBody, setInitialBody] = useState("");
  /**
   * 已到位的正文版本（`null` = 还没成功打开过任何条目，此时 `selectedId` 也是 null）。
   * `id` + `epoch` 一起给界面用：前者判"当前选中项的正文到了没"，后者当重载信号（见 `docEpoch`）。
   */
  const [docVersion, setDocVersion] = useState<{ id: string; epoch: number } | null>(null);
  /**
   * **正在打开的那一篇**（B 步：把"选中"与"读正文"解耦）。
   *
   * 为什么是**独立的**一个标记、而不是从"`selectedId` 与 `docVersion` 不一致"推出来：
   * 那样必须在读完正文**之前**就抬 `selectedId`，而它在笔记页所在的整棵树里是"列表选中项"——
   * 抬它会让**整张列表（2000 行）连同 App 整棵树多提交一次**。实测（隔离环境 + 真实 Chrome，
   * 2000 篇、dev 构建）：缓存命中路径中位从 72ms 涨到 250ms，而正文本来只要 1–5ms 就到。
   *
   * 所以早反馈由**正文区占位**承担（那次提交很便宜：列表 props 全不变，`NoteList` 被 `memo` 跳过），
   * `selectedId` 与正文在同一次提交里落地——缓存命中路径回到"一次提交"。
   */
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<NoteEditorSnapshot | null>(null);
  const [view, setView] = useState<NotesView>(DEFAULT_VIEW);
  const [folders, setFolders] = useState<LocalFolder[]>([]);
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [memos, setMemos] = useState<LocalItem[]>([]);
  const [memoContents, setMemoContents] = useState<Record<string, MemoContent>>({});
  /**
   * 打开着的这条是否被别的标签页改过（事前提示；M2-9）
   */
  const [remoteChanged, setRemoteChanged] = useState(false);
  /** 打开着的这条的冲突副本（M2-9 对比 UI）：`null` = 没有冲突 */
  const [conflictCopy, setConflictCopy] = useState<{ copyId: string; copyTitle: string } | null>(
    null,
  );

  const editorRef = useRef<NoteEditorController | null>(null);
  useNoteEditingSession(editorRef);
  /**
   * 当前"显示的这一篇"的 id（`open` 阶段 1 落，供 `notifyUploaded` 判定回调归属）：
   * 编辑器回调可能迟到，上一篇的迟到回调不该改掉这一篇的打开基准（见 `notifyUploaded`）。
   */
  const editorIdRef = useRef<string | null>(null);
  const gate = options.gate;

  /**
   * **身份稳定化（2026-09-27 性能修复）**：下面这些值此前直接来自 `options` / state，
   * 于是 `refresh` / `open` / `changeTitle` / `createNote` / `patchItem` 的身份**每次渲染、每次选中都变**，
   * 进而让笔记列表的 `NoteRow.memo` 全部失效 —— 2000 篇的库里每次交互都是一条 130–230ms 的主线程长任务
   * （用户反馈的"切换笔记很卡"）。
   *
   * 做法：读写频繁变化的值走 ref（渲染仍用 state），对外的回调只依赖 ref 与其它已稳定的回调：
   * - `options.onLocalWrite` 常是内联箭头（`App` 就是这样）：经 ref 转发成恒定的 `notifyLocalWrite`；
   * - `selectedId` / `initialBody`：写 state 的同一步也写 ref（见 `open` 与 `notifyUploaded`）。
   *
   * **纪律**：这两个 ref 只允许在"打开条目"与"自己保存成功"两处更新，别处一律读 ref。
   * 漏一处会出现"读到上一篇"的错，`test/notes-hook.test.tsx` 的连续性用例盯这一点。
   */
  const onLocalWriteRef = useRef(options.onLocalWrite);
  const selectedIdRef = useRef<string | null>(null);
  const initialBodyRef = useRef("");

  useEffect(() => {
    onLocalWriteRef.current = options.onLocalWrite;
  }, [options.onLocalWrite]);

  /** 稳定的"本地写入"通知：转发给最新的 `options.onLocalWrite`（写成功后叫醒同步引擎） */
  const notifyLocalWrite = useCallback(() => {
    onLocalWriteRef.current?.();
  }, []);

  /** 选中项：state 与 ref 同步写（state 供渲染，ref 供回调，避免回调身份随之变化） */
  const applySelectedId = useCallback((id: string | null) => {
    selectedIdRef.current = id;
    setSelectedId(id);
  }, []);

  /** 打开这一篇时的正文本基（跨标签页提示比对用） */
  const applyInitialBody = useCallback((body: string) => {
    initialBodyRef.current = body;
    setInitialBody(body);
  }, []);

  /**
   * 冲突提示的取值（M2-9 对比 UI）：按本地 `conflicts` 关联算出"当前条目有没有副本"。
   * `refresh` 与 `open` 都会调它——打开一条有副本的笔记时就该看见提示。
   */
  const syncConflictState = useCallback(async (id: string | null) => {
    if (id === null) {
      setConflictCopy(null);
      return;
    }
    const conflict = await findConflictForOriginal(id);
    if (!conflict) {
      setConflictCopy(null);
      return;
    }
    const copy = await getLocalItem(conflict.copy_id);
    setConflictCopy({ copyId: conflict.copy_id, copyTitle: copy?.title ?? "冲突副本" });
  }, []);

  /** 内容没变就不要替换数组：每次同步都塞新数组会让下游依赖无谓地变身份 */
  const refresh = useCallback(async () => {
    const [rows, folderRows, counts, bodySummaries, memoRows, memoBodies] = await Promise.all([
      listLocalItems(),
      listLocalFolders(),
      countItemsByFolder(),
      listItemSummaries(),
      listLocalMemos(),
      listMemoContents(),
    ]);
    // 搜索索引按 sync_seq 增量重建（同步后 / 本地写入后各跑一次，代价只落在变了的条目上）
    await refreshSearchIndex();
    setAllItems((previous) => (sameItems(previous, rows) ? previous : rows));
    setFolders(folderRows);
    setFolderCounts(counts);
    setSummaries(bodySummaries);
    setMemos((previous) => (sameItems(previous, memoRows) ? previous : memoRows));
    setMemoContents(memoBodies);

    /**
     * 跨标签页改动的事前提示（M2-9）：基准是**打开这条时的正文**。
     * 两个标签页共用同一个 IndexedDB，所以别处保存后本地缓存正文就变了——一比就知道。
     * 自己保存成功后会把基准跟着更新（见 `notifyUploaded`），因此不会误报成"别处改的"。
     *
     * 读的是 ref（不是 state）：这样 `refresh` 的身份不随选中项变化，列表行的 `memo` 才守得住。
     */
    const current = selectedIdRef.current;
    if (current !== null) {
      const cached = await getCachedBody(current);
      if (cached && cached.body !== initialBodyRef.current) setRemoteChanged(true);
    }
    // 冲突提示：`refresh` 与 `open` 都要算（打开一条有副本的笔记时就该看见）
    await syncConflictState(current);
  }, [syncConflictState]);

  // 首次加载：setState 放在 then 回调里，不在 effect 体内同步触发（react-hooks/set-state-in-effect）
  useEffect(() => {
    let alive = true;
    void listLocalItems().then((rows) => {
      if (!alive) return;
      setAllItems(rows);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 正文按需取（M1 既定行为，2026-09-27 补）。
   *
   * 本地库只是缓存：新设备 / 清过本地库 / 很久没打开的那一篇，正文不在本机。
   * 此前打开这类笔记会看到**空白编辑器**，一编辑就和服务端的正文撞成冲突副本。
   *
   * 三条纪律：
   * 1. **离线不试**（`navigator.onLine === false`）：省一次必然失败的请求，
   *    也让"离线打开没缓存的笔记"表现为"暂时看不到正文"而不是转圈；
   * 2. **任何失败都返回 null**（404 / 403 / 网络错）：取不到就保持空正文、照常可编辑——
   *    把错误抛进 `load()` 会让这一篇直接打不开，那更糟；
   * 3. 取到就写进正文缓存（`putCachedBody` 由模型层负责），下次打开不再发请求。
   */
  const fetchBodyFromServer = useCallback(
    async (itemId: string): Promise<{ body: string; rev: number; contentHash: string } | null> => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
      try {
        /*
          **不带 `knownHash`**：这是一次"本地没有"的补拉，要的就是字节本身。
          带了的话服务端可能回 304（它以为我们有），结果还是空正文。
          `rev` 用本地元数据里的值——正文端点只回正文与 ETag，版本号在条目元数据里。
        */
        const remote = await itemsApi.getBody(itemId);
        if (!remote) return null;
        const item = await getLocalItem(itemId);
        return { body: remote.body, rev: item?.rev ?? 0, contentHash: remote.contentHash };
      } catch {
        return null;
      }
    },
    [],
  );

  const open = useCallback(
    async (id: string) => {
      /*
        —— 阶段 1：**同步**给"点到了"的反馈，不发任何 await ——

        只抬 `openingId`（正文区换"正在打开…"占位）。**故意不在这里抬 `selectedId`**：
        它是整张列表的选中项，抬它会让列表与 App 整棵树多提交一次；而正文通常 1–5ms 就到，
        那次提交纯属白花（实测缓存命中路径 72ms → 250ms）。选中项与正文在同一次提交里落地。
      */
      editorRef.current?.stop();
      editorRef.current = null; // 旧控制器立即失效：这一帧旧正文区正在卸载，避免它的回调写进新条目
      setOpeningId(id);
      setRemoteChanged(false);
      setConflictCopy(null); // 上一篇的冲突提示不该残留到这一篇

      // —— 阶段 2：异步读正文；读完再做"是否已被更晚的点击取代"的检查 ——
      const editor = createNoteEditor({
        itemId: id,
        notifySync: notifyLocalWrite,
        onSnapshot: setSnapshot,
        // 正文按需取（M1 既定行为）：本地缓存缺失时去服务端取一次
        fetchBody: fetchBodyFromServer,
      });
      editorRef.current = editor;
      editorIdRef.current = id; // 供 notifyUploaded 判定"这个回调属于当前显示的这一篇"
      const body = await editor.load();
      if (editorRef.current !== editor) {
        editor.stop();
        return; // 已被更晚的 open 取代：不写基准、不落选中、不启动
      }
      // initialBody 就是"打开时的基准"（跨标签页提示用它比对），所以这里必须先设
      applyInitialBody(body);
      applySelectedId(id);
      setDocVersion((previous) => ({ id, epoch: (previous?.epoch ?? 0) + 1 }));
      // 只清"自己这一次"的占位：更晚的 open 已经抬起新的 openingId 时不要动它
      setOpeningId((previous) => (previous === id ? null : previous));
      await syncConflictState(id);
      if (editorRef.current !== editor) return;
      editor.start();
    },
    [
      applyInitialBody,
      applySelectedId,
      notifyLocalWrite,
      syncConflictState,
      fetchBodyFromServer,
    ],
  );

  /** 创建类动作：新建笔记 / 新建文件夹（M3-6 起在 `useNoteCreation` 里）；v0.6.16 加导入笔记与新建表格 */
  const creation = useNoteCreation({
    folders,
    view,
    refresh,
    open,
    setView,
    onLocalWrite: notifyLocalWrite,
  });

  /** 放弃本地改动、按最新内容重新打开（跨标签页提示里的"重新载入"） */
  const reloadSelected = useCallback(async () => {
    const current = selectedIdRef.current;
    if (!current) return;
    await refresh();
    await open(current);
  }, [open, refresh]);

  /** 打开冲突副本（对照看用） */
  const openConflictCopy = useCallback(async () => {
    if (!conflictCopy) return;
    await open(conflictCopy.copyId);
  }, [conflictCopy, open]);

  /** 处理冲突：把选中的那一份定为原条目的内容（或什么都不改），并清掉关联 */
  const resolveConflict = useCallback(
    async (keep: "mine" | "server") => {
      const conflict = conflictCopy;
      const selectedId = selectedIdRef.current;
      if (!selectedId || !conflict) return;

      if (keep === "mine") {
        const item = await getLocalItem(selectedId);
        const draft = await getDraft(conflict.copyId);
        const body = draft?.body ?? (await getCachedBody(conflict.copyId))?.body ?? "";
        if (item && body !== "") {
          // 写回原条目：走草稿 + 入队，等于"把副本的内容当成这一条的新版本"
          await saveDraft(selectedId, body, Date.now());
          await enqueueBodySave(selectedId, item.rev, Date.now());
          await db.items.update(selectedId, { updated_at: Date.now() });
        }
      }

      await clearConflict(conflict.copyId);
      await refresh();
      notifyLocalWrite();
    },
    [conflictCopy, notifyLocalWrite, refresh],
  );

  /**
   * 改标题（数据层动作见 `features/notes/actions.ts`：md 顶层 `title:` + 派生列一起写）。
   *
   * 2026-09-28 性能修复：此前这里每次都 `await refresh()`（6 张表 + 全量正文摘要 +
   * 搜索索引重扫），而输入框受控在 `allItems` 里那份标题上 —— 一次按键 = 一次全库扫描 +
   * 一次异步回灌，晚到的按键被旧值按回去。实测（808 条、60ms/字）**10 个字只剩 1 个**，
   * 并伴随 294ms 主线程长任务。
   *
   * 现在改成**轻提交**：写库 + 入队 + **就地更新列表里那一行**（标题与 `pending`），
   * 不再跑全量 `refresh()`。提交节奏由 `TitleInput` 的防抖控制（空闲 400ms / 失焦 / 卸载）。
   */
  const changeTitle = useCallback(
    async (title: string) => {
      const selectedId = selectedIdRef.current;
      if (!selectedId) return;
      // 写入本身在 actions 里（md + 派生列 + 两个 outbox），这里只管列表那一行
      if (!(await writeItemTitle(selectedId, title))) return;
      /*
        就地更新那一行：字段与"下一次 refresh 会读到的"保持一致——
        写入会把条目标成 `pending: "patch_meta"`，列表行据此显示"待上传"，
        所以这里必须一起带上，否则状态会与库里的真实状态不一致。
      */
      setAllItems((previous) =>
        previous.map((row) =>
          row.id === selectedId ? { ...row, title, pending: "patch_meta" } : row,
        ),
      );
      notifyLocalWrite();
    },
    [notifyLocalWrite],
  );

  const items = useMemo(() => filterByView(allItems, view, gate), [allItems, view, gate]);
  const tags = useMemo(() => collectTags(allItems), [allItems]);
  /**
   * 当前打开的条目（正文区渲染它）。
   *
   * **不能从 `items`（当前视图过滤后的列表）里找**：左侧笔记本树里可以直接点开任意一篇，
   * 而那一篇未必属于此刻的视图（例如停在「工作」视图里点开了「私事」下的文档，或视图是
   * 最近编辑 / 收藏 / 标签）。此前 `items.find(...)` 会因此返回 `null` → 正文区退回空占位，
   * 用户点了树里的文档却"看不到正文，得再点一次"（用户 2026-10-01 反馈，问题 4）。
   *
   * 门禁仍然要守：只把**此刻允许出现在列表里**的条目当作可打开（空间未解锁、回收站里的条目
   * 一律为 `null`，正文区照旧给占位），口径与列表过滤同一处 `canShowInList`。
   */
  const selected = useMemo(() => {
    if (selectedId === null) return null;
    const item = allItems.find((row) => row.id === selectedId);
    if (!item) return null;
    return canShowInList(item, gate) ? item : null;
  }, [allItems, gate, selectedId]);
  /**
   * "正文还没到"：由**显式的 `openingId`** 决定，而不是"`selectedId` 与 `docVersion` 不一致"——
   * 后者要求在读完正文前就抬 `selectedId`，会让整张列表多提交一次（见 `openingId` 的注释）。
   * 正文到位的那次提交里 `openingId` 被清掉、`selectedId` 与正文同时落地，界面不会闪两次。
   */
  const docLoading = openingId !== null;
  const docEpoch = docVersion?.epoch ?? 0;

  /**
   * **按文件夹分好组的条目**（B2 批）：左侧笔记本树"显示条目"用。算法在 `groups.ts` 的纯函数里
   * （那里有单测）；`useMemo` 保证身份稳定——它会进 `FolderTree` 的 props，新建对象就会让整棵树重渲染。
   */
  const itemsByFolder = useMemo(() => indexItemsByFolder(allItems), [allItems]);

  /** 列表头标题（`viewTitle` 是纯函数，不认识文件夹数据） */
  const title = useMemo(() => {
    if (view.kind === "notebook" && view.folderId) {
      const folder = folders.find((row) => row.id === view.folderId);
      if (folder) return folder.name;
    }
    return viewTitle(view);
  }, [folders, view]);

  /** 层级路径（`工作 › 本周`）：算法在 `views.ts` 的纯函数 `viewPathOf` 里，有单测 */
  const viewPath = useMemo(() => viewPathOf(view, folders), [folders, view]);

  /**
   * Memo 的发布与编辑（M2-5 / Q19）：**拆到 `features/memos/useMemoWrite.ts`**——
   * 本程的身份稳定化改动把 500 行预算顶到了线，按仓库既有做法（`useNoteCreation` /
   * `useVaultScope` / `useItemPatchActions` 都是这么拆的）按子资源拆出去，行为一字未改。
   */
  const { publishMemo, updateMemo } = useMemoWrite({ refresh, onLocalWrite: notifyLocalWrite });

  const renameFolder = useCallback(
    async (folderId: string, name: string) => {
      await renameLocalFolder(folderId, name, Date.now());
      await refresh();
      notifyLocalWrite();
    },
    [notifyLocalWrite, refresh],
  );

  const moveFolder = useCallback(
    async (folderId: string, parentId: string | null) => {
      const parent = parentId === null ? null : (folders.find((row) => row.id === parentId) ?? null);
      const depth = folderDepthFor(parent);
      if (depth > MAX_FOLDER_DEPTH) {
        throw new Error(`最多支持 ${MAX_FOLDER_DEPTH} 层文件夹`);
      }
      await moveLocalFolder(folderId, parentId, depth, Date.now());
      await refresh();
      notifyLocalWrite();
    },
    [folders, notifyLocalWrite, refresh],
  );

  /** 条目的元数据补丁动作（M3-8 起在 `useItemPatchActions` 里） */
  const {
    patchItem,
    moveItemToFolder,
    setItemEncryption,
    togglePinned,
    toggleStarred,
    degradeToNote,
  } =
    useItemPatchActions({ refresh, onLocalWrite: notifyLocalWrite });

  /** 加密空间的作用域（M3-6）：派生值与空间内新建都在 `useVaultScope` 里 */
  const vaultScope = useVaultScope({
    folders,
    folderCounts,
    allItems,
    refresh,
    open,
    setView,
    patchItem,
    onLocalWrite: notifyLocalWrite,
  });

  /**
   * **必须 memo**：返回值身份不稳定会让调用方的 effect 依赖（如 App 里启动同步引擎的 effect）
   * 每次渲染都变化 → 引擎被反复 stop/create/start → 请求风暴（M1-11 实测：10 秒 35 次 sync）。
   */
  return useMemo<NotesWorkspace>(
    () => ({
      items,
      allItems,
      loading,
      view,
      viewTitle: title,
      viewPath,
      itemsByFolder,
      setView,
      tags,
      selectedId,
      selected,
      folders,
      folderCounts,
      notebookFolders: vaultScope.notebookFolders,
      notebookCounts: vaultScope.notebookCounts,
      vault: vaultScope.vault,
      createNoteInVault: vaultScope.createNoteInVault,
      createVaultFolder: vaultScope.createVaultFolder,
      summaries,
      initialBody,
      docLoading,
      docEpoch,
      snapshot,
      refresh,
      open,
      ...creation,
      changeTitle,
      memos,
      memoContents,
      publishMemo,
      updateMemo,
      renameFolder,
      moveFolder,
      moveItemToFolder,
      moveItemToVault: vaultScope.moveItemToVault,
      moveItemOutOfVault: vaultScope.moveItemOutOfVault,
      moveFolderToVault: vaultScope.moveFolderToVault,
      moveFolderOutOfVault: vaultScope.moveFolderOutOfVault,
      togglePinned,
      toggleStarred,
      setItemEncryption,
      degradeToNote,
      remoteChanged,
      conflictCopy,
      openConflictCopy,
      resolveConflict,
      reloadSelected,
      input: (text: string) => editorRef.current?.onInput(text),
      notifyUploaded: () => {
        editorRef.current?.notifyUploaded();
        const id = editorIdRef.current;
        // 迟到的回调可能来自上一篇：只在"上传的就是当前显示的这篇"时更新基准与清提示
        if (id !== null && id === selectedIdRef.current) {
          // 自己保存成功不是"别处改的"：把基准跟到自己刚写下的内容，并清掉提示（state 与 ref 同步）
          void getDraft(id).then((draft) => {
            if (draft && id === selectedIdRef.current) applyInitialBody(draft.body);
          });
          setRemoteChanged(false);
        }
      },
      notifyFailed: () => editorRef.current?.notifyFailed(),
      notifyConflict: () => editorRef.current?.notifyConflict(),
      refreshEditorState: () => editorRef.current?.refreshState() ?? Promise.resolve(),
    }),
    [
      allItems,
      applyInitialBody,
      changeTitle,
      creation,
      docEpoch,
      docLoading,
      folderCounts,
      folders,
      initialBody,
      items,
      loading,
      memos,
      memoContents,
      moveItemToFolder,
      degradeToNote,
      open,
      publishMemo,
      refresh,
      reloadSelected,
      remoteChanged,
      conflictCopy,
      openConflictCopy,
      resolveConflict,
      renameFolder,
      moveFolder,
      selected,
      selectedId,
      setItemEncryption,
      snapshot,
      summaries,
      tags,
      title,
      togglePinned,
      toggleStarred,
      updateMemo,
      view,
      viewPath,
      itemsByFolder,
      vaultScope,
    ],
  );
}
