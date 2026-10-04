/**
 * 内容完整性的上限与默认值（M4；《M4 设计》§八【本文定稿】）。
 *
 * **放共享包**是因为这些值两端都要用，而且必须一致：
 * - 客户端要按它们**校验与压缩**（缩略图最长边、目标体积、附件大小）；
 * - 服务端要按它们**复核与裁剪**（DB CHECK、版本条数、保留期、每批删除量）；
 * - 设置页要按它们**给出可选范围**（版本条数 20–500）。
 *
 * 服务端**不信任**客户端传来的尺寸与体积，但两边算的是同一套阈值——不一致会导致"客户端说行、
 * 服务端说不行"这种最难查的问题，所以只有这一处。
 */
import * as v from "valibot";

/** 单附件硬上限（与 `attachments.size_bytes` 的 CHECK 一致） */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** 缩略图最长边（浏览器端生成，WebP） */
export const THUMBNAIL_MAX_EDGE = 400;

/**
 * 缩略图目标体积：超了就**降质量**再编码，**不拒绝上传**（设计 §八）。
 * 真压不下去也照传——宁可大一点，也不要让用户"传不上去"。
 */
export const THUMBNAIL_TARGET_BYTES = 40 * 1024;

/** 每条笔记保留的版本数：默认值 + **可选范围**（契约校验与设置页同源，不再各写一份） */
export const VERSIONS_DEFAULT = 100;
export const VERSIONS_KEEP_MIN = 20;
export const VERSIONS_KEEP_MAX = 500;

/** 版本正文超过这个体积就用 `codec='none'`（不再 gzip——大文件再压收益低、耗 CPU） */
export const VERSION_GZIP_MAX_BYTES = 256 * 1024;

/** 回收站保留天数（默认，设置可改） */
export const TRASH_RETENTION_DAYS_DEFAULT = 30;

/** 附件被标为孤儿后保留多少天再删（设计 §八） */
export const ATTACHMENT_ORPHAN_RETENTION_DAYS = 30;

/** 上传登记的有效期：超过它还没落元数据，就视为孤儿（设计 §六 表 6） */
export const PENDING_UPLOAD_TTL_HOURS = 24;

/** 墓碑保留天数：到期清理并推进 `users.tombstone_floor`（架构 §12.3） */
export const TOMBSTONE_RETENTION_DAYS = 180;

/** 永久删除每批条数（客户端；单请求 ≤45 语句的约束下取 10） */
export const PERMANENT_DELETE_BATCH = 10;

/** 每日维护里 R2 GC 与快照队列的单轮配额（架构 §12.1 的任务顺序与配额） */
export const JOB_R2_GC_BATCH = 20;
export const JOB_SWEEP_BATCH = 10;
export const JOB_IDLE_SEAL_BATCH = 3;

/**
 * Cron ③「快照物化」的单轮文件配额（M7 第 4 项 批 2）。
 *
 * 沿用架构 §12.1 给"快照队列"定的 10 个/轮——`JOB_SWEEP_BATCH` 就是那 10 的旧名，
 * 这里给一个能读懂的名字，两处指向同一个值（`JOB_SNAPSHOT_BATCH = JOB_SWEEP_BATCH`）。
 * 物化是**增量**的（只做 `sync_seq` 落在游标之后的），所以 10/轮 × 96 轮/天
 * ≈ 960 文件/天，追上一个几百条的库只要一两轮。
 */
export const JOB_SNAPSHOT_BATCH = JOB_SWEEP_BATCH;

/** 天 → 毫秒（各处保留期都用它换算，避免各写一遍 `* 24 * 60 * 60 * 1000`） */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** 附件的三种客户端请求形状（M4-4；服务端与客户端共用同一份校验） */

/** `POST /api/attachments/check`：客户端算出哈希与大小后先问一句"传过没有" */
export const AttachmentCheckSchema = v.object({
  sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/i)),
  size: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_ATTACHMENT_BYTES)),
  /** 缺省 = 原图 */
  kind: v.optional(v.picklist(["original", "thumb"])),
});
export type AttachmentCheck = v.InferOutput<typeof AttachmentCheckSchema>;

/** 缩略图那一行的元数据（浏览器端生成，设计 §3.3） */
export const AttachmentThumbSchema = v.object({
  size: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_ATTACHMENT_BYTES)),
  mime: v.nullable(v.string()),
  width: v.nullable(v.number()),
  height: v.nullable(v.number()),
});

/** `POST /api/attachments/finalize`：落元数据（原图 + 可选的缩略图 + 可选的条目引用） */
export const AttachmentFinalizeSchema = v.object({
  sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/i)),
  size: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_ATTACHMENT_BYTES)),
  mime: v.nullable(v.string()),
  width: v.nullable(v.number()),
  height: v.nullable(v.number()),
  filename: v.nullable(v.string()),
  thumb: v.optional(v.nullable(AttachmentThumbSchema)),
  /** 这次上传要挂到哪条条目上（引用由客户端显式上报） */
  itemId: v.optional(v.nullable(v.string())),
});
export type AttachmentFinalize = v.InferOutput<typeof AttachmentFinalizeSchema>;

/**
 * `GET /api/attachments` 的一行（M6 批 2c 的附件管理页；M4 只给了 check/blob/finalize/h/refs/gc，
 * 「列出本用户全部附件」是这一批新加的端点）。
 *
 * **为什么带 `kind`**：`kind` 本身就是一个查询参数，返回体不说清是哪一行，筛选就等于没筛。
 */
export const AttachmentListRowSchema = v.object({
  id: v.string(),
  sha256: v.string(),
  kind: v.picklist(["original", "thumb"]),
  filename: v.nullable(v.string()),
  mime: v.nullable(v.string()),
  size_bytes: v.pipe(v.number(), v.integer(), v.minValue(0)),
  width: v.nullable(v.number()),
  height: v.nullable(v.number()),
  created_at: v.number(),
  updated_at: v.number(),
  /** 非空 = 已被标为孤儿（没有任何引用） */
  orphaned_at: v.nullable(v.number()),
  /**
   * 引用它的**条目数**（`COUNT(DISTINCT attachment_refs.item_id)`）。
   *
   * 按 `item_id` 去重而不是数引用行：同一个条目可以同时有「当前稿引用」和某个封存版本的引用，
   * 那在界面上仍然是「被 1 条笔记引用」，数成 2 会让人以为附件被复用了。
   */
  ref_count: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export type AttachmentListRow = v.InferOutput<typeof AttachmentListRowSchema>;

/**
 * 列表响应带 `has_more` 而**暂不带游标**（M6 设计 §4.3：分页先不做，但别把契约写死成一次性）。
 *
 * 服务端按 `limit + 1` 多取一行来判定它，所以以后加游标时不必改这一层的形状。
 */
export const AttachmentListResponseSchema = v.object({
  attachments: v.array(AttachmentListRowSchema),
  has_more: v.boolean(),
});
export type AttachmentListResponse = v.InferOutput<typeof AttachmentListResponseSchema>;

/** 列表默认条数与上限（上限即「最多列出多少个」——个人自用规模，分页留到真需要时再加） */
export const ATTACHMENT_LIST_DEFAULT_LIMIT = 50;
export const ATTACHMENT_LIST_MAX_LIMIT = 200;

/**
 * 孤儿附件「立即删除」的**预告**（v0.8.3）：`GET /api/attachments/purge-plan`。
 *
 * ## 为什么删除前必须先问服务端要数
 *
 * 列表是**截断的**（`has_more` / 上限 200 行）。所以界面自己数出来的孤儿数**可能少报**，
 * 而这是一个**不可撤销**的删除——让用户确认一个偏小的数、服务端删掉比那更多的，
 * 比不做这个功能糟得多。**预告的数由服务端给，且不受列表截断影响。**
 *
 * 只数**真正的孤儿**（`ref_count = 0`），不看 `orphaned_at`：
 * 允许跳过保留期，但**不跳过"在用"这个判定**。
 */
export const AttachmentPurgePlanSchema = v.object({
  /** 会被删掉的附件数（原件 + 缩略图都算） */
  count: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** 会被释放的字节数 */
  bytes: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** 其中还有 `ATTACHMENT_ORPHAN_RETENTION_DAYS` 天保留期的那部分（"你现在就要放弃这层保护"的数量） */
  withinRetention: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export type AttachmentPurgePlan = v.InferOutput<typeof AttachmentPurgePlanSchema>;

/** `POST /api/attachments/purge` 的结果：真的删了多少、释放多少 */
export const AttachmentPurgeResultSchema = v.object({
  removed: v.pipe(v.number(), v.integer(), v.minValue(0)),
  bytes: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export type AttachmentPurgeResult = v.InferOutput<typeof AttachmentPurgeResultSchema>;


/** 版本封存原因（设计 §4.1）；界面显示的中文映射见 `VERSION_REASON_LABELS` */
export const VersionReasonSchema = v.picklist([
  "autosave_idle",
  "session",
  "manual",
  "pre_restore",
  "pre_conflict",
  "pre_mcp",
  "pre_convert",
]);
export type VersionReason = v.InferOutput<typeof VersionReasonSchema>;

/**
 * 版本元数据（线上形状；M4-5 的服务端返回、M4-11 的界面消费）。
 *
 * 两端共用同一份定义——版本行的字段（原因、备注、保留、大小）在界面上一个不少，
 * 各写一份类型必然会漂移。
 */
export const VersionMetaSchema = v.object({
  id: v.string(),
  rev: v.number(),
  reason: v.string(),
  label: v.nullable(v.string()),
  /** 1 = 保留（不参与稀疏化） */
  keep: v.number(),
  codec: v.picklist(["gzip", "none"]),
  size_bytes: v.number(),
  content_hash: v.string(),
  title: v.nullable(v.string()),
  created_at: v.number(),
});
export type VersionMeta = v.InferOutput<typeof VersionMetaSchema>;

/**
 * 封存原因的**中文映射**（M4 界面稿 §4.3 定的原文，集中一处：界面与日志用同一份）。
 *
 * 界面**不允许**回落到英文原值（界面稿 §4.3 的硬要求），所以取不到时用 `versionReasonLabel()`
 * 给一个中性中文，而不是把 `pre_mcp` 这种内部字面量摆给用户看。
 */
export const VERSION_REASON_LABELS: Readonly<Record<VersionReason, string>> = {
  autosave_idle: "停止编辑后自动保存",
  session: "新会话首次编辑",
  manual: "手动保存",
  pre_restore: "恢复前",
  pre_conflict: "冲突前",
  pre_mcp: "AI 修改前",
  pre_convert: "表格降级前",
};

/** 取中文原因；未知值（将来加了新 reason 而界面还没更新）给中性文案，**不回落到英文** */
export function versionReasonLabel(reason: string): string {
  return (VERSION_REASON_LABELS as Record<string, string | undefined>)[reason] ?? "其他改动";
}

/** `POST /api/items/:id/versions`：手动封存（备注可空） */
export const VersionSealSchema = v.object({
  label: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(200)))),
});
export type VersionSeal = v.InferOutput<typeof VersionSealSchema>;
