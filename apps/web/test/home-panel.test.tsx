// @vitest-environment jsdom
/**
 * 首页面板（M2-8 验收点；布局重排 2026-10-04 更新结构断言）：
 * - 四段节奏：页头一行（含统计读数）→ 中部两栏（今日待办主 / 最近动态副）→ 动作裸行 → 导航三组；
 * - 统计**始终计入加密条目**（不因锁定改变）；
 * - **来自 Memo 的部分在锁定时以"已锁定"占位**（Q7）——两条分支都有用例；
 * - 各卡片有空态；快捷方式与快速导航都走回调。
 *
 * 取数纯函数（`home-model.test.ts`）与这些断言是两回事：那边守**算什么**，这里守**怎么摆**。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { noPrivacyGate, privacyGateFrom } from "@menote/shared";
import type { LocalItem } from "../src/data/db";
import { HomePanel } from "../src/features/home/ui/HomePanel";
import { assertLabelledControls } from "./helpers/a11y";
import { assertSinglePrimaryAction } from "./helpers/design";

afterEach(cleanup);

function item(id: string, extra: Partial<LocalItem> = {}): LocalItem {
  return {
    id,
    type: "note",
    folder_id: null,
    title: `标题 ${id}`,
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 10,
    content_hash: "h",
    tags: [],
    memo_at: null,
    is_task: 0,
    task_status: null,
    task_due: null,
    task_priority: null,
    pinned: 0,
    starred: 0,
    rev: 1,
    meta_rev: 1,
    sealed_rev: null,
    sync_seq: 1,
    created_at: 1,
    updated_at: 1,
    last_edit_at: null,
    last_device: null,
    deleted_at: null,
    deleted: false,
    pending: null,
    ...extra,
  };
}

const ITEMS = [
  item("n1", { title: "会议记录", updated_at: 9 }),
  item("n2", { title: "加密笔记", enc_self: 1, updated_at: 8 }),
  item("t1", { title: "读书清单", type: "table", updated_at: 7, tags: ["读书"] }),
];

const MEMOS = [
  item("m1", { type: "memo", title: null, memo_at: 5, is_task: 1, task_status: "todo", task_due: "2026-09-30" }),
];

function renderPanel(overrides: Partial<Parameters<typeof HomePanel>[0]> = {}) {
  const onNewNote = vi.fn();
  const onFocusComposer = vi.fn();
  const onFocusSearch = vi.fn();
  const onOpenItem = vi.fn();
  const onOpenView = vi.fn();
  const onOpenFolder = vi.fn();
  const onOpenTag = vi.fn();
  const onOpenVault = vi.fn();
  const { container } = render(
    <HomePanel
      items={ITEMS}
      memos={MEMOS}
      folders={[{ id: "f1", name: "学习" }]}
      titles={{ m1: "交物业费" }}
      gate={noPrivacyGate()}
      onNewNote={onNewNote}
      onFocusComposer={onFocusComposer}
      onFocusSearch={onFocusSearch}
      onOpenItem={onOpenItem}
      onOpenView={onOpenView}
      onOpenFolder={onOpenFolder}
      onOpenTag={onOpenTag}
      onOpenVault={onOpenVault}
      vaultEntry={{ enabled: true, locked: false, reason: null }}
      {...overrides}
    />,
  );
  // 读屏底线：首页每个按钮/输入都要有可访问名字（渲染层断言，见 helpers/a11y.ts）
  assertLabelledControls(container, { buttons: 1 });
  // DESIGN.md §5.1：这块区域最多一个实心主色按钮
  assertSinglePrimaryAction(container);
  return {
    container,
    onNewNote,
    onFocusComposer,
    onFocusSearch,
    onOpenItem,
    onOpenView,
    onOpenFolder,
    onOpenTag,
    onOpenVault,
  };
}

describe("页头读数（条目统计 · 布局重排）", () => {
  it("统计按类型计数，且**计入加密条目**（含单篇加密）", () => {
    const { container } = renderPanel();
    const ovw = container.querySelector(".home-ovw") as HTMLElement;

    // 笔记 2（其中 1 条 enc_self=1）+ 表格 1 + Memo 1
    const numbers = [...ovw.querySelectorAll(".home-stat__n")].map((el) => el.textContent);
    expect(numbers).toEqual(["2", "1", "1"]);
  });

  it("统计在**页头里**做读数，不再是独立区块；口径收进 ⓘ（DESIGN.md §5.4）", () => {
    const { container } = renderPanel();
    const head = container.querySelector(".pane-head") as HTMLElement;

    // 读数在页头内，且不再有自己的标题文字（无障碍名字由 aria-label 给）
    expect(within(head).getByLabelText("条目统计")).toBeTruthy();
    expect(screen.queryByText("条目统计")).toBeNull();
    // 口径说明由 ⓘ 承载：按钮有可访问名字，说明文字在 role=tooltip 里
    const hint = screen.getByRole("button", { name: "条目统计口径" });
    expect(hint.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("三个数字**保持可见**——实时计数不许收进 ⓘ（禁止项 #8）", () => {
    const { container } = renderPanel();
    const numbers = [...container.querySelectorAll(".home-ovw__row .home-stat__n")];
    expect(numbers).toHaveLength(3);
    expect(numbers.every((el) => el.textContent !== "")).toBe(true);
  });
});

describe("中部两栏（一主一副 · 布局重排）", () => {
  it("今日待办是唯一带框的主卡，最近动态是无框副块", () => {
    const { container } = renderPanel();
    const deck = container.querySelector(".home-deck") as HTMLElement;
    const main = deck.querySelector(".home-deck__main") as HTMLElement;
    const side = deck.querySelector(".home-deck__side") as HTMLElement;

    expect(within(main).getByText("今日待办")).toBeTruthy();
    expect(within(side).getByText("最近动态")).toBeTruthy();

    // 主次做在**外壳变体**上，不靠 flex 比例暗示
    expect(main.querySelector(".home-card--lead")).toBeTruthy();
    expect(side.querySelector(".home-card--flat")).toBeTruthy();
    // 全屏只剩一个带边框的块
    expect(container.querySelectorAll(".home-card:not(.home-card--flat)")).toHaveLength(1);
  });

  it("内容都在 920px 的内容容器里，滚动容器保持满宽（DESIGN.md §2.3）", () => {
    const { container } = renderPanel();
    const body = container.querySelector(".home__body") as HTMLElement;
    const scroll = container.querySelector(".home__scroll") as HTMLElement;

    // 限的是内容容器：两栏、动作带、导航三组都在它里面
    expect(body.querySelector(".home-deck")).toBeTruthy();
    expect(body.querySelector(".home-acts-bar")).toBeTruthy();
    expect(body.querySelector(".home-nav")).toBeTruthy();
    // 而滚动容器在它**外面**——滚动条因此仍在工作区右缘
    expect(scroll.contains(body)).toBe(true);
  });

  it("页头不再有开发口吻副标题（DESIGN.md §5.4）", () => {
    const { container } = renderPanel();
    expect(container.querySelector(".pane-head .sub")).toBeNull();
    expect(screen.queryByText(/全部由本地元数据计算/)).toBeNull();
  });

  it("今日待办列出未完成清单项，点击打开该条目；另有「打开待办视图」出口", async () => {
    const user = userEvent.setup();
    const { onOpenItem, onOpenView } = renderPanel();

    const card = screen.getByText("今日待办").closest(".home-card") as HTMLElement;
    expect(within(card).getByText("交物业费")).toBeTruthy();

    await user.click(within(card).getByText("交物业费"));
    expect(onOpenItem).toHaveBeenCalledWith("m1");

    // 原型明写的一条：焦点卡要带一个看全量的出口
    await user.click(screen.getByRole("button", { name: "打开待办视图" }));
    expect(onOpenView).toHaveBeenCalledWith("task");
  });

  it("最近动态按最近更新列出，Memo 另行提示", () => {
    const { container } = renderPanel();
    const lines = [...container.querySelectorAll(".home-line__main")].map((el) => el.textContent);
    expect(lines).toContain("会议记录");
    expect(lines).toContain("加密笔记");
    expect(screen.getByText(/另有 1 条 Memo/)).toBeTruthy();
  });

  it("**门禁锁定时 Memo 部分以「已锁定」占位**，统计数字口径不变（Q7）", () => {
    const { container } = renderPanel({
      gate: privacyGateFrom({ scope: { memo: true }, search_bodies_when_unlocked: true }, "locked"),
    });

    // 统计照旧（含 Memo 数字）
    const numbers = [...container.querySelectorAll(".home-ovw__row .home-stat__n")].map(
      (el) => el.textContent,
    );
    expect(numbers).toEqual(["2", "1", "1"]);
    // 锁定那句解释仍然**看得见**，不许藏进 ⓘ
    expect(screen.getByText("数字不区分锁定状态")).toBeTruthy();

    // Memo 内容换成占位
    expect(screen.getAllByText(/已锁定/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("交物业费")).toBeNull();
  });

  it("空库时各块都有空态", () => {
    const { container } = renderPanel({ items: [], memos: [], folders: [], titles: {} });

    expect(screen.getByText("没有未完成的待办。")).toBeTruthy();
    expect(screen.getByText(/还没有笔记/)).toBeTruthy();
    const numbers = [
      ...container.querySelectorAll(".home-ovw__row .home-stat__n"),
    ].map((el) => el.textContent);
    expect(numbers).toEqual(["0", "0", "0"]);
  });
});

describe("快捷方式（动作裸行 · 布局重排）", () => {
  it("新建笔记 / 记录 Memo / 新建待办 / 搜索都走回调", async () => {
    const user = userEvent.setup();
    const { onNewNote, onFocusComposer, onFocusSearch } = renderPanel();

    await user.click(screen.getByRole("button", { name: /新建笔记/ }));
    expect(onNewNote).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /记录 Memo/ }));
    expect(onFocusComposer).toHaveBeenCalledWith("memo");

    await user.click(screen.getByRole("button", { name: /新建待办/ }));
    expect(onFocusComposer).toHaveBeenCalledWith("task");

    await user.click(screen.getByRole("button", { name: /搜索（Ctrl\+K）/ }));
    expect(onFocusSearch).toHaveBeenCalledTimes(1);
  });

  it("是一行裸行：五个动作都在，但**不带边框外壳**（与快速导航分家）", () => {
    const { container } = renderPanel();
    const bar = container.querySelector(".home-acts-bar") as HTMLElement;
    expect(bar).toBeTruthy();
    // 五个动作都在这条带里
    expect(bar.querySelectorAll(".home-act")).toHaveLength(5);
    // 动作是描边按钮、位置是 chip：全屏不再有第二个带边框的"卡片"块
    expect(container.querySelectorAll(".home-card")).toHaveLength(2);
    expect(container.querySelector(".home-nav")).toBeTruthy();
  });

  it("「打开加密空间」接上真动作了（M7；此前一直是 M2 留下的死按钮）", async () => {
    const user = userEvent.setup();
    const { onOpenVault } = renderPanel();
    await user.click(screen.getByRole("button", { name: /打开加密空间/ }));
    expect(onOpenVault).toHaveBeenCalledTimes(1);
  });

  it("隐私锁没启用时置灰，且**必须说明原因**（DESIGN.md §6.1）", () => {
    renderPanel({
      vaultEntry: { enabled: false, locked: false, reason: "先在设置 › 隐私锁 启用，才能打开加密空间" },
    });
    const vault = screen.getByRole("button", { name: /打开加密空间/ });
    expect(vault.getAttribute("aria-disabled")).toBe("true");
    // 触屏够不到 title，所以原因要有**可见**的一份
    expect(screen.getByText("先在设置 › 隐私锁 启用，才能打开加密空间")).toBeTruthy();
  });
});

describe("快速导航", () => {
  it("文件夹 / 标签 / 常用视图都能跳转", async () => {
    const user = userEvent.setup();
    const { onOpenFolder, onOpenTag, onOpenView } = renderPanel();

    await user.click(screen.getByRole("button", { name: "学习" }));
    expect(onOpenFolder).toHaveBeenCalledWith("f1");

    await user.click(screen.getByRole("button", { name: /# 读书/ }));
    expect(onOpenTag).toHaveBeenCalledWith("读书");

    await user.click(screen.getByRole("button", { name: "最近编辑" }));
    expect(onOpenView).toHaveBeenCalledWith("recent");

    await user.click(screen.getByRole("button", { name: "待办" }));
    expect(onOpenView).toHaveBeenCalledWith("task");
  });

  it("常用视图里的「加密空间」也接上真动作（M7）", async () => {
    const user = userEvent.setup();
    const { onOpenVault } = renderPanel();
    await user.click(screen.getByRole("button", { name: "加密空间" }));
    expect(onOpenVault).toHaveBeenCalledTimes(1);
  });

  it("没启用隐私锁时那颗胶囊置灰并写明原因", () => {
    renderPanel({
      vaultEntry: { enabled: false, locked: false, reason: "先在设置 › 隐私锁 启用，才能打开加密空间" },
    });
    const vaultChip = screen.getByText("加密空间");
    expect(vaultChip.getAttribute("data-disabled")).toBe("true");
    expect(vaultChip.getAttribute("title")).toContain("隐私锁");
  });

  it("没有文件夹与标签时不渲染那两组（不留空组）", () => {
    renderPanel({ folders: [], items: [item("x", { tags: [] })] });

    expect(screen.queryByText("文件夹")).toBeNull();
    expect(screen.queryByText("标签")).toBeNull();
    expect(screen.getByText("常用视图")).toBeTruthy();
  });
});
