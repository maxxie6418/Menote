# Menote 组件规划（components）

| 项 | 内容 |
|---|---|
| 文档性质 | 前端组件规划：**组件名、所属 feature / 落点、职责、props 约定、复用关系**，以及与界面原型的对应。是架构文档 §2.3.2「功能 → 代码落点对照表」在**组件层**的展开 |
| 基准 | 需求文档 `wiki/Menote-设计文档-v7.4.md`（下称“需求文档”）；功能点编号与验收看 `wiki/Menote-功能拆解-v2.md`（下称“功能拆解”）；落点、分层与依赖方向看 `wiki/Menote-项目架构-v1.md`（下称“架构”）§2.3、§3.1；视觉与令牌看根目录 `DESIGN.md`（下称“视觉源”） |
| 主要来源 | 界面原型 `prototype/menote-prototype.html`（高保真）与 `prototype/menote-framework.html`（线框评审页）。引用原型**只写元素名或选择器**（如 `#topAccount`、`.composer`、`.nav-seg`），不写行号——行号随原型改动会失效 |
| 版本 | v13（文件名 `components.md` 不变，版本在修订记录内演进） |
| 日期 | 2026-09-29（v7）/ **2026-10-02（v8 笔记本添加菜单加导入笔记、新建表格接线）** / **2026-10-03（v9 M5 分享收口回写、v10 M6 第一批回写、v11 M6 MCP 回写、v12 M7 定时自动备份回写）** / **2026-10-04（v13 设置页信息架构 11 → 9 类）** |
| 状态 | 首稿。**代码尚未初始化**：组件名与 props 均为**约定名**，实现时如无充分理由不要改名；若实现中发现更合适的拆法，先回报本文再改 |
| 不包含 | 颜色 / 字号 / 间距 / 圆角 / 阴影的具体数值（归 `DESIGN.md`，本文只写“走令牌”，不复制令牌值）；接口、表结构、同步算法（归架构文档）；功能规则与验收口径（归需求文档与功能拆解） |

### 标注约定

| 标注 | 含义 |
|---|---|
| 【已落地】 | 原型中已存在、结构与状态可见的组件，可直接对照原型开工 |
| 【预留】 | 界面已规划但原型尚未实现；只约定职责与大致拆法，形状待原型补上后再定（第十二章统一列出） |
| 【待定】 | 形态未定或形态开放，实现前需用户确认 |
| `Mxx-yy` | 功能点编号，出自功能拆解；组件与功能点的完整对应见第十章 |
| `§x.y` | 需求文档小节号；`架构 §x.y` 指架构文档 |

### 修订记录

| 版本 | 日期 | 内容 |
|---|---|---|
| v1 | 2026-09-26 | 首稿。以原型已落地的组件为主体（第四至九章），附通用控件库与映射矩阵，并单列预留组件（第十二章） |
| v2 | 2026-09-26 | M2 收口回写【已定·用户确认 2026-09-26】：新增第十四章「M2 落地后的组件与收敛记录」——列出 M2 实际新增的组件（含实现名与落点）、五处**文档与实现不一致**的收敛去向（`Placeholder`→`EmptyState`、`Menu`→`DropdownMenu`、`Button.secondary`、`Pill.err`、`SegmentedControl` 未抽共享件），以及两项**已知未实现**（锚点自动上翻、共享 `SegmentedControl`） |
| v3 | 2026-09-27 | 隐私锁设计 v1.3 回写【已定·用户确认 2026-09-27】：①`TierMenu` 改**三档**（本次会话 / N 分钟 / 当前设备长期）并删「仅本次查看」；②`PrivacyCapsule` **状态映射去掉「仅本次查看」**，三档显示口径按设计 §9.2（N 分钟带倒计时、本次会话显示「已解锁 · 本次会话」、当前设备长期用 danger 色 + 「本设备始终解锁」）；③把原型里两份形态相同的 `MemoLockedPlaceholder` / `TaskLockedPlaceholder` 记为**收敛为一个 `LockedPlaceholder`**（§14.2 收敛表新增第 6 条）；④账户快捷菜单账户头由两行改**三行**（用户名 / 角色 · 实例 / 版本号 `MeNote vX.Y.Z`，后两行复用 `.acct__sub`），并补设置新增的第 11 个分类页「**关于**」（版本号 + 项目 GitHub 地址链接）。（应用版本 v0.3.2；修改模型ID：deepseek-v4.1-flash） |
| v4 | 2026-09-27 | M4 收口回写【已定·用户确认 2026-09-27（授权两点之一，M4 设计 §九 第 8 行）】：新增第十五章「M4 落地后的组件与收敛记录」——①**M4 实际新增的组件**（实现名 + 落点 + props，含表格六个、版本两个、回收站两个）；②**界面稿 §十一 约定的 11 个组件逐条对账**：4 个按代码回写（props 名/形态有差，差异与理由逐条写）、**7 个"未独立成组件"**（职责落在既有组件里，拆出去会引入共享状态或空壳）；③**§十二 预留表的处置**：`VersionHistoryPanel` / `VersionDiff` / `TableColumnManager` / `AttachmentUploader` 等已实现的行标「M4 已实现，见 §15」；④**已知未实现 6 条**（拖动柄、标签 chip 编辑、自动降级提示条、版本列表"已保留 N 个"、附件引用集合对齐、`ConfirmDialog`/`InfoHint` 未做）；⑤明确 **`media.worker` 落点已删除**（缩略图浏览器端生成）。（应用版本 v0.4.25（M4 收口期间的写回；里程碑版本为 v0.5.0）；修改模型ID：deepseek-v4.1-flash） |
| v5 | 2026-09-29 | 功能栏**标签区贴底固定**回写【已定·用户确认 2026-09-29】：①第六章开头的"由上到下"与第四章结构树补上标签区（`TagGroup` 现在是 `.fnbar__tags`，**贴底固定、与导航区并列**，不再排在笔记本树之后）；②6.6 `TagGroup` 增「位置约束」（`flex:none`、在导航区与加密空间之间、**不在滚动区里**、高度按底部 1/4～1/3 预留）与「形态」（chip 横向铺开自动换行、放不下本区自己滚）两行。`DESIGN.md` §2.1 / §2.7 同步至 v1.8。（应用版本 v0.5.22；修改模型ID：deepseek-flash） |
| v6 | 2026-09-29 | 「添加」按钮改弹窗回写【已定·用户确认 2026-09-29】：①新增 **6.8 `AddEntryDialog` · 添加内容窗口**（一个 `Modal` 结构两种 `kind`、字段复用 `Composer` 的 `ModeExtras`/`TASK_ITEM_PATTERN`、发布回调复用 `fnbarWiring`、关窗先清空再 `onClose`）；②组件地图 FnBar 子树补 `AddEntryDialog`（文件在 `app/fnbar/`，由 App 经 `AddEntrySlot` 挂浮层位，**不在 FnBar 内渲染**）；③6.2 `Composer` 的「复用」行改为——「添加」**不再切 `mode`、不再聚焦**，改开 `AddEntryDialog`（`Composer` 仍须导出 `ModeExtras`/`TASK_ITEM_PATTERN` 作共享件；`mode` 仍由首页「记录 Memo / 新建待办」快捷操作外部驱动）。（应用版本 v0.5.26；修改模型ID：mimo-v2.6-flash） |
| v7 | 2026-09-29 | 编辑拓展专项（阶段 A–C = v0.6.0 / v0.6.1 / v0.6.2）回写 **`Editor` 与 `DocModeSwitch` 的档位契约**【已定·用户确认 2026-09-29】：①7.2 的 `DocModeSwitch` 改为**只列设置里开着的档**、三档为 `仅编辑` / `仅预览` / `即时渲染`（顺序 `edit → preview → live`），**`分屏` 已从产品移除**（阶段 A / v0.6.0）；②`Editor` 行写明契约——档位不是 `Editor` 的 prop，`live?` 即"即时渲染"开关（与「仅编辑」共用同一个编辑器实例，走 `Compartment` 重配置、**不重建文档**），`readOnly?` 是**内部能力**（仅预览 / 锁定态复用）、**不是用户可见档位**，阅读态由「仅预览」承担；③7.2 不变量补「表格在即时渲染与编辑下都保持源码」。`DESIGN.md`（v1.11）、`wiki/Menote-设计文档-v7.4.md`（内部 v7.5.5）、`wiki/Menote-功能拆解-v2.md`（v2.11）同批回写。（应用版本 v0.6.2；修改模型ID：deepseek-v4.1-flash） |
| v8 | 2026-10-02 | 笔记本「添加」菜单加「导入笔记」【已定·用户确认 2026-10-02】：①`NbAddButton` 菜单由两项增至三项（**新建文件夹 / 新建表格 / 导入笔记**），触发器无障碍名同步列出三项；②**新建表格自此可用**——M4 交付了表格编辑器与 `TableColumnManager` 的 `mode="create"`，但该模式**一直没有任何调用方**、菜单项还挂着"M5 提供"的过期理由，v0.6.16 接线（先定列结构再建条目）；③新增 **`ImportNotesFlow`**（落 `features/notes/ui/`）：隐藏的文件选择器（可多选 `.md`）+ **多选时的一次确认**（报"几个文件 → 哪个笔记本"）+ 失败清单弹窗（`DESIGN.md` §5.4-2：错误必须保持可见，不用会自动消失的 Toast 承载）；④新增 `import-md.ts`（纯逻辑：文件名→标题、剥 UTF-8 BOM、按正文派生 `type` / 标签 / 待办字段）与 `emptyTableDoc()`（`features/tables/model.ts`）。（应用版本 v0.6.16；修改模型ID：MiniMax-M3.1-Flash-Preview） |
| v12 | 2026-10-03 | **M7 定时自动备份回写**【已定·用户确认 2026-10-03 拍板 §六 五点】：新增 **7.9 定时自动备份** 一节，登记 `BackupTargetsCard`（设置 › 备份页**第一张卡**——这一屏叫「备份」而不叫「导出」；每行一个启用 `role="switch"` 与三个次操作**测连接 / 编辑 / 推一次**；删除走行内二次确认且**后果平铺那句"远端文件一个都不会动"**）、`BackupTargetDialog`（新建 / 编辑**两态合一**，`dismissable={false}`）、`features/backup/model.ts`（纯函数）、以及**单独一个 `data/api/backup-targets.ts`**（`endpoints.ts` 已 489 行、`max-lines` 的 500 硬上限就在眼前）。记下四条贯穿口径：**凭据 label 必须写清「留空 = 不改」**且编辑时**不送 `secret` 键**、删除走行内确认 + 后果平铺、读失败不写空态、**失败原因与推送结果都平铺**（三处都不进 `InfoHint`、不靠 Toast）。**零新增 CSS**。记明**未做**：浏览器循环 + 进度条 + 中断续传（见《功能拆解》M16-03）。（应用版本 v0.8.0；修改模型ID：MiniMax-M3.1-Flash-Preview） |
| v13 | 2026-10-04 | **设置页信息架构 11 → 9 类**【已定·用户确认 2026-10-04】：改 §7.5 `SettingsPanel` 四行——**分类清单 11 → 9**（**「编辑器」「关于」不再是独立分类**、内容并进「通用」；原「数据管理」改名**「附件」**，**路由 id 仍是 `data`**）、**卡片装配**去掉 `cardEditor` / `cardAbout` 两个独立分类卡（改挂在「通用」页内）、**页头删掉「分类总数」**、**通用页由两张卡变四张卡**并新增**作用域标记 `.scope-tag`**。组件树里 `SettingsPanel` 那行同步改为「9 分类」。记下三条口径：①**撤销的分类要显式重定向**（`LEGACY_SETTINGS_PAGES`）——只从 `SETTINGS_PAGES` 拿掉会被 `parseRoute` 那句"匹配不到就回落 `general`"**自动**接住，表现与 2026-09-27 修过的 bug **完全同形**；②**作用域标记复用 `.badge` 的视觉但不复用它的 `margin-left: auto`**（那条是给行尾用的，与"紧跟设置项名称"的定位目的不同），且**不进 `InfoHint`**（作用域是标识、不是说明性文字），对读屏 `aria-hidden`；③**新组件 `GeneralCards.tsx`**（`features/settings/ui/`）——`EditorModesCard` + `AboutCard` + `ScopeTag`，因搬迁后 `SettingsPanel.tsx` 触发 `max-lines` 的 500 硬上限而抽出，它重新只管**分类与版式**。决定与影响面见 `docs/modules/Menote-M8-设置页信息架构-v1.md` v1；功能侧同步见《功能拆解》v2.16。（应用版本 v0.8.4；修改模型ID：MiniMax-M3.1-Flash-Preview） |
| v11 | 2026-10-03 | **M6 MCP 回写**【已定·用户确认 2026-10-03】：新增 **7.8 MCP** 一节，登记设置 › MCP 的三个组件与 `model.ts`——`McpSettingsPage`（地址 + 接入说明 + 令牌列表；**地址 = `origin + /mcp`，不新增接口**；接入说明做成**按需展开的弹窗**而不是平铺的一屏灰字）、`CreateTokenDialog`（填写 → 已创建**两态原地切换**；**完整令牌不落任何本地存储**，且已创建态**不允许点遮罩关闭**——它只在这一刻可见）、`TokenAuditDialog`（**不是行内展开**：90 天记录会让每个令牌行高度暴涨）。记下四条贯穿口径（实时计数可见 / 读失败不写空态 / 破坏性与一次性凭据的后果都平铺 / **状态随挂载初始化而非 effect 重置**）与四处界面期确认。**零新增 CSS**，全部用既有件；界面稿 `docs/modules/Menote-M6-MCP-设置页-设计-v1.md` v1.1 是本节权威。（应用版本 v0.7.0；修改模型ID：MiniMax-M3.1-Flash-Preview） |
| v10 | 2026-10-03 | **M6 第一批回写**【已定·用户确认 2026-10-03】：新增 **7.7 附件** 一节，登记 M6 补齐的两个组件——RemoveAttachmentRefDialog（移除附件引用弹窗，入口在笔记「更多」菜单；**「选中后常驻小工具条」那个辅助入口未做**，理由是要给 CodeMirror 加选区上报而 EditorHandle 没有该接口）与 AttachmentManagerPage（设置 › 数据管理 › 附件管理页，四块 + 三种空态）。同时记下两条贯穿口径：**移除引用 ≠ 删除文件**（界面必须说清，30 天口径收进 InfoHint）、**隐私条目的附件照常显示**（附件明文存储，门禁只在正文层）。另记 M4 留下的接口缺口：「列出所有附件」的接口此前不存在，2c 新增 GET /api/attachments。（应用版本 v0.6.22；修改模型ID：MiniMax-M3.1-Flash-Preview） |
| v9 | 2026-10-03 | **M5 分享收口回写**【已定·用户确认 2026-10-03】：新增**第十六章「M5 落地后的组件与收敛记录」**——①M5 实际新增三个组件（`ShareDialog` / `MySharesPage` / `ShareViewerApp`）的落点与关键约定，含**查看器由 `main.tsx` 按 `/s/<sid>` 动态 import、不是独立 html 入口**（原定 `share.html` 因 `@cloudflare/vite-plugin` v1.60 报 `UNRESOLVED_ENTRY` 未采用）；②查看器与既有组件的**渲染契约**（复用 `MarkdownPreview`、DOMPurify 的 `allowBlobUris` 只放行本会话取回的 object URL、只读表格直接复用 `TableGrid` / `GalleryView` 不另写一套）；③**订正 §十五.3 第 6 条**——`InfoHint` 已实做于 `app/ui/InfoHint.tsx`（原记「未做、说明文字用可见 `hint-line`」是过期事实）；④**修两处断链**：6.8 `AddEntryDialog` 的「原型 / 需求」两行原指向已归档的 `…-设计-v1.md`，改指 `…-v2.md`；⑤登记 M5 三项已知未实现（Memo 合集 UI、访客侧筛选排序、移动端观感）。（应用版本 v0.6.17；修改模型ID：MiniMax-M3.1-Flash-Preview） |

---

## 一、这份文档管什么

**一句话**：本文回答「前端有哪些组件、各自归谁、负责什么、对外契约是什么、能怎么复用」。它不回答「长什么样」（那是 `DESIGN.md`），也不回答「功能对不对」（那是需求文档与功能拆解）。

三份文档的边界：

| 问题 | 看哪里 |
|---|---|
| 这个功能该不该有、规则是什么 | 需求文档 `wiki/Menote-设计文档-v7.4.md` + 功能拆解 `wiki/Menote-功能拆解-v2.md` |
| 界面长什么样（颜色、字号、间距、圆角、组件用法、禁止项） | `DESIGN.md`（唯一视觉源）+ 原型 |
| 有哪些组件、放哪个目录、props 怎么定、能怎么复用 | **本文** |
| 数据存哪、接口怎么调、同步怎么走 | 架构文档 |

冲突时的优先级（与架构 §2.3.4 一致）：功能与规则看需求文档，长什么样看 `DESIGN.md` 与原型，某一屏的结构看 `docs/modules/`，**组件的落点与契约看本文**。本文与架构 §2.3.2 冲突时以架构为准并回报本文。

**本文的更新时机**：原型新增 / 删除区块、组件改名、新增可复用控件、落点从 `app/` 与 `features/*` 之间迁移时，本文与 `DESIGN.md` 同步更新。纯样式微调（改颜色、改间距）不进本文。

---

## 二、读法与命名约定

### 2.1 组件命名

- 组件名用 **PascalCase**，语义取自**功能拆解里的功能点用词**，不自造近义词。例：功能拆解说「快速录入框」，组件就叫 `Composer`，不叫 `QuickInput`。
- 原型里的 class / id 是**样式与原型标识**，不做组件名（`.nav-seg` 对应的组件叫 `NavSegmented`，不叫 `NavSeg`，避免和 CSS 类撞概念）。
- 一个组件对应原型里一处**稳定的界面元素**；原型中重复出现 3 次以上的同类结构，抽成通用控件进第八章。

### 2.2 落点规则

| 落点 | 放什么 | 判定标准 |
|---|---|---|
| `apps/web/src/app/` | 布局骨架、顶栏、功能栏、导航、主题、**跨 feature 的公共组件**（`app/ui/`） | 被 2 个以上 feature 使用，或属于「应用外壳」 |
| `apps/web/src/features/<x>/ui/` | 该 feature 私有组件 | 只服务本 feature |
| `apps/web/src/features/<x>/model.ts` | 该 feature 的状态与动作 | 与 `ui/` 两件套，见架构 §2.3.2 |
| `apps/web/src/data/` | Dexie 模式、仓储、outbox、同步引擎 | **不是组件**，但组件的数据来源全在这里 |
| `apps/web/src/crypto/` | 隐私门禁与备份导出加密 | 同上，不是组件 |

**硬规则**（架构 §2.3.2 / §2.3.3）：feature 之间**禁止互相 import**；跨 feature 复用只能走 `app/ui/` 或 `data/`。组件层不得直接访问 Dexie 或网络，必须经应用服务层（架构 §3.1）。

### 2.3 props 约定通则

1. **状态归属**：数据的唯一真相是本地 IndexedDB（Dexie `liveQuery` 订阅）；`Zustand` 只放**纯界面状态**（当前视图、面板开合、选中项），不放业务数据（架构 §3.1）。
2. **受控优先**：输入类一律受控（`value` + `onChange`），不接受非受控 `defaultValue`，避免自动保存与同步状态判断失真。
3. **事件命名**：`on<动作>`（`onPublish`、`onUnlock`、`onPickMode`），动作名用功能点的动词，不用 `onClick` 这类泛名。
4. **不做隐式请求**：组件不自己发请求、不自己开解锁框；需要副作用时由 `model.ts` 的动作函数完成，组件只发意图。
5. **枚举不用裸字符串**：模式类取值（`composerMode`、`tableMode`、`memoView`、`taskView`、`editorMode`、`theme`）统一走 `packages/shared` 的常量与 Valibot schema，组件内不写字面量。

### 2.4 组件状态三分

原型用一个内存 `state` 对象承载全部状态。实现时必须拆成三类，**不要照搬一个 store**：

| 类别 | 例子 | 归属 |
|---|---|---|
| 数据真相 | 条目、文件夹、Memo、待办、版本、回收站 | Dexie + `liveQuery` |
| 纯界面状态 | `fn`（当前视图）、`folder`、`tag`、`activeId`、`setPage`、`memoView`、`taskView`、`tableMode`、`editorMode`、`drawerId` | Zustand |
| 全局门禁状态 | `locked`、`timeoutMin`、`privacyBrowse`、`remaining` | `features/privacy/` + `crypto/keystore.ts`；**全局唯一一份**（需求 M06-08 / Q5） |
| 持久化偏好 | `theme`、`startView`、`quickMenu` | 设置项，落本地库后同步（§7.5） |

---

## 三、组件地图（总览）

```
AppShell                                    app/
├─ Topbar                                   app/topbar/            —— 6 块，死约束，见第五章
│  ├─ BrandLogo / Breadcrumb                app/topbar/
│  ├─ SearchBox                             app/topbar/            → features/search/ 提供结果面板
│  ├─ SyncPill                              app/topbar/
│  ├─ PrivacyCapsule                        app/topbar/            → features/privacy/ 提供档位菜单
│  └─ AccountEntry → AccountQuickMenu       app/topbar/            —— 第 6 块，点击弹菜单
├─ FnBar                                    app/fnbar/             —— 见第六章
│  ├─ NewNoteButton
│  ├─ Composer (+ ModeTabs / Extras / PublishButton)
│  ├─ NavSegmented                          —— 浏览三段
│  ├─ NavList (NavItem ×2)
│  ├─ NotebookGroup (+ FolderTree / NbAddButton)
│  ├─ TagGroup (TagChip ×n)                       —— 贴底固定（第六章 6.6）
│  ├─ VaultNode                             —— 贴底固定
│  └─ AddEntryDialog                        —— 添加内容窗口；文件在 `app/fnbar/`，但由 **App 经 `AddEntrySlot` 在浮层位挂载**（不在 FnBar 内渲染，见 6.8）
└─ WorkArea                                 app/
   ├─ ListPane  → ItemRow ×n                features/<x>/ui/
   ├─ DocPane   → DocHead / DocBody / DocStatusBar
   └─ Drawer                                app/ui/                —— 能力保留，不由列表触发

视图（进 DocPane / ListPane）
├─ HomePanel          features/home/
├─ MemoPanel          features/memos/       —— 时间轴 / 瀑布流
├─ TaskPanel          features/tasks/       —— 列表 / 看板
├─ TablePanel         features/tables/      —— 表格 / 图册
├─ SearchPanel        features/search/
├─ VaultPanel         features/privacy/     —— 锁定 / 解锁两态
├─ TrashPanel         features/settings/    —— 设置子页面
└─ SettingsPanel      features/settings/    —— 两栏分页，9 分类（v0.8.4 起）
```

---

## 四、布局骨架层 `app/` 【已落地】

| 组件 | 落点 | 原型 | 职责 | 关键 props |
|---|---|---|---|---|
| `AppShell` | `app/AppShell.tsx` | `.shell` / `.body-row` | 全宽顶栏 + 左右两栏的骨架；高度 100vh、不整页滚动 | `children` |
| `Topbar` | `app/topbar/Topbar.tsx` | `.topbar` | 顶栏容器，**固定 6 块**，左右顺序不可调 | `crumbs`、`syncState`、`lockState`、`account` |
| `WorkArea` | `app/WorkArea.tsx` | `.work` | 主操作区容器，承载列表 / 正文 / 侧滑三层 | `view`、`list`、`doc`、`drawer` |
| `ListPane` | `app/ListPane.tsx` | `.pane-list` | 左列（宽走 `--list-w`）；`wide` 变体占满（搜索结果用）、`hidden` 变体整块隐藏 | `width?: 'default' \| 'wide'`、`hidden?` |
| `DocPane` | `app/DocPane.tsx` | `.pane-doc` | 右列容器；`center` 变体用于空 / 锁定占位的居中布局 | `center?`、`children` |
| `PaneHead` | `app/ui/PaneHead.tsx` | `.pane-head` | 视图头：`h1` + `sub` + 右侧 `actions`。**说明性文案收进 `InfoHint`（ⓘ）**，见 `DESIGN.md` | `title`、`subtitle`、`actions` |
| `PanePad` | `app/ui/PanePad.tsx` | `.pane-pad` | 内容区统一内边距容器 | `children` |

**不变量（改动前必读）**：

- 顶栏 6 块是**死约束**，原型验证脚本对此有断言。顺序：品牌 · 面包屑 · 搜索框 · 同步胶囊 · 隐私锁胶囊 · 账户与设置。
- 层级关系：`AppShell` → (`Topbar` + `WorkArea`)；`WorkArea` → (`ListPane` + `DocPane` + `Drawer`)。`Drawer` 是 `WorkArea` 的绝对定位子层，不是 `DocPane` 的子层。

---

## 五、顶栏 `app/topbar/` 【已落地】

顶栏 6 块，从左到右不可增减、不可重排。

### 5.1 `BrandLogo`
| 项 | 内容 |
|---|---|
| 原型 | `.brand` / `.logo` |
| 职责 | 品牌标记（方块 logo + 文字），纯展示不可点 |
| 约束 | logo 底色是**渐变**（`linear-gradient`），其中的颜色**不会**被 `DESIGN.md` 的禁蓝正则扫到，换主题时要手工核对 |

### 5.2 `Breadcrumb`
| 项 | 内容 |
|---|---|
| 原型 | `.crumb`（`#crumb`） |
| 职责 | 当前视图路径。`笔记本 / <文件夹名>` 时文件夹名加粗；标签视图显示 `# 标签名`；搜索时显示「搜索结果」 |
| props | `parts: Array<{ text: string; bold?: boolean }>` |
| 复用 | 由 `app/` 的视图路由层统一计算，不在各视图内自己拼 |

### 5.3 `SearchBox`
| 项 | 内容 |
|---|---|
| 原型 | `.search-wrap`（`#searchInput`，内含 `kbd` 提示） |
| 职责 | 顶栏搜索输入；聚焦即进搜索视图，清空则**回到进入搜索前的视图**（原型 `searchedFrom`） |
| props | `value`、`onChange`、`onFocus`、`placeholder` |
| 快捷键 | Ctrl+K / Cmd+K（macOS）。快捷键在 `app/` 层全局注册，**不在 `SearchBox` 内**——原型放在 document 级 `keydown` |
| 落点提示 | 组件在 `app/topbar/`，但结果面板 `SearchPanel` 在 `features/search/` |

### 5.4 `SyncPill`（同步状态胶囊）
| 项 | 内容 |
|---|---|
| 原型 | `.pill`（`#syncPill` / `#syncText`），变体 `.pill.ok` / `.pill.busy` |
| 职责 | 顶栏级同步状态：`已同步` / `上传中 N` / 离线提示 |
| props | `state: 'ok' \| 'busy' \| 'err'`、`queueLength?: number` |
| 需求 | M02-06（§1.4、§15.3）。队列为空时不显示计数 |
| 数据来源 | `data/sync/` 的 outbox 长度（架构 §6.3） |

### 5.5 `PrivacyCapsule`（全局隐私状态胶囊）
| 项 | 内容 |
|---|---|
| 原型 | `.capsule`（`#lockCapsule` / `#lockTimer`），变体 `.locked` / `.unlocked` / `.danger` / `.blink` |
| 职责 | 全局唯一的锁状态显示。点已锁定时直接开解锁框；点已解锁时弹**解锁档位菜单**（`tierMenuHtml`） |
| props | `locked`、`timeoutMin`、`remaining`、`onUnlock`、`onPickTier`、`onLockNow` |
| 状态映射 | `locked` → `已锁定`（灰色锁形图标）；N 分钟档 → 琥珀色开锁图标 + `已解锁 · 4:32`（每秒刷新，**有操作则重置**）；本次会话档 → `已解锁 · 本次会话`（文字替代倒计时）；当前设备长期档 → **红（danger）** + `本设备始终解锁` + 警示角标（属降低安全性的状态）。**原「仅本次查看」档已作废**（2026-09-27，见 `docs/modules/Menote-隐私锁设计-v1.md` §9.2） |
| 需求 | M02-05、M08-12（§6.9）。未启用隐私锁时**整个胶囊不显示** |
| 关联 | 剩余 30 秒时加 `.blink` 并提示即将自动锁定（原型 `startTimer`） |

### 5.6 `AccountEntry` + `AccountQuickMenu`
| 项 | 内容 |
|---|---|
| 原型 | `#topAccount`（圆形头像）→ 复用 `.menu` 组件；菜单内容由 `quickMenuHtml()` 按 `quickMenu` 生成 |
| 职责 | 全站**唯一账户入口**，紧邻隐私胶囊右侧；**只显示头像、不显示用户名**（顶栏是紧凑条），`title` 里给提示 |
| **交互（易错点）** | 点击头像**弹出快捷菜单**，**不直达设置页**。菜单里「设置」是一项。此前一度定为“点击直接进设置、不弹菜单”，该写法**已作废**（功能拆解 M02-01 / M18-03） |
| 菜单结构（自上而下，固定） | 账户头（头像 + **三行文字**：用户名 / 角色 · 实例（如 `owner · 本地实例`）/ **版本号 `MeNote vX.Y.Z`**——后两行复用 `.acct__sub`，**不新增 CSS**）→ 分隔线 → **可配置功能项**（按 `quickMenu` 顺序）→ 分隔线 → `设置` / `退出登录`（固定底部，不在配置清单内） |
| 可配置功能项 | 5 项候选：`主题切换`（菜单内一排三档，**切完不收起菜单**）/ `立即锁定`（带状态：`解锁中` \| `已锁定`）/ `搜索` / `回收站` / `立即备份`。默认只开前两项 |
| props（Entry） | `user`、`onOpenMenu` |
| props（Menu） | `items: string[]`（`quickMenu`）、`theme`、`locked`、`onPick(id)`、`onThemeChange(theme)` |
| 需求 | M02-01、M18-03；配置入口在 设置 › 通用 › 快捷菜单 |
| 【待定】 | Q26：菜单里要不要放「新建」类动作 |
| 验证提示 | 断言账户入口必须**走菜单**：先点头像，再点菜单里的 `[data-qm="settings"]`；直接点 `#topAccount` 只是开/收菜单 |

---

## 六、功能栏 `app/fnbar/` 【已落地】

由上到下：**新建按钮 → 快速录入框 → 导航区（可滚动）→ 标签区（贴底固定、自己可滚）→ 加密空间（贴底不滚动）**（M02-02）。

### 6.1 `NewNoteButton`
| 项 | 内容 |
|---|---|
| 原型 | `.btn-new`（`#btnNew`） |
| 职责 | **一次点击**直达新建笔记并打开编辑器，**不弹类型菜单** |
| 落点 | 新笔记放**根目录**（即使当前正在某个文件夹中），默认标题「未命名笔记」，标题可在编辑器顶部标题栏直接改 |
| props | `onCreate()` |
| 需求 | M04-01（§7.4；落点为【暂定·用户确认 2026-09-26】Q24 部分） |
| 禁止 | 不提供加密选项（M04-02） |

### 6.2 `Composer` · 快速录入框
| 项 | 内容 |
|---|---|
| 原型 | `.composer`（`#composerInput` / `#composerExtra` / `#composerModes` / `#composerPublish`） |
| 职责 | 添加内容的**主入口**，三行结构，见下 |
| props | `mode`、`onModeChange`、`value`、`onChange`、`onPublish`、`taskMeta`、`onTaskMetaChange` |
| 复用 | Memo 视图与待办视图的「添加」按钮**不再切本组件的 `mode`、也不再聚焦本组件**，改为打开「添加内容窗口」`AddEntryDialog`（6.8）——该窗口**复用本组件导出的 `ModeExtras` / `TASK_ITEM_PATTERN`**，字段与本组件对应档一致，故本组件必须把这两者作为共享件导出。本组件的 `mode` 仍由功能栏模式切换与首页「记录 Memo / 新建待办」快捷操作外部驱动（M2-8） |
| 需求 | M06-01、M07-01、M04-01（§7.4、§8.7） |

三行结构（**顺序固定**）：

| 行 | 组件 | 原型 | 说明 |
|---|---|---|---|
| ① 输入区 | `ComposerInput` | `.composer textarea` | 多行，`min-height` 40px、`max-height` 180px |
| ② 模式附加项 | `ComposerExtras` | `.composer-extra`（内含 `.sw`） | 在模式行**之上**；**高 26px 固定、`nowrap`**；三档内容见下 |
| ③ 模式行 | `ComposerModeRow` = `ComposerModeTabs` + `PublishButton` | `.mode-row` > `.mode-tabs` + `#composerPublish` | 左模式切换、右发布按钮，**同一行**；原独立发布行 `.composer-foot` 已取消 |

三档的附加项内容：

| 模式 | 附加项（`.sw` 胶囊） | 发布按钮 `title` |
|---|---|---|
| `memo`（默认） | **空容器占位，不隐藏** | `Ctrl+Enter 发布到时间轴` |
| `task` | `截止 <日期>`（可切）+ 优先级 `高` / `中` / `低` | `Ctrl+Enter 发布为清单条目` |
| `note` | `首行作标题` + `根目录`（**无「加密」胶囊**，M04-02） | `Ctrl+Enter 新建并打开编辑器` |

**不变量（改动必查，原型验证脚本有断言）**：

1. `Composer` 总高 **136px**、`.nav` 顶部 **y = 252** 不变。切换模式**只换内容不换高度**，绝不推挤下方导航。附加项容器用「固定高度 + 不换行（超出横向滚动）」实现，**不得**用 `hidden` 让容器塌陷。
2. `ComposerModeTabs` 是**盒式分段控件**（外框 + 灰实底选中），与下方 `NavSegmented`（下划线页签）**必须保持明显区分**——两者上下相邻，改任一方都要重新确认这个区分还在。详见 6.3。
3. 发布按钮是 `type="button"`；Ctrl+Enter / Cmd+Enter 发布，快捷键提示写在按钮 `title` 上，**不占单独一行**。

### 6.3 `NavSegmented` · 浏览三段
| 项 | 内容 |
|---|---|
| 原型 | `.nav-seg`（`#navSeg`）> `.seg-item` ×3（`#navHome`、`data-fn="memo"`、`data-fn="task"`） |
| 职责 | 首页 / Memo / 待办三项视图跳转，合成一行 |
| 造型 | **下划线页签**：无外框、无底色；选中态 = 主色文字 + `::after` 主色下划线 |
| props | `items: Array<{ key, label, icon }>`、`activeKey`、`onSelect` |
| 需求 | M02-02（Q1 已确认）。三项**保留原名**、**不显示条目计数**（纵向占用从约 104px 降到 30px） |
| 显隐 | `首页` 项受启动视图控制：未选首页时该项**不显示**，其余两项弹性等分（原型 `syncStartView`） |

### 6.4 `NavList` / `NavItem`
| 项 | 内容 |
|---|---|
| 原型 | `.nav`（`#fnNav`）> `.nav-item`（`recent`、`starred`） |
| 职责 | 普通导航项：最近编辑、收藏 |
| props（Item） | `icon`、`label`、`count?`、`active`、`onClick` |
| 造型 | 盒式选中（`--primary-soft` 底 + 主色文字），与 `.seg-item` 的下划线造型不同 |

### 6.5 `NotebookGroup`（笔记本 + 文件夹树）
| 项 | 内容 |
|---|---|
| 原型 | `.group` > `.nb-head`（`.nav-item[data-fn=notebook]` + `#nbAdd`）+ `.tree`（`#folderTree`） |
| 职责 | 笔记本节点 + 其下的文件夹树；节点**保留计数**（`.count`） |
| `NbAddButton` | 原型 `#nbAdd`。笔记本节点右侧 `+`，弹菜单：**新建文件夹 / 新建表格 / 导入笔记**（后两项 v0.6.16：新建表格自 M4 交付表格编辑器后接线，导入笔记为多选 `.md`）。表格与文件夹的新建入口**只在这里**（表格不进快速录入框）。触发器的无障碍名**列出它管的三项**，不叫「新建」了事 |
| `FolderTree` / `FolderNode` | 最多两层嵌套；`data-toggle` 行控制子级展开（`.chev.open` 旋转 90°）；第二层**不提供**「新建子文件夹」入口 |
| props（Node） | `name`、`depth`、`expanded`、`active`、`children?`、`onToggle`、`onSelect` |
| 需求 | M03-01、M03-02、M05-01（§4.5、§7.4） |

### 6.6 `TagGroup` / `TagChip`
| 项 | 内容 |
|---|---|
| 原型 | `.group` > `.group-title` + `.tags` > `.chip.tag` |
| 职责 | 功能栏里的标签列表，点击进标签视图 |
| **位置约束** | 在 `.fnbar__tags`（`app/fnbar/TagGroup.tsx`）里，`flex:none` + 上分隔线，**贴底固定**——位置在**导航区与加密空间之间**，**不在 `.fnbar__scroll` 滚动区里**（树再长也推不动它）；高度按「功能栏底部约 **1/4～1/3**」预留（实现取 `height:28%` + `min-height:120px`）。【2026-09-29 起，用户要求"标签区不要被笔记本里的内容推挤"】 |
| 形态 | 标签用 **chip 按钮横向铺开、自动换行**（`.tags` 必须 `flex-wrap:wrap`），**不排成一列**；放不下时**本区自己滚**——它与导航区是**并列的两段、互不嵌套**，`DESIGN.md` §2.7「每层一个滚动容器」在功能栏这一层即"两个互不嵌套的固定段各自可滚" |
| 注意 | `标签` 的 `.group-title` **保留**（只有「加密空间」不设分组小标题） |
| 已知后果 | 标签视图**只含笔记与表格，不含 Memo**（Q8 已确认）。点 Memo 上的标签胶囊时【建议】在时间轴内按标签筛选，而不是跳标签视图 |

### 6.7 `VaultNode` · 加密空间
| 项 | 内容 |
|---|---|
| 原型 | `.fn-vault` > `.nav-item.vault-node`（`#vaultNode`，含 `.lock-ic` 与 `.tagline`） |
| 职责 | 加密空间**入口**（三态）：未启用 → 引导启用；锁定 → 打开解锁框；解锁 → 进入空间视图 |
| **位置约束** | 在独立 `.fn-vault`（`app/fnbar/VaultNode.tsx`）里，`flex:none` + 上分隔线，是 `.fnbar` 的最后一段，**贴底固定、不随滚动区滚动**；**不设分组小标题**；**不在功能栏展开任何树**【2026-09-29 起】 |
| props | `enabled`、`locked`、`count`、`onOpen`、`onUnlock`、`onEnable` |
| 交互 | 锁定时点击 → 打开解锁框（不直接进空间）；解锁后点击 → 把笔记区切到加密空间视图 |
| **空间内文件夹树** | `features/privacy/ui/VaultTree.tsx`：渲染在**加密空间视图的列表列顶部**（在该列已有的滚动容器里，`DESIGN.md` §2.7），切层 / 新建 / 重命名都在那里。**2026-09-29 从功能栏搬来**（用户要求"加密空间不需要在功能栏显示文件夹树"）；`FolderTree` 用 `rootId`（空间根 id）认根——空间内第 1 层文件夹的父是空间根行，不是 `null` |
| 需求 | M08-07（§6.3） |

### 6.8 `AddEntryDialog` · 添加内容窗口
| 项 | 内容 |
|---|---|
| 原型 | 无（**新增**；设计见 `docs/modules/Menote-添加内容窗口-设计-v2.md`） |
| 落点 | `app/fnbar/AddEntryDialog.tsx`；装配在 `app/AddEntrySlot.tsx`（`useAddEntrySlot`），由 **App 挂在浮层位**渲染（**不在 FnBar 内**） |
| 职责 | Memo / 待办视图「添加」的落点：**单独弹窗**录一条 Memo 或待办，点「发布」→ 调发布回调 → 关窗 → toast + 列表立刻刷新（**给明确反馈**）。**不再跳回左侧录入框**【2026-09-29 用户要求】 |
| 形态 | 一个 `Modal` 结构、两种 `kind`（`memo` / `task`）——「不同类型复用一个窗口结构，但显示的设置不同」（用户 2026-09-29） |
| 字段 | 正文 `<textarea>`（`Ctrl/Cmd+Enter` 发布）+ 字段行 `.addentry__extras`（高 26px、`nowrap`，同 `Composer`）；`kind = "memo"` → 含 `- [ ]` 时给「设为清单？」chip；`kind = "task"` → 截止（date）+ 优先级三段。**字段与录入框 `Composer` 对应档一致，复用其 `ModeExtras` / `TASK_ITEM_PATTERN`，不另抄第二套判定** |
| props | `open`、`kind`、`onClose`、`onPublishMemo`、`onPublishTask` |
| 发布回调 | 复用 `fnbarWiring` 的 `onPublishMemo` / `onPublishTask`（与录入框**同一口径**）；`publishMemo` 会 `await refresh()`，故关窗后新条目**立刻出现在当前列表** |
| 关闭 | 点「发布 / 取消 / Esc / 点遮罩」都走组件内 `close()`——**先清空字段、再 `onClose()`**（清空在事件处理器里做，不在 effect 里 `setState`），保证下次打开是干净输入区 |
| 需求 | M06-10、M07-01（入口二）；设计 `docs/modules/Menote-添加内容窗口-设计-v2.md` |

---

## 七、主操作区与视图 `features/*` 【已落地】

### 7.1 `TwoPane` 与 `ItemRow`

| 组件 | 落点 | 原型 | 职责 |
|---|---|---|---|
| `TwoPane` | `app/ui/TwoPane.tsx` | `TWO_PANE` 常量 | 记录类视图统一布局：左列条目列表 + 右列阅读编辑，**点条目在右列直接打开** |
| `ItemListHead` | 各 feature `ui/` | `vaultListHead()` | 列表头上的文件夹 chip 等（加密空间用，明文） |
| `ItemRow` | `app/ui/ItemRow.tsx` | `.item-row`（`.item-lead` / `.item-body` / `.item-title` / `.item-snippet` / `.item-foot`） | 条目行：类型图标、置顶标记、标题、摘要、标签胶囊、同步状态、加密标识 |
| `EmptyDocPanel` | `app/ui/` | `emptyDocPanel()` | 右列未选中时的占位 |
| `ListGuide` | `app/ui/` | `.guide`（`#guideBar`） | 原型演示用引导条，**正式实现删除**（第十二章登记） |

**适用范围**：`笔记本` / `加密空间` / `最近编辑` / `收藏` / `标签` 五个视图**同构**。active 判定 = 当前 `fn` 在 `TWO_PANE` 集合内（`item-row.active` 带左侧 2.5px 主色竖条）。

**需求**：M03-06、M03-07（§7.4；双栏形态为 Q8 / 用户确认 2026-09-26）

### 7.2 `DocPanel` 与子组件

| 组件 | 原型 | 职责 |
|---|---|---|
| `DocHead` | `.doc-head`（`.doc-title` + `.actions`） | 标题（可直接编辑）+ 右侧操作区。**正文头只有模式切换 + 「更多」菜单**（`#docMoreBtn`），其余操作全部收进更多菜单 |
| `DocModeSwitch` | `#docMode`（`.seg`） | **只列设置里开着的档**（`editor_modes`）：三档为 `仅编辑` / `仅预览` / `即时渲染`（显示顺序 `edit → preview → live`），**`分屏` 已从产品移除**（阶段 A / v0.6.0）。原型那条 `#docMode` / `ed-body` 的 `mode-split` 未同步，按本行口径实现 |
| `DocMoreMenu` | `.menu`（`#docMoreBtn` 触发） | 菜单项按类型区分：`加密此笔记`/`加密此表格`、`移动到…`、`版本历史`、`分享`、`收藏`、`删除`；**表格**多一项`降级为普通笔记` |
| `Editor`（CodeMirror 6 封装） | `.ed-body` / `.ed-pane` / `#edSource` / `#edPreview` | 公共编辑器组件，**落 `app/editor/`**（架构 §2.3.2）。与档位相关的 props：`live?`（即时渲染开关）与 `readOnly?`（只读，**内部能力**）；其余 props（`initialValue` / `onChange` / `onReady?` / `onFiles?` / `onSlashQuery?` / `onLifecycle?` / `className?` / `ariaLabel?`，见 §15 与代码）。**档位不是 `Editor` 的 prop**：产品只有三档（仅编辑 / 仅预览 / 即时渲染，"显示哪几档"由 `NoteWorkspace` 按 `editor_modes` 决定，见 `DocModeSwitch`）；`live` 是**即时渲染**这个开关（走 `Compartment` 重配置，与「仅编辑」互切**不重建文档**）；`readOnly` 是**内部能力**（仅预览 / 锁定态复用），**不是用户可见档位**；`split` 已从产品移除 |
| `MarkdownPreview` | `.md` | 预览渲染。渲染与安全按架构 §3.4（需 sanitize，禁裸 `innerHTML`） |
| `DocStatusBar` | `.doc-status` | 底部状态栏：同步状态（`sync-tag`）、**加密状态 + 倒计时 + 立即锁定**、字数、大小（`size-tag`）。**加密状态条与尺寸提示条已并入此栏**，不再各占一条 |
| `LockedDocPanel` | `lockedDocPanel()` / `docHeadOnly()` | 单篇加密 + 已锁定：标题保持明文可读，正文与附件不渲染，给解锁按钮 |
| `VaultLockedPanel` | `vaultLockedPanel()` | 加密空间锁定：整块占位，列表区 `hidden`，不显示条目 |

**需求**：M04-03、M04-04、M04-05、M04-08、M08-12（§7.1、§12.1、§10.10、§6.9）

**不变量**：
- 正文区只有**正文头 + 底部状态栏**；加密用标题旁**锁形标识**（`.enc-mark`），加密状态/倒计时/立即锁定在状态栏。
- 硬上限 1,900,000 字节时阻止保存；软上限 1 MB 时仅变色提示。颜色走令牌（`--amber` / `--red`）。
- 即时渲染（`live`）的语法覆盖与交互细则【后续定】（§后续清单 8）；它与「仅编辑」共用**同一个编辑器实例**（`live` 走 `Compartment` 重配置，撤销历史与光标不丢）。
- **表格在即时渲染与编辑下都保持源码**（表格的就地编辑 / 锁定浏览另立设计）。
- `readOnly` 是 `Editor` 的**内部能力**（仅预览 / 锁定态复用），**不新增**只读即时渲染入口；阅读态由「仅预览」承担（用户确认 2026-09-29）。

### 7.3 内容类视图

| 视图 | 落点 | 原型 | 关键子组件 |
|---|---|---|---|
| `HomePanel` | `features/home/` | `homePanel()` | `StatCards`（`.home-stats` / `.home-stat`）、`TodayTasks`（`.home-list` / `.home-locked`）、`RecentActivity`、`ShortcutGrid`（`.home-acts` / `.home-act`）、`QuickNav`（`.home-nav`） |
| `MemoPanel` | `features/memos/` | `memoPanel()` | `MemoTimeline`（`.day-group` / `.day-head` / `.memo-item`）、`MemoWaterfall`（`.waterfall` / `.wf-card`）、`MemoItem`（`memoItemHtml`，含 `.memo-imgs`、`.memo-foot` 胶囊）、`LockedPlaceholder`（原 `MemoLockedPlaceholder`，收敛见 14.2 第 6 条） |
| `TaskPanel` | `features/tasks/` | `taskPanel()` / `tasksInner()` | `TaskListView`（`.task-list` / `.task-row` / `.checkbox`）、`TaskKanban`（`.kanban` / `.kb-col` / `.kb-card`）、`TaskFilterBar`（`.task-filters`）、`LockedPlaceholder`（原 `TaskLockedPlaceholder`，收敛见 14.2 第 6 条） |
| `TablePanel` | `features/tables/` | `tablePanel()` | `TableView`（`.tbl-wrap` / `table.data` / `.rowid` / `.cover-mini`）、`GalleryView`（`.gallery` / `.gal-card` / `.gal-cover`）、`FieldChip` |

**要点**：

- **Memo 与待办是两个独立视图**（Q1 已确认）。Memo → 时间轴 / 瀑布流，**无清单 tab**；待办 → 列表 / 看板。两者顶部各有「添加」按钮，点击**打开「添加内容窗口」弹窗**（6.8），不再切功能栏录入框模式。
- 首页数据**全由本地元数据计算，不发请求**；**统计始终计入**加密空间与单篇加密条目，不区分锁定（用户确认 2026-09-26）；来自 Memo 的部分在门禁锁定时显示「已锁定」（M02-03）。
- `MemoPanel` 与 `TaskPanel` 各有一个锁定占位（`.placeholder.boxed`），原型里是**两份形态相同的实现**（`MemoLockedPlaceholder` / `TaskLockedPlaceholder`，仅文案不同），收敛为**一个** `LockedPlaceholder`（文案作 props 传入）：**以实现名为准、只保留一个组件**，不两份并存；收敛去向见 14.2 第 6 条。
- 表格**第一列 `_id`** 是稳定行 ID（6–8 位 base36），编辑器默认隐藏。
- 图册与表格是**同一张 md 的两种渲染**（§10.8），视图是派生的，新增视图不改数据模型。
- 待办看板与列表是**纯视图**，不动数据模型；清单不是独立类型，是加在 Memo 上的标记（§9.1 / §9.4）。

**需求**：M02-03、M05-05~M05-08、M06-03、M06-04、M06-10、M07-05

### 7.4 隐私、搜索、回收站

| 组件 | 落点 | 原型 | 职责 |
|---|---|---|---|
| `UnlockModal` | `features/privacy/ui/` | `#unlockOverlay`（`.modal` / `.field` / `.field-err` / `.link`） | 隐私密码解锁框。文案须说明「隐私密码与登录密码是两个独立密码」。演示原型任意非空即可解锁 |
| `ResetPrivacyModal` | `features/privacy/ui/` | `#resetPwOverlay` | 重置隐私密码。**恢复码已废弃**（2026-09-26 模型修订）；文案如实说明「内容是明文存储的，重置不丢内容，只有已导出的旧备份需要旧密码」 |
| `TierMenu` | `features/privacy/ui/` | `tierMenuHtml()` | 解锁档位菜单（隐私胶囊触发）：**三档**（本次会话 / N 分钟 / 当前设备长期）+ 立即锁定。原「仅本次查看」档已作废（2026-09-27） |
| `VaultDocEmpty` | `features/privacy/ui/` | `vaultEmptyDoc()` | 加密空间解锁后未选中条目时的占位，含「保护边界」说明 |
| `SearchPanel` | `features/search/` | `searchPanel()` / `.sr-item` | 搜索结果列表；高亮用 `<em>`。**门禁过滤**：锁定时加密条目与 Memo 不参与搜索 |
| `TrashPanel` | `features/settings/ui/` | `trashPanel()` / `.trash-row` | 回收站是**设置子页面**，带「← 返回设置」按钮（返回时落回「版本与回收站」分类），不是功能栏独立入口 |

**需求**：M06-08、M08-03、M08-04、M08-05、M08-14、M09-01、M09-02、M12-02

### 7.5 `SettingsPanel` · 设置（两栏分页）

| 项 | 内容 |
|---|---|
| 原型 | `.set-wrap` > `.set-nav`（`#setNav`）+ `.set-pages`（`.set-page` / `.set-grid`） |
| 结构 | **左列分类导航 + 右侧当前分类内容**；**一次只渲染一个分类**（§7.5，功能拆解 M18-01） |
| 子组件 | `SetNav`（`.set-nav-item[data-set]`，含 `owner` 徽标）、`SetCard`（`.set-card` / `.set-head` / `.set-body`）、`SetRow`（`.set-row`）、`Toggle`、`RadioSet`（`.radio-opt` / `.radio-dot`）、`Field`、`KeyCap`、`WarnBox`、`BackupTargetCard`（`.bk-card`） |
| 分类（**9 个**） | 通用（**默认落地页**）/ 账户与安全 / 隐私锁 / 版本与回收站 / 备份 / 分享 / MCP / **附件** / 实例管理（带 `owner` 徽标）。**【v0.8.4，11 → 9】**「编辑器」与「关于」不再是独立分类、内容并进「通用」（分别是「编辑体验」卡与页面最底部的「关于 MeNote」卡）；原「数据管理」改名**「附件」**（它本来就只管附件占用与孤儿清理；**路由 id 仍是 `data`**，老书签与深链不失效）。除「通用」提到首位外，顺序同 §7.5 表。**撤销的两类由 `LEGACY_SETTINGS_PAGES` 显式重定向到「通用」**——不补映射的话 `#/settings/editor` 会走进"匹配不到就静默回落"，表现与 2026-09-27 修过的 bug 同形 |
| 卡片装配 | 按分类拆成 `cardGeneral` / `cardAccount` / `cardQuickMenu` / `cardPrivacy` / `cardMemoPrivacy` / `cardMcp` / `cardBackup` / `cardShare` / `cardVersion` / `cardData` / `cardInstance`，由 `setPageBody(id)` 装配。**【v0.8.4】**原 `cardEditor` 与 `cardAbout` 不再是独立分类的卡片，改挂在「通用」页内（前者作为「编辑体验」块、后者作为底部「关于 MeNote」块） |
| 页头 | 显示「分类名 · 简述」（简述收进 `ⓘ`）。**【v0.8.4】删掉「分类总数」**——那个数字对用户零信息量，且**随角色变化**（owner 10 / member 9）容易被误读成"漏了分类" |
| 通用页 | **四张卡**：`界面偏好`（启动视图 / 时区 / 主题 / 待办筛选条 / 笔记本树结构）＋ `编辑体验`（v0.8.4 由原「编辑器」分类搬来）＋ 快捷菜单配置 ＋ 最底部的 `关于 MeNote`。**【v0.8.4】每个设置项名称后带一个作用域标记**（`本机` / `跟随账号`，`.scope-tag`，对读屏 `aria-hidden`）——主题是设备级、其余是账号级，过去这个区别**只写在 ⓘ 悬停里**，用户对"我改完为什么另一台没变"毫无预期；作用域属**标识**不是说明性文字，所以**不进 `InfoHint`** |
| 状态 | 当前分类记在 `state.setPage`（界面状态，Zustand） |
| 验证提示 | 设置相关断言一律**先切分类再断言**（原型脚本用 `openSetPage(id)`）；不先切分类会拿上一分类的残留 DOM 蒙混过关 |

**需求**：M18-01、M18-02、M18-03、M02-04（§7.5）

**【v0.5.2 追加·用户确认 2026-09-27】通用页新增一行「待办筛选条」**：两档单选组
（`胶囊横排`＝基线 / `悬浮小组件`），对应契约 `UserSettings.task_view.filter_form`。
取值清单**只有一份**——`packages/shared/src/settings.ts` 的 `TASK_FILTER_FORMS`
（`v.picklist` 与设置页按钮都引用它），标签与说明留在 `SettingsPanel`（`Record<TaskFilterForm, …>` 收口，
漏一种形态 TypeScript 直接报错）。来源：线框定稿 07 待办"两种都保留，将来在设置里让用户自选"。

### 7.6 `Drawer` · 侧滑详情
| 项 | 内容 |
|---|---|
| 原型 | `.drawer`（`#drawer`，`openDrawer()` / `closeDrawer()`） |
| 状态 | **容器、样式、`openDrawer()`、`bindList(drawerMode)` 形参都在，但列表不再传 `true`** —— 能力保留、**不由条目列表触发** |
| 规划用途 | 「主操作区正在使用时临时查看条目属性」；未来可接的场景是表格图册的行详情（M05-08）与清单看板卡片（M07-05） |
| props | `open`、`item`、`onClose`、`onOpenInNotebook` |
| 落点 | `app/ui/Drawer.tsx`（跨 feature 复用） |
| 接入时机 | **等用户明确提出再接**，不要顺手打开 |

**【2026-09-27 用户拍板·已接一处】** 待办视图的详情浮层**已实现**，落点是
`features/tasks/ui/TaskDetail.tsx`（**没有**先做这里预留的跨 feature `Drawer`）：清单行标题与看板卡片标题
都可打开它，绝对定位盖在原界面上、**不铺遮罩、不推挤内容**，宽 390（≤1080px 330），`Esc` / × 关闭。
`Drawer`（`app/ui/Drawer.tsx`）**仍是预留**——按 §八 的"通用判定"（原型中被 3 处以上复用），
现在只有一个消费方，等表格图册的行详情（M05-08）也接上时再抽成通用的那个。
界定写进了 `DESIGN.md` §6.7：待办是单栏占满（§2.6），没有"右列直接打开"那条路，
所以禁止项 #15 针对的**双栏条目列表**与它不冲突。

### 7.7 附件（`features/attachments/ui/`）【M6-2b / 2c 新增】

M4 交付了附件的上传、元数据与孤儿清理，但**只做了接口与 Cron，没做界面**——《M4 设计》§3.6 把管理页明确留 M6。M6 第一批补齐最后两块。

| 组件 | 落点 | 职责与关键约定 |
|---|---|---|
| `RemoveAttachmentRefDialog` | `features/attachments/ui/RemoveAttachmentRefDialog.tsx` | 「移除附件引用」弹窗。入口在笔记**「更多」菜单**（M10-新 定的默认是「更多菜单为主 + 选中后常驻小工具条为辅」，**只落了前者**——后者要给 CodeMirror 加选区上报，`EditorHandle` 目前没有，代价大且属半成品）。按 **sha** 列出本篇正文当前引用的附件，**按 sha 选而不是按选区选**：不用把光标精确停在某张图上。**组件不改正文**，只把要删的那一段原文交回宿主，由宿主用 `EditorHandle.replace(marker, "")` 落进编辑器，视图与光标状态才和手删一致、保存链路也照走 |
| `AttachmentManagerPage` | `features/attachments/ui/AttachmentManagerPage.tsx` | 「设置 › 数据管理 › 附件管理」页（M10-03）。四块：**概览三数**（附件总数 / 占用空间 / 孤儿数；占用由列表客户端求和，**不另设接口**）、**列表**（缩略图、文件名、类型、尺寸、被多少条目引用、在用/孤儿）、**手动清理孤儿附件**（走既有 `POST /api/attachments/gc`，**二次确认写明不可撤销与空间释放**，清完重读列表）、**三种空态分开写**（一个都没有 / 有附件但没孤儿 / 筛选后为空） |

两条贯穿两者的口径：

1. **移除引用 ≠ 删除文件**。界面必须说清：只从这篇正文移除引用，文件本身要等到**没有任何地方引用满 30 天**才被孤儿清理带走。弹窗头部放**可见句**（后果要可见，`DESIGN.md` §5.4-2），30 天那条口径收进 `InfoHint`（§5.4-1 不许平铺）。**不提供**「删除附件文件」入口。
2. **隐私条目的附件照常显示文件名与预览**——附件按明文存储，门禁只在正文层，不要因为条目加密就把附件藏起来。

附带的接口缺口（M4 留下的）：**「列出所有附件」的接口此前不存在**（M4 只给了 `refs/:itemId` 与 `gc`），2c 新增 `GET /api/attachments`。

### 7.8 MCP（`features/mcp/ui/`）【M6 第三块新增】

M17 的令牌管理与审计在服务端做完后（v0.6.23 / v0.6.25），设置页这一屏是 M6 第三块最后一块（v0.6.26）。**界面稿 `docs/modules/Menote-M6-MCP-设置页-设计-v1.md` v1.1（生效）是本节的权威**，本文只登记组件与关键约定。**零新增 CSS**——全部用既有件。

| 组件 | 落点 | 职责与关键约定 |
|---|---|---|
| `McpSettingsPage` | `features/mcp/ui/McpSettingsPage.tsx` | 「设置 › MCP」页。**块 A**（MCP 地址＝`origin + /mcp`，**不新增接口**、文字链接用 `.sharelink` 不用按钮冒充链接；「接入说明」是**按需展开的弹窗**而不是平铺的一屏灰字，M17-01【补全】项）、**块 B**（令牌列表：一行给全 M17-01 的七项 + **实时计数 `n / 20`**；**没勾的权限位不列**）。**主操作**「创建令牌」是这一屏唯一的实心主色按钮。撤销用**行内二次确认**（`pendingRevoke` → 确认 / 取消，同 `MySharesPage`）+ **后果平铺**。已撤销 / 已过期的行降透明度但**仍可查审计**——审计正是判断"该不该撤销"的依据，撤掉了就看不到了 |
| `CreateTokenDialog` | `features/mcp/ui/CreateTokenDialog.tsx` | 创建弹窗，**两个态原地切换**：填写 → 已创建。**「只读」不写成置灰开关**（它恒含、不是一个选项，置灰还得解释为什么不能关），写成一行可见文字；三个可勾选项各一个 `role="switch"`（同 `BackupPage` / `VersionsTrashPage`）。范围候选**只列顶层、勾选自动含子**（服务端两层展开本就是这个语义；列出子层会出现"勾了父又取消子"），**加密空间不进候选**。有效期与范围用盒式 `SegmentedControl`。**已创建态不允许点遮罩关闭**——完整令牌只在这一刻可见，一点外面就永远看不到了；**不落任何本地存储**（缓存下来就等于在本地留一份凭据） |
| `TokenAuditDialog` | `features/mcp/ui/TokenAuditDialog.tsx` | 审计弹窗（**不是行内展开**：90 天记录可能几十上百条，内嵌展开会让每个令牌行高度暴涨、列表参差）。**条目标题从本地缓存解析，取不到显示「已不存在的条目」——不给链接也不回显内部 id**（内部标识不是给人操作的东西，摆出来反而像能点的入口）。只记写类调用，**空态要把这点说明白**，否则用户会以为"这枚令牌没在工作" |
| `model.ts` | `features/mcp/model.ts` | 纯函数：权限 / 范围 / 有效期 / 状态的文案，**相对时间自己算**（不引依赖也不调 `Intl`，口径要能单测、也不能因 locale 变掉），审计结果的中文与语义色，有效期选项常量，范围候选 |

四条贯穿的口径：

1. **实时计数必须可见**（`DESIGN.md` §5.4-2），达 20 上限时「创建令牌」**置灰 + 旁注平铺原因**（§6.1：禁用必须说明为何，不可只置灰、不可只靠悬停）。
2. **读失败不写空态**（§6.1 / 同附件管理页）：读不出来时"还没有令牌"是假的，就地 `role="alert"` 即可。
3. **破坏性后果与一次性凭据的后果都平铺**（§5.4-2）：撤销后果、URL 方式的风险说明、"只显示一次完整令牌"——三处都**不得藏进 `InfoHint`**。辅助说明（权限含义、保留 90 天、端点不支持 SSE）才进 `ⓘ`。
4. **状态随挂载初始化，不在 effect 里同步 `setState`**：两个弹窗都由页面给 `key`（`creating ? "open" : "closed"` / `auditing?.id`）**重挂载**来实现"重置"——一次挂载 = 一次干净表单，没有关掉再打开的中间态，也避开 React 19 对 effect 内同步 `setState` 的告警。令牌列表的"最近使用 2 小时前"走既有 `useTicker`。

**【M6 落地补记】四处界面期确认**（用户 2026-10-03 拍板，均不改产品口径）：审计用弹窗 / 撤销走行内二次确认 / 文件夹范围只列顶层且勾选自动含子 / 加密空间不进范围候选。

### 7.9 定时自动备份（`features/backup/`）【M7 第四项新增】

M16-01 / M16-02 / M16-03 的设置页部分（v0.7.2–v0.7.5，四批）。**零新增 CSS**——全部用既有件，**不碰 `DESIGN.md`、不碰全局样式**。

| 组件 | 落点 | 职责与关键约定 |
|---|---|---|
| `BackupTargetsCard` | `features/backup/ui/BackupTargetsCard.tsx` | 设置 › 备份页**第一张卡**（这一屏叫「备份」而不叫「导出」）。目标列表：名称 + 类型 `Pill` + 地址 + 「频率 · 远端策略 · 最近一次结果」一行；每行一个**启用 `role="switch"`**、三个次操作（**测连接 / 编辑 / 推一次**）与一个**行内二次确认的删除**。**「推一次」的结果平铺在那一行上**，不靠 Toast（`DESIGN.md` §5.4-2） |
| `BackupTargetDialog` | `features/backup/ui/BackupTargetDialog.tsx` | 新建 / 编辑**两态合一**（`target === null` 是新建）。差别只有三处：类型不可改（`SegmentedControl` 逐项 `disabled` + `title` 说明为何）、凭据留空即不改、标题文案。`dismissable={false}`——填了一半点外面就丢了（同 `CreateTokenDialog`） |
| `model.ts` | `features/backup/model.ts` | 纯函数：标签文案、**凭据字段的 label（要说清"留空 = 不改"）**、`buildTargetPayload`（校验 + 拼请求体，规则与服务端 schema 同源）、`lastRunText`（**分清「没跑过 / 从没成功过 / 最近失败 / 最近成功」**）、`runResultText`（**三种含义分开说**：没推成 / 没东西可推 / 推了一批还有剩）、`policyRisk`（选「与本机保持一致」时的不可恢复警告） |
| `data/api/backup-targets.ts` | `data/api/backup-targets.ts` | 端点封装。**单独一个文件而不是塞进 `endpoints.ts`**——那份已 489 行、`max-lines` 的 500 硬上限就在眼前。**凭据永不缓存** |

四条贯穿的口径：

1. **凭据的 label 必须写清「留空 = 不改」**（`DESIGN.md` §5.4-2 的诚实性要求）。只写"密钥"两个字的话，用户会以为把输入框清空就等于换了新密钥，而实际是"保持原样"——**编辑时不送 `secret` 这个键**（送空串会被服务端当成清空）。两条都有用例。
2. **删除走行内二次确认，且后果平铺**：那句话必须说清**"远端已经推上去的文件一个都不会动"**（设计 §四：删目标只清本机账本），否则用户会以为远端也被清了。与 `MySharesPage` / MCP 页同款。
3. **读失败不写空态**（§6.1）：读不出来时"还没有目标"是假的。
4. **失败原因与「推一次」的结果都平铺**（§5.4-2）：`last_error`、测连接结果、推送结果——三处都**不藏进 `InfoHint`、不靠 Toast**，它们要留到用户下一次打开这一屏时还在。辅助说明（这是什么、为什么私密的出站前要加密）才进 `ⓘ`。

**【M7 落地补记】**「推一次」**一轮就是一批**（架构 §14.3 的外部子请求限额），所以界面上**必须把 `remaining > 0` 说成常态而不是出错**——把后两种情况都说成"失败"或都说成"成功"都会误导。**浏览器循环 + 进度条 + 中断续传未做**（见《功能拆解》M16-03）。

---

## 八、通用控件库 `app/ui/` 【已落地】

判定为通用的标准：原型中被 3 处以上复用，且不含业务语义。

| 控件 | 原型 | 变体 | 关键 props |
|---|---|---|---|
| `Icon` | `.ic` / `.sprite`（`<symbol>`） | `.sm` `.lg` | `name`（symbol id 去掉 `i-` 前缀）、`size?` |
| `Button` | `.btn` | `.primary` `.danger` `.ghost` `.sm`、`[disabled]` | `variant`、`size`、`icon?`、`onClick` |
| `IconButton` | `.icon-btn` | — | `icon`、`label`（`title` + `aria-label`）、`onClick` |
| `SegmentedControl` | `.seg` > `button.on`；`.mode-tabs` 同族 | — | `options`、`value`、`onChange`。**盒式**（外框 + `--panel-3` 灰实底选中）。第六章的 `ComposerModeTabs`（`.mode-tabs`）与第七章的 `DocModeSwitch`（`#docMode`）、`TableMode`（`#tableMode`）、`MemoMode`（`#memoMode`）、`TaskView`（`#taskView`）**都是它的用法，不是各自独立的控件**——差异只在尺寸（`.mode-tabs` 更矮更紧凑） |
| `UnderlineTabs`（下划线页签） | `.nav-seg` / `.seg-item.active::after` | — | `options`、`value`、`onChange`。**与 `SegmentedControl` 刻意不同**，见 6.2 不变量 2 |
| `Chip` | `.chip` | `.blue` `.amber` `.green` `.red` `.purple` `.tag` `.clickable` | `tone`、`icon?`、`onClick?` |
| `Pill` | `.pill` | `.ok` `.busy` | `tone`、`icon`、`text` |
| `Capsule` | `.capsule` | `.locked` `.unlocked` `.danger` `.blink` | `tone`、`icon`、`label`、`timer?`、`onClick` |
| `Avatar` | `.avatar` | 顶栏 30px / 菜单头 26px | `name`（取首字）、`size` |
| `Toggle` | `.toggle` | `.on` | `checked`、`onChange`、`disabled?` |
| `Checkbox` | `.checkbox` | `.on` | `checked`、`onChange` |
| `RadioSet` / `RadioOption` | `.radio-set` / `.radio-opt` / `.radio-dot` | `.on` | `options`、`value`、`onChange` |
| `Field` | `.field`（+ `.hint` / `.field-err`） | 错误态 `.field-err.show` | `label`、`hint?`、`error?`、`children` |
| `Menu` | `.menu` / `.menu-item` / `.menu-sep` / `.menu-label` / `.menu-head` / `.menu-seg` | 锚点定位**自动上翻** | `anchor`、`items`、`align: 'left' \| 'right'`、`onPick` |
| `Modal` / `Overlay` | `.overlay` / `.modal` / `.modal-head` / `.modal-body` / `.modal-foot` | `.mi`（`.blue`） | `open`、`title`、`desc`、`icon`、`footer`、`onClose`（点遮罩关闭） |
| `Toast` / `ToastHost` | `.toast-wrap` / `.toast` | `.ok` `.warn` `.info`、`.fade` | `message`、`tone`、`duration`（默认 2800ms） |
| `Placeholder` | `.placeholder`（+ `.boxed`） | 盒子态 / 纯居中态 | `icon`、`title`、`desc`、`action?` |
| `WarnBox` | `.warn-box` | 危险态（默认）/ `.info` | `tone`、`icon?`、`children` |
| `HintLine` | `.hint-line` | — | `children`（可含 `<code>`） |
| `InfoHint`（ⓘ + 悬停） | `.infohint` / `.infohint__btn` / `.infohint__pop` | — | `label`（按钮的可访问名字，**必填**）、`children`（要收起来的那段说明）。**2026-09-27 用户拍板新建并落地**于 `app/ui/InfoHint.tsx`；三种打开方式（悬停 / 键盘聚焦 / 点击切换，`aria-expanded`），触屏命中区 44px。规范见 `DESIGN.md` 与 AGENTS.md：界面辅助文案一律收进它、不得平铺；但警告、破坏性后果、错误/校验、实时计数必须保持可见 |
| `KeyCap` | `.keycap` | — | `text`（如 `Asia/Shanghai`、`30 天`） |
| `SizeTag` | `.size-tag` | `.soft` `.hard` | `bytes`、`limit` |
| `SyncTag` | `.sync-tag` | `.ok` `.busy` `.err` `.enc` | `state`、`text` |
| `Badge` | `.badge` | — | `text`（如 `owner`） |
| `Stars` | `.stars` | — | `value`、`max` |
| `CoverPlaceholder` | `.cover-mini` / `.wf-img` / `.gal-cover` | 竖版 / 横版 / 大图 | `pattern`（条纹走 `--ph-stripe` 令牌） |
| `EmptyState` | `.home-empty` / `.placeholder.boxed` | — | 见 `Placeholder` |
| `Tooltip` | `title` 属性 | 【待定】是否做真 tooltip 组件 | — |

**通用控件铁律**：

1. **任何颜色都走令牌**，含条纹（`--ph-stripe`）、遮罩（`--scrim`）、阴影（`--shadow-1..3`）、`--on-primary`。完整规则见 `DESIGN.md` §3.2。注意 `linear-gradient()` 里的硬编码色**不会**被回归脚本的正则扫到，须手工核对（原型现有 14 处硬编码渐变、仅 3 处走令牌）。
2. **不在通用控件内写业务语义**。`Chip tone="amber"` 而不是 `Chip kind="encrypted"`。
3. **不引第二套 UI 库**（AGENTS.md「界面怎么做」）。
4. 图标一律走 `<symbol>` sprite，不内联 path、不引外部图标库。

---

## 九、图标与设计令牌

### 9.1 图标

原型内联 SVG sprite，**37 个 symbol**，`<use href="#i-xxx">` 引用。实现时做一个 `Icon` 组件 + sprite（或等价的图标模块），**id 保持原名**便于与原型对照。

| 分组 | symbol id（去掉 `i-` 前缀即 `Icon` 的 `name`） |
|---|---|
| 内容类型 | `note` `table` `clock` `check-sq` `tag` `folder` `image` |
| 动作 | `plus` `pencil` `trash` `share` `download` `refresh` `x` `more` `external` `search` `key` |
| 状态 | `lock` `unlock` `eye` `star` `pin` `check` `alert` `info` `cloud-ok` `cloud-up` `bolt` |
| 布局 | `chev-r` `chev-d` `columns` `list` `kanban` `home` `settings` `user` |

规格：默认 16px、`.sm` 13px、`.lg` 20px；`stroke-width: 1.6`，`fill: none`，`stroke: currentColor`。

### 9.2 设计令牌

- **令牌的唯一定义处是 `DESIGN.md`**（从原型 `:root` / `[data-theme="dark"]` 两套落稿）。本文**不复制令牌值**，只约定「走令牌」。注意：`DESIGN.md` 的第三章「视觉语言」现为**【待定】**（配色、字体、字号刻度、圆角刻度、阴影尚未定型），因此**色值表暂缺**；但第三章的**机制**（必须令牌化、双主题、禁硬编码含渐变、语义色不靠颜色单独表意）**已经生效**。
- 原型令牌全集：底色（`--bg` `--bg-soft` `--panel` `--panel-2` `--panel-3`）、线（`--line` `--line-2`）、文字（`--text` `--text-2` `--muted`）、主色（`--primary` `--primary-2` `--primary-soft` `--primary-line` `--on-primary`）、语义（`--amber` `--green` `--red` `--purple` 各自的 `-soft` / `-line`）、结构（`--hairline` `--ph-stripe` `--topbar-bg` `--lock-veil` `--scrim` `--shadow-1..3`）、尺寸（`--radius` `--radius-lg` `--fnbar-w` `--list-w` `--topbar-h`）、字体（`--mono` `--sans`）。
- **双主题**：浅色为默认，深色是**暖黑**（不是冷灰）。**主色浅深两套相同**；语义色在深色下提亮。切换走 `data-theme` 属性。

### 9.3 主题切换

| 项 | 内容 |
|---|---|
| 状态 | `theme: 'light' \| 'dark' \| 'auto'`，默认 `light` |
| 入口 | ① 设置 › 通用 › 界面偏好（`#themeSet`）② 账户快捷菜单里的一排三档（**切完不收起菜单**）。**不放顶栏**（顶栏 6 块是死约束） |
| 实现 | `applyTheme()`：`auto` 用 `matchMedia('(prefers-color-scheme: dark)')`，**jsdom 下回退 light**（做特性判断，不要在 jsdom 里崩） |
| 硬约束 | **切换不整页重渲染**（保滚动位置），只改 `data-theme` 并就地改高亮；同时要响应系统主题变化（监听 `matchMedia` 的 `change`） |

---

## 十、组件 ↔ 功能点 ↔ 需求 映射矩阵

| 组件 | 落点 | 功能点 | 需求 |
|---|---|---|---|
| `AppShell` / `Topbar` / `WorkArea` | `app/` | M02-01 | §7.4 |
| `BrandLogo` / `Breadcrumb` | `app/topbar/` | M02-01 | §7.4 |
| `SearchBox` / `SearchPanel` | `app/topbar/` + `features/search/` | M02-01、M09-01、M09-02 | §7.4、§13.1、§6.10、§8.9 |
| `SyncPill` | `app/topbar/` | M02-06、M13-02 | §1.4、§15.3 |
| `PrivacyCapsule` / `TierMenu` | `app/topbar/` + `features/privacy/` | M02-05、M08-04、M08-06、M08-12 | §6.9、§6.8 |
| `AccountEntry` / `AccountQuickMenu` | `app/topbar/` | M02-01、M18-03 | §7.5（补充） |
| `NewNoteButton` | `app/fnbar/` | M04-01 | §7.4 |
| `Composer` + 3 子件 | `app/fnbar/` | M02-02、M04-01、M06-01、M07-01、M07-02 | §7.4、§8.7、§9.2 |
| `NavSegmented` | `app/fnbar/` | M02-02、M02-04、M06-10、M07-05 | §7.4 |
| `NavList` / `NavItem` | `app/fnbar/` | M02-02、M03-07 | §7.4 |
| `NotebookGroup` / `FolderTree` / `NbAddButton` | `app/fnbar/` | M03-01、M03-02、M03-03、M03-04、M05-01 | §4.5、§7.4 |
| `TagGroup` / `TagChip` | `app/fnbar/` | M03-07、M04-06 | §7.4、§7.1 |
| `VaultNode` | `app/fnbar/` | M08-07 | §6.3 |
| `AddEntryDialog` | `app/fnbar/`（App 经 `AddEntrySlot` 挂载） | M06-10、M07-01（入口二） | §8.7、§9.2 |
| `TwoPane` / `ItemRow` / `ItemListHead` | `app/ui/` | M03-06、M03-07、M08-07、M08-12 | §7.4 |
| `DocHead` / `DocModeSwitch` / `DocMoreMenu` | `app/` + features | M04-03、M04-08、M04-02、M05-10、M08-08 | §7.1、§6.2、§8.8、§10.11 |
| `Editor`（CodeMirror 封装） | `app/editor/` | M04-03、M04-04、M04-05 | §7.1、§12.1、§15.7、§10.10 |
| `DocStatusBar` | `app/` | M02-06、M04-04、M04-05、M08-12 | §6.9、§12.1、§10.10 |
| `LockedDocPanel` / `VaultLockedPanel` | `features/privacy/ui/` | M08-07、M08-12 | §6.9 |
| `UnlockModal` / `ResetPrivacyModal` | `features/privacy/ui/` | M08-03、M08-04、M08-14 | §6.8、§6.12 |
| `HomePanel` 系列 | `features/home/` | M02-03、M02-04 | §7.4、§7.5 |
| `MemoPanel` 系列 | `features/memos/` | M06-01、M06-02、M06-03、M06-04、M06-05、M06-08、M06-10 | §8 |
| `TaskPanel` 系列 | `features/tasks/` | M07-01、M07-03、M07-04、M07-05 | §9 |
| `TablePanel` / `GalleryView` | `features/tables/` | M05-01、M05-03、M05-05、M05-07、M05-08 | §10 |
| `TrashPanel` | `features/settings/ui/` | M12-01、M12-02、M12-03、M12-04 | §7.1、§16.1、§14.4 |
| `SettingsPanel` / `SetNav` / `SetCard` / `SetRow` | `features/settings/` | M18-01、M18-02、M18-03、M02-04、M19-01 | §7.5 |
| `Drawer` | `app/ui/` | M03-07、M05-08、M07-05 | §7.4【推荐】 |
| 通用控件库 | `app/ui/` | 跨模块 | — |

---

## 十一、复用关系与已知重叠

### 11.1 复用规则

- **向上复用**：`app/ui/` 的控件只能被 `app/` 与 `features/*` 引用，不能反向依赖 `features/*`。
- **不横向复用**：feature 之间零互相依赖。要在两个 feature 里用同一块东西，就把它提升到 `app/ui/`，**不要** `import` 另一个 feature（架构 §2.3.3）。
- **数据不进组件**：组件不 import `data/db`，只 import `features/<x>/model.ts` 的动作。

### 11.2 已知重叠与待收敛（记录下来，实现时统一，不要各写一套）

| 现象 | 说明 | 建议 |
|---|---|---|
| `.sw` 与 `.chip` 形状相近 | `.sw` 是录入框附加项（可点选，20px 高），`.chip` 是展示型胶囊（21px 高）。原型里两者样式独立 | 保留为两个控件（语义不同：可选 vs 展示），但底层共用一份「胶囊」样式基类 |
| `.nav-item` / `.seg-item` / `.tree-row` / `.set-nav-item` / `.mini-row` 都是「可点行」 | 五套相似样式，选中态 3 种写法（盒式 / 下划线 / 左侧竖条） | 抽一个 `ClickableRow` 基类承载 hover / focus / 键盘可达；**选中态的视觉留给各自的 `tone`，不要强行统一**（`.seg-item` 的下划线是刻意设计） |
| `.nav-seg`（下划线页签）与 `.seg`（盒式分段） | **刻意区分**，不是重复 | **不要合并**。见 6.2 不变量 2 |
| `.placeholder` 两种形态 | 纯居中（`.placeholder`）与盒子态（`.placeholder.boxed`）；Memo / 待办 / 加密空间 / 搜索各写了一份文案 | 文案作为 props 传入，控件本体只做两份 |
| 6 处 `@media` 断点 | `.waterfall` 3→2 列（≤1240px）；`.kanban` 3→1 列、`.drawer` 390→330px（≤1080px） | 断点值统一收进 `DESIGN.md`；组件内不写裸数值 |
| 硬编码渐变色 | `.logo`、`.btn-new`、`.avatar`、`.memo-imgs .thumb`、`.wf-img`、`.gal-cover`、`.sw` 的选中态有硬编码渐变 | 统一抽成令牌（如 `--brand-grad`、`--ph-cover`），否则换主题会漏改 |
| `.mini-tree` / `.mini-row` 未被任何渲染函数使用 | 原型遗留 | 实现时**不要照搬** |
| `Composer` 与 `AddEntryDialog` 的字段行 | 两处都有「模式附加项」字段行（`.composer__extras` / `.addentry__extras`，高 26px、`nowrap`），内容随档位换 | **复用同一份 `ModeExtras` / `TASK_ITEM_PATTERN`**（已由 `Composer` 导出，6.2 / 6.8），容器各留一个修饰类；**不要复制第二套字段判定** |

### 11.3 原型专用、不进生产

| 元素 | 原型 | 处理 |
|---|---|---|
| `ListGuide`（`.guide` / `#guideBar`） | 演示引导条「原型演示：① …② …③ …」 | **删除**，不是产品功能 |
| 演示假数据 | `NOTES` / `MEMOS` / `TASKS` / `BOOKS` / `TRASH` / `VAULT_TREE` | 换成真实仓储；**样本数据只用小型、脱敏、可公开的示例**（AGENTS.md） |
| 原型简版 Markdown 渲染 | `mdToHtml()` | 不照搬。实现按架构 §3.4（GFM + sanitize） |
| 简化提示文案 | 大量 `toast('…（原型不实现）')` | 换成真实行为 |

---

## 十二、预留组件（尚未进原型）

以下界面已在需求文档 / 功能拆解中定义，但原型未实现。**形状待原型补上后再定**，此处只约定职责与大致拆法，避免实现时临时发明。

| 组件 | 落点 | 职责 | 功能点 / 需求 |
|---|---|---|---|
| `LoginPage` / `RegisterPage` | `app/auth/` 或 `features/auth/` | 登录（用户名 + 登录密码）；首位注册即 `owner`；注册开关关闭时登录页不显示注册入口 | M01-01、M01-02、M01-03（§5.2–§5.4） |
| `AuthGate` | `app/` | 未登录 / 会话过期的路由拦截；登录必须联网，不进离线模式 | M01-03、M01-04（§5.4） |
| `SessionList` | `features/settings/ui/` | 登录设备与会话管理（**占位**） | M01-06（§后续清单 2、4） |
| `ChangePasswordForm` | `features/settings/ui/` | 修改登录密码（当前密码 + 新密码两次） | M01-05（§7.5） |
| `ShareViewer` | `features/share-viewer/` | 分享查看器，**独立入口加载**（`share.html`），不挂主应用外壳 | M14-05（§16.1） |
| `ShareCreateDialog` / `ShareManageList` | `features/` | 创建分享（密码、过期）、管理我的分享、撤销 | M14-01、M14-03、M14-04（§16.1、§7.5） |
| `MemoCollectionShare` | `features/` | Memo 固定合集分享（条目在创建时固定） | M14-02（§16.1） |
| `VersionHistoryPanel` / `VersionDiff` | `features/versions/` | 版本列表、查看与对比、恢复、标记为「保留」 | M11-01~M11-05（§12.2–§12.4、§7.1）**【M4 已实现，形态与 props 见 §15.1】** |
| `RetentionPolicyForm` | `features/settings/ui/` | 版本保留策略设置（原型只有静态文案 + 「调整」按钮） | M11-06（§12.3） |
| `BackupRestoreFlow` | `features/backup/` | 从备份恢复的流程（选择目标 → 预检 → 执行 → 报告） | M16-04（§16.3） |
| `BackupTargetForm` | `features/backup/` | 备份目标的新增 / 编辑（原型只有已配置好的卡片） | M16-01、M16-02、M16-03（§16.3） |
| `EnvelopeDecryptGuide` | `features/backup/` | 备份导出信封的外部解密工具说明 | 架构 §7.3 |
| `McpTokenCreateDialog` / `McpTokenDetail` / `McpAuditLog` | `features/settings/ui/` | 令牌创建（完整值**只显示一次**）、范围与权限、审计日志 | M17-01、M17-02、M17-03（§17.2、§17.3） |
| `AttachmentUploader` / `AttachmentPreview` / `AttachmentGrid` | `features/attachments/` | 上传（哈希去重、**缩略图在浏览器端生成**）、预览、附件管理 | M10-01、M10-02、M10-03（§14）**【M4 已实现上传与预览：`upload.ts` / `thumbnail.ts` / `queue.ts` / `model.ts`；附件管理页留 M6，见 §15.3】** |
| `OrphanScanResult` | `features/settings/ui/` | 孤儿附件扫描结果清单与清理确认 | M10-03（§14.3） |
| `ConflictBadge` / `ConflictCopyNotice` | `data/sync/` 的展示层 | 「冲突」状态的标记与冲突副本提示 | M13-04（§15.5） |
| `OfflineBanner` | `app/topbar/` | 离线横幅「离线，改动会在联网后上传」 | M02-06（§15.3） |
| `UpdateNotice` | `app/` | 「有新版本」提示，下次打开生效；只推送给 `owner` | M19-04（§21.1 第 11 条、§15.6） |
| `TableColumnManager` / `FieldTypePicker` / `FilterBar` / `SortBar` | `features/tables/ui/` | 列管理（新建列、十种字段类型选择）、筛选与排序 UI | M05-02、M05-03、M05-07（§10.2、§10.4、§10.7）**【M4 已实现 `TableColumnManager` 与合并后的 `TableFilterBar`；`FieldTypePicker` / `FilterBar` / `SortBar` 未独立成组件，见 §15.2】** |
| `ImageCell` / `CellEditor` | `features/tables/ui/` | 图片附件单元格、各字段类型的行内编辑器 | M05-05、M05-06、M05-09（§10.5、§10.7）**【M4 未独立成组件：行内编辑在 `TableGrid`（表格级状态），图片列按文件名渲染，见 §15.2】** |
| `TagManager` | `features/settings/ui/` | 标签重命名 / 合并 / 删除 | M04-06（§7.1） |
| `MoveToFolderDialog` | `app/ui/` | 「移动到…」对话框（含移入加密空间；超三层置灰） | M03-04、M08-09、M08-10（§4.5、§6.11） |
| `ConfirmDialog` | `app/ui/` | 通用确认框（删除文件夹写明「N 条内容、M 个子文件夹将移入回收站」；破坏性操作必须可见说明） | M03-05、M12-01（AGENTS.md「警告必须保持可见」）**【M4 未做：一律用 `Modal` + danger `Button`，见 §15.2】** |
| `BatchMarkBar` | `app/ui/` | 批量标记操作条（元数据操作，锁定时可执行） | M08-11（§6.4 修订） |
| `ExportDialog` | `features/` | 单篇导出 / 按条件导出 / 全量 ZIP（含隐私规则提示） | M15-01~M15-03（§16.2、§6.10） |
| `TimeZonePicker` | `features/settings/ui/` | 时区选择（原型只有 `KeyCap` + 「修改」按钮） | M02-04（§7.5、§8.4） |
| `MemberManager` | `features/settings/ui/` | 成员账户管理（停用 / 删除 / 数据清理）——**仅 `owner`** | M19-03（§后续清单 3） |

---

## 十三、维护规则

1. **改动触发**：原型增删区块、组件改名、新增可复用控件、落点在 `app/` 与 `features/*` 之间迁移 → 更新本文；纯样式微调（颜色、间距、圆角）→ **不进本文**，直接改 `DESIGN.md`（若涉及令牌）。
2. **与 `DESIGN.md` 的分工不重叠**：本文只写「有哪些组件、放哪、契约是什么」，不写「长什么样」。任何一个组件，在本文里读职责与 props，在 `DESIGN.md` 里读视觉。
3. **与架构的一致性**：本文的落点必须能对上架构 §2.3.2 的「功能 → 代码落点对照表」。新增 feature 或新目录先改架构 §2.3.2，再改本文（架构 §2.3.3 第 3 条）。
4. **拆分阈值**：本文超过约 800 行，或某个 feature 的组件超过 15 个，按 `wiki/components/<功能>.md` 拆分，本文保留总览与通用控件库。
5. **不写行号**：引用原型一律写元素名 / 选择器（沿用功能拆解 v2.1 的约定）。
6. **组件名是实现契约**：实现阶段如认为某个组件应改名或合并，先回报本文再改，避免文档与代码长期漂移。
7. **验证脚本对应**：`prototype/verify-prototype.js` 与 `prototype/verify-framework.js` 里的断言，多半可平移为组件级单测的验收点（尤其顶栏 6 块、录入框高度与导航位移、两条导航造型的区分、设置两栏分页）。新增组件时同步登记需要哪一条断言。

---

## 十四、M2 落地后的组件与收敛记录【M2 收口回写】

本章是 M2 收口时（v0.3.0）按实现回写的一节：**实现名优先**（组件名是实现契约，见 §十三 第 6 条）。落点全部对得上架构 §2.3.2（v1.11）。

### 14.1 M2 新增组件（实现名与落点）

| 组件 | 落点 | 职责（一句话） | 关键 props / 契约 |
|---|---|---|---|
| `Composer` | `app/fnbar/` | 快捷录入框（笔记 / Memo / 待办三档） | `onPublishNote` / `onPublishMemo` / `onPublishTask`；`mode` + `onModeChange`（**受控/非受控两用**，首页快捷方式用它切档） |
| `NavSegmented` | `app/fnbar/` | 顶部分级浏览导航（下划线页签） | `active` / `onSelect` / `showHome`（未选首页为启动视图时**不渲染首页项**，其余两项均分） |
| `FnBar` | `app/fnbar/` | 左功能栏装配（录入框 + 导航 + 笔记本组 + 标签组 + 加密空间节点） | 各面板以 slot 传入；**不含账户区**（账户入口在顶栏） |
| `TwoPane` | `app/workarea/` | 右主操作区两栏骨架（列表 + 正文） | `listHidden` / `list` / `doc` |
| `HomeView` / `SearchView` | `app/workarea/` | 首页 / 搜索结果的单栏装配 | 数据与回调由 `App` 递入（`app/` 不 import `features/*`） |
| `SearchPanel` | `features/search/ui/` | 搜索结果（单栏）+ 筛选抽屉 | `query` / `results` / `folderNames` / `filters` / `onFiltersChange` / `tags` / `staleNotice` / `onOpen` / `onClose` |
| `TaskPanel` / `TaskListView` / `TaskKanban` / `TaskFilterBar` / `TaskCard` | `features/tasks/ui/` | 待办主面板、列表、看板、筛选栏、卡片 | 面板用 `panel`/`header`/`items` 三类**数据槽**（不用 children） |
| `MemoPanel` | `features/memos/ui/` | Memo 时间轴（分天 / 筛选 / 原地编辑 / 发布） | 同上三类数据槽；`tags` 供筛选 |
| `NotebookPanel` / `NoteList` / `NoteWorkspace` | `features/notes/ui/` | 笔记本与文件夹树、条目列表、正文区 | `NoteWorkspace` 含模式切换、**跨标签页提示条**与**冲突处理条** |
| `HomePanel` / `StatCards` / `TodayTasks` / `RecentActivity` / `ShortcutGrid` / `QuickNav` | `features/home/ui/` | 首页三块：概括预览（三卡）→ 快捷方式 → 快速导航 | `memoLocked`（M2 恒 false，M3 接门禁）；各卡自带空态 |
| `SettingsPanel` + `CardGeneral` / `CardQuickMenu` 等卡片 | `features/settings/ui/` | 设置两栏分页（六个分类）与各分类卡片 | 即时生效 + 整份上传（`useUserSettings`） |
| `AccountQuickMenu` | `app/topbar/` | 账户快捷菜单（账户头 → 可配置功能项 → 设置 / 退出登录） | 显示项由 `settings.quick_menu` 决定；`MenuItemSpec.keepOpen` 让主题切换**不收起菜单** |

### 14.2 六处「文档与实现不一致」的收敛去向

| # | 文档原写法 | M1/M2 实现 | 收敛 |
|---|---|---|---|
| 1 | `Placeholder`（`icon` / `title` / `desc` / `action`） | `EmptyState`（`title` / `hint` / `action`） | **以实现名为准**：本章起写 `EmptyState`；`icon` / `desc` 未做（空态用文字说明即可，不靠图标区分） |
| 2 | `Menu`（`anchor` / `items` / `align` / `onPick`，锚点自动上翻） | `DropdownMenu`（`label` / `trigger` / `header` / `items` / `align` / `blocks`） | **以实现名为准**；`blocks` 是 M2 新增（账户菜单里的「主题一排三档」这类整块内容需要它）。**锚点自动上翻未实现**（见 14.3） |
| 3 | `Button` 变体 `.primary` / `.danger` / `.ghost` / `.sm` | 另有 `.secondary` | **补进文档**：`.secondary` 用于空状态次操作与提示条里的动作按钮 |
| 4 | `Pill` 变体 `.ok` / `.busy` | 另有 `.err` | **补进文档**：`.err` 用于顶栏「同步失败」 |
| 5 | `SegmentedControl` 是**共享控件** | 仍在 `Composer` / `NoteWorkspace`（模式切换）/ `SettingsPanel`（单选组）三处内联 | **未收敛**（见 14.3）：文档保留「应为共享件」的结论，实现按 §十三 第 6 条留待抽出 |
| 6 | `MemoLockedPlaceholder` / `TaskLockedPlaceholder`（§7.3） | 两份形态相同、仅文案不同的锁定占位 | **收敛为一个 `LockedPlaceholder`**：文案作 props 传入，**落 `app/ui/`**（跨 feature 复用只能走 `app/ui/`，见 §2.2 与 §11.1），**不两份并存**；本文 §7.3 的两处引用已改写（2026-09-27，见 `docs/modules/Menote-隐私锁设计-v1.md` §9.4） |

### 14.3 已知未实现（登记在案，避免长期漂移）

1. **锚点自动上翻**：`DropdownMenu` 目前按 `align` 定位，未做「贴底时自动上翻」。原型已有该行为，实现缺；触发场景是功能栏底部的菜单。
2. **共享 `SegmentedControl`**：三处内联结构尚未抽出共享件（14.2 第 5 条）。抽的时候同时替换三处，避免新旧并存。
3. **`search.worker.ts`**：本地搜索索引在 `data/db/search.ts`（按 `sync_seq` 增量），检索在 `features/search/model.ts` 纯函数里；Worker 化未做（M2 已知偏离，接口不变）。

> 三项均为**实现侧待办**，不影响本文其余契约；做完后回写本节并去掉对应条目。

---

## 十五、M4 落地后的组件与收敛记录【M4 收口回写】

本章按实现回写（**实现名优先**，同 §十四）。落点全部对得上架构 §2.3.2（v1.13）。

### 15.1 M4 实际新增的组件（实现名 + 落点 + props）

| 组件 | 落点 | 职责（一句话） | 关键 props / 契约 |
|---|---|---|---|
| `TableEditor` | `features/tables/ui/` | 表格文档的装配（工具栏 + 网格 / 图册 + 状态条） | `title?` / `doc` / `onDocChange` / `onRequestDegrade` / `onCopyRow?` / `encrypted?` |
| `TableGrid` | `features/tables/ui/` | 表格网格：单元格编辑、列头菜单、行菜单、虚拟滚动、键盘导航 | `state` / `rows` / `columns` / `editing` / `onEditingChange` / `onCellChange` / `onSortChange` / `onOpenColumnPanel` / `onInsertRow` / `onDeleteRow` / `onMoveRow` / `emptyAction?` |
| `GalleryView` | `features/tables/ui/` | 图册（卡片网格）+ 卡片详情 | `doc` / `columns` / `onCellChange` / `onBackToTable` |
| `TableToolbar` | `features/tables/ui/` | 表格 / 图册分段切换 + 新增行 + 筛选入口 + "筛选后 N / M 行" | `view` / `onViewChange` / `galleryAvailable` / `onRequestImageColumn` / `onAddRow` / `showAddRow?` / `filterOpen` / `onToggleFilter` / `activeFilterCount` / `filteredCount` / `totalCount` |
| `TableFilterBar` | `features/tables/ui/` | 按列筛选（纯本地，关闭即重置）+ 显示当前排序 | `columns` / `filters` / `onChange` / `onClearAll` / `sort`（**合并了原登记的 `FilterBar` / `SortBar`**） |
| `TableColumnManager` | `features/tables/ui/` | 列定义面板（新建 / 编辑两态），含十种类型单选与 `_id` 列开关 | `open` / `mode: "create" \| "edit"` / `doc` / `onConfirm` / `onCancel` |
| `TableSizeBar` | `features/tables/ui/` | 表格大小与提示（软 / 硬上限、拆分与复制行出口） | `size` / `hints` / `rows` / `columns` / `onSplit?` / `onCopyRow?` |
| `useVirtualWindow` | `features/tables/ui/` | 大表格的窗口化渲染（超过阈值才启用） | hook：`VIRTUAL_ROW_THRESHOLD = 100` / `DEFAULT_ROW_HEIGHT = 36` |
| `VersionHistoryPanel` | `features/versions/ui/` | 版本历史**独立面板页**：列表 / 对比 / 恢复 / 存为版本 | `itemTitle` / `rows` / `loading?` / `bodyLoading?` / `bodies` / `currentBody` / `busy?` / `onClose` / `onSeal` / `onRestore` / `onToggleKeep` / `onOpenVersion` |
| `VersionDiff` | `features/versions/ui/` | 行级 diff（`+/-` 前缀文字 + 颜色，两版标题与摘要） | `leftTitle` / `rightTitle` / `result: DiffResult` |
| `TrashPage` | `features/trash/ui/` | 回收站独立页：多选、恢复、永久删除、清空、进度与失败清单 | `rows` / `selected` / `onToggleSelect` / `onSelectAll` / `onRestore` / `onPurge` / `onEmpty` / `progress?` / `failures?` / `onRetry?` / `offline?` / `onBackToSettings` |
| `PurgeConfirmDialog` | `features/trash/ui/` | 永久删除 / 清空的确认框（写明不可撤销与影响数量） | `open` / `count` / `kind: "purge" \| "empty"` / `onCancel` / `onConfirm` |

**既有组件在 M4 的扩展**（不是新组件，但契约变了，一并登记）：

| 组件 | 扩展 |
|---|---|
| `Editor`（`app/editor/`） | 新增 `onFiles?(files)`（粘贴 / 拖入文件交给上层，编辑器不关心怎么传）与 `onReady?(handle)`——句柄从"读正文的函数"升级为 `{ read, insert, replace }`（附件占位与最终片段要靠它改正文）；拖入时加 `.editor--drop` 虚线描边 |
| `MarkdownPreview`（`app/editor/`） | 新增 `attachments?`（`sha256 -> { size, hasThumb }`）：补附件大小、标"附件不可用"、图片加 `loading="lazy"` |
| `DocStatusBar`（`features/notes/ui/`） | 新增 `attachments?: { label, tone, onRetry? }`——上传进度与失败落在**既有**状态栏（界面稿 §7.2 明确不新增第二条） |
| `NoteWorkspace`（`features/notes/ui/`） | 新增 `onOpenVersions` / `versionsDisabledReason`（锁定态入口整体不可用并说明原因）、`attachments` / `onFiles` / `attachmentsMeta` / `onEditorReady` |
| `SettingsPanel`（`features/settings/ui/`） | 新增 `versionsPage` 插槽（与 `privacyPage` 同一套接法）与 `onBackToNotes`（设置是独立页，需要可见出口） |
| `NotebookPanel`（`features/notes/ui/`） | 新增 `onDeleteFolder`（确认框写**实时计数**：N 条内容 / M 个子文件夹） |
| `NoteList`（`features/notes/ui/`） | 新增 `notice` 面板提示（删除后的「撤销」放在这里——`DESIGN.md` §6.6 禁止轻提示承载需要行动的信息） |
| `MemoItem` / `MemoTimeline` / `MemoPanel`（`features/memos/ui/`） | 新增 `onDelete`（Memo 删除入口，确认框写明"已转出的笔记不受影响"） |

### 15.2 界面稿 §十一 约定的 11 个组件：逐条对账

| # | 约定名 | 判定 | 落地情况 |
|---|---|---|---|
| 1 | `TableToolbar` | 🟡 按代码回写 | 见 §15.1；`mode`→`view`、`galleryDisabled`+原因 → `galleryAvailable` + `onRequestImageColumn`（不可用时点它去**加图片列**，比只置灰更给出口） |
| 2 | `TableColumnManager` | 🟡 按代码回写 | 传整份 `doc`（面板改的不只 columns）；`onSubmit`→`onConfirm`；`parseFailCount` 由 `doc` 内部算 |
| 3 | `FieldTypePicker` | ❌ 未独立 | 十种类型是列面板的**内部一块**（`TYPE_OPTIONS` + 原生 `radio` + 每项一行说明）。`disabledTypes` 未做（当前没有需要禁用的类型） |
| 4 | `TableFilterBar` | 🟡 按代码回写 | 已按建议**合并**原 `FilterBar` / `SortBar`；`rules`→`filters`、`onClear`→`onClearAll`；`onSortChange` **不在**此组件（排序从列头菜单进，筛选条只显示当前排序） |
| 5 | `CellEditor` | ❌ 未独立 | 行内编辑是**表格级状态**（同一时刻只有一个格子进入编辑），拆组件要把"谁在编辑"提升成共享状态 |
| 6 | `ImageCell` | ❌ 未独立 | 图片列按文件名渲染，图册卡片由 `GalleryView` 画；`onRemoveRef` **M4 未提供入口**（见 §15.3-5） |
| 7 | `RowDragHandle` | ❌ 未独立 | 行移动是 `TableGrid.onMoveRow(rowId, offset)` + 行菜单；**拖动柄未做**，但键盘/菜单等价入口已满足界面稿 §12-4 的底线 |
| 8 | `TableDowngradeNotice` | ❌ 未独立 | 降级入口在 `TableEditor` 的「更多」菜单；**"自动降级提示条"未做**（解析失败时就地提示 + 手动降级） |
| 9 | `VersionRestoreConfirm` | ❌ 未独立 | 确认框在 `VersionHistoryPanel` 内用 `Modal`；**文案是纯函数** `restoreConfirmText(row)`（三段，有单测），比写死在组件里更可测 |
| 10 | `TrashRow` | ❌ 未独立 | `TrashPage` 接收 `rows: TrashRowModel[]`（含剩余天数与锁定占位），行在页面内渲染——"显示什么"已抽成模型，组件层只剩排版 |
| 11 | `AttachmentOutboxRow` | ❌ 未独立 | 落在 `DocStatusBar.attachments`——界面稿 §7.2 的硬要求就是**不新增第二条状态栏**，所以它本来就该是状态栏的一块 |

> **结论**：4 项按代码回写、7 项按"未独立成组件"登记。**登记一份不存在的组件清单比不登记更糟**——需要组件化时再抽（触发条件是"第二处也要用它"，见 §十三 第 6 条）。

**同批的三处订正**：①`AttachmentUploader` 职责里的"缩略图在 `media.worker`"已改为**浏览器端生成**（`features/attachments/thumbnail.ts`），`media.worker` 落点删除；②`ConfirmDialog` / `InfoHint` **M4 未做**（确认框统一用 `Modal` + danger `Button`，说明文字用可见的 `hint-line`）——**不标"实做"**；③`TableColumnManager` 的 props 定稿（按本节），`FieldTypePicker` / `CellEditor` / `ImageCell` 标"未独立"。

### 15.3 已知未实现（M4，登记在案）

> **2026-09-27 收口期间更新**：第 1–3 条已补齐（见每条的说明），本节保留原始登记并标注现状，
> 便于对照"当时缺什么、后来怎么补的"。

1. ~~**列拖动调序**（`RowDragHandle`）~~ → **行拖动已实做**（v0.4.30，`TableGrid` 的行加 `draggable` + 常驻拖动柄，落点行有上边线；键盘等价入口是行菜单的上移/下移）；**列调序仍不做拖动**——界面稿 §2.2 定的是"增删改列一律走列面板"，面板里的箭头就是等价入口（刻意只保留一套入口）。
2. ~~**标签列的 chip 编辑**~~ → **已实做**（v0.4.30，`TagChipsEditor`：chip + 可点的 ×、逗号即分隔符、退格删末尾、失焦算草稿；**存储仍是逗号分隔的字符串**，格式未变）。
3. ~~**自动降级提示条**~~ → **已实做**（v0.4.26，`TableDegradeNotice`：危险态横幅 + 「查看原文」+「下载当前内容」，**不静默改数据**）；**主动降级**仍缺（要改 `items.type`，属接口变更，待拍板）。
4. **版本列表页脚的"已保留 N 个"**：保留标记在行上可见（`Chip` "保留"），未做页脚汇总。
5. **附件引用的集合对齐**：引用只在 `finalize(itemId)` 时落一条；"保存正文时对齐引用集合"要改 `PUT /api/items/:id/body` 的请求结构，留 M6 与附件管理页一起做（期间由孤儿 30 天规则兜底）。
6. **~~`Drawer` 与 `InfoHint`~~** → **部分收敛（v1.16 / components v9 订正，2026-10-03）**：`Drawer` **仍未做**（图册卡片详情与版本历史用 `Modal` / 独立面板页替代）；但 **`InfoHint` 已实做**——落 `app/ui/InfoHint.tsx`（ⓘ + 悬停），12+ 处调用，含 M5 的 `ShareDialog` / `MySharesPage` / `InstancePage`。本条原写「说明文字用可见 `hint-line`」是**过期事实**，详见 §十六-3。
7. **文件夹的永久删除**（v0.4.28 发现）：回收站已能列出并恢复文件夹，但服务端的永久删除只认条目（`permanentDeleteItems` 的 SQL 只扫 `items`）——界面已把该按钮置灰并写明原因，扩服务端属行为变更、待拍板。

> 第 4–7 条均为**实现侧待办**，做完后回写本节。第 5、7 条牵扯接口结构，**需用户点头**后才动。

---

## 十六、M5 落地后的组件与收敛记录【M5 收口回写】

### 16.1 M5 实际新增的组件（实现名 + 落点 + 职责）

| 组件 | 落点 | 职责与关键约定 |
|---|---|---|
| `ShareDialog` | `features/shares/ui/ShareDialog.tsx` | 笔记「更多 › 分享」打开的**创建**弹窗。只做创建 / 复制 / 撤销——**改密与改期在设置页**（刻意不维护两套编辑面）。密码可选，留空即「无需密码」；有效期五档取 `model.ts` 的 `SHARE_EXPIRY_CHOICES`，**默认 7 天**。**单篇加密 / 加密空间内条目置灰并说明原因**（服务端 `POST /api/shares` 另有同语句硬校验，双保险），锁定态同样禁用。链接**就地产出**，不靠服务端换链接；`.sharelink` 样式保证长链接断行 |
| `MySharesPage` | `features/shares/ui/MySharesPage.tsx` | 「设置 › 分享」页：复制链接 / 改密码 / 改有效期 / 撤销。撤销**就地二次确认并写明后果**（破坏性动作必须可见，`DESIGN.md` §5.1-2） |
| `ShareViewerApp` | `features/share-viewer/ui/ShareViewerApp.tsx`（特性根 `main.tsx`） | 访客只读查看器。**四态**：加载 / 链接已失效 / 密码解锁 / 只读内容；**无密码也走 unlock** 换 1 小时无状态令牌。**由 `apps/web/src/main.tsx` 按 `/s/<sid>` 动态 `import()`——不是独立 html 入口**（原定 `share.html` 因 `@cloudflare/vite-plugin` v1.60 对第二个 html input 报 `UNRESOLVED_ENTRY` 未采用，改走 Static Assets 的 SPA 回退） |
| 无新组件 | 复用 `features/tables/ui/TableGrid`、`GalleryView` | 查看器的只读表格与图册**直接复用既有组件**，不另写一套；**不提供筛选排序控件**（Q18 建议案） |

### 16.2 查看器与既有组件的渲染契约

- 正文复用 `MarkdownPreview`（markdown-it + DOMPurify），**渲染契约与主应用一致**，不为查看器另起一套。
- DOMPurify 增加**查看器专用** `allowBlobUris` 开关：只放行**本会话刚取回的 object URL**（附件经 `X-Menote-Share` 头取回字节后本地 `URL.createObjectURL` 改写引用），不放行任意外链 blob；组件卸载时 `revoke`。
- `<img src>` 无法带自定义令牌头，故**逐个**取附件字节再改写引用；**单个附件失败不阻断整篇正文**。
- 表格条目按 `mdcore.parseTableDocument` 解析后走只读网格；「表格 / 图册」切换仅在**有图片引用**时出现。

### 16.3 收敛与订正

1. **§十五.3 第 6 条关于 `InfoHint`「未做」的记录作废**——该组件已实落于 `app/ui/InfoHint.tsx`（ⓘ + 悬停，12+ 处调用）。本轮随 M5 分享一并发现并订正。`Drawer` 仍未做。
2. `ShareDialog` 与 `MySharesPage` **共用 `features/shares/model.ts`**：密码派生走 PBKDF2（与认证同一思路，明文密码不出浏览器）；链接拼装**优先实例配置的分享子域，未配置退回当前站点 origin**（同域 `/s/<id>` 同样可用）。
3. **两处断链修复**：6.8 `AddEntryDialog` 的「原型 / 需求」两行原指向 `docs/modules/Menote-添加内容窗口-设计-v1.md`（该文件已归档），改指 `…-v2.md`。

### 16.4 已知未实现（M5，登记在案）

1. **Memo 固定合集**（功能拆解 M14-02）：`share_items` 表已随迁移 0005 建好，**UI 不接**，等后续细则。
2. **访客侧筛选 / 排序**：刻意不做（Q18 建议案）。
3. **移动端查看器观感**：`DESIGN.md` §2.4 窄屏布局尚未定稿，不据此写码。
