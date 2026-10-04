// @vitest-environment jsdom
/**
 * 行拖动排序（M4-9 补；界面稿 §2.4 要求"拖动排序"，§2.5 的冲突规则）。
 *
 * 两条口径：
 * 1. **拖动的落点必须看得见**（拖动中给落点行加高亮类），否则拖了也不知道会插到哪；
 * 2. **排序生效时先清排序指示再拖**——否则"拖了但看到的顺序没变"（行按列排序显示，
 *    底层顺序改了、屏幕不动）。
 *
 * 键盘等价入口（行菜单的上移/下移）另有用例覆盖，这里只测拖动这一路。
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROW_ID_COLUMN } from "@menote/mdcore";
import { TableGrid } from "../src/features/tables/ui/TableGrid";
import type { TableViewState } from "../src/features/tables/model";

afterEach(cleanup);

/** 三行两列的最小表格 */
function state(sort: TableViewState["sort"] = null): TableViewState {
  return {
    doc: {
      columns: [
        { id: ROW_ID_COLUMN, name: "ID", type: "text", hidden: true },
        { id: "c1", name: "名称", type: "text" },
      ],
      rowIdColumn: ROW_ID_COLUMN,
      views: { default: "table" },
      rows: [
        { [ROW_ID_COLUMN]: "r1", c1: "甲" },
        { [ROW_ID_COLUMN]: "r2", c1: "乙" },
        { [ROW_ID_COLUMN]: "r3", c1: "丙" },
      ],
      attachments: [],
      notices: [],
      preservedLines: [],
      tags: [],
      foreignLines: [],
    },
    view: "table",
    filters: [],
    sort,
    hiddenColumns: [],
  } as unknown as TableViewState;
}

function renderGrid(
  overrides: {
    sort?: TableViewState["sort"];
    onReorderRow?: (rowId: string, beforeRowId: string | null) => void;
  } = {},
) {
  const view = state(overrides.sort ?? null);
  const onReorderRow = overrides.onReorderRow ?? vi.fn();
  const onSortChange = vi.fn();
  const { container } = render(
    <TableGrid
      state={view}
      rows={view.doc.rows}
      columns={view.doc.columns}
      editing={null}
      onEditingChange={vi.fn()}
      onCellChange={vi.fn()}
      onSortChange={onSortChange}
      onOpenColumnPanel={vi.fn()}
      onInsertRow={vi.fn()}
      onDeleteRow={vi.fn()}
      onMoveRow={vi.fn()}
      onReorderRow={onReorderRow}
    />,
  );
  const rowEls = [...container.querySelectorAll("tbody .tablegrid__tr")] as HTMLElement[];
  return { onReorderRow, onSortChange, rowEls };
}

/** jsdom 没有真的 DataTransfer：手搓一个够用的 */
function dataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    effectAllowed: "move",
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
  } as unknown as DataTransfer;
}

describe("行拖动", () => {
  it("有拖动柄（常驻可见，不靠悬停）", () => {
    const { rowEls } = renderGrid();
    expect(rowEls).toHaveLength(3);
    expect(rowEls[0]?.querySelector(".tablegrid__draghandle")).not.toBeNull();
  });

  it("往下拖：把第一行插到第三行**之后**（落点是目标行的下一行之前）", () => {
    const { onReorderRow, rowEls } = renderGrid();
    const transfer = dataTransfer();

    fireEvent.dragStart(rowEls[0]!, { dataTransfer: transfer });
    fireEvent.dragOver(rowEls[2]!, { dataTransfer: transfer });
    fireEvent.drop(rowEls[2]!, { dataTransfer: transfer });

    // 拖到末尾 → 锚点是 null（没有"下一行"）
    expect(onReorderRow).toHaveBeenCalledWith("r1", null);
  });

  it("往上拖：插到目标行**之前**", () => {
    const { onReorderRow, rowEls } = renderGrid();
    const transfer = dataTransfer();

    fireEvent.dragStart(rowEls[2]!, { dataTransfer: transfer });
    fireEvent.dragOver(rowEls[0]!, { dataTransfer: transfer });
    fireEvent.drop(rowEls[0]!, { dataTransfer: transfer });

    expect(onReorderRow).toHaveBeenCalledWith("r3", "r1");
  });

  it("拖动中给落点行加高亮类（否则拖了也不知道插到哪）", () => {
    const { rowEls } = renderGrid();
    const transfer = dataTransfer();

    fireEvent.dragStart(rowEls[0]!, { dataTransfer: transfer });
    fireEvent.dragOver(rowEls[1]!, { dataTransfer: transfer });
    expect(rowEls[1]?.className).toContain("tablegrid__tr--drop");

    fireEvent.drop(rowEls[1]!, { dataTransfer: transfer });
    expect(rowEls[1]?.className).not.toContain("tablegrid__tr--drop");
  });

  it("按列排序生效时先清排序指示再拖（界面稿 §2.5 的冲突规则）", () => {
    const { onSortChange, rowEls } = renderGrid({ sort: { columnId: "c1", direction: "asc" } });
    const transfer = dataTransfer();

    fireEvent.dragStart(rowEls[0]!, { dataTransfer: transfer });
    expect(onSortChange).toHaveBeenCalledWith(null);
  });

  it("没给 onReorderRow 时不出现拖动柄（组件不假设调用方支持拖动）", () => {
    const { container } = render(
      <TableGrid
        state={state()}
        rows={state().doc.rows}
        columns={state().doc.columns}
        editing={null}
        onEditingChange={vi.fn()}
        onCellChange={vi.fn()}
        onSortChange={vi.fn()}
        onOpenColumnPanel={vi.fn()}
        onInsertRow={vi.fn()}
        onDeleteRow={vi.fn()}
        onMoveRow={vi.fn()}
      />,
    );
    expect(container.querySelector(".tablegrid__draghandle")).toBeNull();
  });
});
