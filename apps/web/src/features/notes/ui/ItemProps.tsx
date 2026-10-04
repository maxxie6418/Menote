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

export interface ItemPropsProps {
  /** 编辑器当前文本（含 front matter）。卡片是纯显示的，数据全从这里来 */
  body: string;
  /** 能不能改。预览档没有可编辑的编辑器 → 只读并给原因（DESIGN.md §6.1） */
  editable: boolean;
  /** 只读时给什么理由（禁用必须说明原因） */
  readOnlyReason?: string;
  onTagsChange: (tags: string[]) => void;
  onTaskChange: (next: { status: string | null; due: string | null; priority: string | null } | null) => void;
  onForeignChange: (key: string, value: string, block: boolean) => void;
  onForeignRemove: (key: string) => void;
  onForeignAdd: (key: string, value: string) => void;
  /** 校验没过时把理由报上来（错误必须可见，不静默） */
  onError?: (message: string) => void;
}

/** 清单状态的可选值：空 = 去掉清单标记（键在但字段全空也算清单，所以用 null 表达去掉） */
const STATUS_OPTIONS: Array<{ value: TaskStatus | ""; label: string }> = [
  { value: "todo", label: TASK_STATUS_LABELS.todo },
  { value: "doing", label: TASK_STATUS_LABELS.doing },
  { value: "done", label: TASK_STATUS_LABELS.done },
  { value: "", label: "未设为清单" },
];

const PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: "high", label: TASK_PRIORITY_LABELS.high },
  { value: "medium", label: TASK_PRIORITY_LABELS.medium },
  { value: "low", label: TASK_PRIORITY_LABELS.low },
];

/** 键名只能用这些字符——含冒号或空格的键写进去会让整块 YAML 坏掉（与 mdcore 同一口径） */
const KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const RESERVED = new Set(["title", "tags", "menote"]);

/** 从 md 解析出这一篇要给卡片看的全部属性（纯函数，便于单测） */
export function readItemProps(body: string): {
  tags: string[];
  task: { status: string | null; due: string | null; priority: string | null } | null;
  foreign: ForeignKey[];
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
  };
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
  const { tags, task, foreign } = readItemProps(body);
  const disabled = !editable;

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
                  onTaskChange(
                    event.target.value === ""
                      ? null
                      : {
                          status: event.target.value,
                          due: task?.due ?? null,
                          priority: task?.priority ?? null,
                        },
                  ),
                )
              }
            >
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
                    status: task?.status ?? "todo",
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
              value={task?.priority ?? "medium"}
              disabled={disabled}
              title={disabled ? readOnlyReason : undefined}
              onChange={(event) =>
                guard(() =>
                  onTaskChange({
                    status: task?.status ?? "todo",
                    due: task?.due ?? null,
                    priority: event.target.value,
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

      {foreign.length > 0 ? (
        <div className="itemprops__group itemprops__group--foreign">
          <div className="itemprops__head">其他属性 · 键名原样保留</div>
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
                    onClick={() => onForeignRemove(one.key)}
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
    </section>
  );
}
