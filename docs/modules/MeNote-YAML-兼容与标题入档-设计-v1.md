# MeNote YAML frontmatter 兼容与标题入档 — 设计 v1

- **文档版本**：v1.2
- **文档状态**：生效
- **目的和适用范围**：让 MeNote 的条目 md 能与外部 Markdown 工具（以 Obsidian 为例）双向兼容。覆盖 `packages/mdcore` 的 front matter 读写口径、`tags` 与 `title` 的派生与写入路径、以及外来键的保留规则。**不含**双向自动同步与阅读状态。
- **权威级别**：模块规则（`wiki/` 定稿的补充与澄清；与定稿冲突处以 `wiki/` 为准，本稿已在 §8 逐条对齐）
- **最后更新日期**：2026-10-04
- **应用版本**：v0.8.10
- **实施计划**：`docs/todo/MeNote-YAML-兼容与标题入档-实施计划-v1.md` v1（三步已全部完成）

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型 |
|---|---|---|---|---|
| v1 | v0.8.10 | 2026-10-04 | 首稿：P0 改写修复、`preservedLines` 语义拆分、`tags` 平铺、`title` 入 md | MiniMax M3.1 |
| v1.1 | v0.8.10 | 2026-10-04 | 实施后回写：顶层键白名单（`foreignLines` 剔除自有键）、`TableDoc` 补 `tags`/`title`、MCP `create_item` 已同步、`organize_item` 列为待拍板 | MiniMax M3.1 |
| v1.2 | v0.8.10 | 2026-10-04 | 补 §8 显示口径：预览剥 front matter（既有缺陷）、编辑器用装饰藏成可点芯片（纯视觉，不动保存链路） | MiniMax M3.1 |

---

## §1 目标与范围

### 1.1 要解决的三个问题

用户从 Obsidian 导入的 `.md` 带**平铺顶层 YAML**（`title` / `url` / `author` / `captured` / `tags` / `like` / `comment` / `status`），而 MeNote 的自有键一律嵌在 `menote:` 根键下。由此产生：

1. **P0（数据丢失）**：给导入的笔记写任何 MeNote 字段（标签 / 清单）会**产出非法 YAML**，并且**刚写入的值读不回来**。
2. **标签不互通**：Obsidian 的顶层 `tags` 对 MeNote 不可见，该笔记在 MeNote 里没有标签，进不了标签筛选与搜索。
3. **标题会丢**：`items.title` 只存在于数据库列，md 里没有；往返一趟标题只能靠文件名承载。

### 1.2 本稿做三件事

| 步 | 内容 | 性质 |
|---|---|---|
| 步 1 | 修 P0 改写 bug；把 `preservedLines` 语义拆干净 | **修 bug**（现状即数据丢失） |
| 步 2 | `tags` 移到顶层平铺，双读兼容老笔记 | **回归定稿**（定稿本就写 `tags`） |
| 步 3 | `title` 进 md，md 为准、`items.title` 降为派生列 | 新能力（定稿未覆盖，需回写） |

### 1.3 明确不做

- **通用 YAML 解析器**。仍是零依赖的有界子集（`frontmatter.ts` 文件头的理由成立：md 是我们自己生成的，读入只需要有界子集）。
- **双向自动同步**。落盘布局是 `snapshot/notes/<itemId>.md`（ULID 命名），真双向还要冲突合并、id↔路径映射、删除传播——是独立里程碑。本稿只保证**文件层面可互通**。
- **阅读状态**。Obsidian 那个 `status: unread` 是阅读态，MeNote 无此概念，且 `status` 这个键名在 MeNote 里语义已被别的用途占用。**不映射**，按外来键原样保留。
- **Git 备份目标**。仍按既定决定后置（`BackupTargetKinds` 只有 `webdav` / `s3`）。

---

## §2 键位布局（本稿的核心口径）

frontmatter 分两层，**各管各的，不互相解释**：

```yaml
---
# —— 顶层：跨工具通用 ——
title: 三体读书笔记          # MeNote 认
tags: [科幻, 长篇]          # MeNote 认
url: "https://…"            # 外来：原样保留，MeNote 不解释
author:                     # 外来：原样保留
  - "Unknown"
status: unread              # 外来：原样保留

# —— menote 块：MeNote 私有，表格键保持设计文档 §10.2 的嵌套形状 ——
menote:
  type: table
  row_id_column: _id
  columns:
    - { id: 书名, name: 书名, type: text }
  views:
    default: table
---
```

### 2.1 顶层：MeNote 只认 `title` 与 `tags` 两个键

**必须用白名单，不能像 `menote:` 块那样"未识别的键也去解释"。** 理由：顶层是外来工具的地盘，撞名代价远高于收益。

| 键 | 谁认 | 说明 |
|---|---|---|
| `title` | MeNote | 步 3 引入 |
| `tags` | MeNote | 步 2 引入；对齐定稿 §528 / 功能拆解 §333 |
| 其它任意 | 都不认 | 原样保留，见 §4.2 |

### 2.2 `menote:` 块：表格键**保持嵌套**，不参与平铺

这一条是有意不动的，理由两条：

1. **定稿要求**。设计文档 §10.2 的示例（`wiki/Menote-设计文档-v7.4.md:757-770`）明确把 `type: table` / `row_id_column` / `columns` / `views` 嵌在 `menote:` 下。动它就是改定稿。
2. **无收益且有风险**。`columns` / `views` / `row_id_column` 是 MeNote 独有词汇，**没有第二个消费者**——平铺换不来任何互操作；而顶层平铺会让外来文档的 `columns:` 撞进表格列定义（见 §4.3）。

**顶层 `type` 刻意不认**，留给外来：`type: bookmark` 这类值若被 MeNote 当成自己的类型读，就是误读。MeNote 的类型判据仍然是 `menote.type`。

### 2.3 `menote:` 块内保留的键

`type` / `row_id_column` / `columns` / `views`（表格）、`task`（清单）、`converted_to`（Memo 转笔记关联），以及块内**未识别的键原样保留**（表格的其它配置项不能被吃掉）。

---

## §3 步 1：P0 改写修复

### 3.1 现象（实测）

对一篇 Obsidian 文档调用 `updateMenoteKeys(doc, { tags: ["claude"] })`，实际产出：

```yaml
---
menote                              # ← 少一个冒号，这一行成了 YAML 字符串标量
title: "Anatomy of the .claude/ folder"
url: "https://x.com/…"
…
status: unread
  tags: [claude]                    # ← 缩进挂在了一个不存在的父键下
---
```

两个后果叠加：

1. **整块 frontmatter 变成非法 YAML**，外来属性塌进 `menote` 底下，导回 Obsidian 即损坏。
2. **刚写入的值自己丢了**：重新解析得 `tags → []`。

### 3.2 根因

`frontmatter.ts` 的 `updateMenoteKeys` 结尾：

```ts
const head = outerHeader.length > 0 ? outerHeader : [MENOTE_KEY];
const headFixed = head[0]?.includes(MENOTE_KEY) ? head : [MENOTE_KEY, ...head];
```

`MENOTE_KEY` 是裸字符串 `"menote"`，**不带冒号**。当文档"有 front matter 但没有 `menote:` 键"（正是 Obsidian 的形状）时，`outerHeader` = 外来块，于是走进 `else` 分支：塞一个裸 `menote` 到最前，把外来键当成它的兄弟行。

现有 83 个用例全绿，是因为**没有一个覆盖「有 front matter、无 `menote:` 键、再打 patch」这条分支**。

### 3.3 铁律

> **`menote:` 永远是块末尾的平级顶层键，且必须带冒号。外来顶层键原样留在它前面。**

修复就是把 `else` 分支从"前置裸键"改成"**后置带冒号的键**"：

```ts
const headFixed = head[0]?.includes(MENOTE_KEY) ? head : [...head, `${MENOTE_KEY}:`];
```

三种输入的产出形状：

| 输入 | 产出 |
|---|---|
| 无 front matter | `buildDocument` 建块（早返回，不变） |
| 有 `menote:` 块 | 原样（不变） |
| **有外来 front matter** | `[...外来键, "menote:"]` + 缩进子行 —— **本次修复** |

### 3.4 可达性

不是理论问题。`features/tasks/actions.ts:55` 的任务开关就调它；MCP `edit_item` 的 `merge_properties` 模式（`services/mcp/tools-write-edit.ts:186`）也调它。

更糟的是 `writeTaskFields` 在写坏 md 的**同时**还把本地 `is_task` 派生列置 1（`tasks/actions.ts:60-66`）——md 与派生列从此对不上，下次同步按 md 重新派生，任务状态自己弹回去。

---

## §4 步 1（续）：`preservedLines` 语义拆分

### 4.1 现状：它一身二职

`MenoteMeta.preservedLines` 今天的注释是"不解析、但必须原样保留的行"。实际它同时装着两样东西：

1. **外来数据**——`parseMenoteMeta` 在「没有 `menote:` 键」时把整块塞进去；
2. **MeNote 自己的表格列定义**——`parseTableDocument` 把 `preservedLines` 整个喂给 `readTableKeys`，由它按 `columns` / `row_id_column` / `views` 三个键名**二次解析**（`table.ts:415-417`）。

今天两者碰不上（外来块只在"无 `menote:` 块"时出现，而那时表格解析会先因 `meta.type !== "table"` 退出），所以没暴露。**一旦顶层键参与语义，外来文档里一个 `columns:` 就会被 `readTableKeys` 当成 MeNote 的表格列定义读进去。**

### 4.2 拆法

`parseMenoteMeta` 把 `MenoteMeta` 拆成两个字段：

| 字段 | 内容 | 消费方 |
|---|---|---|
| `preservedLines` | **仅** `menote:` 块内未识别的键 | `readTableKeys`（表格键）、`buildDocument` 回写 |
| `foreignLines` | `menote:` 块**之前**的顶层行，且**已剔除 MeNote 自有的顶层键** | `buildDocument` 回写、诊断 |

**顶层键走白名单**（`TOP_LEVEL_KEYS = ["tags", "title"]`），不在白名单的一律进 `foreignLines` 原样保留。这样做的两个理由：

1. 顶层是外来工具的地盘，撞名代价远高于收益——外来文档里一个 `type: bookmark` 若被当成 MeNote 的类型读就是误读；
2. 白名单键**必须**从 `foreignLines` 里剔除，否则 `buildDocument` 重建时会把同一个 `tags:` 写两遍（外来键一份、`meta` 一份）。

**为什么 `foreignLines` 挂在 `MenoteMeta` 上、而不是解析结果的旁挂字段**：整篇重建的入口只有
`buildDocument` 一处，而表格的单元格编辑（`renderTableDocument`）与降级为笔记
（`stripTableMeta`）**都会整篇重建**。挂在 meta 上，重建时经 `{...meta}` 展开自动带过去，
不会像旁挂字段那样要靠每个调用方记得透传——漏一个就是丢一次外来属性。

> **实现期补的一条**：`TableDoc` 同样要带上 `tags` 与 `title`。
> `renderTableDocument` 早先写死 `tags: []`，顶层化之后每次重渲染都会清空用户标签；
> `title` 同理。做这两条时正是它们各自先以"测试挂了"的形式暴露出来的。

### 4.3 顺带钉死的边界

`readTableKeys` 的输入收窄到 `preservedLines`（= 只可能是 `menote:` 块内的行）。**这一条与平铺与否无关，是步 1 的必做项**：不收窄，将来任何"顶层键参与语义"的改动都会踩同一个雷。

---

## §5 步 2：`tags` 平铺

### 5.1 这是回归定稿，不是破定稿

- `wiki/Menote-设计文档-v7.4.md:528`：「标签来自 md 本身（YAML **`tags` 字段**或正文中的 `#标签`）」
- `wiki/Menote-功能拆解-v2.md:333`：同口径

两处都写的是**顶层 `tags`**。现在的 `menote.tags` 是 v0.2.4 实现时自选的一层嵌套（CHANGELOG v0.2.4 记为「`menote:` 根键」的自实现选择），**定稿从未要求过**。

### 5.2 双读 + 只写平铺

- **读**：`deriveTags` = 顶层 `tags` ∪ 旧 `menote.tags` ∪ 正文 `#标签`，**顶层优先**（新的口径压过旧的）。
- **写**：只写顶层 `tags`。`MenotePatch.tags` 的改写目标改成顶层段。

### 5.3 懒迁移，不要迁移脚本

老笔记（`menote.tags`）**读得到**，下次保存时被改写成顶层。逐条惰性发生，不需要一次性迁移、也不需要动任何设备上的存量数据。

---

## §6 步 3：`title` 进 md

### 6.1 派生口径

```ts
deriveTitle(markdown): { present: boolean; value: string | null }
```

| md 状态 | `present` | `value` | 含义 |
|---|---|---|---|
| 有 `title:` 键且有值 | `true` | 字符串 | **md 权威** |
| 有 `title:` 键但为空 | `true` | `null` | 显式清空 → 回落既有兜底 |
| 没有 `title:` 键 | `false` | `null` | **不接管**，沿用 `items.title` 列 |

`present = false` 的回退口径是**懒迁移的关键**：存量笔记 md 里没有 `title:`，行为与今天**完全一致**；某次保存写入 `title:` 之后，该条目标题才改由 md 承载。

### 6.2 真相源

**md 为准，`items.title` 只是冗余派生列** —— 与既有的 `tags` / `task` 同一套哲学（规范数据在 md，列供列表、搜索、MCP 筛选用）。

### 6.3 服务端**不**派生（重要）

worker 从 `@menote/mdcore` 只 import 了 `findSectionRange` / `updateMenoteKeys` / `parseTableDocument` / `renderTableDocument` / `makeRowId`，**没有 `deriveTags` / `deriveTaskFields`**。也就是说：**标签与清单字段一律由客户端派生后，通过既有的 `ItemMetaPatch` 上行，而那个补丁本来就带 `title`。**

`title` 沿用同一口径，**服务端零改动**。这同时绕开了两个本来会咬人的坑：

- **加密条目**：`enc_self = 1` 的条目 body 是信封密文（备份导出文案原话：「加密条目的密文原样导出」），服务端读不到明文，派生不出标题。客户端本地有密钥，派生照常。
- **CHECK 约束**：`items` 表有 `CHECK (type = 'memo' OR title IS NOT NULL)`。服务端若参与派生，md 里的空 `title:` 就会推导出 `null` 而撞约束。客户端派生时按 §6.1 兜底，不产生 `null`。

### 6.4 Memo 禁止 `title:` 键

`assertItemShape`（`services/items.ts:66-75`）要求 Memo 的 `title` **必须为 `null`**（"Memo 没有独立标题"）。因此 **Memo 的 md 里不许出现 `title:` 键**——Memo 的写入路径（`useMemoWrite.ts`）不能带 title。

### 6.5 写入路径照抄 `writeTaskFields`

`changeTitle`（`features/notes/useNotesWorkspace.ts:524-548`）现在只写本地列 + `enqueueMetaPatch`。步 3 之后要**同时写 md 与列**——现成模板就是 `features/tasks/actions.ts:46-68` 的 `writeTaskFields`：

```
读原始 body → updateMenoteKeys(body, { title }) → saveDraft → enqueueBodySave
                                                              → 更新本地列 → enqueueMetaPatch
```

`TitleInput` 的防抖（空闲 400ms / 失焦 / 卸载前 flush）**保持不变**——它只管提交节奏，不关心提交到哪。

---

## §7 风险与边界

| 项 | 处理 |
|---|---|
| 顶层 `title` 与 `items.title NOT NULL` | 服务端不派生（§6.3）；客户端派生时空值回落兜底，不产生 `null` |
| 外来顶层 `title` 覆盖了 MeNote 标题 | 符合预期——这就是"md 为准"。用户在 MeNote 里改标题即改 md，下次保存覆盖外来值 |
| 外来顶层 `type` / `columns` / `views` | **不解释**，进 `foreignLines` 原样保留（§2.1） |
| 表格条目的 `title` | 同样走顶层 `title:`，与 `menote:` 块并存不冲突 |
| 分享 / 备份导出 | 不受影响：`build.ts` 与 `export-note.ts` 都用 `getEditableBody` 取原样 body，md 里多一个 `title:` 键随文带出 |
| MCP `create_item` | **已处理**：`title` / `tags` / `task` 一并写进 md（`write-parts.ts` 的 `buildItemBody`）。否则它们只是服务端派生列，客户端按 md 派生读不到、导出的 `.md` 也不带。Memo 不写 `title:` |
| MCP `organize_item` 改标题 | **未处理，待拍板**：该工具走 meta 通道（`expected_meta_rev`），改标题若要同步改 md 就得升 `rev`，等于把一个元数据操作变成正文写入，与工具现有的 rev 语义冲突。本轮**保持原样**（列仍是权威，行为与今天一致），要改需用户确认 |
| 版本历史 | 快照存的是整篇 md，天然含 `title:`，无额外处理 |

---

| 版本 | 决定 |
|---|---|
| 预览 | **不显示** front matter（`renderMarkdown` 先 `stripFrontmatter`）——见 §8.1 |
| 编辑器（仅编辑 / 即时渲染） | **藏成一个可点的小标签**（`app/editor/frontmatter-hide.ts`）——见 §8.2 |

## §8.1 预览为什么不显示

`renderMarkdown` 把整篇 md 丢给 markdown-it，而**它没装 frontmatter 插件**：开头的 `---`
渲染成分隔线 `<hr>`，结尾的 `---` 是 setext 标题下划线、把 YAML 吞成 `<h2>`。实测那份
Obsidian 文档渲染出来是 `<hr>` + `<h2>title: "…"</h2>` + 正文。

这是**既有缺陷**（MeNote 自己的笔记一直如此，`tags` / `type` 那几行会变成一个标题），
但本轮让它显形：改动前无 meta 的笔记 frontmatter 是空的、预览干净；现在每篇新笔记都带
`title:`，于是每篇都多一条线和一个标题。修法是渲染前先剥壳（没闭合围栏时整篇当正文、
不抛错）。分享查看器走同一个组件，一并受益。

## §8.2 编辑器怎么藏（以及为什么不「只存正文」）

**不采用「编辑器只存正文、保存时再贴回 front matter」**。那条路有个会丢数据的坑：标签、
清单字段、标题都是**菜单动作直接改 md 的**（`features/tasks/actions.ts` 等各自
`readRawBody` 取最新草稿再改）。编辑器若持有一份自己的 front matter 副本、每次打字回贴，
就会把那些刚写进去的改动**抹回去**。要根治得让所有菜单动作改走宿主，那是一次大改。

**所以只动「看得见」这一层**：用 CodeMirror 的 `Decoration.replace`（与 `foldGutter` /
`foldKeymap` 同一套机制，仓库已引入）把 front matter 那一段换成一个可点的小标签。
**文档内容与保存链路完全不经过本模块**——这是本设计的核心约束，也是它的用例钉的东西。

三条配套：

1. **判据与 mdcore 的 `splitFences` 一致**：第一行必须是 `---`、必须能闭合；没闭合就**不隐藏**
   （用户可能正在写第一行，此时隐藏只是干扰）。
2. **光标不许钻进隐藏区**，否则会「明明看不见却能改，改完还找不到」。选区落进去就顶到隐藏区末尾。
3. **可展开**：芯片是真正的 `<button>`，点一下还原原文——front matter 是数据，用户有权看见和改它。
   芯片上显示藏起来的顶层键名（`title · tags`），用户才知道自己藏了什么。
   「是否要默认永不显示」是另一个产品决定，等看过效果再定。

---

## §9 与定稿的关系（逐条对齐）

| 定稿条款 | 原文口径 | 本稿 |
|---|---|---|
| 设计文档 §528 | 「YAML `tags` 字段」 | **顶层 `tags`** —— 一致，无需改 wiki |
| 功能拆解 §333 | 「YAML `tags` 字段」 | **顶层 `tags`** —— 一致，无需改 wiki |
| 设计文档 §10.2 | 表格键嵌在 `menote:` 下 | **保持嵌套** —— 一致，无需改 wiki |
| 需求 §10.2 | front matter = 文档属性 | 扩充为"顶层通用键 + `menote:` 私有块"，属**澄清**而非改写 |
| 标签/清单字段位置 | 「存于该条 Memo 的 YAML」，未规定嵌套 | 沿用 `menote.task`（`is_task` 的判据依赖它，见 `tasks.ts:120-121`） |

**结论：步 1 与步 2 不需要改动 `wiki/` 任何文件。** 步 3 引入的新能力（标题入 md）定稿未覆盖，需在**实施完成后**回写 `wiki/Menote-功能拆解-v2.md`（补一条 title 的口径）——按 AGENTS.md 的规矩，改 `wiki/` 须先经用户明确同意，本稿不代劳。
