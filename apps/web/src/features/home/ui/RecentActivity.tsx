/**
 * 最近动态（**副内容**，布局重排 2026-10-04：原先是与今日待办同款的带边框卡片）。
 *
 * 现在 `variant="flat"`——无边框无底色，只留一条顶部分隔线，与焦点卡拉开一级
 * （这一屏的主次做在外壳上，不靠 flex 比例暗示）。
 *
 * 与统计**同口径**：列出最近更新的笔记与表格（含加密空间内条目）。来自 Memo 的动态在门禁锁定时
 * 以一行"已锁定"占位（Q7）——所以卡里恒有一行 Memo 提示：要么"另有 N 条"，要么"已锁定"。
 */
import { HomeCard } from "./HomePanel";
import { Icon } from "../../../app/ui/Icon";
import type { RecentEntry } from "../model";

export interface RecentActivityProps {
  entries: readonly RecentEntry[];
  memoCount: number;
  memoLocked: boolean;
  onOpenItem: (itemId: string) => void;
}

export function RecentActivity({
  entries,
  memoCount,
  memoLocked,
  onOpenItem,
}: RecentActivityProps) {
  return (
    <HomeCard title="最近动态" icon="clock" variant="flat">
      {entries.length === 0 ? (
        <div className="home-empty">还没有笔记；新建一篇就会出现在这里。</div>
      ) : (
        <div className="home-list">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="home-line home-line--btn"
              onClick={() => onOpenItem(entry.id)}
            >
              <Icon name={entry.type === "table" ? "table" : "note"} size={13} />
              <span className="home-line__main">{entry.title}</span>
              <span className="home-line__meta">{formatDay(entry.updated_at)}</span>
            </button>
          ))}
        </div>
      )}

      {memoLocked ? (
        <div className="home-locked">
          <Icon name="lock" size={13} />
          来自 Memo 的动态已锁定
        </div>
      ) : memoCount > 0 ? (
        <p className="hint-line">另有 {memoCount} 条 Memo，在 Memo 视图里按时间轴查看。</p>
      ) : null}
    </HomeCard>
  );
}

/** 只显示到日：首页是概览，精确到分钟的意义不大（完整时间在各视图里） */
function formatDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
