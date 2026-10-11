/**
 * **级联覆盖守卫**（v0.5.1 新增，严格断言）。
 *
 * 背景：v0.4.44–v0.4.50 那一批「按用户原型（`deliverables/pages-redesign-2026-09-27/`）
 * 对齐 memo 与待办」的取值**从未生效**——对齐块写在 `app.css` 中段，M2 时代的同名旧块写在
 * 文件后段，同一特异性下**后出现者胜**，于是整整 15 个属性（看板 `display:grid→flex`、
 * 看板列头与清单分组头的字号/字色、看板列体多出的虚线框、卡片内边距与标题字号……）
 * 被压回旧值，线上一直不是原型的样子。而**没有任何机制会报错**：
 * 用例查 DOM 与类名（`style-coverage.test.ts` 只问"类名有没有规则"），都不看**谁赢**。
 *
 * 同类事故此前已有一次：v0.4.46 修 `.home-nav__title`（旧规则在文件末尾，赢过了中段的覆盖）。
 *
 * 所以这里断言：**全文件内「同选择器 + 同属性被更后出现的规则用不同取值覆盖」必须为 0**。
 * 新增或调整取值请改文件前部那一处；不要在文件后面再写一条覆盖。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  describeOverrides,
  findLaterOverrides,
  parseRules,
  type CascadeRule,
} from "./helpers/css-cascade";

const appCss = readFileSync(new URL("../src/app/theme/app.css", import.meta.url), "utf8");
const rules = parseRules(appCss);

/** 某选择器某属性**实际生效**的取值（= 最后一个非条件块声明的取值） */
function effectiveValue(source: readonly CascadeRule[], selector: string, property: string): string {
  let value = "";
  for (const rule of source) {
    if (rule.selector !== selector || rule.media !== null) continue;
    for (const declaration of rule.declarations) {
      if (declaration.property === property) value = declaration.value;
    }
  }
  return value;
}

describe("级联覆盖（同选择器同属性不许被后置规则改值）", () => {
  it("app.css 里没有「后置规则用不同取值覆盖同选择器同属性」的地方", () => {
    const overrides = findLaterOverrides(rules);
    expect(
      overrides,
      `同一属性被写了两遍、后一处赢——前一处（通常是按原型对齐的取值）等于白写：\n${describeOverrides(overrides)}`,
    ).toEqual([]);
  });

  it("待办与 memo 的关键取值确实由「原型对齐块」给出（防再次被压回旧值）", () => {
    // v0.4.44–v0.4.50 那批里被压掉、v0.5.1 修回来的那些，逐条钉住取值本身
    expect(effectiveValue(rules, ".kanban", "display")).toBe("grid");
    expect(effectiveValue(rules, ".kanban", "align-items")).toBe("stretch");
    expect(effectiveValue(rules, ".kanban__head", "font-size")).toBe("var(--fs-body-lg)");
    expect(effectiveValue(rules, ".tasklist__head", "font-size")).toBe("var(--fs-body)");
    expect(effectiveValue(rules, ".taskcard", "padding")).toBe("var(--sp-3)");
    expect(effectiveValue(rules, ".taskcard__title", "font-size")).toBe("var(--fs-body-lg)");
    expect(effectiveValue(rules, ".kanban__body", "border")).toBe("");
    expect(effectiveValue(rules, ".timeline__date", "font-size")).toBe("var(--fs-body-lg)");
    expect(effectiveValue(rules, ".timeline__date", "color")).toBe("var(--text)");
    expect(effectiveValue(rules, ".memo", "padding")).toBe("var(--sp-2) var(--sp-3) var(--sp-3)");
    expect(effectiveValue(rules, ".memo", "border")).toBe("");
    expect(effectiveValue(rules, ".memopanel__head", "gap")).toBe("var(--sp-3)");
    expect(effectiveValue(rules, ".memopanel__body", "padding")).toBe("var(--sp-5)");
    expect(effectiveValue(rules, ".taskpanel__body", "padding")).toBe("var(--sp-5)");
  });

  /**
   * 2026-09-28 的三条显示修复（用户反馈"memo 与待办显示异常、与原型差异大"）。
   * 同样只在前部那一处给取值，这里把"最终生效值"钉住：
   * - `.markdown-body` 是**纯排版类**，阅读区那套宽度与内边距只属于正文区（`.docpane__body`）
   *   ——否则 Memo 卡片里的两层 `.markdown-body` 会把单行卡片撑到 275px（原型 97px）；
   * - 时间轴要有**主干线**与 740px 上限（原型 `.tl::before` / `.page--memo{--cap:740px}`）；
   * - `.tkhead` 不能是 flex（否则右侧控件挤在页头中间）；
   * - 看板下滚动容器必须 `flex:none`（否则 `width:80%` 在 flex 行里根本不生效）。
   */
  /**
   * 2026-10-01 更新：内容边界从**即时渲染专属**提到**编辑器通用**。
   *
   * 此前 740px 只挂在 `[data-editor="live"] .cm-scroller` 上，仅编辑档满幅铺开——切档时
   * 整块正文横向跳一次，而且满幅那档本来就没守住 `DESIGN.md` §2.3 的 740px。现在由基础档
   * （两档共有）给边界，live 档**只**覆盖字族与行高。后面几条空断言就是防着它哪天
   * 又长出一条自己的宽度——那正是这一条最初要抓的漂移。
   *
   * 2026-10-11 补：`width: 100%` 是这条边界的**组成部分，不是装饰**。`.cm-scroller` 在
   * CodeMirror 的 flex 布局里宽度 shrink-to-fit（正文多宽它就多宽），只给 `max-width`
   * 时它永远到不了 740，而 `margin: 0 auto` 会把这条窄列推到面板正中央——正文与光标
   * 从中间往两侧挤（用户反馈的现象）。先撑满宿主、再收上限，两档才落在 §2.3 上。
   */
  it("编辑器各档与仅预览共享同一内容边界", () => {
    expect(effectiveValue(rules, "[data-editor] .cm-scroller", "width")).toBe("100%");
    expect(effectiveValue(rules, "[data-editor] .cm-scroller", "max-width")).toBe("740px");
    // 2026-10-11：纸面上下各留一段间距（`--sp-5`），左右仍是 auto 居中
    expect(effectiveValue(rules, "[data-editor] .cm-scroller", "margin")).toBe("var(--sp-5) auto");
    expect(effectiveValue(rules, "[data-editor] .cm-scroller", "padding")).toBe(
      "var(--sp-5) var(--sp-6) 80px",
    );
    expect(effectiveValue(rules, '[data-editor="live"] .cm-scroller', "width")).toBe("");
    expect(effectiveValue(rules, '[data-editor="live"] .cm-scroller', "max-width")).toBe("");
    expect(effectiveValue(rules, '[data-editor="live"] .cm-scroller', "margin")).toBe("");
    expect(effectiveValue(rules, '[data-editor="live"] .cm-scroller', "padding")).toBe("");
    // 仅预览档是**同一组边界**：逐字比编辑档，而不是各写各的期望值
    for (const prop of ["max-width", "margin", "padding"]) {
      expect(effectiveValue(rules, ".docpane__body .markdown-body", prop)).toBe(
        effectiveValue(rules, "[data-editor] .cm-scroller", prop),
      );
    }
  });

  /*
    2026-10-11 补（用户反馈"正文编辑区与背景完全同色、点击时无法分辨"）：正文区改成**桌面 + 一张纸**——
    底色 `--bg-soft` 是桌面、纸面 `--panel` 加一圈 `--line` 描边、A4 比例下限让短内容也是一张纸
    （长内容 `min-height` 不再起作用，纸面无缝往下延伸）。编辑档与仅预览档是同一张纸，
    所以两边**必须逐字相同**；只有一边改了就是"切档时纸变了个样"。
  */
  it("编辑档与仅预览是同一张纸（底色 / 描边 / A4 下限三件套两边逐字相同）", () => {
    for (const prop of ["background", "border", "border-radius", "min-height"]) {
      const editor = effectiveValue(rules, "[data-editor] .cm-scroller", prop);
      expect(editor).toBe(effectiveValue(rules, ".docpane__body .markdown-body", prop));
      expect(editor, prop).not.toBe("");
    }
    expect(effectiveValue(rules, "[data-editor] .cm-scroller", "min-height")).toBe(
      "calc(740px * 297 / 210)",
    );
    // 桌面色（纸外那圈）挂在外层滚动容器上
    expect(effectiveValue(rules, ".docpane__body", "background")).toBe("var(--bg-soft)");
  });

  /*
    2026-10-11 补（用户反馈"工具栏还是全宽"）：正文区上方的两条带——属性带与格式工具栏——
    共用**同一组**收窄规则（`.itemprops__inner, .editor-toolbar__inner`）。写成一条共享选择器
    而不是各写一份，是因为"按钮 / 标签列与正文同一个左边界"是一条口径，不是两处巧合；
    这里把这条口径连同"横向留白归内层"一起钉住，防着谁再让某条带顶满整个正文区。
  */
  it("属性带与格式工具栏共用正文的列宽口径", () => {
    for (const selector of [".itemprops__inner", ".editor-toolbar__inner"]) {
      expect(effectiveValue(rules, selector, "max-width")).toBe("740px");
      expect(effectiveValue(rules, selector, "margin")).toBe("0 auto");
      expect(effectiveValue(rules, selector, "padding")).toBe("0 var(--sp-6)");
    }
    expect(effectiveValue(rules, ".editor-toolbar", "padding")).toBe("var(--sp-2) 0");
  });

  it("memo / 待办那三条显示修复的取值被钉住", () => {
    expect(effectiveValue(rules, ".markdown-body", "max-width")).toBe("");
    expect(effectiveValue(rules, ".markdown-body", "padding")).toBe("");
    expect(effectiveValue(rules, ".docpane__body .markdown-body", "max-width")).toBe("740px");
    expect(effectiveValue(rules, ".docpane__body .markdown-body", "padding")).toBe(
      "var(--sp-5) var(--sp-6) 80px",
    );
    expect(effectiveValue(rules, ".timeline", "max-width")).toBe("740px");
    expect(effectiveValue(rules, ".timeline::before", "content")).toBe('""');
    expect(effectiveValue(rules, ".timeline::before", "left")).toBe("104px");
    expect(effectiveValue(rules, ".timeline::before", "width")).toBe("1px");
    expect(effectiveValue(rules, ".timeline::before", "background")).toBe("var(--line)");
    expect(effectiveValue(rules, ".tkhead", "display")).toBe("");
    expect(effectiveValue(rules, ".taskpanel--board .taskpanel__body", "flex")).toBe("none");
    expect(effectiveValue(rules, ".tree__children", "border-left")).toBe("1px solid var(--line)");
  });

  /*
    自证：扫描器必须"抓得到坏的、放得过好的"。
    第一版扫描器在**解析 @media 内层规则**时把媒体的 `}` 也当成自己的收尾，条件上下文随即丢失，
    于是把合法的 `@media` 覆盖（本仓 `@media (hover: none)` 的命中区补偿）报成了违规——
    假阳性比漏报更糟：它会让守卫被当成噪声而关掉。这一组用例就是为那条翻车写的。
  */
  /**
   * 设置导航的间距（2026-09-29 用户反馈"列表堆叠到一起、调整一下间距"）。
   *
   * 这一条是被事故逼出来的：此前去掉设置页分组块时，把前部那条
   * `.settings__nav .nav { gap: var(--sp-1) }` 一起删掉了，于是设置导航**悄悄退回**
   * `.nav` 的裸值 `gap: 2px`——没有任何用例会报错（功能栏复用的 `.nav` 本来就是 2px）。
   * 现在把设置页这一处的取值钉住：行距 4px、行内边距 8px/12px、外框 16px。
   */
  it("设置导航的间距由设置页自己给出（不退回 `.nav` 的裸值 2px）", () => {
    expect(effectiveValue(rules, ".settings__nav", "padding")).toBe("var(--sp-4)");
    expect(effectiveValue(rules, ".settings__nav .nav", "gap")).toBe("var(--sp-1)");
    expect(effectiveValue(rules, ".set-nav-item", "padding")).toBe("var(--sp-2) var(--sp-3)");
  });

  it("自证：同一选择器同属性、取值不同、后置 → 必须被抓到", () => {
    const css = `
      .probe { color: red; }
      .probe { color: blue; }
    `;
    const found = findLaterOverrides(parseRules(css));
    expect(found).toHaveLength(1);
    expect(found[0]?.selector).toBe(".probe");
    expect(found[0]?.property).toBe("color");
    expect(found[0]?.fromValue).toBe("red");
    expect(found[0]?.toValue).toBe("blue");
  });

  it("自证：`@media` 内的覆盖不算违规（含「媒体块里有多条规则」这种踩过坑的形状）", () => {
    const css = `
      .probe { width: 17px; }
      .other { min-height: 20px; }
      @media (hover: none) {
        .other { min-height: 44px; }
        .probe { width: 20px; margin: 12px; }
      }
      .later { color: red; }
    `;
    expect(findLaterOverrides(parseRules(css))).toEqual([]);
  });

  it("自证：取值相同的重复不算违规；不同选择器不算违规；注释里的规则不算", () => {
    const css = `
      /* .commented { color: red; } .commented { color: blue; } */
      .same { padding: 8px; }
      .same { padding: 8px; }
      .a { gap: 4px; }
      .b { gap: 8px; }
    `;
    expect(findLaterOverrides(parseRules(css))).toEqual([]);
  });

  it("自证：扫描器真的读到了东西（防「零条规则也算通过」的假绿）", () => {
    expect(rules.length).toBeGreaterThan(400);
    expect(rules.some((rule) => rule.media !== null)).toBe(true); // 条件块也确实解析到了
    expect(rules.some((rule) => rule.selector === ".kanban")).toBe(true);
  });
});
