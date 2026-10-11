/**
 * 本篇内查找与替换——开关与扩展（编辑器专项优化 P3）。
 *
 * **移植自 shuaiplus/inkstone `src/client/editor/search.ts` 的开关逻辑
 * （LGPL-3.0，本项目已整体转 LGPL-3.0-only）**；面板 UI 在 `search-panel.ts`，
 * 共享状态在 `search-state.ts`（两者互不引用，本文件是唯一的装配点）。
 *
 * 为什么不用 `@codemirror/search` 的默认面板：功能弱（无选区范围、无结果列表、无替换撤销）
 * 且样式突兀。本文件保留它的查询引擎（`SearchQuery` / `replaceAll` / `replaceNext`），
 * 只换壳。`Editor` 两档常驻挂 `noteSearch()`；面板打开时即时渲染整篇回落源码
 * （live-preview 自己查 `searchPanelOpen`）。
 */
import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import {
  SearchQuery,
  closeSearchPanel,
  getSearchQuery,
  openSearchPanel,
  search,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import { createNoteSearchPanel, searchPanels } from "./search-panel";
import { searchOptions, setOptions, withinScope, type SearchRange } from "./search-state";

export { closeSearchPanel, searchPanelOpen };

function openPanel(view: EditorView, mode: "find" | "replace"): boolean {
  const previous = getSearchQuery(view.state);
  const alreadyOpen = searchPanelOpen(view.state);
  const selection = view.state.selection.main;
  // 打开时若带着一个不太长的选区，就把它当作初始查询词；否则沿用上次的查询
  const selected =
    !alreadyOpen && !selection.empty && selection.to - selection.from <= 200
      ? view.state.sliceDoc(selection.from, selection.to)
      : "";
  openSearchPanel(view);
  view.dispatch({
    effects: [
      setOptions.of({
        mode,
        ...(!alreadyOpen
          ? { scope: null, candidate: selection.empty ? null : { from: selection.from, to: selection.to } }
          : {}),
      }),
      setSearchQuery.of(
        new SearchQuery({
          ...previous,
          search: selected || previous.search,
          regexp: selected ? false : previous.regexp,
          literal: selected ? true : previous.literal,
          test: withinScope,
        }),
      ),
    ],
  });
  const field = view.dom.querySelector<HTMLTextAreaElement>("[main-field]");
  field?.focus();
  field?.select();
  return true;
}

export const openFindPanel = (view: EditorView): boolean => openPanel(view, "find");
export const openReplacePanel = (view: EditorView): boolean => openPanel(view, "replace");

function moveMatch(view: EditorView, direction: number): boolean {
  if (!searchPanelOpen(view.state)) openFindPanel(view);
  searchPanels.get(view)?.navigate(direction);
  return true;
}

/** 查找/替换扩展：`Editor` 常驻挂载（编辑 / 即时渲染两档都在） */
export function noteSearch(): Extension {
  return [
    searchOptions,
    search({ top: true, literal: true, createPanel: createNoteSearchPanel }),
    keymap.of([
      { key: "F3", run: (view) => moveMatch(view, 1), shift: (view) => moveMatch(view, -1), preventDefault: true },
      { key: "Mod-g", run: (view) => moveMatch(view, 1), shift: (view) => moveMatch(view, -1), preventDefault: true },
    ]),
  ];
}

/** 面板外（如测试）读某个状态量的窄助手；`EditorState` 走类型出口 */
export type { EditorState, SearchRange };
