/**
 * 条目属性卡片（2026-10-04，《笔记属性卡片》设计稿 §2）。
 *
 * **它在正文区顶部、标题之下**，显示与修改这一篇的属性：标签、清单字段、以及外部
 * Markdown 工具写进来的外来键。
 *
 * ## 三条它必须守住的口径
 *
 * 1. **键名原样**（设计稿 §3）。`url` / `author` / `status` 这些是某个 Obsidian 插件写的，
 *    不是标准；贴上中文标签等于替用户猜它是什么意思，猜错比不猜更糟。所以键名就是键名。
 *
 * 2. **值按原格式写回**（§4）。不把值解析成结构再拼回去——只把原文带着走。
 *    所以块序列给多行框、单行给单行框，引号与缩进都是用户说了算。
 *
 * 3. **组件只管显示与发意图，不自己存**（§6）。改动一律交给宿主：
 *    md 那一路走编辑器句柄（`replaceFrontmatter`），派生列那一路走 `actions.ts`。
 *    组件自己存的话会和编辑器的自动保存打架——用户看着标签还在，刷新一下就没了。
 *
 * ## 为什么形态是胶囊
 *
 * `DESIGN.md` §5.3 已定「条目属性（标签、截止、优先级、状态）→ 胶囊 `chip`」，所以复用
 * 现成的 `Chip`（`variant="tag"`），不新造控件。
 */
import { useState } from "react";
import {
  deriveTaskFields,
  frontmatterText,
  parseMenoteMeta,
  readForeignKeys,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type ForeignKey,
  type TaskPriority,
  type TaskStatus,
} from "@menote/mdcore";
import { Chip } from "../../../app/ui/Chip";
import { ConfirmDialog } from "../../../app/ui/ConfirmDialog";
import { readPropsCollapsed, writePropsCollapsed } from "../props-collapse";

export interface ItemPropsProps {
  /** 编辑器当前文本（含 front matter）。卡片是纯显示的，数据全从这里来 */
  body: string;
  /** 能不能改。预览档没有可编辑的编辑器 → 只读并给原因（DESIGN.md §6.1） */
  editable: boolean;
  /** 只读时给什么理由（禁用必须说明原因） */
  readOnlyReason?: string;
  onTagsChange: (tags: string[]) => void;
  /**
   * 清单三字段的改动。**不接受 `null`**（2026-10-11）：卡片不再提供「取消清单」的入口
   * （设计 §6.2），传 `null` 那条路只有清单侧动作（`features/tasks/actions.ts`）还会走。
   */
  onTaskChange: (next: { status: string | null; due: string | null; priority: string | null }) => void;
  onForeignChange: (key: string, value: string, block: boolean) => void;
  onForeignRemove: (key: string) => void;
  onForeignAdd: (key: string, value: string) => void;
  /** 校验没过时把理由报上来（错误必须可见，不静默） */
  onError?: (message: string) => void;
}

/**
 * 清单状态的可选值。
 *
 * **2026-10-11 起没有「未设为清单」这一项**：那一项 `value: ""` 走的是 `onTaskChange(null)`，
 * 一次清掉三个键——「是否设为清单」从前完全由它承担。属性块从此只显示清单字段的值，
 * 不再提供「取消清单」的入口（用户 2026-10-11 决定，取消清单等清单功能稳定后单独设计）。
 * 当前值就是空的时候另渲染一个占位项「未设置」（见下面渲染处），所以「从已设置回到空」
 * 仍然没有点击路径。
 */
const STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: "todo", label: TASK_STATUS_LABELS.todo },
  { value: "doing", label: TASK_STATUS_LABELS.doing },
  { value: "done", label: TASK_STATUS_LABELS.done },
];

/** 优先级：`""` = 未设置（不写行）。缺了它，没设过的笔记会被 `value` 落到第一项、显示成「中」 */
const PRIORITY_OPTIONS: Array<{ value: TaskPriority | ""; label: string }> = [
  { value: "", label: "未设置" },
  { value: "high", label: TASK_PRIORITY_LABELS.high },
  { value: "medium", label: TASK_PRIORITY_LABELS.medium },
  { value: "low", label: TASK_PRIORITY_LABELS.low },
];

/**
 * 键名只能用这些字符——含冒号或空格的键写进去会让整块 YAML 坏掉（与 mdcore 同一口径）
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
/** MeNote 自己的键：上面几行已经有它们的位置，不能再当外来属性新增（2026-10-11 加清单三键） */
const RESERVED = new Set(["title", "tags", "menote", "status", "due", "priority"]);

/** 从 md 解析出这一篇要给卡片看的全部属性（纯函数，便于单测） */
export function readItemProps(body: string): {
  tags: string[];
  task: { status: string | null; due: string | null; priority: string | null } | null;
  foreign: ForeignKey[];
  /** 被接管、但值 MeNote 不认识的键，如 `status: unread`（设计 §4 的缓解，一行可见文案） */
  unrecognized: string[];
} {
  const meta = parseMenoteMeta(body).meta;
  const derived = deriveTaskFields(body);
  return {
    /*
      **只取 front matter 里的 `tags`，不取正文 `#标签` 派生出来的那些。**
      卡片是一个「改 YAML」的入口：它显示的每个值都必须能被它改掉。若把正文标签也列进来，
      点 × 只会往 YAML 写一个少一项的列表，而 `deriveTags` 下一轮又把正文那个标签并回来——
      用户点完发现标签还在，比没有这个 × 更糟。正文 `#标签` 是另一套东西，留在正文里。
    */
    tags: [...meta.tags],
    task: derived.isTask
      ? { status: derived.status, due: derived.due, priority: derived.priority }
      : null,
    foreign: readForeignKeys(body),
    unrecognized: unrecognizedTaskValues(meta.task, derived),
  };
}

/**
 * 顶层三键里**有值、但 MeNote 不认识**的那些（设计 §4 的缓解）。
 *
 * 接管是无条件的：顶层 `status: unread` 也算清单条目，于是它不再出现在「其他属性」段里，
 * 而清单行显示的是归一化之后的空值——**用户在界面上完全看不到这个值**。改一次属性就会
 * 把它覆盖掉，所以至少要用一行可见文案说出来（不加新控件）。
 *
 * 判据是「原文有值、归一后为空」，所以 `status: todo` 这种认识的写法不会触发。
 */
function unrecognizedTaskValues(
  raw: { status: string | null; due: string | null; priority: string | null } | null,
  derived: ReturnType<typeof deriveTaskFields>,
): string[] {
  if (!raw || !derived.isTask) return [];
  const out: string[] = [];
  if (raw.status !== null && raw.status !== "" && derived.status === null) {
    out.push(`status: ${raw.status}`);
  }
  if (raw.due !== null && raw.due !== "" && derived.due === null) {
    out.push(`due: ${raw.due}`);
  }
  if (raw.priority !== null && raw.priority !== "" && derived.priority === null) {
    out.push(`priority: ${raw.priority}`);
  }
  return out;
}

/**
 * 卡片该不该出现。
 *
 * - **正文以 `---` 开头但没闭合** → 用户正在写第一行，此时任何改写都不可靠 → 不显示；
 * - 其余（含**完全没有** front matter）→ 显示，让用户能加第一个标签。
 */
export function shouldShowItemProps(body: string): boolean {
  if (!body.startsWith("---\n")) return true;
  return frontmatterText(body) !== null;
}

/**
 * 折起来时那一行摘要。
 *
 * **不给「属性」两个字就完事**——用户会以为这里本来就没东西。折起时仍要看得见
 * 「有几项、是什么」，这是折叠该省的空间，不是该省的信息。口径都在既有数据上算，
 * 不额外派生：标签取卡片显示的那份（front matter 里的），状态取清单字段。
 */
function collapsedSummary(props: ReturnType<typeof readItemProps>): string {
  const parts: string[] = [];
  if (props.tags.length > 0) parts.push(`${props.tags.length} 个标签`);
  if (props.task) {
    // 状态为空时不能回落「待办」——那是谎报，与卡片里的「未设置」占位项同一口径
    parts.push(
      props.task.status ? (TASK_STATUS_LABELS[props.task.status as TaskStatus] ?? "清单") : "清单未设置",
    );
  }
  if (props.foreign.length > 0) parts.push(`${props.foreign.length} 项其他属性`);
  return parts.length > 0 ? `属性 · ${parts.join(" · ")}` : "属性";
}

export function ItemProps({
  body,
  editable,
  readOnlyReason,
  onTagsChange,
  onTaskChange,
  onForeignChange,
  onForeignRemove,
  onForeignAdd,
  onError,
}: ItemPropsProps) {
  const props = readItemProps(body);
  const { tags, task, foreign, unrecognized } = props;
  const disabled = !editable;

  /** 待确认删除的外来键（设计 §6.5：破坏性操作二次确认）；`null` = 没在确认 */
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  // 折叠状态记在本机（`props-collapse.ts`）：设备级偏好，且切档很频繁，不该上行
  const [collapsed, setCollapsed] = useState(readPropsCollapsed);
  const toggle = (): void => {
    setCollapsed((previous) => {
      writePropsCollapsed(!previous);
      return !previous;
    });
  };

  function guard(action: () => void): void {
    if (!editable) return;
    try {
      action();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "改不动这一项");
    }
  }

  function addTag(): void {
    const raw = window.prompt("标签名");
    const name = (raw ?? "").trim();
    if (name === "") return;
    // 大小写不敏感去重（与 `mergeTags` 同一口径）
    if (tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) {
      onError?.(`已经有「${name}」了。`);
      return;
    }
    guard(() => onTagsChange([...tags, name]));
  }

  function addForeign(): void {
    const raw = window.prompt("键名（只能用字母、数字、下划线、连字符）");
    const key = (raw ?? "").trim();
    if (key === "") return;
    if (!KEY_PATTERN.test(key)) {
      onError?.("键名只能用字母、数字、下划线、连字符——含冒号或空格的键写进去会让整块 YAML 坏掉。");
      return;
    }
    if (RESERVED.has(key)) {
      onError?.(`「${key}」是 MeNote 自己的键，上面已经有它的位置了。`);
      return;
    }
    if (foreign.some((one) => one.key === key)) {
      onError?.(`「${key}」已经在了。`);
      return;
    }
    guard(() => onForeignAdd(key, ""));
  }

  return (
    <section className="itemprops" aria-label="属性">
      <div className="itemprops__inner">
      {collapsed ? (
        // 折起来：只留一行摘要 + 展开按钮，属性本体不渲染（省地方，也省一次解析之外的绘制）
        <button
          type="button"
          className="itemprops__toggle itemprops__toggle--collapsed"
          aria-expanded={false}
          onClick={toggle}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="itemprops__summary">{collapsedSummary(props)}</span>
        </button>
      ) : (
        <>
          <button
            type="button"
            className="itemprops__toggle"
            aria-expanded
            onClick={toggle}
            title="折叠属性"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
            <span className="itemprops__summary">属性</span>
          </button>
          <div className="itemprops__group">
        <div className="itemprops__row">
          <span className="itemprops__label" id="itemprops-tags">
            标签
          </span>
          <div className="itemprops__vals">
            {tags.map((tag) => (
              <Chip key={tag} variant="tag" title={editable ? `移除标签 ${tag}` : readOnlyReason}>
                {tag}
                {editable ? (
                  <button
                    type="button"
                    className="itemprops__x"
                    aria-label={`移除标签 ${tag}`}
                    onClick={() => guard(() => onTagsChange(tags.filter((one) => one !== tag)))}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                ) : null}
              </Chip>
            ))}
            {editable ? (
              <button type="button" className="itemprops__add" onClick={addTag}>
                + 添加
              </button>
            ) : null}
            {tags.length === 0 && !editable ? <span className="itemprops__none">没有标签</span> : null}
          </div>
        </div>

        <div className="itemprops__row">
          <label className="itemprops__label" htmlFor="itemprops-status">
            状态
          </label>
          <div className="itemprops__vals">
            <select
              id="itemprops-status"
              className="itemprops__field"
              value={task?.status ?? ""}
              disabled={disabled}
              title={disabled ? readOnlyReason : undefined}
              onChange={(event) =>
                guard(() =>
                  onTaskChange({
                    status: event.target.value || null,
                    due: task?.due ?? null,
                    priority: task?.priority ?? null,
                  }),
                )
              }
            >
              {/* 占位项只在当前值就是空的时候存在——它不提供「从已设置回到空」的路径 */}
              {task?.status ? null : <option value="">未设置</option>}
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="itemprops__row">
          <label className="itemprops__label" htmlFor="itemprops-due">
            截止
          </label>
          <div className="itemprops__vals">
            <input
              id="itemprops-due"
              type="date"
              className="itemprops__field"
              value={task?.due ?? ""}
              disabled={disabled}
              title={disabled ? readOnlyReason : undefined}
              onChange={(event) =>
                guard(() =>
                  onTaskChange({
                    status: task?.status ?? null,
                    due: event.target.value || null,
                    priority: task?.priority ?? null,
                  }),
                )
              }
            />
          </div>
        </div>

        <div className="itemprops__row">
          <label className="itemprops__label" htmlFor="itemprops-priority">
            优先级
          </label>
          <div className="itemprops__vals">
            <select
              id="itemprops-priority"
              className="itemprops__field"
              value={task?.priority ?? ""}
              disabled={disabled}
              title={disabled ? readOnlyReason : undefined}
              onChange={(event) =>
                guard(() =>
                  onTaskChange({
                    // 不再顺手补 `status: "todo"`：改一个属性不该把普通笔记变成清单条目
                    status: task?.status ?? null,
                    due: task?.due ?? null,
                    priority: event.target.value || null,
                  }),
                )
              }
            >
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/*
        被接管、但值不识别的键（如顶层 `status: unread`）：**必须说出来**。它已经被认成清单
        条目、不再出现在「其他属性」段里，行上显示的还是归一化后的空值——不提示的话用户改一次
        属性就把这个值默默覆盖掉了（设计 §4 的缓解，就是一行文案，不加控件）。
      */}
      {unrecognized.length > 0 ? (
        <div className="itemprops__warn">
          {unrecognized.join("、")} 不是 MeNote 认识的值，改动上面这几行会把它覆盖掉。
        </div>
      ) : null}

      {/*
        「其他属性」段**常显**（设计 §6.4）：从前它与段内的「+ 添加属性」都只在有外来键时
        才渲染，等于空白笔记根本没有新增入口。只读档（预览）没有新增入口，空段就纯是噪声，
        所以那种情况仍然只在真有外来键时渲染。
      */}
      {foreign.length > 0 || editable ? (
        <div className="itemprops__group itemprops__group--foreign">
          {foreign.length > 0 ? (
            <div className="itemprops__head">其他属性 · 键名原样保留</div>
          ) : null}
          {foreign.map((one) => (
            <div className="itemprops__row" key={one.key}>
              <span className="itemprops__key" title="键名原样保留，不翻译也不改写">
                {one.key}
              </span>
              <div className="itemprops__vals">
                {one.block ? (
                  <textarea
                    className="itemprops__value itemprops__value--block"
                    rows={Math.min(4, one.value.split("\n").length)}
                    defaultValue={one.value}
                    readOnly={disabled}
                    title={disabled ? readOnlyReason : undefined}
                    aria-label={`${one.key} 的值`}
                    onBlur={(event) =>
                      guard(() => onForeignChange(one.key, event.target.value, true))
                    }
                  />
                ) : (
                  <input
                    className="itemprops__value"
                    defaultValue={one.value}
                    readOnly={disabled}
                    title={disabled ? readOnlyReason : undefined}
                    aria-label={`${one.key} 的值`}
                    onBlur={(event) => guard(() => onForeignChange(one.key, event.target.value, false))}
                  />
                )}
                {editable ? (
                  <button
                    type="button"
                    className="itemprops__x itemprops__x--row"
                    aria-label={`删除属性 ${one.key}`}
                    title={`删除 ${one.key}`}
                    /* 破坏性操作要二次确认（设计 §6.5）：删完这篇 md 里就没有了，Obsidian 那边也看不到 */
                    onClick={() => setPendingRemove(one.key)}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {editable ? (
            <div className="itemprops__foot">
              <button type="button" className="itemprops__add" onClick={addForeign}>
                + 添加属性
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingRemove !== null}
        title={pendingRemove === null ? "" : `删除属性 ${pendingRemove}？`}
        desc={
          pendingRemove === null
            ? ""
            : `删掉「${pendingRemove}」之后，这篇 md 的 front matter 里就没有这一行了，Obsidian 那边也看不到它。`
        }
        confirmLabel="删除属性"
        onConfirm={() => {
          const key = pendingRemove;
          setPendingRemove(null);
          if (key !== null) guard(() => onForeignRemove(key));
        }}
        onClose={() => setPendingRemove(null)}
      />
        </>
      )}
      </div>
    </section>
  );
}
