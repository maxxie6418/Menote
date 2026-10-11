import { describe, expect, it } from "vitest";
import { findSectionRange, readSection, replaceSection } from "../src/section";

/**
 * 小节切分的口径测试。
 *
 * 盯的是几条**写错了会静默改错正文**的规则：范围要含住子节、同名要报歧义、
 * front matter 的偏移要换算回原文、CRLF 下也不能偏一格。
 */
describe("findSectionRange", () => {
  it("范围 = 标题行到下一个同级或更高级标题；更深的子节属于本节", () => {
    const md = ["# 顶层", "", "a", "", "## 甲", "", "x", "", "### 甲一", "", "y", "", "## 乙", "", "z"].join(
      "\n",
    );
    const range = findSectionRange(md, "甲");
    expect(range).not.toBeNull();
    // `end` 是下一个标题的**行首**，所以节尾那个空行属于本节（分隔靠它，见 replaceSection 的注释）
    expect(md.slice(range!.start, range!.end)).toBe(
      ["## 甲", "", "x", "", "### 甲一", "", "y", "", ""].join("\n"),
    );
    expect(md.slice(range!.start, range!.end)).toContain("甲一");
    // 下一节的内容不该被算进来
    expect(md.slice(range!.start, range!.end)).not.toContain("z");
  });

  it("匹配是精确的：问「结论」命中 `## 结论` 而不是 `### 结论`", () => {
    const md = ["# T", "", "## 结论", "", "a", "", "### 结论", "", "b", "", "## 附录", "", "c"].join("\n");
    const range = findSectionRange(md, "结论");
    // 命中的是 `##` 那一处：范围从 `## 结论` 开始
    expect(md.slice(range!.start, range!.start + "## 结论".length)).toBe("## 结论");
    // 而 `### 结论` 是**子节**，按口径属于本节（下一节是同级的 `## 附录`）
    expect(md.slice(range!.start, range!.end)).toContain("### 结论");
    expect(md.slice(range!.start, range!.end)).not.toContain("附录");
  });

  it("同名多处取第一个，并置 ambiguous", () => {
    const md = ["## 注", "", "one", "", "## 注", "", "two"].join("\n");
    const range = findSectionRange(md, "注");
    expect(range?.ambiguous).toBe(true);
    expect(md.slice(range!.start, range!.end)).toContain("one");
    expect(md.slice(range!.start, range!.end)).not.toContain("two");
  });

  it("只有一个同名标题时 ambiguous 为 false", () => {
    expect(findSectionRange("## 甲\n\na\n", "甲")?.ambiguous).toBe(false);
  });

  it("下标落在原文上：前面有 front matter 也能直接 slice", () => {
    const md = ["---", "menote:", "  tags: [a]", "---", "", "## 甲", "", "x", "", "## 乙", ""].join("\n");
    const range = findSectionRange(md, "甲");
    expect(range).not.toBeNull();
    // 关键断言：拿 range 直接切**原文**就能切出小节
    expect(md.slice(range!.start, range!.end).startsWith("## 甲")).toBe(true);
    expect(md.slice(range!.start, range!.end)).not.toContain("menote:");
  });

  it("未闭合的 front matter 不被剥掉（用户还没写完）", () => {
    const md = ["---", "menote:", "", "## 甲", "", "x"].join("\n");
    const range = findSectionRange(md, "甲");
    expect(md.slice(range!.start, range!.end).startsWith("## 甲")).toBe(true);
  });

  it("front matter 前面多一个空行时偏移仍对（2026-10-11 放宽判据：认 BOM、也认前导空行）", () => {
    const md = ["", "---", "menote:", "  tags: [a]", "---", "", "## 甲", "", "x"].join("\n");
    const range = findSectionRange(md, "甲");
    expect(range).not.toBeNull();
    expect(md.slice(range!.start, range!.end).startsWith("## 甲")).toBe(true);
    expect(md.slice(range!.start, range!.end)).not.toContain("menote:");
  });

  it("CRLF 下偏移不偏一格", () => {
    const md = ["# T", "", "## 甲", "", "x", "", "## 乙", "", "y"].join("\r\n");
    const range = findSectionRange(md, "甲");
    // 末节到下一个同级标题为止，节尾那个空行归本节
    expect(md.slice(range!.start, range!.end)).toBe(["## 甲", "", "x", "", ""].join("\r\n"));
  });

  it("正文里的 #tag 与行内井号不算标题", () => {
    const md = ["正文 #tag 不是标题", "a # b 也不是", "## 真标题", "x"].join("\n");
    expect(findSectionRange(md, "正文 #tag 不是标题")).toBeNull();
    expect(findSectionRange(md, "a # b 也不是")).toBeNull();
    expect(findSectionRange(md, "真标题")).not.toBeNull();
  });

  it("找不到或空标题返回 null（不抛错——调用方要区分「没有」而不是拿到 500）", () => {
    expect(findSectionRange("## 甲\n", "乙")).toBeNull();
    expect(findSectionRange("## 甲\n", "")).toBeNull();
    expect(findSectionRange("## 甲\n", "   ")).toBeNull();
    expect(findSectionRange("没有标题的正文", "甲")).toBeNull();
  });

  it("末节一直算到文末", () => {
    const md = ["## 甲", "", "x", "", "尾巴"].join("\n");
    const range = findSectionRange(md, "甲");
    expect(md.slice(range!.start, range!.end)).toBe(md);
  });
});

describe("readSection / replaceSection", () => {
  it("readSection 给出小节全文", () => {
    expect(readSection("# T\n\n## 甲\n\nx\n", "甲")).toBe("## 甲\n\nx\n");
  });

  it("replaceSection 换掉整节（含标题行），后面的内容不受影响", () => {
    const md = ["## 甲", "", "old", "", "## 乙", "", "keep"].join("\n");
    const out = replaceSection(md, "甲", "## 甲\n\nnew");
    // 关键：节间分隔的空行必须留下，否则 new 会和下一个标题粘成 "new## 乙"
    expect(out).toBe(["## 甲", "", "new", "", "## 乙", "", "keep"].join("\n"));
  });

  it("replaceSection 在 CRLF 下也不粘行", () => {
    const md = ["## 甲", "", "old", "", "## 乙", "", "keep"].join("\r\n");
    const out = replaceSection(md, "甲", "## 甲\r\n\r\nnew");
    expect(out).toBe(["## 甲", "", "new", "", "## 乙", "", "keep"].join("\r\n"));
  });

  it("找不到小节时两个函数都返回 null", () => {
    expect(readSection("## 甲\n", "乙")).toBeNull();
    expect(replaceSection("## 甲\n", "乙", "x")).toBeNull();
  });
});
