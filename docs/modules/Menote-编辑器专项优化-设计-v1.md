# Menote 编辑器专项优化 设计 v1

| 项 | 值 |
|---|---|
| 文档版本 | v1.1 |
| 文档状态 | 生效（按 2026-10-11 用户确认的方向执行：inkstone 为蓝本、可借鉴代码、许可证转 LGPL-3.0） |
| 目的和适用范围 | 以 [shuaiplus/inkstone](https://github.com/shuaiplus/inkstone) 编辑器为蓝本，补齐 MeNote 正文编辑器与其的差距：格式化工具栏、编辑键位、即时渲染能力升级（任务勾选 / 代码高亮 / 图片内联）、查找替换。只覆盖正文编辑器；快捷宿主与 `@` 属性系统不在本文 |
| 权威级别 | 模块规则。是《编辑拓展-设计-v3》（生效）与《即时渲染-设计-v1》（生效 v3）的下位专项设计，与其冲突处本文让位 |
| 最后更新日期 | 2026-10-11 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.8.17 | 2026-10-11 | 首稿。基于过时的仓库快照写成（当时误以为阶段 A–D 未实施），其中的「试验页先行」「块级渲染照搬」结论作废 | GLM-5.3-Flash（ZCode） |
| v1.1 | v0.8.17 | 2026-10-11 | 变基到 v0.8.17 后按真实现状重写：编辑拓展阶段 A–D 已落地（共享命令层、三档模式、即时渲染已进生产），本稿改为在其上做增量；即时渲染维持行内装饰路线（架构 §3.3 定稿），从蓝本吸收**能力项**而非渲染路线 | GLM-5.3-Flash（ZCode） |

## 一、输入与边界

用户确认（2026-10-11）：

1. **以 inkstone 编辑器为蓝本**做编辑器专项优化；
2. **可以借鉴（复制并改造）它的代码**；
3. **接受 MeNote 许可证转为 LGPL-3.0**——借鉴代码的前提（inkstone 是 LGPL-3.0-only，复制其代码会产生 LGPL 衍生物）。

现状核对（v0.8.17，避免重蹈 v1 的覆辙）——inkstone 的东西**已经吸收了一部分**：

| inkstone 的做法 | MeNote 现状（出处） |
|---|---|
| `CodeEditor.tsx` 的「编辑手感」扩展（drawSelection / dropCursor / rectangularSelection / indentOnInput / bracketMatching / placeholder） | `Editor.tsx` 已接，注释点名参照过 inkstone（v0.6.x「编辑器补编辑手感」） |
| `live-preview.ts` 的 90ms 防抖重算 | 已按同一思路实现（即时渲染设计 §四-3） |
| `commands.ts` 纯 CM6 命令层 | 没照搬，走了**自己的纯函数路线**：`format-commands.ts`（`(文本, 选区, 命令) → (新文本, 新选区)`，正文与快捷输入共用） |
| `/` 命令菜单 | 已有（`CommandMenu.tsx`，快捷输入在生产用；正文尚未接 `onSlashQuery`） |
| 即时渲染 | 行内装饰路线已进生产三档（架构 §3.3 技术路线定稿，19 条 jsdom 用例）；能力覆盖见即时渲染设计 §二覆盖表，**§七 的未做项（代码高亮 / 任务勾选 / 图片内联）恰好就是与 inkstone 的差距** |
| 顶部工具栏 | **没有**。本次的主补项 |
| 查找替换浮动面板 | **没有**（连 `@codemirror/search` 都未接）。次补项 |

## 二、范围

**做**（按批次）：

1. **P1 工具栏 + 键位 + 命令层扩展**：正文区加固定格式工具栏；编辑键位表（`Ctrl+B/I/E` 等）；`format-commands.ts` 补删除线、标题级别参数化；命令落盘从「整篇替换」改为「最小变更区间」。
2. **P2 即时渲染能力升级**（对齐即时渲染设计 §七 的 4/5/6 项，即与 inkstone 的差距）：任务清单真复选框（勾选改文档）→ 代码块语言高亮（Prism 动态加载）→ 图片内联（走附件服务，含加载三态）。可选追加：`==高亮==`（需 markdown-it-mark）、表格/分隔线按钮。
3. **P3 查找替换浮动面板**：移植 inkstone `search.ts` 机制（选区范围 / 正则 / 结果列表 / 替换撤销），`Ctrl+F/H` 与工具栏「查找」接上。

**不做**：

- **块级 HTML 渲染路线不采纳**（v1 首稿的结论作废）：架构 §3.3 把即时渲染技术路线定死为「Lezer 装饰、只算视口」，且该路线已实测收口；inkstone 的块级路线要往 CM 状态里塞第二个 markdown-it 渲染器，破坏「预览与即时渲染同一套样式语义」。它的收益项（代码高亮、任务勾选、图片）在现有路线上用 widget 逐项补齐——项目符号 `•` 与图片占位块已是先例。
- Mermaid / KaTeX：依赖重（数 MB）、渲染管线要动，**另行决策**，本专项不背。
- wikilink / 笔记嵌入 / 块引用 / callout / tabs / front matter 插入：MeNote 没有双链体系，其余是 inkstone 私有语法。
- 打字机 / 专注模式：`wiki/设计文档 v7` 已明确删除。
- `@` 进正文：v3 §三-3 明确排除。

## 三、落点与依赖方向

```text
apps/web/src/app/editor/
  format-commands.ts   扩展（删除线、标题级别、最小变更区间）——仍是唯一 Markdown 拼装处
  shortcuts.ts         新增：编辑键位表（纯 CM6 KeyBinding，命令仍调 format-commands）
  EditorToolbar.tsx    新增：工具栏（DESIGN.md 组件拼装：IconButton + DropdownMenu）
  Editor.tsx           改：挂键位；applyFormat 支持标题级别与最小变更
features/notes/ui/
  NoteWorkspace.tsx    改：docpane 内挂工具栏（仅编辑 / 即时渲染两档显示）
app/ui/Icon.tsx       改：sprite 增补格式类图标
```

依赖方向不变：`features/notes → app/editor → @menote/*`。工具栏不认识 CodeMirror，只调 `EditorHandle.applyFormat`——将来换引擎不用换工具栏（v3「宿主不直接依赖引擎类型」的同一路数）。

## 四、关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 即时渲染**维持行内装饰路线**，能力升级以 widget 逐项落进现有纯函数 `buildLivePreviewDecorations` | 见 §二「不做」第一条 |
| D2 | 工具栏进**生产正文**（不再走试验页先行）：它只是把 `applyFormat` 这条**已经在线上跑的命令通道**换了个按钮入口，不改引擎、不改保存链路；即时渲染的**渲染行为**升级（P2）仍逐项小步上生产，每项带 jsdom 用例 + 人工输入法验收 | 工具栏风险≈0；P2 的每项都是现有覆盖表的增量，与当初上线的路数一致 |
| D3 | P1 命令集 = 现有正文集合 + **删除线**；标题命令**参数化级别**（H1–H6 / 正文），`/` 菜单不带级别参数时保持现行 `##` 行为不变 | v3 §三-2 的正文能力边界不动；删除线是 GFM 标准语法、预览本就支持 |
| D4 | `==高亮==`、表格模板、分隔线按钮**随 P2**：前者的预览渲染需要新依赖 markdown-it-mark，按钮先行会造成「按钮插的语法预览不认」 | 所见即所插 |
| D5 | 键位表（`app/editor/shortcuts.ts`，不进 `app/shortcuts/` 全局表——DESIGN §6.3 规则 4）：`Ctrl/Cmd+B/I/E`、`Ctrl/Cmd+Shift+X`（删除线）、`Ctrl/Cmd+Alt+0..6`（正文/标题）、`Ctrl/Cmd+Shift+7/8/9`（有序/无序/任务）、`Ctrl/Cmd+Shift+.`（引用）、`Alt+↑/↓`（移行）、`Ctrl/Cmd+Shift+K`（删行）、`Ctrl/Cmd+]`/`[`（缩进）。**`Ctrl/Cmd+K` 不绑**（全局搜索占用，DESIGN §6.3 定稿）；`Ctrl/Cmd+F/H` 待 P3 再绑 | 键位总表是定稿，不冲突是底线 |
| D6 | 命令落盘改为**最小变更区间**（公共前后缀求差），替换现行「整篇替换」：撤销粒度变小、大文档少一次全量 diff | 纯函数加一个 `minimalChange`，行为等价，可用例钉住 |
| D7 | 许可证：根 `LICENSE` = LGPL-3.0-only，`package.json` 加 `license` 字段；借鉴文件头部保留来源标注 | 用户已确认；LGPL 要求保留声明 |
| D8 | 新增生产依赖随对应批次列明：P2 的 `prismjs`（动态 `import()`，首屏不付代价）、`markdown-it-mark`（若做高亮）；P3 的 `@codemirror/search`。均为 MIT | AGENTS「先确认再动」要求点名依赖；用户已确认蓝本方向，这里做显式登记 |

## 五、工具栏本屏稿（P1）

位置：`NoteWorkspace` 正文区，`docpane__head` 之下、正文之上的一条**固定条**（随正文区同宽，不滚动）。

- **显示条件**：Markdown 条目且当前档位是「仅编辑」或「即时渲染」；「仅预览」不显示；表格条目不显示（表格有自己的工具条）。
- **禁用**：正文锁定时整条禁用 + `title` 说明原因（DESIGN §6.1：禁用必须说明）。
- **结构**：高约 36px，左侧按钮组，组间细分隔线，超出横向滚动：
  `标题 ▾`｜`加粗` `斜体` `删除线` `行内代码`｜`无序列表` `有序列表` `任务清单` `引用`｜`链接` `代码块`
- **按钮**：幽灵档图标按钮（DESIGN §5.1 弱操作），图标走 sprite 小档 13px；每个按钮 `aria-label` + `title`（含键位提示，DESIGN §6.3 规则 3）；标题菜单用 `DropdownMenu`（正文 / H1–H6，行为守 §6.4：单开、外点关、Esc 收、选完即收）。
- **图标 sprite 增补**（1.6px 描边、`currentColor`，§5.5）：`bold` `italic` `strikethrough` `code` `code-block` `heading` `list-ul` `list-ol` `quote` `link`（`check-square` 已有，任务清单复用）。
- **空状态**：无（工具栏常驻）。

## 六、验收

| 批次 | 验收 |
|---|---|
| P1 | `pnpm lint / typecheck / test` 全绿；新增命令（删除线 / 标题级别 / 最小变更）有用例；工具栏每键对选区行为正确、`title` 带键位、锁定态禁用且说明原因；仅预览不显示；快捷输入命令集**不受影响**（strikethrough 不进 QUICK 基础集，v3 §三-2 边界不动） |
| P2 | 每项：jsdom 用例（纯函数层）+ 真机输入法人工验收（即时渲染设计 §七-1 的既有要求）；Prism 动态加载不进首屏包（构建产物核对） |
| P3 | `Ctrl+F/H`、`F3` 生效；面板 Esc 关闭、焦点归还；不与全局和弦冲突 |
| 文档回写 | 每批完成即回写：即时渲染设计 v1 覆盖表（P2 各项转✅）、`components.md`（工具栏组件）、CHANGELOG 按「文档回写不用问」执行 |

## 七、风险

| 风险 | 对策 |
|---|---|
| LGPL 传染范围失控 | 只借编辑器必需部分；借鉴文件头标注；根 LICENSE 落地；后续借入走同一流程 |
| 键位与输入法 / 全局和弦冲突 | 不绑 `Ctrl+K/F/H`（P3 时单独核对全局表）；组合期间 CM 键位本身不触发（`event.isComposing` 由 CM 处理） |
| 命令最小变更引入选区错位 | `minimalChange` 纯函数 + 用例；选区以命令结果的绝对坐标落位（与现行语义一致） |
| P2 各项触碰 IME / 撤销 | 沿用即时渲染设计 §四的全部纪律（composing 不重算、atomicRanges、90ms 防抖）；每项独立上，出问题单项回退 |
