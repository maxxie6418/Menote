// @vitest-environment jsdom
/**
 * 表格接线与自动降级（M4-9 接线 + 界面稿 §2.10）。
 *
 * **背景（2026-09-27 发现）**：表格的模型与组件（57 例）早就写完了，但**从没接进正文区**——
 * `TableEditor` 与 `checkDegrade` 在 `apps/web/src` 里没有任何调用点，打开一条表格条目看到的是
 * 普通 Markdown 编辑器。这个文件钉住接线本身，以及"解析失败时**不静默改数据**"这条硬要求。
 *
 * CodeMirror 与 MarkdownPreview 换成替身（jsdom 里跑不了真编辑器）；表格界面用真组件加载。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDocument, renderTableDocument, ROW_ID_COLUMN } from "@menote/mdcore";
void buildDocument;

vi.mock("../src/app/editor/Editor", () => ({
  Editor: (props: { initialValue: string }) => (
    <div data-testid="editor" data-initial={props.initialValue} />
  ),
}));

vi.mock("../src/app/editor/MarkdownPreview", () => ({
  MarkdownPreview: (props: { source: string }) => <div data-testid="preview" data-source={props.source} />,
}));

import { NoteWorkspace } from "../src/features/notes/ui/NoteWorkspace";
import { useTableDoc } from "../src/features/tables/useTableDoc";
import { renderHook, act } from "@testing-library/react";
import type { LocalItem } from "../src/data/db";

afterEach(cleanup);

const noop = (): void => undefined;

function item(type: LocalItem["type"] = "table", title = "我的表"): LocalItem {
  return {
    id: "t1",
    type,
    folder_id: null,
    title,
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 0,
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
  };
}

/** 一份结构完整的表格文档（形状照 `tables-model.test.ts` 的 `doc()`，用 mdcore 的 renderer 生成） */
function tableBody(): string {
  return renderTableDocument({
    columns: [
      { id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true },
      { id: "c1", name: "名称", type: "text" },
      { id: "c2", name: "数量", type: "number" },
    ],
    rowIdColumn: ROW_ID_COLUMN,
    views: { default: "table" },
    rows: [
      { [ROW_ID_COLUMN]: "aaa111", c1: "苹果", c2: "3" },
      { [ROW_ID_COLUMN]: "bbb222", c1: "梨", c2: "5" },
    ],
    // 这三个空数组是 `TableDoc` 的必填项（少了就 `undefined.length`——第一次写这个夹具时正好踩到）
    attachments: [],
    notices: [],
    preservedLines: [],
    tags: [],
    foreignLines: [],
  } as never);
}

/** 声明是表格但结构坏掉（列定义缺了） */
const BROKEN_BODY = "---\nmenote:\n  type: table\n---\n\n| 名称 |\n| --- |\n| 苹果 |\n";

describe("表格接线", () => {
  it("表格条目且结构完整 → 走表格界面（不是 Markdown 编辑器）", async () => {
    render(
      <NoteWorkspace item={item("table")} initialBody={tableBody()} snapshot={null} onInput={noop} onTitleChange={noop} />,
    );

    // 表格界面的工具栏出现（按需加载，等它出来）
    expect(await screen.findByRole("button", { name: "新增行" }, { timeout: 5000 })).toBeTruthy();
    // 普通笔记的两个面都不该出现
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(screen.queryByTestId("preview")).toBeNull();
  });

  it("普通笔记条目**不**走表格界面（回归：别把笔记当表格打开）", async () => {
    render(
      <NoteWorkspace
        item={item("note", "笔记")}
        initialBody="就一段文字"
        snapshot={null}
        onInput={noop}
        onTitleChange={noop}
      />,
    );

    expect(await screen.findByTestId("editor")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "新增行" })).toBeNull();
  });

  /**
   * 模式切换（分屏 / 仅编辑 / 仅预览）**只对 Markdown 正文有意义**：
   * 表格有自己的"表格 / 图册"档位，表格分支根本不看 `mode`——此前它对表格也渲染，
   * 于是成了一个"点了没反应"的控件（界面稿 §3 的正文头也只列了标题 + 锁标识 + 更多菜单）。
   */
  it("表格条目不显示「编辑模式」切换（点了不会有反应的控件不该出现）", async () => {
    render(
      <NoteWorkspace item={item("table")} initialBody={tableBody()} snapshot={null} onInput={noop} onTitleChange={noop} />,
    );
    expect(await screen.findByRole("button", { name: "新增行" }, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "编辑模式" })).toBeNull();
  });

  it("普通笔记仍显示「编辑模式」切换（这是它的正文档位）", async () => {
    render(
      <NoteWorkspace
        item={item("note", "笔记")}
        initialBody="就一段文字"
        snapshot={null}
        onInput={noop}
        onTitleChange={noop}
      />,
    );
    expect(await screen.findByRole("group", { name: "编辑模式" })).toBeTruthy();
  });

  /**
   * 「添加附件」同理：附件的占位与落库都要插进 Markdown 正文（`EditorHandle.insert`），
   * 表格没有这个句柄——文件会照传上去，却没有任何引用指向它，30 天后按孤儿清掉。
   */
  it("表格条目不显示「添加附件」（传上去也没人引用，会变成孤儿）", async () => {
    render(
      <NoteWorkspace
        item={item("table")}
        initialBody={tableBody()}
        snapshot={null}
        onInput={noop}
        onTitleChange={noop}
        onFiles={noop}
      />,
    );
    expect(await screen.findByRole("button", { name: "新增行" }, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "添加附件" })).toBeNull();
  });

  it("普通笔记有「添加附件」（给了 onFiles 才出现）", async () => {
    render(
      <NoteWorkspace
        item={item("note", "笔记")}
        initialBody="就一段文字"
        snapshot={null}
        onInput={noop}
        onTitleChange={noop}
        onFiles={noop}
      />,
    );
    expect(await screen.findByRole("button", { name: "添加附件" })).toBeTruthy();
  });
});

describe("自动降级（界面稿 §2.10：不静默改数据）", () => {
  it("结构损坏 → 顶部危险态提示条 + 按普通笔记打开，且**原文一字未改**", async () => {
    render(
      <NoteWorkspace item={item("table")} initialBody={BROKEN_BODY} snapshot={null} onInput={noop} onTitleChange={noop} />,
    );

    // 提示条是危险态（红色常驻横幅），文案按界面稿原文
    const notice = screen.getByRole("alert");
    expect(notice.className).toContain("banner--danger");
    expect(within(notice).getByText(/表格结构无法解析，已按普通笔记打开；原文未改动/)).toBeTruthy();
    // 两条出路都在
    expect(within(notice).getByRole("button", { name: "查看原文" })).toBeTruthy();
    expect(within(notice).getByRole("button", { name: "下载当前内容" })).toBeTruthy();

    // 下面按普通笔记打开，正文是**未改动**的原文（不是 stripTableMeta 之后的那份）
    const editor = await screen.findByTestId("editor");
    expect(editor.getAttribute("data-initial")).toBe(BROKEN_BODY);
  });

  it("「查看原文」切到仅编辑（原文可复制走）", async () => {
    const user = userEvent.setup();
    render(
      <NoteWorkspace item={item("table")} initialBody={BROKEN_BODY} snapshot={null} onInput={noop} onTitleChange={noop} />,
    );

    await user.click(screen.getByRole("button", { name: "查看原文" }));
    // 仅编辑档下只有编辑器、没有预览
    expect(await screen.findByTestId("editor")).toBeTruthy();
    expect(screen.queryByTestId("preview")).toBeNull();
  });
});

describe("useTableDoc", () => {
  it("结构完整时给出可编辑的 doc；commit 会序列化回正文", () => {
    const { result } = renderHook(() => useTableDoc(tableBody()));
    expect(result.current.state.kind).toBe("table");

    const before = result.current.current();
    act(() => {
      if (result.current.state.kind === "table") {
        const doc = result.current.state.doc;
        result.current.commit({ ...doc, columns: [...doc.columns, { id: "c3", name: "备注", type: "text" }] } as never);
      }
    });
    expect(result.current.current()).not.toBe(before);
    expect(result.current.current()).toContain("备注");
  });

  it("结构损坏时给出 degrade 状态与原因，**且不返回被改写过的正文**", () => {
    const { result } = renderHook(() => useTableDoc(BROKEN_BODY));
    expect(result.current.state.kind).toBe("degrade");
    // 原文（未改动）与"降级后应当写成什么"是两回事：后者只能由用户主动确认后才落库
    expect(result.current.current()).toBe(BROKEN_BODY);
  });
});
