/**
 * 「正在编辑的那一行」的装饰**冻结**（v0.8.39，用户 2026-10-18 拍板的口径）。
 *
 * 背景：v0.8.37 把显现判据收成「光标**进**标记才显现源码」（半开区间 `pos >= from && pos < to`）。
 * 口径本身是用户要的，但它在打字期带出一个副作用：在行首连敲 `##` 时，光标始终停在标记的
 * `to` 上（半开判据不算命中），于是每停手 90ms 重算一次装饰，就把刚敲出来的 `#` 藏起来、
 * 该行按标题渲染（字号与行高跳变）——用户看到的是「标题写不出来 + 快速闪动」。
 * 真机复现与证据见 `docs/modules/MeNote-编辑器交互修复-设计-v1.md` §1.1。
 *
 * 处置（用户 2026-10-18 选的口径）：**不改判据，只改重算时机**——光标停在哪一行，那一行就
 * 保持「刚进入时」的呈现，直到光标离开该行、或该行的显现结论发生变化。代价是「正在编辑的
 * 那一行渲染迟一步」，这正是它要的效果：敲进去的 `#` 一直看得见，光标一离开就渲染成标题。
 *
 * 这一层刻意做成**纯函数**：jsdom 里建不出真的 `EditorView`（CM6 要布局 API），而这些判断
 * 只需要 `DecorationSet` 与行号，所以冻结逻辑能进 CI 逐条断言；接线在 `live-preview.ts`。
 */
import type { ChangeSet, Range } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import type { Span } from "./live-preview-reveal";

/** 一次冻结：光标所在行 + 该行的显现区间 + 该行那一份装饰 */
export interface LineLock {
  /** 行号（1 起，与 `Text.line().number` 同口径） */
  line: number;
  /** 锁定那一刻判定为「要显现源码」的标记区间 */
  reveal: readonly Span[];
  /** 锁定那一行上的**可冻结**装饰（点装饰：藏标记的 `replace` 与整行类名 `line`） */
  decos: readonly Range<Decoration>[];
}

/** 两份显现区间是不是同一份（逐区间比；长度不同直接否） */export function sameReveal(a: readonly Span[], b: readonly Span[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((span, i) => {
    const other = b[i];
    return other !== undefined && span.from === other.from && span.to === other.to;
  });
}

/**
 * 还该不该继续冻结：行号与显现结论**都没变**才继续。
 *
 * 两件都要比：只看行号会让「方向键把光标移进 `##` 内部」永远显现不出源码（显现结论变了），
 * 只看显现结论则会在光标换了一行、而两行都没显现任何标记时把上一行的装饰错贴过来。
 */
export function lockHolds(lock: LineLock | null, line: number, reveal: readonly Span[]): lock is LineLock {
  return lock !== null && lock.line === line && sameReveal(lock.reveal, reveal);
}

/**
 * 这次改动里有没有换行（回车、粘贴多行）。
 *
 * 有的话一律解除冻结：整行重排本来就会换掉这一行的行号与显现结论，冻着反而会让新内容停在
 * 源码形态（设计稿验收点 H：粘贴多行要立即渲染）。
 */
export function insertsLineBreak(changes: ChangeSet): boolean {
  let found = false;
  changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    if (inserted.toString().includes("\n")) found = true;
  });
  return found;
}

/**
 * 冻不冻这一件装饰：只冻**点装饰**（`RangeValue.point`）。
 *
 * 点装饰正好是「整行的呈现由它说了算」的那两类：`Decoration.replace`（把标记换成零宽/控件）
 * 与 `Decoration.line`（标题、引用的整行类名）。行内 `Decoration.mark`（代码 token 高亮、
 * 强调、链接）**不进冻结**——那些必须跟着新内容实时更新，否则代码块里打字会出现「刚敲的字没
 * 颜色、旧 token 跨越新空格」（设计稿 §2.2 与验收点 C 都钉了这一条，真机已实测到旧做法的问题）。
 * 常量与实测依据：`@codemirror/state` 的 `RangeValue.point`（index.d.ts:1426），
 * `replace`/`line`/`widget` 为 `true`、`mark` 为 `false`。
 */
function isFreezable(value: Decoration): boolean {
  return value.point === true;
}

/**
 * 与 `[from, to]` 这一行有交叠的**可冻结**装饰。
 *
 * 判据两侧都用 `<=`：行装饰（`Decoration.line`，标题与引用的整行类名）是**点装饰**，
 * `from === to` 且落在行首，写成 `iter.from < to && iter.to > from` 会把整行类名漏掉。
 */
export function lineDecorations(
  set: DecorationSet,
  from: number,
  to: number,
): readonly Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  for (let iter = set.iter(); iter.value; iter.next()) {
    if (!isFreezable(iter.value)) continue;
    if (iter.to >= from && iter.from <= to) out.push(iter.value.range(iter.from, iter.to));
  }
  return out;
}

/**
 * 冻结：把新算出的装饰集里属于 `[from, to]` 这一行的**可冻结**部分换成 `locked`，
 * 其余（别的行、以及所有行内 mark）照常按新结果渲染——滚动进新区域、代码 token 实时更新
 * 都不受影响。
 */
export function freezeLine(
  set: DecorationSet,
  from: number,
  to: number,
  locked: readonly Range<Decoration>[],
): DecorationSet {
  const rest: Range<Decoration>[] = [];
  for (let iter = set.iter(); iter.value; iter.next()) {
    if (isFreezable(iter.value) && iter.to >= from && iter.from <= to) continue;
    rest.push(iter.value.range(iter.from, iter.to));
  }
  // sort=true：两段拼起来后必须按位置排好，装饰集要求有序
  return Decoration.set([...rest, ...locked], true);
}
