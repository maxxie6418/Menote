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

export interface EditorToolbarProps {
  /** 整条禁用（如正文锁定），此时必须给 `disabledReason`（DESIGN §6.1：禁用要说明原因） */
  disabled?: boolean;
  disabledReason?: string;
  /** 按钮落点：宿主转发给编辑器句柄，工具栏自己不碰文档 */
  onCommand: (command: FormatCommandId, arg?: FormatCommandArg) => void;
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
  disabled,
  disabledReason,
  onCommand,
}: {
  spec: ToolSpec;
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
      size={13}
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

export function EditorToolbar({ disabled, disabledReason, onCommand }: EditorToolbarProps) {
  const heading = headingItems(onCommand);
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="格式" aria-disabled={disabled || undefined}>
      {/*
        禁用时不渲染真菜单：`DropdownMenu` 是公共组件，没有 disabled 口子——
        为禁用态给它加参数，比在这里放一个"点了还是会开"的菜单划算。
      */}
      {disabled ? (
        <IconButton label="标题样式" icon="heading" size={13} disabled title={disabledReason} />
      ) : (
        <DropdownMenu
          /* 不叫「标题」：正文区的标题输入框已经占了这个可访问名，重名会砸了按名查询的用例 */
          label="标题样式"
          align="left"
          trigger={
            <span className="editor-toolbar__menu-trigger" aria-hidden="true">
              <Icon name="heading" size={13} />
            </span>
          }
          items={heading}
        />
      )}
      <GroupSeparator />
      {EMPHASIS_TOOLS.map((spec) => (
        <ToolButton key={spec.id} spec={spec} disabled={disabled} disabledReason={disabledReason} onCommand={onCommand} />
      ))}
      <GroupSeparator />
      {LIST_TOOLS.map((spec) => (
        <ToolButton key={spec.id} spec={spec} disabled={disabled} disabledReason={disabledReason} onCommand={onCommand} />
      ))}
      <GroupSeparator />
      {INSERT_TOOLS.map((spec) => (
        <ToolButton key={spec.id} spec={spec} disabled={disabled} disabledReason={disabledReason} onCommand={onCommand} />
      ))}
    </div>
  );
}
