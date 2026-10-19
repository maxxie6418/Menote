/**
 * 正文格式工具栏（编辑器专项优化 P1，蓝本：inkstone `EditorToolbar.tsx` 的按钮分组）。
 *
 * **只做呈现与转发**：不认识 CodeMirror、不拼 Markdown——每个按钮把命令 id 交给
 * `onCommand`，落盘走 `EditorHandle.applyFormat`（`format-commands.ts` 是唯一拼装处）。
 * 将来 `/` 菜单要加按钮级入口，也调同一个通道。
 *
 * 视觉对照 `DESIGN.md`：幽灵档图标按钮（§5.1 弱操作）、sprite 图标 13px（§5.5）、
 * 提示含键位且写在 `title` 上（§6.3 规则 3）、标题菜单用 `DropdownMenu`（§6.4 浮层行为）。
 * 按钮分组与蓝本一致：标题 | 强调类 | 列表类 | 引用链接类 | 代码块。
 */
import { IconButton } from "../ui/Controls";
import { DropdownMenu, type MenuItemSpec } from "../ui/Menu";
import { Icon, type IconName } from "../ui/Icon";
import type { FormatCommandArg, FormatCommandId } from "./format-commands";
import { hintFor } from "./shortcuts";
import {
  DEFAULT_TOOLBAR_SIZE,
  TOOLBAR_ICON_SIZE,
  type ToolbarIconSize,
  type ToolbarSize,
} from "./toolbar-size";

export interface EditorToolbarProps {
  /** 整条禁用（如正文锁定），此时必须给 `disabledReason`（DESIGN §6.1：禁用要说明原因） */
  disabled?: boolean;
  disabledReason?: string;
  /** 按钮落点：宿主转发给编辑器句柄，工具栏自己不碰文档 */
  onCommand: (command: FormatCommandId, arg?: FormatCommandArg) => void;
  /** 打开查找面板（P3）：工具栏不持有视图，转发给宿主 → `EditorHandle.openSearch("find")` */
  onFind: () => void;
  /**
   * 添加附件（v0.8.39 从模式切换条旁搬来）：工具栏同样**不持有文件输入**，
   * 只转发给宿主的隐藏 `<input type="file">`。不传就不渲染这颗按钮（表格档没有它）。
   */
  onAttach?: () => void;
  /**
   * 工具栏大小（v0.8.40，设置 › 编辑设置 › 工具栏）：**本机偏好**，不传按「中」。
   *
   * 为什么是 props 而不是让这里自己读 localStorage：`NoteWorkspace` 才是"本机偏好"的读取处
   * （它与 `editor-mode.ts` / `props-collapse.ts` 同层），工具栏保持**只做呈现与转发**——
   * 组件里混一次存储读取，测试就得为它造 localStorage。
   */
  size?: ToolbarSize;
}

/** 一枚格式按钮需要的最小描述 */
interface ToolSpec {
  /** 兼作键位反查 id 与测试钩子 */
  id: string;
  label: string;
  icon: IconName;
  command: FormatCommandId;
}

const EMPHASIS_TOOLS: readonly ToolSpec[] = [
  { id: "bold", label: "加粗", icon: "bold", command: "bold" },
  { id: "italic", label: "斜体", icon: "italic", command: "italic" },
  { id: "strikethrough", label: "删除线", icon: "strikethrough", command: "strikethrough" },
  { id: "inline-code", label: "行内代码", icon: "code", command: "inline-code" },
];

const LIST_TOOLS: readonly ToolSpec[] = [
  { id: "bullet-list", label: "无序列表", icon: "list-ul", command: "bullet-list" },
  { id: "ordered-list", label: "有序列表", icon: "list-ol", command: "ordered-list" },
  { id: "task-list", label: "任务清单", icon: "check-square", command: "task-list" },
  { id: "quote", label: "引用", icon: "quote", command: "quote" },
];

const INSERT_TOOLS: readonly ToolSpec[] = [
  { id: "link", label: "链接", icon: "link", command: "link" },
  { id: "code-block", label: "代码块", icon: "code-block", command: "code-block" },
];

/** 标题菜单的条目：正文 + 六级标题（inkstone 同款分组）；条目的 `title` 带各自的键位 */
function headingItems(onCommand: EditorToolbarProps["onCommand"]): MenuItemSpec[] {
  return [
    {
      id: "heading-0",
      label: "正文",
      title: hintFor("heading-0", "正文"),
      onSelect: () => onCommand("heading", { headingLevel: 0 }),
    },
    ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
      id: `heading-${level}`,
      label: `${"#".repeat(level)} 标题 ${level}`,
      title: hintFor(`heading-${level}`, `标题 ${level}`),
      onSelect: () => onCommand("heading", { headingLevel: level }),
    })),
  ];
}

function ToolButton({
  spec,
  iconSize,
  disabled,
  disabledReason,
  onCommand,
}: {
  spec: ToolSpec;
  iconSize: ToolbarIconSize;
  disabled?: boolean;
  disabledReason?: string;
  onCommand: EditorToolbarProps["onCommand"];
}) {
  const hint = hintFor(spec.id, spec.label);
  return (
    <IconButton
      /* 禁用时的可访问名就是动作本身；键位提示只属于可用的按钮 */
      label={disabled ? spec.label : hint}
      icon={spec.icon}
      size={iconSize}
      disabled={disabled}
      title={disabled ? disabledReason : hint}
      data-toolbar-button={spec.id}
      onClick={() => onCommand(spec.command)}
    />
  );
}

/** 组间细分隔线（纯装饰，对辅助技术隐藏） */
function GroupSeparator() {
  return <span className="editor-toolbar__sep" aria-hidden="true" />;
}

export function EditorToolbar({
  disabled,
  disabledReason,
  onCommand,
  onFind,
  onAttach,
  size = DEFAULT_TOOLBAR_SIZE,
}: EditorToolbarProps) {
  const heading = headingItems(onCommand);
  const findHint = hintFor("find", "查找与替换");
  const attachHint = hintFor("attach", "添加附件");
  /* 图标尺寸只能走 prop（图标的 width/height 由组件写出）；盒子的内边距由 `app.css` 按 `data-size` 调 */
  const iconSize = TOOLBAR_ICON_SIZE[size];
  return (
    <div
      className="editor-toolbar"
      role="toolbar"
      aria-label="格式"
      data-size={size}
      aria-disabled={disabled || undefined}
    >
      {/*
        按钮排在内层盒子里：收窄与居中的那组规则与属性带共用（见 `app.css` 的
        `.itemprops__inner`），这样按钮列和文章左边界对齐，而分隔线仍留在整条带上。
      */}
      <div className="editor-toolbar__inner">
        {/*
          查找放最前（蓝本同位）：它是"操作"不是"格式"，与后面格式按钮用分隔线隔开。
          面板本体在编辑器里（`app/editor/search.ts`），这里只是入口。
        */}
        <IconButton
          label={findHint}
          icon="search"
          size={iconSize}
          disabled={disabled}
          title={disabled ? disabledReason : findHint}
          data-toolbar-button="find"
          onClick={onFind}
        />
        <GroupSeparator />
        {/*
          禁用时不渲染真菜单：`DropdownMenu` 是公共组件，没有 disabled 口子——
          为禁用态给它加参数，比在这里放一个"点了还是会开"的菜单划算。
        */}
        {disabled ? (
          <IconButton label="标题样式" icon="heading" size={iconSize} disabled title={disabledReason} />
        ) : (
          <DropdownMenu
            /* 不叫「标题」：正文区的标题输入框已经占了这个可访问名，重名会砸了按名查询的用例 */
            label="标题样式"
            align="left"
            trigger={
              <span className="editor-toolbar__menu-trigger" aria-hidden="true">
                <Icon name="heading" size={iconSize} />
              </span>
            }
            items={heading}
          />
        )}
        <GroupSeparator />
        {EMPHASIS_TOOLS.map((spec) => (
          <ToolButton
            key={spec.id}
            spec={spec}
            iconSize={iconSize}
            disabled={disabled}
            disabledReason={disabledReason}
            onCommand={onCommand}
          />
        ))}
        <GroupSeparator />
        {LIST_TOOLS.map((spec) => (
          <ToolButton
            key={spec.id}
            spec={spec}
            iconSize={iconSize}
            disabled={disabled}
            disabledReason={disabledReason}
            onCommand={onCommand}
          />
        ))}
        <GroupSeparator />
        {INSERT_TOOLS.map((spec) => (
          <ToolButton
            key={spec.id}
            spec={spec}
            iconSize={iconSize}
            disabled={disabled}
            disabledReason={disabledReason}
            onCommand={onCommand}
          />
        ))}
        {/*
          添加附件排在插入组之后（v0.8.39）：它是"插入一个附件引用"的动作，与链接、代码块同类，
          原先挤在正文区右上角的模式切换条旁，与"即时渲染 / 仅预览"这种**看**的开关混在一排。
        */}
        {onAttach ? (
          <>
            <GroupSeparator />
            <IconButton
              label={disabled ? "添加附件" : attachHint}
              icon="image"
              size={iconSize}
              disabled={disabled}
              title={disabled ? disabledReason : attachHint}
              data-toolbar-button="attach"
              onClick={onAttach}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
