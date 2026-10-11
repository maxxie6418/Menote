// @vitest-environment jsdom
/**
 * 即时渲染的**重建时机**回归（编辑器专项优化 P1 期间实证的 v0.6.5 回归）。
 *
 * 缺陷：装饰重算搬进定时器（停手 90ms / 下一帧）之后，重算只改插件的 `decorations`
 * 字段——CodeMirror 只在下一次 update 时才重读这个字段。打字场景每次按键都会带出一次
 * update，把上一次的重建"顺带"刷出去，所以平时看不出来；**粘贴**这类"编辑之后不再有
 * 任何输入"的场景就永远停在源码。
 *
 * 修法：定时器路径的重算末尾补一个空事务（`view.dispatch()`），强制走一遍 update 循环。
 * 本文件用**真 CM6**（jsdom 补两个零矩形存根，同 `editor-readonly.test.tsx` 的做法）钉住：
 * "编辑之后不再有任何输入，装饰也必须在定时器到点后出现在 DOM 里"。
 *
 * 只断言「标记被藏起来」这一行为（`**` 不再出现在可见 DOM），不断言装饰长什么样——
 * 装饰的构成归 `live-preview.test.ts` 的纯函数用例管。
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  vi.useRealTimers();
});

describe("即时渲染：编辑之后不再有输入也会渲染（粘贴回归）", () => {
  it("插入一段粗体后只等定时器、不做任何交互，标记从可见 DOM 消失", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container } = render(
      <Editor
        initialValue=""
        live
        onChange={() => {}}
        onReady={(h) => {
          handle = h;
        }}
      />,
    );
    const content = container.querySelector(".cm-content") as HTMLElement | null;
    expect(content).not.toBeNull();

    // 模拟粘贴：一次事务插入一段 Markdown，之后**不再有任何用户输入**
    handle!.insert("# 粘贴渲染检查\n\n正文**加粗**结束");
    // 插入本身的事务会重算一次（同步路径），此刻标记还在——插入的事务里装饰按旧集合映射
    expect(content!.textContent).toContain("**加粗**");

    // 走到定时器：90ms 停手窗口 + 空事务触发重画
    await vi.advanceTimersByTimeAsync(120);

    // 关键断言：没有第二次交互，`**` 也必须已经从可见 DOM 里消失（被装饰替换掉）
    expect(content!.textContent).not.toContain("**");
    expect(content!.textContent).toContain("加粗");
  });
});
