# MeNote 笔记属性卡片 — 实施计划 v1

- **文档版本**：v1
- **文档状态**：生效
- **目的和适用范围**：把设计稿 `docs/modules/MeNote-笔记属性卡片-设计-v1.md` v1 拆成可执行步骤。
- **权威级别**：临时规则（本轮执行用，做完归档）
- **最后更新日期**：2026-10-04
- **应用版本**：v0.8.11

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型 |
|---|---|---|---|---|
| v1 | v0.8.11 | 2026-10-04 | 首稿 | MiniMax M3.1 |

---

## 拆步

### 步 1 — mdcore：外来键的读 / 写 / 删

**涉及文件**
- `packages/mdcore/src/frontmatter.ts`（新增 `readForeignKeys` / `writeForeignKey` / `removeForeignKey` + 键名校验）
- `packages/mdcore/src/index.ts`（导出）
- `packages/mdcore/test/frontmatter.test.ts`

**做什么**
1. `readForeignKeys(markdown): ForeignKey[]`——逐个外来顶层键给出 `key` / `value`（值行的原文）/ `block`（是否带缩进子行）。**白名单键（`title` / `tags`）与 `menote` 不出现在结果里**（它们各有各的行）。
2. `writeForeignKey(markdown, key, { value, block })`——原位替换；键不存在则追加到外来段末尾；`block` 决定写 `key: v` 还是 `key:` + 缩进子行。
3. `removeForeignKey(markdown, key)`——整段移除（含其缩进子行）。
4. 校验：键名 `^[A-Za-z0-9_-]+$`；撞白名单键 / `menote` 拒绝；单行值含 `: ` 或 ` #` 拒绝。

**验收点**
- [ ] 单行键与块序列键都能读出，`block` 判对
- [ ] 写回后**形状不变**：块仍是块、单行仍是单行，引号与缩进一字不改
- [ ] 外来键原位替换，不挪到别处（`menote:` 块与正文都不受影响）
- [ ] 删除只删那一个键及其子行，其它外来键与 `menote:` 块一字不动
- [ ] 键名非法 / 撞 `title`/`tags`/`menote` / 单行值含 `: ` 或 ` #` —— 拒绝并给出可读理由
- [ ] 没有外来键时返回空数组；没有 front matter 时也是空数组（不抛错）

### 步 2 — 编辑器句柄加 `replaceFrontmatter`

**涉及文件**
- `apps/web/src/app/editor/Editor.tsx`（`EditorHandle` + `makeHandle`）
- `apps/web/test/`（句柄用例）

**做什么**
只在 `doc.startsWith(expected)` 时替换 `[0, expected.length]`；**否则什么都不做并返回 `false`**——绝不退化成插入（现有 `replace` 的兜底是为附件占位设计的，对属性卡片是灾难）。

**验收点**
- [ ] 文档开头匹配 → 替换成功，返回 `true`
- [ ] 不匹配 → 文档一字未变，返回 `false`
- [ ] 替换走一条事务（`onChange` 只抛一次），光标与保存链路照常

### 步 3 — 派生列的写入动作

**涉及文件**
- `apps/web/src/features/notes/actions.ts`（`patchItemTags`、`patchItemForeignKey` / `removeItemForeignKey` 需要的列更新）
- 复用 `features/tasks/actions.ts` 的 `writeTaskFields`（清单字段已有，不重写）

**做什么**
只更新派生列 + `enqueueMetaPatch`，**不碰草稿**（草稿由编辑器那条路负责，设计稿 §6.4）。

**验收点**
- [ ] 标签改完 `items.tags` 与 md 派生一致
- [ ] 连续两次改标签，`meta_rev` 不打架
- [ ] **写完标签再敲一个字，标签仍在**（这条是本设计的核心防回归用例）

### 步 4 — `ItemProps` 卡片组件

**涉及文件**
- `apps/web/src/features/notes/ui/ItemProps.tsx`（**新建**）
- `apps/web/src/app/theme/app.css`（`.itemprops` 那组样式）
- 复用 `app/ui/Chip.tsx`（`variant="tag"`）与 `app/ui/Modal.tsx`（删键确认）

**做什么**
标签 chip（可删 + 添加）、状态 / 截止 / 优先级、其他属性行（键原样 + 值可改 + 删除）、添加属性、删除确认框。预览档只读并给原因。

**验收点**
- [ ] 形态复用 `chip`，不新造控件（DESIGN.md §5.3）
- [ ] 键名原样，不翻译
- [ ] `title` / `tags` / `menote` 三个键没有删除入口
- [ ] 删外来键走确认，写明「Obsidian 那边也会看不到」
- [ ] 没有外来键时这一段不显示；front matter 没闭合时整张卡片不显示
- [ ] 预览档输入禁用且 `title` 说明原因
- [ ] 块序列键用多行框、单行键用单行框

### 步 5 — 接线

**涉及文件**
- `apps/web/src/features/notes/ui/NoteWorkspace.tsx`（渲染卡片 + 接线）
- `apps/web/src/app/workarea/NotesPane.tsx`（把 `editorHandle` 传给 `NoteWorkspace`）

**做什么**
`NoteWorkspace` 已发 `onEditorReady` 往上；`NotesPane` 持有句柄，再**传下来**（单一来源，不在 `NoteWorkspace` 里存第二份）。卡片改动算出新 md 后调 `replaceFrontmatter`。

**验收点**
- [ ] 加标签 → md 与列都对，编辑器里能看到（展开后）
- [ ] `NoteWorkspace.tsx` 不顶破 500 行预算
- [ ] 表格条目同样能用（`menote:` 块不受影响）

### 步 6 — 收尾

- [ ] `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿
- [ ] 版本 → **v0.8.11**
- [ ] `CHANGELOG.md` 顶部追加条目
- [ ] 提交（代码 / 文档分开）+ 推送上线
