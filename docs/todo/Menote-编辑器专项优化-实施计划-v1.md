# Menote 编辑器专项优化 实施计划 v1

| 项 | 值 |
|---|---|
| 计划版本 | v1.1 |
| 对应设计 | `docs/modules/Menote-编辑器专项优化-设计-v1.md` v1.1（蓝本：shuaiplus/inkstone，LGPL-3.0） |
| 状态 | 执行中 |
| 创建日期 | 2026-10-11 |

## 目标

按设计 v1.1 的批次，把 inkstone 蓝本里 MeNote 还缺的能力补齐：工具栏 + 键位（P1）、即时渲染能力升级（P2）、查找替换（P3）。v1 首稿基于过时快照的「试验页先行 / 块级渲染」路线已作废，见设计 §修改记录。

## 阶段

### P0 许可证落地（先于一切代码借鉴）

- 根 `LICENSE` 写入 LGPL-3.0-only 全文；根 `package.json` 加 `"license": "LGPL-3.0-only"`。
- 验收：标准 LGPL 文本（UTF-8 无 BOM）；构建与测试不受影响。纯约定改动，版本号不升。

### P1 工具栏 + 键位 + 命令层扩展（本批）

- `app/editor/format-commands.ts`：加 `strikethrough`（成对标记 `~~`）；`heading` 支持级别参数（`{ headingLevel?: number }`，缺省仍是 `##`，`/` 菜单行为不变）；新增 `minimalChange(before, after)` 纯函数（公共前后缀求差 → 最小变更区间）。
- `app/editor/shortcuts.ts`（新增）：键位表（设计 D5），命令经 `applyFormatAt` 落盘；**不绑** `Ctrl+K`。
- `app/editor/EditorToolbar.tsx`（新增）：按设计 §五实现，按钮全走 `IconButton` + `DropdownMenu`，不含任何 Markdown 拼装。
- `app/editor/Editor.tsx`：挂 `editorKeymap`；`applyFormat` 接受级别参数、用 `minimalChange` 派发最小变更。
- `features/notes/ui/NoteWorkspace.tsx`：`docpane__head` 与正文之间挂工具栏（仅编辑 / 即时渲染显示、仅预览隐藏、表格条目不显示、锁定禁用）。
- `app/ui/Icon.tsx`：sprite 增补 10 个格式图标。
- `app/theme/app.css`：`.editor-toolbar` 样式（只用现有令牌）。
- 测试：`format-commands.test.ts` 补删除线 / 标题级别 / `minimalChange`；工具栏组件用例（点击回调、菜单选级、禁用态）。
- 验收：lint / typecheck / test 全绿；快捷输入命令集不变；生产其余页面不受影响。版本 v0.8.18。

### P2 即时渲染能力升级（逐项小步，每项独立提交）

1. **任务清单真复选框**（无新依赖）：widget 渲染复选框，点击派发 `[ ]` ⇄ `[x]` 文档变更（蓝本 `setTaskAtLine` 机制）；即时渲染设计 §二覆盖表该项 ❌→✅。
2. **代码块语言高亮**：`prismjs` 动态 `import()` + 按需语言包；配色复用预览令牌；围栏行按现行为保留可见（§八 的既定取舍不动，只把底色行换成高亮内容行）。
3. **图片内联**：接 `/api/attachments/h/<sha>`，懒加载 + 失败三态 + 上传中占位联动（§七-4）。
4. 可选（单独拍板）：`==高亮==`（`markdown-it-mark`，预览与即时渲染同批）、表格/分隔线按钮。

### P3 查找替换浮动面板

- 新依赖 `@codemirror/search`；移植 inkstone `search.ts` 机制（自定义 Panel：选区范围 / 大小写 / 正则 / 结果列表跳转 / 替换与撤销），中文文案、DESIGN 令牌样式。
- `Ctrl+F` / `Ctrl+H` 进 `shortcuts.ts`；工具栏加「查找」按钮。
- 验收：Esc 关闭归还焦点；拖拽缩放；不与全局和弦冲突。

### P4 输入增强（可选，按剩余预算）

- 代码围栏语言补全（蓝本 `codeFenceSource`，纯 CM6）；`smartEnter`（列表续行）、`completeCodeFenceOnEnter`（补全围栏）两个回车增强。

### 文档回写（每批随做，按「文档回写不用问」）

- P1：`components.md` 登记工具栏组件；DESIGN §6.3 编辑器键位若与总表有交叠按实际登记。
- P2：即时渲染设计 v1 的覆盖表与 §七 逐项销账。
- 全部完成后本计划移 `docs/archive/`。

## 涉及文件汇总

| 类型 | 路径 |
|---|---|
| 许可证 | `LICENSE`、根 `package.json` |
| 新增 | `app/editor/shortcuts.ts`、`app/editor/EditorToolbar.tsx` |
| 修改 | `app/editor/format-commands.ts`、`app/editor/Editor.tsx`、`features/notes/ui/NoteWorkspace.tsx`、`app/ui/Icon.tsx`、`app/theme/app.css` |
| 测试 | `apps/web/test/format-commands.test.ts`、新增工具栏用例 |

## 提交节奏

按「里程碑执行节奏」：P0 一笔（chore）、P1 一笔（feat）、P2 每项一笔；推送前跑 `pnpm lint / typecheck / test`；代码与文档分开提交。
