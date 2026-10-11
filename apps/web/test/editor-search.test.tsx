// @vitest-environment jsdom
/**
 * 查找/替换面板（编辑器专项优化 P3）。
 *
 * 用**真 CM6**（jsdom 补布局存根，同 `editor-live-repaint` 的做法）走一遍用户路径：
 * 打开面板 → 输入查询词 → 计数正确 → 全部替换写回文档、句柄读得到。
 * 面板 DOM 是 `search-panel.ts` 现拼的（无 React），断言直接落在 DOM 上。
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Editor, type EditorHandle } from "../src/app/editor/Editor";

function patchClientRects(): void {
  const proto = Range.prototype as unknown as {
    getClientRects?: () => DOMRectList;
    getBoundingClientRect?: () => DOMRect;
  };
  proto.getClientRects = () => [] as unknown as DOMRectList;
  proto.getBoundingClientRect = () => ({
    x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}),
  } as DOMRect);
  /* 面板的尺寸联动挂在 ResizeObserver 上，jsdom 没有这个构造器——给个空壳 */
  const holder = globalThis as unknown as { ResizeObserver?: unknown };
  if (!holder.ResizeObserver) {
    holder.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
}

function unpatchClientRects(): void {
  const proto = Range.prototype as unknown as Record<string, unknown>;
  delete proto.getClientRects;
  delete proto.getBoundingClientRect;
}

let handle: EditorHandle | null = null;

beforeEach(() => {
  patchClientRects();
  handle = null;
});

afterEach(() => {
  cleanup();
  unpatchClientRects();
});

function setup(initial: string): HTMLElement {
  const { container } = render(
    <Editor initialValue={initial} onChange={() => {}} onReady={(h) => (handle = h)} />,
  );
  return container;
}

describe("查找/替换面板", () => {
  it("打开面板、输入查询词、计数正确", async () => {
    setup("甲乙甲丙甲");
    handle!.openSearch("find");
    const panel = document.querySelector(".cm-note-search") as HTMLElement | null;
    expect(panel).not.toBeNull();
    const field = panel!.querySelector<HTMLTextAreaElement>('textarea[name="search"]')!;
    fireEvent.input(field, { target: { value: "甲" } });
    await waitFor(() => {
      // 计数是「当前/总数」；打开面板会自动跳到第一处
      expect(panel!.querySelector(".cm-note-search-count")?.textContent).toMatch(/\/3$/);
    });
  });

  it("全部替换写回文档，句柄读得到新正文", async () => {
    setup("甲乙甲丙甲");
    handle!.openSearch("replace");
    const panel = document.querySelector(".cm-note-search") as HTMLElement;
    const field = panel.querySelector<HTMLTextAreaElement>('textarea[name="search"]')!;
    fireEvent.input(field, { target: { value: "甲" } });
    await waitFor(() => {
      expect(panel.querySelector(".cm-note-search-count")?.textContent).toMatch(/\/3$/);
    });
    const replaceField = panel.querySelector<HTMLTextAreaElement>('textarea[name="replace"]')!;
    fireEvent.input(replaceField, { target: { value: "丁" } });
    const all = panel.querySelector<HTMLButtonElement>('[name="replace-all"]')!;
    expect(all.disabled).toBe(false);
    all.click();
    expect(handle!.read()).toBe("丁乙丁丙丁");
  });

  it("正则查询可用，坏正则不炸", async () => {
    setup("a1b2c3");
    handle!.openSearch("find");
    const panel = document.querySelector(".cm-note-search") as HTMLElement;
    const field = panel.querySelector<HTMLTextAreaElement>('textarea[name="search"]')!;
    const regexp = panel.querySelector<HTMLInputElement>('[name="regexp"]')!;
    fireEvent.click(regexp);
    fireEvent.input(field, { target: { value: "[0-9]" } });
    await waitFor(() => {
      expect(panel.querySelector(".cm-note-search-count")?.textContent).toMatch(/\/3$/);
    });
    // 坏正则：查询标记无效，界面给提示而不是抛异常
    fireEvent.input(field, { target: { value: "[0-9" } });
    await waitFor(() => {
      expect(field.getAttribute("aria-invalid")).toBe("true");
    });
  });
});
