/**
 * 锚定菜单（DESIGN.md §6.4：锚定触发元素、点击外部关闭、`Esc` 关闭、同一时刻只允许一个菜单）。
 *
 * 键盘：`Enter` / `Space` / `↓` 打开并把焦点移入首项，`↑` `↓` 移动，`Esc` 关闭并**把焦点还给触发器**。
 *
 * 【2026-10-04】弹出方向与限高改由 `editor/menu-placement.ts` 算（此前一律向下 `top: calc(100% + 6px)`，
 * 写死在 JSX 里）。两件事一起解决：
 * 1. **DESIGN.md §6.4-1 一直没能落地**：空间不足时要"自动向上翻"，而这里是写死的向下——锚点靠下
 *    时菜单直接被视口裁掉半截。
 * 2. **锚点在会裁剪的祖先里时菜单必被裁**：表格的行/列/取值菜单锚在 `.tablegrid__scroll`
 *    （`overflow: auto`）内部，`position: absolute` 的菜单被那个滚动容器裁掉，与层级无关。
 *    `menuBoundsFor` 找的正是"最近的一个会裁剪的祖先"（不是 `window.innerHeight`——窗口里那个
 *    `overflow: hidden` 的 `.modal` 才是边界），量到边界内放得下就压 `max-height`，由 CSS 自己滚。
 *
 * 沿用仓库既有的做法而不是挂 portal：`CommandMenu` 走的也是 `menu-placement.ts`（同一个纯函数），
 * 菜单打开期间窗口尺寸 / 滚动位置变化不重量——菜单是绝对定位在触发元素上的，会跟着内容一起动。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { menuBoxForNode, type MenuBox } from "../editor/menu-placement";

export interface MenuItemSpec {
  id: string;
  label: string;
  icon?: IconName;
  onSelect: () => void;
  /** 禁用时**必须**给 `title` 说明原因（DESIGN.md §6.1） */
  disabled?: boolean;
  title?: string;
  /**
   * 选中后**不关闭菜单**（需求 M18-03：菜单里的主题切换切完不收起，便于连续比色）。
   * 其余项点完即收起。
   */
  keepOpen?: boolean;
  /**
   * 破坏性操作（删除、清空、永久删除）：用危险色文字（`DESIGN.md` §5.1 的"危险操作"）。
   * 危险操作在**执行前**仍必须二次确认——样式只负责提醒，不代替确认。
   */
  danger?: boolean;
}

export interface DropdownMenuProps {
  /** 触发按钮的无障碍名称 */
  label: string;
  trigger: ReactNode;
  header?: ReactNode;
  /**
   * 自定义内容块（渲染在头部之后、条目之前）。
   * 用于放"一排三档"这类**不是单个菜单项**的控件（例如账户菜单里的主题切换）——
   * 菜单项是 `role="menuitem"` 的按钮，里面不能再嵌按钮。
   */
  blocks?: ReactNode;
  items: MenuItemSpec[];
  align?: "left" | "right";
  /** 触发元素本身已是图标按钮时（如笔记本的 `+`）不需要再挂箭头 */
  showChevron?: boolean;
}

export function DropdownMenu({
  label,
  trigger,
  header,
  blocks,
  items,
  align = "right",
  showChevron = true,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  /** 打开那一刻量一次的方向与限高（量不到时为 `null`，走 CSS 的自然高度） */
  const [box, setBox] = useState<MenuBox | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /**
   * 量锚点与最近的裁剪祖先，算出往哪边弹、能有多高。
   *
   * 第三个参数传 `Infinity` 而不是 `MENU_MAX_HEIGHT`（232）：那个上限是 `.cmd-menu` 自己的规格，
   * 锚定菜单**不设固定限高**，只压到"边界内放得下"为止——账户菜单六项加上账户头本来就比 232 高，
   * 套那个上限会平白变成一个要滚的矮菜单。
   */
  function measure(): MenuBox {
    return menuBoxForNode(rootRef.current, window.innerHeight, Number.POSITIVE_INFINITY);
  }

  function show(): void {
    // 在同一个事件里量：不在 effect 里 setState（多一轮渲染，`set-state-in-effect` 也会拦）
    setBox(measure());
    setOpen(true);
  }

  function hide(): void {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    itemRefs.current[0]?.focus();

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function moveFocus(delta: number): void {
    const focusable = itemRefs.current.filter((node): node is HTMLButtonElement => node !== null);
    if (focusable.length === 0) return;
    const current = focusable.findIndex((node) => node === document.activeElement);
    const next = (current + delta + focusable.length) % focusable.length;
    focusable[next]?.focus();
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => (open ? hide() : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            show();
          }
        }}
        style={{ display: "flex", alignItems: "center", gap: 2, padding: 0 }}
      >
        {trigger}
        {showChevron ? <Icon name="chevron-down" size={13} /> : null}
      </button>

      {open ? (
        <div
          className="menu"
          role="menu"
          aria-label={label}
          /*
            方向与限高按打开那一刻量到的边界给（`box` 为 `null` 时退回 CSS 的自然高度）：
            向上弹写 `bottom`、向下弹写 `top`，另一个不写——两个都写会被拉成 0 高。
            `maxHeight` 只在量到正数时给；空间为负（量不到布局）时不压，交给 CSS。
          */
          style={{
            ...(box?.placement === "up"
              ? { bottom: "calc(100% + 6px)" }
              : { top: "calc(100% + 6px)" }),
            ...(box && box.maxHeight > 0 ? { maxHeight: box.maxHeight } : {}),
            [align]: 0,
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveFocus(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveFocus(-1);
            }
          }}
        >
          {header ? <div className="menu__head">{header}</div> : null}
          {header ? <div className="menu__sep" /> : null}
          {blocks ? <div className="menu__block">{blocks}</div> : null}
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              className={item.danger ? "menu__item menu__item--danger" : "menu__item"}
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                if (!item.keepOpen) setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon ? <Icon name={item.icon} size={16} /> : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
