/**
 * 结构与视觉不变量守卫（DESIGN.md §2.2 / §2.5 / §8-4）。
 *
 * 为什么需要：这些值是 DESIGN.md 里标【实测】的硬约束（是"结构不变量"，换视觉方向也不变），
 * 而现在只有"实现时照抄原型"这一层保障——任何人改一行 CSS 都不会有东西拦住他。
 * 这个用例不测布局（jsdom 没有排版引擎），它守的是**声明值**：谁改了这些数字，用例立刻红，
 * 逼他回去重跑 `prototype/verify-prototype.js` 并重新测量。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertNoColourLiterals } from "./helpers/css-colors";
import { parseRules, type CascadeRule } from "./helpers/css-cascade";

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const tokens = read("../src/app/theme/tokens.css");
const app = read("../src/app/theme/app.css");

function value(css: string, pattern: RegExp): number {
  const matched = css.match(pattern);
  if (!matched?.[1]) throw new Error(`没找到声明：${pattern}`);
  return Number(matched[1]);
}

/** 从 `--name: 12px` 这类令牌里取值（只看第一个匹配，即浅色主题块） */
const tokenPx = (name: string): number =>
  value(tokens, new RegExp(`--${name}:\\s*(\\d+)px`));

/** 从选择器块里取属性值 */
const rulePx = (css: string, selector: string, prop: string): number =>
  value(css, new RegExp(`${selector}\\s*\\{[^}]*${prop}:\\s*(\\d+)px`));

describe("配色令牌（DESIGN.md §3.2-3 / §3.3【已定】）", () => {
  /** 取令牌块里的 `--name:value` 对（只看颜色类：值里带 # / rgb / linear-gradient） */
  const colorPairs = (block: string): Map<string, string> =>
    new Map(
      [...block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)]
        .filter((match) => /#|rgba?\(|linear-gradient/.test(match[2] ?? ""))
        .map((match) => [match[1] ?? "", (match[2] ?? "").trim()]),
    );

  const lightBlock = tokens.match(/:root\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const darkBlock = tokens.match(/:root\[data-theme="dark"\]\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

  it("浅色与深色的颜色令牌成对（尺寸/字族类不参与）", () => {
    expect(lightBlock).not.toBe("");
    expect(darkBlock).not.toBe("");

    const light = colorPairs(lightBlock);
    const dark = colorPairs(darkBlock);
    expect(light.size).toBeGreaterThanOrEqual(30);

    const missing = [...light.keys()].filter((name) => !dark.has(name));
    expect(missing, `深色块缺颜色令牌：${missing.join("、")}`).toEqual([]);
  });

  it("主色是 Cloudflare 橙，且橙底文字为深墨（白字压橙只有 2.58:1）", () => {
    const light = colorPairs(lightBlock);
    expect(light.get("primary")).toBe("#f6821f");
    expect(light.get("on-primary")).toBe("#1d1d1d");
    // 橙色作文字色必须走专门令牌（#f6821f 压白只有 2.58:1）
    expect(light.get("primary-ink")).toBe("#b45309");
  });

  it("旧的 Claude 暖色不得残留", () => {
    for (const stale of ["#d97757", "#b4543a", "#faf9f5", "#f4f2eb", "#eeece3", "#e8e4d9"]) {
      expect(tokens.toLowerCase()).not.toContain(stale);
      expect(app.toLowerCase()).not.toContain(stale);
    }
  });
});

describe("结构尺寸令牌（DESIGN.md §2.2【已定】）", () => {
  it("顶栏 54、功能栏 294、列表 330、设置导航 184、圆角 10/14", () => {
    expect(tokenPx("topbar-h")).toBe(54);
    expect(tokenPx("fnbar-w")).toBe(294);
    expect(tokenPx("list-w")).toBe(330);
    expect(tokenPx("settings-nav-w")).toBe(184);
    expect(tokenPx("radius")).toBe(10);
    expect(tokenPx("radius-lg")).toBe(14);
  });
});

describe("功能栏几何（DESIGN.md §2.5-2 不变量）", () => {
  it("录入框两行高 95px → 导航区顶部 y = 211（54 + 12 + 38 + 12 + 95）", () => {
    const topbar = tokenPx("topbar-h");
    const fnTopPadding = rulePx(app, "\\.fnbar__top", "padding");
    const newButton = rulePx(app, "\\.btn-new", "height");
    const composerMargin = rulePx(app, "\\.composer", "margin-top");

    /*
      录入框默认高由**声明的两行**加出来，不再写死"原型实测 136"——
      2026-10-01 用户反馈问题 1：属性行（`display:none` 之外的那条 26px 附加项）退出功能栏录入框，
      默认高 136 → 95，导航区顶部 y 252 → 211。

        上下边框 1×2 + 上下内边距 9×2 + 输入区 min-height 40 + 模式行 margin-top 6 + 模式行 29
        模式行 29 = `.segmented` 的 padding 2×2 + border 1×2 + 紧凑档按钮 23（发布按钮 27 更矮）
    */
    const composerHeight =
      rulePx(app, "\\.composer", "border") * 2 +
      rulePx(app, "\\.composer", "padding") * 2 +
      rulePx(app, "\\.composer__input", "min-height") +
      rulePx(app, "\\.composer__modes", "margin-top") +
      rulePx(app, "\\.segmented", "padding") * 2 +
      rulePx(app, "\\.segmented", "border") * 2 +
      rulePx(app, "\\.segmented--compact \\.segmented__item", "height");

    expect(topbar).toBe(54);
    expect(fnTopPadding).toBe(12);
    expect(newButton).toBe(38);
    expect(composerMargin).toBe(12);
    expect(composerHeight).toBe(95);
    expect(topbar + fnTopPadding + newButton + composerMargin + composerHeight).toBe(211);
  });

  it("录入框两行结构：输入区 40–180 可纵向 resize、模式行同排；属性行不得回到功能栏", () => {
    expect(rulePx(app, "\\.composer__input", "min-height")).toBe(40);
    expect(rulePx(app, "\\.composer__input", "max-height")).toBe(180);
    expect(app).toMatch(/\.composer__input\s*\{[^}]*resize:\s*vertical/);

    // 模式行：左模式切换 + 右发布按钮，同一行
    expect(app).toMatch(/\.composer__modes\s*\{[^}]*display:\s*flex/);

    /*
      **属性行禁止回到功能栏录入框**（2026-10-01 用户反馈问题 1：没编辑时看着是一大块输入区，
      真开始打字可写的地方只有 40px）。规则块整个删掉，回来就红（注释里提到这个类名不算）。
    */
    expect(app).not.toMatch(/\.composer__extras\s*\{/);

    // 属性字段行只剩「添加内容窗口」这一处：仍要 26px、`nowrap`、不许 `display:none` 塌陷
    expect(rulePx(app, "\\.addentry__extras", "min-height")).toBe(26);
    expect(app).toMatch(/\.addentry__extras\s*\{[^}]*flex-wrap:\s*nowrap/);
    expect(app).not.toMatch(/\.addentry__extras[^{]*\{[^}]*display:\s*none/);
  });

  /*
    轻量即时渲染宿主（编辑拓展阶段 B / Task B5）：输入态**继续用 `.composer__input`**，
    所以上面那条两行结构不变量同时守住了它；这里补呈现态自己的约束——
    Markdown 段距不能把录入框撑高（限高 + 内部滚动），否则录入框默认高就不成立了。
  */
  it("快捷输入呈现态：限高 + 内部滚动，且不靠 hover 才能回到编辑", () => {
    expect(rulePx(app, "\\.quick-composer__view", "max-height")).toBe(180);
    expect(app).toMatch(/\.quick-composer__view\s*\{[^}]*overflow-y:\s*auto/);
    // 呈现态是"点击继续编辑"的入口：触屏要有 44px 命中区（不是只有 hover 才算可点）
    expect(app).toMatch(/@media\s*\(pointer:\s*coarse\)\s*\{[^}]*\.quick-composer__view\s*\{[^}]*min-height:\s*44px/);
    // 呈现态里的 markdown 容器按录入框排版，不套阅读区的 740px 宽与 80px 底距
    expect(app).toMatch(/\.quick-composer__view\s+\.markdown-body\s*\{[^}]*max-width:\s*none/);
  });

  it("快捷输入的命令菜单：默认向上 + 可向下（宿主按可用空间选）、限高滚动", () => {
    expect(app).toMatch(/\.cmd-menu\s*\{[^}]*bottom:\s*calc\(100%\s*\+\s*6px\)/);
    expect(rulePx(app, "\\.cmd-menu", "max-height")).toBe(232);
    expect(app).toMatch(/\.cmd-menu\s*\{[^}]*overflow-y:\s*auto/);
    /*
      向下弹的修饰类必须有：功能栏录入框在功能栏顶部（y≈116），菜单限高 232px 一律向上弹会
      顶出视口顶部（用户 2026-10-01 反馈的问题 3）。方向判定在 `menu-placement.test.ts`。
    */
    expect(app).toMatch(/\.cmd-menu--down\s*\{[^}]*top:\s*calc\(100%\s*\+\s*6px\)/);
    expect(app).toMatch(/\.cmd-menu--down\s*\{[^}]*bottom:\s*auto/);
  });

  it("页面不滚动：滚动只发生在各栏内部（DESIGN.md §2.7）", () => {
    expect(app).toMatch(/body\s*\{[^}]*overflow:\s*hidden/);
    for (const selector of ["\\.fnbar__scroll", "\\.listpane__scroll", "\\.settings__body"]) {
      expect(app).toMatch(new RegExp(`${selector}\\s*\\{[^}]*overflow-y:\\s*auto`));
    }
  });

  it("加密空间贴底固定：容器 flex:none，且不在滚动区里（M2-2 验收点）", () => {
    expect(app).toMatch(/\.fnbar__vault\s*\{[^}]*flex:\s*none/);
    expect(app).toMatch(/\.fnbar__vault\s*\{[^}]*padding:/);
    // 贴底固定靠"不在滚动容器里"实现，结构由 fnbar.test.tsx 的 DOM 断言守住
  });

  it("录入框模式行的分段控件占满余下宽度（原型 .mode-tabs 的 flex:1/min-width:0）", () => {
    expect(app).toMatch(/\.segmented--compact\s*\{[^}]*flex:\s*1/);
    expect(app).toMatch(/\.segmented--compact\s*\{[^}]*min-width:\s*0/);
  });
});

describe("组件硬性规范（DESIGN.md §3.2 / §5.5）", () => {
  it("组件里不出现硬编码颜色（必须走令牌，DESIGN.md §3.2-1「没有例外」）", () => {
    /*
      2026-09-27 补强：原来只扫 `app.css` 的 `#hex` 与 `rgb(`——`hsl(` 与**颜色关键字**
      （`white` / `black` / `red`…）会被**静默放过**，正是"扫不到"的那一类漏洞。
      现在走可自证的 `assertNoColourLiterals`（见 `helpers/css-colors.ts` 与 `css-colors.test.ts`），
      它认 `hsl(`、认颜色关键字、且只看颜色类属性的值（不会把 `white-space` 误判成颜色）；
      "**src 下全部样式文件 + 全部源码文件**"由 `css-colors.test.ts` 用 Vite 的
      `import.meta.glob` 铺开（那边不依赖 Node 文件系统 API，与本包的 tsconfig shim 不冲突）。
    */
    assertNoColourLiterals(app, "app.css");
  });

  it("图标统一 1.6px 描边、无填充、继承文字色（DESIGN.md §5.5）", () => {
    expect(app).toMatch(/\.ic\s*\{[^}]*stroke-width:\s*1\.6/);
    expect(app).toMatch(/\.ic\s*\{[^}]*fill:\s*none/);
    expect(app).toMatch(/\.ic\s*\{[^}]*stroke:\s*currentColor/);
  });

  it("`IconName` 的每个名字都有对应字形，反之亦然（一一对应，2026-09-27 补守卫）", () => {
    /*
      为什么值得守：`Icon` 用 `<use href="#i-名字">` 取字形——**名字在而字形不在，屏幕上就是一片空白**，
      而且不会有任何报错。此前只是人工核对过（当时 20 ↔ 20），加了 `more` 之后正好钉住它。
    */
    const icon = read("../src/app/ui/Icon.tsx");
    const unionBlock = /export type IconName =([\s\S]*?);/.exec(icon)?.[1] ?? "";
    const names = [...unionBlock.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort();
    const symbols = [...icon.matchAll(/id="i-([a-z-]+)"/g)].map((m) => m[1]).sort();

    expect(names.length).toBeGreaterThanOrEqual(20);
    expect(names, "有名字没有字形（会渲染成空白）").toEqual(symbols);
  });

  it("渐变也必须由令牌拼装（DESIGN.md §3.2-2：渐变里的裸色值扫不到）", () => {
    expect(app).toContain("var(--primary-grad)");
    expect(tokens).toMatch(/--primary-grad:\s*linear-gradient\([^)]*var\(--primary\)/);
  });
});

/**
 * 2026-09-29 用户反馈的界面异常的守卫（"Memo/待办状态切换条不对、笔记本树菜单压住数字"）。
 *
 * 为什么守**声明值**：jsdom 没有排版引擎，"位置不对 / 被压住"在渲染用例里测不出来；
 * 但这两处的成因都是**少了一条声明**——Memo 页头没跟着待办一起定宽、树行右侧没给
 * 绝对定位的菜单留位置。把声明钉住，再犯就红。
 */
describe("页头视图切换与树行右侧的留白（2026-09-29 修复）", () => {
  /** 去掉注释再匹配：注释里也会出现这些选择器（本文件别处同样做法） */
  const css = app.replace(/\/\*[\s\S]*?\*\//g, " ");

  it("Memo 与待办页头那条视图切换共用同一条定宽规则（否则 Memo 那条会被 compact 的 flex:1 拉宽）", () => {
    const rule =
      /^\.tkhead__main \.segmented,\s*\n\.memopanel__head \.segmented\s*\{([^}]*)\}/m.exec(css)?.[1] ??
      "";
    expect(rule, "两个页头没有共用定宽规则——Memo 那条会漂到页头中间").not.toBe("");
    expect(rule).toMatch(/flex:\s*none/);
    expect(rule).toMatch(/min-width:\s*176px/);

    const itemRule =
      /^\.tkhead__main \.segmented__item,\s*\n\.memopanel__head \.segmented__item\s*\{([^}]*)\}/m.exec(
        css,
      )?.[1] ?? "";
    expect(itemRule, "定宽之后还要让两个按钮平分").toMatch(/flex:\s*1/);
  });

  it("笔记本树的行右侧给「更多」菜单留出位置（不许压住行尾计数）", () => {
    const row = /^\.tree-row\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "";
    const menu = /^\.tree-row__menu\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "";
    expect(row, "`.tree-row` 没有规则").not.toBe("");
    expect(menu, "`.tree-row__menu` 没有规则").not.toBe("");

    const padding = /padding:\s*([^;]+)/.exec(row)?.[1]?.trim() ?? "";
    const parts = padding.split(/\s+/);
    expect(parts, "`.tree-row` 的 padding 要写成四值，右侧留了多少才看得见").toHaveLength(4);

    /** 把 `var(--sp-N)` 与裸 px 都折算成数字 */
    const px = (raw: string): number => {
      const token = /var\(--sp-(\d+)\)/.exec(raw)?.[1];
      if (token !== undefined) {
        return Number(new RegExp(`--sp-${token}:\\s*(\\d+)px`).exec(tokens)?.[1]);
      }
      return Number.parseFloat(raw);
    };

    // 菜单占一列 = `right: <offset>` + 13px 图标；行的右内边距必须不小于它
    const offset = px(/right:\s*([^;]+)/.exec(menu)?.[1]?.trim() ?? "0");
    const reserved = px(parts[1] ?? "0");
    expect(reserved, "行右侧留得不够，绝对定位的菜单会压住计数").toBeGreaterThanOrEqual(offset + 13);
  });
});

/**
 * 功能栏标签区（2026-09-29 用户要求："标签区域要贴底部固定，不要被笔记本里的内容推挤；
 * 大概预留底部三分之一到四分之一的位置；不要按列显示标签，要用标签按钮显示"）。
 *
 * 声明值守卫：起固定作用的是 `flex: none`（不然会被上面的导航区挤），
 * 起"按钮铺开"作用的是 `.tags` 的 `flex-wrap: wrap`（写成 column 就变成一列了）。
 * DOM 层的那两条（与滚动区并列、位置在导航区之后）在 `fnbar.test.tsx`。
 */
describe("功能栏标签区：贴底固定 + 按钮铺开（2026-09-29）", () => {
  const css = app.replace(/\/\*[\s\S]*?\*\//g, " ");

  it("标签区贴底固定：`flex:none` + 预留底部 1/4～1/3 的高度 + 自己滚动", () => {
    const rule = /^\.fnbar__tags\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "";
    expect(rule, "`.fnbar__tags` 没有规则").not.toBe("");

    expect(rule, "少了 flex:none 就会被上面的内容推挤").toMatch(/flex:\s*none/);
    const height = Number(/height:\s*(\d+)%/.exec(rule)?.[1]);
    expect(height, "高度占比读不出来（用户要求约 1/3～1/4）").toBeGreaterThan(0);
    expect(height).toBeGreaterThanOrEqual(25);
    expect(height).toBeLessThanOrEqual(34);
    expect(rule, "矮窗口下要给一个可用下限").toMatch(/min-height:\s*\d+px/);
    expect(rule, "放不下时本区要能自己滚").toMatch(/overflow-y:\s*auto/);
  });

  it("标签用按钮铺开：`.tags` 换行排列，任何 `.tags` 规则都不许改成纵向", () => {
    const rule = /^\.tags\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "";
    expect(rule, "`.tags` 没有规则").not.toBe("");
    expect(rule).toMatch(/display:\s*flex/);
    expect(rule, "少了 flex-wrap:wrap 就会排成一列").toMatch(/flex-wrap:\s*wrap/);
    // 兜底：别处在 `.tags` 上写纵向排列也不行（同选择器 + 新属性，css-cascade 抓不到这种）
    expect(css, "`.tags` 被改成纵向排列了").not.toMatch(/\.tags\s*\{[^}]*flex-direction:\s*column/);
  });
});

/**
 * 浮层层级（2026-10-04 修「右上角账户菜单被页面元素盖住、点不到」）。
 *
 * 病根**不在菜单自己，在顶栏**：顶栏有 `backdrop-filter: blur(8px)`，而非 `none` 的
 * `backdrop-filter` 会创建堆叠上下文——整条顶栏因此是根层级里的一个"原子岛"，不写 `z-index`
 * 就停在 0 层。顶栏承载的 `.menu`（账户快捷菜单、隐私锁胶囊菜单）那个 `z-index: 40`
 * **只在岛内有效**，抬不动岛外的任何东西；于是 `.shell__body` 里层级 ≥ 1 的元素整体盖住顶栏
 * （最常撞上的是表格那条不透明 sticky 表头 `.tablegrid__th`，层级 1——编辑页才有表格，
 * 所以症状表现为"尤其在编辑页面"、且只在那些盒子真与菜单重叠时出现）。
 *
 * 守**声明值**，与本文件其余各块同理：jsdom 没有排版引擎，"被压住"在渲染用例里量不出来。
 * 层级刻度表写在 `app.css` 的 `.topbar` 上方，**两边要一起改**。
 */
describe("浮层层级（2026-10-04）", () => {
  const rules = parseRules(app);

  /** 某选择器某属性实际生效的取值（未声明时为 `NaN`） */
  function zIndexOf(source: readonly CascadeRule[], selector: string): number {
    let value = "";
    for (const rule of source) {
      if (rule.selector !== selector || rule.media !== null) continue;
      for (const declaration of rule.declarations) {
        if (declaration.property === "z-index") value = declaration.value;
      }
    }
    return value === "" ? Number.NaN : Number(value);
  }

  /** 页面内容里的浮层：都在 `.shell__body` 内、**不在顶栏内**，必须低于顶栏 */
  const CONTENT_LAYERS = [".tablegrid__th", ".tkhead__dock--float", ".tdetail", ".infohint__pop"];

  /** 必须压住顶栏的两层：轻提示与模态遮罩（定场） */
  const ABOVE_TOPBAR = [".toast-host", ".overlay"];

  /** 返回所有层级冲突（空数组 = 没问题）；抽成函数是为了下面的"自证"能喂坏的进去 */
  function layeringFaults(source: readonly CascadeRule[]): string[] {
    const topbar = zIndexOf(source, ".topbar");
    if (!Number.isFinite(topbar)) {
      return [
        "`.topbar` 没有声明 z-index —— 它有 backdrop-filter、已经是堆叠上下文，" +
          "不给层级等于把整条顶栏（含账户菜单）锁在 0 层，页面内容一压就盖住",
      ];
    }

    const faults: string[] = [];
    for (const selector of CONTENT_LAYERS) {
      const value = zIndexOf(source, selector);
      if (Number.isFinite(value) && value >= topbar) {
          faults.push(`\`${selector}\` 的 z-index ${value} 不低于顶栏 ${topbar}：页面内容会盖住顶栏承载的浮层`);
      }
    }
    // `.cmd-menu` 同样要越过顶栏，但理由不同：它**不在顶栏内**，`.menu` 那 40 抬不动它
    const cmd = zIndexOf(source, ".cmd-menu");
    if (Number.isFinite(cmd) && cmd <= topbar) {
      faults.push(`\`.cmd-menu\` 的 z-index ${cmd} 不高于顶栏 ${topbar}：它不在顶栏内，向上弹到顶栏那条带子时会被压掉`);
    }
    for (const selector of ABOVE_TOPBAR) {
      const value = zIndexOf(source, selector);
      if (Number.isFinite(value) && topbar >= value) {
        faults.push(`顶栏 ${topbar} 不低于 \`${selector}\` ${value}：后者必须压住顶栏`);
      }
    }
    return faults;
  }

  it("顶栏显式给出层级：压住全部页面内容，被轻提示与模态压住，`.cmd-menu` 自己越过顶栏", () => {
    expect(layeringFaults(rules), "浮层层级被破坏（见 app.css `.topbar` 上方的刻度表）").toEqual([]);
  });

  it("自证：去掉顶栏的 z-index、或给低了，守卫必须变红（防「零故障也算通过」的假绿）", () => {
    // ① 顶栏没给层级 —— 正是本次线上症状的成因
    expect(
      layeringFaults(
        parseRules(`.topbar { backdrop-filter: blur(8px); } .tablegrid__th { position: sticky; z-index: 1; }`),
      ),
    ).toHaveLength(1);

    // ② 顶栏给了但给低了（0）：页面内容压过它 → 一条。
    //    注意此时 `.cmd-menu: 40` **不该**被算成故障——它确实高于 0，所以这里只有一条。
    expect(
      layeringFaults(
        parseRules(
          `.topbar { z-index: 0; }
           .tablegrid__th { position: sticky; z-index: 1; }
           .cmd-menu { z-index: 40; }
           .toast-host { z-index: 60; }
           .overlay { z-index: 200; }`,
        ),
      ),
    ).toHaveLength(1);

    // ③ 顶栏抬高了但 `.cmd-menu` 没跟着抬（留在 `.menu` 的 40）：它在顶栏内，向上弹会被压 → 一条
    expect(
      layeringFaults(
        parseRules(`.topbar { z-index: 50; } .cmd-menu { z-index: 40; } .tablegrid__th { z-index: 1; }`),
      ),
    ).toHaveLength(1);

    // ④ 顶栏压过了轻提示 → 一条
    expect(
      layeringFaults(parseRules(`.topbar { z-index: 999; } .toast-host { z-index: 60; }`)),
    ).toHaveLength(1);

    // ⑤ 好的那份不报
    expect(
      layeringFaults(
        parseRules(
          `.topbar { z-index: 50; }
           .tablegrid__th { position: sticky; z-index: 1; }
           .cmd-menu { z-index: 55; }
           .toast-host { z-index: 60; }
           .overlay { z-index: 200; }`,
        ),
      ),
    ).toEqual([]);
  });

  it("菜单被压到可用高度时自己滚，而不是被裁掉半截", () => {
    /*
      `.menu` 的 `max-height` 由 `ui/Menu.tsx` 按「最近的会裁剪的祖先」内联给出，
      但**限高单独存在没有意义**——没有 `overflow` 的话超出的那截仍然会被裁掉、仍然点不到。
      两半必须同时在，少一半就是"限了高但还是看不见"。
    */
    expect(app, "`.menu` 没有 overflow-y:auto，被压矮后超出部分会被裁掉").toMatch(
      /\.menu\s*\{[^}]*overflow-y:\s*auto/,
    );
  });
});

/**
 * 横向滚动条口径（2026-10-04，方案 B「细轴 + 悬停/聚焦显形」）
 *
 * 这个 describe 里的每条断言都来自**实测**，不是从规范推的：
 * 2026-10-04 在 Chromium 上验过「声明 `scrollbar-color` 后 `::-webkit-scrollbar`
 * 规则被整体忽略」与「`::-webkit-scrollbar:horizontal` 分轴写法无效（会整体回落
 * 系统默认粗条）」。这两条一旦被下一个人凭记忆"优化"回去，表现是**静默的**——
 * 页面照样渲染，只是横条又变粗、或又变成两轴一起显形，没有报错。
 */
describe("横向滚动条（`.hscroll`，2026-10-04）", () => {
  it("静止时用 `scrollbar-color: transparent` 而不是伪元素隐藏", () => {
    /*
      为什么不能用 `::-webkit-scrollbar-thumb { background: transparent }`：
      实测元素上一旦声明 `scrollbar-color`，浏览器就整体忽略该元素的伪元素规则。
      也就是说改成伪元素后，这条规则在现代 Chrome / Edge 里**根本不生效**——
      横条会重新常显，而 CI 与肉眼都不会报错。
    */
    expect(app, "`.hscroll` 必须用 scrollbar-color 做静止隐藏").toMatch(
      /\.hscroll\s*\{[^}]*scrollbar-color:\s*transparent\s+transparent/,
    );
    expect(app, "`.hscroll` 保留 thin：轴的位置不变，横条出现/消失才不会让内容高度跳").toMatch(
      /\.hscroll\s*\{[^}]*scrollbar-width:\s*thin/,
    );
  });

  it("悬停与键盘聚焦都要能显形（不以悬停为唯一入口）", () => {
    expect(app, "`.hscroll` 缺 :hover 显形").toMatch(/\.hscroll:hover[^{]*\{[^}]*scrollbar-color:/);
    expect(
      app,
      "`.hscroll` 缺 :focus-within 显形 —— 横条改成悬停才出现后，键盘进不来就等于对键盘不存在",
    ).toMatch(/\.hscroll:focus-within[^{]*\{[^}]*scrollbar-color:/);
  });

  it("`.hscroll` 块里不出现 `::-webkit-scrollbar`（会被 scrollbar-color 整体忽略）", () => {
    /*
      这条是**防回退**用的：`.scroll-thin` 里那几行伪元素是既有代码（Firefox 与旧浏览器靠它），
      但它与 `.hscroll` 的机制相反。允许它留在 `.scroll-thin` 里，不允许被复制进 `.hscroll`。
    */
    const blocks = [...app.matchAll(/\.hscroll[^{]*\{[^}]*\}/g)].map((m) => m[0]);
    expect(blocks.length, "找不到 `.hscroll` 规则块").toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block, "`.hscroll` 里写了伪元素：会被 scrollbar-color 整体忽略，等于没写").not.toMatch(
        /-webkit-scrollbar/,
      );
    }
  });

  it("正文代码块也挂上了：此前唯独它没挂，同屏出现两种粗细", () => {
    /*
      ⚠️ 这条**只能证明 CSS 里有这条规则**，证明不了它匹配得上。
      类名 `hscroll` 是由 `app/editor/markdown.ts` 发到 `<pre>` 上的——
      本轮真踩过一次：CSS 写好了、这条断言也绿了，但渲染出的 `<pre>` 根本没有那个类，
      于是整组规则从未生效，而**没有任何报错**。
      配对的那一半在 `markdown.test.ts`（断言渲染结果真的带 `class="hscroll"`），
      两边必须一起看，只看这里会以为已经改好了。
    */
    expect(
      app,
      "`.markdown-body pre.hscroll` 缺失 —— 代码块会退回系统默认粗条（15–17px）",
    ).toMatch(/\.markdown-body pre\.hscroll\s*\{/);
  });

  it("全站滚动条基线存在：此前只有 6 个容器套过样式，其余全是浏览器默认粗条", () => {
    /*
      2026-10-04 用户报「首页侧边栏、笔记目录侧栏、文章侧栏的滚动条样式都是一样的」——
      查出来它们**确实一样，因为全都是同一个"默认"**：这三条（`.fnbar__scroll` /
      `.listpane__scroll` / `.docpane__body`）从来没套过任何滚动条样式，走的是
      Windows 默认那根约 15–17px、灰轨道、两端带箭头的粗条。功能栏只有 294px 宽
      （`--fnbar-w`），一根 17px 的条吃掉将近 6%。

      所以给一条**全站基线**而不是逐个容器加类（那要动十几个组件、下次新增屏又会漏）。
      必须用 `:where()`：**零特异性**，组件里任何显式声明都能覆盖它。
    */
    expect(app, "缺少全站滚动条基线：未套样式的容器会退回浏览器默认粗条").toMatch(
      /:where\(\*\)\s*\{[^}]*scrollbar-width:\s*thin[^}]*scrollbar-color:/,
    );
  });

  it("「隐藏」只对确定支持 hover 的设备生效（默认值必须取可见的一侧）", () => {
    /*
      这条钉的是本轮**自己引入又自己修掉**的一个缺陷：第一版把 `transparent`
      无条件写在 `.hscroll` 上，而**触屏没有 hover** —— 手机上横条会永久隐形，
      手指能拖却看不见"右边还有内容"，违反 `DESIGN.md` §2.4「不以悬停为唯一入口」。

      修法不是「再加一段把它打开」（那仍然依赖浏览器认不认 `hover` 特性），
      而是**默认值可见、只在 `@media (hover: hover)` 里覆盖成透明**——
      于是不认该特性的老浏览器也落在安全分支。
    */
    const hscroll = /\.hscroll\s*\{([^}]*)\}/.exec(app)?.[1] ?? "";
    expect(
      hscroll,
      "`.hscroll` 的默认值必须是可见的（否则触屏与老浏览器上横条永久隐形）",
    ).toMatch(/scrollbar-color:\s*var\(--line-2\)\s+transparent/);
    expect(
      app,
      "`.hscroll` 的隐藏必须包在 `@media (hover: hover)` 里",
    ).toMatch(/@media\s*\(hover:\s*hover\)\s*\{[^@]*?\.hscroll\s*\{[^}]*scrollbar-color:\s*transparent/);
  });

  it("属性行保持 0 占位 + 边缘渐隐（DESIGN §2.2 固定 26px，不允许画条）", () => {
    /*
      这一行**不能**改成画滚动条：DESIGN.md §2.2 已定它固定 26px、不换行，
      任何会撑高的条都违反该条。它此前的毛病是「条整个藏掉、截断无提示」，
      改法是 sticky 伪元素做的边缘渐隐（不占高度、两端自动正确）。
    */
    expect(app, "属性行的滚动条必须继续隐藏").toMatch(
      /\.addentry__extras\s*\{[^}]*scrollbar-width:\s*none/,
    );
    expect(app, "属性行缺边缘渐隐：内容被截断仍然毫无提示").toMatch(
      /\.addentry__extras::after\s*\{[^}]*position:\s*sticky|position:\s*sticky[^}]*\.addentry__extras::after/,
    );
  });
});
