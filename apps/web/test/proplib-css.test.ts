/**
 * **属性库表格的可用性守卫**（v0.8.33 新增，严格断言）。
 *
 * 背景：用户 2026-10-11 报「设置页乱飞了」——`.field__input` **只给高与内边距、不设
 * 宽度**（`app.css` 里它靠外面给宽），放进 `.proplib__row` 的 grid 就退回固有宽度
 * （`<input>` 约 153px、`<select>` 随最长选项），格子一窄过它就压到隔壁列上：表头那些
 * 字还在格线上、控件却越过去了。**而没有任何机制会报错**：`style-coverage.test.ts` 只问
 * "类名有没有规则"、`css-cascade.test.ts` 只问"谁赢"，都不看**控件能不能填满自己那一格**。
 *
 * 所以这里钉三件事：① 表格里的控件必须自己填满格子；② 六列模板不留固有宽度下限
 * （写死下限会让窄窗口整页横向溢出）；③ 降级断点就是反推出来的那个数、降级时表头一起消失。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(new URL("../src/app/theme/app.css", import.meta.url), "utf8");

/** 取一条规则的花括号内容（声明里不嵌套花括号，够用） */
function block(selector: string): string {
  const pattern = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${pattern} \\{([^}]*)\\}`).exec(appCss)?.[1] ?? "";
}

describe("属性库表格的 CSS 守卫", () => {
  it("控件自己填满格子——缺了 width:100% 就会压到隔壁列上（用户报的「设置页乱飞」）", () => {
    const rule = block(".proplib__row .field__input");
    expect(rule, "`.proplib__row .field__input` 这条规则没了？控件会退回固有宽度").not.toBe("");
    expect(rule).toContain("width: 100%");
    // 配套那一半：没有 min-width:0，input 的 min-width:auto 会顶住 grid 不让格子收窄
    expect(rule).toContain("min-width: 0");
  });

  it("六列模板的两个弹性列下限是 0（写 6.5rem / 7rem 那版把整表撑出了卡片）", () => {
    const template = /\.proplib__row \{[^}]*grid-template-columns: ([^;]*);/.exec(appCss)?.[1] ?? "";
    expect(template).not.toBe("");
    // 逐条钉两个 minmax 的下限：都必须是 0，且只有这两个弹性列
    expect(template.match(/minmax\([^,]*/g)).toEqual(["minmax(0", "minmax(0"]);
    expect(template).toContain("minmax(0, 1fr)");
    expect(template).toContain("minmax(0, 1.3fr)");
  });

  it("降级断点是反推出来的 940px，且降级时表头一起收起", () => {
    expect(appCss).toMatch(/@media \(max-width: 940px\)/);
    // 原先拍出来的 900px 没算设置页那 184px 导航与卡片 790px 上限，900–1020px 这段窗口里六列被硬挤
    expect(appCss).not.toMatch(/@media \(max-width: 900px\)/);
    const stacked = /@media \(max-width: 940px\)[^@]*?\.proplib__row--head \{\s*display: none;/.test(appCss);
    expect(stacked, "940px 以下应当是堆叠块：表头先收起").toBe(true);
  });
});
