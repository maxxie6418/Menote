# MeNote 空白新建不保存设计 v1

| 项 | 内容 |
| --- | --- |
| 文档版本 | v1.1 |
| 文档状态 | **生效（已实现，v0.8.36；v1.1 订正回收的失败兜底，v0.8.38）** |
| 目的和适用范围 | 定义「点了新建、却什么都没写」的那一条该不该保存：判据是什么、什么时候才产生第一条上传操作、什么时候回收、哪些情形不受影响。适用于 `apps/web` 的新建流程（笔记 / 表格 / 快速录入）、outbox 入队漏斗与工作区选中项切换 |
| 权威级别 | 模块规则（不覆盖 `wiki/`；实现口径已同步 `wiki/Menote-项目架构-v1.md` §6.3 与 `wiki/Menote-功能拆解-v2.md` M04-01 / §9.3） |
| 最后更新日期 | 2026-10-18 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
| --- | --- | --- | --- | --- |
| v1.1 | v0.8.38 | 2026-10-18 | 订正 §3.3 `reapBlankSeedOnLeave` 的契约：`changed` 允许返回 Promise、由回收方 await 并兜住 purge 与 changed 两处失败（原先调用点写成 `() => void refresh()`，刷新成浮动 Promise，库被关掉时炸未处理拒绝——v0.8.38 修） | deepseek-v4.1-flash |
| v1 | v0.8.36 | 2026-10-11 | 首稿：需求口径、判据只有一份、入队漏斗三处判定点、两个回收触发点、边界与验收点；记录「为什么不做成先建再删」 | deepseek-v4.1-flash |

---

## 1. 需求与口径

用户 2026-10-11 的要求（原话）：

> 如果点了新建文档但是没有写任何文字，也没有写标题，那么这篇文章就不要保存。哪怕创建了几个空格和换行，只要文本里看不到任何东西就不保存，包括只改动属性没写内容也不保存。

同一天确认的三条口径（`ask_user_question`）：

| 项 | 结论 |
| --- | --- |
| 什么算「写了内容」 | **可见文字 或 写了标题**。属性（标签 / 状态 / 截止 / 优先级 / 外来键）**一律不算** |
| 快速录入 | **「只填标签的快速录入」同样按不保存处理**——规则统一，不为某个入口开例外 |
| 什么时候回收 | **离开这一篇时回收 + 启动兜底扫一遍** |

一处需要点明的分寸：**「不保存」只针对「从没上传过的新建」**。已有的笔记被清空到只剩空正文，是**用户的编辑行为**，照旧保存——它是存量内容，不在本设计的管辖范围。

## 2. 改前现状（动机记录）

- `useNoteCreation.createNote` / `createTable` 建条目时，`createLocalItem` 在同一个事务里写 `items` / `bodies` / `drafts` 并**入队第一条 `create`**。
- 于是「点一下新建笔记」= 服务端立刻多一条真实条目：用户在列表里能看到它、换设备也能看到它，**即使一个字都没写、马上离开**。
- 想改成「空白就别留」有两条路：**先建再删**（建完发现是空的，再删掉）或**从不上传**。本设计选后者，理由见 §3.4。

## 3. 方案

### 3.1 判据只有一份，而且必须在数据层

判据放在 `apps/web/src/data/db/seed.ts`：

```ts
export function isBlankBody(body: string): boolean;              // 剥掉 front matter 后没有非空白字符
export function isPlaceholderTitle(title: string | null): boolean; // 空 或 仍是 "未命名笔记" / "未命名表格"
export function isBlankSeed(item: Pick<LocalItem, "title">, body: string): boolean; // 两者都成立
export async function isBlankSeedItem(item: LocalItem): Promise<boolean>;          // 自己去草稿/正文缓存取当前正文
```

三条理由：

1. **新建时决定要不要延后上传、两个入队口子决定要不要发第一条 `create`、离开时决定要不要回收——三处都调它。** 散成三份早晚会漂（v0.8.31 的教训：front matter 判据两处写法不一致，一条带 BOM 的 md 卡片读得出、编辑器却藏不住）。
2. **「空不空」只能问「有没有可见文字」**：编辑器里敲一个空格也会落成草稿，行数 / 字节数都会动。正文先过 `mdcore` 的 `stripFrontmatter` 再判，所以**「只改属性」天然不算内容**——属性全在 front matter 里，被剥掉了。
3. **读的是「草稿优先」的正文**（`getDraft` → `getCachedBody`）：刚敲的字还没进正文缓存，只看缓存会把「刚写了一行」判成空。

### 3.2 入队漏斗：决定什么时候才「真的新建」

判定写在**入队漏斗**里，不写在各个调用方（`createNote` / `createTable` / 快速录入 / 导入……）。三条路径：

| 路径 | 行为 |
| --- | --- |
| `createLocalItem(input, now)` | `input.holdWhileBlank === true` 且当场就该判空时 **只写本地三张表、不入队**（`repository.ts:472`） |
| `enqueueBodySave(itemId, baseRev, now)` | 队列里已经有 `create` → 照旧只更新 `pending`；否则先问 `holdBlankSeed`（`repository.ts:581`） |
| `enqueueMetaPatch(itemId, baseMetaRev, now)` | 先问 `holdBlankSeed`（`repository.ts:602`） |

`holdBlankSeed(item, rows, now)` 只在「`pending === "create"`（从没上传过）**且**队列里一行都没有」时才接管：

- 现在**已经有内容**（写了正文或改过标题）→ 补一条 `create`，内容随它上去。**这一步是必须的**：服务端还没有这一条，直接发 `save_body` / `patch_meta` 只会 404。
- 现在**仍然全空**（用户只动了属性）→ 什么都不发，按口径这一篇不保存。

**为什么判定必须在数据层**：失败方向不对称。判定漏了 → 用户写了东西却没上传（**丢数据**）；判定多了 → 空条目多在本地留一会儿（界面脏一点）。让每个调用方记得判，早晚有人忘。

### 3.3 回收（两个触发点）

```ts
export async function purgeBlankSeed(itemId: string): Promise<boolean>;          // data/db/seed.ts:83
export async function purgeBlankSeeds(now: number = Date.now()): Promise<string[]>; // data/db/seed.ts:98
```

- `purgeBlankSeed` **三道闸**：条目不存在或 `pending !== "create"` → 不动；该条目在 `outbox` 里**有任何行** → 不动（备份恢复的 `create`、冲突副本那次 `create` 哪怕正文空白也是真的，回收会丢东西）；仍然空白才真回收。回收走 `trash.ts` 的 `purgeLocalItems`，与永久删除同一套口径，一个事务清 `items` / `folders` / `bodies` / `drafts` / `searchIndex` / `outbox` / `conflicts` / `attachmentsMeta`——**像没建过一样**。
- `purgeBlankSeeds`：启动兜底，扫 `pending === "create"` 且建了超过 `SEED_GRACE_MS`（30 秒）的条目。**宽限期是给多标签页的**：A 标签页刚建的一篇可能正在写、草稿还没落盘，B 标签页启动一扫就把它删了；留一点时间就没有这个抢删窗口，反正离开它时还会再收一次。
- 接线在 `apps/web/src/features/notes/blankSeeds.ts`（**单独成模块**：`useNotesWorkspace.ts` 已贴着 500 行预算，而这两件事都值得带注释讲清楚）：
  - `loadFirstScreen()`：先扫一遍空白种子，再取首屏列表 + 「本地有正文」的键集合（先扫再取，列表里不会先闪一条幽灵条目）。
  - `reapBlankSeedOnLeave(previousId, currentId, changed)`：选中项被换掉的那一刻回收上一篇，**只有真删了才叫 `changed()`**（调用方据此刷新列表，否则列表里会留一条打不开的幽灵行）。`previousId === currentId` 或 `previousId === null` 直接返回。**`changed` 允许返回 Promise**（调用点写的是 `() => refresh()`），回收方 `await` 它并在末端 `.catch` 同时兜住 `purgeBlankSeed` 与 `changed` 的失败——刷新列表本来就是异步的（7 个并行查询 + 索引重建），写成 `() => void refresh()` 就是一条没人接的浮动 Promise，库被关掉时（切档 / 卸载 / 测试收尾）会以 `DatabaseClosedError` 炸成未处理拒绝（v0.8.38 修；这是「尽力而为」的收尾动作，真漏掉了由启动兜底 `purgeBlankSeeds` 再扫一遍）。
  - 调用点在 `useNotesWorkspace.ts` 的 `applySelectedId`（选中项真正落地的那一刻）——**不是**在 `open()` 的入口：`open()` 是异步的，发请求期间用户可能已经点了别的条目，在入口回收会拿一个过期的「上一篇」去删。

### 3.4 为什么不做成「先建再删」

| | 先建再删 | 从不上传（本设计） |
| --- | --- | --- |
| 网络/服务端 | 两条操作；服务端先多一条空条目，回收站还得为它留个记录 | **一条都不发**，服务端从头到尾没见过它 |
| 失败方向 | 删除失败 → 空条目永久留在服务端 | 判定漏了 → 有内容没上传（由 §3.2 的「唯一一份判据 + 只放在漏斗里」压住） |
| 状态数 | 「已建 / 待删 / 删失败」 | 只有「在本地活着的空白种子」 |

**同步引擎推得比人点得快**是选后者的直接原因：新建后不到一秒 `create` 就上线了，"先建再删"必然让服务端先看见一条空笔记。

### 3.5 边界

- **表格不受影响**：`renderTableDocument` 恒写表头行，新建表格的正文从来不是空白，天然不会被判成空白种子。
- **导入不受影响**：导入的每一篇都来自真实文件（有正文或至少有文件名标题），且走的是另一条入队路径。
- **加密空间**：判定只看「有没有可见文字」，与这篇在不在加密空间无关；回收走 `purgeLocalItems`，同一套口径。
- **多标签页**：启动清扫有 30 秒宽限期（§3.3）；两个标签页同时开着时，回收发生在**离开这一篇**的那一刻，删的是本机同一份 IndexedDB。
- **属性**：标签 / 状态 / 截止 / 优先级 / 外来键只改 `items` 派生列或 front matter，**都不算内容**——只改属性不写正文的条目按口径不保存。

## 4. 落点

| 文件 | 内容 |
| --- | --- |
| `apps/web/src/data/db/seed.ts`（新增） | 判据与回收：`DEFAULT_NOTE_TITLE` / `DEFAULT_TABLE_TITLE` / `isBlankBody` / `isPlaceholderTitle` / `isBlankSeed` / `isBlankSeedItem` / `purgeBlankSeed` / `purgeBlankSeeds` |
| `apps/web/src/data/db/repository.ts` | `NewLocalItemInput.holdWhileBlank?`；`createLocalItem` 的入队分支；私有 `holdBlankSeed`；两个 `enqueue*` 各插一处判定 |
| `apps/web/src/data/db/index.ts` | 导出 `./seed` |
| `apps/web/src/features/notes/blankSeeds.ts`（新增） | 两个接线点 `loadFirstScreen` / `reapBlankSeedOnLeave` |
| `apps/web/src/features/notes/useNotesWorkspace.ts` | 首屏加载换 `loadFirstScreen()`；`applySelectedId` 里回收上一篇 |
| `apps/web/src/features/notes/useNoteCreation.ts` | 新建笔记 / 表格两处传 `holdWhileBlank: true` |
| `apps/web/src/features/notes/import-md.ts` | `DEFAULT_NOTE_TITLE` 改从 `data/db` 取（值不变，一份定义） |
| `apps/web/test/notes-blank-seed.test.tsx`（新增） | 17 条用例（见 §5） |

## 5. 验收点

`apps/web/test/notes-blank-seed.test.tsx`（17 条，已跑绿）：

1. **判据**：空串 / 纯空白 / 只有 front matter 算空；有可见文字、含 HTML 注释不算空；占位标题的四种写法（`null` / 空串 / 两头空格 / 默认标题）都算「没写标题」。
2. **新建不落库**：新建笔记的正文为空、且 `outbox` 里**没有任何行**；快速录入只带标签时同样没有行。
3. **写内容才入队**：写了正文或改了标题之后，才出现且只出现一条 `create`。
4. **只改属性不发**：标签 / 状态 / 截止 / 优先级改完，`outbox` 仍为空。
5. **回收**：切走这一篇 → 本机条目、正文、草稿、队列、搜索索引一起消失；启动兜底能清掉上次残留的种子；**有队列行的条目一律不回收**；`pending !== "create"` 的已同步条目哪怕清空也不回收。

## 6. 不在范围 / 未验证

- **不做**：给空白种子加「保留时长」或提示；不改 `mdcore`；不加新的 outbox 操作类型；服务端零改动。
- **未验证**：真机观感（新建后立刻切换条目，列表里那一行是否**没有**闪一下）——本机没有 MeNote dev server 在跑，属人工确认项。
- 路 B（内置键值域扩展 + 归一档）与本设计无关，另开一稿。
