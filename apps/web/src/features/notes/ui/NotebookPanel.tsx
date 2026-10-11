/**
 * 笔记本面板（功能栏里的笔记本分组；components.md 的 `NotebookGroup` + `FolderTree` +
 * `NbAddButton` 三个名字在这里组合成一块，由 `App` 作为插槽交给 `FnBar`）。
 *
 * 为什么整块放在 features 而不是 app：功能栏是通用容器（app 层），而"文件夹"是 notes 这个
 * feature 的数据；`app/` 不反向依赖 feature（架构 §2.3.3 的依赖方向）。
 *
 * 四个交互：
 * 1. **新建**：`+` 菜单 → 树顶插一行输入框，Enter 确认 / Esc 取消 / 空名不创建；
 *    选中第 2 层时新夹建在**它的父层**，因此界面上不可能产生第 3 层。
 * 2. **重命名**：弹窗输入（走 `meta_rev`，多设备并发改名以后写为准、不生成冲突副本 —— Q12）。
 * 3. **移动到…**：弹窗列出候选目标，**非法目标置灰并写明原因**（移到自己子夹、会超过两层、
 *    下面还有子文件夹），与服务端校验口径一致。
 * 4. 计数与 `待上传` 标记直接来自本地状态。
 */
import { useRef, useState } from "react";
import type { LocalFolder, LocalItem } from "../../../data/db";
import { progressLabel, type BatchProgress, type BatchResult } from "../batch";
import { Icon } from "../../../app/ui/Icon";
import { Button } from "../../../app/ui/Controls";
import { Modal } from "../../../app/ui/Modal";
import { NavItem } from "../../../app/ui/NavItem";
import type { TableDoc } from "@menote/mdcore";
import { emptyTableDoc } from "../../tables/model";
import { TableColumnManager } from "../../tables/ui/TableColumnManager";
import { FolderTree } from "./FolderTree";
import { FolderRenameModal } from "./FolderRenameModal";
import { ImportNotesFlow, type ImportNotesFlowHandle } from "./ImportNotesFlow";
import { NbAddButton } from "./NbAddButton";
import { canCreateChildFolder, folderMoveTargets, type MoveTarget } from "../folders";
import type { ImportNotesSummary } from "../import-md";
import type { PropLibraryEntry } from "../../props/model";
import type { NotesView } from "../views";

export interface NotebookPanelProps {
  view: NotesView;
  onViewChange: (view: NotesView) => void;
  folders: readonly LocalFolder[];
  counts: Readonly<Record<string, number>>;
  onCreateFolder: (name: string, parentId: string | null) => Promise<void>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onMoveFolder: (folderId: string, parentId: string | null) => Promise<void>;
  /**
   * 整夹移入 / 移出加密空间（M3-8）。动作返回**失败清单**（逐条独立判定，不做全成功或全失败），
   * 面板负责显示进度与失败清单，并提供「重试」。
   */
  vault?: {
    enabled: boolean;
    locked: boolean;
    isInVault: (folder: LocalFolder) => boolean;
    canMoveIn: (folder: LocalFolder) => boolean;
    moveInReason?: string;
    onMoveIn: (
      folder: LocalFolder,
      onProgress: (progress: BatchProgress) => void,
    ) => Promise<BatchResult<LocalItem>>;
    onMoveOut: (
      folder: LocalFolder,
      onProgress: (progress: BatchProgress) => void,
    ) => Promise<BatchResult<LocalItem>>;
  };
  /**
   * 删除文件夹（M4-12）：**只报事件**，确认框与实时计数在这里给（同一个面板能看到 folders/counts）。
   */
  onDeleteFolder?: (folder: LocalFolder) => void | Promise<void>;
  /**
   * **树里列出条目**（B2 批；用户 2026-09-28 拍板做成设置项、默认关）：开关、按文件夹分好组的
   * 条目、点开条目的动作。三项一起给才会列条目（见 `FolderTree`；**加密空间那棵树永远不给**）。
   */
  showItems?: boolean;
  itemsByFolder?: Readonly<Record<string, LocalItem[]>>;
  onOpenItem?: (itemId: string) => void;
  /** 正文区当前打开的那一篇（树里给这一行选中底色；2026-10-01 问题 5） */
  selectedItemId?: string | null;
  /**
   * 导入本地 `.md`（v0.6.16）。落点由 workspace 侧按当前选中的笔记本算（与新建笔记同一条路径），
   * 面板只把文件递过去、把结果说出来。
   *
   * **必填**而不是可选：菜单项是固定三项，缺了实现就会出现"点了没反应"的空按钮
   * （`DESIGN.md` §6.1）。
   */
  onImportNotes: (files: readonly File[]) => Promise<ImportNotesSummary>;
  /**
   * 属性库（2026-10-11 设计 §6.3）：导入流程的**录入步**要这两项才出现。
   * 缺省 = 不做这一步（老调用点与用例不必补参数）——它是加分项，不该成为导入路径上的新堵点。
   */
  propLibrary?: readonly PropLibraryEntry[];
  onLearnProps?: (next: PropLibraryEntry[]) => void;
  /**
   * 新建表格（v0.6.16）：**先在面板里定列结构**，定完才建条目。给的是渲染好的表格文档。
   * 取消定义 = 不建（`TableColumnManager` 的 `mode="create"` 不可点遮罩关闭，只能「创建表格」或「取消」）。
   */
  onCreateTable: (doc: TableDoc) => Promise<unknown>;
}

export function NotebookPanel({
  view,
  onViewChange,
  folders,
  counts,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  vault,
  onDeleteFolder,
  showItems = false,
  itemsByFolder,
  onOpenItem,
  selectedItemId = null,
  onImportNotes,
  onCreateTable,
  propLibrary,
  onLearnProps,
}: NotebookPanelProps) {
  const [creatingIn, setCreatingIn] = useState<{ parentId: string | null } | null>(null);
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState<LocalFolder | null>(null);
  const [moving, setMoving] = useState<{ folder: LocalFolder; targets: MoveTarget[] } | null>(null);
  /** 待确认删除的文件夹（M4-12）：确认框里的计数要**实时算**，不是固定文案 */
  const [deleting, setDeleting] = useState<LocalFolder | null>(null);
  /** 整夹移入/移出的进度与失败清单（M3-8）：进度显示"处理中 12 / 40" */
  const [batch, setBatch] = useState<{
    folder: LocalFolder;
    direction: "in" | "out";
    progress: BatchProgress | null;
    failures: BatchResult<LocalItem>["failures"];
  } | null>(null);
  /** 正在定义列结构（新建表格的中间态；非 null 即弹 `TableColumnManager`） */
  const [definingColumns, setDefiningColumns] = useState<TableDoc | null>(null);
  /** 菜单项在 `DropdownMenu` 里，文件选择器在 `ImportNotesFlow` 里，靠 ref 把两者接上 */
  const importRef = useRef<ImportNotesFlowHandle | null>(null);

  async function runFolderMove(folder: LocalFolder, direction: "in" | "out"): Promise<void> {
    const action = direction === "in" ? vault?.onMoveIn : vault?.onMoveOut;
    if (!action) return;

    setBatch({ folder, direction, progress: { done: 0, total: 0 }, failures: [] });
    try {
      const result = await action(folder, (progress) => {
        setBatch((current) => (current ? { ...current, progress } : current));
      });
      setBatch((current) =>
        current ? { ...current, progress: null, failures: result.failures } : current,
      );
    } catch (error) {
      // 整夹动作整体失败（没启用隐私锁、空间行缺失等）：当作一条失败显示，仍可重试
      setBatch((current) =>
        current
          ? {
              ...current,
              progress: null,
              failures: [
                {
                  // 失败清单里只需要一个可读的名字
                  item: { id: folder.id, title: folder.name } as LocalItem,
                  reason: error instanceof Error ? error.message : "操作失败",
                },
              ],
            }
          : current,
      );
    }
  }

  const selectedFolderId = view.kind === "notebook" ? (view.folderId ?? null) : null;
  const totalCount = Object.values(counts).reduce((sum, value) => sum + value, 0);

  /**
   * 导入落点的名字（确认框与结果里给用户看）。
   *
   * **非笔记本视图（最近编辑 / 收藏 / 标签）没有笔记本上下文，导入落根目录**——
   * 与 `useNoteCreation.resolveTarget` 同一口径，所以这里显示"根目录"而不是当前视图名，
   * 免得用户以为进了"最近编辑"（那不是一个能落东西的地方）。
   */
  const importTargetLabel =
    (selectedFolderId !== null
      ? folders.find((folder) => folder.id === selectedFolderId)?.name
      : undefined) ?? "根目录";

  /** 新建位置：选中的是第 1 层 → 建在它下面（第 2 层）；选中的是第 2 层 → 建在它的父层 */
  function beginCreate(parent: LocalFolder | null): void {
    if (parent && !canCreateChildFolder(parent)) {
      setCreatingIn({ parentId: parent.parent_id });
    } else {
      setCreatingIn({ parentId: parent?.id ?? null });
    }
    setDraftName("");
  }

  async function confirmCreate(): Promise<void> {
    const name = draftName.trim();
    const parentId = creatingIn?.parentId ?? null;
    setCreatingIn(null);
    setDraftName("");
    if (name === "") return;
    await onCreateFolder(name, parentId);
  }

  return (
    <div className="fnbar__group">
      <div className="nb-head">
        <NavItem
          label="笔记本"
          icon="folder"
          count={totalCount}
          active={view.kind === "notebook" && selectedFolderId === null}
          onClick={() => onViewChange({ kind: "notebook", folderId: null })}
        />
        <NbAddButton
          onCreateFolder={() =>
            beginCreate(folders.find((folder) => folder.id === selectedFolderId) ?? null)
          }
          onCreateTable={() => setDefiningColumns(emptyTableDoc())}
          onImportNotes={() => importRef.current?.open()}
        />
      </div>

      {creatingIn ? (
        <div className="tree__new">
          <input
            className="tree__input"
            aria-label="新文件夹名称"
            value={draftName}
            autoFocus
            placeholder="文件夹名称"
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void confirmCreate();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setCreatingIn(null);
                setDraftName("");
              }
            }}
            onBlur={() => {
              void confirmCreate();
            }}
          />
        </div>
      ) : null}

      {/*
        空态（B2 批）：此前"没建过文件夹"时这里是**一片空白**——只有 `+` 一个入口，
        用户反馈的"笔记本里没有文件夹和文件树"最直接的原因就是它。
        现在给一行说明 + 一个可见的「新建文件夹」入口（`+` 仍然在）。
      */}
      {folders.length === 0 ? (
        <div className="tree-empty">
          <span>还没有文件夹</span>
          <Button variant="secondary" size="sm" onClick={() => beginCreate(null)}>
            <Icon name="plus" size={13} />
            新建文件夹
          </Button>
        </div>
      ) : null}

      <FolderTree
        folders={folders}
        selectedId={selectedFolderId}
        counts={counts}
        onSelect={(folderId) => onViewChange({ kind: "notebook", folderId })}
        onRename={(folder) => setRenaming(folder)}
        onMove={(folder) => setMoving({ folder, targets: folderMoveTargets(folders, folder.id) })}
        onCreateChild={(folder) => beginCreate(folder)}
        onDelete={onDeleteFolder ? (folder) => setDeleting(folder) : undefined}
        showItems={showItems}
        itemsByFolder={itemsByFolder}
        onOpenItem={onOpenItem}
        selectedItemId={selectedItemId}
        vault={
          vault
            ? {
                enabled: vault.enabled,
                locked: vault.locked,
                isInVault: vault.isInVault,
                canMoveIn: vault.canMoveIn,
                moveInReason: vault.moveInReason,
                onMoveIn: (folder) => void runFolderMove(folder, "in"),
                onMoveOut: (folder) => void runFolderMove(folder, "out"),
              }
            : undefined
        }
      />

      {batch?.progress ? (
        <div className="setrow__desc" role="status">
          {batch.direction === "in" ? "移入" : "移出"}「{batch.folder.name}」：
          {progressLabel(batch.progress)}
        </div>
      ) : null}

      {batch && batch.progress === null && batch.failures.length > 0 ? (
        <div className="banner banner--warn" role="status">
          <span>
            {batch.failures.length} 条没能处理：{batch.failures[0]?.reason}
            {batch.failures.length > 1 ? `（共 ${batch.failures.length} 条）` : ""}
          </span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => void runFolderMove(batch.folder, batch.direction)}
          >
            重试
          </button>
        </div>
      ) : null}

      {renaming ? (
        <FolderRenameModal
          key={renaming.id}
          folder={renaming}
          onClose={() => setRenaming(null)}
          onRename={onRenameFolder}
        />
      ) : null}

      <Modal
        open={moving !== null}
        title="移动文件夹"
        desc={moving ? `把「${moving.folder.name}」移到：` : undefined}
        onClose={() => setMoving(null)}
      >
        <div className="target-list">
          {(moving?.targets ?? []).map((target) => (
            <button
              key={target.parentId ?? "root"}
              type="button"
              className="target-list__item"
              disabled={!target.allowed}
              title={target.allowed ? undefined : target.reason}
              onClick={() => {
                setMoving(null);
                if (moving) void onMoveFolder(moving.folder.id, target.parentId);
              }}
            >
              <Icon name={target.parentId ? "folder" : "home"} size={13} />
              {target.name}
              {target.allowed ? null : <span className="nav-item__count">{target.reason}</span>}
            </button>
          ))}
        </div>
      </Modal>

      {/*
        删除文件夹的确认框（M4-12；界面稿 §6.6 第 3 行）：**数量必须实时算**——
        "N 条内容、M 个子文件夹"是当前事实，写死文案在删除前后会对不上。
      */}
      <Modal
        open={deleting !== null}
        title="删除文件夹"
        desc={
          deleting
            ? `「${deleting.name}」及其中 ${folderContentCount(folders, counts, deleting.id)} 条内容、${childFolderCount(folders, deleting.id)} 个子文件夹将移入回收站，保留 30 天。`
            : undefined
        }
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                const folder = deleting;
                setDeleting(null);
                if (folder) void onDeleteFolder?.(folder);
              }}
            >
              移入回收站
            </Button>
          </>
        }
      >
        <p>原路径会保留；恢复时如果原文件夹已不在，内容会回到根目录。</p>
      </Modal>

      {/* 导入笔记（v0.6.16）：文件选择器藏在 `ImportNotesFlow` 里，由 `+` 菜单的 ref 唤起 */}
      <ImportNotesFlow
        ref={importRef}
        targetLabel={importTargetLabel}
        onImport={onImportNotes}
        library={propLibrary}
        onLearn={onLearnProps}
      />

      {/*
        新建表格的列定义（v0.6.16）：`mode="create"` 不可点遮罩关闭——一点外面就把刚定的列丢了，
        只能「创建表格」或「取消」。条件渲染，每次打开都是新挂载、草稿从空白起算。
      */}
      {definingColumns ? (
        <TableColumnManager
          open
          mode="create"
          doc={definingColumns}
          onCancel={() => setDefiningColumns(null)}
          onConfirm={(doc) => {
            setDefiningColumns(null);
            void onCreateTable(doc);
          }}
        />
      ) : null}
    </div>
  );
}

/** 文件夹里的条目数 = 自己直接含的 + 直接子夹含的（层级只有两层） */
function folderContentCount(
  folders: readonly LocalFolder[],
  counts: Readonly<Record<string, number>>,
  folderId: string,
): number {
  const own = counts[folderId] ?? 0;
  const children = folders.filter((folder) => folder.parent_id === folderId);
  return own + children.reduce((sum, child) => sum + (counts[child.id] ?? 0), 0);
}

function childFolderCount(folders: readonly LocalFolder[], folderId: string): number {
  return folders.filter((folder) => folder.parent_id === folderId).length;
}
