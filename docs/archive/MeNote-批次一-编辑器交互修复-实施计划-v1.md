# MeNote 批次一（编辑器交互修复）实施计划 v1

| 项 | 内容 |
| --- | --- |
| 文档版本 | v2 |
| 文档状态 | **已完成**（v0.8.39 落地并交付；真机验收 A–H 见 §落地结果） |
| 目的和适用范围 | 按 `docs/modules/MeNote-编辑器交互修复-设计-v1.md` v1 落地四件事：标记冻结、选区夹取、纸面整块可点、附件按钮进工具栏 |
| 权威级别 | 临时规则（完成即移入 `docs/archive/`） |
| 最后更新日期 | 2026-10-18 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
| --- | --- | --- | --- | --- |
| v2 | v0.8.39 | 2026-10-18 | 收口：S0–S6 全部执行完毕，补「落地结果」（含真机 A–H 的实测证据与三处落码时才定下的实现细节：`align-items: stretch` 必须带 `!important`、冻结只吃 point 装饰、附件旧入口只在仅预览档保留） | deepseek-v4.1-flash |
| v1 | v0.8.39 | 2026-10-18 | 首稿（对应设计稿 v1） | deepseek-v4.1-flash |

## 目标

用户 2026-10-18 口述的六条需求里，属于"编辑器交互"的四条：

1. 多个 `#` 的标题写不出来、会闪动 → **给正在编辑的那一行加冻结**（判据不动，只改重算时机）；
2. 无法划选文字、拖拽变成拖光标 → **`keepCursorOut` 改为只夹落进隐藏区的那一端**；
3. 点纸面留白不落光标 → **内边距从纸面搬到 `.cm-content` + 让正文元素铺满纸面高度**；
4. 当前行底色太独特 → **去掉整行底色**；
5. 「添加附件」从模式切换条旁搬进格式工具栏（仅预览档保留原入口）。

不在本批：设置页「编辑设置」分类（批次三）、属性栏/大纲面板的"不推动正文 + 贴正文"（批次二，见设计稿 §8）。

## 分步

### S0 复现（先做实，再改）

用 `agent-browser` 起 `pnpm dev`、登录（需要本机口令，或用户允许新建本地库），按设计稿 §6 的 **A / D / E** 三条先看现象是否与推断一致：

- A：空行连续敲 `## 标题文字`，是否"看不见 `#` 且闪"；
- D：从正文往上拖到顶，选区是否塌成光标；
- E：点纸面左右内边距与文字下方空白，是否没有任何反应。

三条都对上才继续；有一条对不上就回头改设计稿的原因分析，不再往下推。
（`pnpm dev` 起前端 + Worker + 本地 D1 一体，见 `wiki/guides/local-dev.md`。）

### S1 纯函数模块 + 用例

新增 `apps/web/src/app/editor/live-preview-lock.ts`：`sliceLine`（按行切装饰）、`equalsReveal`（显现集合比较）、`freezeLine`（冻结替换）、`shouldUnlock`（`L`/`R` 变化或跨行改动即解锁）。

新增 `apps/web/test/live-preview-lock.test.ts`，至少钉住：

- 同一行、显现集合不变 → 冻结（新算出的该行装饰被丢弃）；
- 光标行变化 → 解锁；
- 显现集合从 `∅` 变成某段（方向键进标记）→ 解锁；
- 跨行改动（含多行粘贴）→ 解锁；
- 冻结只吃 `live-preview` 自己的装饰，代码高亮装饰不在冻结范围内；
- 位置映射：在冻结行内插入字符后，锁定装饰随 `map` 平移。

### S2 接线 + 订正注释

`apps/web/src/app/editor/live-preview.ts`（只加约 10-15 行）：

- `update()` / `rebuild()` 里维护锁定状态并在派发前应用 `freezeLine`；
- 订正 `:510-517` 那句与事实不符的注释（"新敲出来的标记在语法树里还不存在"——增量解析其实已经解析了）；
- `:523-535` 的"重算时机"表补两行：冻结规则、解锁条件。

### S3 选区夹取

`apps/web/src/app/editor/frontmatter-hide.ts:104-116`：`inside` 判定改为**逐 range 夹取**——`from`/`head` 落进隐藏区的一端夹到 `range.to`，两端都在隐藏区内才退成光标；夹完无变化不派发；多光标用 `EditorSelection.create` 重建一次。**`atomicRanges`（`:127`）不动。**

### S4 纸面点击与当前行（只改 `apps/web/src/app/theme/app.css`）

- `:838-845` `[data-editor] .cm-scroller`：去掉 `padding: var(--sp-5) 48px 80px`，补 `align-items: stretch`（覆盖 CM 自带的 `flex-start !important`）；
- `:846-856` `[data-editor] .cm-content`：接上这份内边距，并补 `width:100%; box-sizing:border-box;`（不补会把横向滚动条顶出来）；
- `:886` `.cm-focused .cm-activeLine`：不再给 `background: var(--bg-soft)`（`:882` 的 `transparent` 保留即可）；
- 视觉不变的部分不要顺手改：纸面 800、文字列 704（`--sp-5` 24 + 48 = 72 不在 740/704 那套数字里，**内边距是纸面的，不是文字列的**）。

### S5 附件按钮进工具栏

- `apps/web/src/app/editor/EditorToolbar.tsx`：props 加 `onAttach?: () => void`；`INSERT_TOOLS`（`:51-54`）末尾加 `{ id: "attach", icon: "image", label: "添加附件" }`（`Icon.tsx:37` 已有该图标），沿用 `disabled`/`disabledReason`；
- `apps/web/src/features/notes/ui/NoteWorkspace.tsx`：隐藏 `<input type="file" multiple>`（`:417-431`）留在原处，工具栏传 `onAttach={() => fileInputRef.current?.click()}`；`:432-440` 那颗按钮的渲染条件改为 `shownMode === "preview"`（工具栏只在编辑档与即时渲染档存在，`:513`）；
- 上传链路（`onFiles` → `NotesPane` → `useAttachments.add()`）不动。

### S6 验证与交付

1. `pnpm lint`（0 error）→ `pnpm typecheck`（四包）→ `pnpm test`；本机 8 个 vitest 文件的既有失败是 jsdom 取不到 `window.localStorage` 的环境问题，与本次无关，报告时如实写明。
2. 真机复跑设计稿 §6 的 **A–H** 全部八条（含 C 代码高亮不冻结、H 粘贴多行不被冻结卡住）。
3. 根 `package.json` version → **0.8.39**；`CHANGELOG.md` 最上方 `## 2026-10-18` 下追加一条（带版本号，提交后补 commit hash）。
4. 文档回写（按设计稿 §7）：`docs/modules/Menote-编辑器体验优化-设计-v1.md` → v1.4；`DESIGN.md` 视 §5.6 有无相关行而定。
5. 提交：代码与文档分开，中文 Conventional Commits，消息写进 `.git/COMMIT_MSG.txt` 后 `git commit -F`，提交后 `git log -1 --format="%s"` 核对首行。

## 未验证/风险

同设计稿 §8：第 1.2/1.3 条先是源码层推断（S0 复现）；`align-items: stretch` 覆盖 CM 的 `!important` 需在两种档与表格档各看一眼；冻结的解锁边界必须有用例钉住；`live-preview.ts` 已 723 行，接线不外溢。

## 落地结果（v2 补，2026-10-18）

**S0 复现（隔离环境，`agent-browser` 真机 + 探针）**：三条全部对上，根因与推断一致——A ＝ 光标停在标记 `to` 时半开区间判不中、标记被立刻藏起来（`live-preview-reveal.ts:137`）；D ＝ `frontmatter-hide.ts` 的 `keepCursorOut` 把整段选区塌成隐藏区末尾的一个光标；E ＝ 纸面内边距与文字下方空白都属 `.cm-scroller`，CodeMirror 的鼠标事件只绑在 `.cm-content` 上。

**S1–S5 实际落地与计划的三处偏差**（都是落码时按真机结果定的）：

1. **模块改名**：实际导出 `sameReveal` / `lockHolds` / `freezeLine` / `lineDecorations` / `insertsLineBreak`（计划里拟的 `sliceLine` / `equalsReveal` / `shouldUnlock` 合并成了 `lockHolds`）；用例 11 条（另有 `frontmatter-hide.test.ts` 新增夹取用例）。
2. **冻结只吃 point 装饰**：计划与设计稿都写"冻结只覆盖 live-preview 自己的装饰、代码高亮不参与"，首版按"整行装饰一起冻"落地，真机立刻出现"旁边行上色、正在编辑这一行不上色"。改为在 `freezeLine` / `lineDecorations` 里按 `Decoration.replace` / `Decoration.line` 过滤（`Decoration.mark` 一律放行、永远现场重算）。
3. **`align-items: stretch` 必须带 `!important`**：不带的话计算值仍是 `flex-start`（CodeMirror 自己那条是 `flex-start !important`），纸面下半张依旧点不落光标；真机几何实测确认后补上，`apps/web/test/css-cascade.test.ts` 同步把"纸面不给自己垫内边距 + 内边距挂 `.cm-content` + 纸面带 `align-items: stretch !important`"钉住（该文件 + `layout-invariants` + `style-coverage` 共 47 条全绿）。
4. **附件旧入口的保留条件**取 `shownMode === "preview" || bodyLocked`（不只是 `preview`：锁定态下工具栏不渲染，不留入口就等于没有）。

**S6 真机验收 A–H（全部通过）**：

| 点 | 现象（改动后） |
| --- | --- |
| A 标记冻结 | 空行敲 `#` → 屏幕上就是 `#`、无 `cm-live-h*`、无行高跳变；`## 标题文字` 原样可见；**光标离开该行后**立刻渲染成标题（`cm-live-h2`、标记隐藏），点回该行又恢复源码可见 |
| B 方向键进标记 | `## 一级标题` 行尾按 ← 第 5 次进到标记内部 → 该行显现源码、光标 x 931 → 950；判据（半开区间）一字未改 |
| C 代码高亮不冻结 | 正在编辑的代码行里插字符，`tok-*` 高亮跟着新文本走（首版整行冻结时为"这一行不上色"） |
| D 划选 | `Ctrl+A` 全选（长度 17）；从正文往上拖出纸面顶部 → 选区保持（长度 17），不再塌成光标 |
| E 纸面留白点击 | 点文字、左右内边距、文字下方深空白共 6 处 → 全部 `focused:true` 且落光标（改动前文字下方那处会让编辑器失焦） |
| F 当前行底色 | `activeLineBg` ＝ `rgba(0, 0, 0, 0)`（改动前 `rgb(247, 247, 247)`） |
| G 工具栏附件 | 工具栏出现 `data-toolbar-button="attach"`（标题「添加附件」）；真机上传两张图，占位被替换成 `![probe-2x1.png](/api/attachments/h/<id>)`；仅预览档仍保留原入口（同一个隐藏 `<input>`） |
| H 多行导入 | 一次插入 6 行含标题 + 围栏代码的 md → 立刻成型（`liveHeadings:[2]`、标记隐藏），光标不丢 |

**验证命令**：`pnpm lint` 0 error / 1 既有 warning（`NotesPane.tsx:263` 的 `useMemo` 依赖，与本批无关）；`pnpm typecheck` 四包全过；`pnpm test` 相比基线**只多不少**（既有 8 个 vitest 文件因 jsdom 取不到 `window.localStorage` 在本机失败，与本次改动无关，`git stash` 干净基线同样失败）。

**遗留（与本批无关，另行确认）**：真机上传时第一次（光标在正文开头、文档以 front matter 开头）的占位一直停在「上传中：probe-1x1.png」没被替换，第二次（光标在文末）正常。附件链路本批一字未动，疑与"同一内容并发去重 + 锚点位置"有关，需单独复现。
