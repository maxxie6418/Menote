import { describe, expect, it } from "vitest";
import { updateMenoteKeys } from "../src/frontmatter";
import { deriveTags, extractInlineTags, mergeTags, normalizeTag } from "../src/tags";

describe("行内标签提取", () => {
  it("基本用法：空白或行首后的 #标签", () => {
    expect(extractInlineTags("今天 #工作 和 #dev")).toEqual(["工作", "dev"]);
    expect(extractInlineTags("#开头就是标签")).toEqual(["开头就是标签"]);
  });

  it("标题不算标签（# 后是空白）", () => {
    expect(extractInlineTags("# 一级标题\n## 二级标题\n正文")).toEqual([]);
  });

  it("网址里的锚点不算标签（# 前不是空白/行首）", () => {
    expect(extractInlineTags("见 https://example.com/page#section 与 a#b")).toEqual([]);
  });

  it("代码块与行内代码里的 # 不算标签", () => {
    const text = "```\n#工作\n```\n\n这是 `#dev` 示例，真正的标签是 #真实";
    expect(extractInlineTags(text)).toEqual(["真实"]);
  });

  it("中文标点作为标签结束符", () => {
    expect(extractInlineTags("记一下 #工作，还有 #生活。")).toEqual(["工作", "生活"]);
  });

  it("开括号后的标签也能取到", () => {
    expect(extractInlineTags("分类（#项目）里的")).toEqual(["项目"]);
  });
});

describe("标签合并与派生", () => {
  it("normalizeTag 去掉起始 # 与空白", () => {
    expect(normalizeTag("  #工作 ")).toBe("工作");
    expect(normalizeTag("##")).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
  });

  it("YAML 在前、正文补充，大小写不敏感去重且保留首次写法", () => {
    expect(mergeTags(["工作", "Dev"], ["dev", "生活", "工作"])).toEqual(["工作", "Dev", "生活"]);
  });

  it("deriveTags = YAML tags + 正文 #标签", () => {
    const doc = `---
menote:
  tags: [工作]
---

今天 #dev 顺手记一笔 #工作
`;
    expect(deriveTags(doc)).toEqual(["工作", "dev"]);
  });

  it("没有标签时返回空数组", () => {
    expect(deriveTags("# 标题\n\n正文没有标签")).toEqual([]);
  });
});

/**
 * 顶层 `tags` 是规范位置（2026-10-04，对齐定稿：设计文档 §528 / 功能拆解 §333
 * 都写的是「YAML `tags` 字段」，从未要求嵌套）。
 *
 * 顶层化是**这一整轮改造的对外承诺**：Obsidian 等外部工具的 `tags:` 键 MeNote 要认，
 * MeNote 写出去的 `tags:` 那些工具也要认。
 */
describe("顶层 tags（跨工具互通）", () => {
  it("读顶层 tags——外部工具写的标签直接生效", () => {
    const doc = `---
title: "Anatomy of the .claude/ folder"
tags: [claude, tooling]
url: "https://x.com/…"
---

正文。
`;
    expect(deriveTags(doc)).toEqual(["claude", "tooling"]);
  });

  it("旧的 menote.tags 仍然读（存量笔记不需要迁移）", () => {
    const legacy = "---\nmenote:\n  tags: [工作]\n---\n\n正文";
    expect(deriveTags(legacy)).toEqual(["工作"]);
  });

  it("顶层与旧位置并存时顶层胜出", () => {
    const both = "---\ntags: [新]\nmenote:\n  tags: [旧]\n---\n\n正文";
    expect(deriveTags(both)).toEqual(["新"]);
  });

  it("顶层 tags: [] 是显式空标签，压过旧位置的值", () => {
    // 外部工具写 `tags: []` 表示"没有标签"，不该被旧位置的残留值顶回来
    const doc = "---\ntags: []\nmenote:\n  tags: [旧]\n---\n\n正文";
    expect(deriveTags(doc)).toEqual([]);
  });

  it("顶层 + 正文 #标签仍然合并", () => {
    const doc = "---\ntags: [工作]\n---\n\n今天顺手 #dev";
    expect(deriveTags(doc)).toEqual(["工作", "dev"]);
  });

  it("改写 tags 即完成懒迁移：旧的 menote.tags 消失、顶层出现", () => {
    const legacy = "---\nmenote:\n  type: note\n  tags: [旧]\n---\n\n正文";
    const updated = updateMenoteKeys(legacy, { tags: ["新值"] });

    expect(updated).toContain("\ntags: [新值]\n");
    expect(updated).not.toContain("  tags:"); // 旧位置的标签已经迁走
    expect(updated).toContain("  type: note");
    expect(deriveTags(updated)).toEqual(["新值"]);
  });

  it("没打 tags 的 patch 不动旧位置（只改命中的键）", () => {
    const legacy = "---\nmenote:\n  type: note\n  tags: [旧]\n---\n\n正文";
    const updated = updateMenoteKeys(legacy, { task: { status: "todo", due: null, priority: null } });
    expect(updated).toContain("  tags: [旧]");
    expect(deriveTags(updated)).toEqual(["旧"]);
  });
});
