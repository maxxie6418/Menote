// @vitest-environment jsdom
/**
 * 大表虚拟滚动（M4-9；《M4 界面稿》§2.9）。
 *
 * 窗口计算的数学在 `tables-model.test.ts` 里测；这里测**接进组件之后**的行为：
 * 只渲染可见段、上下有占位行撑高度、滚动后窗口跟着动、小表不窗口化。
 *
 * jsdom 没有布局，`clientHeight` 恒为 0——所以这里显式把它定义成 400，
 * 好让 hook 量到一个真实视口（量不出来时组件会自动退化成全渲染，那是另一条用例）。
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROW_ID_COLUMN, type TableDoc } from "@menote/mdcore";
import { DEFAULT_ROW_HEIGHT } from "../src/features/tables/model";
import { TableEditor } from "../src/features/tables/ui/TableEditor";

const VIEWPORT = 400;

function bigDoc(rowCount: number): TableDoc {
  return {
    columns: [
      { id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true },
      { id: "c1", name: "名称", type: "text" },
    ],
    rowIdColumn: ROW_ID_COLUMN,
    views: { default: "table" },
    rows: Array.from({ length: rowCount }, (_, index) => ({
      [ROW_ID_COLUMN]: `row${String(index).padStart(6, "0")}`,
      c1: `第 ${index} 行`,
    })),
    attachments: [],
    notices: [],
    preservedLines: [],
  };
}

function renderEditor(doc: TableDoc) {
  render(
    <TableEditor
      title="大表"
      doc={doc}
      onDocChange={vi.fn()}
      onRequestDegrade={vi.fn()}
    />,
  );
}

/** jsdom 里没有布局：把 clientHeight 显式给一个值，元素自己的 scrollTop 可以直接赋值 */
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => VIEWPORT,
  });
});

afterEach(() => {
  cleanup();
  if (originalClientHeight) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
  } else {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  }
});

describe("大表窗口化", () => {
  // 1000 行 + 真实测量：全量并行跑时逼近 vitest 默认 5s，给它显式的余量（2026-09-28）
  it("1000 行只渲染可见段 + 上下占位行", { timeout: 20_000 }, () => {
    renderEditor(bigDoc(1000));

    const rendered = document.querySelectorAll(".tablegrid__tr");
    const pads = document.querySelectorAll(".tablegrid__pad");
    // 视口 400 / 行高 36 → 12 行可见，上下各 8 行 overscan
    const expected = Math.ceil(VIEWPORT / DEFAULT_ROW_HEIGHT) + 16;
    expect(rendered).toHaveLength(expected);
    expect(pads).toHaveLength(1); // 顶部没占位（还没滚），底部有

    // 第一条渲染的是第 0 行
    expect(screen.getByText("第 0 行")).toBeTruthy();
    expect(screen.queryByText("第 999 行")).toBeNull();

    const bottomPad = pads[0] as HTMLElement;
    expect(Number.parseInt(bottomPad.style.height, 10)).toBe((1000 - expected) * DEFAULT_ROW_HEIGHT);
  });

  it("滚动后窗口跟着动：顶部出现占位行，且渲染的是那一段", { timeout: 20_000 }, () => {
    renderEditor(bigDoc(1000));
    const container = document.querySelector(".tablegrid__scroll") as HTMLDivElement;

    // 滚到第 500 行附近（原生 scroll 事件在 React 之外，要用 act 包住才看得到重渲染）
    act(() => {
      container.scrollTop = 500 * DEFAULT_ROW_HEIGHT;
      container.dispatchEvent(new Event("scroll"));
    });

    expect(screen.getByText("第 492 行")).toBeTruthy(); // 500 - overscan(8)
    expect(screen.queryByText("第 0 行")).toBeNull();

    const pads = [...document.querySelectorAll(".tablegrid__pad")] as HTMLElement[];
    expect(pads).toHaveLength(2);
    expect(Number.parseInt(pads[0]?.style.height ?? "0", 10)).toBe(492 * DEFAULT_ROW_HEIGHT);
  });

  it("小表（≤100 行）不窗口化：全渲染、没有占位行", () => {
    renderEditor(bigDoc(100));
    expect(document.querySelectorAll(".tablegrid__tr")).toHaveLength(100);
    expect(document.querySelectorAll(".tablegrid__pad")).toHaveLength(0);
  });

  it("占位行对读屏不可见（aria-hidden）", () => {
    renderEditor(bigDoc(1000));
    const pad = document.querySelector(".tablegrid__pad") as HTMLElement;
    expect(pad.getAttribute("aria-hidden")).toBe("true");
  });

  it("网格容器挂了 `hscroll` 且可聚焦（横条改成悬停才显形，键盘必须进得来）", () => {
    /*
      2026-10-04：横条从「常显」改成「悬停/聚焦才显形」。这条是那条改动的**前提**——
      容器不可聚焦，`:focus-within` 就不触发，横条对键盘用户等于彻底消失
      （DESIGN.md §6.1 不以悬停为唯一入口）。两个都要钉：类名（决定样式）与
      tabIndex（决定键盘能不能进来），少一半这条提示就只对鼠标用户存在。
    */
    renderEditor(bigDoc(10));
    const container = document.querySelector(".tablegrid__scroll") as HTMLElement;
    expect(container.classList.contains("hscroll"), "表格容器没挂 hscroll，横条会常显").toBe(true);
    expect(container.getAttribute("tabindex"), "表格容器不可聚焦").toBe("0");
  });
});
