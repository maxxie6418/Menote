/**
 * CodeMirror 6 封装（架构 §2.3.2：公共编辑器组件放 `app/editor/`）。
 *
 * 三条约束：
 * 1. **只在挂载时创建 `EditorView`**：切换编辑/预览模式只切布局与扩展，不重建文档（架构 §3.3）。
 * 2. 只读开关用 `Compartment` 重配置，同样不重建文档。
 * 3. 组件本身不做保存策略——自动保存节奏在 `features/notes/model.ts`，这里只把变更抛出去。
 *
 * 切换条目时由父组件用 `key={itemId}` 重新挂载，避免两篇文档互相污染。
 */
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  rectangularSelection,
} from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { type FormatCommandId } from "./format-commands";
import { frontmatterHide } from "./frontmatter-hide";
import { livePreview } from "./live-preview";
import { editorBaseTheme } from "./theme";
import { applyFormatAt, triggerAt } from "./trigger";

/** 交给外部的编辑器句柄：读、在光标处插入、按标记替换、执行格式命令 */
export interface EditorHandle {
  read(): string;
  insert(text: string): void;
  /** 把正文里的 `marker` 换成 `text`；找不到标记时按"插入"兜底 */
  replace(marker: string, text: string): void;
  /**
   * 在当前选区执行一条格式命令（`format-commands.ts` 是唯一的 Markdown 拼装处）。
   * 命令菜单选中之后由宿主调用——编辑器不认识菜单。
   */
  applyFormat(command: FormatCommandId): void;
}

/**
 * 编辑器自身的生命周期事件（编辑拓展阶段 C / Task C1）。
 *
 * 为什么由编辑器**自己**报，而不是宿主在 React 的挂/卸里猜：宿主 effect 与 `EditorView`
 * 的建/毁通常同进同出，但"视图已经销毁、宿主还没卸"这种分岔一旦出现，宿主侧计数就会谎报，
 * 而试验页要看的正是这种泄漏。所以事件发生在 `new EditorView`、`view.destroy()`、
 * 挂/撤 `updateListener`、以及 `Compartment` 重配置的那一刻。
 *
 * 只报这五个事件，不把 `document` 上的监听混进来——那些是宿主自己挂的，编辑器不知道。
 */
export type EditorLifecycleEvent =
  | "created"
  | "destroyed"
  | "listenerAdded"
  | "listenerRemoved"
  | "modeReconfigured";

export interface EditorProps {
  initialValue: string;
  onChange: (value: string) => void;
  /** 只读（预览模式或锁定态） */
  readOnly?: boolean;
  /**
   * **即时渲染**（M5 首期，2026-09-28）：正文直接呈现渲染样式、光标所在行显示源码。
   *
   * 走 `Compartment` 重配置（与只读开关同一套做法）——所以"仅编辑 ↔ 即时渲染"切换
   * **不重建文档**（架构 §3.3 的既定要求），撤销历史与光标位置都保住。
   */
  live?: boolean;
  /** 挂载后把句柄交给外部（状态栏计量、附件占位替换都用它） */
  onReady?: (handle: EditorHandle) => void;
  /**
   * 粘贴或拖入文件（M4-10；界面稿 §7.1）：编辑器只负责**把文件交出去**，
   * 上传与占位替换在 `features/attachments` 里——编辑器不该知道附件怎么传。
   */
  onFiles?: (files: File[]) => void;
  /**
   * `/` 触发词上报（编辑拓展阶段 B / Task B3）：光标前是**行首或空白后的 `/`**、
   * 且 `/` 到光标之间没有空白时，上报 `/` 后面的文本（刚打完 `/` 时是空串）；
   * 其余情况（含光标处不是触发词、选区非空、只读、即时渲染、输入法组合中）上报 `null`。
   *
   * 编辑器**不渲染菜单**：菜单长什么样、选中后写到哪里，都是宿主的事——
   * 正文与快捷输入共用同一套命令，但它们的宿主不是同一个。
   */
  onSlashQuery?: (query: string | null) => void;
  /**
   * 生命周期上报开关（编辑拓展阶段 C / Task C1，**只有试验页传**）。
   *
   * 生产侧不传即不报：这里不做任何统计、不读时钟、不影响保存策略。
   */
  onLifecycle?: (event: EditorLifecycleEvent) => void;
  /**
   * 空正文时的占位提示（2026-10-01 接上，**默认不显示**）。
   *
   * 为什么默认空：空正文该写什么属于**产品文案**，按 `DESIGN.md` §5.4「说明性文字
   * 不平铺、由实现自行发明文案」不由实现决定，所以这里只留口子，调用方给了才出现。
   * 参照外部项目 inkstone 的 `CodeEditor.tsx`，它默认给的是 `t("editor.start_writing")`。
   */
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

/** 从剪贴板/拖放数据里取文件（`items` 优先：`files` 在部分浏览器里拿不到剪贴板图片） */
export function filesFromDataTransfer(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromItems = [...data.items]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  if (fromItems.length > 0) return fromItems;
  return [...data.files];
}

/**
 * 光标前那个 `/` 触发词的查询文本；不在触发位置时返回 `null`。
 *
 * 判定规则只有一份（`trigger.ts`，与快捷输入共用）：正文这里只要 `/`，录入框还要 `@`。
 */
export function slashQueryAt(text: string, caret: number): string | null {
  return triggerAt(text, caret, ["/"])?.query ?? null;
}

export { applyFormatAt };

export function Editor({
  initialValue,
  onChange,
  readOnly = false,
  live = false,
  onReady,
  onFiles,
  onSlashQuery,
  onLifecycle,
  placeholder,
  className,
  ariaLabel,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const onFilesRef = useRef(onFiles);
  const onSlashQueryRef = useRef(onSlashQuery);
  const onLifecycleRef = useRef(onLifecycle);
  /** 即时渲染开关的当前值：视图只创建一次，扩展里的回调必须读 ref 才知道现在是不是渲染档 */
  const liveRef = useRef(live);
  /** 上一次上报的触发词（`null` 也算一次）：不变就不重复打扰宿主 */
  const lastSlashRef = useRef<string | null>(null);
  /** 首次挂载期间略过档位上报：那两次 effect 说的是"配置"，不是"用户换了档" */
  const mountedRef = useRef(false);
  const [readOnlyCompartment] = useState(() => new Compartment());
  /** 即时渲染 / 行号那一档扩展（见 `EditorProps.live`） */
  const [viewModeCompartment] = useState(() => new Compartment());
  /** 拖入时的落点提示（界面稿 §7.1：**可见的**虚线描边，而不只是改光标） */
  const [dragging, setDragging] = useState(false);

  // 回调放进 ref（用 effect 同步，不在渲染期写 ref）；视图只创建一次，靠 ref 取最新回调
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  useEffect(() => {
    onFilesRef.current = onFiles;
  }, [onFiles]);
  useEffect(() => {
    onSlashQueryRef.current = onSlashQuery;
  }, [onSlashQuery]);
  useEffect(() => {
    onLifecycleRef.current = onLifecycle;
  }, [onLifecycle]);

  /**
   * 当前状态下该上报的触发词。
   *
   * 三种情况一律报 `null`：组合输入中（`/` 常常只是候选词的一部分）、只读、即时渲染
   * ——渲染档里光标那一行是源码，但菜单会盖住正在看的渲染结果，宿主也没法给它定位。
   */
  function nextSlashQuery(view: EditorView): string | null {
    if (view.composing || liveRef.current || view.state.readOnly) return null;
    const selection = view.state.selection.main;
    if (!selection.empty) return null;
    return slashQueryAt(view.state.doc.toString(), selection.head);
  }

  /**
   * 上报触发词。`updateListener` 对**每一次事务**都会跑（打字、移光标、只读与模式重配置），
   * 所以这里得自己去重：不然宿主会被同一份查询反复通知，菜单也跟着反复重开。
   */
  function reportSlash(view: EditorView | null): void {
    const next = view ? nextSlashQuery(view) : null;
    if (next === lastSlashRef.current) return;
    lastSlashRef.current = next;
    onSlashQueryRef.current?.(next);
  }

  /** 生命周期上报（只有试验页传回调）。视图建/毁与重配置各报到点上。 */
  function reportLifecycle(event: EditorLifecycleEvent): void {
    onLifecycleRef.current?.(event);
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const view = new EditorView({
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          history(),
          /*
            base 用 `markdownLanguage`（= commonmark + GFM）：`markdown()` 的**默认 base 是纯
            CommonMark**，那样 `| a | b |` 不是表格、`- [ ]` 不是任务清单、`~~x~~` 不是删除线
            （`[x]` 甚至会被解析成链接）。即时渲染要覆盖这些，编辑/分屏两档也用同一棵树，
            免得"同一个文档在不同模式下解析结果不一样"。
          */
          markdown({ base: markdownLanguage }),
          /*
            —— 以下一组是「编辑手感」，全部只依赖已声明的 CM6 包，不新增依赖 ——
            参照外部项目 inkstone 的 `CodeEditor.tsx` 扩展清单，挑了不改变编辑语义的补上。
          */

          /*
            `drawSelection` 修的是**跨行选区**：没有它时浏览器原生选区会在换行处断开、
            看起来是几段不相干的高亮，而选区正是"复制出来仍是带标记的 md"这条交互
            （即时渲染设计 §三-1）要依赖的东西。
          */
          drawSelection(),
          /*
            `dropCursor`：从别处拖文字进来时，在落点显示一条竖线。原先只有光标会在"原地不动"，
            用户根本不知道这段要插到哪——这正是 DESIGN.md §6.1「操作要有可见反馈」的一条。
          */
          dropCursor(),
          /* Alt + 拖拽 = 列选；`allowMultipleSelections` 让 Ctrl/Alt+点击能开多个光标 */
          rectangularSelection(),
          EditorState.allowMultipleSelections.of(true),
          /* 回车继承上一行缩进：Markdown 里就是"列表/引用续写"，少按一次 Tab */
          indentOnInput(),
          /* 配对括号高亮：`(`, `[`, `*` 旁边亮出对应的那一个 */
          bracketMatching(),
          editorBaseTheme(),
          highlightActiveLine(),
          /*
            占位提示。**默认不显示**——空正文该写什么属于产品文案，
            按 DESIGN.md §5.4 不由实现自行发明；调用方传 `placeholder` 才出现。
          */
          placeholderExt(placeholder ?? ""),
          /*
            键位优先级：我们自己的 > 折叠 > 撤销重做 > 默认。
            **刻意不加 `indentWithTab`**：那会让 Tab 插入缩进而不是移走焦点，
            与 DESIGN.md §6.2「焦点与键盘可达（底线）」冲突。外部项目加了，我们不跟。
          */
          keymap.of([...defaultKeymap, ...foldKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          /*
            把 front matter 藏成一个可点的小标签（2026-10-04）。
            **纯视觉**：文档内容与保存链路一字未动——菜单改标签/清单/标题时直接改的是 md，
            编辑器若自己存一份 front matter 副本再回贴，会把那些改动抹回去。
          */
          frontmatterHide(),
          // 即时渲染下不显示行号（渲染视图里行号只是噪声）；两档都由这一个 Compartment 管
          viewModeCompartment.of(viewModeExtensions(live)),
          readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
          /**
           * 粘贴/拖入文件：**先 `preventDefault`**，否则浏览器会把图片当成
           * `![](blob:...)` 之类的临时地址塞进正文——那是刷新即失效的假引用。
           */
          EditorView.domEventHandlers({
            paste: (event) => {
              const files = filesFromDataTransfer(event.clipboardData);
              if (files.length === 0) return false;
              event.preventDefault();
              onFilesRef.current?.(files);
              return true;
            },
            drop: (event) => {
              const files = filesFromDataTransfer(event.dataTransfer);
              if (files.length === 0) return false;
              event.preventDefault();
              onFilesRef.current?.(files);
              return true;
            },
            dragover: (event) => {
              // 让浏览器把这里当合法落点，`drop` 才会触发
              event.preventDefault();
              return false;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
            reportSlash(update.view);
          }),
        ],
      }),
      parent: host,
    });

    viewRef.current = view;
    reportLifecycle("created");
    onReadyRef.current?.(makeHandle(view));
    // 更新监听是创建 state 时挂上去的，与视图同生；分开报是为了让读数能说清"谁还在"
    reportLifecycle("listenerAdded");

    return () => {
      view.destroy();
      viewRef.current = null;
      mountedRef.current = false;
      reportLifecycle("listenerRemoved");
      reportLifecycle("destroyed");
      // 视图没了：宿主要把命令菜单一并收起来，别留一个指向死视图的菜单
      reportSlash(null);
    };
    // 只在挂载时创建：initialValue 的变化不应重建文档（架构 §3.3）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 只读开关后续可切（切预览），走 Compartment 重配置，不重建文档
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
    });
    // 首次运行是创建时已经配置好的那次，不是"重配置"；报出去会让读数凭空多一次
    if (mountedRef.current) reportLifecycle("modeReconfigured");
  }, [readOnly, readOnlyCompartment]);

  /*
    即时渲染开关同理：**重配置而不重建文档**。
    这一条不能省——"仅编辑 ↔ 即时渲染"在 React 树里的位置相同，不会重新挂载编辑器，
    少了它就会"点了模式按钮没反应"。
    `liveRef` 先改：紧接着那次重配置会触发 `updateListener`，触发词上报要按**新的**档位判。
  */
  useEffect(() => {
    liveRef.current = live;
    viewRef.current?.dispatch({
      effects: viewModeCompartment.reconfigure(viewModeExtensions(live)),
    });
    // 首次运行是创建时已经配置好的那次，不是"重配置"；报出去会让读数凭空多一次
    if (mountedRef.current) reportLifecycle("modeReconfigured");
  }, [live, viewModeCompartment]);

  /*
    挂载期在**上面两条重配置 effect 之后**结束：effect 按声明顺序跑，所以它们的首次运行
    看到的是 false（那两次是"按 props 配置"，不是"用户换了档"）。此后每一次运行都是真的重配置。
  */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return (
    <div
      className={[className, dragging ? "editor--drop" : null].filter(Boolean).join(" ")}
      onDragEnter={() => setDragging(true)}
      onDragOver={() => setDragging(true)}
      onDragLeave={() => setDragging(false)}
      onDrop={() => setDragging(false)}
    >
      <div ref={hostRef} data-editor={live ? "live" : "true"} aria-label={ariaLabel} />
    </div>
  );
}

/**
 * "查看档位"那一组扩展：即时渲染（`livePreview`）或普通编辑（行号 + 折叠 + 活动行槽）。
 *
 * 两者**互斥**：渲染视图里行号是噪声；而即时渲染藏掉标记之后，行号与折叠箭头会给
 * "这一行是源码还是渲染结果"添乱。行号槽的活动行高亮（`highlightActiveLineGutter`）
 * 也只在这一档——它没有底色（见 `app.css`），只是把当前行号提亮成 `--text-2`。
 *
 * 它单独成函数是为了让创建时与重配置时**用的是同一份**，不会两边写岔。
 */
function viewModeExtensions(live: boolean): Extension {
  return live ? [livePreview()] : [lineNumbers(), highlightActiveLineGutter(), foldGutter()];
}

/** 句柄：读 / 插入 / 按标记替换 / 执行格式命令——都直接落在 `EditorView` 上，不持有全局状态 */
function makeHandle(view: EditorView): EditorHandle {
  const insert = (text: string): void => {
    const position = view.state.selection.main.head;
    view.dispatch({
      changes: { from: position, insert: text },
      selection: { anchor: position + text.length },
    });
  };

  return {
    read: () => view.state.doc.toString(),
    insert,
    replace: (marker, text) => {
      const body = view.state.doc.toString();
      const index = body.indexOf(marker);
      if (index < 0) {
        // 标记不在（用户手动删了占位、或编辑器刚重挂载）→ 插在光标处兜底，别让附件白白传完
        if (text !== "") insert(text);
        return;
      }
      view.dispatch({ changes: { from: index, to: index + marker.length, insert: text } });
    },
    applyFormat: (command) => {
      const text = view.state.doc.toString();
      const { from, to } = view.state.selection.main;
      const result = applyFormatAt(text, { from, to }, command);
      /*
        整篇换成新文本、并落回命令给出的选区。`onChange` 由同一条 `updateListener` 抛出去，
        这里**不自己调回调**——两条路同时改文档，宿主读到的会是旧值。
      */
      view.dispatch({
        changes: { from: 0, to: text.length, insert: result.text },
        selection: { anchor: result.selection.from, head: result.selection.to },
      });
    },
  };
}
