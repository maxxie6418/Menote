# MeNote 编辑器体验优化 实施计划 v1（文档版本 v1）

| 项 | 值 |
|---|---|
| 文档版本 | v1 |
| 文档状态 | 生效（**已执行完毕**，2026-10-18 随 v0.8.37 落地） |
| 目的和适用范围 | 把《Menote 编辑器体验优化设计 v1》（`docs/modules/Menote-编辑器体验优化-设计-v1.md`，v1.3）的两项目标落成代码：①编辑器代码空闲后台预载；②即时渲染改按"光标进标记才显现源码"。含首轮评审 10 项的处置。 |
| 权威级别 | 历史参考（实施记录） |
| 最后更新日期 | 2026-10-18 |

## 一、目标与非目标

- 目标①：主工作区可交互后在空闲时间预载编辑器模块，用户首次进入编辑不等网络；保留代码分割，不并入首屏。
- 目标②：即时渲染的语言/呈现判定由"光标所在行显示源码"改为"完整语法立即呈现，光标进入被隐藏的标记时才临时显现该节点源码"。
- 非目标：不改数据模型 / 同步 / 保存链路 / 依赖；不新增生产遥测；不重做".8.x 已落地的具体渲染能力（真图、Prism、真复选框）。

## 二、拆步与状态

| # | 步骤 | 状态 | 产物 |
|---|---|---|---|
| 1 | 写本实施计划 | ✅ | 本文件 |
| 2 | 共享加载函数 + 空闲预载调度器 | ✅ | `apps/web/src/app/editor/loader.ts` |
| 3 | NoteWorkspace 接线（懒加载改共享加载器、片内错误态 + 手动重试） | ✅ | `EditorLoadBoundary.tsx`、`NoteWorkspace.tsx` |
| 4 | 预载触发点 | ✅ | `apps/web/src/app/workarea/NotesPane.tsx` |
| 5 | live-preview 改按语法节点判定（揭示规则 + 废止原子区间） | ✅ | `live-preview.ts`、`live-preview-reveal.ts` |
| 6 | 解析续刷改"语法树引用变化即重建" | ✅ | `live-preview.ts` 插件 `update()` |
| 7 | 用例与本地检查 | ✅ | 3 个测试文件；typecheck / lint / 目标用例 |
| 8 | 文档回写 + 版本 + CHANGELOG + 推送 | ⏳ 本轮收尾 | 设计稿 v1.3、四份定稿、根 `package.json` v0.8.37 |

## 三、关键取舍（与设计稿的偏离，理由见设计稿 §六）

1. 设计稿 §4.3 的 `parseProgressEffect` + 外部 `forceParsing` + 2s watchdog 协议**未采用**。真实缺口只是"`update()` 不认语法树变化"，改为在 `update()` 里比较 `syntaxTree(state)` 的引用；整条链收回插件内部，无代次协议。
2. `livePreview()` **不再给隐藏标记挂 `atomicRanges`**。标记既是原子区间、又要"光标进入时显现"，二者不可并存（鼠标与方向键都进不去）。
3. §3.3 的"焦点意图 token"**不实现**：`Editor.tsx` 挂载时本就不自动聚焦，预载只加载模块不挂 `EditorView`，风险不存在。
4. 揭示判定抽到独立文件：`live-preview.ts` 触到 `max-lines: 500`，且"标题节点名 → 类名"应只有一份来源。

## 四、涉及文件

- 新建：`apps/web/src/app/editor/loader.ts`、`apps/web/src/app/editor/EditorLoadBoundary.tsx`、`apps/web/src/app/editor/live-preview-reveal.ts`。
- 修改：`apps/web/src/app/editor/live-preview.ts`、`apps/web/src/features/notes/ui/NoteWorkspace.tsx`、`apps/web/src/app/workarea/NotesPane.tsx`。
- 测试：`apps/web/test/live-preview.test.ts`（改）、`apps/web/test/editor-loader.test.ts`（新）、`apps/web/test/editor-load-boundary.test.tsx`（新）。

## 五、验收点与结果

- `pnpm --filter @menote/shared build` + `pnpm --filter @menote/mdcore build` 是 web typecheck/test 的前置（`@menote/mdcore` 的 exports 指向 `dist/`）。
- `pnpm typecheck`：四个包全 Done ✅
- `pnpm lint`：0 error / 1 warning（`NotesPane.tsx` 的 `useMemo` 缺 `workspace`，**改动前既有**）✅
- 目标用例：`live-preview` 32 + `editor-loader` 7 + `editor-load-boundary` 3 = **42 passed** ✅
- `apps/web` 全量：137 files / 1462 tests 通过，8 files / 87 tests 失败——失败一律是 jsdom `window.localStorage` 取不到，**干净基线复跑同样失败**，与本轮无关 ⚠️
- 未验证：真机端到端 p95、微软拼音人工项、800KB / 20000 行深滚动、三条加载故障注入的浏览器验证（见设计稿 §六-5）。

## 六、后续（若继续）

- 生成 `editor-fixture-v1` 长文夹具并把 A3 计时、A9、A13 跑起来。
- 补"真 CM6 定向自动化"（可注入延迟解析器 / 模拟时钟）。
- 若给编辑器加自动聚焦，必须回到设计稿 §3.3 的焦点意图 token。
