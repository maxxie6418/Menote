// @vitest-environment jsdom
/**
 * 「正在编辑的那一行」的装饰冻结（v0.8.39）。
 *
 * 为什么这一层必须进 CI：jsdom 里建不出真的 `EditorView`（CM6 要布局 API），而用户报的
 * 「标题写不出来 + 快速闪动」只在**装饰被反复换掉**时出现。于是把这件事拆成一条可断言的链路：
 *
 *   判据不变（光标停在 `#` 的 `to` 上不算命中）→ 新算出的装饰确实会藏掉 `#`
 *   → **冻结**之后这一行不再换装饰 → `#` 留在屏幕上
 *
 * 真机复现与截图见 `docs/modules/MeNote-编辑器交互修复-设计-v1.md` §1.1 / §6 验收点 A。
 */
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ChangeSet, EditorState } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { buildLivePreviewDecorations } from "../src/app/editor/live-preview";
import {
  freezeLine,
  insertsLineBreak,
  lineDecorations,
  lockHolds,
  sameReveal,
  type LineLock,
} from "../src/app/editor/live-preview-lock";

function makeState(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

/** 按「折叠光标停在 `revealAt`」这一档构建装饰（与插件同一条路径） */
function build(doc: string, revealAt: readonly number[]) {
  const state = makeState(doc);
  return buildLivePreviewDecorations({ state, from: 0, to: doc.length, revealAt });
}

/** 把装饰集摊成 `[from, to]` 清单 */
function spans(set: DecorationSet): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let iter = set.iter(); iter.value; iter.next()) out.push([iter.from, iter.to]);
  return out;
}

describe("按行冻结：敲 `##` 时那一行不再被换掉", () => {
  it("判据没变：光标停在 `#` 的末尾不算命中，新算的装饰会藏掉它", () => {
    const built = build("#", [1]);
    expect(built.reveal).toEqual([]);
    // 藏掉 `#`：装饰集里有一条落在 [0, 1] 上的 replace
    expect(spans(built.decorations).some(([from, to]) => from === 0 && to === 1)).toBe(true);
  });

  it("冻结之后这一行沿用锁定那一份（空），`#` 就留在了屏幕上", () => {
    const built = build("#", [1]);
    const lock: LineLock = { line: 1, reveal: [], decos: [] };

    // 冻结的判据：行号与显现结论都没变
    expect(lockHolds(lock, 1, built.reveal)).toBe(true);
    const frozen = freezeLine(built.decorations, 0, 1, lock.decos);
    expect(lineDecorations(frozen, 0, 1)).toEqual([]);
  });

  it("冻结只作用于这一行：其余行的新装饰照常上", () => {
    // 第二行是新敲进去的 `> 引用`，它不在被冻的那一行上
    const built = build("#\n> 引用", [1]);
    const frozen = freezeLine(built.decorations, 0, 1, []);
    expect(spans(frozen).some(([from]) => from > 1)).toBe(true);
    expect(lineDecorations(frozen, 0, 1)).toEqual([]);
  });

  it("光标移进标记里 → 显现结论变了 → 不再冻结（v0.8.37 口径原样保留）", () => {
    const lock: LineLock = { line: 1, reveal: [], decos: [] };
    const built = build("#", [0]); // 光标在 `#` 里面
    expect(built.reveal.length).toBeGreaterThan(0);
    expect(lockHolds(lock, 1, built.reveal)).toBe(false);
  });

  it("光标换到别的行 → 不再冻结", () => {
    const built = build("#\n正文", [3]);
    expect(lockHolds({ line: 1, reveal: [], decos: [] }, 2, built.reveal)).toBe(false);
  });

  it("没有锁定状态时不冻结（失焦、有展开选区）", () => {
    expect(lockHolds(null, 1, [])).toBe(false);
  });
});

describe("冻结的辅助函数", () => {
  it("lineDecorations 只收可冻结的点装饰（行装饰两侧都要用 <=，行内 mark 不收）", () => {
    const set = Decoration.set([
      Decoration.line({ class: "cm-live-h1" }).range(0, 0),
      Decoration.replace({}).range(3, 4),
      Decoration.mark({ class: "cm-live-tok" }).range(6, 8),
    ]);
    // 行装饰是落在行首的点装饰（from === to === 0），左侧判据写成 < 就会漏掉它
    expect(lineDecorations(set, 0, 2).length).toBe(1);
    // 藏标记的 replace 也是点装饰
    expect(lineDecorations(set, 3, 4).length).toBe(1);
    // 行内 mark（代码 token 高亮）不进冻结快照
    expect(lineDecorations(set, 6, 8)).toEqual([]);
  });

  it("freezeLine 只换点装饰，行内 mark（代码 token）仍用新结果", () => {
    const next = Decoration.set([
      Decoration.line({ class: "cm-live-h1" }).range(0, 0),
      Decoration.replace({}).range(1, 2),
      Decoration.mark({ class: "cm-live-tok" }).range(4, 6),
    ]);
    // 锁定那一刻「标记没被藏起来」的那一份：这一行只有整行类名，没有 replace
    const locked = [Decoration.line({ class: "cm-live-h1" }).range(0, 0)];
    const frozen = freezeLine(next, 0, 2, locked);

    // 新算的整行类名与 replace 被锁定那一份换掉；行内 token mark 原样留下
    expect(spans(frozen)).toEqual([
      [0, 0],
      [4, 6],
    ]);
  });

  it("sameReveal 逐区间比，且不认顺序差", () => {
    expect(sameReveal([], [])).toBe(true);
    expect(sameReveal([{ from: 1, to: 3 }], [{ from: 1, to: 3 }])).toBe(true);
    expect(sameReveal([{ from: 1, to: 3 }], [])).toBe(false);
    expect(sameReveal([{ from: 1, to: 3 }], [{ from: 1, to: 4 }])).toBe(false);
    expect(
      sameReveal(
        [
          { from: 1, to: 3 },
          { from: 5, to: 6 },
        ],
        [
          { from: 5, to: 6 },
          { from: 1, to: 3 },
        ],
      ),
    ).toBe(false);
  });

  it("insertsLineBreak 认回车与多行粘贴，不认单行输入", () => {
    expect(insertsLineBreak(ChangeSet.of([{ from: 1, insert: "#" }], 4))).toBe(false);
    expect(insertsLineBreak(ChangeSet.of([{ from: 1, insert: "\n" }], 4))).toBe(true);
    expect(insertsLineBreak(ChangeSet.of([{ from: 1, insert: "a\nb" }], 4))).toBe(true);
  });
});
