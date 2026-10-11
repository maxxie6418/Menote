/**
 * 条目属性卡片（2026-10-04，《笔记属性卡片》设计稿 §2；2026-10-11 重设计 v2）。
 *
 * **它住在正文区左侧的贴边面板里**（`DocRail` 装的卡），不再是正文上方的一条带：
 * 展开收起归那条轨道管，卡片自己既不折叠、也不知道自己有多宽。
 * 显示与修改这一篇的属性：标签、清单字段、以及外部 Markdown 工具写进来的外来键。
 *
 * ## 五条它必须守住的口径
 *
 * 1. **键名原样**（设计稿 §3）。`url` / `author` / `status` 这些是某个 Obsidian 插件写的，
 *    不是标准；贴上中文标签等于替用户猜它是什么意思，猜错比不猜更糟。所以键名就是键名。
 *    （键名旁边可以显示用户自己在属性库里设的**显示名**——那只是界面叫法，写回 md、
 *    导出、分享出去的一律还是源名。）
 *
 * 2. **值按原格式写回**（§4）。不把值解析成结构再拼回去——只把原文带着走。
 *    所以块序列给多行框、单行给单行框，引号与缩进都是用户说了算。
 *
 * 3. **组件只管显示与发意图，不自己存**（§6）。改动一律交给宿主：
 *    md 那一路走编辑器句柄（`replaceFrontmatter`），派生列那一路走 `actions.ts`。
 *    组件自己存的话会和编辑器的自动保存打架——用户看着标签还在，刷新一下就没了。
 *
 * 4. **库只管候选与控件，不管真假**（2026-10-11 属性库 §3.4）。属性库
 *    （`features/props/model.ts`）给的是「这个键通常填什么、用哪个控件」，**不是白名单**：
 *    库里没有的值照样写得进去（否则外部导入的笔记会被字典判成非法）。卡片只把"用户真的
 *    改过"的值上报给库（§6.4），渲染本身一个都不收录。
 *
 * 5. **一副骨架、一种动作**（重设计 v2 §3）。每一行都是「名列 / 控件 / 24px 动作格」，
 *    内置四行与外来键行长得一样；动作一律是 24px 方按钮（删除 ⓧ、收进库 □+、说明 ⓘ），
 *    **不写字**——"未入库"那类话进 `title`，否则它又会变成第二套视觉。
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
import type { PropLibraryEntry } from "@menote/shared";
import { Chip } from "../../../app/ui/Chip";
import { ConfirmDialog } from "../../../app/ui/ConfirmDialog";
import { InfoHint } from "../../../app/ui/InfoHint";
import {
  addEntry,
  entryFor,
  labelFor,
  PROP_KEY_PATTERN,
  registerValue,
  RESERVED_PROP_KEYS,
  type PropLabels,
} from "../../props/model";
import { PropPicker } from "../../props/ui/PropPicker";
import { PropValueField } from "../../props/ui/PropValueField";

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
  /** 属性库（账号级，设计 §4）。**可选**：老调用点与只读场景不传就是空库 */
  library?: readonly PropLibraryEntry[];
  /**
   * 库变了（新建键 / 登记一个值 / 把未入库的键收进来）。
   * 只在**用户真的动过**时调用（§6.4）——渲染、切换条目都不该改库。
   */
  onLibraryChange?: (next: PropLibraryEntry[]) => void;
  /**
   * 显示名（账号级，重设计 v1 §4）：键 → 界面叫法。**只改界面**——写回 md、导出、分享、
   * 备份一律仍是源键名。不传就是源名（内置键回落内置中文名，见 `features/props/model`）。
   */
  labels?: PropLabels;
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

/*
  键名与保留字的口径**只在 `features/props/model.ts` 里定义一份**（2026-10-11）：属性库的
  管理页、卡片、导入录入步三处都要用同一套判据，各写一份必然会漂。
*/

/** 从 md 解析出这一篇要给卡片看的全部属性（纯函数，便于单测） */
export function readItemProps(body: string): {
  tags: string[];
  task: { status: string | null; due: string | null; priority: string | null } | null;
  foreign: ForeignKey[];
  /**
   * 清单三键的**原文**（未归一）。路 A（用户 2026-10-11 拍板）要把它显示出来：
   * `status: unread` 这种值不再"看不见"，而是作为「原样保留」的选项摆在那一行上。
   */
  rawTask: { status: string | null; due: string | null; priority: string | null } | null;
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
    rawTask: meta.task ? { ...meta.task } : null,
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
 * 卡片该不该出现：只有「确定是没闭合的 front matter」才不显示。
 *
 * - **首个非空行是 `---`、但整段没闭合** → 用户正在写第一行（或外部文件被截断），此时任何改写都不可靠 → 不显示；
 * - 其余（含**完全没有** front matter）→ 显示，让用户能加第一个标签。
 *
 * 三处细节：
 * 1. 判据取「首个非空行」而不是「第一行」：开头可能有 BOM 或剪藏工具多写的空行
 *    （2026-10-11 同一天第二次因两边判据不一致而踩坑）；
 * 2. 这一句**逐字**比 `---`，不吃 CRLF、也不吃缩进——比 `frontmatterText` 更严的方向是安全的：
 *    宁可显示卡片，也别把唯一的属性入口藏掉；
 * 3. 真要判「有没有 front matter」时一律以 `frontmatterText` 为准（它才是唯一的解析判据）。
 */
export function shouldShowItemProps(body: string): boolean {
  const content = body.startsWith("\uFEFF") ? body.slice(1) : body;
  const first = content.split("\n").find((line) => line.trim() !== "");
  if (first !== "---") return true;
  return frontmatterText(body) !== null;
}

/*
  ## 折叠（2026-10-11 改）

  卡片自己**不再有折叠**：它现在整个住在一侧的贴边面板里（`DocRail`），
  展开/收起由那条轨道管（本机偏好仍在 `../props-collapse`，键名换成了语义相反的
  `menote:notes:props-open`）。从前这里有一行「chevron + 摘要」，折起来还逐条念
  「有几个标签、状态是什么」——那套随"位置改由轨道承担"一起删掉了：收起态只剩一条
  28px 的竖排把手，没有地方放摘要。
*/

export function ItemProps({
  body,
  editable,
  readOnlyReason,
  onTagsChange,
  onTaskChange,
  onForeignChange,
  onForeignRemove,
  onForeignAdd,
  library = [],
  onLibraryChange,
  labels,
  onError,
}: ItemPropsProps) {
  const props = readItemProps(body);
  /*
    这里不再取 `unrecognized`：2026-10-11 起路 A 把"原值不识别"的提示落在**那一行值控件下方**，
    段级横条已删。`readItemProps` 仍然返回它（有用例钉着这个解析结果），只是界面不用了。
  */
  const { tags, task, foreign, rawTask } = props;
  const disabled = !editable;

  /** 待确认删除的外来键（设计 §6.5：破坏性操作二次确认）；`null` = 没在确认 */
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  function guard(action: () => void): void {
    if (!editable) return;
    try {
      action();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "改不动这一项");
    }
  }

  /**
   * 路 A（2026-10-11 用户拍板）：清单键**有原文、但 MeNote 不认识**时，把原文交出去当选项。
   *
   * 从前这种情况界面显示的是归一化后的空值，用户改一次就把它覆盖掉了——现在 `status: unread`
   * 会作为「原样保留」摆在状态行上：看得见、能留着、不被静默改写。
   */
  function rawUnknown(field: "status" | "due" | "priority"): string | null {
    const raw = rawTask?.[field] ?? null;
    if (raw === null || raw === "") return null;
    return (task?.[field] ?? null) === null ? raw : null;
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

  /** 库变了就上报（`onLibraryChange` 可选：没有宿主接收时什么也不做，不静默改本地状态） */
  function changeLibrary(next: PropLibraryEntry[]): void {
    onLibraryChange?.(next);
  }

  /**
   * 「用一个属性」选中了一个**已经在库里**的键：只把它写进这一篇（空值），库不动。
   *
   * 与旧「+ 添加属性」的差别是这里**不再问键名**——键是菜单里选的，问一遍是白问。
   */
  function useForeign(key: string): void {
    if (foreign.some((one) => one.key === key)) return;
    guard(() => onForeignAdd(key, ""));
  }

  /** 「新建键…」：问键名 → 进库 → 写进这一篇。类型先给默认（管理页可改） */
  function newForeign(): void {
    const raw = window.prompt("键名（只能用字母、数字、下划线、连字符）");
    const key = (raw ?? "").trim();
    if (key === "") return;
    if (!PROP_KEY_PATTERN.test(key)) {
      onError?.("键名只能用字母、数字、下划线、连字符——含冒号或空格的键写进去会让整块 YAML 坏掉。");
      return;
    }
    if (RESERVED_PROP_KEYS.has(key)) {
      onError?.(`「${key}」是 MeNote 自己的键，上面已经有它的位置了。`);
      return;
    }
    if (foreign.some((one) => one.key === key)) {
      onError?.(`「${key}」已经在了。`);
      return;
    }
    changeLibrary(addEntry(library, key));
    guard(() => onForeignAdd(key, ""));
  }

  /**
   * 改一个外来键的值：先推回编辑器，再把"用户填过的这个值"报给库。
   *
   * 顺序与条件都重要：**只有值真的变了才上报**（`previous !== value`），否则光是点进来
   * 又点出去就会把这一篇的所有键收进库——设计 §6.4 要的是"用户主动动过"。
   */
  function changeForeign(key: string, previous: string, value: string, block: boolean): void {
    guard(() => onForeignChange(key, value, block));
    if (previous !== value && value !== "") changeLibrary(registerValue(library, key, value, block));
  }

  /** 把这一篇里一个"库还不知道"的键收进库（类型按它现在的形状给个默认） */
  function adoptForeign(key: string, block: boolean): void {
    changeLibrary(addEntry(library, key, block ? "multiline" : "text"));
  }

  return (
    <section className="itemprops itemprops--card" aria-label="属性">
      <div className="itemprops__inner">
      {/*
        只读原因从前只挂在每个控件的 `title` 上——不悬停就等于不存在。做成一行看得见的
        话（重设计 v1 §2.6），"为什么改不了"就不用用户去猜；能改的时候这一行不出现。
      */}
      {!editable && readOnlyReason ? <p className="itemprops__note">{readOnlyReason}</p> : null}
        <div className="itemprops__row">
          <span className="itemprops__label" id="itemprops-tags" title="tags">
            {labelFor(labels, "tags")}
          </span>
          <div className="itemprops__ctl">
            <div className="itemprops__chips">
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
          {/*
            动作列**每一行都留出那一格**（哪怕是空的）：只给"有动作"的行留，
            各行的值控件右边界就会一行一个样（用户 2026-10-11 说的"样式各不一致"）。
          */}
          <div className="itemprops__act" />
        </div>

        <div className="itemprops__row">
          <label className="itemprops__label" htmlFor="itemprops-status" title="status">
            {labelFor(labels, "status")}
          </label>
          <div className="itemprops__ctl">
            <select
              id="itemprops-status"
              className="itemprops__input"
              value={task?.status ?? rawUnknown("status") ?? ""}
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
              {task?.status || rawUnknown("status") ? null : <option value="">未设置</option>}
              {/* 路 A：不认识的原值自己占一个选项，选中它 = 原样留着（写回的仍是这个字符串） */}
              {rawUnknown("status") ? (
                <option value={rawUnknown("status") ?? ""}>{rawUnknown("status")}（原样保留）</option>
              ) : null}
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {/*
            路 A 的提示**收进这一行的行尾 ⓘ**（重设计 v2 §3）：值本身已经写着
            「unread（原样保留）」——"它没被改掉"这件事看得见，不必再占一行红黄字。
            完整口径（改别的值才会覆盖、留着不影响别的）在 ⓘ 里。
          */}
          <div className="itemprops__act">
            {rawUnknown("status") ? (
              <InfoHint label="状态值的说明">
                它已经被认成这一篇的清单状态。选中别的值才会把它改成 MeNote 的写法；
                留着不影响其它内容，下次保存也原样写回去。
              </InfoHint>
            ) : null}
          </div>
        </div>

        <div className="itemprops__row">
          <label className="itemprops__label" htmlFor="itemprops-due" title="due">
            {labelFor(labels, "due")}
          </label>
          <div className="itemprops__ctl">
            <input
              id="itemprops-due"
              /*
                路 A：截止值不是 `YYYY-MM-DD` 时改用纯文本框。`date` 控件拿到认不出的值会把它
                显示成空，失焦再写回一个空值——**等于把用户的数据抹掉**，宁可退成文本。
              */
              type={rawUnknown("due") ? "text" : "date"}
              className="itemprops__input"
              value={task?.due ?? rawUnknown("due") ?? ""}
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
          <div className="itemprops__act">
            {rawUnknown("due") ? (
              <InfoHint label="截止值的说明">
                MeNote 只认 `YYYY-MM-DD`。这个串不是那个形状，所以改用纯文本框原样摆着——
                交给日期控件的话，它会显示成空、一失焦就把这个值写没了。
              </InfoHint>
            ) : null}
          </div>
        </div>

        <div className="itemprops__row">
          <label className="itemprops__label" htmlFor="itemprops-priority" title="priority">
            {labelFor(labels, "priority")}
          </label>
          <div className="itemprops__ctl">
            <select
              id="itemprops-priority"
              className="itemprops__input"
              value={task?.priority ?? rawUnknown("priority") ?? ""}
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
              {/* 路 A：与状态行同一口径——不认识的原值作为一个可选项留着 */}
              {rawUnknown("priority") ? (
                <option value={rawUnknown("priority") ?? ""}>
                  {rawUnknown("priority")}（原样保留）
                </option>
              ) : null}
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="itemprops__act">
            {rawUnknown("priority") ? (
              <InfoHint label="优先级值的说明">
                选中别的值才会把它改成 MeNote 的写法；留着不影响其它内容。
              </InfoHint>
            ) : null}
          </div>
        </div>

      {/*
        被接管、但值不识别的键（如顶层 `status: unread`）：**必须说出来**，但不再是段级横条——
        2026-10-11 起走**路 A**：那三行各自把原值作为「原样保留」的选项摆出来，提示就落在
        它讲的那一行里（见上面各行的 `__note--warn`）。这里不再渲染任何东西。
      */}

      {/*
        「其他属性」这一段只在真有外来键（或可编辑、需要一个新增入口）时出现。它的存在感靠
        **一条细线 + 一行小字**（重设计 v2 §3）：不再有第二套分区标题样式，也不写
        「· 键名原样保留」那种自我说明——键名原样是这个组件的既定口径，不必每屏念一次。
      */}
      {foreign.length > 0 || editable ? (
        <>
          <div className="itemprops__sep" />
          <div className="itemprops__row">
            <div className="itemprops__group">其他属性</div>
          </div>
          {foreign.map((one) => {
            /*
              未入库 = 属性库还不知道这个键。（内置键不可能出现在 `foreign` 里：`title` / `tags` /
              清单三键都被 `mdcore` 当顶层白名单取走了。）
            */
            const entry = entryFor(library, one.key);
            return (
              <div className="itemprops__row" key={one.key}>
                {/* 名列显示的是显示名，`title` 永远是源名——写回 md、导出、分享的都是源名 */}
                <span className="itemprops__label" title={one.key}>
                  {labelFor(labels, one.key)}
                </span>
                <div className="itemprops__ctl">
                  <PropValueField
                    propKey={one.key}
                    entry={entry}
                    value={one.value}
                    block={one.block}
                    disabled={disabled}
                    readOnlyReason={readOnlyReason}
                    onCommit={(value, block) => changeForeign(one.key, one.value, value, block)}
                  />
                </div>
                <div className="itemprops__act">
                  {/*
                    「未入库」从前是一枚虚线 chip 加一行 11px 说明，两行字挤在值控件下面，
                    正是用户说的"属性录进来之后还与内置属性分成两套"。现在它和删除一样是
                    24px 的方形图标按钮，说明进 `title`——**动作的形状统一，才谈得上整齐**。
                  */}
                  {editable && !entry ? (
                    <button
                      type="button"
                      className="itemprops__icobtn"
                      aria-label={`收进属性库 ${one.key}`}
                      title={`把「${one.key}」收进属性库——只是让以后新建它时能选中、按类型给控件，不改这一篇的内容`}
                      onClick={() => adoptForeign(one.key, one.block)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="16" rx="2" />
                        <path d="M12 9v6M9 12h6" />
                      </svg>
                    </button>
                  ) : null}
                  {editable ? (
                    <button
                      type="button"
                      className="itemprops__icobtn itemprops__icobtn--danger"
                      aria-label={`本篇不再用 ${one.key}`}
                      title={`本篇不再用 ${one.key}`}
                      /*
                        这里的 ⓧ 是「本篇不用」，**不是删库条目**（用户 2026-10-11：删除只在管理页）。
                        破坏性后果（这一行 md 从这篇里消失、Obsidian 也看不到）仍要二次确认。
                      */
                      onClick={() => setPendingRemove(one.key)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {editable ? (
            <div className="itemprops__foot">
              <PropPicker
                library={library}
                labels={labels}
                used={foreign.map((one) => one.key)}
                onPick={useForeign}
                onNewKey={newForeign}
              />
            </div>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        open={pendingRemove !== null}
        title={pendingRemove === null ? "" : `本篇不再用 ${pendingRemove}？`}
        desc={
          pendingRemove === null
            ? ""
            : `这一篇不再有「${pendingRemove}」了：这篇 md 的 front matter 里那一行会被删掉，Obsidian 那边也看不到它。属性库里的定义还在（设置 › 属性库 里可以改或删），别的笔记不受影响。`
        }
        confirmLabel="从本篇移除"
        onConfirm={() => {
          const key = pendingRemove;
          setPendingRemove(null);
          if (key !== null) guard(() => onForeignRemove(key));
        }}
        onClose={() => setPendingRemove(null)}
      />
      </div>
    </section>
  );
}
