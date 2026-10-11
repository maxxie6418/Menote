/**
 * 正文区两侧的贴边面板（属性 / 大纲）——2026-10-11《属性卡与大纲悬浮》设计稿 v2 §2。
 *
 * ## 它为什么长这样（三条都是被否掉一版之后定下来的）
 *
 * 1. **它是 `.docpane__body` 的直接子项，与正文并排**，不是浮在正文上的浮层。第一版做的是
 *    "零高度 sticky 外壳 + 绝对定位卡片"（覆盖式），用户看过之后要求改成**占位式**：
 *    "尽量使内容平铺且不堆叠盖住内容"——展开时它**真的占宽**，正文容器跟着变窄、纸面在剩下
 *    的宽度里居中，于是任何宽度下都不会盖住正文。
 *
 * 2. **`position: sticky`（在 CSS 里）而不是 `position: fixed`**：正文档由 `.doc-split__pane`
 *    滚、表格档由 `.docpane__body` 滚，sticky 对两种都答"钉在正文区顶部"；fixed 得按档位
 *    各算一次坐标，还会在窗口缩放时要"跟着算"。
 *
 * 3. **收起态只剩一条 28px 的竖排把手，展开态的收起入口在卡片头上**：两个状态各有一个
 *    明确的入口，不靠"再点一次刚才那个位置"（那正是第一版被说"不好收"的地方）。
 *    两种状态**条件渲染**而不是 CSS 藏起来——同一个可访问名（"属性"）不会在 DOM 里
 *    同时存在两份，屏幕阅读器与测试都不会撞上重名按钮。
 */
import type { ReactNode } from "react";

export interface DocRailProps {
  /** 贴哪一边。左轨的把手与卡片贴向正文，右轨镜像 */
  side: "left" | "right";
  /** 面板名（「属性」/「大纲」），同时是把手与卡片头上的文字 */
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function DocRail({ side, label, open, onToggle, children }: DocRailProps) {
  return (
    <aside className={`doc-rail doc-rail--${side}`} data-open={open ? "true" : "false"}>
      {open ? null : (
        <button
          type="button"
          className="doc-rail__tab"
          aria-expanded={false}
          title={`展开${label}`}
          onClick={onToggle}
        >
          {label}
        </button>
      )}
      {open ? (
        <div className="doc-rail__card">
          <div className="floatcard__head">
            <button
              type="button"
              className="floatcard__toggle"
              aria-expanded
              title={`收起${label}`}
              onClick={onToggle}
            >
              {/*
                方向朝内：左轨朝右收、右轨朝左收——不跟着卡片摆，一眼能看出"往哪边收"
              */}
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={side === "right" ? { transform: "rotate(-90deg)" } : { transform: "rotate(90deg)" }}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
              {label}
            </button>
          </div>
          <div className="floatcard__body">{children}</div>
        </div>
      ) : null}
    </aside>
  );
}
