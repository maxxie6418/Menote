// @vitest-environment jsdom
/**
 * 应用级错误边界（2026-10-04）。
 *
 * 钉的是**一条真实的失败路径**：入口的 `main.tsx` 此前是
 * `void import("./app/App").then((m) => root.render(...))`——没有 `catch`、外面也没有边界。
 * 动态导入一失败（部署半程、chunk 404、CSP + nosniff 把 SPA 回退的 HTML 拒了），
 * `.then` 不执行，页面就停在空的 `#root` 上：**纯白、无提示、只能手动刷新**。
 *
 * 那次线上整站白屏就是这么来的——而本地同一个构建产物跑得通、1971 个用例全绿。
 * 「失败被吞成空白」会把部署问题伪装成代码问题，所以这一层必须有。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "../src/app/ui/AppErrorBoundary";

afterEach(cleanup);

/** 一个会炸的子组件——模拟渲染期抛错 */
function Boom(): never {
  throw new Error("渲染炸了");
}

describe("AppErrorBoundary", () => {
  it("子树正常时原样渲染，不多不少", () => {
    render(
      <AppErrorBoundary>
        <p>正文还在</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("正文还在")).toBeTruthy();
    expect(screen.queryByText("页面没能加载出来")).toBeNull();
  });

  it("子树抛错 → 显示失败屏，不再是一片白", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("页面没能加载出来")).toBeTruthy();
    vi.restoreAllMocks();
  });

  it("入口导入失败（loadError）也能显示——树还没建起来，catch 接不到", () => {
    render(<AppErrorBoundary loadError={new TypeError("Failed to fetch dynamically imported module")} />);
    expect(screen.getByText("页面没能加载出来")).toBeTruthy();
  });

  it("chunk 取不到时给一句人话 + 一个能自救的重新加载", () => {
    render(<AppErrorBoundary loadError={new TypeError("Failed to fetch dynamically imported module")} />);
    // 说的是人话，不是把异常原文甩给用户
    expect(screen.getByText(/程序文件没取到/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeTruthy();
  });

  it("普通渲染错误不给「重新加载」——重载解决不了它", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );
    expect(screen.queryByRole("button", { name: "重新加载" })).toBeNull();
    vi.restoreAllMocks();
  });
});
