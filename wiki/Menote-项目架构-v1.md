# Menote 项目架构设计（v1）

| 项 | 内容 |
|---|---|
| 文档版本 | v1.24（**2026-10-11 空白新建不落库**：新建条目**出生时不写 outbox**，等第一次出现可见文字或标题才补第一条 `create`；判定与回收放 `data/db/seed.ts`，触发点是「离开这一篇」与「启动兜底扫一遍」，接线在 `features/notes/blankSeeds.ts`。**只动 §6.3 一条、没有新表新接口**。上一版 v1.23：**2026-10-11 侧栏与纸面观感调理**：纸面 `max-width` 740 → **800px**、内边距 → **48px**（文字列仍 704——740 是**文字列**上限），让位门槛 `BOTH_RAILS_MIN_PANE` **1244 → 1304**（= 2 × 252 + 800）；折叠把手加长（内边距 8 → 20px）并把圆角/平边镜像纠正为「平边贴外侧、圆角朝正文」；两侧卡改 `--bg-soft`、去阴影、圆角收小。**落点、文件、接口都不变**，只有取值与观感。上一版 v1.22：**2026-10-11 正文区两侧贴边面板 + 大纲回写**：属性卡从「正文上方的第三带」搬进**正文区左侧的贴边面板**，右侧新增**大纲面板**；`.doc-rail` 与正文同级、`position: sticky; top: 0`，收起是 28px 竖排把手、展开是 240px 卡，正文区 ≥ `2 × (240 + var(--sp-3)) + 740 = 1244px` 才两侧同开、否则自动收一侧让正文变宽——**不覆盖正文**。落点全在 `features/notes/`：新增 `ui/DocRail.tsx` / `useRails.ts` / `outline.ts` / `useOutline.ts` / `ui/OutlinePanel.tsx`，`props-collapse.ts` 扩成三个**本机** key（旧的 `props-collapsed` 反向迁移一次）；标题判据**不新增**，走 `packages/mdcore` 的 `listHeadings`（复用 `section.ts` 的 `scanHeadings`，与 MCP 的 `read_item(section)` 同源）；`EditorHandle.topVisibleOffset()` 换成 **`offsetAtViewportY(y)`**（真正滚的是 `.doc-split__pane`，`scrollDOM.scrollTop` 恒为 0）。`DESIGN.md` v1.17 给了 §2.7「每层只允许一个滚动容器」的**唯一一处例外**（这两块面板的卡体自己滚）。v1.21 的显示名与 `prop_labels` 回写维持不变） |
| 日期 | 2026-09-25（v1）/ 2026-09-26（v1.1–v1.11 修订）/ **2026-09-27（v1.12 隐私锁回写、v1.13 M4 回写）** / **2026-09-28（v1.14 单一实例机密）** / **2026-09-29（v1.15 编辑器档位三档）** / **2026-10-03（v1.16 M5 分享收口回写、v1.17 M6 第一批回写、v1.18 M6 收口回写、v1.19 M7 收口回写）** / **2026-10-11（v1.20 属性库回写、v1.21 属性卡片与属性库重画回写、v1.22 两侧贴边面板 + 大纲回写、v1.23 侧栏与纸面观感调理、v1.24 空白新建不落库）** |
| 基准 | 仓库根目录 `Menote-设计文档-v7.4.md`（下称“需求文档”）。本文只回答“怎么实现”，不改变需求文档中的任何产品决定；引用需求文档章节时写作“需求 x.y” |
| 运行环境 | Cloudflare 免费版：Workers（含 Static Assets、Cron Triggers）+ D1 + R2；客户端为浏览器 PWA |
| 性质 | 架构设计，不含应用代码；接口、表结构、目录结构均为草案，实现时细化 |

### 修订记录

| 版本 | 日期 | 内容 |
|---|---|---|
| v1 | 2026-09-25 | 初稿 |
| v1.1 | 2026-09-26 | ①隐私模型修订【已定·用户确认】：服务端明文存储 + 前端门禁 + 备份导出加密，删除非对称密钥对、数据密钥层级、正文密文信封、批量转换任务与恢复码（第七章重写）；②登录与隐私密码 KDF 统一为 PBKDF2-SHA-256，前端零 wasm；③评审报告（deliverables/gstack/architecture-review-menote-v1-2026-09-26.md）阻塞项 #1、#2 随之失效 |
| v1.2 | 2026-09-26 | 部署方式定稿【已定·用户确认】：从 GitHub 一键部署到 Cloudflare，资源在部署时自动创建并关联，无需提前手动创建（新增 15.5）；§15.2 发布主路径改为 Workers Builds，GitHub Actions 只保留测试职责；§15.3 生产环境落点同步更新 |
| v1.3 | 2026-09-26 | 代码组织定稿【已定·用户确认】：单仓多包确认；新增 2.3.1 入口只装配规则（Workers 无 server.mjs，入口文件内容白名单与行数预算）、2.3.2 功能→代码落点对照表（纵向切片）、2.3.3 防膨胀护栏（依赖方向 lint + 文件行数预算进 CI）；§3.1 分层图中遗留的 ConvertService 更正为批量标记服务 |
| v1.4 | 2026-09-26 | 文档目录定稿【已定·用户确认】：细化 docs/ 结构（新增 2.3.4）——组件规划 components.md、方案讨论草稿 proposals/、归档 archive/、操作指南 guides/；明确每类文档职责边界、生命周期（草稿→定稿→归档）与进入门槛，防止文档混乱增殖 |
| v1.5 | 2026-09-26 | 文档体系对齐 AGENTS.md【已定·用户确认】：改为 wiki/ 定稿区（需求、拆解、架构、组件规划、ADR、指南）+ docs/ 过程区（modules/ 专项设计与草稿、archive/ 归档）两层模型；根目录新增 AGENTS.md / DESIGN.md（视觉源）/ CHANGELOG.md / README.md；proposals/ 并入 modules/（以文档状态头部区分）；补迁移时机注 |
| v1.6 | 2026-09-26 | docs/ 扩充【已定·用户确认】：新增 todo/ 专项计划目录（一个功能/任务一份实施计划，做完归档）与 scratch.md 草稿文件（临时讨论追加区，定期清理）；AGENTS.md「文档放哪」同步 |
| v1.7 | 2026-09-26 | 草稿改为目录【已定·用户确认】：docs/scratch.md 改为 docs/scratch/ 文件夹——临时讨论与方案草稿一份讨论一份文件（`<主题>-<日期>.md`），定稿搬走、过时件清理；AGENTS.md 同步 |
| v1.8 | 2026-09-26 | 文件位置迁移执行完毕【已定·用户确认】：三份主线文档移入 `wiki/`，功能拆解 v1 移入 `docs/archive/`，根目录新增 `README.md`；本文路径变为 `wiki/Menote-项目架构-v1.md` |
| v1.9 | 2026-09-26 | M1 开工前同步【已定·用户确认 2026-09-26】：①§15.4/§15.5 迁移机制统一为**运行时自愈**，删除部署脚本里的 `wrangler d1 migrations apply` 写法（该命令在全新账户上会因查不到库而失败、且对 Workers Builds 通道无效）；②§5.1 建表改指向新隐私模型权威 DDL（`docs/modules/Menote-数据模型与迁移设计-v1.md` §3，需求 18.2 原文勿直接照抄）；③§6.1/§6.3 清理 v1.0 遗留（拉取实体清单里的“数据密钥”、outbox 的 `key` 实体）；④§15.5 机密清单删 `SESSION_SECRET`（会话令牌随机 256 位、库里只存 SHA-256，不需要服务端密钥）；⑤§2.3.2 补落点行（`/api/health`、`services/auth.ts`、`/api/admin/*` 归 `routes/settings.ts`）并在目录树补 `middleware/`；⑥表头文档版本由 v1.1 更正为 v1.9 |
| v1.10 | 2026-09-26 | M1 收口回写【已定·用户确认 2026-09-26】：①§15.5 **删除 `wrangler.jsonc` 的 `"secrets": { "required": [...] }` 写法**——实测它是 deploy 硬门禁（机密未设即部署失败，而首次部署时 Worker 不存在、无法先设机密，等于堵死一键部署）；改为「Dashboard / `wrangler secret put` 设机密 + 运行时 `middleware/config-guard.ts` fail-closed（缺机密返回 503 并说明缺哪项）」；②§6.x `prelogin` 行补全确定盐口径（`HMAC-SHA256(AUTH_PEPPER, "menote-prelogin-v1:" + 用户名小写)[0..16]`，注册与改密沿用同一个盐，否则注册/改密后立即登不进去；附带收益是不泄露用户名是否存在），并补公开接口 `GET /api/auth/registration-state`（不受机密缺失影响）；③§2.3 目录树 `middleware/` 注释补 `config-guard` |
| v1.11 | 2026-09-26 | M2 收口回写【已定·用户确认 2026-09-26】：①§2.3.2 Worker 侧补落点——`POST /api/batch`（`routes/items.ts` + `services/batch.ts`）、搜索兜底 `GET /api/search`（`routes/search.ts` + `services/search.ts`）、用户级设置 `GET/PUT /api/settings` 归 `routes/settings.ts`、迁移目录注明 0001 建表与 0002 任务字段约束触发器，并在同步行注明响应另带 `user_settings` 且**不参与游标**；②§2.3.2 Web 侧补落点——`data/sync/`（含 broadcast）与 `data/db/`（含 search / settings / conflicts）不属任何 feature、`features/notes/` 含文件夹与冲突处理、各 feature 的 `model.ts`/`actions.ts` 分工、搜索的 `useSearch.ts`，并**订正**「索引在 `workers/search.worker.ts`」为本地增量索引 `data/db/search.ts`（Worker 化未做，属 M2 已知偏离）、补 `packages/mdcore/` 一行；③`app/` 落点写明子目录（`ui/`、`fnbar/`、`topbar/`、`workarea/`、`theme/`） |
| v1.12 | 2026-09-27 | 隐私锁设计 v1.3 回写【已定·用户确认 2026-09-27】：①**§7.1 门禁模型**补**隐私范围**（加密空间＝默认成员、恒在范围内、不可移出；Memo 及衍生的待办＝可配置开关、默认加入；另留扩展位）与**单篇加密＝与隐私锁正交的独立门禁**（逐篇解密、时效本次浏览器会话、可手动锁上），档位由四档改**三档**（本次会话 / N 分钟 / 当前设备长期）并删「仅本次查看」，补**统计计数一律计入全部隐私内容、不因锁定改变**与「空间内条目解锁期间进入最近编辑/收藏/标签、重锁即隐藏」；②**§7.2 / §5.1** 写入 `user_crypto` **权威列定义**与 BLOB 打包约定（`版本(1B) \|\| IV(12B) \|\| 密文 \|\| GCM 标签(16B)`、verifier 明文常量 `menote-verifier-v1`、迭代 600000、盐 16B、两份包裹的明文均为 32 字节 K）、**不加 `sync_seq`** 与四个专用端点（`GET/PUT /api/crypto`、`POST /api/crypto/reset`、`DELETE /api/crypto` 关闭时校验无隐私内容含回收站）；③**§7.5** 本地搜索索引口径改为「**标题（+标签）与正文分两段索引 + 查询时按门禁过滤**」，补**两套标识**（隐私锁态 / 单篇加密态）与本模型下**不再需要** `visibilitychange` 锁屏、SharedWorker、持久化 CryptoKey、撤销 `blob:`；④**§11 MCP** 补不变式 **I1/I2**（可见集合口径、与隐私锁状态无关；界面矩阵与 MCP 矩阵互不联动）与「条目数不含隐私内容、空间节点不进 MCP 文件夹树」；⑤**§12.4 / §13.2 / §15.5** `BACKUP_CRED_KEY` **由 M5 提前到 M3** 并注明派生（`SHA-256(机密字节)`）与轮换风险（换机密后需在解锁态重新包裹一次 K）。（应用版本 v0.3.2；修改模型ID：deepseek-v4.1-flash） |
| v1.13 | 2026-09-27 | M4 设计 §九 回写【已定·用户确认 2026-09-27（授权两点之一）】：①**§5.1** 技术补充的 DDL **不再逐条重述**，权威落点改指《Menote-M4-设计-v1》§六（迁移 `0004_content_integrity`），六表清单写明并**新增 `pending_uploads`**（上传意图登记从 `r2_gc_queue` 的 `reason='pending_upload'` 拆出独立表：待删对象与待确认上传的生命周期不同）；②**§5.2** 缩略图键 `a/{uid}/{sha256}.t` **去掉【待核实】、标为定稿**，并写明原图与缩略图共用同一个 `sha256`、用 `kind` 区分；③**§八 + §2.3.2 + §2.3 目录树 + §3 分层图**：**删除 `workers/media.worker.ts` 落点**（缩略图改浏览器端生成，理由同 M2 砍 `search.worker.ts`），时序图参与者改为编辑器（浏览器）并改为"两段上传"（`check` → `blob` → `finalize`），写明**引用只在 `finalize` 时上报**、`X-Menote-Refs` **未实现**、集合对齐语句留 M6；④**§12.1 / §12.2 / §12.3**：补**游标键名**（`job:gc:cursor` / `job:maintenance:day` / `job:maintenance:step` / `job:sweep:item`）与"**不加锁、容忍重复**"的结论及理由，任务配额按实测定值（快照与备份标为接口位），补版本稀疏化的密度分档与回收站保留期接用户设置，§12.3 补"一次逻辑写共享一个 `sync_seq`"与"快照文件属 M5/M6、M4 只留接口位"。（应用版本 v0.4.25（M4 收口期间的写回；里程碑版本为 v0.5.0）；修改模型ID：deepseek-v4.1-flash） |
| v1.14 | 2026-09-28 | **实例机密由两个收敛为一个**【已定·用户确认 2026-09-28】：删除 `BACKUP_CRED_KEY`，**唯一根机密是 `AUTH_PEPPER`**；备份包裹键（`k_wrapped_backup`）改为从它**域分离派生**——`SHA-256(AUTH_PEPPER 字节 ‖ 用途后缀)`，后缀常量 `menote-backup-wrap-v1`，常量与 `backupWrapKeyInput()` 定义在 `packages/shared/src/crypto.ts`（唯一定义处），worker 在 `services/crypto.ts` 做一次摘要与导入。**为什么加后缀**：同一根机密还要供登录校验（`HMAC(AUTH_PEPPER, …)`）与将来的分享令牌签名，加用途后缀才能保证各用途的钥匙**互不可推**——这不是"把同一个字节串当两把钥匙"。**失败模式变化**：不再有"缺 `BACKUP_CRED_KEY` 就 503"，缺根机密时统一在 `requirePepper` 处明确报错。**兼容性**：已用真实 `BACKUP_CRED_KEY` 启用过隐私锁的实例，其旧 `k_wrapped_backup` 解不开 → **只影响"忘记隐私密码 → 重置"**（登录 / 解锁 / 改密不受影响，改密时旧包裹原样带回），修复办法是在**解锁态重新包裹一次 K**。波及表述：§7.2 / §7.4 / §12.4 / §13.2 / §15.5。（应用版本 v0.5.14；修改模型ID：deepseek-v4.1-flash） |
| v1.15 | 2026-09-29 | **编辑器档位口径回写**【已定·用户确认 2026-09-29】：产品只有**三档**——仅编辑（`edit`）/ 仅预览（`preview`）/ 即时渲染（`live`），显示顺序即 `edit → preview → live`；**「双栏」（`split`）已从产品移除**（阶段 A / v0.6.0），旧值只读兼容（`EditorModeSchema` / `EDITOR_MODES` 四值、`normalizeEditorModes()` 唯一归一化入口），UI 与新写入只产生三档。改 **§1.6 分层图**节点（"三种模式"→三档名单）与 **§3.3 编辑器**（删掉"双栏：CodeMirror + 预览面板按滚动位置同步"这一分支，改为三档如何共用同一个 `EditorState`：仅编辑 / 仅预览切换布局可见性、即时渲染走 `Compartment` 重配置并保留同一文档；并写明**没有「默认档」**，打开笔记用本机记住的「上次用的那一档」，阅读态由「仅预览」承担、`readOnly` 只是 `Editor` 内部能力）。与 `wiki/Menote-设计文档-v7.4.md`（内部 v7.5.5）、`wiki/Menote-功能拆解-v2.md`（v2.11）、`wiki/components.md`（v7）、`DESIGN.md`（v1.11）同批回写。（应用版本 v0.6.2；修改模型ID：deepseek-v4.1-flash） |
| v1.16 | 2026-10-03 | **M5 分享收口回写**【已定·用户确认 2026-10-03】：①**§十 按已落地实现补全**（S1 服务端 v0.6.13 / S2 管理端 v0.6.14 / S3 查看器 v0.6.15）：**入口偏离订正**——原定独立入口页 `apps/web/share.html` **未采用**（`@cloudflare/vite-plugin` v1.60 接管客户端入口，第二个 html input 报 `UNRESOLVED_ENTRY`），改为经 Static Assets 的 SPA 回退由 `apps/web/src/main.tsx` 按 `pathname` 分流、两侧动态 `import()`（访客不拉编辑器与同步 chunk）；补**访问令牌放 `X-Menote-Share` 头不进 URL**（1 小时、无状态不写库）、**origin 决策**（独立子域、与主应用同一个 Worker、子域值存实例设置且**留空回退同域**）、**会话隔离零配置**（Cookie 无 `Domain` → host-only，子域上 `/api/*` 天然 401）、**公开附件按正文当前稿引用白名单**（不查 `attachment_refs`，集合对齐属 M6）、**首期只做单条分享**（M14-02 合集后置，`share_items` 建表不接 UI）、Q18 只读表格 + 有附件时图册切换。②**§2.1** Static Assets 规则补查看器的分流与动态 chunk 事实；**§2.3 目录树**删 `share.html`、`index.html` 标为唯一入口；**§2.3.1 入口预算表**把「`share.html` 对应的入口」改为 `features/share-viewer/main.tsx`（特性根，非独立入口，≤50）；**§2.3.2 落点表**分享行补 `services/share-public.ts` 与 shared 契约两处、备份行订正落点、分享管理端与查看器分行。③**顺带订正一处落点错误**：备份格式契约原写「编解码调 `packages/crypto-format`」，该包**经 M5 设计 §七定论不建**（契约属纯数据 schema），实际在 `packages/shared/src/backup.ts`——`AGENTS.md` 同一处描述同期订正。（应用版本 v0.6.17；修改模型ID：MiniMax-M3.1-Flash-Preview） |
| v1.17 | v0.6.20 | 2026-10-03 | **M6 第一批回写**【已定·用户确认 2026-10-03】：①**§6.1** 把 `X-Menote-Refs` 的语义写准——原表只写了头名与「有变化时才带」，现补三条确切语义（**不带 = 引用表一个字不动** / 带非空数组 = 整体替换 / 带空数组 = 清空当前稿引用），并写明**必须与正文同一次写对齐**及其理由（孤儿满 30 天由每日维护真删 R2 对象，正文里仍显示的图会凭空消失）。**注意：这张表里 `X-Menote-Refs` 早在 M4 就已写下，是一直未实现的挂账**——v0.6.20 才真正落地。②**§十** 补「**失效分两层**」：实时检查（`isShareLive`）之外，**软删条目 / 隐私标记置位时服务端真撤销分享行**（`SQL_REVOKE_ITEM_SHARES`，限 `user_id`、幂等、**不推 `sync_seq`**），并说明为何不能只靠客户端 `revokeItemShares`（那段每个 revoke 都被 try/catch 吞掉、且在另一台设备上恢复条目时根本不会跑）。③§2.3.2 落点表待 2c 批做完再补 `GET /api/attachments`。（应用版本 v0.6.20；修改模型ID：MiniMax-M3.1-Flash-Preview） |
| v1.18 | v0.7.0 | 2026-10-03 | **M6 收口回写（含 MCP 全套）**【已定·用户确认 2026-10-03】：①**§十一 MCP 按已落地实现补全**（v0.6.23–v0.6.26 四批）：**限速落地方式偏离需求 §17.3**——改用 **D1 计数落 `api_tokens` 行**（不建 `rate_counters` 表、不加 Rate Limiting 绑定），理由是令牌查询那次读本来就要做、计数与 `last_used_at` 能合并成同一条 `UPDATE`；并写明**需求那条「`last_used_at` 最多每 10 分钟写一次」的节流刻意不做**（已无可省之物，留着只会让人以为它不生效）。**令牌哈希必须带 `mn_` 前缀做域分隔**——会话令牌存的是裸 32 字节的 SHA-256，而 MCP 令牌恰好也是 32 字节 base64url，两边都哈希裸字节就能互相冒充，那是一条实打实的越权。`/mcp` **必须列进 `wrangler.jsonc` 的 `assets.run_worker_first`**，否则 SPA 回退把 POST 吃掉、客户端拿到 HTTP 200 + HTML（极难与鉴权/协议问题区分）。**512 KB 门槛实测结论**（原文的【待核实】已销）：390,040 字节中文正文的 `read_item(section)` 解析 + 往返 20 ms → **门槛不动**，其作用是防止正文被取回内存而非 CPU 不够。另登记**已知未实现**：`replace_text` 对 >512 KB 条目走 SQL 那条路径。②**审计与幂等同批**的落地细节：四个既有写函数各加一个可选尾随语句参数（默认空 = 行为不变）、幂等四步（预检冲突一行都不写 / 极小竞态补删幂等行 + conflict 审计）、**参数摘要不能用 `JSON.stringify(args, keys)`**（数组 replacer 会过滤嵌套对象的键，导致幂等误判成重放）。③补两条结构性决定：**MCP 不改变内容的加密归属**（不能移入加密空间 / 不能置 `enc_self` / 不能改 `type`），**写前封存 `pre_mcp` 用 `keep = 1`**（否则「可在版本历史撤回」不成立；该枚举值自 M4 起就存在、v0.6.25 才第一次有生产调用方）。④**§2.3.2 落点表**补 MCP 全套（`routes/mcp-tokens.ts` / `routes/mcp.ts` / `services/mcp/` 十一件 / `db/mcp-tables.ts` / `features/mcp/`）与 M6-2c 遗留的 **`GET /api/attachments`**（v1.17 记的"待 2c 批做完再补"在此结清）。（应用版本 v0.7.0；修改模型ID：MiniMax-M3.1-Flash-Preview） |
| v1.27 | 2026-10-19 | **编辑设置落地回写**【已定·用户确认 2026-10-19】：设置分类 **10 → 11**（新增「编辑设置」），落码应用版本 v0.8.40。①**§2.3.2 落点表**：设置行补 `features/settings/editor-typography.ts`（编辑设置的读侧夹取与 CSS 变量，唯一的读侧关口）与 `ui/EditorSettingsPage.tsx`（新分类四张卡）；笔记编辑行补 `app/editor/toolbar-size.ts`（工具栏尺寸的本机偏好）。②**契约**：`packages/shared/src/settings.ts` 新增 `editor_typography`（optional + 默认，读侧补默认、**不需要迁移**，与 `prop_library` 同一条路数）；`editor_modes` 卡的挂载页由「通用」改为「编辑设置」。③**取值来源只有一处**：`EDITOR_FONT_SIZE_MIN/MAX`（11/24）、`EDITOR_PAPER_WIDTH_MIN/MAX`（640/1100）、`HEADING_FONT_SIZE_MIN/MAX`（10/40）、`HEADING_WEIGHTS`、`EDITOR_FONT_FAMILIES` 全在 `shared`，设置页与读侧夹取都从它推导；CSS 变量一律带兜底（`--doc-paper-w` 兜底 800px），所以"没配过"与加这个设置之前逐像素相同。设计依据 `docs/modules/Menote-编辑设置-设计-v1.md` v1；`DESIGN.md` 同步 v1.20 | deepseek-v4.1-flash |
| v1.26 | 2026-10-18 | **编辑器交互修复落地回写（批次一）**【已定·用户确认 2026-10-18】：用户口述六条现象，其中四条属编辑器交互，经真机复现→设计→落码（应用版本 v0.8.39）。①**§3.3** 补一条时机例外——**正在编辑的那一行冻结**：光标停在某一行期间该行保持进入时的呈现，`{行号, 显现区间}` 变化或改动含跨行变更才解锁；**判据一字未改**（仍是 v1.25 的半开区间 `[from, to)`），改的只是重算时机，所以"敲 `##` 立刻被藏起来 + 闪动"消失；冻结**只吃 point 装饰**（`Decoration.replace` / `Decoration.line`），**代码高亮 token（`Decoration.mark`）永远现场重算**——首版按整行一起冻，真机立刻出现"旁边上色、这一行不上色"。②**§2.3.2 落点表**新增 `app/editor/live-preview-lock.ts`（冻结判定的纯函数：`lockHolds` / `freezeLine` / `lineDecorations` / `insertsLineBreak`；`live-preview.ts` 已触 `max-lines` 预算，且 jsdom 建不出真 `EditorView`，判定必须纯）。③**划选不再被截断**：`app/editor/frontmatter-hide.ts` 的 `keepCursorOut` 由"选区与隐藏 front matter 相交就整段塌成光标"改为"**只把落进隐藏区的那一端夹到隐藏区末尾**"（用户报的"拖拽变成拖光标"、`Ctrl+A` 全选不上都是它；旧行为没有用例钉住）。④**纸面整块可落光标**：`[data-editor] .cm-scroller` 的内边距搬到 `.cm-content` 并加 `align-items: stretch !important`（CM 自己那条是 `!important`，不带则计算值仍是 `flex-start`），左右留白与文字下方空白从此都落到 CodeMirror 的 `posAtCoords` 上；⑤**当前行不再有整行底色**（比 `--bg-soft` 更淡的中性令牌不存在，`--panel-2` 更深）；⑥**「添加附件」搬进格式工具栏**（`EditorToolbar` 新增可选 `onAttach`），原入口只在仅预览档保留（工具栏只在「仅编辑 / 即时渲染」两档渲染）。设计见 `docs/modules/MeNote-编辑器交互修复-设计-v1.md` v1.1（含 A–H 真机实测结果），回写 `DESIGN.md` v1.19、功能拆解、`wiki/components.md` v21、`docs/modules/Menote-即时渲染-设计-v1.md` v8。**未改**：判据、`atomicRanges`、front matter 隐藏判据、纸面 800 与文字列 704、让位门槛 1304。（应用版本 v0.8.39；修改模型ID：deepseek-v4.1-flash） |
| v1.25 | 2026-10-18 | **编辑器体验优化落地回写**【已定·用户 2026-10-18 放行】：①**§3.3** 即时渲染的口径由「光标所在行显示源码」改为「**完整识别到的语法立即呈现；折叠光标只有落进被隐藏标记的半开区间 `[from, to)` 时才临时显现包含该标记的最小受支持语法节点源码**」，并明确**隐藏标记不再挂 `EditorView.atomicRanges`**——标记既是原子区间、又要"光标进得去"，二者不可兼得（原设计的揭示规则会永远不可达），`livePreview()` 不再拼 `EditorView.atomicRanges.of`、`LivePreviewDecorations` 去掉 `atomic` 字段。②**§2.3.2 落点表**补三个新文件：`app/editor/loader.ts`（共享加载函数 + 空闲预载 + 网络策略，**预载与按需共用同一个 Promise、失败不自动重试**）、`app/editor/EditorLoadBoundary.tsx`（正文区片内懒加载错误边界 + 手动重试）、`app/editor/live-preview-reveal.ts`（揭示判定的唯一实现，因 `live-preview.ts` 触到 `max-lines: 500` 预算而分出）；预载触发点放主工作区挂载处（`app/workarea/NotesPane.tsx`）。③**解析续刷的落点**：**不引入**设计稿 v1.1 提出的 `parseProgressEffect` + 外部 `forceParsing` + 2s watchdog 那套协议，改为在 `LivePreviewPlugin.update` 里比较 `syntaxTree(state)` 的引用变化即重算（整条链收回插件内部，无代次协议）；真实缺口只是"`update()` 原先不认语法树变化"。设计见 `docs/modules/Menote-编辑器体验优化-设计-v1.md` v1.3，计划见 `docs/todo/Menote-编辑器体验优化-实施计划-v1.md` v1。（应用版本 v0.8.37；修改模型ID：deepseek-v4.1-flash） |
| v1.24 | 2026-10-11 | **空白新建不落库**【已定·用户确认 2026-10-11】：用户要求"点了新建文档但是没有写任何文字，也没有写标题，那么这篇文章就不要保存……包括只改动属性没写内容也不保存"。**§6.3 outbox** 补一条规则：新建条目**出生时不写 outbox**（本地该写的照写，但不产生第一条 `create`），等第一次出现**可见文字或标题**（**属性改动不算**）才由既有入队漏斗补上，此后与普通条目一样。**为什么不做成"先建再删"**——两条网络操作 + 要服务端为一条从没用过的记录擦屁股，而"从不上传"只有一个状态；**为什么判定必须落在数据层入队漏斗**（`data/db/repository.ts` 的 `createLocalItem` 与两处 `enqueue*`）——失败方向不对称，漏掉判定就是**有内容却没上传**（丢数据），比空条目多留一会儿严重得多。判定与回收是纯函数 `data/db/seed.ts`（`isBlankSeed` / `isBlankSeedItem` / `purgeBlankSeed` / `purgeBlankSeeds`，清 `items`/`bodies`/`drafts`/`searchIndex`/`outbox`/冲突/附件引用，**只回收 `pending === "create"` 的**），触发点两个：**离开这一篇时**与**启动时兜底扫一遍**，接线在 `features/notes/blankSeeds.ts`；「有没有可见文字」仍走 `mdcore` 剥 front matter 后再判（所以"只改属性"天然不算内容），**表格不受影响**（`renderTableDocument` 恒写表头行）。无新表、无新接口、服务端零改动。功能侧《功能拆解》v2.24 M04-01 / §9.3。（应用版本 v0.8.36；修改模型ID：deepseek-v4.1-flash） |
| v1.23 | 2026-10-11 | **侧栏与纸面观感调理**【已定·用户确认 2026-10-11】：用户第三轮反馈"折叠后的按钮可以加长一点，现在不太明显，而且你 ui 的方向也反了""两侧浮动工具的窗口 ui 可以轻量一点，不要与主内容区抢视觉""主内容区的底部块可以往两侧延伸一点，给文字两侧多一点留白"。据此只调**取值与观感**：①正文纸面 `max-width` 740 → **800px**、内边距 `--sp-6`(24px) → **48px**（文字列仍 704px——`DESIGN.md` §2.3 的 740 是**文字列**上限）；②`apps/web/src/features/notes/useRails.ts` 的 `BOTH_RAILS_MIN_PANE` **1244 → 1304**（= 2 × 252 + 800）；③折叠把手加长（内边距 8 → 20px、字号 `--fs-small`）并把圆角/平边镜像纠正为「平边贴外侧、圆角朝正文」；④两侧卡 `--panel` → `--bg-soft`、去 `--shadow-1`、圆角 `--radius-lg` → `--radius`。**落点、文件、接口、依赖方向都不变**，§2.3.2 只有那一行的常量取值改掉 | deepseek-v4.1-flash |
| v1.22 | 2026-10-11 | **正文区两侧贴边面板 + 大纲回写**【已定·用户确认 2026-10-11】：用户第二轮反馈"左侧属性栏太乱了……那个黄色的提示文字也去掉""左右两侧的浮动组件可以侧面折叠和展开……尽量使内容平铺且不堆叠盖住内容"，据此按设计 `docs/modules/MeNote-属性卡与大纲悬浮-设计-v1.md` v2.1（生效）落码。架构侧的实质变化四处：①§2.3.2 落点表**新增一行**——「正文区两侧贴边面板（属性 / 大纲）」，落点全在 `features/notes/`：`ui/DocRail.tsx`（壳：28px 竖排把手 / 240px 卡，两态**条件渲染**不并存）、`useRails.ts`（展开态 + `railOpenState` 让位规则、`BOTH_RAILS_MIN_PANE = 1244`，`ResizeObserver` 量 `.docpane__body` 的宽）、`outline.ts`（`buildOutline` / `activeOutlineIndex` / `activeOutlineIndexInPreview` / `matchPreviewHeading`）、`useOutline.ts`（取当前节与跳转）、`ui/OutlinePanel.tsx`（列表）；②`props-collapse.ts` 由「一个折叠态 key」扩成**三个本机偏好 key**（`props-open` / `outline-open` / `rails-last`），旧的 `menote:notes:props-collapsed` **反向迁移一次**（`1` → 收起），读不出来一律展开；③**标题判据不新增**：`outline.ts` 走 `packages/mdcore` 的 `listHeadings`（复用 `section.ts` 的 `scanHeadings`，与 MCP 的 `read_item(section)` 同源），前端禁止另写标题正则；④`app/editor/Editor.tsx` 的 `EditorHandle.topVisibleOffset(): number` 换成 **`offsetAtViewportY(y: number): number`**——真正滚的是 `.doc-split__pane`（`.cm-scroller` 不设高度、随内容长，`scrollDOM.scrollTop` 恒为 0），参考线由调用方给。**卡片本体不新建 feature**：属性卡仍是 `features/notes/ui/ItemProps.tsx`，只是**从「正文上方的第三带」搬进左轨**（类名多一个 `itemprops--card`）并**自己不再折叠**（`__toggle` / `__summary` / `collapsedSummary` / `summaryValue` 删除）。`DESIGN.md` v1.17 给了 §2.7「每层只允许一个滚动容器」的**唯一一处例外**（这两块面板的卡体自己滚，限高 `max-height: calc(100vh - 170px)`）。功能侧《功能拆解》v2.22 M04-09 / M04-10，组件侧 `wiki/components.md` v19 §7.10，界面侧 `DESIGN.md` v1.17（§2.7 例外 / §2.8 纸面让位居中 / §5.3 / §5.6 第 11~13 条）。（应用版本 v0.8.34；修改模型ID：deepseek-v4.1-flash） |
| v1.21 | 2026-10-11 | **属性卡片与属性库重画回写**【已定·用户确认 2026-10-11】：用户看过 v0.8.30 / v0.8.31 的实现后提了四点（顶部粗糙、黄字看不出在说哪一项、属性录进来后与内置分成两套、属性库行没对齐且内置不能编辑）并要求加"翻译栏"，据此按设计 `docs/modules/MeNote-属性卡片与属性库-设计-v1.md` v1.1（生效）重画。架构侧的实质变化三处：①§2.3.2 落点表那一行**属性卡片由"两个可选 props"改为"三个"**——`library?` / `onLibraryChange?` / **`labels?: PropLabels`**（仍由 `App` 一处持有当 props 往下传，**不新建 store**；`labels` 走同一条链 `App → NotesSlot → NotesPane → NoteWorkspace → ItemProps`）；②设置项**新增账号级字段 `prop_labels`**（键 → 界面叫法，`packages/shared/src/settings.ts`，与 `prop_library` 并列），设置页那个分类同时管两张表内容（一张表格里的条目与显示名）；③`features/props/model.ts` 增加显示名一族纯函数 `BUILTIN_PROP_LABELS` / `labelFor` / `withPropLabel` / `builtinValueOptions`。**一条边界要记住**：显示名**只活在界面**——不进 md、导出、分享、备份（`packages/shared/src/backup.ts` 的 `settings.json` 现状仍是账号级设置不进备份）、MCP，`mdcore` 根本读不到它。功能侧《功能拆解》v2.21 M04-09 / M18-02，组件侧 `wiki/components.md` v18 §7.10，界面侧 `DESIGN.md` v1.15 §5.3 / §5.6。（应用版本 v0.8.32；修改模型ID：deepseek-v4.1-flash） |
| v1.20 | 2026-10-11 | **属性库（键值字典）回写**【已定·用户确认 2026-10-11】：§2.3.2 落点表新增一行 **`features/props/`**——`model.ts`（条目形状 / 类型 / 键名与保留键规则等纯函数）、`scan.ts`（扫导入文件里的陌生键）、`usage.ts`（本机用量统计）、`ui/PropValueField.tsx` / `ui/PropPicker.tsx` / `ui/PropLibraryPage.tsx`。**卡片本体不新建 feature**：仍是 `features/notes/ui/ItemProps.tsx`，只新增两个**可选** props（`library?` / `onLibraryChange?`），库由 `App` 一处持有往下传、**不新建 store**；设置项键名 `prop_library` 落 `packages/shared/src/settings.ts`，管理页挂进 `features/settings/ui/SettingsPanel.tsx`（设置分类 9 → 10）。**归 feature 的理由**：条目形状与键名规则被卡片、设置页、导入扫键三处共用，但只服务 Web 端，按 2.3.3 第 4 条不该进 `packages/`。连带：新增分类只改 `SETTINGS_PAGES` 与 `PAGE_META`、**不动 `LEGACY_SETTINGS_PAGES`**（撤销分类才需要它）。设计见 `docs/modules/MeNote-属性库-设计-v1.md` v2.2；功能侧《功能拆解》v2.20 M04-09，组件侧 `wiki/components.md` v17 §7.10。（应用版本 v0.8.30；修改模型ID：DeepSeek v4.1） |
| v1.19 | v0.8.0 | 2026-10-03 | **M7 收口回写（定时自动备份四批全部落地）**【已定·用户确认 2026-10-03 拍板 §六 五点】：①**§7.3 那句「固定开销 103 字节」与它自己的偏移表对不上，本节订正为 115**——表逐行自洽（每行偏移 = 上一行偏移 + 上一行长度，内容密文止于 99），加末尾 16 字节标签是 115；而 103 恰好等于 `87 + 16`，**漏算了偏移 87–98 那 12 字节的内容 IV**。**以偏移表为准**（表能自洽，那句总结是算错的旁注）。代码把 `ENVELOPE_OVERHEAD_BYTES`（99）与 `ENVELOPE_FIXED_BYTES`（115）分成两个常量，正是为了不让人再拿 103 写断言。②**补记服务端造信封的做法**（§7.3 / §7.4）：K 包裹块是 `AES-GCM(KEK, K)`，而 KEK 由**隐私密码**经 PBKDF2 派生——**服务端没有密码就没有 KEK**，所以那一块**从库里那份 `k_wrapped_pw` 逐字节取**（本来就是同一种东西），**逐字节取不是重算**。结果与 §6.4「用隐私密码解开即可、不需要离线解密小工具」一致且**不弱化 §5 底线**：备份自足、光有备份没密码解不开、逐文件的随机量是服务端现生成的内容 IV。③**§7.4 补 Cron 备份的实际落点与五条不变量**（每条有用例钉住）：不推超过快照已物化的位置（否则 404 被当成"推过了"，游标一过就**永久丢一次备份**）、游标只推过连续成功的一段、一轮一批 ≤40 外部 PUT 推不完下轮续推、**`append_only` 绝不执行远端 DELETE**、**调度档位只决定"某天推不推"**（`weekly` 取"距上次满 7 天"而非绑星期几，免得用户对齐时钟、错过一轮就永不发）。④**首期只 WebDAV + S3**，**不引 SDK**（SDK 自带重试，而外部子请求 50/invocation 经不起），`kind` 的 CHECK **不放 `git`**——放进去等于宣告已支持而实际没有。⑤**与 M5 的差异写明**：zip 导出今天是「密文原样搬运」而服务端本就存明文，**那一步等于搬明文**（手动导出按需求 §6.4 就是解锁态下导明文）；**自动备份是真加密**。附件字节**不进**服务端快照树（同一桶内按内容哈希已有，再存一份是存储翻倍），故 manifest 的 `attachments` 是空数组——**清单不声称自己没有存的东西**。⑥**§12.1 的 ③ 与 ⑤ 不再是接口位**，两处各有一个独立游标（`user_snapshot_state.cursor_seq` 每用户一行、`user_backup_targets.cursor_seq` 每目标一行），③ 是增量的所以"没东西变"那轮一个字节都不写。⑦**§2.3.2 落点表**补 M7 全套，并**订正 `jobs/backup.ts` 与 `adapters/git.ts` 这两个从未存在过的名字**（真实落点是 `jobs/snapshot.ts` + `jobs/push.ts` 与 `adapters/{webdav,s3}.ts`）。（应用版本 v0.8.0；修改模型ID：MiniMax-M3.1-Flash-Preview） |

### 标注约定

| 标注 | 含义 |
|---|---|
| 【依需求】 | 直接落实需求文档已定的内容 |
| 【架构定】 | 需求文档未涉及的纯技术选择，本文给出方案 |
| 【待确认】 | 会影响用户可感知行为、或需要用户拍板的技术选择；给出推荐项，确认后改为【已确认】 |
| 【待核实】 | 依赖外部事实（平台限额、浏览器支持），开发早期实测或查证 |

---

## 一、环境约束与架构原则

### 1.1 决定架构形状的硬约束

| 约束 | 数值 | 对架构的影响 |
|---|---|---|
| Worker 每请求 CPU | 10 ms（HTTP 与 Cron 相同） | 服务端只做鉴权、条件读写、字节转发；一切计算型工作放浏览器（需求 1.2-5） |
| Worker 启动时间 | 1 秒 | 全局作用域不做重型初始化；不引入大型 SDK；按路由懒加载模块 |
| Worker 内存 | 128 MB | 大请求体一律流式处理，不整体缓冲 |
| 外部子请求 | 50 次/请求 | 备份每轮文件数受限（Git 目标约 40 个） |
| D1 每次调用查询数 | 50 次（免费版） | 单个请求的 SQL 语句总数（含 batch 内）控制在 50 以内 |
| D1 单行 / 单值 | 2,000,000 字节 | 正文硬上限 1,900,000 字节，正文单独成表（需求 18.1） |
| D1 单条 SQL | 100 KB | 正文一律参数绑定，不拼接进 SQL 文本 |
| D1 行读写 | 读 500 万/天、写 10 万/天 | 查询必须命中以 `user_id` 开头的索引；派生写入只写变化部分 |
| D1 单库 | 500 MB | 大体量数据（版本正文、附件、快照）放 R2 |
| Cron Triggers | 每账户 5 个 | 全项目只用 1 个 Cron，在其中按时间片分派任务 |
| R2 | 10 GB-月，A 类 100 万/月 | 附件按内容哈希去重；后台不调用 `ListObjects` |
| 静态资源 | 免费、不限量 | 应用外壳与分享查看器都走 Static Assets，不经过 Worker |

### 1.2 架构原则

1. **胖客户端、瘦服务端**【依需求】：浏览器承担渲染、KDF、哈希、压缩、diff、搜索、ZIP 与备份导出加密；Worker 是“带鉴权的条件存储网关”。
2. **本地优先**【依需求】：界面只读本地数据（IndexedDB）；网络只用于同步。所有写入先进 outbox。
3. **服务端不解析大正文**【依需求】：正文作为不透明字节在 D1 与 R2 之间搬运；需要处理正文的服务端路径（MCP 按小节读写、表格按行操作）设大小门槛。
4. **一份格式代码，前后端共享**【依需求】：Markdown 快照格式、YAML front matter 解析、表格编解码、标签与任务字段派生、接口校验规则写在共享包里，浏览器与 Worker 使用同一份实现。
5. **每个写接口都是条件写**【依需求】：带 `rev` / `meta_rev` 条件，派生写入挂在主写入生效的条件上（mutation guard，需求 18.3）。
6. **后台任务小批、可中断、可重入**【架构定】：Cron 每次只处理一小批，用游标与版本号条件保证中断后下一轮能接着做，重复执行无副作用。
7. **可观测的 CPU 预算**【架构定】：每类接口在开发阶段记录 CPU 耗时，纳入测试门槛（见第十四节）。

---

## 二、总体架构

### 2.1 部署拓扑

一个 Worker 同时提供静态资源、业务 API、MCP 端点与分享接口，同源部署，不拆分多个 Worker【架构定】。理由：免费版额度按账户计，拆分不省额度；同源避免跨域 Cookie 与 CORS 预检（弱网下每次预检都是一次额外往返）。

```mermaid
flowchart LR
    subgraph Browser["浏览器"]
        UI["主线程：界面与编辑器"]
        SW["Service Worker：外壳与附件缓存"]
        WK["Web Worker：搜索、哈希、缩略图、压缩"]
        IDB[("IndexedDB")]
    end
    subgraph CF["Cloudflare（单个 Worker）"]
        AS["Static Assets：应用外壳、分享查看器"]
        RT["路由入口"]
        API["/api：业务接口"]
        PUB["/api/public：分享访问"]
        MCPE["/mcp：MCP 端点"]
        CRON["scheduled：单一 Cron 分派器"]
        D1[("D1")]
        R2[("R2")]
    end
    EXT["外部备份：WebDAV / S3 / Git"]
    AG["第三方 agent"]
    VIS["分享访问者"]

    UI --> IDB
    UI --> WK
    UI -->|"HTTPS 同源"| RT
    SW -.->|"预缓存"| AS
    RT --> API
    RT --> PUB
    RT --> MCPE
    API --> D1
    API --> R2
    PUB --> D1
    PUB --> R2
    MCPE --> D1
    MCPE --> R2
    CRON --> D1
    CRON --> R2
    CRON --> EXT
    AG -->|"Bearer 令牌"| MCPE
    VIS --> AS
    VIS --> PUB
```

**Static Assets 路由规则**【架构定】：`not_found_handling = single-page-application`；只有 `/api/*`、`/mcp`、`/mcp/*` 先进入 Worker（`run_worker_first`），其余路径（含分享页 `/s/<分享ID>`）直接由静态资源返回，不消耗 Worker 请求数与 CPU。**【v1.16 落地补充】** 分享查看器因此经 SPA 回退拿到 `index.html`，由 `apps/web/src/main.tsx` 按 `pathname` 分流并**动态 `import()`**——访客只拉查看器 chunk，不拉编辑器与同步 chunk；**没有第二个 html 入口**（原因与取舍见 §十）。

### 2.2 技术栈

| 层 | 选型 | 理由 | 状态 |
|---|---|---|---|
| 语言 | TypeScript（严格模式），前后端统一 | 共享包需要同一语言 | 【架构定】 |
| 前端框架 | React 19 + Vite | 与 Inkstone 同栈，参照其实现最直接；生态（虚拟列表、CodeMirror 封装）最全 | 【待确认】备选 Preact（体积约为 React 的十分之一，API 兼容）、Vue、Solid |
| 状态管理 | Zustand（界面状态）+ IndexedDB 作为数据真相 | 轻量；数据状态不放内存 store，避免两份真相 | 【架构定】 |
| 样式 | Tailwind CSS 4 | 与 Inkstone 相同；原子类利于按需裁剪体积 | 【架构定】 |
| 编辑器 | CodeMirror 6 + `@codemirror/lang-markdown`（Lezer 语法树） | 需求 7.1 已定 | 【依需求】 |
| Markdown 渲染 | markdown-it（+ task-lists、footnote 等插件）+ DOMPurify | 速度快、插件全；DOMPurify 防止笔记与分享内容中的 XSS | 【架构定】 |
| 表格虚拟滚动 | TanStack Virtual | 需求 10.10-4 要求虚拟滚动；框架无关 | 【架构定】 |
| 本地数据库 | Dexie（IndexedDB 封装） | 事务、索引、批量写，比 idb-keyval 适合结构化数据 | 【架构定】 |
| 本地搜索 | MiniSearch + `Intl.Segmenter` + 二元组兜底 | 需求 13.1 已定 | 【依需求】 |
| 加密 | WebCrypto（PBKDF2-SHA-256、AES-256-GCM） | 仅用于隐私密码派生与备份导出信封（见 7.2 / 7.3）；不再引入 hash-wasm / Argon2id，前端零 wasm | 【架构定·v1.1 简化】 |
| 压缩 / ZIP | 原生 `CompressionStream`；fflate 打 ZIP | 需求 12.4、16.2 | 【依需求】 |
| PWA | vite-plugin-pwa（Workbox，injectManifest 模式，自写缓存策略） | 预缓存外壳，附件缓存规则需自定义 | 【架构定】 |
| 服务端路由 | Hono | 体积小、启动快，Inkstone 同款 | 【架构定】 |
| 接口校验 | Valibot（前后端共享 schema） | 体积和初始化开销都远小于 Zod，适合 1 秒启动限制 | 【架构定】 |
| MCP | 手写无状态 JSON-RPC 分发（不引入官方 SDK） | 需求 17.1：无状态、轻量；官方 SDK 体积与初始化成本偏高 | 【依需求】 |
| S3 签名 | aws4fetch（`UNSIGNED-PAYLOAD`） | 需求 16.3；体积小 | 【依需求】 |
| 构建部署 | Vite + `@cloudflare/vite-plugin` + Wrangler | 一套构建同时产出前端资源与 Worker；线上部署走 Workers Builds（Git 推送触发，见 15.5） | 【架构定】 |
| 测试 | Vitest；Worker 与 D1 用 `@cloudflare/vitest-pool-workers`；端到端用 Playwright | 需求 21.2：从开发之初就有测试与 CI | 【依需求】 |
| CI | GitHub Actions：类型检查、单元测试、Worker 集成测试、构建、包体积检查 | 同上 | 【依需求】 |

### 2.3 仓库目录结构【已确认·用户确认 2026-09-26：单仓多包】

在现有仓库中采用 pnpm workspace 单仓多包结构，需求文档保留在根目录不动：

```
MeNote/
├── README.md                       # 介绍与怎么跑起来
├── AGENTS.md                       # AI 编程代理规则（文档体系以它 + 本节为准）
├── DESIGN.md                       # 界面与交互唯一视觉源（内容从原型设计令牌落稿）
├── CHANGELOG.md                    # 每次改动一条记录（格式见 AGENTS.md）
├── wiki/                           # 定稿区：写入与修改须经用户明确同意
│   ├── Menote-设计文档-v7.4.md     # 需求文档（只读基准，升版本不改名）
│   ├── Menote-功能拆解-v2.md       # 功能点与验收（v1 已过时，届时移 docs/archive/）
│   ├── Menote-项目架构-v1.md       # 本文（版本在修订记录内演进，文件名不变）
│   ├── components.md               # 组件规划：前端组件清单与复用关系
│   ├── adr/                        # 架构决定记录（每条决定一个短文档）
│   └── guides/                     # 操作指南：开发、部署、测试、迁移演练
├── docs/                           # 过程区：结构与规则见 2.3.4
│   ├── todo/                       # 专项计划：一个功能/任务一份实施计划
│   ├── modules/                    # 专项功能设计文档
│   ├── scratch/                    # 草稿：临时讨论，一份讨论一份文件，定期清理
│   └── archive/                    # 归档：只进不出，默认不读
├── prototype/                      # 现有原型，保留
├── apps/
│   ├── web/                        # PWA 客户端
│   │   ├── index.html              # **唯一** html 入口：主应用与分享查看器共用（分流见 §十）
│   │   └── src/
│   │       ├── main.tsx            # 装配：路由表 + Provider + SW 注册，不含业务（见 2.3.1）
│   │       ├── app/                # 路由、布局、功能栏
│   │       ├── features/           # 每个功能一个目录（见 2.3.2 落点表）
│   │       ├── data/               # Dexie 模式、仓储、outbox、同步引擎
│   │       ├── crypto/             # 隐私门禁与备份导出加密（PBKDF2、信封）
│   │       ├── workers/            # search.worker.ts（独立入口，见 2.3.1）。【v1.13 修订 · M4】media.worker.ts 不再有：缩略图改在浏览器端生成（见 §八）
│   │       └── sw/                 # Service Worker
│   └── worker/                     # Cloudflare Worker
│       └── src/
│           ├── index.ts            # 装配：Hono 实例、挂载子路由、scheduled 分发（见 2.3.1）
│           ├── middleware/         # session / csrf / 表结构守卫（§4.1、§15.4）/ 必备机密存在性（config-guard，§15.5）
│           ├── routes/             # api / public / mcp：校验参数后立刻转服务，不写业务
│           ├── services/           # 领域服务：items、folders、versions、attachments、shares、tokens、backup ...
│           ├── db/                 # SQL 常量、batch 组装、迁移与自愈
│           ├── jobs/               # Cron 任务：snapshot、backup、maintenance、gc
│           └── adapters/           # r2 / webdav / s3 / git 备份适配器
├── packages/
│   ├── shared/                     # 前后端共享：类型、Valibot schema、错误码、常量（上限、阈值）
│   ├── mdcore/                     # front matter、标签与任务字段派生、表格编解码、快照格式、附件引用改写
│   └── crypto-format/              # 备份导出信封格式的编码与解析（纯函数，不含密钥操作）
├── wrangler.jsonc
└── .github/workflows/ci.yml
```

依赖方向：`apps/*` 可以依赖 `packages/*`；`packages/*` 之间只允许 `shared` 被其他包依赖；`packages/*` 不依赖任何浏览器或 Worker 专有 API，保证两端都能运行、都能单测。

#### 2.3.1 入口文件只做装配（不出现 server.mjs）

Workers 项目没有也不需要 `server.mjs` 之类的常驻服务文件——**整个后端只有一个入口 `apps/worker/src/index.ts`**，它是装配壳：创建 Hono 实例、按前缀挂载子路由、注册 `scheduled` 处理器导出默认对象，到此为止。业务代码不存在于入口里的位置。所有入口文件适用同一条白名单规则：

| 入口 | 允许的内容 | 行数预算 |
|---|---|---|
| `apps/worker/src/index.ts` | 创建 Hono、`route()` 挂载子路由、`export default { fetch, scheduled }`、全局错误兜底 | ≤ 100 |
| `apps/web/src/main.tsx` | 创建路由表、挂 Provider（主题/查询/同步）、注册 Service Worker | ≤ 100 |
| `features/share-viewer/main.tsx` 分享查看器特性根 | 挂载 `ui/ShareViewerApp.tsx`。**不是独立 html 入口**——由 `apps/web/src/main.tsx` 按 `/s/<sid>` 动态 `import()`（见 §十） | ≤ 50 |
| `src/workers/*.worker.ts` | `self.onmessage` 分发到处理器模块 | ≤ 50 |

入口超预算或出现 `if (path === ...)`、SQL、状态计算，即视为结构违规（CI 检查，见 2.3.3）。

#### 2.3.2 功能 → 代码落点对照表（纵向切片）

新增任何代码前先查此表：**先定功能，再定层**。同一功能的前端与后端各自纵向切片（路由→服务→仓储），互不横向渗透。

Worker 侧（`apps/worker/src/`）：

| 功能 | 路由 routes/ | 服务 services/ | 其他落点 |
|---|---|---|---|
| 健康检查（`GET /api/health`，存活探针，不依赖 D1） | `health.ts` | — | — |
| 注册 / 登录 / 会话 | `auth.ts` | `auth.ts`、`tokens.ts`、`sessions.ts` | middleware/session.ts、middleware/csrf.ts |
| 条目与文件夹（增删改查、移动、回收站、批量标记） | `items.ts`、`folders.ts` | `items.ts`、`folders.ts`、`trash.ts` | db/tables.ts（SQL 常量） |
| 批量写入（`POST /api/batch`，单批 ≤10 个操作；逐操作独立判定冲突）【M2-9 落地】 | `items.ts` | `batch.ts` | — |
| 搜索的服务端兜底（`GET /api/search`，`instr()` 子串扫描 + 与客户端同源的隐私过滤）【M2-6 落地】 | `search.ts` | `search.ts` | — |
| 增量同步（拉取 / 推送 / 墓碑；响应另带 `user_settings`，**不参与游标**） | `sync.ts` | `sync.ts` | — |
| 版本历史 | `versions.ts` | `versions.ts` | — |
| 附件上传 / 下载 / GC | `attachments.ts` | `attachments.ts` | adapters/r2.ts、jobs/gc.ts |
| 附件列表（`GET /api/attachments`：按 `kind` / `state` 筛、每行带引用条目数，`limit + 1` 判 `has_more`）【M6-2c 落地】 | `attachments.ts` | `attachments.ts` | —（过滤值一律绑两次 `?`，不在服务层拼 SQL 文本） |
| 分享（创建 / 公开访问 / 撤销）【M5 落地】 | `shares.ts`（管理侧）、`public.ts`（访客侧） | `shares.ts`、`share-public.ts` | —（契约 `packages/shared/src/shares.ts`；附件引用解析 `packages/shared/src/attachments.ts`，两端共用一份） |
| **MCP【M6 第三块落地：令牌 / 端点 / 11 个工具】** | `mcp-tokens.ts`（令牌管理四个会话接口）、`mcp.ts`（`POST /mcp`、`POST /mcp/k/:token`、`GET /mcp`=405） | `services/mcp/`：`tokens.ts`（管理侧）/`auth.ts`（鉴权 + 限速）/`scope.ts`（可见性 I1）/`jsonrpc.ts`（协议层）/`registry.ts`（工具表 + 静态 schema）/`parts.ts` + `write-parts.ts`（共用零件）/`seal.ts`（`pre_mcp` 封存）/`audit.ts`（审计 + 幂等）/`tools-read*.ts` / `tools-write*.ts` | `db/mcp-tables.ts`（MCP 专用 SQL，`tables.ts` 已近预算故独立一份）；契约 `packages/shared/src/mcp.ts`；**`/mcp` 必须列进 `wrangler.jsonc` 的 `assets.run_worker_first`**，否则 SPA 回退会把 POST 吃掉、客户端拿到 HTML |
| 设置与隐私标记（含 `GET/PUT /api/admin/registration`、`GET /api/admin/usage`；**用户级设置 `GET/PUT /api/settings`** 也归这里） | `settings.ts` | `settings.ts` | — |
| **M7【定时自动备份落地：四批全部完成】** | `backup-targets.ts`（`GET/POST /api/backup/targets`、`PUT/DELETE /:id`、`POST /:id/test`、`POST /:id/run`「推一次」） | `services/backup-targets.ts`（目标 CRUD / 凭据包裹 / 删除记账）、`services/backup-envelope.ts`（出站信封）、`db/backup-tables.ts` | `jobs/snapshot.ts`（D1 → R2 `snap/{uid}/` **增量**物化 + 出站加密）、`jobs/push.ts`（差异计算 + **一轮一批 ≤40 外部 PUT** 的续推状态机）、`adapters/webdav.ts`、`adapters/s3.ts`（**手写 SigV4**、不引 SDK）；迁移 `0007_backup_targets`（`user_backup_targets` + `export_queue`）与 `0008_snapshot_state`（`user_snapshot_state`）；契约 `packages/shared/src/backup-targets.ts` 与 **`packages/shared/src/envelope.ts`（§7.3 的字节格式，长期兼容契约）**；`services/trash-purge.ts` 的第 9 步写 `del:` 删除记账 |
| Cron：维护（**快照物化与外部备份已各自拆出，见上一行**） | —（无路由） | `jobs.ts` 调度 | `jobs/maintenance.ts`（`jobs.ts` 的六槽里 ③⑤ 现已接 `jobs/snapshot.ts` 与 `jobs/push.ts`） |
| 迁移与自愈 | — | — | db/migrations/（0001 建表；0002 任务字段字面量约束触发器；**0007 备份目标 + 变更队列、0008 快照游标，M7**）、db/selfheal.ts |

Web 侧（`apps/web/src/`，每个 feature 目录内 `ui/`（组件）+ `model.ts`（状态与动作）两件套，禁止 feature 互相 import）：

| 功能 | 落点 |
|---|---|
| 布局 / 功能栏 / 导航 / 主题（含账户快捷菜单、搜索框、模态与菜单等公共控件） | `app/`（`app/ui/`、`app/fnbar/`、`app/topbar/`、`app/workarea/`、`app/theme/`） |
| 同步引擎与本地库（**不属任何 feature**） | `data/sync/`（engine / push / pull / leader / **broadcast**）、`data/db/`（schema / repository / **search**（本地增量索引）/ **settings** / **conflicts**） |
| 笔记编辑（CodeMirror 封装为公共编辑器组件放 `app/editor/`） | `features/notes/`（含文件夹树、笔记本面板、冲突提示与处理）；**【v1.27】`app/editor/toolbar-size.ts`**（格式工具栏尺寸的本机偏好，三档 `sm` / `md` / `lg`）；`app/editor/` 内与加载/揭示相关的三件：【v1.25】`loader.ts`（共享加载函数 + 空闲预载 + 网络策略）、`EditorLoadBoundary.tsx`（正文区片内加载失败 + 重试）、`live-preview-reveal.ts`（即时渲染揭示判定的唯一实现）；**【v1.26】`live-preview-lock.ts`（「正在编辑的那一行冻结」的纯函数判定：`lockHolds` / `freezeLine` / `lineDecorations` / `insertsLineBreak`）** |
| 表格 / 图册 | `features/tables/` |
| Memo（时间轴 / 瀑布流） | `features/memos/`（`model.ts` 时间轴分组与筛选、`actions.ts` 转笔记） |
| 待办（列表 / 看板） | `features/tasks/`（`model.ts` 排序筛选、`actions.ts` 改状态与去掉标记） |
| 首页概括 | `features/home/` |
| 搜索界面 | `features/search/`（`useSearch.ts` 接线、`model.ts` 检索纯函数、`ui/SearchPanel.tsx`）；本地索引在 `data/db/search.ts`。**`workers/search.worker.ts` 未做**（检索在纯函数模块里，M2 的已知偏离） |
| 附件 / 媒体处理 | `features/attachments/`（`model.ts` 引用写法与文案、`thumbnail.ts` 缩略图、`upload.ts` 两段上传、`queue.ts` 上传队列、`useAttachments.ts` 接线）；【v1.13 修订 · M4】**哈希与缩略图在浏览器（`thumbnail.ts`），`workers/media.worker.ts` 这个落点已删除** |
| **MCP【M6 第三块落地】** | `features/mcp/`（`model.ts` 纯函数：权限 / 范围 / 有效期 / 状态 / 审计文案；`ui/McpSettingsPage.tsx` + `ui/CreateTokenDialog.tsx` + `ui/TokenAuditDialog.tsx`）。地址 = `origin + /mcp`，**不新增接口** |
| 版本历史（前端）【M4】 | `features/versions/`（`model.ts` 行文案/行级 diff/恢复确认文案、`ui/VersionHistoryPanel.tsx`、`ui/VersionDiff.tsx`、`useVersions.ts`） |
| 回收站（前端）【M4】 | `features/trash/`（`model.ts`、`ui/TrashPage.tsx`、`ui/PurgeConfirmDialog.tsx`、`useTrash.ts`）+ `data/db/trash.ts` |
| 表格（前端）【M4】 | `features/tables/`（`model.ts` 全在纯函数里、`ui/TableEditor.tsx`、`ui/TableGrid.tsx`、`ui/GalleryView.tsx`、`ui/TableToolbar.tsx`、`ui/TableFilterBar.tsx`、`ui/TableColumnManager.tsx`、`ui/TableSizeBar.tsx`、`ui/useVirtualWindow.ts`） |
| 附件 / 版本（服务端）【M4】 | `apps/worker/src/adapters/r2.ts`（对象键与读写的唯一适配层）、`services/attachments.ts`、`services/versions.ts`、`services/version-retention.ts`（保留与稀疏化单独一摊）、`routes/attachments.ts`、`routes/versions.ts`；后台任务在 `services/jobs.ts` + `jobs/maintenance.ts` |
| 隐私门禁（解锁框、锁定清理、多设备 verifier） | `features/privacy/` + `crypto/keystore.ts` |
| 备份导出（全量 zip / 单篇 Markdown、信封与外部解密工具说明）【M5】 | `features/backup/`（`build.ts`、`export.ts`、`import.ts`、`restore.ts`、`export-note.ts`）+ `crypto/envelope.ts`；**格式契约落 `packages/shared/src/backup.ts`**——原写的独立包 `packages/crypto-format` 经 M5 设计 §七定论**不建**（契约属纯数据 schema，不是运行时模块） |
| Markdown 核心（front matter 读写、标签与任务字段派生；前后端同一份实现）【M2 建】 | `packages/mdcore/`（零运行时依赖；**不得依赖 apps/**） |
| 同步引擎 / outbox | `data/sync/`（不属于任何 feature） |
| 本地库 Dexie / 本地仓储 | `data/db/` |
| 设置（含 MCP 配置、备份目标配置） | `features/settings/`；**【v1.27】** 第 11 个分类「编辑设置」的页内四张卡在 `features/settings/ui/EditorSettingsPage.tsx`，取值夹取与 CSS 变量在 `features/settings/editor-typography.ts`（唯一读侧关口） |
| **属性库（键值字典）【v0.8.30 新增；v0.8.32 重画并加显示名】** | `features/props/`（`model.ts` 条目形状 / 类型 / 键名与保留键规则等纯函数、`scan.ts` 扫导入文件里的陌生键、`usage.ts` 本机用量统计、`ui/PropValueField.tsx` / `ui/PropPicker.tsx` / `ui/PropLibraryPage.tsx`）。**卡片本体不是新 feature**——仍是 `features/notes/ui/ItemProps.tsx`，它新增**三个可选 props**（`library?` / `onLibraryChange?` / `labels?: PropLabels`），库与显示名都由 `App` 一处持有往下传（不新建 store；`prop_library` / `prop_labels` 两个账号级字段都在 `packages/shared/src/settings.ts`），管理页挂进 `features/settings/ui/SettingsPanel.tsx`。**显示名（翻译层）只活在界面**——不进 md / 导出 / 分享 / 备份 / MCP |
| **正文区两侧贴边面板（属性 / 大纲）【v0.8.34 新增，观感于 v0.8.35 调理】** | `features/notes/`：`ui/DocRail.tsx`（面板壳：28px 竖排把手 / 240px 卡，两态**条件渲染**）、`useRails.ts`（展开态 + 让位规则 `railOpenState` / `BOTH_RAILS_MIN_PANE = 1304`（v0.8.35 起；= 2 × 252 + 纸面 800，此前 1244 按纸面 740 算），`ResizeObserver` 量 `.docpane__body` 的宽）、`outline.ts`（大纲纯逻辑：`buildOutline` / `activeOutlineIndex` / `activeOutlineIndexInPreview` / `matchPreviewHeading`）、`useOutline.ts`（取当前节与跳转，两档走不同参考）、`ui/OutlinePanel.tsx`（大纲列表）；`props-collapse.ts` 扩成三个**本机**偏好 key（`props-open` / `outline-open` / `rails-last`，旧 `props-collapsed` 反向迁移一次）。**标题判据不新增**：走 `packages/mdcore` 的 `listHeadings`（复用 `section.ts` 的 `scanHeadings`，与 MCP 的 `read_item(section)` 同源）；`EditorHandle` 的 `topVisibleOffset()` 换成 `offsetAtViewportY(y)`（真正滚的是 `.doc-split__pane`）。不新建 store，接线在 `NoteWorkspace.tsx` |
| 分享（管理端）【M5】 | `features/shares/`（`model.ts` 过期档位 / 链接拼装 / PBKDF2 密码派生、`ui/ShareDialog.tsx`、`ui/MySharesPage.tsx`）；入口在笔记「更多」菜单与「设置 › 分享」 |
| 分享查看器【M5】 | `features/share-viewer/`（`main.tsx` 特性根、`model.ts`、`ui/ShareViewerApp.tsx`）；**由 `apps/web/src/main.tsx` 按 `/s/<sid>` 动态 `import()`**，不是独立 html 入口 |

#### 2.3.3 防膨胀护栏

1. **依赖方向**（ESLint `no-restricted-imports` 或 dependency-cruiser 强制）：`routes → services → db`，禁止反向与跨级（路由不得拼 SQL，服务不得 import Hono，仓储不得 import 服务）；前端 feature 之间零互相依赖，跨 feature 复用只走 `app/`（公共组件）或 `data/`（数据层）；`packages/*` 不 import 任何 `apps/*`。
2. **文件行数预算**：入口按 2.3.1 白名单；路由 / 服务 / 仓储单文件 ≤ 300 行——超限按子资源拆（如 `services/items-query.ts` 与 `items-write.ts`），不按"工具函数堆一屋"拆。CI 里以 lint 规则告警（`max-lines`），超 500 行直接失败。
3. **新功能落位流程**：先查 2.3.2 对照表落位；表中没有的新功能，先补表（本文为唯一依据）再写代码——避免"临时先塞 index.ts"的口子。
4. **共享包是逃逸口**：两端都要用的逻辑进 `packages/`，而不是复制或放在某一端"大家来引"。

#### 2.3.4 文档体系：wiki/ 定稿区 + docs/ 过程区【已定·用户确认 2026-09-26，对齐 AGENTS.md】

仓库文档分两层，与 AGENTS.md「文档放哪」一节完全一致：

- **`wiki/` = 定稿区**：已定稿、作为当前实现依据的文档。写入新定稿、修订或删除已有文件，都必须先得到用户明确同意。
- **`docs/` = 过程区**：尚未定稿的设计与过程资料，冲突时以 `wiki/` 为准；`docs/archive/` 默认不读、不作为实现依据。
- 根目录两个特殊文件：`DESIGN.md` 是**唯一视觉源**（内容从原型的设计令牌与界面基线落稿，落稿本身需用户确认）；`AGENTS.md` 是 AI 代理的工作规则。

职责一览：

| 位置 | 放什么 | 命名 |
|---|---|---|
| `wiki/Menote-设计文档-v7.4.md` | 需求文档（只读基准） | 升版本不改名 |
| `wiki/Menote-功能拆解-v2.md` | 功能点与验收 | 同上 |
| `wiki/Menote-项目架构-v1.md` | 架构文档（本文，唯一主线） | 不变 |
| `wiki/components.md` | **组件规划**：组件名、所属 feature、职责、props 约定、复用关系、与原型的对应；过长后按 `components/<功能>.md` 拆 | — |
| `wiki/adr/` | **架构决定记录**：只记"有备选项且否决了其他选项"的决定，一条一页（背景 / 备选 / 结论 / 影响） | `adr-NNN-<决定名>.md` |
| `wiki/guides/` | **操作指南**：本地开发上手、一键部署步骤（15.5 的操作展开）、测试跑法、迁移演练 | `<主题>.md` |
| `docs/todo/` | **专项计划**：一个功能或任务一份实施计划（目标、拆步、涉及文件、验收点），开工前创建 | `<主题>.md`（可带日期） |
| `docs/modules/` | **专项功能设计文档**：一份主题一份文件，头部按 AGENTS.md 的文档维护规范写版本 / 状态（草案 / 评审中 / 生效 / 废弃 / 归档）/ 权威级别 / 修改记录 | 主题命名，时效件可带日期 |
| `docs/scratch/` | **草稿**：临时讨论与方案草稿，一份讨论一份文件，随手写、不设格式门槛（与 modules/ 的区别：这里是未成形的过程片段）；定稿内容搬往 todo/ / modules/ / wiki，过时件定期清理，不作为实现依据 | `<主题>-<日期>.md`（未成形可不带日期） |
| `docs/archive/` | **归档**：被取代的草稿与旧版文档，只读 | 移入时保留原文件名 |

冲突时的优先级：功能与规则看 `wiki/`，长什么样看 `DESIGN.md` 与原型，某一屏的结构看 `docs/modules/` 对应专项。

生命周期（所有文档适用）：

1. **草稿期**：讨论中的方案进 `docs/modules/`，一份主题一份文件，不散落在聊天记录里；头部标状态。同主题不允许出现胜负未分的并行多份草稿。
2. **定稿**：结论写回对应主线文档（架构决定进本文、需求变更进需求文档）+ 有备选项的补一条 `wiki/adr/`；定稿文档经用户同意后**整份搬入** `wiki/`。
3. **归档**：`docs/archive/` 只允许整份移入，移入后在头部加一行「已归档，结论见 adr-NNN / wiki 某文档」；归档件不再修改，原位置不留副本。现有功能拆解 v1 在结构迁移时移入。`docs/todo/` 的计划做完整份移入；`docs/scratch/` 的过时讨论件定期清理或整份移入。
4. **进入门槛（防增殖）**：能写进本文既有章节的一句话决定，不单开 ADR；一次就能定的事不建专项文档；`guides/` 只收"会被重复执行的操作"，一次性的事直接做。文档数量超需要时宁可删并，不维护僵尸文件。

> **迁移注（2026-09-26 执行完毕）**：三份主线文档已搬入 `wiki/`，功能拆解 v1 已移入 `docs/archive/`，`README.md` 已创建。后续新文档直接按本节落位。

---

## 三、前端架构

### 3.1 分层

```mermaid
flowchart TB
    subgraph L1["界面层（React 组件）"]
        V1["功能栏与布局"]
        V2["编辑器：CodeMirror 6 三档（仅编辑 / 仅预览 / 即时渲染）"]
        V3["表格与图册、Memo 时间轴与瀑布流、清单列表与看板"]
        V4["设置子页面、解锁框、同步状态"]
    end
    subgraph L2["应用服务层"]
        S1["ItemService：新建、保存、移动、回收站"]
        S2["LockService：解锁档位、锁定清理、隐私浏览门禁"]
        S3["BatchMarkService：批量标记操作（元数据，锁定时可执行）"]
        S4["ShareService、ExportService、VersionService"]
    end
    subgraph L3["领域层（packages/mdcore）"]
        D1["front matter 与标签、任务字段派生"]
        D2["表格编解码与行 ID 规整"]
        D3["快照格式与附件引用提取"]
    end
    subgraph L4["数据层"]
        R1["本地仓储：Dexie"]
        R2["outbox 与同步引擎"]
        R3["大小计量与补丁生成"]
    end
    subgraph L5["传输层"]
        T1["API 客户端：超时、退避、错误码映射"]
    end
    subgraph WK["独立线程"]
        W3["search.worker：MiniSearch 索引（M2 未做，检索在纯函数模块里）"]
        W4["media.worker：哈希、缩略图、压缩（【v1.13 修订 · M4】已删除：改在浏览器主线程用 Canvas / OffscreenCanvas 生成，见 §八）"]
        W5["Service Worker：外壳与附件缓存"]
    end
    L1 --> L2
    L2 --> L3
    L2 --> L4
    L4 --> L5
    L2 --> WK
```

规则【架构定】：
- 界面层只调用应用服务层，不直接访问 Dexie 或网络。
- 数据的唯一真相是 IndexedDB；界面通过 Dexie 的 `liveQuery` 订阅变化，Zustand 只放纯界面状态（当前视图、面板开合、选中项）。
- 所有 CPU 密集型工作（SHA-256、缩略图、gzip、建索引、备份导出加密）放在独立 Worker，主线程保持输入流畅。

### 3.2 本地数据库（IndexedDB，Dexie）【架构定】

| 表 | 主键 / 索引 | 内容 |
|---|---|---|
| `items` | `id`；`[folderId+updatedAt]`、`memoAt`、`syncSeq`、`isTask` | 条目元数据（与服务端 `items` 同构；隐私空间内条目同样明文，带 `in_enc_space` 标记） |
| `bodies` | `itemId` | 正文缓存：明文字符串；带 `rev`、`contentHash` |
| `drafts` | `itemId` | 未上传的编辑稿（每 2 秒写一次） |
| `folders` | `id`；`parentId`、`syncSeq` | 文件夹树 |
| `privacyState` | 单行 | 门禁状态：解锁档位与到期时间；KDF 参数缓存（verifier 与 K 的包裹块存服务端，见 7.2） |
| `settings` | 单行 | 用户设置与其 `rev` |
| `outbox` | 自增 `seq`；`[entity+entityId]` | 待上传操作（见 6.3） |
| `attachmentsMeta` | `id`；`sha256` | 附件元数据；上传中的附件带本地 Blob |
| `searchIndex` | 单行 | 明文 MiniSearch 索引的序列化结果 |
| `syncState` | 单行 | `cursor`（最近的 `sync_seq`）、上次同步时间、设备 ID |

- Dexie 的模式版本随客户端发布递增；本地库只是缓存，遇到无法迁移的情况可以清空后从服务端重建（outbox 中未上传的数据先导出为本地备份文件再清空）。
- 【v1.1 模型修订】隐私条目内容明文落库（用户确认的边界）：锁定只由界面门禁过滤显示，不改变存储；登出**不清除**本机缓存的明文数据，只清会话态（Q22 已定·用户确认 2026-09-26）——清缓存会让重新登录后首屏显著变慢，且本机 IndexedDB 里可能还有 outbox 未上传内容要保留。

### 3.3 编辑器【依需求 7.1，实现细节为架构定】

- **三档**共用一个 CodeMirror 6 `EditorState`，切换档位不重建文档，只切换扩展与布局：仅编辑（`edit`）/ 仅预览（`preview`）/ 即时渲染（`live`），显示顺序即 `edit → preview → live`：
  - 仅编辑 / 仅预览：同一个单栏编辑器，切换源码与渲染面板的可见性（`Editor` 的只读态也复用这条路径）。
  - 即时渲染：基于 Lezer 语法树的装饰（`Decoration.replace` / `widget`），只对视口内的节点计算装饰，**完整识别到的语法立即呈现渲染样式；折叠光标只有真正落进某个被隐藏的标记字符（半开区间 `[from, to)`）时才临时显现「包含该标记的最小受支持语法节点」的源码，离开即恢复**（v1.25 修订：原文为"光标所在行显示源码"，见 `docs/modules/Menote-编辑器体验优化-设计-v1.md` v1.3；**隐藏标记不再挂 `EditorView.atomicRanges`**——既是原子区间、又要"进得去"不可兼得）；**v1.26 补一条时机例外**：**正在编辑的那一行冻结**——光标停在某一行期间该行保持进入时的呈现，只有光标离开该行、该行的显现结论变化、或改动含跨行变更才重算（判据一字未改，改的是重算时机；用户 2026-10-18 选择"不动判据、只改时机"）；冻结**只覆盖 point 装饰**（`Decoration.replace` / `Decoration.line`），代码高亮的 token（`Decoration.mark`）永远现场重算；与「仅编辑」之间靠 `Compartment` 重配置切换，**重建的只是扩展，不是文档**（撤销历史与光标不丢）。
  - **「双栏」（`split`）已从产品移除**（阶段 A / v0.6.0）：不再有"CodeMirror + 预览面板按滚动位置同步"这条路径，因此也**没有预览同步滚动**。旧值仍读得进（`EditorModeSchema` / `EDITOR_MODES` 保留四值，`normalizeEditorModes()` 是唯一归一化入口），但 UI 与新写入只产生上面三档；**没有「默认档」**——打开笔记用本机记住的「上次用的那一档」，设置里的 `editor_mode` 只是首次初始值；阅读态由「仅预览」承担，`readOnly` 只是 `Editor` 的内部能力、不是用户可见档位（需求 7.1；用户确认 2026-09-29）。
- 大小计量：编辑器维护当前正文的 UTF-8 字节数（增量计算：只对变更区间重新计数），状态栏常驻“x MB / 2 MB”，软上限 1MB 变色提示，硬上限 1,900,000 字节阻止保存（需求 10.10）。
- 补丁生成：从上次成功保存起累积 `ChangeSet`，保存时合并为“按码点计的替换区间”列表（需求 15.7）；码点换算在 `packages/mdcore` 中实现并有专门测试。
- 大文档：正文超过 256 KB 时防抖放宽到 5 秒、最长 60 秒上传一次（需求 15.7）；表格编辑器超过一定行数启用 TanStack Virtual。

### 3.4 Markdown 渲染与安全【架构定】

- 预览、Memo 时间轴、分享查看器共用一个渲染模块：markdown-it（关闭原生 HTML 或只放行白名单标签）+ DOMPurify 清洗输出。
- 附件引用（`_attachments/<hash>.jpg` 或附件 ID）在渲染时改写为受控地址 `/api/attachments/...`；隐私条目的附件在锁定时不渲染（门禁），无解密路径（v1.1）。
- 大文档预览按块增量渲染（按顶级块切分，只重新渲染变化的块），避免 2MB 文档每次按键全量渲染。

### 3.5 搜索【依需求 13】

- `search.worker` 持有两个 MiniSearch 实例：
  - 持久索引：明文笔记、表格、Memo；序列化后存 `searchIndex`，按 `sync_seq` 增量更新。
  - 内存索引：解锁期间加入的加密内容；锁定时整个实例丢弃（需求 6.10）。
- 分词：`Intl.Segmenter('zh', {granularity: 'word'})` + 中文二元组兜底。
- 隐私浏览锁定时，查询结果在返回界面前过滤掉 Memo（需求 8.9）。
- 本地索引未建完时，搜索框回退到服务端兜底接口 `/api/search`（需求 13.2）。

### 3.6 Service Worker 与缓存策略【架构定】

| 资源 | 策略 |
|---|---|
| 应用外壳（HTML、JS、CSS、字体、wasm） | 构建时预缓存；新版本后台下载，提示“有新版本”后下次打开生效（需求 15.6） |
| 附件与缩略图（`/api/attachments/h/<sha256>`） | Cache First，永久缓存（内容哈希不变） |
| `/api/*` 其他接口 | 不缓存，直接走网络（离线数据来自 IndexedDB） |
| 分享查看器 `/s/*` | 预缓存查看器外壳；分享内容不缓存 |

---

## 四、Worker 架构

### 4.1 请求处理链

```mermaid
flowchart LR
    A["请求进入"] --> B{"路径"}
    B -->|"/api/public/*"| P["分享接口：不需要登录"]
    B -->|"/mcp、/mcp/k/令牌"| M["MCP：令牌鉴权"]
    B -->|"/api/*"| C["会话鉴权：Cookie 查 sessions"]
    C --> D["CSRF 校验：Origin 与自定义请求头"]
    D --> E["参数校验：Valibot"]
    E --> F["服务层"]
    M --> MR["令牌范围与权限、限速"]
    MR --> F
    P --> PV["分享有效性与密码校验"]
    PV --> F
    F --> G["仓储层：组装 D1 batch 与条件写"]
    G --> H[("D1 / R2")]
```

### 4.2 分层与约定【架构定】

| 层 | 职责 | 约定 |
|---|---|---|
| 路由（Hono） | 路径匹配、中间件、把请求转给服务 | 按前缀懒加载子路由模块（动态 `import()`），降低冷启动开销 |
| 中间件 | 会话、CSRF、令牌、限速、错误统一格式 | 会话查询每请求 1 次 D1 读；`last_seen_at` 每天最多写 1 次 |
| 服务 | 业务规则：条件、配额、跨表一致性 | 不直接拼 SQL；每个写操作产出一个“语句列表”交给仓储 |
| 仓储 | SQL 常量、batch 组装、mutation guard、受影响行数判定 | 所有语句用参数绑定；每个请求的语句总数在代码中计数，超过 45 条直接报错（留余量给 50 条上限） |
| 适配器 | R2、外部备份（WebDAV / S3 / Git） | 子请求计数器：每个请求最多 50 个外部子请求 |

### 4.3 错误码【架构定】

统一 JSON 错误体 `{ code, message, detail? }`，客户端按 `code` 处理：

| HTTP | code | 含义 | 客户端处理 |
|---|---|---|---|
| 401 | `unauthenticated` | 会话失效 | 跳转登录，outbox 保留 |
| 403 | `forbidden` / `csrf` | 无权或 CSRF 校验失败 | 提示并记录 |
| 404 | `not_found` | 条目不存在或已永久删除 | 本地标记为已删除 |
| 409 | `rev_conflict` | 版本冲突，附带服务端当前 `rev`、`content_hash`，正文按需另取 | 进入冲突处理（需求 15.5） |
| 409 | `meta_conflict` | 元数据冲突，附带当前元数据 | 在最新状态上重新应用意图 |
| 413 | `too_large` | 超过 1,900,000 字节或 256 KB（MCP） | 提示拆分 |
| 422 | `invalid` | 参数不合法 | 丢弃该 outbox 项并提示 |
| 429 | `rate_limited` | 限速 | 按 `Retry-After` 退避 |
| 503 | `retry_later` | CPU 超限（1102）、D1 暂时不可用 | 退避重试；大文档全文保存改走补丁（需求 19.6） |

---

## 五、数据架构

### 5.1 D1 表结构

**建表以新隐私模型的权威 DDL 为准**：`docs/modules/Menote-数据模型与迁移设计-v1.md` §3——即需求 18.2 去掉正文密文列、`title_enc`/`name_enc`/`key_id`、`data_keys`、`user_crypto` 密钥列，并**重写**受密文列影响的 `items`/`folders`/`item_bodies` 的 CHECK 约束（原文的三条 CHECK 引用了要删的列，不能直接照抄）。`items.last_edit_at`/`last_device` 已包含其中。该稿的结论会在需求文档 v7.5 同步时并入需求 18.2。

**【v1.13 修订 · M4 已实现】技术补充的 DDL 已定稿**：下表的草案**不再逐条在本文件重述**，权威落点是《Menote-M4-设计-v1》§六（迁移 `0004_content_integrity`），运行时由自愈迁移建表（§15.5）。**六张表的清单**（与迁移文件导出的 `M4_TABLE_NAMES` 一致）：`attachments`、`attachment_refs`、`item_versions`、`tombstones`、`r2_gc_queue`、**`pending_uploads`**（新增：上传意图登记从 `r2_gc_queue` 的 `reason='pending_upload'` 拆出独立表，避免"待删对象"与"待确认上传"两类生命周期混在一张表里）。

**【v1.16 修订 · M5 已实现】迁移 `0005_shares` 已应用**：`shares` 与 `share_items` 两张表（DDL 照《M5 分享设计》定稿；`share_items` 随表建好但**首期不接 UI**——Memo 固定合集后置，见 §十）。运行时自愈按序执行，`app_meta.schema_version` 现为 **5**。

下表保留**原因与原委**（回答"为什么需要这些表"），**具体列与约束请看 §六**：

| 补充 | 原因（对应需求） | 草案 |
|---|---|---|
| 新增 `tombstones` 表 | 需求 15.2 用 `deleted_at` 表示删除，但永久删除（14.4）会删掉 `items` 行，其他设备的增量同步收不到“已删除”信号，本地会残留条目 | `(user_id, entity, entity_id, sync_seq, deleted_at)`，索引 `(user_id, sync_seq)`；保留 180 天，过期清理 |
| `users` 增加 `tombstone_floor` | 墓碑清理后，游标早于清理点的设备必须全量重同步 | 整数：已清理墓碑中最大的 `sync_seq`；客户端游标小于它时触发全量重建 |
| 新增 `r2_gc_queue` 表 | 需求 14.4“登记待清理的 R2 对象，由 Cron 分批删除”，DDL 中没有这张表 | `(r2_key PRIMARY KEY, reason, due_at)`；也用作上传意图登记（见 5.3） |
| 新增 `pending_uploads` 表 | 上传是"两次请求 + 一次落元数据"，中途可能断在任何一步；需要一个**只在服务端**的登记，用它把"登记了却没落元数据"的对象在下一轮当成孤儿清理（**不列举 R2**，需求 19.5） | `(r2_key PRIMARY KEY, user_id, created_at, due_at)`，`due_at = now + 24h` |
| `user_settings`、`attachments` 增加 `sync_seq` | 需求 15.2 只列了条目和文件夹的增量同步；设置与附件元数据也需要在多设备间同步（v1.1：`data_keys` 表废弃，`user_crypto` 改存 verifier 与 K 的两份包裹，见 7.2） | 各加 `sync_seq` 列与 `(user_id, sync_seq)` 索引。**`user_crypto` 不加 `sync_seq`**：门禁材料不参与增量同步，走 7.2 的四个专用端点 |
| `attachment_refs` 增加版本引用 | 需求 14.3 规定“保留中的历史版本”引用的附件不算孤儿，但 `attachment_refs` 只记录条目引用 | 增加 `version_id` 列（NULL 表示当前稿引用），主键改为 `(item_id, version_id, attachment_id)` 的等价唯一约束 |
| 新增 `rate_counters` 表（条件启用） | 需求 17.3：Rate Limiting 绑定在免费版不可用时，用 D1 按分钟计数 | `(key, window_start, count)`；可用绑定时不建 |
| `items` 增加 `last_edit_at`、`last_device` | 需求 12.2-3 的“跨会话”判断需要知道上次编辑时间与设备 | 两列，随正文保存写入（同一条 UPDATE，不增加行写入） |

### 5.2 R2 对象布局

| 前缀 | 内容 | 写入方 | 缓存头 |
|---|---|---|---|
| `a/{uid}/{sha256}` | 明文附件原图 | 客户端流式上传 | `private, max-age=31536000, immutable` |
| `a/{uid}/{sha256}.t` | 明文缩略图 | 同上 | 同上 |
| `e/{uid}/{id}` | （v1.1 废弃：不再有静态密文附件） | — | — |
| `v/{uid}/{item_id}/{version_id}` | 版本正文（gzip 或原样） | 客户端或 Worker | 不缓存 |
| `snap/{uid}/...` | md 快照目录（需求 3.2 的结构） | Cron | 不缓存 |

【v1.1 注】`e/` 前缀（静态密文附件）不再使用——所有附件明文存储，隐私条目仅在出站备份时加密（7.3、7.4）。

**【v1.13 修订 · M4 已实现】缩略图对象键已定稿**：`a/{uid}/{sha256}.t`（即上表第二行）。此前的【待核实】来自"需求 14.1 没单独约定缩略图键"；M4 设计 §3.1 已定稿，实现见 `apps/worker/src/adapters/r2.ts` 的 `attachmentKey()`（`kind='thumb'` 时加 `.t` 后缀），原图与缩略图共用同一个 `sha256`、`kind` 区分——所以"同一用户同一文件只存一份"对两者都成立。

### 5.3 R2 与 D1 的一致性【架构定】

R2 与 D1 之间没有事务，采用“先登记、后操作、再确认”避免泄漏，且全程不需要列举 R2：

- **上传**：Worker 先插入一行 `pending_uploads(r2_key, user_id, created_at, due_at = now + 24h)`；写 R2 成功后，在同一个 batch 中插入附件或版本元数据并删除这行登记。中途失败时，登记在 24 小时后到期，每日维护把它当成孤儿（登记了却没落元数据）清理——**不列举 R2**。（【v1.13 修订 · M4 已实现】原文写的是用 `r2_gc_queue` 的 `reason='pending_upload'` 登记，实现时拆成了独立表 `pending_uploads`：待删对象与待确认上传的**生命周期不同**（一个到期就删、一个要等 24 小时且可能被"续传"覆盖），混在一张表里会让清理逻辑要按 reason 分支。）
- **删除**：在删除 D1 记录的同一个 batch 中登记 `r2_gc_queue(reason='delete', due_at=now)`；Cron 按 `due_at` 分批删除 R2 对象，删除成功后删登记。R2 删除是幂等的，重复执行无害。
- 这一机制覆盖了需求 14.4 中“没有对应元数据的版本对象”这类残留的来源。需求 19.5 要求后台不调用 `ListObjects`，因此每日孤儿检查只核对 D1 内部的引用关系（附件引用、版本元数据、快照登记），不列举 R2。

### 5.4 容量估算（与需求 19.3 一致）

D1 以元数据和当前稿为主，个人使用多年仍在百 MB 以内；R2 以附件为主。本文不重复需求第十九节的估算。

---

## 六、同步引擎

### 6.1 接口形态【架构定】

| 方向 | 接口 | 说明 |
|---|---|---|
| 拉取 | `GET /api/sync?cursor=N` | 返回 `sync_seq > N` 的元数据变化：条目、文件夹、设置、附件元数据、墓碑；每类合计最多 200 行，带 `next_cursor`、`has_more`；游标小于 `tombstone_floor` 时返回 `full_resync: true`。**不含正文** |
| 取正文 | `GET /api/items/:id/body` | 响应体为原文（`text/markdown`），`ETag` 为 `content_hash`，支持 `If-None-Match` 返回 304；隐私条目同样返回原文，由前端门禁控制显示（v1.1） |
| 新建 | `PUT /api/items/:id`（客户端生成 ID） | 请求体为正文原文；元数据放在 `X-Menote-Meta` 请求头（base64url 编码的 JSON：类型、标题、文件夹、标签、任务字段、`content_hash`、附件引用）。重复提交幂等（需求 15.3） |
| 全文保存 | `PUT /api/items/:id/body` | 请求头 `If-Match: <base_rev>`、`X-Menote-Hash`、`X-Menote-Refs`。**`X-Menote-Refs` 是 base64url 的 sha256 数组（与 `X-Menote-Meta` 同款编码）**，语义三条：**不带 = 引用表一个字不动**（老客户端与第三方调用安全）；带非空数组 = 用它整体替换「当前稿」的引用；**带空数组 = 清空当前稿引用**。服务端在**保存正文的同一次写**里对齐引用（先清当前稿再按 sha 插入，按 `sha256` + `user_id` 反查 `attachments.id`）——必须原子：孤儿判定只看引用表，正文已存而引用未跟上，那张仍在正文里显示的图会被标成孤儿、30 天后真删【M6 v0.6.20 落地】 |
| 补丁保存 | `PATCH /api/items/:id/body` | JSON：`{ base_rev, ops: [[start, end, text]...], hash, bytes, chars }`，位置按码点计（需求 15.7） |
| 元数据 | `PATCH /api/items/:id/meta` | `{ base_meta_rev, title?, folder_id?, tags?, pinned?, starred? }` |
| 批量元数据 | `POST /api/batch` | 多个小型元数据操作合并为一个请求（移动、置顶、文件夹改名等），每个操作独立判定冲突，逐个返回结果；单批语句总数不超过 45 条 |
| 回收站 | `POST /api/items/:id/trash`、`/restore`；`DELETE /api/items/:id`（永久删除） | 永久删除按需求 14.4 执行（见 12.3） |

设计要点：
- 拉取接口只返回元数据，保证首屏只需“元数据增量 + 当前条目”（需求 15.6）；正文按需获取，开启“全部离线缓存”时后台以并发 3–4 逐条拉取。
- 同一次拉取返回的多类数据共用同一个 `sync_seq` 序列（每个用户一个计数器），客户端按单一游标推进，不会漏拉。

### 6.2 保存与冲突处理流程

```mermaid
sequenceDiagram
    participant E as 编辑器
    participant O as outbox（IndexedDB）
    participant S as 同步主标签页
    participant W as Worker
    participant D as D1
    E->>O: 防抖后写入草稿与待上传项（同一条目合并，保留最早的 base_rev）
    S->>O: 取队首
    alt 明文且不小于 64 KB 且改动小
        S->>W: PATCH 正文补丁（base_rev）
    else 其他情况
        S->>W: PUT 正文原文（If-Match: base_rev）
    end
    W->>D: 条件 batch（主写入以 rev 为条件，其余语句挂在主写入生效之上）
    alt 主写入生效
        D-->>W: 新 rev、实际码点数与字节数
        W-->>S: 200
        S->>O: 删除该项，本地 rev 更新
    else 版本冲突
        W-->>S: 409 rev_conflict（服务端 rev 与 content_hash）
        alt 服务端哈希等于本地待上传内容的哈希
            S->>O: 视为已成功（上次响应丢失）
        else 内容不同
            S->>W: 取服务端正文，采纳为原条目当前稿
            S->>O: 本地内容另存为冲突副本（新 ID，新建请求）
            S->>E: 通知栏提示：对比两者 / 保留某一份
        end
    end
```

冲突前服务端版本的封存（需求 15.5-3，原因 `conflict`）由 Worker 在返回 409 之前完成：在同一请求内把当前正文转存为版本（不超过 256 KB 时压缩，否则原样），同一条目 10 分钟内最多一次。

### 6.3 outbox 设计【架构定】

- **首次上传的时机（【v1.24 2026-10-11 用户确认】空白新建不落库）**：新建条目**出生时不写 outbox**——本地该写的照写（`items` / `bodies` / `drafts`），但不产生第一条 `create`，服务端从头到尾没见过一条“点了新建、还什么都没写”的条目。等它第一次出现**可见文字或标题**（**属性改动不算**），才由既有的入队漏斗补上那条 `create`，内容随它上去，此后与普通条目完全一样。
  - **为什么不做成“先建再删”**：那是两条网络操作，还要服务端为一条从未被使用过的记录擦屁股；“从不上传”只有一个状态。
  - **为什么判定必须落在数据层的入队漏斗**（`data/db/repository.ts` 的 `createLocalItem` 与两处 `enqueue*`）：失败方向不对称——**把已有内容漏掉不上传**是丢数据，**空条目多留一会儿**只是界面脏一点；判定写在各个调用方，早晚有人忘。
  - 判定与回收是纯函数 `data/db/seed.ts`（`isBlankSeed` 看“没有可见文字且标题还是默认值”；`purgeBlankSeed` / `purgeBlankSeeds` 用一个事务把 `items` / `bodies` / `drafts` / `searchIndex` / `outbox` / 冲突与附件引用一次性清干净，**且只回收 `pending === "create"`（从没上传过）的条目**）。两个触发点：**离开这一篇时**、**启动时兜底扫一遍**，接线在 `features/notes/blankSeeds.ts`（`reapBlankSeedOnLeave` / `loadFirstScreen`）。
  - **判定只有一份、而且不能在渲染层做**：编辑器里敲一个空格也会落成草稿，所以“空不空”只能问“有没有可见文字”——`mdcore` 的 `stripFrontmatter` 剥掉 front matter 后再判，**只改属性因此天然不算内容**。
  - 表格不受影响：`renderTableDocument` 恒写表头行，新建表格的正文从来不是空白。
- 每项记录：`entity`（item / folder / setting / attachment / version）、`entityId`、`op`、`baseRev`、载荷引用（正文不复制，指向 `drafts`）、重试次数、下次重试时间、最后错误。
- 合并规则：同一条目的正文保存只保留最新一份并保留最早的 `baseRev`；连续补丁合并为一个补丁，合并后超过正文 25% 或 20 个操作时改为全文（需求 15.7）。
- 依赖顺序：新建文件夹先于移入该文件夹的条目；附件上传先于引用它的正文保存（未上传完成时正文照常保存，引用在附件上传成功后补报）。
- 退避与超时按需求 15.3：15 秒超时、1/2/4/8… 秒指数退避加抖动、最长 60 秒；`online`、标签页可见时立即重试。
- 持续失败（例如 422）的项移入“上传失败”列表，界面可查看、重试或导出为文件，不会阻塞队列中其他条目的上传。

### 6.4 多标签页【依需求 15.4】

- `navigator.locks.request('menote-sync')` 选出同步主标签页；其他标签页通过 BroadcastChannel 接收“某条目已更新”“游标已推进”等消息。
- 所有标签页都可以写本地 IndexedDB 和 outbox；只有主标签页上传与拉取。
- 同一条目在两个标签页同时编辑：以 IndexedDB 中的 `drafts` 为准，后写入的标签页收到广播后提示“已在其他标签页修改”，不静默覆盖编辑器内容。

---

## 七、隐私锁的实现

> **v1.1 模型修订【已定·用户确认 2026-09-26】**：隐私保护采用“服务端明文存储 + 前端门禁 + 备份导出加密”。
> 保护边界（用户确认）：隐私密码用于前端显示门禁与备份导出加密，达到“锁定时前端页面不显示、第三方备份中不直接可见”；不防爆破与专业解密，不防已登录账号、服务端数据库（Cloudflare D1/R2 为明文）与本机缓存。
> 由此，v1 中的非对称密钥对、DEK/DEK_s 数据密钥层级、正文密文信封、批量加解密转换任务与恢复码全部取消。

### 7.1 门禁模型【已定·用户确认 2026-09-26】

- **两层门禁，互不替代**：①**范围门禁（隐私锁）**——一次解锁覆盖整个**隐私范围**；②**单篇门禁（单篇加密）**——`enc_self = 1` 条目**逐篇**解密，与隐私锁**正交**（解锁隐私锁不解开它，锁定隐私锁也不清它已解密的篇目），时效为**本次浏览器会话**，可手动锁上（本篇 / 全部单篇）。
- **隐私范围**＝一份**类别清单**（不是一个容器），决定范围门禁覆盖谁：
  - **加密空间**（含空间内文件夹与条目）：**默认成员、恒在范围内、不可移出**——它是范围的本体（`folders.is_enc_space = 1` / `items.in_enc_space = 1`）；
  - **Memo 及由其衍生的待办**（清单视图 / 看板）：**可配置开关，默认加入**，一个开关管两者（账户级设置项 `privacy.scope.memo`）；
  - **预留后续扩展位**：新类别须是可枚举的内容类别、且其锁定表现能在界面上明确表达（占位 / 隐藏 / 收起三选一），逐个加入。
- 隐私空间条目与单篇“设为隐私”的条目在存储、传输、同步、版本、回收站全链路均为**明文**，仅携带标记：`in_enc_space = 1` 或 `enc_self = 1`（字段名沿用需求 DDL，不改名）。
- 标记的变更（移入 / 移出 / 开启 / 取消）与范围配置的变更都是普通元数据操作，**不需要任何密钥**：锁定时移入隐私空间（M08-09）由此天然成立，一条 `PATCH /api/items/:id/meta` 即可，条件写与冲突处理沿用第六章。
- 门禁是纯前端行为，规则沿用需求 6.9 / 8.9：锁定时占位或从列表消失、搜索按门禁过滤、禁止分享。**统计计数不受门禁影响**：首页统计卡片、导航节点、文件夹树、标签云等一切“某集合有多少条”的展示**一律计入全部隐私内容**（空间内条目、范围内的 Memo 与待办、单篇加密条目），**不因锁定 / 解锁改变**（口径与已知后果见 `docs/modules/Menote-隐私锁设计-v1.md` §4.7）。
- **空间内条目在解锁期间进入最近编辑、收藏、标签视图**（含标签筛选），**重锁即隐藏**。Memo 隐私浏览与本模型同构。
- 解锁档位为**三档**（**本次会话** / **N 分钟**无操作（默认 5，可选 1/5/15/30/60）/ **当前设备长期**），只是“门禁保持打开时长”的三种选择，实现为本地状态（含“当前设备长期”的持久标志），不再涉及密钥保管，也不依赖 SharedWorker（v1 附录 #4、#7 作废）。原“仅本次查看”档与“标签页隐藏即锁”**已作废**（四档改三档，2026-09-27）。
- 解锁 = 输入隐私密码，浏览器本地校验（对照服务端存的 verifier）通过后打开门禁；输入错误的代价只是进不了门禁。

### 7.2 隐私密码与密钥材料【已定·用户确认 2026-09-26】

| 材料 | 生成与存放 | 用途 |
|---|---|---|
| KEK | `PBKDF2-SHA-256(隐私密码, 盐, 600,000)`，浏览器内即时派生，不落盘、不上传 | 包裹 / 解包内容密钥 K |
| verifier | KEK 对固定常量的 AES-GCM 校验块，存 D1 `user_crypto` | 多设备门禁校验 |
| 内容密钥 K | 首次设置密码时随机生成 32 字节（普通字节，非 CryptoKey）；D1 存两份包裹：`AES-GCM(KEK, K)`（供外部解密工具）与 `AES-GCM(备份包裹键, K)`（供 Worker；**包裹键由唯一根机密 `AUTH_PEPPER` 域分离派生**，见 7.2 / 12.4） | 备份导出加密 |

- KDF 统一为 PBKDF2-SHA-256 600,000 次：登录密钥派生（需求 5.4 的 Argon2id 首选改为 PBKDF2，需求文档待同步）与隐私密码共用一套实现，前端不再引入 wasm（hash-wasm 取消，CSP 去掉 `wasm-unsafe-eval`）。
- 修改隐私密码 = 浏览器用旧密码解包 K → 新密码重包裹，同步更新 verifier；K 本身不变，历史备份文件仍可用**当时的口令**解开（文件头自带当时的 KDF 参数与 K 包裹块）。
- 忘记隐私密码：已登录状态下可重置——Worker 用**备份包裹键**（由根机密 `AUTH_PEPPER` 域分离派生，见下）解出 K 交浏览器按新密码重包裹，并更新 verifier。界面明示“该重置说明隐私密码不防御账号持有者”（与保护边界一致）【架构定】。
- 恢复码机制取消（其原本服务的是主钥恢复场景，本模型不存在主钥）。

**`user_crypto` 权威列定义**（权威 DDL 与迁移 `0003_user_crypto` 见 `docs/modules/Menote-隐私锁设计-v1.md` §4）：

| 列 | 类型 / 约束 | 说明 |
|---|---|---|
| `user_id` | TEXT **PRIMARY KEY** | 每账户一行 |
| `kdf` | TEXT NOT NULL，CHECK 仅 `'PBKDF2-SHA-256'` | 算法标识，将来换算法不改表 |
| `kdf_iterations` | INTEGER NOT NULL，CHECK 100000–2000000 | 当前 **600000** |
| `kdf_salt` | BLOB NOT NULL | **16 字节**（裸值，不套信封） |
| `verifier` | BLOB NOT NULL | 明文为**常量** `menote-verifier-v1` |
| `k_wrapped_pw` | BLOB NOT NULL | `AES-GCM(KEK, K)`，供外部解密工具 |
| `k_wrapped_backup` | BLOB NOT NULL | `AES-GCM(备份包裹键, K)`，供 Worker（**包裹键由 `AUTH_PEPPER` 域分离派生**，见 7.2 / 12.4） |
| `rev` | INTEGER NOT NULL DEFAULT 1 | 后写为准递增；本地缓存按它检测失效 |
| `created_at` / `updated_at` | INTEGER NOT NULL | 时间戳 |

- **BLOB 打包约定**（自带版本号，将来换算法不用改表）：`版本(1B) || IV(12B) || 密文 || GCM 标签(16B)`；两份包裹的明文都是 **32 字节内容密钥 K**。不存明文 K、KEK、隐私密码或其裸哈希（verifier 除外）。
- **不加 `sync_seq`**：门禁材料**不参与增量同步**（第六章的同步协议不变，M3 不改 M1 的同步载荷），改走**专用端点**：

| 端点 | 用途 |
|---|---|
| `GET /api/crypto` | 取门禁材料（`enabled` / `kdf` / 迭代 / 盐 / verifier / 两个包裹 / `rev`，二进制一律 base64）；需会话鉴权，`Cache-Control: no-store` |
| `PUT /api/crypto` | 启用 / 改密 / 重置后写入全部字段；后写为准，`rev + 1`；响应不回显材料 |
| `POST /api/crypto/reset` | 忘记隐私密码：服务端用**备份包裹键**（由 `AUTH_PEPPER` 域分离派生）解包 K 并返回明文 K（base64），浏览器用完即弃；`no-store`，**不得写入日志或审计正文** |
| `DELETE /api/crypto` | 关闭隐私锁；服务端**校验“无隐私内容”**（`enc_self = 1 OR in_enc_space = 1` 的条数 > 0，**含回收站中的条目**）→ 409 并返回原因 |

- **备份包裹键的派生**（v1.14 起）：`SHA-256(AUTH_PEPPER 字节 ‖ "menote-backup-wrap-v1")` → **32 字节 AES-GCM 密钥**（避免 base64 解码差异）。**用途后缀是域分离的关键**：同一根机密还要供登录校验（`HMAC(AUTH_PEPPER, …)`）与将来的分享令牌签名，加后缀才能保证各用途的钥匙互不可推。后缀常量与派生输入函数 `backupWrapKeyInput()` 落在 **`packages/shared/src/crypto.ts`**（唯一定义处），worker 在 `services/crypto.ts` 里做一次摘要与导入。**实例不再需要第二个机密**；轮换风险见 12.4。

### 7.3 备份导出信封格式【已定·用户确认 2026-09-26】

每个**隐私条目**的文件（正文、附件、缩略图、版本、快照）在离开系统前套一层信封；普通内容默认明文出站：

| 偏移 | 长度 | 字段 |
|---|---|---|
| 0 | 8 字节 | 魔数 `MENOTE1\0` |
| 8 | 1 字节 | 格式版本（当前 1） |
| 9 | 2 字节 | KDF 迭代数（千次为单位，600 = 600,000） |
| 11 | 16 字节 | KDF 盐 |
| 27 | 12 字节 | K 包裹块 IV |
| 39 | 48 字节 | `AES-GCM(KEK, K)`：32 字节密文 + 16 字节标签 |
| 87 | 12 字节 | 内容 IV |
| 99 | 可变 | `AES-GCM(K, 明文)` 密文 |
| 末尾 | 16 字节 | 内容 GCM 标签 |

**【v1.19 修订 · M7 实现并订正两个数字】**

- **固定开销是 115 字节，不是 103。** 本节原写"固定开销 103 字节"，与**它自己的偏移表**对不上：表逐行自洽（每行偏移 = 上一行偏移 + 上一行长度，内容密文止于 99），加末尾 16 字节标签是 **115**；而 103 恰好等于 `87 + 16`，**漏算了偏移 87–98 那 12 字节的内容 IV**。**以偏移表为准**（表是规范的部分且能自洽，那句总结是算错的旁注）。代码里把 `ENVELOPE_OVERHEAD_BYTES`（99，内容密文起点）与 `ENVELOPE_FIXED_BYTES`（115）分成两个常量，就是为了不让人再拿 103 去写断言。
- **K 包裹块是 `AES-GCM(KEK, K)`，而 KEK 由隐私密码经 PBKDF2 派生——服务端没有密码、也就没有 KEK。** 所以 §7.4 说的"Worker 用 K 加密"在**服务端**的具体做法是：那一块**从库里那份 `k_wrapped_pw` 逐字节取出**（本来就是同一种东西），**逐字节取不是重算**。这让备份**自足**：换一台机器、服务器没了，只要有隐私密码就能解开（§6.4「用隐私密码解开即可」要的正是这个）。**逐文件的随机量是内容 IV**（偏移 87），由 Worker 每次现生成。
- **与 §5 安全底线的关系**：出站包**不含任何密钥明文**，也不含 `user_crypto` 的裸列值；信封里的 K 包裹块是**密码包裹的密文**，强度就等于隐私密码本身——**光有备份、没有密码，解不开**。底线未被突破。


### 7.4 加密的发生位置【已定·用户确认 2026-09-26】

- **手动导出 / 全量 ZIP**：浏览器端加密（本就是浏览器驱动的流程），默认加密导出，界面提供“解密导出”勾选（需处于解锁态）。
- **Cron 增量备份到 WebDAV / S3 / Git**：Worker 从 D1 取明文 → 用 K 加密（信封）→ 推送。文本快照单文件几 KB，AES-GCM 开销可忽略；**附件按“每轮加密字节配额”分轮**（草案 4 MB/轮 ≈ 2–4 ms CPU，开发早期实测校准，见 14.2），96 轮/天 ≈ 最多约 380 MB/天的加密出站吞吐，个人用量充裕。
- **【v1.19 修订 · M7 已实现】** 落点为 `jobs/snapshot.ts`（D1 → R2 物化）与 `jobs/push.ts`（R2 → 远端），**两者共用 `snapshot/` 目录格式**（与 zip 导出内层同构，路径函数全在 `packages/shared/src/backup.ts`）。**首期只 WebDAV + S3**（Git 的 tree/commit 编排最重、价值面窄，`kind` 的 CHECK 里也**不放 `git`**——放进去等于宣告已支持而实际没有）。**不引 SDK**：只为 PUT / DELETE / 探测三个动作手写，理由是 SDK 自带重试，而**外部子请求 50 个 / invocation**（§14.3）经不起自动重试。**五条不变量**（每条都有用例钉住）：① 推送**不许超过快照已物化的位置**（推一个还没写出来的文件必然 404，404 若被当成"推过了"，游标一过就**永久丢一次备份**）；② 游标**只推过连续成功的那一段**；③ 一轮一批、批内 ≤40 个外部 PUT，**推不完下一轮续推**；④ **`append_only` 绝不执行远端 DELETE**（`sync` 档才删，且只删变更队列里明确记着"这个路径没了"的条目）；⑤ **调度档位只决定"某天推不推"**（`daily` 每轮到期，靠游标让空转那轮免费；`weekly` 是**距上次满 7 天**，不绑星期几——不必让用户对齐时钟，也不会因为错过某一轮就永远不推）。**远端删除的唯一信息源是 `export_queue`**：软删是内容变了（重推一次就同步），**永久删除才是路径彻底消失**，快照里不会有任何痕迹说它曾经存在过。
- **【v1.19 补记 · 与 M5 的差异】** M5 的 zip 导出是「密文原样搬运」，而服务端本来就存明文，**那一步今天等于搬明文**（手动导出按设计文档 §6.4 就是解锁态下导明文）；**自动备份是真加密**（M16-02 / 设计 §五）。附件字节**不进**服务端快照树（同一桶内按内容哈希已有，再存一份是存储翻倍、收益为零），故 manifest 的 `attachments` 是空数组——**清单不声称自己没有存的东西**；附件由推送侧按需直拷。
- Worker 首次需要 K 时用**备份包裹键**（由 `AUTH_PEPPER` 派生）解包一次，缓存在 isolate 内存（isolate 回收后重新解包，成本一次 AES-GCM）。
- 隐私条目**禁止分享**（沿用第十章校验），不出现在任何公开端点。

### 7.5 门禁的界面落点【依需求 6.8 / 6.9 / 8.9】

- **两套标识必须能分辨**：**隐私锁态**（范围门禁：顶栏胶囊含倒计时、侧边栏空间节点、Memo 与待办的锁定占位）与**单篇加密态**（逐篇门禁：列表行锁标识、编辑器标题旁锁胶囊、正文区锁定占位）。两者可同时出现且必须同时可见，不得用同一处标识表达两种状态（逐处映射与文案见 `docs/modules/Menote-隐私锁设计-v1.md` §9）。
- **本地搜索索引分两段**：`title_text`（标题 + 标签）与 `body_text`（正文）各自建索引，**覆盖全部未删除条目（含隐私条目）**；**查询时按门禁过滤**——标题与正文的命中规则不同：单篇加密条目的**标题任何状态可搜**、正文仅该篇已解密后可搜；空间内条目的标题与正文均需解锁，正文还受「解锁时可搜索加密内容」开关约束。M2 的“加密条目不进索引 + 锁定时过滤”写法随之作废（需求 6.10、8.9）。
- 锁定清理大幅简化：无密钥可清除、无 `blob:` 地址需撤销；锁定 = 门禁状态切换 + 关闭明文视图，未保存改动照常写入 outbox（需求 6.8 的清理清单缩减为界面项）。
- **本模型下不再需要**：不监听 `visibilitychange` / `pagehide` 做锁定（“标签页隐藏即锁”已作废，这两个事件不承担门禁语义）；不需要 SharedWorker、不需要持久化不可导出的 CryptoKey、不需要撤销 `blob:` 地址。
- 原 v1 的 7.1–7.4（密钥库组件、数据密钥 AAD、批量转换阶段）作废；`convertJobs`、`deviceKey`、`dataKeys` 相关存储删除（见 3.2）。

---

## 八、附件管线【依需求 14，接口为架构定】

**【v1.13 修订 · M4 已实现】缩略图在浏览器端生成，`workers/media.worker.ts` 这个落点已删除**：原图与缩略图的 SHA-256、缩略图编码（最长边 400 px、WebP、目标 ≤40 KB）都发生在**编辑器所在的浏览器**里（`apps/web/src/features/attachments/thumbnail.ts`）。理由与 M2 砍掉 `search.worker.ts` 同例：省一次 Worker CPU 与子请求，而 Worker 只做"代理上传"这一件它必须做的事（架构 §14.2 的 CPU 预算）。因此下面的时序图里参与者从 `media.worker` 改为**编辑器（浏览器）**。

```mermaid
sequenceDiagram
    participant U as 编辑器（浏览器）
    participant W as Worker
    participant R as R2
    participant D as D1
    U->>U: 文件（粘贴 / 拖入 / 选择）→ 算 SHA-256、生成缩略图（最长边约 400 px，WebP）
    U-->>U: 本地 blob 地址先显示（未传完一律用它预览）
    U->>W: POST /api/attachments/check（sha256 + size）
    W->>D: 查已存在的哈希（(user_id, sha256, kind)）
    W-->>U: exists / pending
    U->>W: PUT /api/attachments/blob?sha256=…（原图与缩略图**各一次请求**，流式请求体）
    W->>D: 先登记 pending_uploads（due_at = now + 24h）
    W->>R: put(流式，键 a/{uid}/{sha256} 与 .t)
    W-->>U: 落元数据的凭据（键与大小）
    U->>W: POST /api/attachments/finalize（元数据 + 可选 itemId 挂引用）
    W->>D: 同一 batch：插 attachments 两行（thumb 的 parent_id 指原图），删 pending_uploads 登记
    W-->>U: 附件 ID
```

- 引用上报【v1.13 修订 · M4 已实现】：**上传时的 `finalize` 带上 `itemId` 即落一条 `attachment_refs`**；正文里的引用写法由客户端定稿为 `![名](/api/attachments/h/<sha256>)`（图片）与 `[名](…)`（非图片），客户端用同一条正则就能把正文里的引用全抓出来。**M4 未做"保存正文时对齐引用集合"**（那要改 `PUT /api/items/:id/body` 的请求结构），期间由孤儿 30 天规则兜底；`X-Menote-Refs` 这条请求头**没有实现**，实现时用了 `finalize` 的字段。集合更新语句（`json_each` + `INSERT OR IGNORE`）留待 M6 附件管理页一并做。
- 读取：`GET /api/attachments/h/:sha256`（明文，`immutable`）；先校验会话用户与附件归属，再从 R2 流式返回，支持 `Range`（**单段**；多段 Range 按规范回 200 全量，不假装支持）。隐私条目的附件在锁定时由前端门禁不渲染（v1.1：无密文附件路径）。
- 孤儿标记：由每日维护任务按游标分批处理（见 12.2），保存路径上不做孤儿判断，保持保存请求轻量。

---

## 九、版本历史【依需求 12，实现为架构定】

| 操作 | 接口 | 服务端处理 |
|---|---|---|
| 客户端封存 | `POST /api/items/:id/versions`（请求体为已压缩的正文；请求头带 `rev`、`reason`、`content_hash`、`codec`） | 与最近一个版本哈希相同则直接返回（去重）；否则登记 pending、流式写 R2、插入元数据、更新 `sealed_rev`；随后对该条目做一次稀疏化（只读该条目的版本元数据），多余版本登记到 `r2_gc_queue` |
| 服务端封存 | MCP 写入前、冲突前、恢复前 | 从 D1 读正文转存 R2；不超过 256 KB 时 `CompressionStream` 压缩，否则 `codec = 'none'`（需求 12.4） |
| 列表 | `GET /api/items/:id/versions` | 只返回元数据 |
| 读取 | `GET /api/versions/:vid` | 从 R2 流式返回原始字节，客户端解压 |
| 恢复 | `POST /api/items/:id/restore` | 先封存 `pre_restore`，再按普通全文保存写入 |
| 保留 / 备注 | `PATCH /api/versions/:vid` | 修改 `keep`、`label` |

**idle 封存的兜底**【待确认】：需求 12.2-1 规定“最后一次改动后 10 分钟无新改动即封存”，由在线的客户端执行（标签页隐藏或关闭时立即封存）。客户端离线、崩溃或直接关机时，这一步可能漏掉。建议 Cron 每轮扫描少量 `sealed_rev < rev` 且 `updated_at` 早于 10 分钟前的条目，由服务端转存封存。

---

## 十、分享【依需求 16.1，实现为架构定】

| 接口 | 说明 |
|---|---|
| `POST /api/shares` | 创建：单篇或 Memo 合集。服务端在同一语句中校验条目“非隐私条目（无 `in_enc_space` / `enc_self` 标记）、未删除”，不满足则拒绝 |
| `GET /api/shares`、`PATCH /api/shares/:id`、`DELETE /api/shares/:id` | 我的分享：修改密码或过期时间、撤销 |
| `GET /api/public/shares/:sid` | 访客读取分享状态：是否有效、是否需要密码（附盐与 KDF 参数）、形态与标题 |
| `POST /api/public/shares/:sid/unlock` | 访客浏览器派生校验值后提交；服务端 HMAC 比对，成功后返回有效期 1 小时的访问令牌（HMAC 签名，无状态，不写库）；失败按 `share:<sid>:<ip>` 计次限速 |
| `GET /api/public/shares/:sid/content` | 单篇返回正文原文；Memo 合集按 50 条分页返回 |
| `GET /api/public/shares/:sid/att/:attId` | 校验该附件属于被分享条目的当前稿引用后，从 R2 流式返回 |

- 每次访问实时检查分享与条目状态（撤销、过期、条目进回收站、条目被加密），任一不满足即返回“链接已失效”（需求 16.1）。**不依赖 Cron**——条目态一变，链接下一次访问即失效。【M5 已落地】
- **实时检查之外，还要「真撤销」**【M6 v0.6.19 补】：实时检查**不记得一条分享曾经死过一次**——只做检查的话，条目一旦从回收站恢复、或取消单篇加密，链接就会**复活**，与需求 16.1「从回收站恢复后分享不会自动恢复，需要重新创建」冲突。故服务端在**软删条目**（`softDeleteItem`）与**隐私标记置位**（`patchItemMeta` 的 `enc_self` / `in_enc_space` = 1）时，于**同一次写**里把该条目的分享行置 `revoked_at`（限 `user_id`、幂等、**不推 `sync_seq`**——撤销是服务端行状态，所有设备共享同一份 `shares`）。**正确性因此不再依赖客户端**：原先只有客户端的 `revokeItemShares` 行清理兜底，而那段每个 revoke 都被 try/catch 吞掉、且在另一台设备上恢复条目时根本不会跑。客户端那步保留，但退化为「提示用户 + 刷新列表」。
- **入口偏离（v1.16 订正）**：本节原定「独立入口页 `apps/web/share.html`」，**实际未采用**——`@cloudflare/vite-plugin` v1.60 接管客户端入口，手写第二个 html input 会报 `UNRESOLVED_ENTRY`。现按 §2.1 的 Static Assets SPA 规则实现：`/s/<分享ID>` 回退到 `index.html`，由 `apps/web/src/main.tsx` 按 `pathname` 分流并**两侧都动态 `import()`**，访客不拉编辑器与同步 chunk。**这不是第二套页面骨架，也不拆 Worker。**
- 访问令牌**放 `X-Menote-Share` 请求头、不进 URL**（避免进服务端日志与浏览器历史记录）；签名密钥由 `AUTH_PEPPER` 经 HKDF 派生（标签 `menote-share-v1`），**无状态、不写库、不可续期**（有效期 1 小时），不新增 Secret。
- **origin 决策**（M5，用户 2026-10-02 拍板）：分享走**独立子域**（如 `share.example.com`），与主应用**指向同一个 Worker**（不拆第二个 Worker）。子域值存**实例设置**（`app_meta` 键 + `GET/PUT /api/admin/share-origin`，仅 owner），**留空即回退当前站点 origin**，同域 `/s/<分享ID>` 同样可用。
- **会话隔离零配置**：`middleware/session.ts` 的 `setSessionCookie` **不带 `Domain` 属性** → 浏览器默认 host-only，主应用会话 Cookie 永远不会发给分享子域；子域上对 `/api/*` 的会话请求天然 401（纵深防御）。
- **公开附件只放行「被分享条目当前稿正文引用」的哈希**（`extractAttachmentRefs`，两端共用一份契约），以正文为准、**不查 `attachment_refs` 表**（引用集合对齐属 M6 遗留，该表可能有陈旧行），不提供遍历。
- **首期范围**：只做单条分享（笔记 / 表格 / 单条 Memo）。Memo 固定合集（功能拆解 M14-02）**后置**——`share_items` 表随迁移 0005 建好但**不接 UI**，等后续细则。
- 查看器只加载渲染模块，不包含编辑器与同步代码；渲染结果经 DOMPurify 清洗；页面设置 `Referrer-Policy: no-referrer`，避免分享 ID 经外链泄露。表格条目按只读网格呈现，有图片引用时给「表格 / 图册」切换，**不提供筛选排序**（Q18 建议案）。

---

## 十一、MCP【依需求 17，实现为架构定；【v1.18】M6 第三块已全部落地】

- 端点：`POST /mcp`（令牌在 `Authorization` 请求头）与 `POST /mcp/k/<令牌>`（仅当该令牌允许 URL 方式）；`GET /mcp` 返回 405（无 SSE）。**【M6 落地补记】`/mcp` 必须列进 `wrangler.jsonc` 的 `assets.run_worker_first`**（与 `/api` 同理），否则 Static Assets 的 SPA 回退会把 POST 吃掉、客户端拿到一份 HTML——**失败方式是 HTTP 200 + HTML**，极难与鉴权 / 协议问题区分。子应用挂在 `/mcp` 下，其内部路径是**相对**的（`/` 与 `/k/:token`，写成 `/mcp` 就是 `/mcp/mcp`）。该端点**刻意不挂** `csrfGuard`（不用 Cookie 鉴权，无 CSRF 面）、`requireSession`（令牌鉴权）、`configGuard`（**不需要 `AUTH_PEPPER`**：令牌是高熵随机串，SHA-256 足够，需求 §17.3）——于是它是**唯一不受「缺机密就 503」约束**的服务端路径，是有意的不是遗漏。
- 协议：无状态 JSON-RPC，支持 `initialize`、`notifications/initialized`（返回 202）、`ping`、`tools/list`、`tools/call`。工具的 JSON Schema 在构建时生成静态常量，运行时不做 schema 编译。**【M6 落地补记】错误分两类**：**协议层**走 JSON-RPC error（`-32601` / `-32602` / `-32603` / `-32001` / `-32029`），**业务失败一律 `result.isError = true`**——权限不够、参数不对、条目太大都由 agent 读完提示自行纠正，塞进协议错误里它多半只会当成"服务坏了"反复重试。限速另带 HTTP 429。
- 每次调用的处理顺序：令牌哈希查询（SHA-256 由 WebCrypto 计算）、过期与撤销检查、限速、权限位检查、范围过滤、执行、审计与幂等记录（与写入在同一个 batch 中）。`last_used_at` 最多每 10 分钟写一次。【M6 落地补记 · 见下方「限速的落地方式」】
- 范围过滤作为每条查询的固定 SQL 片段：`enc_self = 0 AND in_enc_space = 0`（加密内容不可见，需求 6.13）；文件夹范围用 `folder_id IN (SELECT id FROM folders WHERE user_id = ? AND (id IN (SELECT value FROM json_each(?)) OR parent_id IN (SELECT value FROM json_each(?))))`（文件夹最多两层，需求 4.5）；`include_memos = 0` 时排除 Memo。
- **不变式 I1**：MCP 可见集合 ＝ 令牌范围 ∩ 非隐私内容 ∩（Memo 需令牌勾选「包含 Memo」）∩ 非回收站，且**与隐私锁是否解锁无关**。
- **不变式 I2**：**界面矩阵与 MCP 矩阵互不联动**——改隐私范围配置不动令牌，改令牌不动范围。
- MCP 返回的**条目数不含隐私内容**（需求 17.4 的 `list_folders` 等计数同此口径）；**空间节点不出现在 MCP 的文件夹树里**。
- 大条目处理完全按需求 17.4：区间读取与搜索片段用 `substr()` / `instr()`；追加用 `body = body || ?`；小节解析、`replace_section` 等只对 512 KB 以内的条目开放。**【M6 落地实测 · 原【待核实】已销】**：390,040 字节（13 万汉字）中文正文的 `read_item(section)`，**解析 + 整个 HTTP 往返 20 ms** → **门槛维持 512 KB 不下调**。门槛的实际作用是**防止正文被取回内存**（2 MB 上限的条目取回来会吃掉可观的 CPU 与内存），不是 CPU 已经不够用。**已知未实现**：`edit_item` 的 `replace_text` 对 >512 KB 条目走 SQL（`instr()` + `replace()` 同一条件校验唯一出现）那条路径——当前统一按"超门槛就拒绝并提示改用区间 / 游标"处理。
- 追加类写入的条件重试（需求 17.4）在同一个请求内最多一次，保证单请求的 D1 语句数可控。
- **令牌哈希必须哈希「整个令牌串」（含 `mn_` 前缀），不能只哈希裸随机字节**。会话令牌存的就是 `SHA-256(base64UrlDecode(token))`，而 MCP 令牌恰好也是 32 字节随机数走 base64url——**两边都哈希裸字节的话，一个会话令牌字符串就能被当成合法 MCP 令牌鉴权通过**，令牌的权限位、范围、审计全挂在它名下。带上前缀做域分隔后两类令牌落在不同哈希域，且前缀不符时**连哈希都不算**。
- **限速的落地方式偏离需求原文**【已定·用户确认 2026-10-03】：需求 §17.3 写「优先使用 Workers Rate Limiting 绑定（免费版可用性待核实）；不可用时用 D1 中按分钟窗口的计数」，本项目**直接用 D1 计数**——加绑定要改部署配置、本地测试还要造假绑定，而**令牌查询那次读本来就要做**，计数与 `last_used_at` 能合并成同一条 `UPDATE`，常态下一次调用只多 1 行写。计数值落在 `api_tokens` 的 `rate_window_start` / `rate_call_count` 两列（**不建 `rate_counters` 表**），用**条件自增**（`WHERE rate_window_start = ?`）而非"读出来算好再写回去"——后者在并发下会让两个请求都读到 count=59、都判定通过、同一分钟多放行 2 次。**定稿那条「`last_used_at` 最多每 10 分钟写一次」的节流刻意不做**：选了 D1 计数后每次调用本来就要写令牌行，那条节流已无可省之物，留在热路径上只会让人以为它不生效；结果是 `last_used_at` 比需求更准，不是更松。限速**排在过期 / 撤销检查之后**是有意的：被撤销的令牌不该消耗额度，且"非法令牌"这条路一个字都不写。
- **审计与幂等要和写入在同一个 `db.batch`**。为实现这一点，四个既有写函数（`saveItemBody` / `createItem` / `patchItemMeta` / `softDeleteItem`）各加了一个**可选**的尾随语句参数（默认空数组 = 行为与加参数之前完全一致，同步路径与批量端点都不传）。**幂等的四步**：读 `mcp_operations` 判三态 → 预检冲突则**一行都不写**（包括不写幂等行，否则 agent 用同一个 `operation_id` 重试会永远拿回那次冲突）→ 一个 batch（主写入 + 审计 + 幂等）→ 极小竞态（预检通过后被抢先）时补一个小 batch **删掉幂等行 + 记一条 `conflict` 审计**。**参数摘要不能用 `JSON.stringify(args, keys)`**：把键数组当 replacer 会**同时过滤嵌套对象的键**（`properties.tags` 被悄悄丢掉，两个不同请求算出同一摘要、幂等误判成重放），改为自己写的 `canonicalJson`（每层排序、丢 `undefined`、数组保序）。
- **MCP 不改变内容的加密归属**：不提供置 `enc_self`、不提供改 `type`，`organize_item` 的移动目标不能是加密空间行。理由是 MCP 看不见加密内容，就同样不该有能力改变加密归属——否则一个被诱导的 agent 可以把笔记塞进加密空间，让用户在界面上再也找不到它。
- **写前封存**：改动正文前先封一条 `reason = 'pre_mcp'` 的版本，**`keep = 1`**（这是需求 §17.4「用户可在版本历史中撤回」的前提——`keep = 0` 会被稀疏化删掉，承诺就不成立），同一条目 10 分钟内最多一次。该 reason 枚举值自 M4 起即存在，**v0.6.25 才第一次有生产调用方**。

---

## 十二、后台任务（Cron）

### 12.1 单一 Cron 分派器【架构定】

只配置一个 Cron：`*/15 * * * *`（免费版每账户最多 5 个，留给其他项目）。每次触发只有 10 ms CPU 和有限的子请求，因此每轮按固定配额依次推进各任务，配额以“处理条数”计（Workers 中 `Date.now()` 只在 I/O 之后推进，无法用于精确计时）：

| 顺序 | 任务 | 每轮配额 | 依据 |
|---|---|---|---|
| 1 | 注册开关到期自动关闭 | 1 次条件更新 | 需求 5.2 |
| 2 | R2 待删对象（`r2_gc_queue` 中已到期的） | **20** 个对象 | 需求 14.4 |
| 3 | 快照物化（D1 → R2 `snap/{uid}/`） | **10** 个文件、**5** 个用户 | 需求 16.3、§12.4 |
| 4 | idle 封存兜底 | **3** 条（**M4 已实现**） | 需求 12.2 |
| 5 | 外部备份推送 | **每个启用目标一批**，一批 **≤40** 个外部请求、**5** 个目标 | 需求 16.3、§12.4、§14.3 |
| 6 | 每日维护：推进一步 | **一个步骤**（五步见 12.2） | 见 12.2 |

**【v1.19 修订 · M7 已实现】③ 与 ⑤ 不再是接口位。** 两者在 M7 落地，且**各有两个独立游标**：③ 的游标是 `user_snapshot_state.cursor_seq`（**每用户一行**，迁移 `0008`；条目与文件夹共用一个数字，因为两者取自同一个全局 `sync_seq` 计数器）；⑤ 的游标是 `user_backup_targets.cursor_seq`（**每目标一行**，各目标互不影响）。③ 是**增量**的（只写 `sync_seq` 落在游标之后的），所以"没东西变"的那一轮一个字节都不写。③ 与 ⑤ 各自只在**有启用中的备份目标**时才做实事，没有目标就如实报"无需物化 / 没有目标"而不是假装跑过。⑤ 的**单批上限 40 是硬约束**，理由见 §14.3。


各任务的进度游标存在 `app_meta`，**键名（M4 已实现，与代码一致）**：`job:gc:cursor`（R2 GC）、`job:maintenance:day`（今天是否已走完一圈）、`job:maintenance:step`（圈内走到第几步）、`job:sweep:item`（版本稀疏化的条目游标）。一轮没做完的下一轮继续，重复执行无副作用。

**【v1.13 修订 · M4 已实现】不加锁，容忍重复**：多 isolate 可能同时跑同一轮，实现上**刻意不加锁**，靠"配额 + 游标 + 幂等"容忍重复——永久删除按条件删、稀疏化按条件删、墓碑按 floor 推进，重复执行都不会更糟。加锁会引入一个"锁没释放就再也不跑"的故障模式，而这里的任务全都可以安全重放，不值得为它冒那个风险。（`schema` 自愈那次例外是**必须**互斥的：建表并发会撞 DDL，所以它有自己的迁移锁，见 §15.5。）

### 12.2 每日维护状态机【架构定】

每天第一次进入维护窗口（凌晨，按实例所有者时区）时开始，之后每轮推进一步，一天之内做完：

1. 回收站到期条目：取一小批，按 12.3 执行永久删除。**【M4 已实现】保留期按用户设置**（`user_settings.version_trash.trash_retention_days`，默认 30 天）——设置页能改它，维护就必须读它；设置行损坏时退回默认值（维护任务不能因为一行脏数据停摆）。
2. 版本稀疏化：按条目游标处理跨越年龄档位的旧版本（需求 12.3）。**【M4 已实现】密度分档**：24h 全留 / 1–7 天每 6 小时 / 7–30 天每天 / 30 天–1 年每周 / 1 年以上每月；`keep=1` 与手动版本不参与；另按用户设置裁"最长保留时长"与"条数上限"。
3. 附件孤儿标记与到期删除（孤儿超过 30 天，需求 14.3）。
4. 引用一致性检查：没有元数据的版本记录、所属条目已不存在的版本与快照登记（需求 14.4）。
5. 清理：审计日志（90 天）、MCP 幂等记录（7 天）、过期会话、`auth_throttle` 过期行、墓碑（180 天，并推进 `tombstone_floor`）。

### 12.3 永久删除【依需求 14.4】

一个 D1 batch 内完成：删除 `items`、`item_bodies`、`attachment_refs`、`shares` / `share_items` 中的相关行，删除 `item_versions` 并把它们的 R2 键登记到 `r2_gc_queue`，写入墓碑，写入快照队列（删除快照文件，Memo 则重写月份文件）。不再被引用的附件由每日维护任务标记与删除。条目数量多（例如清空回收站）时，由客户端按每批 10 条分多个请求提交，保证每个请求的语句数在上限以内。

**【v1.13 修订 · M4 已实现】**：①**一次逻辑写共享一个 `sync_seq`**——删条目、删正文、删引用、删版本、写墓碑这几组语句共用一个新序号，客户端按序号推进游标时不会看到"删了一半"的中间态；②**快照文件属 M5/M6**，M4 的永久删除**只在接口位留空**（不生成删除快照的队列项），因为 M4 还没有快照目录可删；③清空回收站按 `PERMANENT_DELETE_BATCH = 10` 分批，每批一个 batch。

### 12.4 快照与外部备份【依需求 16.3】

- 快照：每个队列项读取条目元数据与正文，用 `packages/mdcore` 的快照格式生成文件写入 `snap/{uid}/`，按 `rev` 条件删除队列项。Memo 的月份文件由该月全部 Memo 拼成；月份键由客户端按用户时区算好随写入提交，服务端不做时区换算；用户修改时区后，客户端提交一次“重建全部 Memo 快照”的请求。
- 外部备份：适配器统一接口 `put(path, stream)`、`delete(path)`、`commit()`（仅 Git 用）：
  - WebDAV：`PUT` / `DELETE`，按需 `MKCOL`。
  - S3：aws4fetch 签名，`UNSIGNED-PAYLOAD`。
  - Git：托管平台的 git data API，一批文件为 N 次 blob 创建 + 1 次 tree + 1 次 commit + 1 次 ref 更新，一批最多约 40 个文件，受 50 个子请求限制；不使用 contents API（每个文件一次提交）。
- “立即备份”和首次全量备份由浏览器循环调用 `POST /api/backup/:target/run`，每次一批，显示进度（需求 16.3）。
- **出站加密【v1.1 新增，已定·用户确认】**：隐私条目的所有文件出站前按 7.3 信封加密——快照生成时即加密写入 `snap/`；附件与版本在推送时加密。每轮加密字节配额 ≤ 4 MB（实测校准），超出部分留到下一轮；普通内容明文出站。
- 备份凭据与内容密钥 K 用**备份包裹键**以 AES-GCM 加密存 D1，只在 Worker 内存中解密使用。**该键自 M3 起就需要**（重置隐私密码时服务端要解包 K，见 §7.2 的 `POST /api/crypto/reset`；v1.14 起不再有"由 M5 提前到 M3 的第二个机密"这回事）。**派生**：`SHA-256(AUTH_PEPPER 字节 ‖ "menote-backup-wrap-v1")` → 32 字节 AES-GCM 密钥；**实例只需要配置一个机密 `AUTH_PEPPER`**。**轮换风险**：更换 `AUTH_PEPPER` 会同时影响**登录校验**与**备份包裹**，已存的 `k_wrapped_backup` 解不开（重置与备份加密随之中断），需在解锁态下**重新包裹一次 K** 即可修复；记入运维注意项（Runbook 属 M6）。

---

## 十三、认证与安全

### 13.1 认证接口【依需求 5.4】

| 接口 | 说明 |
|---|---|
| `POST /api/auth/prelogin` | 返回盐与 KDF 参数；**对不存在的用户也返回同一个算法算出的确定盐**：`HMAC-SHA256(AUTH_PEPPER, "menote-prelogin-v1:" + 用户名小写)[0..16]`。注册与改密时服务端**沿用这同一个盐**（客户端只能拿 prelogin 的盐派生密钥，另取随机盐会导致注册/改密后立即登不进去）；附带收益是注册前后盐不变，攻击者无法靠"盐变了"判断用户名是否存在 |
| `POST /api/auth/login` | 提交浏览器派生的登录密钥；服务端 `HMAC-SHA256(AUTH_PEPPER, 登录密钥)` 常量时间比对；失败按“用户名 + IP”计数 |
| `GET /api/auth/registration-state` | **公开、无需登录**：返回 `{ open, has_users }`；登录页据此决定是否显示注册入口，`has_users = false` 时前端直接进注册页。不做任何 HMAC，因此**不受**机密缺失的 503 影响 |
| `POST /api/auth/register` | 单条 `INSERT ... SELECT ... WHERE` 语句同时判定“库中无用户”或“注册开关开启且未到期”，并在库中无用户时写入 `role = 'owner'`，避免两个并发的首次注册都成为 owner |
| `POST /api/auth/logout`、`GET /api/auth/me` | 会话管理 |
| `POST /api/auth/password` | 修改登录密码：旧密钥校验后写入新盐、新 KDF 参数与新校验值 |
| `GET/PUT /api/admin/registration`、`GET /api/admin/usage` | 仅 owner：注册开关（含到期时间）、实例用量概览 |

### 13.2 Web 安全【架构定】

- **CSRF**：Cookie 为 `SameSite=Lax`；所有非 GET 请求要求自定义请求头 `X-Menote: 1`，并校验 `Origin` 与部署域名一致。
- **CSP**（通过 Static Assets 的 `_headers` 文件下发）：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`。`style-src` 需要 `'unsafe-inline'` 是因为 CodeMirror 6 运行时注入样式；脚本不允许内联。v1.1 后前端无 wasm，`wasm-unsafe-eval` 移除。
- **XSS**：所有用户内容渲染经 DOMPurify；markdown-it 不直接放行原始 HTML；链接统一加 `rel="noopener noreferrer"`。
- **其他响应头**：`X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`（分享页为 `no-referrer`）、`Permissions-Policy` 关闭不需要的能力。
- **Secrets**：**只有一个根机密 `AUTH_PEPPER`**（v1.14 起删除第二个机密 `BACKUP_CRED_KEY`）。它派生出三处用途，**域分离**保证互不可推：①登录校验 `HMAC-SHA256(AUTH_PEPPER, 登录密钥)`；②备份包裹键 `SHA-256(AUTH_PEPPER 字节 ‖ "menote-backup-wrap-v1")`（`user_crypto` 的 `k_wrapped_backup` 与备份凭据加密都用它，见 §7.2 / §12.4）；③分享访问令牌签名密钥（M5，届时带自己的用途后缀）。
- **多用户隔离**：仓储层的每条 SQL 都必须包含 `user_id` 条件（需求 18.1），并在测试中用“两个用户互相访问对方 ID”的用例覆盖所有接口。

---

## 十四、性能与 CPU 预算

### 14.1 前端性能预算【架构定】

| 项 | 预算 |
|---|---|
| 首屏 JS（gzip） | ≤ 200 KB（界面框架 + 布局 + 列表 + Dexie）。**【M7 校准 · 实测 68.3 KB，2026-10-03 v0.7.0】**，占 34%，余量 131.7 KB |
| 按需加载的模块 | 编辑器、表格编辑器、Markdown 渲染、搜索 Worker、媒体 Worker、备份导出加密、设置页、分享查看器各自独立分包 |
| 冷启动到可操作（已缓存外壳） | 中端手机 1.5 秒内显示本地列表，不等待网络。**【M7 校准 · 未实测】**本地测不出中端手机 |
| 输入延迟 | 2MB 文档中连续输入无可感知卡顿：大小计量与补丁生成增量计算，预览按块增量渲染。**【M7 校准 · 未实测】**需真机 |
| 备份导出加密（单文件 ≤ 数 MB） | 浏览器端执行，不阻塞主线程 |

CI 中加入包体积检查，首屏包超预算即构建失败（`pnpm check:size`）。

> **【M7 校准补记】首屏那 131.7 KB 余量的真正用途**：它说明该盯的**不是首屏总数，而是"某个操作前要加载多少 chunk"**——设置页、MCP、分享查看器都已经分包，加子路由不会推高首屏。校准过程见 `docs/modules/Menote-M7-性能预算校准-v1.md`。

### 14.2 Worker CPU 预算（估计值，开发早期实测；【v1.18】已部分校准）

| 接口 | 主要开销 | 估计 | 防护 |
|---|---|---|---|
| 会话鉴权 | 1 次 SHA-256 + 1 次 D1 读 | < 0.5 ms | — |
| 增量拉取（200 行元数据） | JSON 序列化 | 1–2 ms | 每页 200 行上限 |
| 读取或全文保存 2MB 正文 | UTF-8 编解码、参数传递 | 数毫秒（需求 19.6） | 原文作为请求体与响应体，不用 JSON；1102 时客户端改用补丁或延长重试 |
| 补丁保存 | 几 KB JSON | < 1 ms | 最多 20 个操作 |
| 附件与版本上传、下载 | 流式转发 | < 1 ms | 不缓冲请求体 |
| MCP 区间读取、搜索片段 | SQL 截取 | < 2 ms | 结果条数与字符数上限 |
| **MCP 小节解析（≤ 512 KB）** | 标题扫描 | **【M7 校准 · 实测】390,040 字节中文正文：解析 + 整条 HTTP 往返 20 ms，且在 workerd 里未触发 10 ms CPU 限额** → **门槛维持 512 KB 不下调**（见 §十七-4） | 超过门槛返回"条目过大" |
| 服务端版本压缩（≤ 256 KB） | `CompressionStream` | 【未实测】 | 超过 256 KB 不压缩 |
| Cron 备份出站加密（≤ 4 MB/轮） | AES-GCM（WebCrypto） | **【估计 · 未实测】≈ 2–4 ms**。定单轮配额时**按 2 MB/轮 起步**（4 ms 的下界留余量），量过再放宽 | 每轮加密字节配额，超出留到下一轮 |
| Cron 每轮 | 多个小任务 | **受 14.3 的子请求上限约束** | 配额可调，每轮可中断 |

实测方法：部署测试环境，用脚本构造 64 KB、512 KB、1 MB、1.9 MB 的明文与备份信封密文，逐个接口压测，从 Workers 日志读取每次调用的 CPU 时间；结论写回本节，并据此确认需求 19.6 的备选方案是否需要启用。**用户 2026-10-03 拍板「先按估计值定，不等实测」**，所以上面标【估计】/【未实测】的几行**是已知未验证的**，不是量出来的。校准过程与"什么时候该回来实测"见 `docs/modules/Menote-M7-性能预算校准-v1.md`。

### 14.3 子请求上限【平台硬限额；【M7 校准】新增】

Cloudflare 官方限额（2026-02-11 changelog + Limits 页）：

| 类别 | 免费版 | 付费版 |
|---|---|---|
| **外部** 子请求（`fetch()` 到互联网：WebDAV / S3 / 第三方 API） | **50 / invocation** | 默认 10,000，可用 `wrangler.jsonc` 的 `limits.subrequests` 调到 1000 万 |
| **Cloudflare 内部服务**（R2 / D1 / KV / DO 绑定） | **1000 / invocation** | 1000（**与套餐无关**） |

**这条否掉了《定时自动备份设计》§二 的原单批参数**：那份设计写「一轮推 20 批 / 批 40 文件」＝ 一次 invocation 推 800 个文件，而 WebDAV / S3 走 `fetch()` 属外部——**免费版一次最多 50 个**。加上原设计的"Cron 每日一次"，等于**每天只能推约 45 个**，500 文件的库首轮全量要 11 天。三处口径的修改建议见 `docs/modules/Menote-M7-性能预算校准-v1.md` §四（核心是**改为按配额续推**：复用已有的 `*/15` 触发器，每轮推一批，每天 96 轮 × 45 ≈ 4300 文件）。**M7 开工定时备份时必须先改这处**，否则按原参数实现必然撞限额。

---

## 十五、工程化：测试、CI、环境与迁移

### 15.1 测试分层【依需求 21.2】

| 层 | 工具 | 必测内容 |
|---|---|---|
| 共享包单元测试 | Vitest | 码点换算（emoji、代理对、组合字符）；表格编解码往返与容错（随机生成的表格做往返测试）；front matter 与标签、任务字段派生；快照格式；备份信封格式解析 |
| Worker 集成测试 | Vitest + `@cloudflare/vitest-pool-workers`（本地 D1 / R2） | 条件 batch 与冲突判定；补丁在 D1 中拼接的结果与客户端一致；1,900,000 字节 `CHECK`；永久删除的完整范围；多用户隔离；MCP 权限、范围与隐私条目不可见；备份出站中隐私条目只以密文出现；幂等 `operation_id` |
| 信封与门禁测试 | Vitest（浏览器环境） | 信封格式往返与篡改检测；改隐私密码后新备份用新口令、旧备份仍可用旧口令解开；外部解密工具对样例包的解密；门禁过滤（列表 / 统计 / 搜索 / Memo） |
| 端到端测试 | Playwright | 离线编辑后恢复网络、两端同时编辑产生冲突副本、多标签页选主与接任、锁定时隐私视图关闭、分享链接在条目设为隐私后立即失效 |
| 性能测试 | 自写脚本 + 测试环境 | 14.2 的 CPU 实测 |

### 15.2 CI（GitHub Actions）

每次推送和 PR：类型检查、lint、单元测试、Worker 集成测试、构建、包体积检查；主分支额外运行端到端测试。

发布不由 GitHub Actions 承担：部署主路径是 Workers Builds（Git 推送触发，见 15.5），避免两套部署通道互相覆盖。

### 15.3 环境【架构定】

| 环境 | 组成 |
|---|---|
| 本地开发 | Vite 开发服务器 + `@cloudflare/vite-plugin`（本地模拟 Worker、D1、R2） |
| 测试环境 | 独立的 Worker、D1、R2（同一免费账户内另建一套），用于 CPU 实测与发布前验证 |
| 生产环境 | 部署者自己的 Cloudflare 账户，从 GitHub 一键部署（见 15.5），资源部署时自动创建 |

### 15.4 数据库迁移【依需求 18.1】

- 迁移脚本放在 `apps/worker/src/db/migrations/`，按序号命名，每个脚本幂等（`CREATE TABLE IF NOT EXISTS` 等），单个脚本的语句数不超过 45 条。
- 每个 isolate 首次请求读取 `app_meta.schema_version`；低于代码期望值时，先用条件更新抢占 `app_meta` 中的迁移锁（带过期时间，防止并发执行），再按序执行迁移并校验必需的表与索引，最后写入新版本号。
- **这是唯一的迁移通道**。不要用 `wrangler d1 migrations apply` 建表：该命令在全新账户上会因查不到库而直接失败（CLI **不会**自动供给 D1），于是同一条部署链路上的 `wrangler deploy` 永远执行不到、库也建不出来；且部署主通道 Workers Builds 执行的是 `npx wrangler deploy`，改 `package.json` 的 `deploy` 脚本对它无效（见 §15.5）。迁移放运行时自愈，一键部署才真正零手工步骤。
- 需要数据回填的迁移（例如补 `sync_seq`）拆成分批任务，由 Cron 推进，不在请求路径中一次做完。
- 表结构之所以表在 `apps/worker/src/db/` 内以 TS 常量（而非 `.sql`）承载：无需额外 Wrangler 模块规则、可被 `tsc`/ESLint 检查、测试可直接引用；`migrations_dir` 与目录保留，仅供将来可选的手工/本地 apply。

### 15.5 部署：从 GitHub 一键部署到 Cloudflare【已定·用户确认 2026-09-26】

目标：部署者（本人或想自部署的家人）在自己的 Cloudflare 账户上从 GitHub 仓库完成部署，**不提前手动创建任何资源**——Worker、D1、R2、Cron 触发器均在部署时自动创建并绑定。

分三层实现，全部使用 Cloudflare 官方机制（2026-09 查证）：

1. **声明式资源与自动供给（Wrangler ≥ 4.45）**：`wrangler.jsonc` 中的 D1 / R2 绑定只写 `binding` 与默认资源名、**不写资源 ID**，`wrangler deploy` 时若资源不存在会自动创建并回写 ID（开放 beta；资源创建后即使不回写也保持绑定关系）。Cron 触发器写在 `wrangler.jsonc` 的 `triggers.crons`，随部署生效，无需单独创建。
2. **Deploy to Cloudflare 按钮**：README 放置 `https://deploy.workers.cloudflare.com/?url=<仓库地址>`。点击后 Cloudflare 会：克隆仓库到部署者的 GitHub/GitLab 账户 → 解析 `wrangler.jsonc`，自动供给并绑定全部受支持资源（KV、D1、R2、Durable Objects、Queues 等）→ 配置好 Workers Builds。部署设置页可自定义 Worker 名与资源名，并逐项提示填入必需机密。
3. **Workers Builds（Git CI/CD）**：此后每次推送到生产分支自动构建并部署；非生产分支与 PR 生成预览 URL 并回贴到 GitHub。部署通道只有这一条，与 §15.2 的测试职责分离。

仓库为满足一键部署需要遵守的约定：

- **`wrangler.jsonc`**：资源绑定带默认名（如 `database_name: "menote-db"`、`bucket_name: "menote-files"`），保证自动供给能按名创建。**机密不要写进 `wrangler.jsonc`**：`"secrets": { "required": [...] }` 看似"部署页逐项提示"，实际是 **deploy 的硬门禁**——机密未设置时 `wrangler deploy` 直接失败，而首次部署时 Worker 尚不存在、无法先设机密，会把一键部署与 Workers Builds 永久堵死（M1 实测踩到）。正确做法：随仓库提供 `.dev.vars.example` 说明每一项的格式与生成方式；线上机密在 Dashboard（Worker → Settings → Variables and Secrets，类型选 Secret）或 `wrangler secret put <NAME>` 添加；缺机密的保护放在**运行时**——`apps/worker/src/middleware/config-guard.ts` 对真正需要机密的端点返回 503 并说明缺哪一项，且绝不用空密钥算 HMAC。机密清单：**只有 `AUTH_PEPPER`**（见 §13.2）——v1.14 起不再有 `BACKUP_CRED_KEY`（备份包裹键由它**域分离派生**，见 §7.2 / §12.4）。**没有 `SESSION_SECRET`**：会话令牌是随机 256 位、库里只存 SHA-256，不需要服务端密钥
- **`package.json` 的 `deploy` 脚本**：只做 `wrangler deploy`。**不要把 `wrangler d1 migrations apply` 放进部署链路**（原因见 §15.4 第三条）；迁移由运行时自愈在首个请求完成。
- **不硬编码域名**：`*.workers.dev` 子域因账户而异。§13.2 的 Origin 校验、分享链接、MCP 端点地址均从请求的 `URL.origin` 推导；自定义域名作为可选后置步骤（dashboard 添加），代码不依赖它。
- **仓库可见性**：仓库须为 public，其他人才可能通过按钮部署；本人部署自己的仓库（含私有）可直接走 dashboard「Import a repository」，自动供给行为相同。

边界与已知坑：

- **R2 自动创建不豁免绑卡**：免费账户未绑定支付方式时 R2 资源无法创建，一键部署会在 R2 绑定处失败（对应需求文档待裁决事项）。未绑卡时可先移除 R2 绑定做 D1-only 部署，附件功能后补。
- **机密不进仓库**：`AUTH_PEPPER` 只在部署页填入；若改用命令行部署，则 `wrangler secret put` 设置一次。（v1.14 起实例只有这一个机密。）
- **按钮部署会克隆出新仓库**：Deploy 按钮把源仓库克隆为部署者账户下的**新仓库**并接管后续 Git 推送。本人自部署若不想产生分叉仓库，走 dashboard 导入原仓库即可，效果一致。
- **测试环境**（15.3）是一次性手动创建的独立资源，不参与一键流程。
- 平台事实【待核实→已核实 2026-09】：自动供给支持 KV / D1 / R2 / Hyperdrive / Vectorize / Durable Objects / Queues / Workers AI；monorepo 若用按钮的子目录模式，该子目录必须依赖自包含。本仓库 `wrangler.jsonc` 在根目录，不受影响。

---

## 附：待确认与待核实事项索引

| # | 事项 | 位置 | 推荐 |
|---|---|---|---|
| 1 | 前端框架 | 2.2 | React 19（与 Inkstone 同栈）；备选 Preact |
| 2 | 代码是否放在 MeNote 仓库，以及目录结构 | 2.3 | 同一仓库，pnpm workspace |
| 3 | D1 表结构的技术补充（墓碑、R2 待删队列、更多表进入增量同步、附件的版本引用、限速计数、跨会话字段） | 5.1 | 按 5.1 补充 |
| 4 | ~~SharedWorker 的移动端支持与会话档退化方式~~ | 7.1 | v1.1 作废：门禁无密钥保管，不依赖 SharedWorker |
| 5 | ~~转换开始时先打 `enc_pending` 标记~~ | 7.4 | v1.1 作废：无转换任务，标记变更即时生效 |
| 6 | idle 封存由服务端兜底 | 9 | 启用 |
| 7 | 缩略图的 R2 对象键 | 5.2 | 待核实（沿用 v1） |
| 8 | MCP 小节解析门槛、服务端压缩门槛、2MB 全文读写的 CPU 实测 | 11、14.2 | 待实测 |
| 9 | Cron 备份出站加密的每轮字节配额实测 | 7.4、14.2 | 草案 4 MB/轮，实测校准 |
| 10 | 需求文档 §6 / §18.2 / §5.4 的模型同步 | 修订记录 | 升版 v7.5，按 v2 第十一章待同步清单执行 |
