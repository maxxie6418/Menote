// @vitest-environment jsdom
/**
 * `DropdownMenu` 的弹出方向与限高（2026-10-04）。
 *
 * 纯函数（`menuPlacement` / `menuMaxHeight` / `menuBoundsFor`）在 `menu-placement.test.ts`
 * 里逐条覆盖；这里只盯**接线**——纯函数对了而组件没调等于没修（本仓踩过"测了函数没测接线"）。
 *
 * 两件事：
 * 1. **DESIGN.md §6.4-1 一直没能落地**：空间不足要"自动向上翻"，而 `DropdownMenu` 此前把
 *    `top: calc(100% + 6px)` 写死在 JSX 里，锚点靠下时菜单被视口裁掉半截。
 * 2. **锚点在会裁剪的祖先里时菜单必被裁**：表格的行/列/取值菜单锚在 `.tablegrid__scroll`
 *    （`overflow: auto`）内部，`position: absolute` 的菜单被那个滚动容器裁掉——**与层级无关**，
 *    调 `z-index` 一点用没有。所以边界必须取"最近的一个会裁剪的祖先"，不是 `window.innerHeight`。
 *
 * jsdom 没有排版引擎（`getBoundingClientRect` 恒为 0、`window.innerHeight` 固定 768），
 * 所以这里把 rect 钉死来构造场景——这正是"在 jsdom 里量布局"的标准做法。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DropdownMenu } from "../src/app/ui/Menu";
import { MENU_GAP } from "../src/app/editor/menu-placement";

afterEach(cleanup);

interface Box {
  top: number;
  bottom: number;
}

function rectOf(box: Box): DOMRect {
  return {
    top: box.top,
    bottom: box.bottom,
    left: 0,
    right: 0,
    width: 0,
    height: box.bottom - box.top,
    x: 0,
    y: box.top,
    toJSON: () => ({}),
  } as unknown as DOMRect;
}

const ITEMS = [{ id: "a", label: "甲", onSelect: () => undefined }];

/**
 * 宿主：`clip` 给了就套一层**会裁剪的**祖先（模拟 `.tablegrid__scroll`），
 * 否则菜单直接在根下（边界 = 视口）。
 *
 * 两个轴都显式写：浏览器把 `overflow: auto` 展开成 `overflow-x/y: auto`，而 jsdom 的
 * `getComputedStyle` 不一定展开这个简写，只写 `overflow` 会量不到边界。
 */
function Harness({ clip }: { clip: Box | null }): React.ReactElement {
  const menu = <DropdownMenu label="测试菜单" trigger={<span>触发</span>} items={ITEMS} />;
  if (clip === null) return menu;
  return (
    <div data-testid="clip" style={{ overflow: "auto", overflowX: "auto", overflowY: "auto" }}>
      {menu}
    </div>
  );
}

/** 钉好两处 rect（裁剪祖先 + 锚点），打开菜单并返回菜单元素 */
async function openMenu(clip: Box | null, anchor: Box): Promise<HTMLElement> {
  render(<Harness clip={clip} />);

  if (clip !== null) {
    vi.spyOn(screen.getByTestId("clip"), "getBoundingClientRect").mockReturnValue(rectOf(clip));
  }
  const trigger = screen.getByRole("button", { name: "测试菜单" });
  // `measure()` 量的是 `DropdownMenu` 自己那层 `position: relative` 的包裹 div（不是按钮）
  vi.spyOn(trigger.parentElement as Element, "getBoundingClientRect").mockReturnValue(rectOf(anchor));

  await userEvent.setup().click(trigger);
  return screen.getByRole("menu", { name: "测试菜单" });
}

describe("锚定菜单的弹出方向（DESIGN.md §6.4-1）", () => {
  it("下方没有空间 → 向上弹（写死向下时这里会红：bottom 为空、top 有值）", async () => {
    // 裁剪边界 100–400，锚点 390–400：向下 −6、向上 284 → 向上
    const menu = await openMenu({ top: 100, bottom: 400 }, { top: 390, bottom: 400 });
    expect(menu.style.bottom).toBe(`calc(100% + ${MENU_GAP}px)`);
    expect(menu.style.top, "向上弹时不能再写 top，两个都写会被拉成 0 高").toBe("");
  });

  it("下方有空间 → 向下弹（账户菜单、绝大多数场景保持原样）", async () => {
    // 锚点 110–120：向下 274、向上 −6 → 向下
    const menu = await openMenu({ top: 100, bottom: 400 }, { top: 110, bottom: 120 });
    expect(menu.style.top).toBe(`calc(100% + ${MENU_GAP}px)`);
    expect(menu.style.bottom).toBe("");
  });
});

describe("锚定菜单的限高（表格菜单被裁就是漏了这一步）", () => {
  it("按「最近的会裁剪的祖先」算，不是 window.innerHeight", async () => {
    const menu = await openMenu({ top: 100, bottom: 400 }, { top: 200, bottom: 210 });
    // 向下可用：400 − 210 − 6 = 184
    expect(menu.style.maxHeight).toBe("184px");
    // 若误按视口算会得到 768 − 210 − 6 = 552 —— 那个值会让菜单被滚动容器裁掉，正是原症状
    expect(menu.style.maxHeight).not.toBe(`${window.innerHeight - 210 - MENU_GAP}px`);
  });

  it("没有裁剪祖先时按视口算", async () => {
    const menu = await openMenu(null, { top: 200, bottom: 210 });
    expect(menu.style.maxHeight).toBe(`${window.innerHeight - 210 - MENU_GAP}px`);
  });

  it("贴着边界量出 0 或负数时不写死限高，交给 CSS 自然高度（不出现负的 max-height）", async () => {
    // 裁剪边界与锚点完全重合：上下都放不下间隙。此时给 0 会把菜单压没，宁可不写。
    const menu = await openMenu({ top: 100, bottom: 120 }, { top: 100, bottom: 120 });
    expect(menu.style.maxHeight).toBe("");
  });
});
