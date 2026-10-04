/**
 * 业务 SQL 常量（架构 §2.3.2：SQL 常量归 `db/tables.ts`）。
 *
 * 约定：
 * - 对用户数据的每个查询都带 `user_id` 条件（架构 §13.2 多用户隔离）；
 * - 服务层只做参数绑定与结果映射，**不在这里拼字符串**；
 * - 条件写（乐观锁）一律带 `rev` / `meta_rev`，并检查影响行数。
 */

// —— app_meta（实例级键值：schema_version / migration_lock / 注册开关）——

export const SQL_SELECT_APP_META = "SELECT value FROM app_meta WHERE key = ?";

export const SQL_UPSERT_APP_META =
  "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value";

// —— users ——

export const SQL_SELECT_USER_BY_USERNAME =
  "SELECT id, username, role, auth_salt, auth_kdf, auth_verifier, status FROM users WHERE username = ?";

export const SQL_SELECT_USER_BY_ID =
  "SELECT id, username, role, auth_salt, auth_kdf, auth_verifier, status FROM users WHERE id = ?";

export const SQL_COUNT_USERS = "SELECT COUNT(*) AS count FROM users";

/**
 * 注册：一条语句同时判定"库中无用户"或"注册开关开启且未到期"，并在库中无用户时写 `role = 'owner'`，
 * 避免两个并发的首次注册都成为 owner（架构 §13.1）。参数（8 个）：
 * id、username、auth_salt、auth_kdf、auth_verifier、created_at、updated_at、now(用于到期比较)。
 */
export const SQL_INSERT_USER = `INSERT INTO users (id, username, role, auth_salt, auth_kdf, auth_verifier, status, created_at, updated_at)
SELECT ?, ?, CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 'owner' ELSE 'member' END, ?, ?, ?, 'active', ?, ?
 WHERE (SELECT COUNT(*) FROM users) = 0
    OR (COALESCE((SELECT value FROM app_meta WHERE key = 'registration_open'), '0') = '1'
        AND (CAST(COALESCE((SELECT value FROM app_meta WHERE key = 'registration_close_at'), '0') AS INTEGER) = 0
             OR CAST((SELECT value FROM app_meta WHERE key = 'registration_close_at') AS INTEGER) > ?))`;

export const SQL_UPDATE_USER_PASSWORD =
  "UPDATE users SET auth_salt = ?, auth_kdf = ?, auth_verifier = ?, updated_at = ? WHERE id = ?";

// —— sessions（库里只存令牌的 SHA-256）——

export const SQL_INSERT_SESSION =
  "INSERT INTO sessions (token_hash, user_id, device_label, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)";

/** 校验会话并一次取回用户身份（1 次 D1 读，符合 §14.2 的预算） */
export const SQL_SELECT_SESSION_USER = `SELECT s.user_id AS id, u.username AS username, u.role AS role, s.expires_at AS expires_at
  FROM sessions s JOIN users u ON u.id = s.user_id
 WHERE s.token_hash = ? AND u.status = 'active'`;

/** 滑动续期：每天最多写一次（需求 §5.4） */
export const SQL_TOUCH_SESSION =
  "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ? AND last_seen_at < ?";

export const SQL_DELETE_SESSION = "DELETE FROM sessions WHERE token_hash = ?";

export const SQL_DELETE_OTHER_SESSIONS = "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?";

export const SQL_COUNT_OTHER_SESSIONS =
  "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND token_hash != ?";

// —— auth_throttle（登录失败计数；只在失败时写）——

export const SQL_SELECT_THROTTLE =
  "SELECT window_start, failures, locked_until FROM auth_throttle WHERE key = ?";

export const SQL_UPSERT_THROTTLE = `INSERT INTO auth_throttle (key, window_start, failures, locked_until)
VALUES (?, ?, ?, ?)
ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, failures = excluded.failures, locked_until = excluded.locked_until`;

export const SQL_DELETE_THROTTLE = "DELETE FROM auth_throttle WHERE key = ?";

// —— items：条件 batch 写模式（需求 §18.3 + 设计稿《同步引擎设计》§3.4）——
//
// 三条语句必须在同一个 batch 内（单事务、按序执行）：
//   ① 主写入以 rev 为条件，sync_seq 取"将要写入的值"（子查询，不推进计数器）
//   ② 正文写入挂在"主写入已生效"之上（rev + content_hash 双守卫），用 upsert 兼容正文行缺失
//   ③ 计数器只在主写入确实生效时才推进
// 判定冲突读 results[0].meta.changes；冲突时整批不产生任何改动。

/** 预检读：存在性 + 当前版本与哈希（batch 之前的 1 次读） */
export const SQL_SELECT_ITEM_REV = "SELECT rev, content_hash FROM items WHERE id = ? AND user_id = ?";

/** 预检读：仅哈希（新建时判断是否重放） */
export const SQL_SELECT_ITEM_HASH = "SELECT content_hash FROM items WHERE id = ? AND user_id = ?";

/** 新建：`NOT EXISTS` 只判 id（id 是全局主键；带 user_id 会在他人占用时撞主键异常） */
export const SQL_INSERT_ITEM = `INSERT INTO items (id, user_id, type, folder_id, title, enc_self, in_enc_space, size_bytes, content_hash, tags, memo_at, is_task, task_status, task_due, task_priority, pinned, starred, rev, meta_rev, sealed_rev, sync_seq, created_at, updated_at, last_edit_at, last_device, deleted_at)
SELECT ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NULL, (SELECT sync_seq + 1 FROM users WHERE id = ?), ?, ?, ?, ?, NULL
 WHERE NOT EXISTS (SELECT 1 FROM items WHERE id = ?)`;

/**
 * 新建路径的计数器推进：以"本次创建的那一行"为条件（读的是 +1，推进后与行上写的值一致）。
 *
 * 安全说明：外层 `UPDATE users` 已由第一个 `id = ?` 限定为**调用者自己**，所以 `EXISTS` 子查询里
 * 不必再带 `user_id`。极端情况下（另一个用户恰好占用了同一个 id 且 rev/created_at 吻合）最多让
 * 调用者自己的 `sync_seq` 空推一次——游标取自实际返回行，不受影响。**不要为了"看起来更严"去加
 * `user_id`**：那会让 `EXISTS` 在正常路径上也恒假，计数器不再推进。
 */
export const SQL_BUMP_SYNC_SEQ_ON_ITEM_CREATE = `UPDATE users SET sync_seq = sync_seq + 1
 WHERE id = ? AND EXISTS (SELECT 1 FROM items WHERE id = ? AND rev = 1 AND created_at = ?)`;

/** 正文保存的主写入（rev 条件） */
export const SQL_UPDATE_ITEM_BODY = `UPDATE items
   SET rev = rev + 1, size_bytes = ?, content_hash = ?, updated_at = ?, last_edit_at = ?, last_device = ?,
       sync_seq = (SELECT sync_seq + 1 FROM users WHERE id = ?)
 WHERE id = ? AND user_id = ? AND rev = ?`;

/** 正文 upsert：守卫为 rev + content_hash（只判 rev 会被并发落败者覆盖） */
export const SQL_UPSERT_ITEM_BODY = `INSERT INTO item_bodies (item_id, body)
SELECT ?, ?
 WHERE EXISTS (SELECT 1 FROM items WHERE id = ? AND user_id = ? AND rev = ? AND content_hash = ?)
ON CONFLICT(item_id) DO UPDATE SET body = excluded.body`;

/** 正文保存的计数器推进（守卫与上面一致） */
export const SQL_BUMP_SYNC_SEQ_ON_ITEM_BODY = `UPDATE users SET sync_seq = sync_seq + 1
 WHERE id = ? AND EXISTS (SELECT 1 FROM items WHERE id = ? AND rev = ? AND content_hash = ?)`;

export const SQL_SELECT_ITEM_BODY = `SELECT i.content_hash AS content_hash, b.body AS body
  FROM items i JOIN item_bodies b ON b.item_id = i.id
 WHERE i.id = ? AND i.user_id = ?`;

export const SQL_SELECT_ITEM_META_REV = "SELECT meta_rev FROM items WHERE id = ? AND user_id = ?";

/** 元数据补丁前的预检：需要知道类型（Memo 才允许无标题）与当前 meta_rev */
export const SQL_SELECT_ITEM_META_BASE =
  "SELECT type, meta_rev, enc_self, in_enc_space FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NULL";

/** 元数据补丁允许更新的列（白名单；列名一律来自常量，绝不来自请求） */
export type ItemMetaField =
  | "title"
  | "folder_id"
  | "tags"
  | "pinned"
  | "starred"
  | "enc_self"
  | "in_enc_space"
  /** **单向**类型变更（只允许 table → note；服务层已校验，见 `patchItemMeta`） */
  | "type";

/** 组装元数据补丁语句：`SET` 子句由白名单列拼出（服务层不写 SQL 字面量） */
export function buildUpdateItemMeta(fields: readonly ItemMetaField[]): string {
  const sets = fields.map((field) => `${field} = ?`).join(", ");
  return `UPDATE items SET ${sets}, meta_rev = meta_rev + 1, updated_at = ?,
       sync_seq = (SELECT sync_seq + 1 FROM users WHERE id = ?)
 WHERE id = ? AND user_id = ? AND meta_rev = ?`;
}

/** 元数据补丁的计数器推进：用 `updated_at = 本次时间` 收紧守卫（元数据没有哈希可比） */
export const SQL_BUMP_SYNC_SEQ_ON_ITEM_META = `UPDATE users SET sync_seq = sync_seq + 1
 WHERE id = ? AND EXISTS (SELECT 1 FROM items WHERE id = ? AND meta_rev = ? AND updated_at = ?)`;

// —— folders ——

export const SQL_SELECT_FOLDER_BY_ID =
  "SELECT id, parent_id, depth, meta_rev, is_enc_space, in_enc_space FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL";

export const SQL_COUNT_FOLDER_CHILDREN =
  "SELECT COUNT(*) AS count FROM folders WHERE user_id = ? AND parent_id = ? AND deleted_at IS NULL";

/**
 * 新建文件夹：ID 由客户端生成，depth 由服务层按父节点算好传入。
 *
 * `in_enc_space`（M3-8）也由**服务层按父节点推导**：父在空间里，新文件夹就在空间里——
 * 不让客户端随便指定，避免出现"父在空间、子不在"的裂缝。
 */
export const SQL_INSERT_FOLDER = `INSERT INTO folders (id, user_id, parent_id, is_enc_space, in_enc_space, name, depth, position, meta_rev, sync_seq, created_at, updated_at, deleted_at)
SELECT ?, ?, ?, 0, ?, ?, ?, 0, 1, (SELECT sync_seq + 1 FROM users WHERE id = ?), ?, ?, NULL
 WHERE NOT EXISTS (SELECT 1 FROM folders WHERE id = ?)`;

export const SQL_BUMP_SYNC_SEQ_ON_FOLDER_CREATE = `UPDATE users SET sync_seq = sync_seq + 1
 WHERE id = ? AND EXISTS (SELECT 1 FROM folders WHERE id = ? AND meta_rev = 1 AND created_at = ?)`;

/** 文件夹补丁允许更新的列（白名单） */
export type FolderField = "name" | "parent_id" | "depth" | "in_enc_space";

export function buildUpdateFolder(fields: readonly FolderField[]): string {
  const sets = fields.map((field) => `${field} = ?`).join(", ");
  return `UPDATE folders SET ${sets}, meta_rev = meta_rev + 1, updated_at = ?,
       sync_seq = (SELECT sync_seq + 1 FROM users WHERE id = ?)
 WHERE id = ? AND user_id = ? AND meta_rev = ? AND deleted_at IS NULL`;
}

export const SQL_BUMP_SYNC_SEQ_ON_FOLDER_META = `UPDATE users SET sync_seq = sync_seq + 1
 WHERE id = ? AND EXISTS (SELECT 1 FROM folders WHERE id = ? AND meta_rev = ? AND updated_at = ?)`;

// —— 增量拉取（架构 §6.1、设计稿《同步引擎设计》§3.2/§3.3）——
//
// 只回元数据、不含正文；按 sync_seq 升序；每类多取 1 行用于判断 has_more（LIMIT = 上限 + 1）。

export const SQL_SELECT_USER_TOMBSTONE_FLOOR =
  "SELECT tombstone_floor FROM users WHERE id = ?";

// —— attachments / pending_uploads / r2_gc_queue（0004；M4-4）——

/** 附件按身份取：`(user_id, sha256, kind)` 是它的身份（缩略图沿用原图的哈希） */
export const SQL_SELECT_ATTACHMENT_BY_SHA = `SELECT id, r2_key, parent_id, size_bytes
  FROM attachments WHERE user_id = ? AND sha256 = ? AND kind = ?`;

/**
 * 插附件行。**`INSERT OR IGNORE`**：同一文件重复上传时靠唯一索引
 * `(user_id, sha256, kind)` 挡住，已有的行一字不动（`created_at` 不能被改写，
 * 否则"谁先传的"就乱了）。
 */
export const SQL_INSERT_ATTACHMENT = `INSERT OR IGNORE INTO attachments
  (id, user_id, kind, parent_id, sha256, r2_key, mime, size_bytes, width, height, filename, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** 引用：同一条目 + 同一附件只记一次（`version_id` 为 NULL 表示"当前稿引用"） */
export const SQL_INSERT_ATTACHMENT_REF = `INSERT OR IGNORE INTO attachment_refs
  (item_id, version_id, attachment_id, created_at) VALUES (?, ?, ?, ?)`;

/**
 * 清掉某条目的「当前稿引用」（M6 第一批 · 批 2a）。
 *
 * `version_id IS NULL` 才是当前稿——**历史版本的引用不能动**：它们代表「某个已封存版本
 * 引用过这些附件」，删了会让那些版本回滚时缺图。
 *
 * 经 `items` 子查询限定归属：`attachment_refs` 没有 `user_id` 列（与 `permanentDeleteItems`
 * 里那两条同理由），直接按 `item_id` 删在 id 撞车时会跨租户。
 */
export const SQL_DELETE_ITEM_DRAFT_REFS = `DELETE FROM attachment_refs
 WHERE version_id IS NULL AND item_id IN (
  SELECT id FROM items WHERE user_id = ? AND id = ?
)`;

/**
 * 按 sha256 列表写入「当前稿引用」（M6 第一批 · 批 2a）。
 *
 * 三处讲究：
 * 1. **`kind = 'original'`**：原图与缩略图**两行共用同一个 sha256**（finalize 会各插一行，
 *    缩略图用 `parent_id` 指回原图）。不过滤就会把引用也挂到缩略图上，孤儿判定随之失真。
 * 2. **`json_each(?)`**：整个数组压成**一个**绑定参数。逐行绑定的话，一篇带几十张图的
 *    笔记会把 D1 单条语句的绑定参数顶爆（D1 的上限比 SQLite 严）。同时也就让
 *    `POST /api/batch` 里同一个 op 携带引用时不吃参数预算。
 * 3. **查不到的 sha 天然跳过**（`IN` 不匹配）：宁可少一条引用（后续 30 天清理），
 *    也不要因为一条坏引用把整个保存打回——正文里那个图仍能按 sha 下载。
 */
export const SQL_INSERT_ITEM_DRAFT_REFS = `INSERT OR IGNORE INTO attachment_refs
  (item_id, version_id, attachment_id, created_at)
  SELECT ?, NULL, a.id, ? FROM attachments a
   WHERE a.user_id = ? AND a.kind = 'original'
     AND a.sha256 IN (SELECT value FROM json_each(?))`;

export const SQL_SELECT_ATTACHMENT_REFS = `SELECT attachment_id, version_id
  FROM attachment_refs WHERE item_id = ?`;

export const SQL_DELETE_ATTACHMENT = "DELETE FROM attachments WHERE id = ? AND user_id = ?";

/**
 * 附件管理页的列表（M6 批 2c）：本用户的全部附件，`kind` / `state` 可选，按 `updated_at` 倒序。
 *
 * 三处刻意的写法：
 * 1. **`user_id` 必带**：附件表没有别的隔离手段，漏一个 `WHERE` 就是跨租户泄漏。
 * 2. **两个过滤参数各绑两次**（`? = '' OR 列 = ?`）：这样"不筛选"与"筛选"是**同一条语句**，
 *    不必在服务层拼不同的 SQL 文本——拼文本就意味着过滤值有机会变成语句的一部分。
 * 3. **引用条目数用相关子查询**而不是 `LEFT JOIN … GROUP BY`：`attachment_refs` 的唯一索引是
 *    `(item_id, IFNULL(version_id,''), attachment_id)`，去重要按 `item_id` 而不是按引用行，
 *    子查询里一句 `COUNT(DISTINCT r.item_id)` 就够了，也不用把 `attachments` 按引用分组。
 *
 * `LIMIT ?` 绑的是 **`limit + 1`**：`has_more` 由此判定（多一行就说明还有下一页），
 * 多取的那行在服务层裁掉，不进响应。
 */
export const SQL_SELECT_ATTACHMENTS_OF_USER = `SELECT a.id, a.sha256, a.kind, a.filename, a.mime, a.size_bytes,
       a.width, a.height, a.created_at, a.updated_at, a.orphaned_at,
       (SELECT COUNT(DISTINCT r.item_id) FROM attachment_refs r WHERE r.attachment_id = a.id) AS ref_count
  FROM attachments a
 WHERE a.user_id = ?
   AND (? = '' OR a.kind = ?)
   AND (? = '' OR (CASE WHEN a.orphaned_at IS NULL THEN 'active' ELSE 'orphaned' END) = ?)
 ORDER BY a.updated_at DESC, a.id DESC
 LIMIT ?`;

/** 上传登记：上传前先写（24 小时有效），落元数据时删 */
export const SQL_INSERT_PENDING_UPLOAD = `INSERT INTO pending_uploads (r2_key, user_id, created_at, due_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (r2_key) DO UPDATE SET due_at = excluded.due_at, created_at = excluded.created_at`;

export const SQL_DELETE_PENDING_UPLOAD = "DELETE FROM pending_uploads WHERE r2_key = ?";

export const SQL_SELECT_PENDING_UPLOAD =
  "SELECT r2_key, due_at FROM pending_uploads WHERE r2_key = ?";

/**
 * 标记孤儿：**没有任何引用**的附件置 `orphaned_at`。
 *
 * 注意"回收站里的条目"仍算引用（`attachment_refs` 行还在）——所以这里只按引用表判定，
 * 与《M4 设计》§5.1「条目删除不动 attachment_refs」是一致的。
 */
export const SQL_MARK_ORPHANS_OF_USER = `UPDATE attachments SET orphaned_at = ?, updated_at = ?
  WHERE user_id = ? AND orphaned_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM attachment_refs r WHERE r.attachment_id = attachments.id)`;

/** 到期的孤儿（标满保留期）：单个用户 / 全部用户两个版本，前者给手动 GC，后者给每日维护 */
export const SQL_SELECT_ORPHANED_DUE = `SELECT id, r2_key, user_id FROM attachments
  WHERE user_id = ? AND orphaned_at IS NOT NULL AND orphaned_at + (? * ?) <= ?`;

export const SQL_SELECT_ORPHANED_DUE_ALL = `SELECT id, r2_key, user_id FROM attachments
  WHERE orphaned_at IS NOT NULL AND orphaned_at + (? * ?) <= ?`;

/*
  —— 孤儿附件「立即删除」（v0.8.3）——
  两条**只看"在用"这个判定、不过问保留期**。注意它们**没有** `orphaned_at IS NOT NULL`：
  立即删除的语义是"不等了"，所以连"标没标过"都不要求——直接删掉没被任何条目引用的那些。
  （而 `SQL_MARK_ORPHANS_OF_USER` 那条仍然要 `orphaned_at IS NULL`，那是"盖戳"的前提。）
*/

/**
 * 预告：能被立即删掉多少个 / 多少字节。
 *
 * **`within_retention` 单独数"其中还在保留期里"的那部分**——界面要拿它告诉用户
 * "其中 N 个你本来还有 30 天补救窗口，这次一并放弃"。
 *
 * 口径与服务端标记孤儿**完全一致**（同一个 `NOT EXISTS(attachment_refs)`），
 * 不复用列表：列表是截断的（上限 200 行），拿它算"不可撤销的删除影响多少"会少报。
 */
export const SQL_PURGE_PLAN_OF_USER = `SELECT
    COUNT(*) AS count,
    COALESCE(SUM(size_bytes), 0) AS bytes,
    COALESCE(SUM(CASE WHEN orphaned_at IS NOT NULL AND orphaned_at + (? * ?) > ? THEN 1 ELSE 0 END), 0)
      AS within_retention
  FROM attachments
  WHERE user_id = ?
    AND NOT EXISTS (SELECT 1 FROM attachment_refs r WHERE r.attachment_id = attachments.id)`;

/**
 * 真删要取的行。
 *
 * **`NOT EXISTS` 在这里再判一次**是刻意的：预告与删除之间可能隔着几秒，用户可能刚好
 * 把附件重新插进某篇笔记。**删除时重新判定，才不会出现"刚插回去就被删了"。**
 */
export const SQL_SELECT_PURGEABLE_OF_USER = `SELECT id, r2_key, size_bytes FROM attachments
  WHERE user_id = ?
    AND NOT EXISTS (SELECT 1 FROM attachment_refs r WHERE r.attachment_id = attachments.id)`;

/**
 * 按 id 删单行**并要求它此刻仍是无引用**。
 *
 * `changes === 0` 表示"它在我们取出来到删它之间被重新引用了" —— 那一行**必须留着**。
 */
export const SQL_DELETE_UNREFERENCED_ATTACHMENT = `DELETE FROM attachments
  WHERE id = ? AND user_id = ?
    AND NOT EXISTS (SELECT 1 FROM attachment_refs r WHERE r.attachment_id = attachments.id)`;


/** R2 待删队列：同一把键可能被"删除"与"孤儿"两条路径登记，用 `INSERT OR IGNORE` 保早的那次 */
export const SQL_INSERT_R2_GC = `INSERT OR IGNORE INTO r2_gc_queue
  (r2_key, user_id, reason, due_at, created_at) VALUES (?, ?, ?, ?, ?)`;

// —— item_versions（0004；M4-5）——

/** 插版本元数据（正文在 R2，不在库里） */
export const SQL_INSERT_VERSION = `INSERT INTO item_versions
  (id, item_id, user_id, rev, reason, label, keep, codec, size_bytes, content_hash, title, r2_key, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** 最近一个版本：**去重**（`content_hash` 相同就不生成新版本）与稀疏化都要看它 */
export const SQL_SELECT_LATEST_VERSION = `SELECT id, content_hash, created_at, keep, reason
  FROM item_versions WHERE user_id = ? AND item_id = ?
  ORDER BY created_at DESC, id DESC LIMIT 1`;

/** 版本列表（新的在前；游标是 `created_at`，同一毫秒用 id 兜底排序稳定） */
export const SQL_SELECT_VERSIONS_PAGE = `SELECT id, rev, reason, label, keep, codec, size_bytes,
    content_hash, title, created_at
  FROM item_versions WHERE user_id = ? AND item_id = ? AND created_at < ?
  ORDER BY created_at DESC, id DESC LIMIT ?`;

export const SQL_SELECT_VERSION_BY_ID = `SELECT id, item_id, user_id, rev, reason, label, keep,
    codec, size_bytes, content_hash, title, r2_key, created_at
  FROM item_versions WHERE id = ? AND user_id = ?`;

export const SQL_SET_VERSION_KEEP = "UPDATE item_versions SET keep = ? WHERE id = ? AND user_id = ?";

export const SQL_DELETE_VERSION = "DELETE FROM item_versions WHERE id = ? AND user_id = ?";

/** 该条目的版本总数与"可删的非 keep 版本"（稀疏化按条数裁剪时用） */
export const SQL_COUNT_VERSIONS =
  "SELECT COUNT(*) AS n FROM item_versions WHERE user_id = ? AND item_id = ?";

export const SQL_SELECT_OLDEST_REMOVABLE = `SELECT id, r2_key, created_at FROM item_versions
  WHERE user_id = ? AND item_id = ? AND keep = 0
  ORDER BY created_at ASC, id ASC LIMIT ?`;

/** 稀疏化的候选（旧的在前）：`keep = 0` 且**不是手动版本**——手动版本默认 `keep = 1`，
 *  但仍显式排掉一次，免得将来 `keep` 被用户关掉后把"手动存的"删了 */
export const SQL_SELECT_SWEEP_CANDIDATES = `SELECT id, r2_key, created_at, reason FROM item_versions
  WHERE user_id = ? AND item_id = ? AND keep = 0`;

/** 每日维护：按游标扫有版本的条目（分批，避免一次拉全表） */
export const SQL_SELECT_ITEMS_WITH_VERSIONS = `SELECT DISTINCT item_id, user_id FROM item_versions
  WHERE (created_at, id) > (?, ?) ORDER BY created_at ASC, id ASC LIMIT ?`;

/**
 * `session` 封存前的预检（设计 §4.1）：一次读拿到**旧正文 + 它的元数据 + 上次编辑信息**。
 *
 * 与 `SQL_SELECT_ITEM_REV` 分开是因为这里要多读正文与 `last_edit_at` / `last_device`，
 * 而预检那条在每次写入（含幂等重放）上都会走，不该为按小时才触发一次的判断加负担。
 *
 * `item_bodies` 用**内连接**：没有正文行的条目（刚建、或正文行缺失）查不出结果，
 * 调用方据此跳过封存——不给刚建的条目封一条空版本。
 */
export const SQL_SELECT_ITEM_VERSION_BASE = `SELECT i.rev AS rev, i.title AS title,
    i.content_hash AS content_hash, i.size_bytes AS size_bytes,
    i.last_edit_at AS last_edit_at, i.last_device AS last_device, b.body AS body
  FROM items i JOIN item_bodies b ON b.item_id = i.id
  WHERE i.id = ? AND i.user_id = ? AND i.deleted_at IS NULL`;

/**
 * idle 兜底封存的候选：**停编辑超过 N 分钟**、且**比最后一个版本还新**（否则会把同一份内容反复封存）。
 *
 * `item_bodies` 里是当前正文——服务端封存要自己读它（此刻客户端已经走了）。
 * 没有版本时 `COALESCE(..., 0)` 让条件成立，所以"从没封存过"也算候选。
 */
export const SQL_SELECT_IDLE_SEAL_CANDIDATES = `SELECT i.id AS item_id, i.user_id AS user_id,
    i.rev AS rev, i.title AS title, i.content_hash AS content_hash, i.size_bytes AS size_bytes,
    b.body AS body
  FROM items i JOIN item_bodies b ON b.item_id = i.id
  WHERE i.deleted_at IS NULL
    AND i.last_edit_at IS NOT NULL AND i.last_edit_at <= ?
    AND i.last_edit_at > COALESCE(
      (SELECT MAX(v.created_at) FROM item_versions v WHERE v.item_id = i.id AND v.user_id = i.user_id), 0)
  ORDER BY i.last_edit_at ASC LIMIT ?`;

// —— tombstones（0004；M4-7）——

/** 增量拉取墓碑：与条目/文件夹同一套"从游标之后、按序号升序、多取一行探截断"的写法 */
export const SQL_SELECT_TOMBSTONES_SINCE = `SELECT entity, entity_id, sync_seq, deleted_at
  FROM tombstones WHERE user_id = ? AND sync_seq > ? ORDER BY sync_seq ASC LIMIT ?`;

/**
 * 写墓碑：**同一次删除只留一条**（`(user, entity, entity_id)` 唯一）。
 *
 * 用 `INSERT ... ON CONFLICT DO UPDATE` 而不是 `INSERT OR IGNORE`：
 * 键被删两次（先永久删、后被恢复又删）时，墓碑要跟着**更新到新的 `sync_seq`**，
 * 否则第二次删除传不出去（客户端游标已经越过旧序号）。
 */
export const SQL_UPSERT_TOMBSTONE = `INSERT INTO tombstones (user_id, entity, entity_id, sync_seq, deleted_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (user_id, entity, entity_id)
  DO UPDATE SET sync_seq = excluded.sync_seq, deleted_at = excluded.deleted_at`;

/** 每日维护：清理 180 天前的墓碑（配合推进 `tombstone_floor`） */
export const SQL_DELETE_OLD_TOMBSTONES =
  "DELETE FROM tombstones WHERE user_id = ? AND deleted_at < ?";

/** 每日维护：把 floor 推到"当前**最小**剩余墓碑序号"，没有剩余则推到当前 `sync_seq` */
export const SQL_SELECT_MIN_TOMBSTONE_SEQ =
  "SELECT MIN(sync_seq) AS seq FROM tombstones WHERE user_id = ?";

export const SQL_SELECT_ITEMS_SINCE = `SELECT id, type, folder_id, title, enc_self, in_enc_space, size_bytes,
       content_hash, tags, memo_at, is_task, task_status, task_due, task_priority, pinned, starred,
       rev, meta_rev, sealed_rev, sync_seq, created_at, updated_at, last_edit_at, last_device, deleted_at
  FROM items
 WHERE user_id = ? AND sync_seq > ?
 ORDER BY sync_seq
 LIMIT ?`;

export const SQL_SELECT_FOLDERS_SINCE = `SELECT id, parent_id, is_enc_space, in_enc_space, name, depth,
       position, meta_rev, sync_seq, created_at, updated_at, deleted_at
  FROM folders
 WHERE user_id = ? AND sync_seq > ?
 ORDER BY sync_seq
 LIMIT ?`;

// —— user_settings（M2-7：跟随账号同步的设置，整份覆盖、后写为准） ——

export const SQL_SELECT_USER_SETTINGS =
  "SELECT json, rev, sync_seq, updated_at FROM user_settings WHERE user_id = ?";

/** 行上的 `sync_seq` 与其它表同规则：取用户计数器的下一个值，随后统一推进计数器 */
export const SQL_UPSERT_USER_SETTINGS = `INSERT INTO user_settings (user_id, json, rev, sync_seq, updated_at)
  VALUES (?, ?, 1, (SELECT sync_seq + 1 FROM users WHERE id = ?), ?)
  ON CONFLICT(user_id) DO UPDATE SET
    json = excluded.json,
    rev = user_settings.rev + 1,
    sync_seq = excluded.sync_seq,
    updated_at = excluded.updated_at`;

export const SQL_BUMP_SYNC_SEQ_ON_SETTINGS = "UPDATE users SET sync_seq = sync_seq + 1 WHERE id = ?";

// —— user_crypto（M3：隐私锁的门禁材料；《隐私锁设计》§4）——
//
// **不加 `sync_seq`**：门禁材料走专用端点，不参与普通同步载荷（《同步引擎设计》§7 第 6 条）。
// BLOB 的打包约定见 `@menote/shared` 的 `crypto.ts`。

export const SQL_SELECT_USER_CRYPTO = `SELECT kdf, kdf_iterations, kdf_salt, verifier,
       k_wrapped_pw, k_wrapped_backup, rev, updated_at
  FROM user_crypto
 WHERE user_id = ?`;

/** 启用 / 改密 / 重置后的整体覆盖；`rev` 自增（后写为准，与设置同一口径） */
export const SQL_UPSERT_USER_CRYPTO = `INSERT INTO user_crypto (user_id, kdf, kdf_iterations, kdf_salt, verifier, k_wrapped_pw, k_wrapped_backup, rev, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    kdf = excluded.kdf,
    kdf_iterations = excluded.kdf_iterations,
    kdf_salt = excluded.kdf_salt,
    verifier = excluded.verifier,
    k_wrapped_pw = excluded.k_wrapped_pw,
    k_wrapped_backup = excluded.k_wrapped_backup,
    rev = user_crypto.rev + 1,
    updated_at = excluded.updated_at`;

export const SQL_DELETE_USER_CRYPTO = "DELETE FROM user_crypto WHERE user_id = ?";

/** 关闭隐私锁前的校验：**含回收站里的条目**（软删行仍带标记） */
export const SQL_COUNT_PRIVACY_ITEMS =
  "SELECT COUNT(*) AS count FROM items WHERE user_id = ? AND (enc_self = 1 OR in_enc_space = 1)";

// —— 加密空间内置行（M3：《隐私锁设计》§6）——
//
// 未启用隐私锁时空间也要照常显示，所以这行在**注册与登录时**幂等补建（覆盖 M1/M2 存量账号）。
// 并发补建由部分唯一索引 `idx_folders_enc_space` 兜底，服务层捕获约束异常后重读。

export const SQL_SELECT_ENC_SPACE =
  "SELECT id, name, meta_rev FROM folders WHERE user_id = ? AND is_enc_space = 1";

export const SQL_INSERT_ENC_SPACE = `INSERT INTO folders (id, user_id, parent_id, is_enc_space, in_enc_space, name, depth, position, meta_rev, sync_seq, created_at, updated_at, deleted_at)
SELECT ?, ?, NULL, 1, 0, ?, 0, 0, 1, (SELECT sync_seq + 1 FROM users WHERE id = ?), ?, ?, NULL
 WHERE NOT EXISTS (SELECT 1 FROM folders WHERE user_id = ? AND is_enc_space = 1)`;

export const SQL_DELETE_APP_META = "DELETE FROM app_meta WHERE key = ?";

export const SQL_BUMP_SYNC_SEQ_ON_ENC_SPACE = `UPDATE users SET sync_seq = sync_seq + 1
 WHERE id = ? AND EXISTS (SELECT 1 FROM folders WHERE id = ? AND is_enc_space = 1 AND created_at = ?)`;

// —— 分享（M5-S1；架构 §十）——
//
// 创建走 INSERT … SELECT 同语句校验（架构定稿："服务端在同一语句中校验条目非隐私条目、
// 未删除，不满足则拒绝"）：条目不存在 / 已删 / enc_self / in_enc_space 任一命中，changes = 0。
// 密码材料三列只在创建与改密时写入，任何 SELECT 不回显。

export const SQL_INSERT_SHARE = `INSERT INTO shares (id, user_id, kind, item_id, title, pw_salt, pw_kdf, pw_verifier, expires_at, created_at, revoked_at)
SELECT ?, ?, 'item', ?, NULL, ?, ?, ?, ?, ?, NULL
 FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND enc_self = 0 AND in_enc_space = 0`;

/**
 * 条目进入「不可分享」状态时，**连带撤销它的分享**（M6 第一批；用户 2026-10-03 拍板）。
 *
 * 为什么服务端要做：访客侧只做**实时检查**（撤销 / 过期 / 已删 / 已加密），不记得这条分享
 * 曾经因为什么死过一次——所以条目一旦从回收站恢复、或取消单篇加密，链接就会**复活**，
 * 与需求 §16.1「从回收站恢复后分享不会自动恢复，需要重新创建」冲突。真正的兜底曾落在
 * 客户端 `revokeItemShares` 的行清理上，但那段每个 revoke 都被 try/catch 吞掉，且**在另一台
 * 设备上恢复条目时根本不会跑**。这里把它变成服务端的一次写入，正确性不再依赖客户端。
 *
 * `revoked_at IS NULL` 保证幂等：已撤销的不重复写、不推进任何时间戳。
 * **不推 `sync_seq`**：撤销是服务端行的状态、所有设备共享同一份 `shares`，下次打开
 * 「我的分享」自然看到最新值——不像条目正文那样需要跨设备同步。
 */
export const SQL_REVOKE_ITEM_SHARES =
  "UPDATE shares SET revoked_at = ? WHERE item_id = ? AND user_id = ? AND revoked_at IS NULL";

/** 实时有效性检查的数据源：分享行 + 条目侧的删除与隐私标记（LEFT JOIN，缺行也要能判失效） */
export const SQL_SELECT_SHARE_FULL = `SELECT s.id, s.user_id, s.kind, s.item_id, s.title, s.pw_salt, s.pw_kdf, s.pw_verifier, s.expires_at, s.created_at, s.revoked_at, i.id AS item_row_id, i.title AS item_title, i.type AS item_type, i.deleted_at AS item_deleted_at, i.enc_self AS item_enc_self, i.in_enc_space AS item_in_enc_space
 FROM shares s LEFT JOIN items i ON i.id = s.item_id WHERE s.id = ?`;

/** 「我的分享」：只列未撤销的；条目标题随行带出（回显给创建者，不涉密） */
export const SQL_SELECT_SHARES_BY_USER = `SELECT s.id, s.kind, s.item_id, s.title, (s.pw_verifier IS NOT NULL) AS has_password, s.expires_at, s.created_at, s.revoked_at, i.title AS item_title, i.type AS item_type
 FROM shares s LEFT JOIN items i ON i.id = s.item_id WHERE s.user_id = ? AND s.revoked_at IS NULL ORDER BY s.created_at DESC`;

export const SQL_UPDATE_SHARE_EXPIRY =
  "UPDATE shares SET expires_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL";

export const SQL_UPDATE_SHARE_PASSWORD =
  "UPDATE shares SET pw_salt = ?, pw_kdf = ?, pw_verifier = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL";

export const SQL_UPDATE_SHARE_CLEAR_PASSWORD =
  "UPDATE shares SET pw_salt = NULL, pw_kdf = NULL, pw_verifier = NULL WHERE id = ? AND user_id = ? AND revoked_at IS NULL";

export const SQL_REVOKE_SHARE =
  "UPDATE shares SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL";

/** 分享正文：item_bodies 按 item_id 主键一行（当前稿），标题与类型取条目行 */
export const SQL_SELECT_SHARE_BODY = `SELECT b.body, i.id AS item_id, i.type, i.title, i.updated_at, i.user_id
 FROM item_bodies b JOIN items i ON i.id = b.item_id WHERE b.item_id = ?`;

/** 公开附件只按「原图行」放行：键在 attachments.r2_key，mime / filename 决定响应头 */
export const SQL_SELECT_ATTACHMENT_FOR_SHARE =
  "SELECT r2_key, mime, filename FROM attachments WHERE user_id = ? AND sha256 = ? AND kind = 'original'";
