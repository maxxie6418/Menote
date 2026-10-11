// @vitest-environment jsdom
/**
 * 代码块语法高亮（编辑器专项优化 P2-2）。
 *
 * `code-highlight.ts` 两个出口：`highlightSpans`（token 区间 → 即时渲染的 mark 装饰）
 * 与 `highlightToHtml`（带 span 的 HTML → 预览补色）。这里钉四条行为：
 * 常见语言真的出 token、不支持的语言返回 `null`（保持纯文本，不报错）、
 * HTML 输出转义齐全（`innerHTML` 安全）、区间偏移与代码文本对齐。
 * Prism 全部动态加载：本文件会真实触发 `import()`（vitest 下走 node ESM interop），
 * 顺带验证「组件依赖裸全局 Prism」那条坑在装载器里处理对了。
 */
import { describe, expect, it } from "vitest";
import { highlightSpans, highlightToHtml } from "../src/app/editor/code-highlight";

describe("highlightSpans（即时渲染的 token 区间）", () => {
  it("JavaScript：关键字 / 字符串 / 注释各得各的类名", async () => {
    const spans = await highlightSpans('const msg = "hi"; // 备注', "js");
    expect(spans).not.toBeNull();
    const classes = spans!.map((span) => span.cls);
    expect(classes).toContain("tok-keyword");
    expect(classes).toContain("tok-string");
    expect(classes).toContain("tok-comment");
  });

  it("区间偏移与代码文本对齐：按区间切回去就是 token 内容", async () => {
    const code = "function add(a, b) {\n  return a + b;\n}";
    const spans = (await highlightSpans(code, "javascript"))!;
    const keyword = spans.find((span) => span.cls === "tok-keyword")!;
    expect(code.slice(keyword.start, keyword.end)).toBe("function");
  });

  it("别名走同一语言（ts → typescript）", async () => {
    const spans = await highlightSpans("const x: number = 1;", "ts");
    expect(spans).not.toBeNull();
    expect(spans!.some((span) => span.cls === "tok-keyword")).toBe(true);
  });

  it("不支持的语言返回 null（保持纯文本，不当作错误）", async () => {
    expect(await highlightSpans("some text", "brainfuck")).toBeNull();
    expect(await highlightSpans("some text", "")).toBeNull();
  });
});

describe("highlightToHtml（预览的补色 HTML）", () => {
  it("token 包进 span，且 HTML 特殊字符转义齐全", async () => {
    const html = await highlightToHtml('const s = "<b>&</b>";', "js");
    expect(html).not.toBeNull();
    expect(html).toContain('<span class="tok-keyword">');
    // 尖括号与 & 必须转义：不能让代码内容变成真标签
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&amp;");
  });
});
