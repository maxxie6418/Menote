/**
 * 正文区（结构见 `docs/modules/Menote-M1-界面稿-v1.md` §五）。
 *
 * 编辑器与 Markdown 渲染都走**动态 import**（架构 §14.1：编辑器与渲染各自独立分包，不进首屏）。
 * 切换条目由 `key={item.id}` 重新挂载编辑器；切换编辑/预览模式**不重建文档**（架构 §3.3）。
 */
import { Suspense, lazy, useMemo, useRef, useState } from "react";
import { type EditorMode, isProductEditorMode, normalizeEditorModes } from "@menote/shared";
import { EmptyDocPanel } from "../../../app/workarea/EmptyDocPanel";
import { Button } from "../../../app/ui/Controls";
import { Modal } from "../../../app/ui/Modal";
import { DropdownMenu } from "../../../app/ui/Menu";
import { LockedDocPanel } from "../../privacy/ui/LockedDocPanel";
import type { LocalItem } from "../../../data/db";
import { initialEditorMode, writeLastEditorMode } from "../editor-mode";
import type { NoteEditorSnapshot } from "../model";
import { DocStatusBar } from "./DocStatusBar";
import { buildMoreMenuItems } from "./moreMenuItems";
import { ItemProps, shouldShowItemProps } from "./ItemProps";
import { useItemProps } from "../useItemProps";
import { TitleInput } from "./TitleInput";
import { TableDegradeNotice } from "../../tables/ui/TableDegradeNotice";
import { useTableDoc } from "../../tables/useTableDoc";
import { renderTableDocument } from "@menote/mdcore";
import type { EditorHandle } from "../../../app/editor/Editor";

const Editor = lazy(async () => {
  const mod = await import("../../../app/editor/Editor");
  return { default: mod.Editor };
});

/** 表格界面按需加载（与编辑器同一理由：不进首屏；表格只有表格条目才用得上） */
const TableEditor = lazy(async () => {
  const mod = await import("../../tables/ui/TableEditor");
  return { default: mod.TableEditor };
});

const MarkdownPreview = lazy(async () => {
  const mod = await import("../../../app/editor/MarkdownPreview");
  return { default: mod.MarkdownPreview };
});

/**
 * 正文区这一档的取值，与设置契约**同一个联合类型**（`DocMode` 只是本组件的别名）：
 * 契约里加一档时，下面的 `MODE_LABEL` 会因为缺键立刻报错，而不是界面上悄悄少一个按钮。
 *
 * 【2026-09-29 阶段 A】类型仍是四值（读兼容 + 阶段 C 复用），但**能切到哪几档由契约的产品清单
 * 决定**：`availableModes` 经 `normalizeEditorModes` 出来只剩产品档，`split` 分支已从渲染里删掉。
 */
export type DocMode = EditorMode;

const MODE_LABEL: Record<DocMode, string> = {
  split: "分屏",
  edit: "仅编辑",
  preview: "仅预览",
  // M5 首期（2026-09-28）：即时渲染——正文呈现渲染样式，光标所在行显示源码
  live: "即时渲染",
};

export interface NoteWorkspaceProps {
  item: LocalItem | null;
  initialBody: string;
  snapshot: NoteEditorSnapshot | null;
  /**
   * 打开条目时的模式**种子**：设置里的 `editor_mode`（M2-7）。
   * 2026-09-29 起它只是"本机还没记住上次用过哪一档"时的首次初始值——
   * 日常打开用的是本机记住的那一档（见 `features/notes/editor-mode.ts`）。
   */
  initialMode?: DocMode;
  /**
   * 用户在设置里**开着**的档（`editor_modes`）：正文区的切换条只列这些。
   * 缺省 = 四档全开（老调用点与用例不必逐个补参数）。
   */
  availableModes?: EditorMode[];
  /** 这条被别的标签页改过（M2-9）：显示事前提示，避免"以为没冲突" */
  remoteChanged?: boolean;
  /** 这条有冲突副本（M2-9 对比 UI）：显示处理入口 */
  conflict?: { copyId: string; copyTitle: string } | null;
  onOpenConflictCopy?: () => void;
  onResolveConflict?: (keep: "mine" | "server") => void;
  /** 放弃本地改动、按最新内容重新载入 */
  onReload?: () => void;
  onInput: (text: string) => void;
  onTitleChange: (title: string) => void;
  /**
   * 单篇加密（M3-7）。`enabled` = 隐私锁已启用（没启用就不提供加密入口，并说明原因）；
   * `encrypted` = 这一篇已加密；`unlocked` = 本次浏览器会话里已解密。
   * 锁定时正文区换成 `LockedDocPanel`，编辑器**根本不挂载**。
   */
  encryption?: {
    enabled: boolean;
    encrypted: boolean;
    unlocked: boolean;
    /** 本次已解密的单篇数量（用于「锁上全部单篇」是否可用） */
    unlockedCount: number;
    onUnlock: () => void;
    onLock: () => void;
    onToggle: (encrypted: boolean) => void;
    onLockAll: () => void;
  };
  /**
   * 状态栏里的隐私锁档位行（M3-10，设计 §9.2-④）：如"加密空间 · 已解锁 · 本次会话"。
   * `expiresAt` 供"即将自动锁定"提示用（`minutes` 档才有）。
   */
  privacyLine?: {
    text: string;
    expiresAt: number | null;
    onLock?: () => void;
    lockLabel?: string;
  } | null;
  /**
   * 删除（M4-12）：**只报事件**，二次确认由外层做（同一套确认还要给列表行用）。
   * 编辑器内**没有独立删除入口**——收在「更多」菜单里，保持正文头"只有模式切换 + 更多菜单"的不变量。
   */
  onDelete?: () => void;
  /**
   * 打开版本历史（M4-11；界面稿 §四）。**锁定态下入口整体不可用**（设计 §4.5）：
   * "列表可见、内容打码"的中间态明确不做。
   */
  onOpenVersions?: () => void;
  /**
   * 「降级为普通笔记」（M4-9）：**单向** `table → note`，服务端会先封存一个版本再改类型。
   * 组件只负责弹确认框与报事件，**不碰网络**——接线在 `NotesPane`（→ 工作区 `degradeToNote`）。
   */
  onDegrade?: () => void;
  /**
   * 单篇导出 Markdown（M15）：`includeAttachments` 决定只下 `.md` 还是连引用附件打包 zip。
   * 组件只报事件，取正文 / 打包 / 下载在 `features/backup/export-note.ts`。
   * **锁定态不可用**（与切换条同一口径）：锁定时正文都看不了，更不该导出。
   */
  onExportMarkdown?: (includeAttachments: boolean) => void;
  /**
   * 移除正文里的附件引用（M10-新 · M6 批 2b）：**只删引用，不删文件**。
   *
   * 组件只报事件并把**当前正文**一起交上去（不是打开时的快照——用户可能刚传完图还没存），
   * 弹窗与真正的改正文都在宿主那一侧（照 `onShare` / `onExportMarkdown` 的分工）。
   *
   * **辅助入口（选中附件后的常驻小工具条）没做**：`EditorHandle` 只有 `read` / `insert` /
   * `replace` / `applyFormat`，**没有选区上报**，宿主无从知道"选中了哪张图"；为此给
   * CodeMirror 加一套选区 → 图片的映射代价大、收益小，留待真有需求时再补。
   */
  onRemoveAttachmentRef?: (body: string) => void;
  /**
   * 分享（M14）：组件只报事件，创建 / 管理在 `features/shares` 的弹窗里。
   * **隐私边界**（M14-01 定稿）：单篇加密与加密空间内的内容不可分享——入口置灰并说明原因。
   */
  onShare?: () => void;
  /** 这一篇当前有生效中的分享链接（M14-01 的"公开标记"） */
  shared?: boolean;
  /** 版本历史入口为什么不可用（锁定态时给原因，`DESIGN.md` §6.1） */
  versionsDisabledReason?: string;
  /**
   * 附件上传状态（M4-10；界面稿 §7.2）：状态栏只**显示**，上传流程在 `features/attachments`。
   */
  attachments?: {
    label: string;
    tone: "busy" | "warn";
    onRetry?: () => void;
    /** 补充说明（如"上次没传完，重新选一次文件即可续传"），走 `title` 不占状态栏宽度 */
    hint?: string;
  } | null;
  /** 粘贴/拖入文件（M4-10；界面稿 §7.1）：编辑器把文件交出来，上传由调用方负责 */
  onFiles?: (files: File[]) => void;
  /** 这一篇已知的附件（`sha256 -> { size, hasThumb }`）：预览补大小、标"不可用"用 */
  attachmentsMeta?: Record<string, { size: number; hasThumb: boolean }>;
  /** 编辑器句柄（附件占位替换要用它改正文） */
  onEditorReady?: (handle: EditorHandle) => void;
  /**
   * 编辑器句柄（**由宿主传下来**，不是自己再存一份）。
   *
   * 属性卡片改完 md 要靠它把改动推进编辑器（设计稿 §6）——宿主已经为移除附件引用存了
   * 一份（`NotesPane` 的 `editorHandle`），这里再存第二份会出现两份不同步的句柄。
   */
  editorHandle?: EditorHandle | null;
  /** 属性改动失败时的提示出口（校验没过、正文已变等） */
  onPropsError?: (message: string) => void;
}

export function NoteWorkspace({
  item,
  initialBody,
  snapshot,
  initialMode,
  availableModes,
  remoteChanged = false,
  conflict = null,
  onOpenConflictCopy,
  onResolveConflict,
  onReload,
  onInput,
  onTitleChange,
  encryption,
  privacyLine,
  onDelete,
  onOpenVersions,
  onDegrade,
  onExportMarkdown,
  onRemoveAttachmentRef,
  onShare,
  shared = false,
  versionsDisabledReason,
  attachments,
  onFiles,
  attachmentsMeta,
  onEditorReady,
  editorHandle = null,
  onPropsError,
}: NoteWorkspaceProps) {
  /** 用户在设置里**开着**的档（`editor_modes`）；这里同时收口"产品允许哪几档" */
  const available = useMemo(() => normalizeEditorModes(availableModes), [availableModes]);
  /**
   * 打开这篇时用哪一档：**本机记住的"上次用的那档"优先**，其次设置里的首次初始值
   * （`editor_mode`）；两者都要"还开着"才算数。见 `features/notes/editor-mode.ts`。
   */
  const [mode, setMode] = useState<DocMode>(() => initialEditorMode(available, initialMode));

  /** 切档：顺手记进本机——"没有默认档"之后，这一档就是下次打开的依据 */
  function switchMode(next: DocMode): void {
    setMode(next);
    // 只记产品档：切换条本来就只列产品档，这里是"别把不可用的档写成用户偏好"的收口
    if (isProductEditorMode(next)) writeLastEditorMode(next);
  }

  /** 「添加附件」代点的隐藏文件输入（M4-10） */
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** 表格条目的两种形态由它决定：能解析走表格界面，解析失败走自动降级（界面稿 §2.10） */
  const isTable = item?.type === "table";
  /**
   * 实际渲染用的档：**当前档被设置关掉时**落到还开着的第一档（跨设备改设置的窗口期）。
   * 表格是例外——坏表格的「查看原文」是救援入口（`onViewSource`），那一档即使没开也要能切过去；
   * 表格本来也不渲染模式切换条，所以这里不担心"显示了没开的档"。
   *
   * 【2026-09-29 阶段 A】例外也要收在生产清单里：本机记忆里可能是老版本的 `split` / `live`
   * （表格读取时绕过了 `available`），那种值现在没有分支可渲染，统一落到 `edit`（**查看原文**的语义）。
   */
  const shownMode: DocMode = isTable
    ? isProductEditorMode(mode)
      ? mode
      : "edit"
    : available.includes(mode)
      ? mode
      : available[0]!;
  const table = useTableDoc(initialBody);
  /** 主动降级的确认框（要改 `items.type`，属 API 变更 → 待拍板，见下面 Modal 的说明） */
  const [degradeOpen, setDegradeOpen] = useState(false);
  // 打开条目时的初始正文；之后由 handleInput 持续跟上编辑器的最新内容
  const [previewSource, setPreviewSource] = useState(initialBody);

  /** 加密且本次未解密：正文区换占位，编辑器不挂载 */
  const bodyLocked = encryption?.encrypted === true && !encryption.unlocked;

  /*
    属性卡片（2026-10-04）：编排交给 hook，这里只把它给的回调递给组件。
    锁定态与 Memo 不给卡片——锁着的时候正文是密文，解析出来的东西没有意义；
    而 Memo 的 `items.title` 必须为 null，本来也没有独立属性可改。

    **必须在下面那个早返回之前调**（Hook 不能条件调用）。它只依赖 `item?.id`，
    没有条目时传 `null` 就变成只读，不会出问题。
  */
  const propsApi = useItemProps({
    itemId: item?.id ?? null,
    body: previewSource,
    handle: bodyLocked ? null : editorHandle,
    onError: onPropsError,
  });

  if (!item) {
    return (
      <div className="docpane">
        <EmptyDocPanel />
      </div>
    );
  }

  const showProps =
    item.type !== "memo" && shouldShowItemProps(previewSource);

  function handleInput(text: string): void {
    setPreviewSource(text);
    onInput(text);
  }

  return (
    <div className="docpane">
      {conflict ? (
        <div className="banner banner--warn" role="status">
          <span>
            这条笔记有冲突副本（{conflict.copyTitle}）：另一处也改过同一篇，你的版本已另存。保留哪一份？
          </span>
          {onOpenConflictCopy ? (
            <button type="button" className="btn btn--sm" onClick={onOpenConflictCopy}>
              查看副本
            </button>
          ) : null}
          {onResolveConflict ? (
            <>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => onResolveConflict("mine")}
                title="把副本的内容写回这条（副本仍作为普通笔记保留）"
              >
                保留我的版本
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => onResolveConflict("server")}
                title="保留当前这条的内容（副本仍作为普通笔记保留）"
              >
                保留服务端版本
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {remoteChanged ? (
        <div className="banner banner--warn" role="status">
          <span>
            这条笔记在另一个标签页被修改过。现在保存会生成一份冲突副本，不会覆盖别处的改动。
          </span>
          {onReload ? (
            <button type="button" className="btn btn--sm" onClick={onReload}>
              按最新内容重新载入
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="docpane__head">
        {/*
          标题走 `TitleInput`（本地即时回显 + 防抖提交）：此前它直接受控在"本地库那份标题"上，
          每个键都触发一次全量 refresh，异步回灌会把刚敲的字按回去（808 条实测丢 9/10 个字）。
          `key` 用条目 id：切换条目时换一个输入框实例，不把上一篇的本地文案带过去。
        */}
        <TitleInput
          key={item.id}
          className="docpane__title-input"
          value={item.title ?? ""}
          onCommit={onTitleChange}
        />

        {/*
          添加附件（M4-10；界面稿 §7.1 的"选择文件"入口）：
          真实的 `<input type="file">` 藏起来由按钮代点——这是唯一能唤起系统文件选择器、
          又能在移动端沿用系统选择器（含拍照）的做法。

          **表格条目不显示它**：附件的占位与落库都要插进 Markdown 正文（`EditorHandle.insert`），
          表格没有这个句柄——文件会照传上去，但**没有任何引用指向它**，30 天后按孤儿清掉
          （界面稿 §3 的表格正文头也只列了标题 + 锁标识 + 更多菜单，没有添加附件）。
        */}
        {onFiles && !isTable ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="visually-hidden"
              aria-label="选择附件"
              tabIndex={-1}
              disabled={bodyLocked}
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                // 同一个文件连选两次也要能触发（不清空 value 时第二次不触发 change）
                event.target.value = "";
                if (files.length > 0) onFiles(files);
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={bodyLocked}
              title={bodyLocked ? "解锁后才能添加附件" : undefined}
              onClick={() => fileInputRef.current?.click()}
            >
              添加附件
            </Button>
          </>
        ) : null}

        {/*
          模式切换只对 Markdown 正文有意义：表格有自己的"表格 / 图册"档位（界面稿 §3 的正文头
          也只列了标题 + 锁标识 + 更多菜单，**没有模式切换**）。对表格显示它，就是一个点了没反应的控件。

          列哪几档由设置决定（`editor_modes`）：**关掉的档不出现在这里**，所以只剩一档时
          这条切换条也照常渲染（就一个按钮，仍是当前档）。
        */}
        {isTable ? null : (
          <div className="segmented" role="group" aria-label="编辑模式" style={{ flex: "none" }}>
            {available.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className="segmented__item"
                aria-pressed={shownMode === candidate}
                disabled={bodyLocked}
                title={bodyLocked ? "解锁后才能查看或编辑正文" : undefined}
                onClick={() => switchMode(candidate)}
              >
                {MODE_LABEL[candidate]}
              </button>
            ))}
          </div>
        )}

        {/* 公开标记（M14-01）：有生效中的分享链接时可见，入口指向设置 › 分享 */}
        {shared ? (
          <span className="pill" title="这篇有生效中的分享链接；在设置 › 分享 可管理">
            公开
          </span>
        ) : null}

        {encryption ? (
          <DropdownMenu
            label="更多"
            align="right"
            trigger={
              <span className="pill" title="加密与锁定">
                更多
              </span>
            }
            items={buildMoreMenuItems({
              encryption,
              body: previewSource,
              bodyLocked,
              isTable,
              bodyEditable: shownMode === "edit" || shownMode === "live",
              privacyBlocked: item.enc_self === 1 || item.in_enc_space === 1,
              shared,
              onExportMarkdown,
              onRemoveAttachmentRef,
              onShare,
              onOpenVersions,
              versionsDisabledReason,
              onDelete,
            })}
          />
        ) : null}
      </div>

      <div className="docpane__body">
        {showProps ? (
          <ItemProps
            body={previewSource}
            editable={propsApi.editable}
            readOnlyReason={propsApi.readOnlyReason}
            onTagsChange={propsApi.onTagsChange}
            onTaskChange={propsApi.onTaskChange}
            onForeignChange={propsApi.onForeignChange}
            onForeignRemove={propsApi.onForeignRemove}
            onForeignAdd={propsApi.onForeignAdd}
            onError={onPropsError}
          />
        ) : null}
        {bodyLocked && encryption ? (
          <LockedDocPanel onUnlock={encryption.onUnlock} />
        ) : isTable && table.state.kind === "table" ? (
          /*
            表格（M4-9 接线）：`type = 'table'` 且结构能解析 → **表格界面**（工具栏 / 网格 / 图册 /
            大小条都在 `TableEditor` 里），不走 CodeMirror——结构化对象是唯一真源。
          */
          <Suspense fallback={<div className="docpane__center">表格加载中…</div>}>
            <TableEditor
              doc={table.state.doc}
              onDocChange={(next) => {
                table.commit(next);
                handleInput(renderTableDocument(next));
              }}
              onRequestDegrade={() => setDegradeOpen(true)}
            />
          </Suspense>
        ) : (
          <>
            {/*
              自动降级（界面稿 §2.10）：**不静默改数据**——只把危险态提示条摆在正文区顶部，
              下面照常按普通笔记打开（正文一字未改），并给出「查看原文」「下载当前内容」两条出路。
            */}
            {isTable ? (
              <TableDegradeNotice
                /*
                  救援入口：坏表格的「查看原文」必须能切到「仅编辑」——即使那一档没被打开，
                  也不能让它变成一个点了没反应的按钮（这里**故意**不走 `switchMode`，
                  它既不受"显示哪几档"限制，也不会把救援动作记成"用户偏好"）。
                */
                onViewSource={() => setMode("edit")}
                onDownload={() => {
                  const blob = new Blob([table.current()], { type: "text/markdown;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = `${item.title ?? "表格原文"}.md`;
                  anchor.click();
                  URL.revokeObjectURL(url);
                }}
              />
            ) : null}

            <Suspense fallback={<div className="docpane__center">编辑器加载中…</div>}>
            {shownMode === "edit" || shownMode === "live" ? (
            /*
              「仅编辑」与「即时渲染」共用这一个位置（都是单栏编辑器），差别只在 `live` 这个开关
              ——它在 `Editor` 里走 `Compartment` 重配置，所以两档互切**不重建文档**。
              阶段 A 曾把 `live` 移出产品清单（分支与实现都留着），**阶段 C 用户验收后已加回**
              `PRODUCT_EDITOR_MODES`；双栏仍然留在产品外，这里也不再恢复 `split` 分支。

              用 `previewSource`（实时文本）而不是 `initialBody`（打开时的快照）：
              切模式会让编辑器重新挂载，用快照初始化会把中间敲的内容显示回旧版本，
              用户再敲一个字就把旧内容写进草稿（M1-11 QA 实测）。
            */
            <div className="doc-split__pane">
              <Editor
                key={item.id}
                initialValue={previewSource}
                onChange={handleInput}
                onReady={onEditorReady}
                onFiles={onFiles}
                live={shownMode === "live"}
                ariaLabel="正文"
              />
            </div>
          ) : (
            <div className="doc-split__pane">
              <MarkdownPreview source={previewSource} attachments={attachmentsMeta} />
            </div>
          )}
          </Suspense>
          </>
        )}
      </div>

      {/* 主动降级的确认框（界面稿 §2.10：三段必须写全，且**不承诺可转回**） */}
      <Modal
        open={degradeOpen}
        title="降级为普通笔记"
        onClose={() => setDegradeOpen(false)}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDegradeOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setDegradeOpen(false);
                onDegrade?.();
              }}
            >
              降级
            </Button>
          </>
        }
      >
        <p>本表格的结构与列定义将被移除，内容按纯 Markdown 打开。</p>
        <p>降级前会先自动封存一个版本，可在版本历史里找回原文。</p>
        <p>
          **不提供反向转回表格**（避免解析失败带来的数据风险）。这一步需要在服务端把条目类型从
          「表格」改为「笔记」，属接口变更，**M4 暂未开放**——已记入待办。
        </p>
      </Modal>

      {snapshot && !bodyLocked ? (
        <DocStatusBar
          snapshot={snapshot}
          encryption={
            encryption
              ? { encrypted: encryption.encrypted, unlocked: encryption.unlocked }
              : undefined
          }
          privacyLine={privacyLine}
          attachments={attachments}
        />
      ) : null}
      {bodyLocked ? (
        <div className="doc-status" role="status">
          <span className="pill pill--err">已加密</span>
        </div>
      ) : null}
    </div>
  );
}
