/**
 * 首页面板（components.md §三 `HomePanel`；需求 §7.4、功能拆解 M05）。
 *
 * **【布局重排 2026-10-04】四段节奏：页头一行 · 中部两栏 · 动作裸行 · 导航三组。**
 * 结构稿 `docs/modules/Menote-首页布局重排-界面稿-v1.md`（v1.1 生效），取代 M7 那版
 * 「甲板 + 动作带 + 导航」。四条规则各自落在哪：
 *
 * 1. **920px 上限**落在 `.home__body`（内容容器），**不在滚动容器上**——照待办页
 *    `--task-cap` 的既有做法，滚动条因此仍在工作区右缘。`DESIGN.md` §2.3 早就要求这个上限，
 *    是实现一直没跟上（`css-colors` / `layout-invariants` 现在有断言钉住）。
 * 2. **主次做进外壳**，不再靠 flex 比例暗示：`variant="lead"`（焦点卡，2px 主色左侧强调线 +
 *    松一档留白）对 `variant="flat"`（无框、只一条顶线）。
 * 3. **卡片降一档**：整屏只剩今日待办一个带边框的块，统计提到页头做读数。
 * 4. **动作与位置分家**：动作是描边按钮裸行，位置是 chip 三组，两段之间一条分隔线。
 *
 * **口径一个字没动**：`homeStats` / `openTaskPreview` / `recentPreview` / `topTags` 四个纯函数
 * 与它们的单测未改。统计**始终按全量**（《隐私锁设计》§9.2），只有 Memo 派生的**内容预览**
 * 在门禁锁定时占位。
 *
 * 页头原先那行「概括预览 · 快捷方式 · 快速导航 · 全部由本地元数据计算」是开发口吻，
 * 按 `DESIGN.md` §5.4 收进 `ⓘ`（`InfoHint`）——**说明性文字的出口只有它一个**。
 *
 * 「打开加密空间」三态仍由 `App` 分发（未启用 → 置灰并说明原因 / 锁定 → 开解锁弹窗 /
 * 已解锁 → 进空间视图），口径与功能栏那个贴底节点一致，不发明第二套进入方式。
 */
import type { LocalItem } from "../../../data/db";
import { isMemoVisible, type PrivacyGate } from "@menote/shared";
import { Icon } from "../../../app/ui/Icon";
import { InfoHint } from "../../../app/ui/InfoHint";
import { homeStats, openTaskPreview, recentPreview, topTags } from "../model";
import { QuickNav } from "./QuickNav";
import { RecentActivity } from "./RecentActivity";
import { ShortcutActions } from "./ShortcutActions";
import { StatBand } from "./StatBand";
import { TodayTasks } from "./TodayTasks";

export interface HomePanelProps {
  /** 未删除的笔记与表格（不含 Memo） */
  items: readonly LocalItem[];
  /** 未删除的 Memo */
  memos: readonly LocalItem[];
  folders: ReadonlyArray<{ id: string; name: string }>;
  /** 条目正文首行（待办预览的标题来源） */
  titles: Readonly<Record<string, string>>;
  /**
   * 隐私门禁（M3-5）。"已锁定"占位由它推出：`memoLocked = !isMemoVisible(gate)`。
   * **统计不区分锁定状态**（算的是"总共有多少"），只有 Memo 派生的预览会占位。
   */
  gate: PrivacyGate;
  onNewNote: () => void;
  onFocusComposer: (mode: "memo" | "task") => void;
  onFocusSearch: () => void;
  onOpenItem: (itemId: string) => void;
  onOpenView: (view: "recent" | "starred" | "memo" | "task" | "notebook") => void;
  onOpenFolder: (folderId: string) => void;
  onOpenTag: (tag: string) => void;
  /**
   * 「打开加密空间」（M7 新增）。三态由 `App` 判断：
   * 没启用 → 置灰并说明；锁定 → 开解锁弹窗；已解锁 → 进空间视图。
   */
  onOpenVault: () => void;
  /** 隐私锁还没启用时，把上面那颗入口置灰并把原因说清（DESIGN.md §6.1：禁用必须说明为何） */
  vaultEntry: { enabled: boolean; locked: boolean; reason: string | null };
}

export function HomePanel({
  items,
  memos,
  folders,
  titles,
  gate,
  onNewNote,
  onFocusComposer,
  onFocusSearch,
  onOpenItem,
  onOpenView,
  onOpenFolder,
  onOpenTag,
  onOpenVault,
  vaultEntry,
}: HomePanelProps) {
  const memoLocked = !isMemoVisible(gate);
  const stats = homeStats([...items, ...memos]);
  const tasks = openTaskPreview(memos, titles, gate);
  const recent = recentPreview(items, gate);
  const tags = topTags(items, 6);

  return (
    <section className="home" aria-label="首页">
      {/*
        页头压成**一行**：左「标题 + ⓘ」，右「条目统计读数」。
        统计原来独占一个带框区块（三个数字 + 标题 + padding），现由 `StatBand` 在这里给读数。
      */}
      <header className="pane-head">
        <div className="home-head">
          <h1>首页</h1>
          <InfoHint label="这一屏的数据从哪来">
            概览数据全部由本地元数据算出来，**不发额外网络请求**。条目统计**始终按全量**：
            计入加密空间内条目与单篇加密条目，锁定也不减。锁定时只有来自 Memo 的**内容预览**
            会以「已锁定」占位。
          </InfoHint>
        </div>
        <StatBand stats={stats} memoLocked={memoLocked} />
      </header>

      <div className="home__scroll">
        {/*
          920px 上限落在这里（`DESIGN.md` §2.3「首页卡片组 920px」）。三段都在它里面，
          所以限一次就够，不必给每块各写一遍。**滚动容器仍是 `.home__scroll` 满宽**——
          限内容容器，滚动条才留在工作区右缘。
        */}
        <div className="home__body">
          <div className="home-deck">
            <div className="home-deck__main">
              <TodayTasks
                tasks={tasks}
                memoLocked={memoLocked}
                onOpenItem={onOpenItem}
                onOpenTaskView={() => onOpenView("task")}
              />
            </div>
            <div className="home-deck__side">
              <RecentActivity
                entries={recent}
                memoCount={stats.memos}
                memoLocked={memoLocked}
                onOpenItem={onOpenItem}
              />
            </div>
          </div>

          <ShortcutActions
            onNewNote={onNewNote}
            onFocusComposer={onFocusComposer}
            onFocusSearch={onFocusSearch}
            onOpenVault={onOpenVault}
            vaultEntry={vaultEntry}
          />

          <QuickNav
            folders={folders}
            tags={tags}
            onOpenFolder={onOpenFolder}
            onOpenTag={onOpenTag}
            onOpenView={onOpenView}
            onOpenVault={onOpenVault}
            vaultEntry={vaultEntry}
          />
        </div>
      </div>
    </section>
  );
}

/**
 * 区块外壳。`variant` 决定这一块有多"重"——**主次做在外壳上，不靠 flex 比例暗示**：
 *
 * - `solid`（默认）：带边框的卡片。**全屏现在只有今日待办用默认以外的那两个**。
 * - `lead`：焦点卡。2px 主色左侧强调线（与 `.markdown-body blockquote` 同一写法，
 *   语义都是"画一条线标出主线"）+ 内边距松一档（`--sp-4`），把主次做进留白。
 *   **不因此新增实心主色按钮**（`DESIGN.md` §5.1 / 禁止项 #6）——焦点靠留白与线条。
 * - `flat`：无边框无底色，只留一条顶部 `1px` 分隔线。给副内容（最近动态）。
 */
export function HomeCard({
  title,
  icon,
  note,
  action,
  variant = "solid",
  children,
}: {
  title: string;
  icon: "info" | "check-square" | "clock";
  note?: string;
  /** 标题右侧的弱操作（焦点卡的「打开待办视图」用它） */
  action?: React.ReactNode;
  variant?: "solid" | "lead" | "flat";
  children: React.ReactNode;
}) {
  const shell = CARD_SHELL[variant];
  return (
    <div className={shell}>
      <div className="home-card__hd">
        <Icon name={icon} size={13} />
        <h3>{title}</h3>
        {note ? <span className="home-card__note">{note}</span> : null}
        {action ? <span className="home-card__act">{action}</span> : null}
      </div>
      <div className="home-card__bd">{children}</div>
    </div>
  );
}

/**
 * 变体 → 类名。**为什么查表而不是三元拼串**：这样「哪几个变体存在」在一处看得全，
 * 新增变体时漏了 CSS 规则也能被 `layout-invariants` 的断言发现。
 */
const CARD_SHELL = {
  solid: "home-card",
  lead: "home-card home-card--lead",
  flat: "home-card home-card--flat",
} as const;
