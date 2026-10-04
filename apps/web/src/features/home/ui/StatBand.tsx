/**
 * 条目统计**读数**（布局重排 2026-10-04：原先是概览预览右栏里一条带边框的数字带）。
 *
 * **为什么从区块降成页头读数**：它只是三个数字，却独占一个带边框、带标题、带内边距的区块——
 * 整屏因此多出一块"卡"，而数字真正回答的是"我总共有多少"，是回顾性的，不该与今日待办
 * 抢注意力。现在它贴在页头右侧，**不占任何区块高度**，口径收进 `ⓘ`。
 *
 * **数字与口径一个字没动**：统计**始终按全量**，计入加密空间内条目与单篇加密条目，
 * **不因锁定/解锁改变**——它回答的是"我总共有多少东西"（《隐私锁设计》§9.2 的既有口径）。
 * 受门禁影响的只有 Memo 的**内容预览**，而这里的 Memo 数字也是统计（仍然照数）。
 *
 * **可见性边界**（`DESIGN.md` §5.4-2 / 禁止项 #8）：三个数字与锁定那句微字**必须留在界面上**，
 * 收进 `InfoHint` 的只有"口径 / 来源"这类说明性文字。
 */
import type { HomeStats } from "../model";
import { InfoHint } from "../../../app/ui/InfoHint";

export interface StatBandProps {
  stats: HomeStats;
  memoLocked: boolean;
}

export function StatBand({ stats, memoLocked }: StatBandProps) {
  return (
    <div className="home-ovw" aria-label="条目统计">
      {/*
        原来这里是可见的「条目统计」标题 + `InfoHint`。标题文字取消：读数已经紧贴在页头，
        再摆四个字只是重复；无障碍名字由外层 `aria-label` 给，读屏照样念得到。
      */}
      <InfoHint label="条目统计口径">
        统计**始终按全量**：计入加密空间内条目与单篇加密条目，锁定也不减。
        它回答的是"我总共有多少"，不受门禁影响。
      </InfoHint>
      <div className="home-ovw__row">
        <div className="home-stat">
          <b className="home-stat__n">{stats.notes}</b>
          <span className="home-stat__l">笔记</span>
        </div>
        <div className="home-stat">
          <b className="home-stat__n">{stats.tables}</b>
          <span className="home-stat__l">表格</span>
        </div>
        <div className="home-stat">
          <b className="home-stat__n">{stats.memos}</b>
          <span className="home-stat__l">Memo</span>
        </div>
      </div>
      {/* 锁定时这句仍要看得见——它是"为什么数字没变"的解释，不是可选提示 */}
      {memoLocked ? <span className="home-ovw__note">数字不区分锁定状态</span> : null}
    </div>
  );
}
