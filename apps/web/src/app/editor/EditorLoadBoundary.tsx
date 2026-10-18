/**
 * 正文区**片内**的懒加载错误边界（《编辑器体验优化设计 v1》§3.4、验收 A11）。
 *
 * 为什么不用 `main.tsx` 那个 `AppErrorBoundary`：编辑器加载失败不该把整个应用打成白屏，
 * 而且这里要的是一颗**重试**按钮——它必须同时做两件事，缺一不可：
 * 1. `resetEditorLoad()` 清掉被拒的 Promise；
 * 2. 让调用方**换一个新的 `React.lazy` 组件**——lazy 把失败结果缓存在组件对象上，
 *    不换对象的话"重试"拿到的还是那个已经被拒绝的 Promise。
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** 点「重试」时调用：清掉被拒的 Promise，并换一个新的懒加载组件 */
  onRetry: () => void;
}

interface State {
  failed: boolean;
}

export class EditorLoadBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("[editor] 编辑器加载失败", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="docpane__center" role="alert">
        <p>编辑器加载失败</p>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => {
            this.setState({ failed: false });
            this.props.onRetry();
          }}
        >
          重试
        </button>
      </div>
    );
  }
}
