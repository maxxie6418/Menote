// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { decorateAttachmentSizes, renderMarkdown } from "../src/app/editor/markdown";

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("Markdown 渲染", () => {
  it("渲染标题、加粗、列表与代码", () => {
    const html = renderMarkdown("# 标题\n\n**粗体**\n\n- 一\n- 二\n\n`code`");
    const doc = parse(html);
    expect(doc.querySelector("h1")?.textContent).toBe("标题");
    expect(doc.querySelector("strong")?.textContent).toBe("粗体");    expect(doc.querySelectorAll("li")).toHaveLength(2);
    expect(doc.querySelector("code")?.textContent).toBe("code");
  });

  it("原始 HTML 不作为元素出现（只作为文本）", () => {
    const doc = parse(
      renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n**正文**'),
    );

    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.body.textContent).toContain("<script>");
    expect(doc.querySelector("strong")?.textContent).toBe("正文");
  });

  it("外链统一带 rel=noopener noreferrer，且不给 target", () => {
    const doc = parse(renderMarkdown("[官网](https://example.com)\n\nhttps://example.org"));

    const links = [...doc.querySelectorAll("a")];
    expect(links.length).toBeGreaterThanOrEqual(2); // 一个手写链接 + 一个 linkify 出来的
    for (const link of links) {
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.getAttribute("target")).toBeNull();
    }
  });

  it("javascript: 协议不会变成 href", () => {
    const doc = parse(renderMarkdown("[点我](javascript:alert(1))"));

    for (const link of doc.querySelectorAll("a")) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
    }
  });
});

describe("附件引用（M4-10；界面稿 §7.3 / §7.4）", () => {
  const SHA = "a".repeat(64);
  const OTHER = "b".repeat(64);

  it("非图片附件走链接样式，并补一个大小（**不显示哈希**）", () => {
    const html = decorateAttachmentSizes(
      renderMarkdown(`[报告.pdf](/api/attachments/h/${SHA})`, {
        attachments: { [SHA]: { size: 2048, hasThumb: false } },
      }),
      { [SHA]: { size: 2048, hasThumb: false } },
    );
    const doc = parse(html);

    const link = doc.querySelector("a");
    expect(link?.className).toContain("attachment-link");
    expect(link?.getAttribute("class")).toContain("link");
    expect(link?.getAttribute("download")).toBe("");
    expect(doc.querySelector(".size-tag")?.textContent).toBe("2.0 KB");
    // 哈希是内部标识，界面不该出现
    expect(doc.body.textContent ?? "").not.toContain(SHA);
  });

  it("引用在、对象不在的附件：标不可用并给 title，且**不给下载**", () => {
    const html = renderMarkdown(`[老文件.pdf](/api/attachments/h/${OTHER})`, { attachments: {} });
    const doc = parse(html);

    const link = doc.querySelector("a");
    expect(link?.getAttribute("class")).toContain("attachment-link--missing");
    expect(link?.getAttribute("title")).toBe("附件不可用");
    expect(link?.getAttribute("download")).toBeNull();
  });

  it("图片引用加懒加载（一篇里几十张图不该一次性全拉）", () => {
    const doc = parse(renderMarkdown(`![图](/api/attachments/h/${SHA})`));
    const img = doc.querySelector("img");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("decoding")).toBe("async");
    expect(img?.getAttribute("data-attachment")).toBe(SHA);
  });

  it("普通外链不受影响（不加附件类、不加大小）", () => {
    const html = decorateAttachmentSizes(renderMarkdown("[官网](https://example.com)"), {
      [SHA]: { size: 10, hasThumb: false },
    });
    const doc = parse(html);

    expect(doc.querySelector("a")?.getAttribute("class")).toBeNull();
    expect(doc.querySelector(".size-tag")).toBeNull();
  });

  it("没给附件元数据时保持原样（预览不该因为拿不到元数据就报错）", () => {
    const html = renderMarkdown(`[x](/api/attachments/h/${SHA})`);
    expect(html).toContain("<a");
    expect(parse(html).querySelector(".size-tag")).toBeNull();
  });

  it("代码块的 `<pre>` 带 `hscroll` 与可聚焦（横条改成悬停才显形）", () => {
    /*
      2026-10-04。两个属性缺一不可，且**都不能省**：
      - `hscroll`：`app.css` 里代码块的横条规则写的是 `.markdown-body pre.hscroll`。
        类名只由**这里**发出——只改 CSS 不改这里，选择器就永远匹配不上，
        症状是「改了没反应」且**不报错**（这个坑本轮真踩过一次）。
      - `tabindex`：横条改成悬停才显形后，`<pre>` 不可聚焦就成了真问题——
        键盘用户 Tab 进正文根本到不了代码块，`:focus-within` 永不触发，
        那条提示对键盘等于不存在（DESIGN.md §6.1 不以悬停为唯一入口）。

      两种来源都要覆盖：``` 围栏（`fence`）与四空格缩进（`code_block`）。
    */
    for (const [label, html] of [
      ["围栏", renderMarkdown("```js\nconst a = 1;\n```")],
      ["缩进", renderMarkdown("行一\n\n    const a = 1;")],
    ] as const) {
      const pre = parse(html).querySelector("pre");
      expect(pre?.getAttribute("class"), `${label}代码块缺 hscroll：横条规则匹配不上`).toBe("hscroll");
      expect(pre?.getAttribute("tabindex"), `${label}代码块缺 tabindex`).toBe("0");
    }

    /* 行内代码不是块，不该被塞这些属性（塞了会凭空多出一个 tab 停靠点） */
    expect(parse(renderMarkdown("`x`")).querySelector("pre")).toBeNull();
  });

  /**
   * front matter 是**元数据不是正文**，预览里不该出现（2026-10-04）。
   *
   * markdown-it 没装 frontmatter 插件，于是开头的 `---` 渲染成分隔线 `<hr>`，而结尾的 `---`
   * 是 setext 标题的下划线——把 YAML 连同前面几行一起吞成 `<h2>`。实测那份 Obsidian 文档
   * 渲染出来是 `<hr>` + `<h2>title: "…"</h2>` + 正文，元数据被当成了标题。
   */
  it("有 front matter 时不渲染出分隔线，也不把 YAML 吞成标题", () => {
    const doc = parse(
      renderMarkdown(
        '---\ntitle: "Anatomy of the .claude/ folder"\ntags: [claude]\nmenote:\n  type: note\n---\n\n正文第一段。',
      ),
    );

    expect(doc.querySelector("hr")).toBeNull();
    const heading = doc.querySelector("h1, h2, h3");
    expect(heading, "front matter 的 YAML 不该变成标题").toBeNull();
    expect(doc.body.textContent?.trim()).toBe("正文第一段。");
  });

  it("没闭合的 front matter 整篇当正文，不剥（用户还没写完）", () => {
    const doc = parse(renderMarkdown("---\ntitle: 写了一半\n\n正文。"));
    // 剥壳器对没闭合的围栏是降级而不是抛错；这里只钉住"不崩、文本还在"
    expect(doc.body.textContent).toContain("正文。");
  });
});
