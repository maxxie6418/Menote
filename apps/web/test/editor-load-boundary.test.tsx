// @vitest-environment jsdom
/**
 * 正文区片内的懒加载错误边界（设计 v1 §3.4 / 验收 A11）。
 *
 * 两条都要钉住：
 * 1. 编辑器加载失败**不能白屏**——正文区给一句话 + 一颗「重试」；
 * 2. 「重试」必须真的能救回来：它同时清掉被拒的 Promise（由调用方 `resetEditorLoad`）
 *    并换一个新的 `lazy` 组件，所以按钮回调一定要被调到。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorLoadBoundary } from "../src/app/editor/EditorLoadBoundary";

afterEach(cleanup);

/** 一个会炸的子组件——模拟懒加载 chunk 取不到 */
function Boom(): never {
  throw new Error("Failed to fetch dynamically imported module");
}

describe("EditorLoadBoundary", () => {
  it("子树正常时原样渲染", () => {
    render(
      <EditorLoadBoundary onRetry={() => undefined}>
        <p>正文还在</p>
      </EditorLoadBoundary>,
    );
    expect(screen.getByText("正文还在")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("子树抛错 → 正文区显示失败提示与「重试」，不是白屏", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <EditorLoadBoundary onRetry={() => undefined}>
        <Boom />
      </EditorLoadBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("编辑器加载失败")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });

  it("点「重试」会通知调用方（由它清掉被拒的 Promise 并换新组件）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onRetry = vi.fn();
    render(
      <EditorLoadBoundary onRetry={onRetry}>
        <Boom />
      </EditorLoadBoundary>,
    );
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
