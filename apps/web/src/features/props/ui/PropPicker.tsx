/**
 * 「+ 用一个属性」菜单（2026-10-11，《MeNote 属性库设计 v1》v2.1 §6.1）。
 *
 * 前台**只能选库里的键、或新建一个键**：库的结构（改类型、改候选、删条目）只在设置 › 属性库
 * 动（用户 2026-10-11 口径：「删除某种属性只能在管理页面处理，前端编辑时只能选择用或者不用」）。
 * 所以这里是个没有编辑能力的纯选择菜单。
 *
 * 已经在用的键**不再列出来**：它们就在下面几行里，列出来点了也不会有任何变化。
 *
 * 菜单里的名字走**显示名**（重设计 v1 §4.3）：设了「链接」就显示「链接 · 单行文本」，
 * 源键名放进 `title`——**选中的仍然是源键**，md 里写出来的也永远是源键。
 */
import type { PropLibraryEntry } from "@menote/shared";
import { DropdownMenu, type MenuItemSpec } from "../../../app/ui/Menu";
import { labelFor, typeLabel, type PropLabels } from "../model";

export interface PropPickerProps {
  /** 属性库（账号级） */
  library: readonly PropLibraryEntry[];
  /** 这一篇已经在用的键 */
  used: readonly string[];
  /** 显示名表（账号级）；不传就一律显示源键名 */
  labels?: PropLabels;
  /** 新建键的入口交给宿主（它要弹输入框、校验、再写库与正文） */
  onNewKey: () => void;
  onPick: (key: string) => void;
}

export function PropPicker({ library, used, labels, onPick, onNewKey }: PropPickerProps) {
  const taken = new Set(used);
  const items: MenuItemSpec[] = library
    .filter((entry) => !taken.has(entry.key))
    .map((entry) => ({
      id: entry.key,
      label: `${labelFor(labels, entry.key)} · ${typeLabel(entry.type)}`,
      title: entry.key,
      onSelect: () => onPick(entry.key),
    }));
  items.push({ id: "__new__", label: "新建键…", onSelect: onNewKey });

  return (
    <DropdownMenu
      label="用一个属性"
      align="left"
      showChevron={false}
      header="用一个属性"
      trigger={<span className="itemprops__pick">+ 用一个属性</span>}
      items={items}
    />
  );
}
