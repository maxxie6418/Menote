# MeNote「编辑设置」分类（字号 / 字体 / 纸面宽度 / 标题样式 / 工具栏大小）设计 v1

| 项 | 内容 |
| --- | --- |
| 文档版本 | v1 |
| 文档状态 | **生效**（v0.8.40 已落地；验收 A–H 真机实测通过，见 §7） |
| 目的和适用范围 | 新增设置分类「编辑设置」（`#/settings/editor`）：把编辑模式卡从「通用」搬过来，并让正文排版（字号 / 字体 / 纸面宽度）、六级标题样式（字号 / 粗细 / 颜色）、格式工具栏大小可调。适用于 `apps/web/src/features/settings/`（新增 `ui/EditorSettingsPage.tsx`、新增 `editor-typography.ts`、`ui/GeneralCards.tsx`、`ui/SettingsPanel.tsx`）、`apps/web/src/app/router.ts`、`apps/web/src/app/editor/EditorToolbar.tsx`（新增 `toolbar-size.ts`）、`apps/web/src/app/theme/app.css`、`apps/web/src/features/notes/ui/NoteWorkspace.tsx`、`packages/shared/src/settings.ts` |
| 权威级别 | 模块规则（不覆盖 `wiki/`；`DESIGN.md` §2.8 / §3.3 的口径变化见 §5 与回写台账） |
| 最后更新日期 | 2026-10-19 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
| --- | --- | --- | --- | --- |
| v1 | v0.8.40 | 2026-10-19 | 首稿。用户 2026-10-19 就"编辑设置"给出选择：**新建独立分类 + 把「通用」里的「编辑体验」卡搬进来**，本轮含**字号 / 字体 / 宽度 / 工具栏尺寸 / 标题样式**五块；存储档默认（字号 / 字体 / 宽度 / 标题样式=账号级，工具栏尺寸=本机） | deepseek-v4.1-flash |

---

## 0. 先读这一节（本次边界）

**做**：①`SETTINGS_PAGES` 新增 `editor`（老 hash 由"重定向到 general"改为落到这个真页面）；②`editor_typography` 账号级契约与读侧夹取；③新增设置页四张卡（编辑模式 / 正文排版 / 标题样式 / 工具栏）；④纸面宽度、正文字号、字体、六级标题样式经 CSS 变量生效（编辑档、即时渲染档、仅预览档同源）；⑤工具栏大小本机可调（三档）。

**不做**：不内置更多字体（**取值为枚举 + CSS 变量，后续加字体是加一条 map，不动框架**）；不改 `DESIGN.md` 的正文列上限口径（默认 800 与改动前逐像素相同）；不动属性卡 / 大纲面板的让位规则（那是下一批"纸面不动、压缩留白"，先出样机）；不给标题样式加"每级独立字体 / 行高 / 边距"（先只做字号 / 粗细 / 颜色三项，用户只点了这三项）。

---

## 1. 用户口径（2026-10-19）

三问三答，逐条落地：

1. **分类形态**：**新建独立分类 + 把「通用」里的「编辑体验」卡搬进来**（不把设置塞进「通用」，也不恢复当年被撤销的「编辑器」分类的全部内容）。
2. **本轮范围**：字号 / 字体 / 宽度 / 工具栏尺寸 / 标题样式，**五项都做**。
3. **存储档**：字号 / 字体 / 宽度 / 标题样式**跟随账号**（换设备看到同一套排版）；**工具栏尺寸只在本机生效**——它描述的是"这块屏幕看着小不小"，跟设备走。

---

## 2. 分类与落点

`SETTINGS_PAGES`（唯一真源，`apps/web/src/app/router.ts`）在 `general` 之后插入 `"editor"`，共 11 类。三条连带：

1. **`LEGACY_SETTINGS_PAGES` 同时去掉 `editor`**，只留 `{ about: "general" }`。老书签 `#/settings/editor` 从此落到这个真页面——**这正是当年撤销它时想表达的东西的反面**，所以必须显式改，不能靠"匹配不到回落 general"接住（2026-09-27 那个静默落错页的 bug 与此同形，用两条用例钉住）。
2. `PAGE_META` 是 `Record<SettingsPageId, …>`：漏写一个分类**编译不过**，这是分类清单之外的第二道守卫。
3. **「通用」页只减不增**：编辑模式卡整体搬到新页（不是复制一份），`GeneralCards.tsx` 随之只留「账户快捷菜单的兄弟卡」与「关于」。

---

## 3. 页内四张卡

| 卡 | 内容 | 存储档 |
| --- | --- | --- |
| 编辑模式 | 原「编辑体验」卡整体搬来（三档开关 + "打开时用哪一档"），卡名改为「编辑模式」——它管的确实只是模式，旧名会与"排版"混 | 开关账号级 / "上次用的那一档"本机 |
| 正文排版 | 正文字号（11–24px）、字体（目前 `sans` / `mono` 两族）、纸面宽度（640–1100px）；每项可清空=跟随主题；纸面宽度旁实时显示"文字列 = 纸面 − 96" | 账号级 |
| 标题样式 | 一到六级各一行：字号（10–40px）、粗细（400/500/600/700）、颜色（系统取色器）；每项可清空、可"跟随主题" | 账号级 |
| 工具栏 | 格式工具栏三档：小（默认）/ 中 / 大 | **本机**（挂「本机」标记） |

数字输入沿用设置页既有写法（`inputMode="numeric"` 文本框 + `.setrow__unit`），**不做滑块**：全仓没有滑块先例，且滑块的取值精度与"清空 = 跟随主题"这件事天生不合（滑到最左到底是 11px 还是"没设"？）。越界时不写库、就地给可见的区间提示。

---

## 4. 契约与读写

`packages/shared/src/settings.ts`：

```ts
EditorTypographySchema = { font_size?, font_family?, paper_width?, headings?: Record<level, {size?, weight?, color?}> }
UserSettingsSchema.editor_typography = v.optional(EditorTypographySchema, () => ({ headings: {} }))
```

- **不加迁移**：`user_settings` 是整份 JSON 列，新字段一律 `v.optional(schema, 默认值)`，读侧补默认即可（与 `prop_library` / `prop_labels` 同一条路数）。
- **读侧夹取**：`apps/web/src/features/settings/editor-typography.ts` 的 `editorTypographyVars()` 是唯一的读侧关口——越界、类型不符、颜色不是 `#rrggbb` 一律**丢弃该条**（不抛错）。“库里存着什么”可能来自旧客户端、手改的 JSON、别的实例，界面不能因此崩。
- **写侧整份替换**：与属性库同一条路数——"少给一项"就是"清空那一项"，所以逐字段合并反而让"清空"无法表达。**`headings` 是嵌套映射，必须单独合**：写错一次（拿旧 `headings` 盖新值）会让标题控件改完立刻弹回"跟随"，而界面照常渲染、控制台一声不响——真机验收抓到的就是这个（`apps/web/test/settings-editor-page.test.tsx` 钉住）。
- **工具栏尺寸**：走本机 `localStorage`（`menote:editor:toolbar-size`，`apps/web/src/app/editor/toolbar-size.ts`），照 `props-collapse.ts` 的读法（读不出静默回落 `sm`）。
- **图标尺寸不外扩**：三档图标取 13/16/20，正好落在公共 `IconButton` 已有的 `13 | 16 | 20` 联合类型内——**公共组件的 prop 类型不动**。

---

## 5. CSS 变量口径

新增的变量全部**带兜底**，兜底值就是改动前的取值，所以"没配过"的渲染与加这个设置之前**逐像素相同**：

| 变量 | 兜底 | 作用点 |
| --- | --- | --- |
| `--doc-fs-body` | `var(--fs-body)` | `[data-editor] .cm-scroller`、`.docpane__body .markdown-body` |
| `--doc-font` | `var(--sans)`（编辑档为 `var(--mono)`） | 同上两处 |
| `--doc-paper-w` | `800px` | 纸面 `max-width`、**A4 下限** `calc(var(--doc-paper-w, 800px) * 297 / 210)`、格式工具栏内层 `max-width` |
| `--doc-h1-size` … `--doc-h6-color` | 各级现有令牌（`--fs-display` / `--fs-title` / … / `--muted`） | `.markdown-body hN, .cm-live-hN` 那一条成组规则 |

- 变量挂在**正文容器 `.docpane`** 上（`style={editorTypographyVars(editorTypography)}`），编辑档与仅预览档同源；一处改，两档一起变。
- 因此 `--doc-paper-w` 有**第三个消费者**：格式工具栏与属性带的内层列宽（工具栏要跟纸面同一个左边界）。`apps/web/test/css-cascade.test.ts` 相应从"钉 800"改为"钉与纸面**同一个变量**"——两处各自漂是这条断言真正要防的。
- 纸面宽度还能调窄 → `useRails` 的"两侧同开"门槛不能再是常量：`railOpenState(intent, paneWidth, paperWidth)` 按当前纸面宽推导（`2 × 252 + paperWidth`），默认参数保持 800，既有用例不变。
- `.cm-scroller` 的左内边距仍在（`padding: var(--sp-5) 48px 80px` 挂在 `.cm-content` 上，见批次一），所以"文字列 = 纸面 − 96"这句话在两个批次之间是同一件事。

---

## 6. 「跟随主题」是一条减法

清空输入 → 该键从 `editor_typography` 里**消失**（不是写 `undefined`，也不是写一个等值默认）→ `editorTypographyVars()` 不产生声明 → CSS 的令牌兜底接手。三级取值（本文档正文 / `DESIGN.md` / 令牌表）因此天然一致，**不需要"默认值"这一层**。取色器另有显式的「跟随主题」按钮（`type=color` 的 `#000000` 无法表达"没设过"）。

---

## 7. 验收点与实测结果

| 点 | 内容 | 结果 |
| --- | --- | --- |
| A | 设置导航出现「编辑设置」且高亮正确；11 类 | 通过（真机：11 个 `.set-nav-item`，`aria-current` 落在 `editor`） |
| B | 四张卡与全部控件在位（三档开关、三项排版、六级 × 三项标题、工具栏三档） | 通过 |
| C | 正文字号 18px 生效：编辑档与即时渲染档 `.cm-scroller`、仅预览档 `.markdown-body` | 通过（计算值 18px；仅预览档同为 18px） |
| D | 纸面宽度 880px 生效：纸面 `max-width` 880、A4 下限随之变化 | 通过 |
| E | 标题样式生效：一级 28px / `#c0392b`、二级 500 | 通过（计算值 28px / `rgb(192,57,43)` / 500，两档一致） |
| F | 工具栏「中」→ 按钮 28px（默认「小」=24px） | 通过 |
| G | 清空 = 跟随主题（键消失、无声明） | 通过（组件用例 + 变量用例） |
| H | 持久化：值落 `user_settings`（本机那项落 `localStorage`），刷新后仍在 | 通过（刷新后 18/880/28/500/#c0392b 全在） |

本轮验证命令：`pnpm typecheck`（四包全过）、定向 vitest（`settings-editor-page` 6 / `settings-editor-modes` 5 / `editor-typography` 7 / `router` 6 / `css-cascade` 11 / `ui` 25 / `editor-toolbar` 7 / `live-preview` 32 / `live-preview-lock` 10 / `frontmatter-hide` 23 / `layout-invariants` 33 / `style-coverage` 3 / `tables-wiring` 10）、根 `pnpm lint` / `pnpm test`（既有 8 个 jsdom 环境失败与本批无关，见批次一验收记录）。

---

## 8. 留给下一批

- **面板不推动正文 + 大纲贴正文边**（用户第 3、4 条）：口径已定（"纸面不动、压缩留白"，用户原话"直面不动当然可以压缩留白区域"），与 `DESIGN.md` §2.8 现行的"纸面随之整体移动"相反，**先出样机再确认**。
- **更多内置字体**：加一条 `EDITOR_FONT_FAMILIES` + `EDITOR_FONT_STACK` 条目 + 设置页一个 `<option>`，CSS 不动。
