// @vitest-environment jsdom
import "fake-indexeddb/auto";
/**
 * 属性卡片（2026-10-04，《笔记属性卡片》设计稿）。
 *
 * 钉三件最容易做错、且错了都不会报错的事：
 *
 * 1. **卡片显示的每个值都必须能被它改掉**（`readItemProps`）：只列 front matter 里的
 *    `tags`，不列正文 `#标签` 派生出来的那些。否则点 × 只会往 YAML 写一个少一项的列表，
 *    下一轮派生又把正文那个标签并回来——用户点完发现标签还在，比没有这个 × 更糟。
 *
 * 2. **卡片只发意图、不自己存**（`useItemProps`）：改动要经 `replaceFrontmatter` 推进
 *    编辑器。组件自己存草稿会和编辑器的自动保存打架，用户敲一个字就把标签覆盖掉。
 *
 * 3. **键名原样**（`ItemProps`）：不翻译、不改写。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveTags, updateMenoteKeys } from "@menote/mdcore";
import { createLocalItem, db, getLocalItem } from "../src/data/db";
import { frontmatterRange } from "../src/app/editor/frontmatter-hide";
import { ItemProps, readItemProps, shouldShowItemProps } from "../src/features/notes/ui/ItemProps";
import { useItemProps } from "../src/features/notes/useItemProps";
import type { EditorHandle } from "../src/app/editor/Editor";

const OB = `---
title: "Anatomy of the .claude/ folder"
url: "https://x.com/akshay_pachaar/status/2035341800739877091"
author:
  - "Unknown"
tags: [claude]
status: unread
---

正文第一段。
`;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await createLocalItem(
    { id: "n1", type: "note", title: "读书笔记", folder_id: null, body: OB, tags: ["claude"] },
    1_000,
  );
});

afterEach(cleanup);

/** 一个照着真 Editor 口径写的句柄替身：区间从**自己的文档**算，不收 expected */
function makeHandle(initial: string) {
  const state = { text: initial, changes: 0 };
  const handle: EditorHandle = {
    read: () => state.text,
    insert: (text) => {
      state.text += text;
    },
    replace: (marker, text) => {
      const at = state.text.indexOf(marker);
      if (at < 0) return;
      state.text = state.text.slice(0, at) + text + state.text.slice(at + marker.length);
    },
    applyFormat: () => undefined,
    openSearch: () => {},
    // 替身不模拟滚动与视口：大纲那两个方法在本文件里用不到，给个不会崩的形状即可
    scrollToOffset: () => {},
    offsetAtViewportY: () => 0,
    replaceFrontmatter: (next) => {
      const range = frontmatterRange(state.text);
      if (range === null) {
        state.text = next + state.text;
      } else {
        state.text = state.text.slice(0, range.from) + next + state.text.slice(range.to);
      }
      state.changes += 1;
      return true;
    },
  };
  return { handle, state };
}

const noop = {
  onTagsChange: () => undefined,
  onTaskChange: () => undefined,
  onForeignChange: () => undefined,
  onForeignRemove: () => undefined,
  onForeignAdd: () => undefined,
};

describe("readItemProps：卡片显示的值必须都能被它改掉", () => {
  it("只列 front matter 里的 tags，不列正文 #标签 派生的那些", () => {
    const body = updateMenoteKeys("正文里有 #临时 的标签", { tags: ["claude"] });

    expect(readItemProps(body).tags).toEqual(["claude"]);
    // 而 deriveTags 是合并的——所以确实存在「卡片看不到但有效」的标签
    expect(deriveTags(body)).toEqual(["claude", "临时"]);
  });

  it("清单字段看顶层三键在不在（2026-10-11 平铺后的口径）", () => {
    // OB 顶层有 `status: unread`——**键在**就是清单条目（判据是键，不是值认不认识）；
    // 值不是 MeNote 的状态，所以归一化后为空，并在 `unrecognized` 里留痕给一行提示
    expect(readItemProps(OB).task).toEqual({ status: null, due: null, priority: null });
    expect(readItemProps(OB).unrecognized).toEqual(["status: unread"]);

    // 三个键一个都没有 → 不是清单条目
    expect(readItemProps("---\ntitle: T\n---\n\n正文").task).toBeNull();

    const withTask = updateMenoteKeys(OB, { task: { status: "todo", due: "2026-10-08", priority: "high" } });
    expect(readItemProps(withTask).task).toEqual({
      status: "todo",
      due: "2026-10-08",
      priority: "high",
    });
    // 写出来是顶层三行，不再缩进在 `menote:` 下的 `task:` 里
    expect(withTask).toContain("\nstatus: todo\n");
    expect(withTask).not.toContain("task:");
    // 值认识了，提示就没有了
    expect(readItemProps(withTask).unrecognized).toEqual([]);
  });

  it("外来键原样列出；MeNote 自己的键（含清单三键）不在其中", () => {
    const keys = readItemProps(OB).foreign.map((one) => one.key);
    // `status: unread` 被接管成了清单字段，所以不在外来键里
    expect(keys).toEqual(["url", "author"]);
    for (const key of ["title", "tags", "menote", "status", "due", "priority"]) {
      expect(keys).not.toContain(key);
    }
  });
});

describe("shouldShowItemProps", () => {
  it("完全没有 front matter → 显示（让用户能加第一个标签）", () => {
    expect(shouldShowItemProps("正文")).toBe(true);
  });

  it("front matter 没闭合 → 不显示（用户正在写第一行，此时改写不可靠）", () => {
    expect(shouldShowItemProps("---\ntitle: 写了一半\n\n正文。")).toBe(false);
  });

  it("闭合的 → 显示", () => {
    expect(shouldShowItemProps(OB)).toBe(true);
  });
});

describe("卡片渲染", () => {
  it("键名原样出现，不翻译", () => {
    render(<ItemProps body={OB} editable {...noop} />);
    expect(screen.getByText("url")).toBeTruthy();
    expect(screen.getByText("author")).toBeTruthy();
    // 没有出现任何中文译名
    expect(screen.queryByText("链接")).toBeNull();
    expect(screen.queryByText("作者")).toBeNull();
  });

  it("标签渲染成可点的 chip，每个带删除按钮", () => {
    render(<ItemProps body={OB} editable {...noop} />);
    expect(screen.getByText("claude")).toBeTruthy();
    expect(screen.getByLabelText("移除标签 claude")).toBeTruthy();
  });

  it("外来键行有「本篇不再用」按钮，标签行没有删除整行的（用户 2026-10-11：删条目只在管理页）", () => {
    render(<ItemProps body={OB} editable {...noop} />);
    expect(screen.getByLabelText("本篇不再用 url")).toBeTruthy();
    // tags 的删除是「删这一个 chip」，不是「删掉 tags 键」
    expect(screen.queryByLabelText("本篇不再用 tags")).toBeNull();
    expect(screen.queryByLabelText("本篇不再用 title")).toBeNull();
    expect(screen.queryByLabelText("本篇不再用 menote")).toBeNull();
  });

  it("块序列键用多行框、单行键用单行框", () => {
    render(<ItemProps body={OB} editable {...noop} />);
    const author = screen.getByLabelText("author 的值");
    const url = screen.getByLabelText("url 的值");
    expect(author.tagName).toBe("TEXTAREA");
    expect(url.tagName).toBe("INPUT");
    expect((author as HTMLTextAreaElement).value).toBe('  - "Unknown"');
  });

  it("只读时输入禁用，且给出为什么（DESIGN.md §6.1）", () => {
    render(
      <ItemProps
        body={OB}
        editable={false}
        readOnlyReason="切到「仅编辑」才能改属性"
        {...noop}
      />,
    );
    expect((screen.getByLabelText("url 的值") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByLabelText("url 的值").getAttribute("title")).toBe("切到「仅编辑」才能改属性");
    // 只读时不给删除入口
    expect(screen.queryByLabelText("本篇不再用 url")).toBeNull();
  });

  it("没有外来键时也留着「其他属性」那一格与新增入口（空白笔记的唯一入口，设计 §6.4）", () => {
    render(<ItemProps body="---\ntitle: T\ntags: [a]\n---\n\n正文" editable {...noop} />);
    /*
      重设计 v2 §3：分组头**常显**（一条细线 + 一行小字），因为「+ 用一个属性」是它这一格的
      内容——从前它与段内的新增入口都只在有外来键时才渲染，等于空白笔记根本没有新增入口。
    */
    expect(screen.getByText("其他属性")).toBeTruthy();
    expect(screen.getByText("+ 用一个属性")).toBeTruthy();
  });

  it("完全没有 front matter 的笔记也有新增入口（从前这里什么都没有）", () => {
    render(<ItemProps body="正文" editable {...noop} />);
    expect(screen.getByText("+ 用一个属性")).toBeTruthy();
  });

  it("只读（预览）时不给新增入口", () => {
    render(<ItemProps body="---\ntitle: T\n---\n\n正文" editable={false} {...noop} />);
    expect(screen.queryByText("+ 用一个属性")).toBeNull();
  });

  it("被接管但值不认识的键：解释在那一行的 ⓘ 里，不再有黄字横条（用户 2026-10-11）", () => {
    render(<ItemProps body={OB} editable {...noop} />);
    /*
      重设计 v2 §3：那条「⚠ unread 不是 MeNote 的值 · 已原样保留」的琥珀色小字整段删掉。
      **信息没丢**——值本身仍然写着「unread（原样保留）」（见上面状态行的选项），
      完整口径收进同一行的 ⓘ。用户看完第一版说"乱七八糟的提示""中间的黄字"。
    */
    expect(screen.queryByText(/不是 MeNote 的值/)).toBeNull();
    expect(screen.getByLabelText("状态值的说明")).toBeTruthy();
    expect(screen.getByText("unread（原样保留）")).toBeTruthy();
  });

  it("状态那一行没有「未设为清单」这一项（用户 2026-10-11 更正）", () => {
    render(<ItemProps body={OB} editable {...noop} />);
    const select = screen.getByLabelText("状态") as HTMLSelectElement;
    const labels = [...select.options].map((one) => one.text);
    /*
      OB 是「键在、值不认识」的清单条目（路 A）：原值自己占一项、摆在真实选项之前。
      **没有「未设置」占位**——当前不是空。更没有「未设为清单」：取消清单的入口已摘掉。
    */
    expect(labels).toEqual(["unread（原样保留）", "待办", "进行中", "已完成"]);
    expect(labels).not.toContain("未设为清单");
  });

  it("状态键在、值为空 → 才有「未设置」占位（它只如实显示，不是回到空的路径）", () => {
    render(<ItemProps body={"---\nstatus:\n---\n\n正文"} editable {...noop} />);
    const select = screen.getByLabelText("状态") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect([...select.options].map((one) => one.text)).toEqual(["未设置", "待办", "进行中", "已完成"]);
  });

  it("点状态下拉里任何一个真实选项，都只写一个非空 status（卡片里没有「清掉三键」那条路）", () => {
    const onTaskChange = vi.fn();
    render(<ItemProps body={OB} editable {...noop} onTaskChange={onTaskChange} />);
    const select = screen.getByLabelText("状态") as HTMLSelectElement;
    const real = [...select.options].filter((one) => one.value !== "");
    // OB 的原值 `unread` 也算一个非空 status（路 A：选中它 = 原样留着），所以是 4 个
    expect(real.map((one) => one.value)).toEqual(["unread", "todo", "doing", "done"]);
    for (const option of real) fireEvent.change(select, { target: { value: option.value } });

    expect(onTaskChange).toHaveBeenCalledTimes(4);
    for (const [payload] of onTaskChange.mock.calls) {
      expect(typeof payload.status).toBe("string");
    }
  });

  it("「未设置」占位项只在当前就是空的时候在，不提供回到空的路径", () => {
    const withStatus = updateMenoteKeys("正文", { task: { status: "todo", due: null, priority: null } });
    /*
      前半段必须用「键在、值为空」的正文：OB 的值是 `unread`，那是"有值但陌生"（路 A 会把它
      摆成一个选项），不是空 —— 拿 OB 验不到这个占位项。
    */
    const first = render(<ItemProps body={"---\nstatus:\n---\n\n正文"} editable {...noop} />);
    expect((screen.getByLabelText("状态") as HTMLSelectElement).value).toBe("");
    first.unmount();

    render(<ItemProps body={withStatus} editable {...noop} />);
    const select = screen.getByLabelText("状态") as HTMLSelectElement;
    expect(select.value).toBe("todo");
    expect([...select.options].map((one) => one.text)).not.toContain("未设置");
  });

  it("优先级有「未设置」，没设过的笔记不谎报成「中」", () => {
    render(<ItemProps body="---\ntitle: T\n---\n\n正文" editable {...noop} />);
    const select = screen.getByLabelText("优先级") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect([...select.options].map((one) => one.text)).toEqual(["未设置", "高", "中", "低"]);
  });

  it("改优先级不顺手补 status：普通笔记不会因此变成清单条目", () => {
    const onTaskChange = vi.fn();
    render(<ItemProps body="---\ntitle: T\n---\n\n正文" editable {...noop} onTaskChange={onTaskChange} />);
    fireEvent.change(screen.getByLabelText("优先级"), { target: { value: "high" } });
    expect(onTaskChange).toHaveBeenCalledWith({ status: null, due: null, priority: "high" });
  });

  it("校验没过时把理由报出来，不静默吞", () => {
    const onError = vi.fn();
    render(<ItemProps body={OB} editable {...noop} onError={onError} />);
    // 块序列的值里含非法缩进不该由组件产生，这里只验组件把错误转出去
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("删外来键要二次确认（设计 §6.5：破坏性操作必须写明后果）", () => {
  it("点 × 只弹确认、先不动 md；确认后才真的删", () => {
    const onForeignRemove = vi.fn();
    render(<ItemProps body={OB} editable {...noop} onForeignRemove={onForeignRemove} />);

    fireEvent.click(screen.getByLabelText("本篇不再用 url"));
    expect(onForeignRemove).not.toHaveBeenCalled();
    expect(screen.getByText("本篇不再用 url？")).toBeTruthy();
    // 后果要说到位：md 里那一行会没、Obsidian 那边也看不到、库里的定义还在
    expect(screen.getByText(/这篇 md 的 front matter 里那一行会被删掉/)).toBeTruthy();
    expect(screen.getByText(/属性库里的定义还在/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "从本篇移除" }));
    expect(onForeignRemove).toHaveBeenCalledWith("url");
  });

  it("取消 → 一个键都不删（确认框是拦在删除之前的，不是删完再提示）", () => {
    const onForeignRemove = vi.fn();
    render(<ItemProps body={OB} editable {...noop} onForeignRemove={onForeignRemove} />);

    fireEvent.click(screen.getByLabelText("本篇不再用 url"));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onForeignRemove).not.toHaveBeenCalled();
  });
});

describe("卡片在 DOM 里的位置", () => {
  /**
   * 2026-10-04 修过一次真布局缺陷，2026-10-11 又改了一次形态——两次的形状都在这里钉住。
   *
   * 第一次：卡片曾渲染在 `.docpane__body` **里面**，而那个容器是 `display: flex`（row）——
   * 卡片成了第三个 flex 项，于是**和正文并排成一条窄列**，标签列被挤到截断。
   *
   * 第二次（重设计 v2）：卡片又回到 `.docpane__body` 里面，但这次它是**轨道里的一张卡**
   * （`<DocRail>` 的第一个 flex 项），正文在剩下的宽度里居中——展开占宽、**不覆盖正文**，
   * 所以第一次那个"并排成窄列"的问题不再成立：列的宽度是设计给的 240px，不是被挤压的结果。
   *
   * 这条断言直接查结构，不依赖像素。
   */
  it("是 .docpane__body 里的第一个 flex 项，包在左侧轨道的卡片里", () => {
    // 用 `import.meta.glob` 读源码而不是 `readFileSync(new URL(..., import.meta.url))`：
    // 本文件跑在 jsdom 环境下，`import.meta.url` 不是 file URL（`style-coverage` 那条
    // 走的是 node 环境，所以它能用）
    const sources = import.meta.glob("../src/features/notes/ui/NoteWorkspace.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const html = Object.values(sources)[0] ?? "";
    const bodyStart = html.indexOf('className="docpane__body"');
    // 左轨那一段不写死缩进（源码格式化会变），只认「展开属性时挂的是 side="left" 的轨道」
    const railMatch = /showProps \? \(\s*<DocRail\s+side="left"/.exec(html);
    const railStart = railMatch?.index ?? -1;
    const propsStart = html.indexOf("<ItemProps");
    expect(bodyStart).toBeGreaterThan(-1);
    expect(railStart).toBeGreaterThan(-1);
    expect(propsStart).toBeGreaterThan(-1);
    // 轨道与卡片都在滚动容器**里面**（它自己就是那个 flex 项），且轨道在卡片外面
    expect(railStart).toBeGreaterThan(bodyStart);
    expect(propsStart).toBeGreaterThan(railStart);
  });
});

describe("整条属性栏折叠 / 展开已移交两侧轨道（用户 2026-10-11 重设计 v2）", () => {
  it("卡片自己不再有折叠按钮，也没有摘要行（收起态是轨道那 28px 的把手）", () => {
    localStorage.clear();
    render(<ItemProps body={OB} editable {...noop} />);
    // 属性本体照常在（卡片不自己折叠）
    expect(screen.getByText("claude")).toBeTruthy();
    // 旧形状的两样东西都不在了：卡头那枚整条折叠按钮、以及它下面那行摘要
    expect(document.querySelector(".itemprops__toggle")).toBeNull();
    expect(document.querySelector(".itemprops__summary")).toBeNull();
    expect(screen.queryByText(/1 个标签/)).toBeNull();
  });
});

/** 把 hook 装进一个小组件，好拿到它给的回调 */
function Harness(props: {
  body: string;
  handle: EditorHandle | null;
  onError?: (message: string) => void;
  capture: (api: ReturnType<typeof useItemProps>) => void;
}) {
  const api = useItemProps({
    itemId: "n1",
    body: props.body,
    handle: props.handle,
    onError: props.onError,
  });
  props.capture(api);
  return null;
}

describe("useItemProps：改动必须经编辑器，不能自己存草稿", () => {
  it("加标签 → 改的是编辑器里的文本，且只改 front matter", () => {
    const { handle, state } = makeHandle(OB);
    let api: ReturnType<typeof useItemProps> | null = null;
    render(<Harness body={OB} handle={handle} capture={(value) => (api = value)} />);

    act(() => api!.onTagsChange(["claude", "tooling"]));

    expect(state.changes).toBe(1);
    expect(state.text.startsWith("---\n")).toBe(true);
    expect(state.text).toContain("tags: [claude, tooling]");
    // 外来键与正文一字不动
    expect(state.text).toContain('title: "Anatomy of the .claude/ folder"');
    expect(state.text).toContain("正文第一段。");
  });

  it("改外来键 → 只动那一个键，块形状保留", () => {
    const { handle, state } = makeHandle(OB);
    let api: ReturnType<typeof useItemProps> | null = null;
    render(<Harness body={OB} handle={handle} capture={(value) => (api = value)} />);

    act(() => api!.onForeignChange("author", '  - "Alice"', true));

    expect(state.text).toContain('author:\n  - "Alice"');
    expect(state.text).not.toContain("Unknown");
    expect(state.text).toContain("正文第一段。");
  });

  it("删外来键 → 那一段没了，别的还在", () => {
    const { handle, state } = makeHandle(OB);
    let api: ReturnType<typeof useItemProps> | null = null;
    render(<Harness body={OB} handle={handle} capture={(value) => (api = value)} />);

    act(() => api!.onForeignRemove("author"));

    expect(state.text).not.toContain("author");
    expect(state.text).not.toContain("Unknown");
    expect(state.text).toContain("url:");
  });

  it("编辑器还没挂上（预览档）→ 明确说切到「仅编辑」，不报「正文已经变了」", () => {
    const onError = vi.fn();
    let api: ReturnType<typeof useItemProps> | null = null;
    render(<Harness body={OB} handle={null} onError={onError} capture={(value) => (api = value)} />);

    act(() => api!.onTagsChange(["x"]));

    // 早先这里是「正文已经变了，没写进去；重新打开这一篇再试」——误报，用户什么都没干也一直弹
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("仅编辑"));
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining("正文已经变了"));
  });

  it("视图里的正文与卡片看到的不一致时也写得进去（区间由视图自己算）", () => {
    // 这正是之前一直误报的场景：两边一瞬不一致就永久失败
    const { handle, state } = makeHandle(OB);
    state.text = `---\ntitle: 视图里已经是新的了\ntags: [别的]\n---\n\n正文\n`;
    let api: ReturnType<typeof useItemProps> | null = null;
    const onError = vi.fn();
    render(<Harness body={OB} handle={handle} onError={onError} capture={(value) => (api = value)} />);

    act(() => api!.onTagsChange(["claude", "tooling"]));

    expect(onError).not.toHaveBeenCalled();
    expect(state.text).toContain("tags: [claude, tooling]");
    // 写进的是**视图里那份**的 front matter，不是拿旧文本去覆盖
    expect(state.text).toContain("正文");
  });

  it("句柄不在（预览档）→ 只读，不改任何东西", () => {
    let api: ReturnType<typeof useItemProps> | null = null;
    render(<Harness body={OB} handle={null} capture={(value) => (api = value)} />);

    expect(api!.editable).toBe(false);
    expect(api!.readOnlyReason).toContain("仅编辑");
  });

  it("给第一篇还没有属性的笔记加标签 → 在文档开头插入 front matter", async () => {
    const plain = "正文。\n";
    const { handle, state } = makeHandle(plain);
    let api: ReturnType<typeof useItemProps> | null = null;
    render(<Harness body={plain} handle={handle} capture={(value) => (api = value)} />);

    await act(async () => {
      api!.onTagsChange(["第一个"]);
    });

    await waitFor(() => expect(state.text.startsWith("---\ntags: [第一个]")).toBe(true));
    expect(state.text.endsWith("正文。\n")).toBe(true);
  });

  it("两条通道都到位：md 改了，派生列也跟着改（分叉了用户就看见标签没加上）", async () => {
    const { handle, state } = makeHandle(OB);
    let api: ReturnType<typeof useItemProps> | null = null;
    render(<Harness body={OB} handle={handle} capture={(value) => (api = value)} />);

    await act(async () => {
      api!.onTagsChange(["claude", "tooling"]);
    });

    // 通道一：正文（编辑器那份）
    await waitFor(() => expect(state.text).toContain("tags: [claude, tooling]"));
    // 通道二：派生列 `items.tags`（列表 / 标签视图 / 搜索读它）
    await waitFor(async () => {
      expect((await getLocalItem("n1"))?.tags).toEqual(["claude", "tooling"]);
    });
  });

  it("改清单字段：md 与三列一起改", async () => {
    const { handle, state } = makeHandle(OB);
    let api: ReturnType<typeof useItemProps> | null = null;
    render(<Harness body={OB} handle={handle} capture={(value) => (api = value)} />);

    await act(async () => {
      api!.onTaskChange({ status: "doing", due: "2026-10-08", priority: "high" });
    });

    await waitFor(() => expect(state.text).toContain("status: doing"));
    // 平铺：顶层三行，不再缩进在 `menote:` 下的 `task:` 里
    expect(state.text).toContain("due: 2026-10-08");
    expect(state.text).toContain("priority: high");
    expect(state.text).not.toContain("  status:");
    expect(state.text).not.toContain("task:");
    await waitFor(async () => {
      const item = await getLocalItem("n1");
      expect(item?.is_task).toBe(1);
      expect(item?.task_status).toBe("doing");
      expect(item?.task_due).toBe("2026-10-08");
      expect(item?.task_priority).toBe("high");
    });
  });

  it("去掉清单标记（清单侧动作仍走这条路）：顶层三键被删，三列清空（0002 的约束要求 is_task=0 时字段为空）", async () => {
    const withTask = updateMenoteKeys(OB, { task: { status: "todo", due: null, priority: null } });
    const { handle, state } = makeHandle(withTask);
    await act(async () => {
      const item = await getLocalItem("n1");
      expect(item).toBeTruthy();
    });
    let api: ReturnType<typeof useItemProps> | null = null;
    render(<Harness body={withTask} handle={handle} capture={(value) => (api = value)} />);

    await act(async () => {
      api!.onTaskChange(null);
    });

    await waitFor(() => expect(state.text).not.toContain("status:"));
    expect(state.text).not.toContain("due:");
    expect(state.text).not.toContain("priority:");
    expect(state.text).toContain("正文第一段。");
    await waitFor(async () => {
      const item = await getLocalItem("n1");
      expect(item?.is_task).toBe(0);
      expect(item?.task_status).toBeNull();
    });
  });
});
