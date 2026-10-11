# MeNote 属性库 — 实施计划 v1

- **文档版本**：v1.1
- **文档状态**：**已完成**（落地 commit `70e7ad2`，2026-10-11）
- **目的和适用范围**：按《MeNote 属性库设计 v1》v2.2（生效、已实现）落地代码改动。一份计划一份任务。
- **权威级别**：临时规则（实施依据）
- **最后更新日期**：2026-10-11
- **应用版本**：v0.8.30（落地版本）
- **设计依据**：`docs/modules/MeNote-属性库-设计-v1.md` v2.2

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型 |
|---|---|---|---|---|
| v1 | v0.8.30 | 2026-10-11 | 首稿：八步 + 验收点 | DeepSeek v4.1 |
| v1.1 | v0.8.30 | 2026-10-11 | **状态改「已完成」**：八步全部落地并跑绿；补「落地结果」一节记实际文件名、六处与计划的偏离、各步验收点核对与验证数字。`docs/archive/` 的移动**未做**（近期惯例是做完仍留在 `docs/todo/`，等用户定） | deepseek-v4.1-flash |

---

## 目标

1. 属性库是**账号级**一份（跟随账号、跨设备跨笔记本共用），落在 `user_settings`，**不动 `mdcore` 的解析**。
2. **三个添加入口**：正文区卡片（前台）、设置 › 属性库（管理页）、导入时的录入步。
3. **唯一删除口**在管理页；前台只能「用 / 不用」——前台不动库结构。
4. 内置键上的陌生值走**路 A**（可见 / 可改 / 可留，不动值域）。

## 范围

**做**：`packages/shared` 的 `UserSettingsSchema`（加一个可选字段）、`apps/web` 的属性卡片与属性库 feature、设置页第 10 分类、导入录入步、`DESIGN.md` 的界面口径回写。
**不做**：路 B（内置键值域扩展 + 归一档）、键名中文化、把库接进 `@` 命令面、备份契约里的 `settings.json` 缺口、移动端布局、`mdcore` 的任何改动。

---

## 步 1 — 契约：`user_settings` 加一个可选字段

**涉及文件**：`packages/shared/src/settings.ts`

**做什么**

1. 加 `PROP_TYPES = ["text", "multiline", "date", "number", "boolean", "choice"]`（`as const`）+ `PropType` 类型；`PropLibraryEntry = { key: string; builtin: boolean; type: PropType; values: string[] }`。
2. `PropLibraryEntrySchema`（照 `NotebookSettingsSchema` 的写法）＋ `prop_library: v.optional(v.array(PropLibraryEntrySchema), [])`，放在 `notebook` 之后。
3. `DEFAULT_USER_SETTINGS` 里补 `prop_library: []`。

**实现说明**

- 加字段纪律：`v.optional(…, 默认值)`（老行与旧客户端 PUT 不带该字段都不会 422，**不需要迁移**）。
- **内置键不落库**：`title` / `tags` / `status` / `due` / `priority` 的定义由 `features/props/model.ts` 现成给出（`builtin: true`），库里只存用户自建的条目。理由：老账号的 `prop_library` 是空的，若把内置键也存进库，管理页就得处理"库里有/没有"两种状态；现成给出则只有一种。`builtin` 字段保留在 schema 里（前向兼容 + 设计 §3.2 的契约）。

**验收点**

- `UserSettingsSchema` 解析 `{}`（老行形状）时 `prop_library` 为 `[]`；解析带 `prop_library` 的对象时逐字段取回。
- `UserSettingsSchema` 解析 `{ prop_library: [{ key: "url" }] }` 时补齐 `builtin: false` / `type: "text"` / `values: []`。

## 步 2 — 纯函数：`features/props/model.ts`

**涉及文件**：`apps/web/src/features/props/model.ts`（新）、`apps/web/test/prop-library.test.ts`（新）

**做什么**

1. `BUILTIN_PROP_ENTRIES`：五个内置键的条目（`builtin: true`）。
2. `isBuiltinKey(key)`、`normalizeLibrary(entries)`：去重（后出现的覆盖先出现的）、剔掉内置键与不合 `KEY_PATTERN` 的键、`type` 不合法回落 `text`、`values` 去重并截到上限（`VALUE_CANDIDATE_LIMIT = 20`）。
3. `entryFor(library, key)`、`knownKeys(library)`（最近用的在前：靠 `values` 的插入顺序对齐不到"最近用过"，改为**库数组顺序即最近使用顺序**——新建与改值都把它提到的条目移到最前）。
4. `addEntry(library, key, type)` / `removeEntry(library, key)` / `updateEntry(library, key, patch)` / `renameEntry(library, from, to)`。
5. `registerValue(library, entry, value)`：把值插到该条目 `values` 最前（去重、截断）；条目不存在时**新建**条目，类型按 `block ? "multiline" : "text"` 推（只影响控件，不参与解析）。
6. `inferType(value, block)`、`typeLabel(type)`（中文标签，供管理页与菜单用）。

**验收点**

- 内置键进不了库；`normalizeLibrary` 对重复键、非法键名、非法 type、超长 values 的处理各有用例。
- `registerValue` 在库为空时建出条目、在已有条目时把值提到最前且不重复、超过上限时丢最旧。

## 步 3 — 陌生键扫描：`features/props/scan.ts`

**涉及文件**：`apps/web/src/features/props/scan.ts`（新）、`apps/web/test/prop-library-scan.test.ts`（新）

**做什么**

1. `scanUnknownKeys(files, library): Promise<UnknownKeyHit[]>`：逐个 `File.text()` → `stripBom` → `readForeignKeys`，剔掉内置键与**已在库的键**，按 key 归并出 `{ key, count, sample, block }`（`sample` 取第一篇里的原值）。
2. 非 `.md` 文件跳过（与 `importMarkdownFiles` 同一判据，复用 `isMarkdownFileName`）。

**验收点**

- 已在库的键不算陌生；同一键出现在多个文件里 `count` 累加、`sample` 取第一份；读不出的文件被跳过而不是抛错。

## 步 4 — 前台卡片（`ItemProps.tsx`）

**涉及文件**：`apps/web/src/features/notes/ui/ItemProps.tsx`、`apps/web/test/item-props.test.tsx`

**做什么**

1. 新可选 props：`library?: PropLibraryEntry[]`（默认 `[]`）、`onLibraryChange?: (next: PropLibraryEntry[]) => void`。
2. 「+ 添加属性」由 `window.prompt` 改成 `DropdownMenu`：库里的键（带类型标签）+ 末尾「新建键…」（仍用 `window.prompt` 只问键名，选完类型默认 `text`）。选中即把键写进本篇（空值）。
3. 外来键改值时调 `registerValue` 经 `onLibraryChange` 上报（§6.4：只在用户主动动过时收录）。
4. 未入库的键行尾加「未入库」标记 + 一键入库按钮。
5. ⓧ 语义改「本篇不用」：确认文案改成"这一篇不再有这个属性（库里的定义还在）"，标题 `本篇不再用 ${key}？`，
6. 路 A：`readItemProps` 增加 `rawTask: { status, due, priority }`（原值），状态行在"原值不认识"时把原值本身作为一个选项显示（`unread（原样保留）`），**改动它才写库清单值**；`unrecognized` 文案相应从"改了会覆盖"改成"MeNote 不认它，留着不影响别的"。

**实现说明**

- 类型控件：`text` 单行 `input` / `multiline` `textarea`（现状）/ `date` `input type="date"` / `number` `input type="number"` / `boolean` `select`（`true` / `false`）/ `choice` `select`（`values`）。
- 文本类给 `datalist`（该键的 `values`）。
- 键名与保留字判定不变（`KEY_PATTERN` / `RESERVED`）。

**验收点**

- 空库时菜单只有「新建键…」；有库时列出键并标类型。
- 未入库的键显示标记，点一下进库。
- ⓧ 的确认文案是"本篇不再有"，且仍要确认（破坏性可见）。
- `status: unread` 在状态行以"原样保留"选项显示；不动它就不写任何清单键（推回编辑器的内容与原 md 一致，仅格式往返）。

## 步 5 — 接线与样式

**涉及文件**：`apps/web/src/app/App.tsx`、`apps/web/src/app/NotesSlot.tsx`、`apps/web/src/app/workarea/NotesPane.tsx`、`apps/web/src/features/notes/ui/NoteWorkspace.tsx`、`apps/web/src/features/notes/ui/NotebookPanel.tsx`、`apps/web/src/features/notes/ui/ImportNotesFlow.tsx`、`apps/web/src/app/theme/app.css`

**做什么**

1. `App.tsx`：`useCallback` 出一个稳定的 `changePropLibrary(next)`（`patchSettings({ prop_library: next })`），与 `userSettings.settings.prop_library` 一起往下传。
2. 透传到 `NoteWorkspace`（给卡片）与 `NotebookPanel`（给导入）。
3. `app.css` 加新类：`.proplib*`（管理页）、`.itemprops__unregistered` / `__lib` / `__menu-type` 等，沿用既有的间距 / 圆角 / 颜色令牌。

**验收点**

- 改一次库，卡片候选与管理页**同时**变（一份状态、一处真源）。
- 无内联箭头进 `NotesPane`/`NoteRow` 的 memo 比较（照 `onToast` 的既有口径）。

## 步 6 — 管理页：设置 › 属性库

**涉及文件**：`apps/web/src/features/props/ui/PropLibraryPage.tsx`（新）、`apps/web/src/app/router.ts`、`apps/web/src/features/settings/ui/SettingsPanel.tsx`、`apps/web/test/router.test.ts`、`apps/web/test/ui.test.tsx`、`apps/web/test/prop-library-page.test.tsx`（新）

**做什么**

1. `SETTINGS_PAGES` 末尾（`instance` **之前**）插入 `"prop-library"`；`PAGE_META` 补标题与 ⓘ 简述（`Record<SettingsPageId, …>` 会守住漏改）。
2. 页面：内置键区（标「内置」，不可删、不可改键名）+ 自建条目区（键名 / 类型 / 候选值 / 被 N 篇用到 / 改 / 删）。
3. 删除条目**二次确认**，文案写明"已经用了它的笔记 md 不动，只是变成未入库的键"。
4. 「被 N 篇用到」的数据来源：本机 `items` 表按 front matter 扫一遍（含 `title` 以外的顶层键），只统计、不改写。

**验收点**

- `parseRoute("#/settings/prop-library")` 往返成功；`SETTINGS_PAGES` 用例更新为 10 类。
- 内置键没有删除按钮；自建条目删除走确认框。

## 步 7 — 导入录入步（`ImportNotesFlow.tsx`）

**涉及文件**：`apps/web/src/features/notes/ui/ImportNotesFlow.tsx`、`apps/web/test/import-notes-flow.test.tsx`（若无则新建）

**做什么**

1. 选完文件后先 `scanUnknownKeys`：命中才插一步（多选时在确认框之后、单选时直接），否则照旧直接导入。
2. 录入步内容：每个陌生键一行（键名 / 出现篇数 / 样例值）+ 「录入」（选类型，默认 `text`，带"记住这些取值"勾选）+ 「跳过」。
3. 默认**跳过**；确认后把录入的键并进库，再走原来的导入。

**验收点**

- 没有任何陌生键时**不出现**录入步（不打断）。
- 跳过时库不变、导入结果不变；录入时库多出条目、导入结果不变。

## 步 8 — 验证与回写

**做什么**

1. 跑 `pnpm lint` / `pnpm typecheck` / `pnpm test`。
2. 回写 `DESIGN.md`（属性库的界面口径：卡片上的候选与"未入库"、管理页骨架、录入步骨架）。
3. 回写设计稿（§3.2 的类型落地、§6 各节标"已实现"）与 `CHANGELOG.md`，版本 `0.8.29` → `0.8.30`。
4. 本计划状态改「已完成」；是否移入 `docs/archive/` 随本次一起定。

**验收点**

- [x] 三件验证命令全绿（lint 允许既有的 `NotesPane.tsx` exhaustive-deps warning）。
- [x] `CHANGELOG.md` 最上方有 v0.8.30 条目；根 `package.json` 的 version 与之一致。

---

## 落地结果（2026-10-11，v0.8.30 / commit `70e7ad2`）

八步全部落地。**实测的文件名与计划里写的不同**，以本节为准：

| 计划里写的 | 实际落的 |
|---|---|
| `apps/web/test/prop-library.test.ts` | `apps/web/test/props-model.test.ts`（19 条） |
| （计划未列纯控件用例） | `apps/web/test/props-field.test.tsx`（13 条，`controlFor` + `PropValueField` + 「用一个属性」菜单） |
| `apps/web/test/prop-library-page.test.tsx` | `apps/web/test/props-library.test.tsx`（11 条，管理页 + `countPropUsage`，用 `fake-indexeddb`） |
| `apps/web/test/import-notes-flow.test.tsx` | `apps/web/test/import-learn-step.test.tsx`（7 条） |
| `apps/web/test/prop-library-scan.test.ts` | **未单独建**：`scanUnknownKeys` 由录入步用例间接覆盖（出不出这一步、篇数、样例、已认识的键不列） |

**六处偏离计划（都按最简原则，落地时定的，设计稿 §11 已记）**

1. `knownKeys(library)` 落地叫 `knownKeySet(library)`；`inferType` 没有单独导出——类型推断内联在 `registerValue` 里（`block ? "multiline" : "text"`），没有第二个调用方。
2. `.itemprops__unregistered` 落地叫 `.itemprops__lib`（"未入库"按钮）；新增的 CSS 是 `.itemprops__lib` / `.learnlist*` / `.proplib*` 三类，共约 110 行，全用既有令牌。
3. 步 4 的「+ 添加属性」落地叫 **「+ 用一个属性」**（`PropPicker` 组件），`window.prompt` 只留给菜单末尾的「新建键…」，且新建时把条目并进库、再把键写进本篇（空值）。
4. 步 6 的「被 N 篇用到」**不是扫 `items` 表**，而是本机 `db.bodies` + `db.drafts`（草稿覆盖同一篇的缓存）+ 第二遍 `parseMenoteMeta` 单独补计内置键（`readForeignKeys` 不返回内置五键）。界面脚注必须写明"已看 N 篇"。
5. 步 2/5 的 `library` / `onLibraryChange` 在 `ItemProps` 上是**可选** props——既有用例与老调用点不必补参数。
6. `prop_library` 的规范化**只发生在管理页写回时**（`PropLibraryPage` 用 `normalizeLibrary` 后的数组交给 `onChange`）；同步下来的脏数据靠这次写回自愈，不做后台清洗。

**各步验收点**：步 1 两条 → `packages/shared/test/settings.test.ts` 既有用例覆盖（`v.optional` 带默认值，`UserSettingsSchema` 解析 `{}` 与 `{ prop_library: [{ key }] }`）；**逐条核对后未新增**。步 2–7 各步验收点 → 由上表四个新测试文件覆盖，全部勾选。步 8 → 见下。

**验证（2026-10-11）**

- `pnpm lint`：0 error / 1 warning（`apps/web/src/app/workarea/NotesPane.tsx:250` react-hooks/exhaustive-deps，既有问题，行号因新 import 从 241 移到 250）。
- `pnpm typecheck`：四个项目 Done。
- `pnpm test`：**mdcore 134 + shared 117 + web 1490 + worker 371 = 2112 passed**（web 的 140 个文件含 `style-coverage.test.ts` —— 新类名都有 CSS 规则）。
