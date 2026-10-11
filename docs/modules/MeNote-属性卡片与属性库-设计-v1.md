# MeNote 属性卡片与属性库 · 重设计 v1

| 项 | 内容 |
| --- | --- |
| 文档版本 | v1.4 |
| 文档状态 | **生效**（用户 2026-10-11 批准：按此稿实现，并授权改 `DESIGN.md` §5.3 / §5.6 与 `packages/shared` 的 `prop_labels`） |
| 目的和适用范围 | 重画正文区顶部的**属性卡片**与设置 › **属性库**两屏，并新增一条**显示名**（界面叫法）规则。适用于 `apps/web` 的属性卡片、设置 › 属性库、导入录入步，以及 `user_settings` 契约（**卡片的位置与折叠方式 v1.3 起归 `docs/modules/MeNote-属性卡与大纲悬浮-设计-v1.md`**） |
| 权威级别 | 模块规则（不覆盖 `wiki/`；`DESIGN.md` 与 `packages/shared` 的改动已获用户授权，见 §7） |
| 最后更新日期 | 2026-10-11 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
| --- | --- | --- | --- | --- |
| v1 | v0.8.31 | 2026-10-11 | 首稿：起因与现状盘点、「属性卡片合成一张两列表」「行内提示」「属性库页表格化 + 内置键开放显示名与候选取值」「显示名（`prop_labels`）」 | deepseek-v4.1-flash |
| v1.1 | v0.8.32 | 2026-10-11 | 转「生效」并落实现：订正 §3.2 两处（**自建行键名仍可改**——保留既有的改名能力；**内置行候选取值只读展示**——它们不在 `prop_library` 里，扩展值域是 §8 的路 B）；§4.4 补「设置页与卡片同源」；§6 验收点逐条勾选 | deepseek-v4.1-flash |
| v1.2 | v0.8.33 | 2026-10-11 | 修用户报出的「设置页乱飞」：**控件的固有宽度压到隔壁列**（`.field__input` 不设宽度，进 grid 就退回固有宽度）→ 立 `.proplib__row .field__input { width:100%; min-width:0 }`；§3.2 的列宽取值按实现订正（样机那套更宽、790px 卡片放不下），两处下限改 `minmax(0, …)`；降级断点由拍的 900px 改为**按可用宽度反推的 940px**；内置行「操作」格给破折号、「显示名」占位文字缩短 | deepseek-v4.1-flash |
| v1.3 | v0.8.34 | 2026-10-11 | 按用户第二轮反馈**把「位置与折叠」整块移交新稿**：属性卡搬进正文区左侧贴边面板（见 `docs/modules/MeNote-属性卡与大纲悬浮-设计-v1.md`），本稿**只订正因它失真的三处**——§2.4「未入库」改为行尾 24px 图标按钮（虚线 chip 与 11px 说明行删除）、§2.5 类名清单（删 `__toggle`/`__summary`/`__lib`/`__libline`，增 `__sep`/`__group`/`__icobtn`/`--card`；`__note--warn` 不再使用）、§2.6 折叠态（卡片不再自己折叠，`collapsedSummary` 与旧 key 一并退役）。**卡片行结构、属性库表格、显示名规则、数据契约一字未改** | deepseek-v4.1-flash |
| v1.4 | v0.8.35 | 2026-10-11 | 两处：①**修用户报出的「改一次属性就出现两条」**（`mdcore` 的 `writeForeignKey` 插入分支不问「这一段里有没有这个键」，被改的键排在自有键之后时会写重）——本稿 §2 的「外来键原位替换、不存在才插在第一个自有键之前」口径**不变，是代码改正过来**；②纸面 740 → **800**、内边距 → 48px（用户第三轮反馈），§2.5 里那条共用列宽口径随之更新 | deepseek-v4.1-flash |

---

## 0. 先读这一节（本次边界）

**只动表现层 + 一条显示映射**：

- 不改 md 格式、不改 `mdcore` 的解析与往返、**无数据迁移**；
- 不碰 `menote:` 块、`items` 四列、清单三键平铺、备份格式契约里写进 md 的那部分；
- 「显示名」只活在界面，**永不写进 md、导出、分享、备份、MCP**。

原型：`deliverables/props-redesign/mockup.html`（截图同目录 `shot.png`）——**该目录不入库**（`.gitignore:9`），只作评审材料。

---

## 1. 起因（用户 2026-10-11 报出四点）

> 现在识别了，但是这块的样式太丑了。你看首先顶部样式很粗糙，而且乱七八糟的提示，为什么中间有黄字提示，属性录入后还与内置属性有区分。整个页面你全局重新设计。第二是设置的属性库里面行都没有对齐，内置属性也不能编辑修改。并且我需要加一个翻译栏，可以设定属性源名和翻译，这样方便将外部英文属性兼容为中文，这个翻译明只需要保留在项目中即可，不需要随文档导出，导出时还是源属性名

| 用户看到的 | 根因（v0.8.30 现状） | 本稿的改法 |
| --- | --- | --- |
| 顶部粗糙、像两套东西拼在一起 | 上半是内置四行（`ItemProps.tsx:353` 的 `.itemprops__group` + `.itemprops__row` = `grid 72px 1fr`），下半是外来键段（`.itemprops__group--foreign`：另一套列宽 + 等宽键名） | §2：合成**一张两列表**，内置与外来同一种行 |
| 中间那行黄字 | `.itemprops__warn`（`ItemProps.tsx:493`）是**段级横条**，位置在四行之下、外来段之上，讲的却是 status 那一行 | §2.3：挪进它讲的那一行 |
| 值控件参差 | 文本 input 会拉伸、select / date 各有宽度 | §2.2：值控件统一 `width: 100%`，共享同一右边界 |
| 属性库行不对齐 | `.proplib__row`（`app.css:1436`）是 4 列 grid，但键名下挂着「被 N 篇用到」的小字把行撑高；内置卡（`PropLibraryPage.tsx:227`）是**另一套 4 个 `span`**、没定义列宽 | §3：两卡合成一张表 + 表头，共用一份列宽 |
| 内置属性改不了 | 内置卡里没有任何输入控件 | §3.2：显示名与候选取值开放，键名与类型锁定 |
| 想要"翻译栏" | 没有 | §4：新增**显示名**（`user_settings.prop_labels`） |

术语：用户 2026-10-11 更正——「感觉应该叫**显示名**更准确」，本稿统一用**显示名**。

---

## 2. 属性卡片

### 2.1 结构（块清单）

```text
正文区（标题带之下、格式工具栏之上）
└─ <section class="itemprops" aria-label="属性">
   ├─ 折叠行：chevron + 「属性」（折叠态另加摘要）
   └─ 行表格（三列 grid：名 88px | 值 minmax(0,1fr) | 操作 24px）
      ├─ 标签     | chip 组 + 「+ 添加」              |
      ├─ 状态     | 枚举 select                       |
      │           └─ 该行提示（认不出的值时才出现）
      ├─ 截止     | 日期 input                        |
      ├─ 优先级   | 枚举 select                       |
      ├─ <外来键> | 单行 / 多行 / 日期 / 是-否 / 定值   | ⓧ
      │           └─ 「未入库」chip（该键不在属性库时才有）
      └─ 末行     | 「+ 用一个属性」
```

1. **不再有**「其他属性 · 键名原样保留」分区头，**不再画**原来那条 `.itemprops__group--foreign` 的分隔线——内置与外来靠行序与留白区分，不靠版式区分（用户第 1、4 点）。
2. 行序固定：内置四行 → 外来键（按 md 里的顺序）→ 末行按钮。
3. 卡片带仍与正文同一口径（共享列宽的 `max-width` 与内边距，与 `.editor-toolbar__inner` 同一份规则），这个不改——只是取值随纸面走了：v0.8.35 起 `max-width: **800px**` + `padding: 0 **48px**`（v0.8.32 时是 740px / `--sp-6`）。

### 2.2 行规范

- 行：`display: grid; grid-template-columns: 88px minmax(0, 1fr) 24px; gap: var(--sp-3); align-items: start; padding: 5px 0;`
- 名列：`font-size: var(--fs-small); color: var(--muted); padding-top: 5px;`；文字见 **§4 显示名规则**；`title` 永远是源名。超过 6 个汉字折行、不截断（`word-break: break-word`）。
- 值列：`display: flex; flex-direction: column; gap: 3px; min-width: 0;`
  - 控件统一：`width: 100%; min-height: 28px; padding: 0 var(--sp-2); background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: var(--fs-small);`；焦点 `border-color: var(--primary)` + `box-shadow: 0 0 0 3px var(--primary-soft)`。
  - 类型 → 控件：单行文本 `<input>`；块序列 `<textarea rows="1">`（可拖高）；日期 `<input type="date">`；定值（枚举）与是 / 否 `<select>`；标签仍是 chip 组。
  - **所有控件的右边界相同**（这就是"值控件不再参差"的做法）。候选值的 `datalist` 提示沿用 `PropValueField` 现成能力，不改。
- 操作列：外来键的 ⓧ（`aria-label="本篇不再用 <键名>"`，二次确认文案照现状）；内置四行此列为空。
- 只读态：全部控件 `disabled`，`readOnlyReason` 作为卡片顶部一行可见说明（不是 ⓘ），不渲染 ⓧ / 「+ 添加」/「+ 用一个属性」。

### 2.3 行内提示（那行黄字去哪了）

- 认不出的内置值（路 A，`DESIGN.md` §5.6-5）由**段级横条**改为**该行值控件下方**一行：`⚠ <原值> 不是 MeNote 的值 · 已原样保留`，`color: var(--amber)`、`font-size: var(--fs-micro)`，与值控件左边界对齐。
- 完整解释（"选中别的值才会把它改成 MeNote 的写法"）收进该行 **ⓘ `InfoHint`** 的悬停里。依据 `DESIGN.md` §5.4-2 / §6.1：**警告与错误必须保持可见**（所以短句不藏），说明性文字才进 `InfoHint`。
- 多个认不出的字段各进各的行，不再合并成一句段级文案。

### 2.4 「未入库」标记（**v1.3 已被取代**）

- 外来键不在属性库里时，值控件下方给一个虚线 chip「未入库」（点击 = 收进属性库，即现 `adoptForeign`），后面跟一句 11px 说明「收进属性库后可改类型与候选值」。
- 它只表达**状态**，不是另一套版式——外来键与内置键的行结构完全相同。
- **v1.3（2026-10-11）**：这一处按用户反馈改为**行尾动作格里的 24px 图标按钮**（方框 + 加号，`--primary`），含义进 `aria-label` 与 `title`；那行 11px 说明删掉。理由与取值见 `docs/modules/MeNote-属性卡与大纲悬浮-设计-v1.md` §3.3 与 `DESIGN.md` §5.6-1、-6。

### 2.5 类名约定（实现沿用，便于 `style-coverage.test.ts` 覆盖）

保名：`.itemprops` / `__inner`（`__toggle` / `__toggle--collapsed` / `__summary` 已随折叠控件一起删除，见 §2.6）。
统一：行 `.itemprops__row`、名 `.itemprops__label`、值容器 `.itemprops__ctl`、控件 `.itemprops__input`、提示 `.itemprops__note`（`--warn` 变体 **v1.3 起不再使用**）、操作列 `.itemprops__act`、末行 `.itemprops__foot` + `.itemprops__pick`。
**v1.3 新增**：分组线 `.itemprops__sep` 与分组小字 `.itemprops__group`、行尾图标按钮 `.itemprops__icobtn`（`--danger` 变体给删除）、卡片变体 `.itemprops--card`（进贴边面板后去掉边框与内边距）。「未入库」`.itemprops__lib` 与其说明行 `.itemprops__libline` 删除。
删除确认仍用 `ConfirmDialog`（标题 `本篇不再用 <键名>？`、确认按钮「从本篇移除」）。
实现时逐条清理不再被引用的旧规则（`.itemprops__group--foreign` / `__head` / `__vals` / `__field` / `__value` / `__value--block` / `__x--row` 等）。

### 2.6 折叠态与空状态（**折叠态 v1.3 已被取代**）

- 折叠态：一行 `chevron + 「属性」+ 摘要`。摘要在现 `collapsedSummary` 基础上**用显示名**（§4），例：`标签 2 · 状态 unread · 作者 枕鹤 · 链接 1`；一篇什么都没有时摘要为「未设置」。
  - **v1.3（2026-10-11）**：属性卡**不再自己折叠**——它搬进正文区左侧的贴边面板，展开/收起由那条轨道负责（收起态是 **28px 的竖排把手「属性」**，没有摘要行）。`collapsedSummary` / `summaryValue` / `__summary` / `__toggle` 一并删除；本机偏好键由「折叠态」`menote:notes:props-collapsed` 反向迁移成「展开态」`menote:notes:props-open`。见 `DESIGN.md` §5.6-11、-12。
- 空状态：一篇完全没有属性时**照样渲染四行内置空行 + 末行按钮**（`DESIGN.md` §5.6-2 的"常显"不变）；空值控件显示占位（枚举「未设置」、日期空、标签只有「+ 添加」）。「其他属性」分组头（细线 + 小字）**常显**，空白笔记才有"加一个属性"的去处。
- 空状态、只读态三者可叠加（只读 + 空 = 只读说明 + 四行 `disabled`）。

---

## 3. 设置 › 属性库

### 3.1 结构

原「属性库」+「内置属性」**两张卡合成一张**：

```text
设置 › 属性库
└─ .setcard[aria-label="属性库"]
   ├─ 标题「属性库」+ 一句副标题（这一屏是干什么的）
   ├─ 新建行：[键名] [类型 ▾] 「新建」     ← 三件成组靠左，不拉到整行
   ├─ 表头：属性名 / 显示名 / 类型 / 候选取值 / 用到 / 操作
   ├─ 数据行：内置五行在上（带「内置」badge）→ 自建键
   └─ 脚注：统计口径（只数本机已有正文）+ 显示名边界
```

### 3.2 列规范（表头与数据行共用同一份 grid）

`grid-template-columns: 7.5rem minmax(0, 1fr) 7.5rem minmax(0, 1.3fr) 4.5rem 3.5rem; column-gap: var(--sp-2);`

**v1.2 实现订正（列宽与三处细节）**：上面这份取值是与实现逐字对齐后的版本（此前写的 `10rem minmax(9rem,1.1fr) …` 是画样机时按**更宽的容器**取的，设置页卡片上限只有 790px、真放不下）；两处 `minmax(0, …)` 的**下限必须是 0**——写 `6.5rem` 这类下限会让六列在窄一点的窗口里合起来超过卡片宽度，把整页撑出横向溢出。配套还有一条**根因规则**：

- **表格里的控件必须自己填满格子**：`.field__input` 本身**不设宽度**（它靠外面给宽），放进 grid 就退回固有宽度（`<input>` 约 153px、`<select>` 随最长选项），格子一窄过它就压到隔壁列上——表头那些字还在格线上、控件却越过去了，看起来整页"乱飞"（用户 2026-10-11 的原话）。所以 `.proplib__row .field__input { width: 100%; min-width: 0; }` 是**必需**的两半：没有 `width: 100%` 就填不满，没有 `min-width: 0` 就顶住 grid 不让格子再收窄。

| 列 | 内容 | 可编辑 |
| --- | --- | --- |
| 属性名 | 等宽键名（`--mono`）；内置行加「内置」badge | 内置行否（键名是 md 契约）；**自建行可改名**（只改库里叫法，md 不动，v1.1 订正） |
| 显示名 | `<input>`；placeholder = 默认叫法（内置行 = 内置中文名，自建行 = 「未设显示名」，v1.2 缩短——格宽只有 120~150px，长句必被截且没有省略号） | 是（内置也行） |
| 类型 | 内置行：`disabled` 的 select + `title="内置键的类型由功能语义决定，不可改"`（`DESIGN.md` §6.1：禁用必须说明原因）；自建行：六种可选 | 仅自建行 |
| 候选取值 | `text` / `multiline` / `choice` 可填（逗号分隔）；`date` / `number` / `boolean` 显示 `— 这种类型没有候选取值` | 自建行可填；**内置行只读展示功能值域**（`status` → `todo、doing、done`、`priority` → `high、medium、low`，v1.1 订正） |
| 用到 | `N 篇` / 「还没被用到」/「统计中…」/「—」（统计失败） | 否 |
| 操作 | 自建行「删除」（危险色，二次确认）；内置行 `—`（v1.2 给一个破折号：留空格子看着像"漏了按钮"） | — |

- 内置行整行带 `background: var(--bg-soft)` 淡底，让"内置在上"一眼看出（不是另一套版式）。
- 窄屏（**窗口 < 940px**）：整表降级为**堆叠块**（每行一块、列名作前缀），不出现横向滚动条（守 `DESIGN.md` 的移动端约束）。**940 是算出来的**：六列的"能看"下限 ≈ 120+120+120+140+72+56 + 五个列间距 40 ≈ 670px 格宽，反推卡片 702px、设置页正文 750px、窗口 ≈ 934px（设置页左边还常年占着 184px 导航）——取整到 940。（v1.2 订正：此前写的 900px 是拍的数，没把导航 184px 与卡片 790px 上限算进去，于是 900–1020px 这段窗口里六列被硬挤。）
- **v1.1 实现订正（两处）**：① 内置行的「候选取值」是**只读展示**——内置键不进 `prop_library`（`normalizeLibrary` 一律剔内置），它们的值域由功能语义定死，扩展值域是 §8 的「路 B」；② 自建行的键名**保留可改**（沿用既有 `renameEntry`：改的只是库里的叫法，`md` 一个字不动），与"属性名列不可编辑"的初稿相反。

### 3.3 空 / 错误 / 删除

- 空库：内置五行照列（它们永远在），自建区显示一行「还没有自建属性」，说明新建之后就能在卡片里「+ 用一个属性」选到它。
- 新建非法 / 保留字 / 重名：新建行下方 `role="alert"` 就地提示（照现状）。
- 删除条目二次确认：标题 `删除属性 <键名>？`，后果照现状（"已用它的笔记 md 一动不动，只是变成未入库的键"），确认按钮「删除条目」。
- **删条目不动显示名**（设计 §4.1 的直接推论）：`prop_labels` 独立于条目，删了条目、以后再加回这个键，用户设过的叫法还在。确认框里把这一句写出来，免得用户以为"连翻译一起删了"。

---

## 4. 显示名

### 4.1 数据落点

`packages/shared/src/settings.ts` 的 `UserSettingsSchema` 新增可选字段（与 `prop_library: v.optional(...)` 同款写法）：

```ts
/** 显示名（2026-10-11）：只改界面上的叫法，md / 导出 / 分享 / 备份一律源名 */
prop_labels: v.optional(v.record(v.string(), v.string()), {}),
```

`DEFAULT_USER_SETTINGS.prop_labels = {}`。**账号级**、跟账号同步、**不进 md**（valibot 1.5 的 `v.record` 已实测可用）。
独立于属性库条目的理由（用户 2026-10-11 选定）：能覆盖内置键（`title` / `tags` / …）与**未入库**的键；删属性库条目不会连带丢显示名。

### 4.2 取值规则

```text
显示名(key) = prop_labels[key]（非空时）
            : 内置键 → 内置中文名（title 标题 / tags 标签 / status 状态 / due 截止 / priority 优先级）
            : 其余   → 直接显示源名
```

### 4.3 生效范围（硬边界）

| 生效 | 永不生效 |
| --- | --- |
| 属性卡片的行名 | md 正文与 front matter |
| 「+ 用一个属性」菜单的条目 | 预览档 |
| 设置 › 属性库的「显示名」列 | 分享页 |
| 导入时的录入步 | 导出的 md |
| 折叠态摘要 | 备份 / 恢复 |
|  | MCP 的输出 |

一句话：**显示名只活在界面**——导出仍写 `url:`，不是 `链接:`。

### 4.4 编辑入口

唯一入口是设置 › 属性库的「显示名」列（"前台只能选用不用"的口径不变，卡片上不给改名入口）。卡片行名的 `title` 给源名（用户 2026-10-11 选定：只显示中文，源名悬停才能看；没设显示名就直接显示源名）。

---

## 5. 影响与要回写的定稿

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/features/notes/ui/ItemProps.tsx` | 按 §2 重画（提示搬进行内、接显示名） |
| `apps/web/src/app/theme/app.css` | `.itemprops*` 与 `.proplib*` 重写 |
| `apps/web/src/features/props/ui/PropLibraryPage.tsx` | 按 §3 改成一张表 + 显示名列 + 内置键可改显示名（实现时：内置行的键名 / 类型 / 候选锁定，见 §3.2 订正） |
| `apps/web/src/features/props/model.ts` | 加 `BUILTIN_PROP_LABELS` / `PropLabels` / `labelFor(labels, key)` / `withPropLabel(labels, key, value)` / `builtinValueOptions(key)` |
| `packages/shared/src/settings.ts` | 加 `prop_labels`（**公共类型，已授权**） |
| `apps/web/src/features/props/ui/PropPicker.tsx` | 菜单条目按显示名 + `title` 给源名 |
| `apps/web/src/app/App.tsx`→`NotesSlot.tsx`→`workarea/NotesPane.tsx`→`notes/ui/NoteWorkspace.tsx` | `propLabels` 一路透传到属性卡片 |
| `apps/web/src/features/settings/ui/SettingsPanel.tsx` | `patchPropLabels` + 把两个 props 传给 `PropLibraryPage` |
| `DESIGN.md` §5.6 | 重写（卡片两列表、提示行内、属性库一张表、内置键可编辑范围、显示名）——**全局视觉，已授权** |
| `DESIGN.md` §5.3 | 「条目属性 → 胶囊 chip」收窄为"标签行仍是 chip；其余属性行走两列表" |
| `docs/modules/MeNote-属性库-设计-v1.md` | §3.4「不汉化键名」收窄成"不汉化**键名本身**"；§6.2 内置区改口径 |
| `apps/web/test/{item-props,props-library,props-field,props-model,focus-visibility,style-coverage}.test.*` | 随类名与结构更新 |

---

## 6. 验收点（v1.1：已逐条落地；v1.2 修了最后两条）

- [x] 卡片只有一种行结构，没有「其他属性」分区头与分隔线（`ItemProps.tsx` 已无 `__group` / `__head` / `__warn`）
- [x] 认不出的值：提示在自己那一行内、颜色 `--amber`、可见；完整解释在 ⓘ（用例断言 `/unread 不是 MeNote 的值 · 已原样保留/`）
- [x] 值控件右边界一致、行高一致（`.itemprops__row` = `88px minmax(0,1fr) 24px`，控件统一 `.itemprops__input { width: 100% }`）
- [x] 属性库：表头与数据行同列宽；内置行**可改显示名**、类型锁定且禁用处有 `title` 说明（候选值为只读展示，见 §3.2 订正）
- [x] 显示名在 §4.3「生效」五处生效；在「永不生效」六处仍是源名（它是 `user_settings` 的字段，`mdcore` / 分享 / 导出 / 备份 / MCP 全都读不到它）
- [x] **表格里的控件填满自己那一格**（v1.2）：`.proplib__row .field__input { width: 100%; min-width: 0 }`，并有 `apps/web/test/proplib-css.test.ts` 钉住（用户 2026-10-11 报的「设置页乱飞」就是缺这一条）
- [x] 窄屏（**< 940px**）属性库不横向滚动（`@media (max-width: 940px)` 降级为堆叠块；940 的来源见 §3.2）
- [x] `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿（v0.8.32：mdcore 139 / shared 117 / web 1498 / worker 371 = 2125 passed；v0.8.33 已重跑）

---

## 7. 待用户确认（实现前）

**用户 2026-10-11 已批准三件**：

1. `DESIGN.md`（§5.3 收窄 + §5.6 重写）——全局视觉。**已授权**
2. `packages/shared/src/settings.ts` 新增 `prop_labels`——公共类型。**已授权**
3. 值控件统一 `width: 100%` 这个做法（枚举与日期也跟着拉满，换来整齐的右边界）。**已按此实现**

---

## 8. 不在本期

- 路 B（内置键值域扩展 + 归一档），另开一稿。
- 显示名写进 md / 导出（用户明确不要）。
- 属性卡片上直接编辑显示名。
- 属性库与显示名进备份（`packages/shared/src/backup.ts:32` 的 `SETTINGS_NAME` 至今无代码引用）。
