# MeNote YAML frontmatter 兼容与标题入档 — 实施计划 v1

- **文档版本**：v1
- **文档状态**：生效
- **目的和适用范围**：把设计稿 `docs/modules/MeNote-YAML-兼容与标题入档-设计-v1.md` 拆成可执行的步骤。范围仅限 `packages/mdcore` 的 front matter 口径、`tags` / `title` 的派生与写入路径。**不改 `wiki/`**（设计稿 §8 已逐条对齐，步 1/2 无需改 wiki；步 3 的 wiki 回写待实施完成后单独征得同意）。
- **权威级别**：临时规则（本轮执行用，做完归档）
- **最后更新日期**：2026-10-04
- **对应设计**：`docs/modules/MeNote-YAML-兼容与标题入档-设计-v1.md` v1
- **应用版本**：v0.8.10

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型 |
|---|---|---|---|---|
| v1 | v0.8.10 | 2026-10-04 | 首稿：四步拆解与验收点 | MiniMax M3.1 |

---

## 目标

一篇从 Obsidian 导入的笔记，在 MeNote 里加标签 / 标待办 / 改标题之后：

1. frontmatter 仍是**合法 YAML**，外来属性一根不动；
2. 刚写入的值**读得回来**（不再自己丢）；
3. `tags` 认顶层（与定稿一致），老笔记照样读得到；
4. `title` 在 md 里，往返不丢。

---

## 拆步

> 状态：**三步全部完成**（2026-10-04）。验收点逐条勾选见下。

### 步 1 — P0 修复 + `preservedLines` 语义拆分

**涉及文件**
- `packages/mdcore/src/frontmatter.ts`（核心）
- `packages/mdcore/src/table.ts`（`parseTableDocument` 的输入确认收窄到 `preservedLines`）
- `packages/mdcore/src/index.ts`（导出）
- `packages/mdcore/test/frontmatter.test.ts`（补分支用例）
- `packages/mdcore/test/table.test.ts`（外来 `columns:` 不被误读）

**做什么**
1. `updateMenoteKeys` 的 `headFixed` 三元改成后置带冒号：`[...head, `${MENOTE_KEY}:`]`。
2. `parseMenoteMeta` 拆出 `foreignLines`；「无 `menote:` 块」分支改为整块进 `foreignLines`、`preservedLines` 置空。
3. 补测试：外来 front matter + patch 的**输出形状**与**再解析能读回**。

**验收点**
- [x] 外来 frontmatter + `{tags:["x"]}` → 输出含 `menote:`（带冒号）且在块末尾；外来键全在、缩进不变
- [x] 该输出**再解析**得 `tags === ["x"]`
- [x] 表格的 `columns` / `views` 仍原样保留（现有用例不回归）
- [x] 外来文档含 `columns:` 键时，`parseTableDocument` 判 `ok: false`（不被当成表格列定义）
- [x] **追加发现**：外来键与 `menote:` 块并存时，此前也会前置一个裸 `menote` 把块劈成两半——同一行代码，一起修

### 步 2 — `tags` 平铺

**涉及文件**
- `packages/mdcore/src/frontmatter.ts`（顶层 `tags` 的读与写）
- `packages/mdcore/src/tags.ts`（`deriveTags` 双读、顶层优先）
- `packages/mdcore/test/{frontmatter,tags}.test.ts`

**做什么**
1. 顶层键的解析按**白名单**（只 `title` / `tags`），其余进 `foreignLines`。
2. `MenotePatch.tags` 的改写目标改为顶层段；`buildDocument` 把 `tags` 写到顶层。
3. `deriveTags` = 顶层 `tags` ∪ `menote.tags` ∪ 正文 `#标签`，顶层优先。

**验收点**
- [x] 新写出的文档 `tags` 在**顶层**，`menote:` 块里不再有 `tags`
- [x] 老文档（`menote.tags`）`deriveTags` 结果不变
- [x] 同时有顶层与 `menote.tags` 时，顶层胜出（含 `tags: []` 显式空的场景）
- [x] 外来 `title` / `url` / `status` 等键保存后一字不变
- [x] **追加发现**：`renderTableDocument` 写死 `tags: []`，顶层化后每次单元格编辑都会清空标签 → `TableDoc` 补 `tags`
- [x] **追加发现**：`needsQuote` 漏了 `:` 与 `#`，半角 `title: 第 3 章: 笔记` 是非法 YAML → 一并补上（属同一函数内的既有缺陷）

### 步 3 — `title` 进 md

**涉及文件**
- `packages/mdcore/src/frontmatter.ts`（`MenoteMeta.title`、`MenotePatch.title`、`deriveTitle`、顶层键白名单）
- `packages/mdcore/src/index.ts`（导出 `deriveTitle` / `DerivedTitle`）
- `packages/mdcore/src/table.ts`（`TableDoc` 补 `title`，否则改一个单元格就丢外来标题）
- `packages/mdcore/test/frontmatter.test.ts`
- `apps/web/src/features/notes/actions.ts`（**新建**：`writeItemTitle`，md + 派生列一起写）
- `apps/web/src/features/notes/useNotesWorkspace.ts`（`changeTitle` 改为调它）
- `apps/web/src/features/notes/useNoteCreation.ts`（新建笔记 / 表格时把 `title:` 写进 md）
- `apps/web/src/features/notes/import-md.ts`（`titleForImport`：frontmatter 优先于文件名）
- `apps/worker/src/services/mcp/write-parts.ts`（`buildItemBody`：`create_item` 的 title/tags/task 进 md）
- `apps/worker/src/services/mcp/tools-write.ts`（接上）
- `apps/web/test/notes-title-md.test.tsx`（**新建**）、`apps/web/test/import-md.test.ts`、`apps/worker/test/mcp-write.test.ts`

**验收点**
- [x] 改标题 → md 顶层 `title:` 更新，且本地列同步
- [x] `present=false` 的存量笔记：行为与今天一致（列仍权威）
- [x] Memo 的 md 里**没有** `title:` 键
- [x] 表格条目的 `title` 与 `menote:` 块并存不冲突
- [x] 导入带 `title:` 的 Obsidian 文件 → 标题取 frontmatter 而非文件名
- [x] 外来 front matter / `menote:` 块 / 正文都不被改标题动到
- [x] MCP `create_item` 的 title/tags/task 进 md；Memo 不写 `title:`；agent 自写的 front matter 原样保留

### 步 4 — 收尾

- [x] `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿（1925 用例）
- [x] 根 `package.json` 版本 → **v0.8.10**（同一问题三批合并，一次性 +0.0.1）
- [x] `CHANGELOG.md` 顶部追加 `## 2026-10-04` 条目
- [ ] 征得用户同意后，回写 `wiki/Menote-功能拆解-v2.md`（补 title 口径）—— **待用户拍板**

---

## 风险登记

| 风险 | 缓解 |
|---|---|
| 顶层键白名单漏了某个 MeNote 自有键 | 白名单只有 `title` / `tags` 两个，其余一律 `foreignLines`；步 2 验收点专门覆盖"外来键保存后一字不变" |
| `preservedLines` 语义变更波及表格 | `readTableKeys` 只吃 `preservedLines`，语义收窄只会让它更安全；现有 8 条表格用例作回归网 |
| `changeTitle` 改成双写后丢字 | `TitleInput` 的 `flush` 在卸载前必跑；沿用 `writeTaskFields` 的顺序（先 `saveDraft` 再更新列） |
| 步 3 触及 `items.title` 的 NOT NULL CHECK | 服务端不派生（设计稿 §6.3），客户端派生空值回落兜底 |
