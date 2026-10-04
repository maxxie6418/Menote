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
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveTags, updateMenoteKeys } from "@menote/mdcore";
import { createLocalItem, db, getLocalItem } from "../src/data/db";
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

/** 一个照着真 Editor 口径写的句柄替身：只认文档开头，对不上就 false，绝不插入 */
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
    replaceFrontmatter: (expected, next) => {
      if (!state.text.startsWith(expected)) return false;
      state.text = next + state.text.slice(expected.length);
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

  it("清单字段只在有 menote.task 键时才算清单条目", () => {
    expect(readItemProps(OB).task).toBeNull();
    const withTask = updateMenoteKeys(OB, { task: { status: "todo", due: "2026-10-08", priority: "high" } });
    expect(readItemProps(withTask).task).toEqual({
      status: "todo",
      due: "2026-10-08",
      priority: "high",
    });
  });

  it("外来键原样列出，MeNote 自己的三个键不在其中", () => {
    const keys = readItemProps(OB).foreign.map((one) => one.key);
    expect(keys).toEqual(["url", "author", "status"]);
    expect(keys).not.toContain("title");
    expect(keys).not.toContain("tags");
    expect(keys).not.toContain("menote");
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

  it("外来键行有删除按钮，标签行没有删除整行的", () => {
    render(<ItemProps body={OB} editable {...noop} />);
    expect(screen.getByLabelText("删除属性 url")).toBeTruthy();
    // tags 的删除是「删这一个 chip」，不是「删掉 tags 键」
    expect(screen.queryByLabelText("删除属性 tags")).toBeNull();
    expect(screen.queryByLabelText("删除属性 title")).toBeNull();
    expect(screen.queryByLabelText("删除属性 menote")).toBeNull();
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
    expect(screen.queryByLabelText("删除属性 url")).toBeNull();
  });

  it("没有外来键时不显示「其他属性」那一段", () => {
    render(<ItemProps body="---\ntitle: T\ntags: [a]\n---\n\n正文" editable {...noop} />);
    expect(screen.queryByText(/其他属性/)).toBeNull();
  });

  it("校验没过时把理由报出来，不静默吞", () => {
    const onError = vi.fn();
    render(<ItemProps body={OB} editable {...noop} onError={onError} />);
    // 块序列的值里含非法缩进不该由组件产生，这里只验组件把错误转出去
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("卡片在 DOM 里的位置", () => {
  /**
   * 2026-10-04 修的一个真布局缺陷。
   *
   * 卡片原先渲染在 `.docpane__body` **里面**，而那个容器是 `display: flex`（row）——
   * 装着编辑器或预览、各占 `flex: 1`。卡片成了第三个 flex 项，于是**和正文并排成一条
   * 窄列**，标签列被挤到截断，用户看到的是「属性区没在正文区顶部」。
   *
   * 这条断言直接查结构，不依赖像素。
   */
  it("是 .docpane__body 的兄弟节点，不在它里面", () => {
    // 用 `import.meta.glob` 读源码而不是 `readFileSync(new URL(..., import.meta.url))`：
    // 本文件跑在 jsdom 环境下，`import.meta.url` 不是 file URL（`style-coverage` 那条
    // 走的是 node 环境，所以它能用）
    const sources = import.meta.glob("../src/features/notes/ui/NoteWorkspace.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const html = Object.values(sources)[0] ?? "";
    const bodyStart = html.indexOf('<div className="docpane__body">');
    const propsStart = html.indexOf("<ItemProps");
    expect(bodyStart).toBeGreaterThan(-1);
    expect(propsStart).toBeGreaterThan(-1);
    // 卡片在滚动容器**之前**（它是不随正文滚动的一条带）
    expect(propsStart).toBeLessThan(bodyStart);
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

  it("对不上时报错并说明，不装作成功（绝不退化成插入）", () => {
    const { handle, state } = makeHandle("正文已经变了，没有 front matter");
    const onError = vi.fn();
    let api: ReturnType<typeof useItemProps> | null = null;
    render(
      <Harness body={OB} handle={handle} onError={onError} capture={(value) => (api = value)} />,
    );

    act(() => api!.onTagsChange(["x"]));

    expect(state.changes).toBe(0);
    // **最重要的一条**：没有把 front matter 插到正文中间
    expect(state.text).toBe("正文已经变了，没有 front matter");
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("正文已经变了"));
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

    await waitFor(() => expect(state.text).toContain("    status: doing"));
    await waitFor(async () => {
      const item = await getLocalItem("n1");
      expect(item?.is_task).toBe(1);
      expect(item?.task_status).toBe("doing");
      expect(item?.task_due).toBe("2026-10-08");
      expect(item?.task_priority).toBe("high");
    });
  });

  it("去掉清单标记：task 块被删，三列清空（0002 的约束要求 is_task=0 时字段为空）", async () => {
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

    await waitFor(() => expect(state.text).not.toContain("task:"));
    await waitFor(async () => {
      const item = await getLocalItem("n1");
      expect(item?.is_task).toBe(0);
      expect(item?.task_status).toBeNull();
    });
  });
});
