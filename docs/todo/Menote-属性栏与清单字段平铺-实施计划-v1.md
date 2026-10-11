# MeNote 属性栏与清单字段平铺 — 实施计划 v1

- **文档版本**：v1.2
- **文档状态**：已完成（已移入 `docs/archive/`）
- **目的和适用范围**：按《MeNote 属性栏与清单字段平铺 — 设计 v1》落地代码改动。一份计划一份任务。
- **权威级别**：历史参考
- **最后更新日期**：2026-10-11
- **应用版本**：v0.8.28（落地版本）
- **设计依据**：`docs/modules/MeNote-属性栏与清单字段平铺-设计-v1.md` v1.2

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型 |
|---|---|---|---|---|
| v1 | v0.8.27 | 2026-10-11 | 首稿：五步 + 验收点 | DeepSeek v4.1 |
| v1.1 | v0.8.27 | 2026-10-11 | 同步设计 v1.1 的用户更正：步 3 由四项改**五项**（新增「删掉『未设为清单』项、空态渲染占位项」），验收点相应调整；「三项都清空」不再是属性块可达路径，改为由步 1 的纯函数用例覆盖 | DeepSeek v4.1 |
| v1.2 | v0.8.28 | 2026-10-11 | 五步全部完成、验收点逐条过（勾选）；更正步 3 第 3 条验收点（新外来键置于自有键**之前**，与设计 §2 一致）；「未决」两条已由用户拍板（`wiki/` 补一行、`AGENTS.md` 订正）；第三稿的 `frontmatter.test.ts` 因 500 行上限拆出 `frontmatter-task.test.ts` | DeepSeek v4.1 |

---

## 目标

1. 正文编辑器里**看不到** front matter（也没有展开入口）。
2. 不设置属性就**不产生** front matter；清空最后一个属性后 front matter **整段消失**。
3. 外部导入的平铺 YAML 能读能改；属性块里**随时**能新增自定义属性。
4. 清单三字段平铺为顶层键，与 Obsidian 格式一致；存量 `menote.task` 懒迁移。

## 范围

**做**：`packages/mdcore` 的 frontmatter / tasks、`apps/web` 的属性卡片与编辑器装饰与新建链路、`apps/worker` 的 MCP 写路径。
**不做**：批量迁移脚本、通用 YAML 库、`DESIGN.md` 的修改、移动端布局、表格键的键位。

---

## 步 1 — mdcore：键位、判定、懒迁移、空结果（先把纯函数做对）

**涉及文件**：`packages/mdcore/src/frontmatter.ts`、`packages/mdcore/src/tasks.ts`、`packages/mdcore/src/index.ts`（导出名若变）、`packages/mdcore/test/frontmatter.test.ts`、`packages/mdcore/test/frontmatter-task.test.ts`（落地时拆出）、`packages/mdcore/test/tasks.test.ts`

**做什么**

1. `TOP_LEVEL_KEYS` 扩为 `title` / `tags` / `status` / `due` / `priority`（顺序即写入顺序，见实现说明）；`assertForeignKey` 的保留字同步加入后三个（用户不能再把它们新增为外来属性）。
2. `takeTopLevelKeys` 同时取回三个清单键（**双读**：顶层没有时回落 `menote.task` 的内容）。
3. `renderTaskLines` 改成渲染**顶层无缩进**的三行；`buildDocument` 把三行放在 `tags` 之后、`menote:` 之前。
4. `updateMenoteKeys`：`patch.task` 命中时丢弃顶层旧三键 + 丢弃 `menote.task` 段，按固定顺序追加新三行；`patch.task === null` 删除三键与旧段；`patch.task === undefined` 一律不动。
5. 空结果不留围栏：`headLines` 与 `bodyLines` 都为空时直接返回 `split.body`。
6. `deriveTaskFields`：判据改为「顶层三键任一存在，或（兼容）`menote.task` 存在」；`is_task` 语义不变。

**验收点**

- [x] 顶层 `status: unread` 的文档 → `deriveTaskFields` 返回 `isTask: true`、三个值均为 `null`（钉住「无条件接管」）。
- [x] 旧格式 `menote.task:` 的文档 → 读得出值；对它打一次 `patch.task` 后，输出里**不再有** `menote.task`，三值出现在顶层。
- [x] 三值全空时输出里没有这三个键；`patch.task = null` 同样。
- [x] `updateMenoteKeys(有 tags/front matter, { tags: [] })` → **完全没有** front matter。
- [x] 清空最后一个清单字段 / 删掉最后一个外来键 → 同上。
- [x] `OB` 样本（外来键 + 块序列 + `comment: ` 空值行）打 `patch.task` 后：外来键逐字保留、`status: unread` 被顶层 `status:` 取代（**预期行为**，用例里写清这是接管代价）。
- [x] `buildDocument` 顺序：外来键 → title → tags → status → due → priority → `menote:`。

**跑**：`pnpm --filter @menote/mdcore test` → 134 passed

**落地时的两处偏离**（与设计一致，记在这里备查）：① `TOP_LEVEL_KEYS` 的实际顺序是 `title` → `tags` → 三键（`updateMenoteKeys` 拿它当排序键，顺序即布局顺序）；② 删掉了零调用方的 `taskToYamlLines` 与它的再导出。

---

## 步 2 — 两端调用点跟随

**涉及文件**：`apps/web/src/features/tasks/actions.ts`、`features/notes/actions.ts`、`features/notes/useItemProps.ts`、`features/memos/useMemoWrite.ts`、`apps/worker/src/services/mcp/write-parts.ts`、`services/mcp/tools-write-edit.ts`、`services/mcp/registry.ts`

**做什么**：字段名与类型都不变，只跟随新键位；`useMemoWrite.ts:92-95` 从派生列构造 `taskFields` 的那段保持不变（计划允许）。MCP 的 `create_item` 落盘格式跟随平铺。新增 mdcore 导出 `hasTaskValues`（写侧判据：三值任一非空）供 `is_task` 派生列使用。

**验收点**

- [x] `apps/worker/test/mcp-write.test.ts` 的断言由 `  task:\n    status: todo` 改为顶层 `status: todo`，并断 `is_task = 1`。
- [x] 隐私条目与表格路径不受影响（既有用例继续绿）。

**跑**：`pnpm --filter @menote/worker test` → 371 passed

---

## 步 3 — 属性卡片五项调整

**涉及文件**：`apps/web/src/features/notes/ui/ItemProps.tsx`、`apps/web/src/features/notes/useItemProps.ts`、`apps/web/src/app/theme/app.css`

**做什么**

1. 删掉 `STATUS_OPTIONS` 里的「未设为清单」项，状态下拉只剩 待办 / 进行中 / 已完成；`status` 为空时渲染一个只在此时出现的「未设置」占位项（设计 §6.2）。
2. 优先级下拉加「未设置」；未设置时 select 的 `value` 为空（不再回落 `medium`）。
3. `onTaskChange` 不再补 `status: "todo"`——只写用户真正设过的字段。
4. 「其他属性」段**常显**；无外来键时只显示「+ 添加属性」。
5. 删外来键加二次确认（照现有 `ConfirmDialog`，文案见设计 §6.5）。
6. 被接管但值不识别的顶层键给一句可见提示（设计 §4 的缓解，一行文案 + `.itemprops__warn`）。

**验收点**

- [x] 状态下拉里**没有**「未设为清单」；一篇没有状态的笔记显示的是「未设置」而不是「待办」。
- [x] 逐项点过状态下拉的每个选项，都不产生「清掉三个键」的效果（`onTaskChange(null)` 在卡片里不再被调用）。
- [x] 空白笔记（无 front matter）也能通过「+ 添加属性」新增一个键，**写回后置于自有键之前**（更正：原写「之后」，与设计 §2「外来键在最前」冲突，以实现为准）。
- [x] 普通笔记只改「优先级」→ 输出里只有 `priority: …`，`status` 不被塞成 `todo`。
- [x] 删外来键弹出确认，取消后 md 不变。
- [x] 卡片仍走 `editorHandle.replaceFrontmatter`，未新增 `saveDraft` 路径（用例钉「写完标签再敲一个字，标签还在」继续绿）。

**跑**：`pnpm --filter @menote/web test item-props` → 39 passed

---

## 步 4 — 编辑器不再显示 front matter

**涉及文件**：`apps/web/src/app/editor/frontmatter-hide.ts`、`apps/web/src/app/theme/app.css`、`apps/web/test/frontmatter-hide.test.ts`

**做什么**：去掉 `FrontmatterChip` widget，改零宽 `Decoration.replace`；删 `frontmatterKeyNames` / `setRevealed` / `revealed`；删 `.cm-fm-chip` 样式；保留未闭合不隐藏与 `keepCursorOut`；补 `EditorView.atomicRanges` 钉住「隐藏区是原子的」。

**验收点**

- [x] 含 front matter 的文档在编辑器里**不出现**任何字符或可点元素。
- [x] 未闭合围栏（只有一行 `---`）仍原样显示。
- [x] 隐藏区是原子的：在文档开头退格/删除不会只吃掉围栏而把 `title: …` 裸露到正文。
- [x] 光标无法停在隐藏区内。

**跑**：`pnpm --filter @menote/web test frontmatter-hide` → 11 passed

---

## 步 5 — 新建不写 title + 文档回写与提交

**涉及文件**：`apps/web/src/features/notes/useNoteCreation.ts`、`apps/web/src/features/notes/actions.ts`、`docs/modules/MeNote-YAML-兼容与标题入档-设计-v1.md`、`docs/modules/MeNote-笔记属性卡片-设计-v1.md`、`wiki/Menote-功能拆解-v2.md`（已获用户同意）、`AGENTS.md`（已获用户同意）、`CHANGELOG.md`、根 `package.json`

**做什么**

1. `createNote` / `createTable` 去掉 `title` patch → 新建笔记正文区**完全没有 front matter**。
2. 改标题：**派生列必写**；md 里本来就有顶层 `title:` 键时才回写那一行（外部导入的稿），没有键就一个字都不加。
3. 两份旧设计稿各补一行版本记录指向本稿（追加式，不覆盖历史行）。
4. `wiki/Menote-功能拆解-v2.md` 补一行键位口径；`AGENTS.md` 订正版本号与回写台账。
5. `CHANGELOG.md` 顶部追加一条，版本号 +0.0.1。

**验收点**

- [x] 新建笔记后编辑器与属性卡片都是空的，md 无 front matter。
- [x] 改标题后 md 仍无 `title:`，但列表与标题框显示新标题。
- [x] 导入带 `title:` 的 md：属性块显示、能改，且改标题时那个键跟着改。

**跑**：`pnpm lint`（仅剩一条既有 warning）、`pnpm typecheck`（四项目 Done）、`pnpm test`（2056 passed）

---

## 提交与版本

- 代码与文档分开提交，中文 Conventional Commits，信息先写 `.git/COMMIT_MSG.txt` 再 `git commit -F`，提交后先 `git log -1 --format="%s"` 核对。
- 修订号 +0.0.1（根 `package.json` 唯一来源）：v0.8.27 → v0.8.28。

## 未决 / 待用户确认（本轮已全部拍板或明确记为缺口）

- [x] `wiki/Menote-功能拆解-v2.md` 补一句 `status` / `due` / `priority` 的键位口径 —— **用户 2026-10-11 同意补**，随本轮落地。
- [x] 设计 §4 的「值不识别的接管键给可见提示」——按「保留、最简一行文案」执行（已落地）。
- [x] `AGENTS.md` 的版本号与回写台账订正到 v0.8.28 —— **用户 2026-10-11 同意订正**，随本轮落地。
- **取消清单的入口**（用户 2026-10-11 决定本轮不做）：属性块删掉「未设为清单」后，清单字段一设就成清单条目、现阶段回不去。清单侧动作（待办视图）若也依赖 `patch.task = null`，那条路仍在；但「从属性块反向退出」要等清单功能稳定后单独设计。本轮**不为它留半成品入口**。
