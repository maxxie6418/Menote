// @vitest-environment node
/**
 * Markdown 格式命令的纯函数测试（编辑拓展阶段 B / Task B1）。
 *
 * 输入只有「文本 + 选区」，输出「新文本 + 新选区」——不碰 React、不碰 CodeMirror。
 * 这样同一套语义可以给正文编辑器、快捷输入和将来的任何宿主复用，命令也不会各写一份拼串逻辑。
 *
 * 两条口径在这里钉死（实施计划 §3 Task B1 Step 1 / Step 4）：
 * 1. **跨行选区按被覆盖的整行展开**：`{from,to}` 只盖住某行的一部分，该行整行参与命令；
 *    `to` 是开区间——`to` 正好落在下一行行首时，下一行**不算**被覆盖。
 * 2. **重复执行是 toggle**：成对标记（加粗 / 斜体 / 行内代码）已被完整包裹时再去掉；
 *    行前缀命令（列表 / 引用 / 标题 / 任务清单）在所有非空行都已有前缀时统一去掉，否则只给缺的行补。
 */
import { describe, expect, it } from "vitest";
import {
  FORMAT_COMMANDS,
  QUICK_FORMAT_COMMANDS,
  applyFormatCommand,
  minimalChange,
  quickFormatCommandsFor,
} from "../src/app/editor/format-commands";

describe("成对标记：包裹选区并把选区留在标记内", () => {
  it("加粗", () => {
    expect(applyFormatCommand("今天开会", { from: 2, to: 4 }, "bold")).toEqual({
      text: "今天**开会**",
      selection: { from: 4, to: 6 },
    });
  });

  it("斜体、行内代码用各自的标记", () => {
    expect(applyFormatCommand("斜体", { from: 0, to: 2 }, "italic")).toEqual({
      text: "*斜体*",
      selection: { from: 1, to: 3 },
    });
    expect(applyFormatCommand("代码", { from: 0, to: 2 }, "inline-code")).toEqual({
      text: "`代码`",
      selection: { from: 1, to: 3 },
    });
  });

  it("空选区：插入一对标记，光标停在中间（继续打字就是标记内的内容）", () => {
    expect(applyFormatCommand("", { from: 0, to: 0 }, "bold")).toEqual({
      text: "****",
      selection: { from: 2, to: 2 },
    });
    expect(applyFormatCommand("ab", { from: 1, to: 1 }, "bold")).toEqual({
      text: "a****b",
      selection: { from: 3, to: 3 },
    });
  });

  it("选区外已有同款标记 → 再去掉（toggle）", () => {
    // "今天**开会**" 里选中「开会」（4–6），外面就是 **
    expect(applyFormatCommand("今天**开会**", { from: 4, to: 6 }, "bold")).toEqual({
      text: "今天开会",
      selection: { from: 2, to: 4 },
    });
  });

  it("选区把标记一起选进来 → 也去掉（这时的选区含标记本身）", () => {
    expect(applyFormatCommand("今天**开会**", { from: 2, to: 8 }, "bold")).toEqual({
      text: "今天开会",
      selection: { from: 2, to: 4 },
    });
  });

  it("只有一侧有标记时不算已包裹，照常再包一层（宁可多一层也不要误删）", () => {
    // "a**b" 里选中 b：左侧有 **、右侧没有 → 不是「已包裹」
    expect(applyFormatCommand("a**b", { from: 3, to: 4 }, "bold").text).toBe("a****b**");
    // 只选中标记的一半（一个 *）：当普通文本再包一层
    expect(applyFormatCommand("a**b", { from: 2, to: 3 }, "bold").text).toBe("a******b");
  });
});

describe("链接：没有选区时插入可继续填写的标准 Markdown", () => {
  it("空选区插入模板并选中链接文字", () => {
    expect(applyFormatCommand("", { from: 0, to: 0 }, "link")).toEqual({
      text: "[链接文字](https://)",
      selection: { from: 1, to: 5 },
    });
  });

  it("有选区时把选区当链接文字，选中待填的地址部分", () => {
    expect(applyFormatCommand("点这里", { from: 0, to: 3 }, "link")).toEqual({
      text: "[点这里](https://)",
      selection: { from: 6, to: 14 },
    });
  });
});

describe("行前缀命令：按被覆盖的整行展开", () => {
  it("无序列表只给每个非空行加 - 空格", () => {
    // "第一行\n\n第二行" 共 8 个字符（索引 0–7），to 是开区间 → 要覆盖到最后一个「行」必须写 8
    expect(applyFormatCommand("第一行\n\n第二行", { from: 0, to: 8 }, "bullet-list").text).toBe(
      "- 第一行\n\n- 第二行",
    );
  });

  it("有序列表按行的次序编号", () => {
    expect(applyFormatCommand("甲\n乙", { from: 0, to: 3 }, "ordered-list").text).toBe(
      "1. 甲\n2. 乙",
    );
  });

  it("引用、标题、任务清单各用各自的前缀", () => {
    expect(applyFormatCommand("引用", { from: 0, to: 2 }, "quote").text).toBe("> 引用");
    expect(applyFormatCommand("标题", { from: 0, to: 2 }, "heading").text).toBe("## 标题");
    expect(applyFormatCommand("买牛奶", { from: 0, to: 3 }, "task-list").text).toBe("- [ ] 买牛奶");
  });

  it("半行也算整行：选区从行中间到下一行中间 → 两行都参与", () => {
    // 索引：第0 一1 行2 \n3 第4 二5 行6；[1,5) 盖住「一行\n第」——两行各被盖到一部分
    expect(applyFormatCommand("第一行\n第二行", { from: 1, to: 5 }, "bullet-list").text).toBe(
      "- 第一行\n- 第二行",
    );
  });

  it("to 是开区间：正好落在下一行行首时，下一行不参与", () => {
    // [1,4) 盖住「一行\n」，第二行一个字都没被盖到
    expect(applyFormatCommand("第一行\n第二行", { from: 1, to: 4 }, "bullet-list").text).toBe(
      "- 第一行\n第二行",
    );
  });

  it("空行不动（没内容就不该长出列表项）", () => {
    expect(applyFormatCommand("甲\n\n乙", { from: 0, to: 4 }, "bullet-list").text).toBe(
      "- 甲\n\n- 乙",
    );
  });

  /*
    空录入框里选「引用」「无序列表」是常见动作（快捷输入 `/` 命令的第一屏就是这些）。
    没有内容时"没有行可加前缀"会变成**点了没反应**，所以这里插入前缀本身，光标落到前缀后。
  */
  it("空文档：插入前缀并把光标送到前缀之后，而不是没反应", () => {
    const quoted = applyFormatCommand("", { from: 0, to: 0 }, "quote");
    expect(quoted.text).toBe("> ");
    expect(quoted.selection).toEqual({ from: 2, to: 2 });

    expect(applyFormatCommand("", { from: 0, to: 0 }, "bullet-list").text).toBe("- ");
    expect(applyFormatCommand("", { from: 0, to: 0 }, "ordered-list").text).toBe("1. ");
  });

  it("toggle：所选非空行全都有前缀 → 去掉；只有一部分有 → 只补缺的", () => {
    expect(applyFormatCommand("- 甲\n- 乙", { from: 0, to: 7 }, "bullet-list").text).toBe("甲\n乙");
    expect(applyFormatCommand("- 甲\n乙", { from: 0, to: 6 }, "bullet-list").text).toBe(
      "- 甲\n- 乙",
    );
  });

  it("toggle 认得出自己那一类的前缀，不把任务清单当成无序列表", () => {
    // 任务清单有自己的前缀：无序列表不认它，于是老老实实在**行首**再加一个 "- "
    // （不能当成「已有前缀」删掉 `- [ ]`，那等于把待办静默降级成普通列表项）
    expect(applyFormatCommand("- [ ] 买牛奶", { from: 0, to: 9 }, "bullet-list").text).toBe(
      "- - [ ] 买牛奶",
    );
    expect(applyFormatCommand("- [ ] 买牛奶", { from: 0, to: 9 }, "task-list").text).toBe("买牛奶");
  });
});

describe("代码块", () => {
  it("把被覆盖的整行包进围栏，选区落在内容上", () => {
    expect(applyFormatCommand("code", { from: 0, to: 4 }, "code-block")).toEqual({
      text: "```\ncode\n```",
      selection: { from: 4, to: 8 },
    });
  });

  it("空选区插入空围栏并把光标放进去", () => {
    expect(applyFormatCommand("", { from: 0, to: 0 }, "code-block")).toEqual({
      text: "```\n\n```",
      selection: { from: 4, to: 4 },
    });
  });

  it("已包在围栏里 → 再去掉（整段选中，或只选中围栏里的内容都算）", () => {
    expect(applyFormatCommand("```\ncode\n```", { from: 0, to: 11 }, "code-block").text).toBe("code");
    expect(applyFormatCommand("```\ncode\n```", { from: 4, to: 8 }, "code-block").text).toBe("code");
  });
});

describe("注册表与守卫", () => {
  it("命令 id 齐全且无重复", () => {
    expect([...FORMAT_COMMANDS]).toEqual([
      "bold",
      "italic",
      "strikethrough",
      "bullet-list",
      "ordered-list",
      "quote",
      "inline-code",
      "link",
      "heading",
      "code-block",
      "task-list",
    ]);
    expect(new Set(FORMAT_COMMANDS).size).toBe(FORMAT_COMMANDS.length);
  });

  it("纯命令只产生标准 Markdown：不夹带 HTML / 下划线 / 颜色", () => {
    for (const command of FORMAT_COMMANDS) {
      const { text } = applyFormatCommand("样例文字", { from: 0, to: 4 }, command);
      expect(text, command).not.toMatch(/<[a-z]/i);
      expect(text, command).not.toMatch(/style=|color:|font-|rgb\(/i);
      expect(text, command).not.toContain("<u>");
    }
  });

  /*
    设计 v3 §三-2 的「格式能力的产品边界」表：快捷输入那一列里，标题＝否、代码块＝暂不作为首期
    要求，而**任务清单＝"按 Memo / 待办场景需要提供"**。所以任务清单不在基础集里，按场景追加。
  */
  it("快捷输入基础集就是表里那几个「是」：加粗 / 斜体 / 无序 / 有序 / 引用 / 行内代码 / 链接", () => {
    expect([...QUICK_FORMAT_COMMANDS]).toEqual([
      "bold",
      "italic",
      "bullet-list",
      "ordered-list",
      "quote",
      "inline-code",
      "link",
    ]);
    // 表里写「否」与「暂不作为首期要求」的两条不许混进来
    expect(QUICK_FORMAT_COMMANDS).not.toContain("heading");
    expect(QUICK_FORMAT_COMMANDS).not.toContain("code-block");
    expect(QUICK_FORMAT_COMMANDS).not.toContain("task-list");
  });

  it("任务清单按「Memo / 待办」场景追加，笔记快捷录入不给", () => {
    expect(quickFormatCommandsFor("memo")).toEqual([...QUICK_FORMAT_COMMANDS, "task-list"]);
    expect(quickFormatCommandsFor("task")).toEqual([...QUICK_FORMAT_COMMANDS, "task-list"]);
    expect(quickFormatCommandsFor("note")).toEqual([...QUICK_FORMAT_COMMANDS]);
    // 追加的那条与正文同名命令是同一个 id：语义、名称、图标都只有一份
    expect(applyFormatCommand("", { from: 0, to: 0 }, "task-list").text).toBe("- [ ] ");
  });
});

/*
  以下三组是编辑器专项优化 P1（docs/modules/Menote-编辑器专项优化-设计-v1.md §二）的新增面：
  删除线（GFM 标准语法，预览本就支持）、标题级别参数（工具栏的「标题 ▾」菜单）、
  minimalChange（命令落盘从"整篇替换"改"最小变更区间"）。
*/
describe("删除线", () => {
  it("包裹选区，用 GFM 的双波浪线", () => {
    expect(applyFormatCommand("作废内容", { from: 0, to: 4 }, "strikethrough")).toEqual({
      text: "~~作废内容~~",
      selection: { from: 2, to: 6 },
    });
  });

  it("标记在选区外两侧 → 去掉（与加粗同一 toggle 语义）", () => {
    expect(applyFormatCommand("~~作废~~", { from: 2, to: 4 }, "strikethrough").text).toBe("作废");
  });

  it("快捷输入基础集不含它：v3 §三-2 的边界只给正文加，不改快捷输入", () => {
    expect(QUICK_FORMAT_COMMANDS).not.toContain("strikethrough");
  });
});

describe("标题级别（工具栏的「标题 ▾」）", () => {
  it("不带参数仍是 ##：/ 菜单与既有行为不变", () => {
    expect(applyFormatCommand("标题", { from: 0, to: 2 }, "heading").text).toBe("## 标题");
  });

  it("指定级别：全部行设成这一级，已有的别的级别一起改掉", () => {
    expect(applyFormatCommand("# 旧标题\n正文", { from: 0, to: 7 }, "heading", { headingLevel: 3 }).text).toBe(
      "### 旧标题\n### 正文",
    );
  });

  it("覆盖行全部是这一级 → 统一降回普通行", () => {
    expect(applyFormatCommand("## 甲\n## 乙", { from: 0, to: 8 }, "heading", { headingLevel: 2 }).text).toBe(
      "甲\n乙",
    );
    // 混着别的级别不算"都是这一级"：设成这一级
    expect(applyFormatCommand("## 甲\n# 乙", { from: 0, to: 7 }, "heading", { headingLevel: 2 }).text).toBe(
      "## 甲\n## 乙",
    );
  });

  it("级别 0（「正文」）：把覆盖行上的标题标记去掉；没有标题时原样返回", () => {
    expect(applyFormatCommand("## 甲\n乙", { from: 0, to: 5 }, "heading", { headingLevel: 0 }).text).toBe(
      "甲\n乙",
    );
    const untouched = applyFormatCommand("没有标题", { from: 0, to: 4 }, "heading", { headingLevel: 0 });
    expect(untouched.text).toBe("没有标题");
    expect(untouched.selection).toEqual({ from: 0, to: 4 });
  });

  it("空文档：直接给出这一级的前缀", () => {
    expect(applyFormatCommand("", { from: 0, to: 0 }, "heading", { headingLevel: 1 }).text).toBe("# ");
    expect(applyFormatCommand("", { from: 0, to: 0 }, "heading", { headingLevel: 0 }).text).toBe("");
  });
});

describe("minimalChange：两段文本的最小变更区间", () => {
  it("中间插入：只报插入的那一小段", () => {
    expect(minimalChange("abef", "abXYZef")).toEqual({ from: 2, to: 2, insert: "XYZ" });
    // 一段被替换：替换也是单区间（"cd" 换成 "XYZ"，不是"插入 XYZ"）
    expect(minimalChange("abcdef", "abXYZef")).toEqual({ from: 2, to: 4, insert: "XYZ" });
  });

  /*
    成对标记两侧各插一段，**一个连续区间**盖不住"中间不动、两头插"——它的最小单区间表示
    就是从选区头到选区尾整段换掉。比整篇替换好已经足够：撤销粒度与重映射范围都缩到选区附近。
  */
  it("两侧各插入时，单区间覆盖选区整段", () => {
    expect(minimalChange("今天开会", "今天**开会**")).toEqual({ from: 2, to: 4, insert: "**开会**" });
  });

  it("中间删除与替换", () => {
    expect(minimalChange("abcdef", "abd")).toEqual({ from: 2, to: 6, insert: "d" });
    expect(minimalChange("abcdef", "abZef")).toEqual({ from: 2, to: 4, insert: "Z" });
  });

  it("完全相同 → 空区间（调用方可据此跳过派发，不产生空撤销步）", () => {
    expect(minimalChange("一样", "一样")).toEqual({ from: 0, to: 0, insert: "" });
  });

  it("套回命令上：落盘的变更区间拼回去就是命令结果", () => {
    const before = "第一行\n第二行";
    const { text } = applyFormatCommand(before, { from: 0, to: 3 }, "bullet-list");
    const change = minimalChange(before, text);
    const rebuilt = before.slice(0, change.from) + change.insert + before.slice(change.to);
    expect(rebuilt).toBe(text);
  });
});
