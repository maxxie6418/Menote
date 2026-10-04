// @vitest-environment jsdom
/**
 * 编辑器里藏 front matter（2026-10-04，`app/editor/frontmatter-hide.ts`）。
 *
 * 最要紧的一条是**「纯视觉」**：本模块只加装饰，文档内容与保存链路一字未动。
 * 这不是洁癖——菜单改标签/清单/标题时是直接改 md 的，编辑器若自己存一份 front matter
 * 副本再回贴，就会把那些刚写进去的改动抹回去。所以这里断言的是「doc 一字没变」。
 */
import { describe, expect, it } from "vitest";
import { frontmatterKeyNames, frontmatterRange } from "../src/app/editor/frontmatter-hide";

const OB = `---
title: "Anatomy of the .claude/ folder"
url: "https://x.com/akshay_pachaar/status/2035341800739877091"
tags: [claude]
status: unread
---

正文第一段。
`;

const ME_NOTE = `---
title: 读书笔记
tags: [科幻, 长篇]
menote:
  type: note
---

正文。
`;

describe("front matter 区间", () => {
  it("定位到结尾围栏之后（含那个换行）", () => {
    const range = frontmatterRange(OB);
    expect(range).not.toBeNull();
    // 藏起来的那一段正好是 `---` 到第二个 `---` 加换行
    expect(OB.slice(range?.from, range?.to)).toBe(
      '---\ntitle: "Anatomy of the .claude/ folder"\nurl: "https://x.com/akshay_pachaar/status/2035341800739877091"\ntags: [claude]\nstatus: unread\n---\n',
    );
  });

  it("没有 front matter → null（不隐藏）", () => {
    expect(frontmatterRange("正文第一段。")).toBeNull();
  });

  it("围栏没闭合 → null（用户可能正在写第一行，此时隐藏只是干扰）", () => {
    expect(frontmatterRange("---\ntitle: 写了一半\n\n正文。")).toBeNull();
  });

  it("首行不是 --- → null", () => {
    expect(frontmatterRange("正文\n---\n分隔线\n")).toBeNull();
  });

  it("MeNote 自己的笔记同样能定位", () => {
    const range = frontmatterRange(ME_NOTE);
    expect(ME_NOTE.slice(range?.from, range?.to)).toBe(
      "---\ntitle: 读书笔记\ntags: [科幻, 长篇]\nmenote:\n  type: note\n---\n",
    );
  });
});

describe("藏起来那一段的顶层键名", () => {
  it("给出键名（标签上显示它，用户才知道自己藏了什么）", () => {
    expect(frontmatterKeyNames('title: "x"\ntags: [a]\nurl: "u"\n')).toEqual(["title", "tags", "url"]);
  });

  it("去重，且缩进子行不算键（芯片显示的是顶层键）", () => {
    // `  type: note` 缩进在 menote 块里，不是顶层键，不该出现在芯片上
    expect(frontmatterKeyNames("menote:\n  type: note\n")).toEqual(["menote"]);
    // 顶格重复的键只报一次
    expect(frontmatterKeyNames("tags: [a]\ntags: [b]\n")).toEqual(["tags"]);
  });
});
