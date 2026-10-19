// @vitest-environment jsdom
/**
 * 编辑器排版设置 → CSS 变量（v0.8.40，设置 › 编辑设置 › 正文排版 / 标题样式）。
 *
 * 这个模块是纯函数，用例不需要组件、也不需要 CodeMirror：**读侧的三条纪律**全在这里钉住——
 * ①空 = 跟随主题（不产生声明）；②越界/坏值一律丢弃、绝不抛错；③颜色只认 `#rrggbb`。
 *
 * 为什么值得单独钉：这些值最终会顺着自定义属性流进 `color:` / `font-size:` 声明，
 * "库里存着什么"由旧客户端、手改 JSON、别的实例共同决定——读侧是唯一一道关口。
 */
import { describe, expect, it } from "vitest";
import {
  clampFontSize,
  clampHeadingFontSize,
  clampPaperWidth,
  editorTypographyVars,
  normalizeHeadingColor,
  normalizeHeadingWeight,
  paperWidthOf,
  textColumnWidth,
} from "../src/features/settings/editor-typography";

describe("编辑器排版：越界与坏值处理", () => {
  it("字号 / 纸面宽度 / 标题字号都按契约区间夹取，越界与坏值一律丢弃", () => {
    expect(clampFontSize(16)).toBe(16);
    expect(clampFontSize(11)).toBe(11);
    expect(clampFontSize(24)).toBe(24);
    expect(clampFontSize(25)).toBeNull();
    expect(clampFontSize(10)).toBeNull();
    expect(clampFontSize("16")).toBeNull();
    expect(clampFontSize(Number.NaN)).toBeNull();
    // 小数四舍五入到整数（px）
    expect(clampFontSize(12.6)).toBe(13);

    expect(clampPaperWidth(640)).toBe(640);
    expect(clampPaperWidth(1100)).toBe(1100);
    expect(clampPaperWidth(639)).toBeNull();
    expect(clampPaperWidth(1200)).toBeNull();

    // 标题字号另有区间（10–40）：正文能用不代表标题能用，反之亦然
    expect(clampHeadingFontSize(28)).toBe(28);
    expect(clampHeadingFontSize(9)).toBeNull();
    expect(clampHeadingFontSize(41)).toBeNull();
  });

  it("字重只认契约里的 400/500/600/700；颜色只认 #rrggbb", () => {
    expect(normalizeHeadingWeight(600)).toBe(600);
    expect(normalizeHeadingWeight(650)).toBeNull();
    expect(normalizeHeadingWeight("700")).toBeNull();

    expect(normalizeHeadingColor("#A1B2C3")).toBe("#a1b2c3");
    expect(normalizeHeadingColor("red")).toBeNull();
    // 带分号/空白的一律丢弃：自定义属性的值会被原样放进 `color:` 那一格
    expect(normalizeHeadingColor("#fff; background: red")).toBeNull();
    expect(normalizeHeadingColor("#fff")).toBeNull();
  });
});

describe("编辑器排版：空 = 跟随主题", () => {
  it("没配过（undefined / 空对象）不产生任何 CSS 变量", () => {
    expect(editorTypographyVars(undefined)).toEqual({});
    expect(editorTypographyVars({ headings: {} })).toEqual({});
  });

  it("只翻有值的那几项，其余留给 CSS 的令牌兜底", () => {
    expect(editorTypographyVars({ font_size: 16 })).toEqual({ "--doc-fs-body": "16px" });
    expect(editorTypographyVars({ font_family: "mono" })).toEqual({ "--doc-font": "var(--mono)" });
    expect(editorTypographyVars({ font_family: "sans" })).toEqual({ "--doc-font": "var(--sans)" });
    expect(editorTypographyVars({ paper_width: 700 })).toEqual({ "--doc-paper-w": "700px" });
  });

  it("坏值当没配：不产生声明，也不抛错", () => {
    expect(
      editorTypographyVars({
        font_size: 99,
        font_family: "comic" as never,
        paper_width: 10,
      }),
    ).toEqual({});
  });

  it("标题：三级键（字号/字重/颜色）各自独立，缺哪项就丢哪项", () => {
    expect(
      editorTypographyVars({
        headings: {
          h1: { size: 28, weight: 600, color: "#FF0000" },
          h2: { color: "blue" },
          h3: { weight: 650 },
          h9: { size: 20 },
        },
      }),
    ).toEqual({
      "--doc-h1-size": "28px",
      "--doc-h1-weight": "600",
      "--doc-h1-color": "#ff0000",
    });
  });
});

describe("编辑器排版：纸面宽度与文字列", () => {
  it("纸面宽度缺省 800（`DESIGN.md` §2.8），文字列 = 纸面 − 每侧 48", () => {
    expect(paperWidthOf(undefined)).toBe(800);
    expect(paperWidthOf({})).toBe(800);
    expect(paperWidthOf({ paper_width: 900 })).toBe(900);
    // 越界回落缺省，而不是把 5000 拿去算文字列
    expect(paperWidthOf({ paper_width: 5000 })).toBe(800);
    expect(textColumnWidth(800)).toBe(704);
    expect(textColumnWidth(940)).toBe(844);
  });
});
