/**
 * 今日待办**焦点卡**（布局重排 2026-10-04）。
 *
 * **【主卡 · 2026-10-04】**它仍是全屏唯一带边框的块（`variant="lead"`：2px 主色左侧强调线 +
 * 松一档留白）。**主次做在外壳上，不靠 flex 比例暗示**——此前它与最近动态、条目统计是同款
 * 卡片，只靠 `flex: 1.15` 区分，界面上看不出主次（这正是这一轮要修的）。
 *
 * 焦点给待办的理由不变：它是这一屏里唯一有**时间压力**的内容，统计与动态是回顾性的。
 * 「打开待办视图」出口保留（看全量而不只是今天）。
 *
 * **三态内容一字未动**：列表 / 门禁锁定占位 / 空态。内容来自**清单 Memo**，
 * 所以在 Memo 门禁锁定时以"已锁定"占位（Q7）——不是空态，而是明确告知
 * "解锁后可见"（`DESIGN.md` §5.4-3：空状态要说明原因与出口）。
 */
import { HomeCard } from "./HomePanel";
import { Icon } from "../../../app/ui/Icon";
import type { TaskPreview } from "../model";

export interface TodayTasksProps {
  tasks: readonly TaskPreview[];
  memoLocked: boolean;
  onOpenItem: (itemId: string) => void;
  /** 「打开待办视图」出口——看全量而不只是今天（原型明写的一条） */
  onOpenTaskView: () => void;
}

export function TodayTasks({ tasks, memoLocked, onOpenItem, onOpenTaskView }: TodayTasksProps) {
  return (
    <HomeCard
      title="今日待办"
      icon="check-square"
      note="来自清单 Memo"
      variant="lead"
      action={
        <button type="button" className="home-card__link" onClick={onOpenTaskView}>
          打开待办视图
        </button>
      }
    >
      {memoLocked ? (
        <div className="home-locked">
          <Icon name="lock" size={13} />
          来自 Memo 的内容已锁定，解锁后可见
        </div>
      ) : tasks.length === 0 ? (
        <div className="home-empty">
          没有未完成的待办。
          <button type="button" className="home-card__link" onClick={onOpenTaskView}>
            打开待办视图
          </button>
        </div>
      ) : (
        <div className="home-list">
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className="home-line home-line--btn"
              onClick={() => onOpenItem(task.id)}
            >
              <span className="home-dot" aria-hidden="true" />
              <span className="home-line__main">{task.title}</span>
              <span className="home-line__meta">
                {[task.due, task.priority === "high" ? "高" : task.priority === "low" ? "低" : null]
                  .filter(Boolean)
                  .join(" · ") || "未设日期"}
              </span>
            </button>
          ))}
        </div>
      )}
    </HomeCard>
  );
}
