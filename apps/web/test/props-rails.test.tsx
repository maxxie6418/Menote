// @vitest-environment jsdom
/**
 * 正文区两侧贴边面板（属性 / 大纲）的三块纯逻辑与两个组件（2026-10-11 重设计 v2）。
 *
 * 这一批测的是**不该靠肉眼验的东西**：
 * · 本机偏好的读写与**旧 key 的反向迁移**（升级后不能把用户特意收起的那一侧弹开）；
 * · 让位规则（正文区不够宽时同时只开一侧）——它是算出来的 1304px，不是断点表；
 * · 大纲的取词与"当前节"（两档算法不同：编辑档走字符偏移、仅预览档走 DOM）；
 * · 两个组件在收起/展开两态下**只存在一份**可访问名（不然读屏与测试都会撞重名）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocRail } from "../src/features/notes/ui/DocRail";
import { OutlinePanel } from "../src/features/notes/ui/OutlinePanel";
import {
  OUTLINE_OPEN_KEY,
  PROPS_COLLAPSED_KEY,
  PROPS_OPEN_KEY,
  RAILS_LAST_KEY,
  readRailsIntent,
  writeRailsIntent,
} from "../src/features/notes/props-collapse";
import { BOTH_RAILS_MIN_PANE, railOpenState, type RailSide } from "../src/features/notes/useRails";
import {
  activeOutlineIndex,
  activeOutlineIndexInPreview,
  buildOutline,
  matchPreviewHeading,
} from "../src/features/notes/outline";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe("两侧面板的本机偏好（props-collapse.ts）", () => {
  it("什么都没记过 → 两侧都展开，最后动过的是左侧", () => {
    expect(readRailsIntent()).toEqual({ propsOpen: true, outlineOpen: true, last: "props" });
  });

  it("记过就照记的来：收起态与「最后动过哪一侧」都读得回来", () => {
    localStorage.setItem(PROPS_OPEN_KEY, "0");
    localStorage.setItem(OUTLINE_OPEN_KEY, "0");
    localStorage.setItem(RAILS_LAST_KEY, "outline");
    expect(readRailsIntent()).toEqual({ propsOpen: false, outlineOpen: false, last: "outline" });
  });

  it("只有旧 key（props-collapsed = 1）→ 反向迁移成收起，并写新 key、删旧 key", () => {
    // 老用户上次特意收起了属性栏：升级后不该自己弹开（这是这条迁移存在的唯一理由）
    localStorage.setItem(PROPS_COLLAPSED_KEY, "1");
    expect(readRailsIntent().propsOpen).toBe(false);
    expect(localStorage.getItem(PROPS_OPEN_KEY)).toBe("0");
    expect(localStorage.getItem(PROPS_COLLAPSED_KEY)).toBeNull();
  });

  it("旧 key 是坏值（只有 `1` 才算折着）→ 迁移成展开", () => {
    localStorage.setItem(PROPS_COLLAPSED_KEY, "乱写的值");
    expect(readRailsIntent().propsOpen).toBe(true);
    expect(localStorage.getItem(PROPS_OPEN_KEY)).toBe("1");
  });

  it("新 key 在的时候不再看旧 key（迁移只发生一次）", () => {
    localStorage.setItem(PROPS_OPEN_KEY, "1");
    localStorage.setItem(PROPS_COLLAPSED_KEY, "1");
    expect(readRailsIntent().propsOpen).toBe(true);
  });

  it("writeRailsIntent 三个 key 一起写（读回来是同一份）", () => {
    writeRailsIntent({ propsOpen: false, outlineOpen: true, last: "outline" });
    expect(readRailsIntent()).toEqual({ propsOpen: false, outlineOpen: true, last: "outline" });
  });
});

describe("让位规则（railOpenState）：不够宽时同时只开一侧", () => {
  const both = { propsOpen: true, outlineOpen: true, last: "props" as RailSide };

  it("还没量到宽度（0）→ 按用户意图渲染，不抢跑收掉一侧", () => {
    expect(railOpenState(both, 0)).toEqual({ props: true, outline: true });
  });

  it("正好到 1304px（= 252 + 800 + 252）→ 两侧都能开，纸面仍是 800", () => {
    expect(BOTH_RAILS_MIN_PANE).toBe(1304);
    expect(railOpenState(both, BOTH_RAILS_MIN_PANE)).toEqual({ props: true, outline: true });
  });

  it("差一点（1303）且两侧都想开 → 只留「最后动过的那一侧」", () => {
    expect(railOpenState(both, 1303)).toEqual({ props: true, outline: false });
    expect(railOpenState({ ...both, last: "outline" }, 1303)).toEqual({
      props: false,
      outline: true,
    });
  });

  it("本来只想开一侧 → 再窄也照开（让位只发生在「两侧都想要」的时候）", () => {
    expect(railOpenState({ propsOpen: true, outlineOpen: false, last: "props" }, 600)).toEqual({
      props: true,
      outline: false,
    });
  });
});

describe("大纲取词（outline.ts）", () => {
  /*
    这篇有 front matter（要剥掉）、一到四级标题（四级不列）、还有一段 Setext 式标题
    （`===` 下划线式：`listHeadings` 走 ATX 判据，**不列**——预览里它照样渲染成 h1，
    所以点击定位只能按「级别 + 文字」找，见 `matchPreviewHeading` 的用例）。
  */
  const SOURCE = [
    "---",
    "title: 灯光",
    "---",
    "",
    "# 正文",
    "## 理论",
    "### 1.1 什么是 Lookdev",
    "#### 四级不列",
    "",
    "Setext 式标题",
    "======",
    "",
    "## 实践",
    "",
  ].join("\n");

  it("剥掉 front matter、只收一到三级、偏移指的是**原文**里的位置", () => {
    const items = buildOutline(SOURCE);
    expect(items.map((one) => one.heading)).toEqual([
      "正文",
      "理论",
      "1.1 什么是 Lookdev",
      "实践",
    ]);
    expect(items.map((one) => one.level)).toEqual([1, 2, 3, 2]);
    expect(items.map((one) => one.index)).toEqual([0, 1, 2, 3]);
    // 偏移是原文偏移：拿它去切原文，切出来正是「# 号 + 标题」那一行（编辑档就是靠它定位的）
    for (const item of items) {
      expect(SOURCE.slice(item.start)).toMatch(new RegExp(`^#{${item.level}} ${item.heading}`));
    }
  });

  it("没有标题 → 空列表（面板据此渲染空态）", () => {
    expect(buildOutline("只有正文\n没有标题\n")).toEqual([]);
  });

  it("「当前节」= 起始偏移不超过参考线的最后一条；一条都没滚过就算第一节", () => {
    const items = buildOutline(SOURCE);
    expect(activeOutlineIndex(items, 0)).toBe(0);
    expect(activeOutlineIndex(items, items[1]!.start)).toBe(1);
    expect(activeOutlineIndex(items, items[2]!.start + 5)).toBe(2);
    expect(activeOutlineIndex(items, 999_999)).toBe(3);
    expect(activeOutlineIndex([], 100)).toBeNull();
  });

  it("按「级别 + 文字」找预览里的那枚标题（Setext 也认，同名取第一枚）", () => {
    const items = buildOutline(SOURCE);
    const container = document.createElement("div");
    container.innerHTML =
      "<h1>正文</h1><h2>理论</h2><h3>1.1 什么是 Lookdev</h3>" +
      "<h1>Setext 式标题</h1><h2>实践</h2>";
    const nodes = [...container.querySelectorAll<HTMLElement>("h1, h2, h3")];
    // 第 4 条在原文里是 ATX 的 `## 实践`，映射到 DOM 里同名同级的那一枚
    expect(matchPreviewHeading(items[3]!, nodes)?.tagName).toBe("H2");
    const atx = buildOutline("Setext 式标题\n==========\n");
    // Setext 不列进大纲（判据只认 ATX）——所以这里没有条目可匹配
    expect(atx).toEqual([]);
    expect(matchPreviewHeading({ index: 0, level: 1, heading: "Setext 式标题", start: 0 }, nodes))
      .not.toBeNull();
  });

  it("仅预览档的当前节按容器上沿算；一条都没过就取第一节", () => {
    const items = buildOutline(SOURCE);
    const container = document.createElement("div");
    container.innerHTML = "<h1>正文</h1><h2>理论</h2><h3>1.1 什么是 Lookdev</h3><h2>实践</h2>";
    // 容器上沿在 100：第一节在 96（已过）、第二节在 200（没过）
    container.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    const heads = [...container.querySelectorAll<HTMLElement>("h1, h2, h3")];
    const puts: Record<string, number> = { 正文: 96, 理论: 200, "1.1 什么是 Lookdev": 260, 实践: 420 };
    for (const node of heads) {
      node.getBoundingClientRect = () => ({ top: puts[node.textContent ?? ""] ?? 0 }) as DOMRect;
    }
    // 参考线 = 容器上沿 + 8 = 108 → 只有第一节在它上面
    expect(activeOutlineIndexInPreview(items, container)).toBe(0);
    puts["理论"] = 90;
    expect(activeOutlineIndexInPreview(items, container)).toBe(1);
    expect(activeOutlineIndexInPreview([], container)).toBeNull();
  });
});

describe("DocRail：收起态是把手、展开态是卡片，两态只有一个可访问名", () => {
  it("收起态只有把手，点它调 onToggle", () => {
    const onToggle = vi.fn();
    render(
      <DocRail side="left" label="属性" open={false} onToggle={onToggle}>
        <p>卡体</p>
      </DocRail>,
    );
    const tab = screen.getByRole("button", { name: "属性" });
    expect(tab.className).toContain("doc-rail__tab");
    expect(screen.queryByText("卡体")).toBeNull();
    fireEvent.click(tab);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("展开态只有卡片头那枚收起按钮，卡体在里面", () => {
    render(
      <DocRail side="right" label="大纲" open onToggle={() => {}}>
        <p>卡体</p>
      </DocRail>,
    );
    expect(screen.getByRole("button", { name: "大纲" }).className).toContain("floatcard__toggle");
    expect(screen.getByText("卡体")).toBeTruthy();
    // 把手与卡片头**不会同时存在**：`DocRail` 是条件渲染，不是 CSS 藏起来
    expect(screen.getAllByRole("button", { name: "大纲" })).toHaveLength(1);
  });
});

describe("OutlinePanel：当前节与空态", () => {
  const items = buildOutline("# 正文\n## 理论\n### 1.1 子节\n");

  it("逐条渲染，缩进由级别类名决定，当前节带 aria-current", () => {
    render(<OutlinePanel items={items} activeIndex={1} onJump={() => {}} />);
    expect(screen.getByRole("button", { name: "正文" }).className).toContain("outline__item--h1");
    expect(screen.getByRole("button", { name: "理论" }).className).toContain("outline__item--h2");
    expect(screen.getByRole("button", { name: "理论" }).getAttribute("aria-current")).toBe(
      "location",
    );
    expect(screen.getByRole("button", { name: "正文" }).getAttribute("aria-current")).toBeNull();
  });

  it("点条目把条目交回宿主（定位逻辑不在面板里）", () => {
    const onJump = vi.fn();
    render(<OutlinePanel items={items} activeIndex={0} onJump={onJump} />);
    fireEvent.click(screen.getByRole("button", { name: "1.1 子节" }));
    expect(onJump).toHaveBeenCalledWith(items[2]);
  });

  it("没有标题时给一句空态，不留一片空白", () => {
    render(<OutlinePanel items={[]} activeIndex={null} onJump={() => {}} />);
    expect(screen.getByText("这一篇还没有一二三级标题")).toBeTruthy();
  });
});
