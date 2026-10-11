/**
 * 右侧大纲面板（2026-10-11，设计稿 `docs/modules/MeNote-属性卡与大纲悬浮-设计-v1.md` §4）。
 *
 * **只显示一、二、三级标题**（列表由 `../outline` 的 `buildOutline` 从 `mdcore` 的
 * `listHeadings` 得来），点一条跳到那一节。它自己**不取数据、不算当前节**：`items`、
 * `activeIndex`、`onJump` 全由宿主给——DOM 与编辑器的对应关系只有宿主手里那两样东西
 * （滚动容器、编辑器句柄）知道。
 */
import type { OutlineItem } from "../outline";

export interface OutlinePanelProps {
  items: readonly OutlineItem[];
  /** 当前节的序号；`null` = 没有标题（或还没量出来） */
  activeIndex: number | null;
  onJump: (item: OutlineItem) => void;
}

export function OutlinePanel({ items, activeIndex, onJump }: OutlinePanelProps) {
  if (items.length === 0) {
    // 空态要说清是"这一篇没有"而不是"面板坏了"（`DESIGN.md` 的空状态要求）
    return <p className="outline__none">这一篇还没有一二三级标题</p>;
  }
  return (
    <div className="outline">
      {items.map((item) => {
        const current = item.index === activeIndex;
        return (
          <button
            key={item.start}
            type="button"
            /*
              级别只影响缩进与字号（`.outline__item--h1|h2|h3`），不做树形折叠：
              一二三级撑不起一棵树，折起来只会多一层"展开才看得到"。
            */
            className={
              `outline__item outline__item--h${item.level}` +
              (current ? " outline__item--current" : "")
            }
            // 长标题在面板里会被省略号截掉，`title` 给全文
            title={item.heading}
            aria-current={current ? "location" : undefined}
            onClick={() => onJump(item)}
          >
            {item.heading === "" ? "（空标题）" : item.heading}
          </button>
        );
      })}
    </div>
  );
}
