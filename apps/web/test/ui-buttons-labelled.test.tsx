// @vitest-environment jsdom
/**
 * "每个按钮都有可访问名字"（读屏底线；2026-09-27 新增）。
 *
 * **为什么用渲染层而不是扫源码**：先写了个扫 `<button>` 的脚本，它对
 * `<button><Icon/><span>{entry.title}</span></button>` 会**误报**——可见文字来自表达式，
 * 静态分析剥掉花括号后就看不出有没有名字了。**误报和漏报都不可信**，所以改成在 jsdom 里
 * 真的渲染一遍：`getAllByRole("button")` 逐个查"有没有可访问名字"。
 * 这条断言同时覆盖两类真实风险：图标按钮忘了 `aria-label`、以及按钮内容全靠图标表达。
 *
 * 可访问名字的判定（够用版）：可见文字（`textContent`）→ `aria-label` → `title`。
 */
import { cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROW_ID_COLUMN, renderTableDocument } from "@menote/mdcore";
import { TableEditor } from "../src/features/tables/ui/TableEditor";
import { useTableDoc } from "../src/features/tables/useTableDoc";
import { TrashPage } from "../src/features/trash/ui/TrashPage";
import { trashRows } from "../src/features/trash/model";
import { DocStatusBar } from "../src/features/notes/ui/DocStatusBar";
import { DEFAULT_PRIVACY_SETTINGS, privacyGateFrom } from "@menote/shared";
import type { LocalItem } from "../src/data/db";

afterEach(cleanup);

/** 断言容器里每个按钮都有可访问名字；返回数量便于确认"真的查了东西" */
function assertButtonsLabelled(container: HTMLElement): number {
  const buttons = [...container.querySelectorAll("button")];
  const unlabeled = buttons.filter((button) => {
    const text = (button.textContent ?? "").replace(/\s+/g, "");
    return (
      text === "" &&
      (button.getAttribute("aria-label") ?? "") === "" &&
      (button.getAttribute("title") ?? "") === ""
    );
  });
  expect(unlabeled.map((button) => button.outerHTML.slice(0, 120))).toEqual([]);
  return buttons.length;
}

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);
const gate = privacyGateFrom(DEFAULT_PRIVACY_SETTINGS, "unlocked");

function tableItem(): LocalItem {
  return {
    id: "t1",
    type: "table",
    folder_id: null,
    title: "我的表",
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

const TABLE_BODY = renderTableDocument({
  columns: [
    { id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true },
    { id: "c1", name: "名称", type: "text" },
    { id: "c2", name: "标签", type: "tags" },
  ],
  rowIdColumn: ROW_ID_COLUMN,
  views: { default: "table" },
  rows: [{ [ROW_ID_COLUMN]: "aaa111", c1: "苹果", c2: "水果,生鲜" }],
  attachments: [],
  notices: [],
  preservedLines: [],
  tags: [],
  foreignLines: [],
} as never);

describe("按钮的可访问名字", () => {
  it("表格界面（工具栏 / 表头 / 行菜单）：每个按钮都有名字", async () => {
    // 用真入口解析（`useTableDoc` 内部走 mdcore 的 renderer/parser），别手搓 state
    const { result } = renderHook(() => useTableDoc(TABLE_BODY));
    await waitFor(() => {
      expect(result.current.state.kind).toBe("table");
    });
    const state = result.current.state;
    if (state.kind !== "table") throw new Error("夹具没解析成表格");

    const { container, findByRole } = render(
      <TableEditor
        title="我的表"
        doc={state.doc}
        onDocChange={vi.fn()}
        onRequestDegrade={vi.fn()}
      />,
    );
    // 等表格真的渲染出来（按需加载），别在空容器上做"零个按钮也算通过"的假断言
    await findByRole("button", { name: "新增行" });
    expect(assertButtonsLabelled(container)).toBeGreaterThanOrEqual(4);
  });

  it("回收站页：每个按钮都有名字", () => {
    const rows = trashRows(
      [
        {
          ...tableItem(),
          id: "i1",
          type: "note",
          title: "被删的笔记",
          deleted_at: NOW - 1000,
          deleted: true,
        },
      ],
      NOW,
      gate,
    );
    const { container } = render(
      <TrashPage
        rows={rows}
        selected={new Set()}
        onToggleSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onRestore={vi.fn()}
        onPurge={vi.fn()}
        onEmpty={vi.fn()}
        onBackToSettings={vi.fn()}
      />,
    );
    expect(assertButtonsLabelled(container)).toBeGreaterThanOrEqual(3);
  });

  it("正文状态栏的附件行：重试按钮有名字", () => {
    const { container } = render(
      <DocStatusBar
        snapshot={{
          bytes: 10,
          sizeLabel: "10 B",
          sizeLevel: "ok",
          saveState: "synced",
        }}
        attachments={{ label: "有 1 个附件没传完", tone: "warn", onRetry: vi.fn() }}
      />,
    );
    expect(assertButtonsLabelled(container)).toBeGreaterThanOrEqual(1);
  });
});
