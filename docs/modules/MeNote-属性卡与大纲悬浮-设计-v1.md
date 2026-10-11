# MeNote 属性卡 / 大纲 · 侧面折叠面板 v2

| 项 | 内容 |
| --- | --- |
| 文档版本 | v2.2 |
| 文档状态 | **生效**（用户 2026-10-11 批准按本稿落码，并同意同轮回写 `DESIGN.md` v1.17；代码已落地，见 `CHANGELOG.md` v0.8.34。v2.2 按用户当天第三轮反馈调样式，见 `CHANGELOG.md` v0.8.35） |
| 目的和适用范围 | 把正文区顶部的**属性带**改成**左侧贴边、可侧面折叠的面板**（竖排、样式收敛），并在右侧新增**同款大纲面板**（只列一二三级标题）；两侧**展开时实占宽度**（正文随之左右移动）、收起时退成 28px 贴边把手；面板随正文滚动钉在正文区顶部。适用于 `apps/web` 的正文区（`NoteWorkspace`）、属性卡（`ItemProps`）、新增大纲面板、`packages/mdcore` 的标题列表，以及 `DESIGN.md` §2.7 / §2.8 / §5.6 |
| 权威级别 | 模块规则（不覆盖 `wiki/`；要动 `DESIGN.md`，属先确认再动的范围，见 §7） |
| 最后更新日期 | 2026-10-11 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
| --- | --- | --- | --- | --- |
| v1 | v0.8.33 | 2026-10-11 | 首稿：属性卡由「正文上方第三带」改为「正文区左侧悬浮卡」并改竖排；新增右侧悬浮大纲卡；提 `DESIGN.md` §2.7 浮层例外 | deepseek-v4.1-flash |
| v2 | v0.8.33 | 2026-10-11 | 按用户当天第二轮反馈重画：①悬浮**改为侧面折叠面板**——展开实占宽度、正文随之左右移动（**不再覆盖正文**），收起退成 28px 竖排把手；②属性卡样式收敛——**删掉黄字提示**（解释收进行尾 ⓘ）、行尾动作统一成 24px 方按钮、组标题统一成「细线 + 一行小字」、所有值控件同一外壳；③宽度不足时的让位规则与实测数字 | deepseek-v4.1-flash |
| v2.1 | v0.8.34 | 2026-10-11 | **转「生效」**（用户批准按本稿落码 + 同轮回写 `DESIGN.md` v1.17）。落码时按实现订正/补齐的四处：①`mdcore` 侧新增导出 `listHeadings(markdown, maxLevel = 3)`（复用它自己的 `scanHeadings`，前端**不另写标题正则**）；②「当前节」的编辑档参考线由调用方给——`EditorHandle.offsetAtViewportY(y)` 取代原先设想的 `topVisibleOffset()`，因为真正滚动的是 `.doc-split__pane`、`.cm-scroller` 不设高度（`scrollDOM.scrollTop` 恒为 0）；③仅预览档的「当前节」按「级别 + 文字」匹配 DOM，且**一条都没滚过时把第一节当当前节**（不亮一条会被当成面板坏了）；④`ItemProps` 的样式收敛只动外观与动作格，**handler 与确认文案一字不改** | deepseek-v4.1-flash |
| v2.2 | v0.8.35 | 2026-10-11 | 按用户当天第三轮反馈调样式：①**折叠把手加长**（内边距 8 → 20px，高约 44 → 68px）、字号 `--fs-micro` → `--fs-small`，并把圆角/平边的镜像**纠正**为「平边贴外侧、圆角朝正文」（从前左轨圆角朝外，看着像把手挂在正文那一侧）；②**两侧卡轻量化**（卡面 `--panel` → `--bg-soft`、去 `--shadow-1`、圆角 `--radius-lg` → `--radius`，卡头文字降到 `--muted`）；③**纸面 740 → 800、内边距 `--sp-6` → 48px**（文字列仍是 704），让位门槛随之 **1244 → 1304px** | deepseek-v4.1-flash |

---

## 0. 先读这一节（本次边界）

**做**

1. 属性卡从「正文上方的第三带」改成**正文区左侧的贴边面板**，行改**竖排**，并把样式收敛（见 §3）。
2. 正文区右侧新增**同款大纲面板**：只列 h1–h3，点击跳到该标题，当前所在小节高亮。
3. 两侧面板**展开实占宽度**（240px）、**收起退成 28px 竖排把手**；正文在剩下的空间里居中，所以**一侧展开时正文会往另一边让**——内容平铺，**不叠、不盖**。
4. 两个面板都随正文滚动钉在正文区顶部；折叠状态记本机。

**不做**

- md 写法、front matter 语义、属性库（键值字典）的取数口径，**一字不改**（只改外观与位置）。
- 标题带、格式工具栏、底部状态栏**不动**。
- 纸面的 `max-width` 与 A4 下限**按用户第三轮反馈调过一次**（740 → **800**、内边距 `--sp-6` → **48px**，文字列仍是 704）；两侧面板只改「纸面在多少宽度里居中」，不改纸面的其它规则。
- 不做移动端版式（`DESIGN.md` §2.4 未定稿）；窄屏沿用同一套规则，不另起第二套骨架。
- `DESIGN.md` 里「后期由 `@` 统一接管属性设置」那条路线与本稿无关。

---

## 1. 起因

用户 2026-10-11 第一轮反馈（原文）：

> 现在有个视觉不美观的问题，顶部属性块铺满了左右两侧，如果与文本对齐又显得瘦小狭长，我考虑把属性块移到左侧悬浮显示，类似待办中的状态栏用悬浮小组件模式。且随文章滑动也会同时移动，可收纳折叠。右侧加一个同款式的大纲悬浮小组件，只显示一二三级标题，同样随文章上下浮动也可以折叠收纳。

同日第二轮反馈（原文）：

> 首先，左侧属性栏太乱了，原本属性大致只有几类，但是现在样式各不一致非常混乱，那个黄色的提示文字也去掉。其次我觉得左右两侧的浮动组件可以侧面折叠和展开，这样当屏幕空间局限只能展开一侧的时候，正文显示可以左右活动，尽量使内容平铺且不堆叠盖住内容。

v1 稿把两侧做成了**覆盖式浮层**（零宽外壳 + 绝对定位卡片），第二轮反馈否掉了这个形状：要**占位**、要**让正文活动**、不要盖住内容；同时属性卡的样式要收一遍。

---

## 2. 版面：两条「占位式」侧面面板

### 2.1 DOM

```html
<div class="docpane__body">
  <aside class="doc-rail doc-rail--left" data-open="true">
    <button class="doc-rail__tab">属性</button>   <!-- 收起时可见 -->
    <div class="doc-rail__card"> …属性卡… </div>   <!-- 展开时可见 -->
  </aside>
  <!-- 原来那一个子节点：正文档是 .doc-split__pane，表格档是 TableEditor / LockedDocPanel -->
  <aside class="doc-rail doc-rail--right" data-open="false"> …大纲… </aside>
</div>
```

轨道是 `.docpane__body` 的直接子项（与正文同级）。放同级是因为两种档位的滚动容器不同：正文档由 `.doc-split__pane` 滚（`.docpane__body` 只是 flex 行），表格档由 `.docpane__body` 自己滚——sticky 在两种情形下都得到「钉在正文区顶部」这一个结果。

### 2.2 CSS（提案取值）

```css
:root {
  --doc-rail-w: 240px;    /* 展开时的面板宽 */
  --doc-rail-tab: 28px;   /* 收起时的贴边把手宽 */
  --doc-rail-gap: var(--sp-3);
}

/* 收起 = 28px 把手；展开 = 240 + 12，实占宽度 */
.doc-rail {
  position: sticky;
  top: 0;
  flex: none;
  align-self: flex-start;
  width: var(--doc-rail-tab);
}
.doc-rail[data-open="true"] { width: calc(var(--doc-rail-w) + var(--doc-rail-gap)); }

/* 把手：竖排文字，只有 28px 宽 */
.doc-rail__tab {
  width: var(--doc-rail-tab);
  margin-top: var(--sp-4);
  padding: var(--sp-4) 0;          /* v2.2：8 → 20px，高约 44 → 68px */
  writing-mode: vertical-rl;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--muted);
  font-size: var(--fs-small);      /* v2.2：--fs-micro → --fs-small */
}
/* v2.2：平边贴外侧、圆角朝正文（纠正 v2/v2.1 写反的镜像） */
.doc-rail--left  .doc-rail__tab { border-left: none;  border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.doc-rail--right .doc-rail__tab { border-right: none; border-radius: var(--radius-sm) 0 0 var(--radius-sm); }

/* 面板：限高后卡体自己滚 */
.doc-rail__card {
  display: none;
  flex-direction: column;
  width: var(--doc-rail-w);
  max-height: calc(100vh - 170px);
  margin-top: var(--sp-4);
  background: var(--bg-soft);      /* v2.2：与桌面同色，不再像第二张纸 */
  border: 1px solid var(--line);
  border-radius: var(--radius);    /* v2.2：--radius-lg → --radius */
  overflow: hidden;
}
.doc-rail[data-open="true"] .doc-rail__card { display: flex; }
```

- **v2.2 的三处外观订正**（用户第三轮反馈）：①把手加长（`padding: var(--sp-4) 0`、`--fs-small`），并把镜像纠正成「**平边贴外侧、圆角朝正文**」；②卡面改 `--bg-soft`、去阴影、圆角收小，卡头文字降到 `--muted`；③`.floatcard__toggle` 的 `color` 由 `--text-2` → `--muted`。

- **占位而非覆盖**：`flex: none` + 真实宽度，正文的容器（`.doc-split__pane`，`flex: 1; min-width: 0`）自然变窄，纸面在剩下的宽度里居中——所以一侧展开时**正文整体往另一边移**，这正是「内容平铺、不叠不盖」。
- **把手 28px**：竖排文字（`writing-mode: vertical-rl`），比一枚胶囊（约 160px）省得多；两侧都收起时也只吃掉 56px。
- 卡片限高、卡体自己滚、卡头不滚（用户 2026-10-11 已拍板「卡片限高 + 内部滚」）。

### 2.3 让位规则（**待确认**，§10）

| 可用宽度（正文区） | 行为 |
| --- | --- |
| ≥ **1304px**（= 2×(240+12) + 800） | 两侧可同时展开，纸面仍是 800 |
| 1304px > 宽 ≥ 一侧展开能放下 | **同时只展开一侧**，另一侧自动收成把手；纸面窄于 800（自适应） |
| 更窄 | 同上；纸面继续自适应变窄，不出现横向滚动条 |

- 「一侧展开能放下」不设硬下限：宁可纸面变窄，也不要盖住内容（用户第二轮反馈的原话）。
- 需要让位时，**收起的是「不是你刚点的那一侧」**：点右侧就把左侧收成把手，反之亦然。跟着窗口一起变窄时，保留**最后动过的那一侧**；都没动过就保留左侧（属性更常用）。
- 实现方式：量正文区宽度（`ResizeObserver`）驱动，不做纯 CSS 断点——「最近动过哪一侧」是状态，CSS 表达不了。

### 2.4 实测（样机，真 `tokens.css` + 真 `app.css`）

样机 `deliverables/props-float/mockup.html`（`deliverables/` 在 `.gitignore`，不入库，仅作评审）。

> **v2.2 说明**：下表是 v2 / v2.1 时期的值（纸面那列当时是 **740**）。v2.2 按用户第三轮反馈把纸面加宽到 **800**、内边距 48px、门槛抬到 **1304px**，纸面与把手的 x 会相应外移；**没有重测这张表**，观感以人工看为准。

| 场景 | 正文区宽 | 纸面 | 左面板 | 右把手 |
| --- | --- | --- | --- | --- |
| 1920 窗口（1906 CSS），两侧展开 | 778 | 740 @x=895 | 240 @x=636 | （隐藏） |
| 1920 窗口，两侧收起 | 1226 | 740 @x=895 | — | 28 @x=1878 |
| 1920 窗口，只开左侧 | 1002 | 740 @x=957 | 240 @x=636 | 28 @x=1878 |
| 1440 窗口（1426 CSS），只开左侧 | 522 | 522 @x=876 | 240 @x=636 | 28 @x=1398 |

滚动验证（1920、两侧展开）：正文区滚 292px 后，**左面板仍是 x=636 y=103**，而正文里的标记从 y=268 跑到 y=-24；`scrollWidth === clientWidth`（无横向溢出）。

---

## 3. 属性卡（左侧面板）——样式收敛

第二轮反馈说它「太乱、样式各不一致」。收敛成**一副骨架**：

### 3.1 一副行骨架

```css
.itemprops--card .itemprops__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px;   /* 值 / 行尾动作 */
  column-gap: var(--sp-1);
  row-gap: 3px;
  padding: 5px 0;
}
.itemprops--card .itemprops__label { grid-column: 1 / -1; grid-row: 1; font-size: var(--fs-micro); }
.itemprops--card .itemprops__ctl   { grid-column: 1; grid-row: 2; }
.itemprops--card .itemprops__act   { grid-column: 2; grid-row: 2; align-items: center; }
```

- **名字一行**（`--fs-micro`、`--muted`，`title` 仍是源键名）、**控件一行**、**动作在控件右侧**（那一列**每一行都留着**，没有动作的行也留白——各行的控件右边界才会对齐）。
- 所有值控件共用同一个外壳 `.itemprops__input`（已有）：同样的高 28、同样的边框 / 圆角 / 底色 / 内边距、同样的聚焦态。**类型只决定控件本体**（单行 / 多行 / 日期 / 数字 / 是-否 / 定值），外观不再分家。

### 3.2 删掉黄字，解释收进 ⓘ

- 删掉「⚠ unread 不是 MeNote 的值 · 已原样保留」这一行。
- 值本身照旧说明白：下拉里就是 `unread（原样保留）`。
- 完整解释收进该行**行尾的 ⓘ**（悬停可见，与全文其它说明文字同一套 `InfoHint` 口径）——按 AGENTS.md「界面辅助文案默认不写、确需的说明收进 ⓘ」。
- 这不是错误提示、也不影响数据安全（原值一定原样写回），所以**不属于"必须保持可见"的那一类**。

### 3.3 动作统一成一种按钮

行尾动作只有两种，**尺寸 / 颜色 / 悬停规则同一套**（24px 方按钮，默认 `--muted`，悬停才分色）：

| 动作 | 图标 | 悬停色 | 说明 |
| --- | --- | --- | --- |
| 本篇不再用 | ⓧ | `--red` + `--red-soft` | 现在的删除，确认框不变 |
| 收进属性库 | 「方框 + 加号」 | `--primary` + `--primary-soft` | 从前的「未入库」虚线 chip + 11px 说明行**收成一个图标按钮**，说明进 `title` |

### 3.4 分组只有一种样式

内置四行（标签 / 状态 / 截止 / 优先级）与外来键之间，只用**一条 `--line` 细线 + 一行 `--fs-micro --muted` 小字「其他属性」**。删掉「· 键名原样保留」（说明性文字，源名本来就在悬停里）。

### 3.5 内容与行为一个字不改

标签 chip、`+ 添加`、`+ 用一个属性`、「未入库」的入库语义、删除的二次确认文案、只读 / 隐私锁定的禁用态、逐个 handler（`onTagsChange` / `onTaskChange` / `onForeignChange` / `onForeignRemove` / `onForeignAdd` / `onLibraryChange`）**全部保持现状**——本次只动外观与位置。

---

## 4. 大纲面板（右侧）

### 4.1 标题从哪来

复用 `packages/mdcore/src/section.ts` 里已经在用的判据：把内部 `scanHeadings` 包成导出的 `listHeadings(markdown): HeadingHit[]`（`{ level, heading, start }`，`start` 是**正文**偏移），只取 `level <= 3`。口径与 `findSectionRange` 完全一致：先剥 front matter、只认 ATX（井号后必须有空格或行尾）、**Setext 不认**。

> 不在 `apps/web` 里另写一个标题正则——**判据只能有一份**（v0.8.31 的教训）。改 `packages/mdcore/src/*` 之后必须 `pnpm --filter @menote/mdcore build`。

### 4.2 列表与跳转

- 缩进：一级 12px / 二级 24px / 三级 36px（外加 2px 状态条的位置）；三级字号降到 `--fs-micro`，文字单行省略号。
- 当前小节：左侧 2px `--primary` 条 + 主色文字 + `--primary-soft` 底。
- 点击跳转：仅编辑 / 即时渲染档走 `editorHandle` 的定位接口（与属性卡改值同一个句柄）；仅预览档没有编辑器，按标题序号取预览 DOM 里的元素 `scrollIntoView({ block: "start" })`。
- 「当前小节」按视口顶部那条线算：正文滚动时节流到帧级，**只有小节真的变了**才更新 state。
- 没有 h1–h3 时给一行空态「这一篇还没有一二三级标题」；**表格档不出这张面板**（表格正文不是 Markdown）。

---

## 5. 折叠记忆

照 `apps/web/src/features/notes/props-collapse.ts` 的现成先例，**记本机**（`localStorage`）：

| key | 含义 | 兜底 |
| --- | --- | --- |
| `menote:notes:props-open`（新，替代现有 `props-collapsed` 的语义） | 属性面板是否展开 | 读不到 = 展开 |
| `menote:notes:outline-open`（新） | 大纲面板是否展开 | 读不到 = 展开 |
| `menote:notes:rails-last`（新） | 最后动过的是哪一侧（让位规则用） | 读不到 = 左侧 |

设备级偏好、高频动作，不上行给同步添噪声——理由与 `props-collapse.ts` 写明的两条一致。落地时**要么把旧 key 迁移过来、要么保留旧 key 语义**，别让老用户的折叠状态复活（实现时在 `props-collapse.ts` 里一并处理）。

---

## 6. 要动的地方

| 位置 | 改什么 |
| --- | --- |
| `apps/web/src/features/notes/ui/NoteWorkspace.tsx` | `.docpane__body` 里加左右两条轨道；属性卡从标题带之下搬进左轨；新增右轨；让位规则接线。**必须一起改写 `:459` 那段注释**（它现在写着"属性卡是 `.docpane` 的第三个带、当年放进 `.docpane__body` 是错的"——本次推翻它，改为"占位式侧面面板 + sticky"） |
| `apps/web/src/features/notes/ui/ItemProps.tsx` | 行改竖排与收敛（名字一行 / 控件一行 / 动作一列）；删黄字段与「· 键名原样保留」；「未入库」改图标按钮。**handler 与文案不动** |
| `apps/web/src/features/notes/ui/OutlinePanel.tsx`（新） | 大纲面板：列表、当前节、跳转、空态 |
| `apps/web/src/features/notes/outline.ts`（新） | 纯函数：取 h1–h3、算「当前在第几节」 |
| `apps/web/src/features/notes/props-collapse.ts` | 加两个新 key（属性展开 / 大纲展开）与「最后动过哪侧」；处理旧 key |
| `apps/web/src/features/notes/useRails.ts`（新，可选） | 让位规则：量正文区宽度 + 决定两侧是否展开 |
| `packages/mdcore/src/section.ts` + `src/index.ts` | 导出 `listHeadings`（+ 类型出口） |
| `apps/web/src/app/theme/app.css` | 新增 `.doc-rail*` / `.floatcard*` / `.outline*` / `.itemprops--card` / `.itemprops__icobtn`；`.itemprops` 去掉"第三个带"那套（`flex: none` / `border-bottom` / 与 `.editor-toolbar__inner` 共享的 740 居中规则，**工具栏那份要留着**） |
| 用例 | `item-props.test.tsx` 按新结构改（行的可访问名不变，容器变了）；新增 `outline` 纯函数用例、「滚动后面板矩形不变」「展开 / 收起时正文宽度与位置随之变化」「无横向溢出」等守卫用例；`css-cascade.test.ts` 涉及 `.itemprops` 与纸面的那组跟着核对 |

---

## 7. 与定稿的关系（要用户点头的部分）

1. **`DESIGN.md` §2.7「每层只允许一个滚动容器」要加一条浮层例外**：贴边面板的**卡体**允许有自己的滚动容器（限高后的内部滚），因为它是钉在正文区上的工具面板、不是正文那一层。**例外只给这两个贴边面板**，任何进正文流的容器都不适用。
2. **`DESIGN.md` §5.6**「属性卡片在正文区顶部（标题带之下、正文之上）」→ 改为「正文区**左侧贴边面板**，可侧面折叠成 28px 把手；展开时占宽、正文随之让位」。
3. **`DESIGN.md` §5.3**「条目属性」那行的措辞跟着对齐。
4. **`DESIGN.md` §2.8** 无需改规则，只补一句：纸面在「正文区减去两侧让出的宽度」里居中（一侧展开时正文会整体移动）。
5. 修订记录按追加式记 **v1.17**（旧行原样保留）；`wiki/` **只订正 `components.md` 里 `ItemProps` 那一格的旧结构描述**（"第三带"与 `collapsedSummary` 已不存在），**不动功能与接口口径**。
6. 落码后一并订正两份早期设计稿里因本次改动而失真的描述：`docs/modules/MeNote-属性卡片与属性库-设计-v1.md` §2.5 的类名清单与折叠态摘要。

---

## 8. 已知代价

1. **纸面会被压窄**：一侧展开时，1440 窗口下纸面是 522px（1920 窗口下拿满 **800**，v2.2 前是 740）。这是「宁可窄、不覆盖」的直接结果；觉得窄就收起面板（把手只占 28px）。
2. **两侧同时展开门槛较高**：需要正文区 ≥ **1304px**（= 252 + 纸面 800 + 252，约 1920 窗口）。比这窄就自动只留一侧——用户第二轮反馈里的「屏幕空间局限只能展开一侧」就是这样。
3. **把手常驻占 28px**：两侧都收起也吃掉 56px 宽；换来的是随时一键展开、且不盖内容。
4. 移动端不做（§2.4 未定稿）。

---

## 9. 验收点

1. 属性带从正文上方消失；正文起点上移。
2. 左侧属性面板贴正文区**左**边缘、右侧大纲面板贴**右**边缘；展开时**实占宽度**、正文**随之左右移动**，任何档位下**不覆盖正文**。
3. 收起 = 28px 竖排把手（**v2.2：把手加长约 44 → 68px、字号 `--fs-small`，平边贴外侧、圆角朝正文**）；展开 / 收起都有可见的焦点态与悬停反馈。
4. 正文滚动时两个面板**位置不变**（用例断言滚动前后矩形一致）。
5. 无横向溢出（`scrollWidth === clientWidth`）；纸面 **`max-width: 800px`**（v2.2 前 740）、内边距 48px，A4 下限 `min-height: calc(800px * 297 / 210)` 随之换算。
6. 宽度不足时**同时只展开一侧**，另一侧自动收成把手；点开另一侧时前一侧让位。
7. 大纲只列 h1–h3、点击跳转、当前节高亮、空态、表格档不出。
8. 属性卡：删掉了黄字提示；所有值控件同一外壳；行尾动作同一尺寸同一列；组之间只有细线 + 小字。
9. 属性多于视口时卡体内部滚、卡头不滚；只读 / 隐私锁定时面板禁用且不消失。
10. `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿。

---

## 10. 已拍板与落实结果

**已拍板（用户 2026-10-11）**

1. §2.3 的让位规则：门槛（v2.2 起 **1304px**，当时是 1244）、让位时收起「不是你刚点的那一侧」、收缩时保留最后动过的那一侧——**都认**。
2. §3.3「未入库」由虚线 chip + 说明行改成行尾一枚图标按钮——**通过**（含义进 `aria-label` 与 `title`；卡里所有动作统一成 24px 方按钮）。
3. §5 的 key 处理：**新 key 语义相反（`props-open`）+ 旧 key 反向迁移一次**（`props-collapsed = 1` → 收起并删旧 key）——通过。

**落实结果（2026-10-11 当日落码）**

1. 落码顺序：mdcore 导出 `listHeadings` → 大纲纯函数 + 用例 → 两侧面板组件 + 轨道 → `NoteWorkspace` 接线 + 让位规则 → CSS 收敛。**全部已落地**。
2. `DESIGN.md` **v1.17** 已回写（§2.7 例外 / §2.8 补句 / §5.3 / §5.6 第 11~13 条 / 修订记录，旧行原样保留），本稿同时转「生效」。
3. `CHANGELOG.md` + 根 `package.json` → **v0.8.34**；代码与文档分两次提交、推送。
4. **v2.2（v0.8.35）已按用户第三轮反馈调样式**：折叠把手加长并把圆角/平边镜像纠正成「平边贴外侧、圆角朝正文」；两侧卡改 `--bg-soft`、去阴影、圆角收小（轻量化）；纸面 740 → **800**、内边距 `--sp-6` → **48px**（文字列仍 704），让位门槛 **1304px**。样机与改前/改后对照图在 `deliverables/props-float/`、`deliverables/props-rail-tab/`（`deliverables/` 不入库）。
