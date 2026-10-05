// @vitest-environment jsdom
/**
 * 时间轴的两列结构（按用户原型 `deliverables/pages-redesign-2026-09-27/index.html` 的 `.tl__*`）。
 *
 * 原型要点：**左栏 88px 放日期（+星期）/ 每条的时刻**，右列是内容；主干上有节点
 * （日期=主色实心点、条目=空心点）。改这一处时最容易回退成"单列 + 日期星期拼一行"，
 * 所以本文件把这几条钉住。
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TIME_ZONE, dayPartsInZone } from "../src/features/memos/model";
import { MemoTimeline } from "../src/features/memos/ui/MemoTimeline";
import type { LocalItem, MemoContent } from "../src/data/db";

afterEach(cleanup);

/**
 * 「时区 X 的墙上时间」→ epoch：**与运行机时区无关**。
 *
 * 为什么不能写 `new Date(2026, 8, 27, 13, 5)`：那是**本机**时区的 13:05，而组件按
 * `DEFAULT_TIME_ZONE`（固定 `Asia/Shanghai`）格式化。本机是 UTC+8 时两者恰好重合，用例一直是绿的；
 * CI 的 runner 是 UTC，同一份数据整体挪 8 小时——21:40 那条落到**次日**，
 * 两条 Memo 分进不同日历日，`.timeline__node` 从 1 变 2，于是**每次推送都红**。
 *
 * 算法：先按 UTC 猜一个瞬间，再用目标时区把这个瞬间显示出的墙上时间读回来求偏移，一次即收敛
 * （`Asia/Shanghai` 固定 UTC+8、无夏令时）。走 `Intl` 而不是写死 `-8h`，是为了将来改默认时区时它自己跟上。
 */
function atInZone(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const guess = Date.UTC(year, month, day, hour, minute);
  const shown = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(guess))
      .map((part) => [part.type, part.value]),
  );
  // `asUtc - guess` 就是这一瞬间的时区偏移（把墙上时间当成 UTC 读回来减掉猜的量）
  const asUtc = Date.UTC(
    Number(shown.year),
    Number(shown.month) - 1,
    Number(shown.day),
    Number(shown.hour) % 24,
    Number(shown.minute),
  );
  return guess - (asUtc - guess);
}

/** 同一天的 13:05 与 21:40（**设置时区**的墙上时间，与运行机时区无关） */
const DAY = atInZone(DEFAULT_TIME_ZONE, 2026, 8, 27, 13, 5);
const LATER = atInZone(DEFAULT_TIME_ZONE, 2026, 8, 27, 21, 40);
/** 8 月 3 日 09:00：用来验证「置顶的老 Memo 不会把整天顶到最前」 */
const OLD = atInZone(DEFAULT_TIME_ZONE, 2026, 7, 3, 9, 0);

function memo(id: string, at: number, pinned: 0 | 1 = 0): LocalItem {
  return {
    id,
    type: "memo",
    folder_id: null,
    title: `备忘 ${id}`,
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 10,
    content_hash: "h",
    tags: [],
    memo_at: at,
    is_task: 0,
    task_status: null,
    task_due: null,
    task_priority: null,
    pinned,
    starred: 0,
    rev: 1,
    meta_rev: 1,
    sealed_rev: null,
    sync_seq: 1,
    created_at: at,
    updated_at: at,
    last_edit_at: at,
    last_device: null,
    deleted_at: null,
    deleted: false,
    pending: null,
  };
}

function renderTimeline(): HTMLElement {
  const { container } = render(
    <MemoTimeline
      memos={[memo("m1", DAY), memo("m2", LATER)]}
      timeZone={DEFAULT_TIME_ZONE}
      contents={{
        m1: { content: "第一条", convertedTo: null },
        m2: { content: "第二条", convertedTo: null },
      }}
      onSave={vi.fn()}
      onTogglePinned={vi.fn()}
      onConvert={vi.fn()}
      onDelete={vi.fn()}
      onOpenConverted={vi.fn()}
      onSelectTag={vi.fn()}
    />,
  );
  return container;
}

describe("日期与星期分开取", () => {
  it("`dayPartsInZone` 把「日期」与「星期」分成两个字段（原型是两行）", () => {
    const parts = dayPartsInZone(DAY, DEFAULT_TIME_ZONE);
    expect(parts.date).toContain("9月27日");
    // 星期是独立字段：日期里**不含**它（拼接就会退化成改前那样）
    expect(parts.date).not.toContain("周");
    expect(parts.weekday).toContain("周");
  });
});

describe("时间轴两列结构", () => {
  it("日期行：左栏是日期 + 星期两行，且日期里不含星期", () => {
    const container = renderTimeline();
    const date = container.querySelector(".timeline__date");
    expect(date?.textContent ?? "").toContain("9月27日");
    expect(date?.textContent ?? "").not.toContain("周");
    expect(container.querySelector(".timeline__wd")?.textContent ?? "").toContain("周");
  });

  it("每条的时刻在**左栏**（原型 `.tl__time`），卡片里不再重复显示", () => {
    const container = renderTimeline();
    const gutters = [...container.querySelectorAll(".timeline__gutter .timeline__time")];
    // 时间轴是**最新在上**（既有排序口径），所以顺序是 21:40 → 13:05
    expect(gutters.map((node) => node.textContent)).toEqual(["21:40", "13:05"]);
    // 防回退：卡片里不该再出现 `.memo__time`（同一信息不要出现两次）
    expect(container.querySelector(".memo__time")).toBeNull();
  });

  it("主干节点：每天一个日期实心点，每条一个空心点（原型 `.tl__node` / `.tl__dot`）", () => {
    const container = renderTimeline();
    expect(container.querySelectorAll(".timeline__node")).toHaveLength(1);
    expect(container.querySelectorAll(".timeline__dot")).toHaveLength(2);
    // 内容在右列（`.timeline__content`），每条 Memo 一个
    expect(container.querySelectorAll(".timeline__content .memo")).toHaveLength(2);
  });
});

/** 渲染任意一组 Memo（含置顶），返回容器 */
function renderWith(items: LocalItem[]): HTMLElement {
  const contents: Record<string, MemoContent> = {};
  for (const item of items) contents[item.id] = { content: `正文 ${item.id}`, convertedTo: null };
  const { container } = render(
    <MemoTimeline
      memos={items}
      timeZone={DEFAULT_TIME_ZONE}
      contents={contents}
      onSave={vi.fn()}
      onTogglePinned={vi.fn()}
      onConvert={vi.fn()}
      onDelete={vi.fn()}
      onOpenConverted={vi.fn()}
      onSelectTag={vi.fn()}
    />,
  );
  return container;
}

function daySections(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".timeline__day")];
}

describe("置顶块（Q9：置顶独立成块，日期块保持单调倒序）", () => {
  it("置顶的 Memo 抽出来放最上方一块：标题写「置顶」、每条左栏自带日期", () => {
    const container = renderWith([memo("m1", DAY), memo("p1", OLD, 1)]);

    const sections = daySections(container);
    expect(sections[0]?.getAttribute("aria-label")).toBe("置顶的 Memo");
    expect(sections[0]?.querySelector(".timeline__date")?.textContent).toBe("置顶");

    // 置顶块里只有那一条；它没有日期标题行，所以左栏要补一行日期
    const pinnedRows = sections[0]?.querySelectorAll(".timeline__item") ?? [];
    expect(pinnedRows).toHaveLength(1);
    expect(pinnedRows[0]?.querySelector(".timeline__wd")?.textContent).toContain("8月3日");
  });

  it("置顶的老 Memo 不再把整天顶到最前：8 月那天不再是日期块", () => {
    const container = renderWith([memo("m1", DAY), memo("p1", OLD, 1)]);
    const sections = daySections(container);

    expect(sections).toHaveLength(2);
    expect(sections[1]?.getAttribute("aria-label")).toContain("9月27日");
    // 8 月那天的**日期标题行**（日期 + 星期）整个没有了——旧实现里它被顶到了最上面
    expect(container.textContent).not.toContain("8月3日周");
  });

  it("没有置顶时不渲染这一块（不留下一个空的「置顶」标题行）", () => {
    const container = renderWith([memo("m1", DAY)]);
    const sections = daySections(container);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.getAttribute("aria-label")).not.toBe("置顶的 Memo");
    expect(container.textContent).not.toContain("置顶");
  });
});
