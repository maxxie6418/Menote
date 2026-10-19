/**
 * 编辑器排版设置 → CSS 变量（2026-10-19，设置 › 编辑设置，设计 §5）。
 *
 * ## 为什么是纯函数 + CSS 变量
 *
 * 排版要同时作用于**四个地方**：编辑档的 `.cm-scroller`、即时渲染档的同一张纸、仅预览档的
 * `.markdown-body`、以及与纸面同轴对齐的格式工具栏。它们不是同一棵子树里的兄弟就是跨档切换的
 * 同一元素，唯一一处共同的祖先就是正文区（`NoteWorkspace` 的 `.docpane`）。所以：
 * 在那一层挂一组 CSS 变量，四处的规则各自 `var(--x, 令牌值)` 兜底——**改一处、四处同时生效**，
 * 且不需要给每个档传一遍 props。
 *
 * ## 三条纪律
 *
 * 1. **空 = 跟随主题**：读侧只翻"有值的项"，没配的项**不产生声明**，CSS 里的兜底就是
 *    `DESIGN.md` §3.3 的令牌值。于是全新账号与"把项清空"渲染结果逐像素相同。
 * 2. **越界即丢弃、不抛错**：库里可能被旧客户端、手改、别的实例写入任何东西——夹取失败就当没配
 *    （回落令牌），绝不因为一个坏值把整页排版弄崩。
 * 3. **颜色只认 `#rrggbb`**：原生 `<input type="color">` 的输出形态就是它；其余一律丢弃，
 *    免得任意字符串顺着自定义属性流进 `color:` 声明。
 */
import {
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  EDITOR_PAPER_WIDTH_MAX,
  EDITOR_PAPER_WIDTH_MIN,
  HEADING_FONT_SIZE_MAX,
  HEADING_FONT_SIZE_MIN,
  HEADING_LEVELS,
  HEADING_WEIGHTS,
  type EditorFontFamily,
  type EditorTypographyInput,
} from "@menote/shared";

/** 纸面左右内边距之和（与 `app.css` 的 `.cm-content` / `.markdown-body` 那两处 48px 对应） */
export const EDITOR_PAPER_PADDING_X = 48;
/** 缺省纸面宽度（= `DESIGN.md` §2.8 的 800） */
export const DEFAULT_PAPER_WIDTH = 800;

/** 字体族 → CSS 令牌。缺省档：编辑档等宽、即时渲染与预览档无衬线（`app.css` 现状） */
export const EDITOR_FONT_STACK: Record<EditorFontFamily, string> = {
  sans: "var(--sans)",
  mono: "var(--mono)",
};

function integerInRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

/** 正文字号（px）；越界或非数字返回 null（= 跟随主题） */
export function clampFontSize(value: unknown): number | null {
  return integerInRange(value, EDITOR_FONT_SIZE_MIN, EDITOR_FONT_SIZE_MAX);
}

/** 纸面宽度（px）；越界或非数字返回 null（= 800） */
export function clampPaperWidth(value: unknown): number | null {
  return integerInRange(value, EDITOR_PAPER_WIDTH_MIN, EDITOR_PAPER_WIDTH_MAX);
}

/** 标题字号（px）；区间比正文宽（见契约里的 `HEADING_FONT_SIZE_*`） */
export function clampHeadingFontSize(value: unknown): number | null {
  return integerInRange(value, HEADING_FONT_SIZE_MIN, HEADING_FONT_SIZE_MAX);
}

/** 字重；只认契约里的候选（400/500/600/700），其余丢弃 */
export function normalizeHeadingWeight(value: unknown): number | null {
  if (typeof value !== "number") return null;
  return (HEADING_WEIGHTS as readonly number[]).includes(value) ? value : null;
}

/** 颜色；只认 `#rrggbb`（原生颜色输入的形态），其余丢弃 */
export function normalizeHeadingColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : null;
}

/** 排版生效时用的纸面宽度（设置页的实时推算与 `useRails` 的让位门槛都用它） */
export function paperWidthOf(typography: EditorTypographyInput | undefined): number {
  return clampPaperWidth(typography?.paper_width) ?? DEFAULT_PAPER_WIDTH;
}

/** 文字列宽度 = 纸面宽 − 左右内边距（设置页在数字框下方平铺这个推算值） */
export function textColumnWidth(paperWidth: number): number {
  return paperWidth - EDITOR_PAPER_PADDING_X * 2;
}

/**
 * 把设置翻成一组 CSS 变量。**只包含有值的项**（没配的不产生声明，由 CSS 的兜底令牌接管）。
 *
 * 返回值直接当 `style` 用：`<div className="docpane" style={vars}>`。
 */
export function editorTypographyVars(
  typography: EditorTypographyInput | undefined,
): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!typography) return vars;

  const fontSize = clampFontSize(typography.font_size);
  if (fontSize !== null) vars["--doc-fs-body"] = `${fontSize}px`;

  const family = typography.font_family;
  if (family && family in EDITOR_FONT_STACK) {
    vars["--doc-font"] = EDITOR_FONT_STACK[family];
  }

  const paperWidth = clampPaperWidth(typography.paper_width);
  if (paperWidth !== null) vars["--doc-paper-w"] = `${paperWidth}px`;

  for (const level of HEADING_LEVELS) {
    const style = typography.headings?.[level];
    if (!style) continue;
    const size = clampHeadingFontSize(style.size);
    if (size !== null) vars[`--doc-${level}-size`] = `${size}px`;
    const weight = normalizeHeadingWeight(style.weight);
    if (weight !== null) vars[`--doc-${level}-weight`] = String(weight);
    const color = normalizeHeadingColor(style.color);
    if (color !== null) vars[`--doc-${level}-color`] = color;
  }

  return vars;
}
