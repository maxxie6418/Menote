/**
 * 焦点可见性守卫的用例（`DESIGN.md` 禁止项 #11）。
 *
 * 这一条是**真抓到过违规**的：`.searchbox input`（搜索框）、`.docpane__title-input`（正文标题）、
 * `.tagchips__input`（标签格编辑，M4 新加）、`.tree__input`（内联命名文件夹）四处都写了
 * `outline: none` 且**没有补偿样式**——特异性高于/等于全局 `:focus-visible` 又写在它后面，
 * 于是键盘用户**看不见焦点在哪**。v0.4.41 修掉四处，并留下这条守卫。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkOutlineWhitelist, findOutlineSuppressors } from "./helpers/focus";

const app = readFileSync(new URL("../src/app/theme/app.css", import.meta.url), "utf8");

/**
 * 允许"抹掉 outline"的规则：**每一条都要给出补偿样式**，否则键盘焦点就没了。
 * 往这里加新条目之前，先问自己：这个控件的焦点用什么可见方式表达？
 */
const ALLOWED: Readonly<Record<string, string>> = {
  ".composer__input":
    "容器 .composer:focus-within 给 border-color + box-shadow 焦点环（录入框是整块高亮）",
  ".field__input": "同规则族有 .field__input:focus 给 border-color + box-shadow",
  ".itemprops__input:focus":
    "同一条规则里就给了补偿：border-color 变 --primary + box-shadow 0 0 0 3px --primary-soft（属性卡片的值控件，重设计 v1 §2.2）",
  "[data-editor] .cm-matchingBracket, [data-editor] .cm-nonmatchingBracket":
    "配对括号不可聚焦（不是可 Tab 到的控件），焦点可见性对它不适用；它的可见形式就是同一条规则里的 background: var(--primary-soft) 高亮",
};

describe("焦点可见性（DESIGN.md 禁止项 #11）", () => {
  it("只允许白名单里的规则写 `outline: none`，且每条都写清补偿方式", () => {
    const { unexpected, stale } = checkOutlineWhitelist(app, ALLOWED);
    expect(
      unexpected,
      `这些规则抹掉了 outline 又没有补偿样式，键盘焦点会看不见：${unexpected.join("、")}`,
    ).toEqual([]);
    expect(stale, `白名单里这些条目已经不存在了，请删掉：${stale.join("、")}`).toEqual([]);
    for (const [selector, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, `${selector} 的理由太短，等于没写`).toBeGreaterThan(10);
    }
  });

  it("全局 `:focus-visible` 仍然在（它是所有「没写 outline:none」的控件的焦点来源）", () => {
    expect(app).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--primary\)/);
  });

  describe("守卫自身的自证", () => {
    it("裸的 `outline: none` → 抓得到（坏例）", () => {
      expect(findOutlineSuppressors(".a input { outline: none; }")).toEqual([".a input"]);
      expect(findOutlineSuppressors(".b { outline: 0; }")).toEqual([".b"]);
    });

    it("**注释里写的 `outline: none` 不算**（这是实际踩过的坑：说明文字会自我举报）", () => {
      const css = "/* DESIGN.md：禁止用 outline:none 抹掉焦点 */\n.c { outline: 2px solid; }";
      expect(findOutlineSuppressors(css)).toEqual([]);
    });

    it("白名单对不上时两个方向都能报出来", () => {
      const css = ".x { outline: none; }";
      const { unexpected } = checkOutlineWhitelist(css, { ".y": "别的规则的理由" });
      expect(unexpected).toEqual([".x"]);
      const stale = checkOutlineWhitelist(css, { ".x": "允许", ".y": "过期条目" }).stale;
      expect(stale).toEqual([".y"]);
    });
  });
});
