/**
 * 应用级错误边界（2026-10-04）。
 *
 * ## 为什么必须有它
 *
 * 此前 `main.tsx` 是这样的：
 *
 * ```tsx
 * void import("./app/App").then((module) => root.render(<App />));
 * ```
 *
 * **没有 `catch`，外面也没有任何边界**。于是入口那个动态导入一旦失败（部署半程、
 * CDN 抖动、CSP + `nosniff` 把 SPA 回退的 HTML 当脚本拒掉、chunk 404），`.then` 永远
 * 不执行，页面就停在空的 `#root` 上——**一片白，没有任何提示，除了手动刷新没别的办法**。
 *
 * 真实发生过一次：线上整站白屏，而本地同一个构建产物跑得通、1971 个用例全绿、console
 * 零报错。**「失败被吞成空白」这条路径，会把一次部署问题伪装成「代码坏了」**，查起来极贵。
 *
 * ## 这一层只做两件事
 *
 * 1. **把失败显示出来**（DESIGN.md §6.1：禁止静默等待）。挂掉时必须有一句人话说明白。
 * 2. **给一条能自救的出路**。重新加载是有用的——重新加载会拿到新的 HTML 与新的 chunk
 * 清单，半程部署那种情况一次就能过去，用户不必打开控制台。
 *
 * **刻意不做的事**：不吞错误、不自动重试（自动重试在网络持续故障时只会变成死循环）、
 * 不往界面上堆排查信息。要细节的用户自己开控制台，这里只给结论与出路。
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Controls";

export interface AppErrorBoundaryProps {
  /** 可选：入口导入失败时树还没建起来，此时只有 `loadError`、没有 children */
  children?: ReactNode;
  /**
   * 「还没挂上就失败了」时由调用方传进来——入口的动态导入失败属于这一种：
   * 树还没建起来，**这个边界自己也接不到**（`componentDidCatch` 只管已经渲染过的子树）。
   */
  loadError?: unknown;
}

interface AppErrorBoundaryState {
  error: unknown;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // 留在控制台里：界面上只给结论，排查的人自己开控制台看栈
    console.error("[menote] 应用渲染失败", error, info.componentStack);
  }

  override render(): ReactNode {
    const { loadError, children } = this.props;
    const error = loadError ?? this.state.error;
    if (error === null || error === undefined) return children;

    const isChunk = /dynamically imported module|Loading chunk|Failed to fetch/i.test(describe(error));

    return (
      <div className="bootfail" role="alert">
        <h1 className="bootfail__title">页面没能加载出来</h1>
        <p className="bootfail__body">
          {isChunk
            ? "有一部分程序文件没取到。多数情况是刚更新完、页面还开着旧版本，重新加载一次就能好。"
            : "这一屏出了点问题，正文没有渲染出来。"}
        </p>
        {isChunk ? (
          <Button variant="primary" onClick={() => location.reload()}>
            重新加载
          </Button>
        ) : null}
      </div>
    );
  }
}

/** 报错文案：Error 就用它的 message，其它（字符串 / 未知值）兜一层 */
function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  return "未知错误";
}
