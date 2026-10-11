/**
 * 查找/替换的**共享状态层**（编辑器专项优化 P3）：`searchOptions`（档位 / 选区范围 /
 * 候选范围）与「只在选区内」的匹配过滤。查询引擎本身还是 `@codemirror/search` 的
 * `SearchQuery`——这里只是给它配的参数状态，`search.ts`（开关与扩展）与
 * `search-panel.ts`（面板 UI）都从这里拿，两文件互不引用。
 */
import { StateEffect, StateField, type EditorState } from "@codemirror/state";

export type SearchMode = "find" | "replace";

export interface SearchRange {
  from: number;
  to: number;
}

export interface SearchOptions {
  mode: SearchMode;
  /** 开着「仅在选区内」时的查找范围；null = 全篇 */
  scope: SearchRange | null;
  /** 打开面板那一刻的选区（当时没勾选区也没选字的话，勾选框没有可圈的范围） */
  candidate: SearchRange | null;
}

export const setOptions = StateEffect.define<Partial<SearchOptions>>();

export const searchOptions = StateField.define<SearchOptions>({
  create: () => ({ mode: "find", scope: null, candidate: null }),
  update(value, tr) {
    const map = (range: SearchRange | null) =>
      range && {
        from: tr.changes.mapPos(range.from, -1),
        to: tr.changes.mapPos(range.to, 1),
      };
    let next = tr.docChanged ? { ...value, scope: map(value.scope), candidate: map(value.candidate) } : value;
    for (const effect of tr.effects)
      if (effect.is(setOptions)) next = { ...next, ...effect.value };
    return next;
  },
});

/** 选区范围过滤：开关打开时只认落在范围里的匹配 */
export function withinScope(_match: string, state: EditorState, from: number, to: number): boolean {
  const scope = state.field(searchOptions, false)?.scope;
  return !scope || (from >= scope.from && to <= scope.to);
}
