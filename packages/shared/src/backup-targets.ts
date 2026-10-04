/**
 * 外部备份目标的线上契约（M16-01 / M16-02；设计 §三-§四）。
 *
 * ## 一条贯穿全文件的口径：凭据永不回显
 *
 * `secret`（WebDAV 口令 / S3 的 secret key）**只在创建或替换时以一次性明文提交**，
 * 服务端包裹后落库；**任何 GET 响应里都不含它**，列表只给 `has_secret: boolean`。
 * 这不是"避免泄露"这么泛的说法——目标记录会出现在设置页、会进日志、可能进错误消息，
 * 一旦明文可读，凭据就从"用户自己知道的"变成"在库里躺着的东西"。
 *
 * 出站包同理**不含 `user_crypto` 任何字段**（设计 §五）。
 */
import * as v from "valibot";

/** 目标类型。**首期只 WebDAV + S3**（用户 2026-10-03 拍板：Git 的 tree/commit 编排最重、价值面窄，后置） */
export const BackupTargetKinds = ["webdav", "s3"] as const;
export const BackupTargetKindSchema = v.picklist(BackupTargetKinds);
export type BackupTargetKind = v.InferOutput<typeof BackupTargetKindSchema>;

/**
 * 远端删除策略。
 *
 * - `append_only`（**默认**）：本地删了也不删远端，远端会积垃圾，但**误操作不会真丢数据**；
 * - `sync`：本地删了远端也删，远端与本地一致，但**远端被误删 / 同步出错会真丢**。
 *
 * 默认取安全的那一档，把选择权交回用户（用户 2026-10-03 拍板）。
 */
export const BackupDeletePolicies = ["sync", "append_only"] as const;
export const BackupDeletePolicySchema = v.picklist(BackupDeletePolicies);
export type BackupDeletePolicy = v.InferOutput<typeof BackupDeletePolicySchema>;

/**
 * 调度档位。**它只决定"某天推不推"，不决定"一轮推多少"**——
 * 一轮推多少由外部子请求上限（架构 §14.3）说了算。
 */
export const BackupSchedules = ["daily", "weekly"] as const;
export const BackupScheduleSchema = v.picklist(BackupSchedules);
export type BackupSchedule = v.InferOutput<typeof BackupScheduleSchema>;

/** 每分钟外部子请求的安全档（架构 §14.3：免费版外部子请求 50 个 / invocation） */
export const BACKUP_BATCH_PUT_LIMIT = 40;

/** 单轮出站加密字节配额（M7 性能校准：按 2–4 ms 估计值的**下界** 2 MB 取，量过再放宽） */
export const BACKUP_ENCRYPT_QUOTA_BYTES = 2 * 1024 * 1024;

/** 目标记录（管理侧）。**没有 `secret` 字段**——只有 `has_secret` */
export const BackupTargetSchema = v.object({
  id: v.string(),
  kind: BackupTargetKindSchema,
  label: v.string(),
  /** URL（WebDAV 目录 / S3 endpoint） */
  endpoint: v.string(),
  /** S3 的 bucket 名；WebDAV 恒 null */
  bucket: v.nullable(v.string()),
  /** S3 的 region；WebDAV 恒 null */
  region: v.nullable(v.string()),
  /** WebDAV 的用户名；S3 的 access key id 也放这里（两者都是"标识"不是"秘密"） */
  username: v.nullable(v.string()),
  /** 凭据是否已配（不告诉你是什么） */
  has_secret: v.boolean(),
  enabled: v.boolean(),
  delete_policy: BackupDeletePolicySchema,
  schedule: BackupScheduleSchema,
  /** 已推到的同步游标（`sync_seq`）；差异计算从这里续 */
  cursor_seq: v.number(),
  last_run_at: v.nullable(v.number()),
  last_result: v.nullable(v.picklist(["ok", "partial", "failed"])),
  /** 失败原因。**平铺给用户看**（DESIGN.md §5.4-2：错误必须保持可见，不用自动消失的 Toast 承载） */
  last_error: v.nullable(v.string()),
  created_at: v.number(),
});
export type BackupTarget = v.InferOutput<typeof BackupTargetSchema>;

const EndpointSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, "必填"),
  v.check(
    (value) => /^https?:\/\/[^\s]+$/.test(value),
    "必须以 http:// 或 https:// 开头（Worker 只支持 https；明文 http 只给本地调试用）",
  ),
);

const LabelSchema = v.pipe(v.string(), v.trim(), v.minLength(1, "必填"), v.maxLength(64));

/** `POST /api/backup/targets`：建。`secret` 是**一次性明文**，包裹后落库、此后永不回显 */
export const CreateBackupTargetSchema = v.object({
  kind: BackupTargetKindSchema,
  label: LabelSchema,
  endpoint: EndpointSchema,
  /** S3 必填；WebDAV 省略 */
  bucket: v.optional(v.nullable(v.string())),
  region: v.optional(v.nullable(v.string())),
  username: v.optional(v.nullable(v.string())),
  secret: v.pipe(v.string(), v.minLength(1, "必填")),
  enabled: v.optional(v.boolean()),
  delete_policy: v.optional(BackupDeletePolicySchema),
  schedule: v.optional(BackupScheduleSchema),
});
export type CreateBackupTargetInput = v.InferOutput<typeof CreateBackupTargetSchema>;

/** `PUT /api/backup/targets/:id`：改。**`secret` 缺省 = 不改凭据**（不传空串，那会被当成"清空"） */
export const UpdateBackupTargetSchema = v.object({
  label: v.optional(LabelSchema),
  endpoint: v.optional(EndpointSchema),
  bucket: v.optional(v.nullable(v.string())),
  region: v.optional(v.nullable(v.string())),
  username: v.optional(v.nullable(v.string())),
  secret: v.optional(v.string()),
  enabled: v.optional(v.boolean()),
  delete_policy: v.optional(BackupDeletePolicySchema),
  schedule: v.optional(BackupScheduleSchema),
});
export type UpdateBackupTargetInput = v.InferOutput<typeof UpdateBackupTargetSchema>;

/** `POST /api/backup/targets/:id/test`：测试连接。凭据可用**请求体里的一次性明文**，不落库 */
export const TestBackupTargetSchema = v.object({
  secret: v.optional(v.string(), "缺省 = 用库里已存的那份（但不回显、不外传）"),
  endpoint: v.optional(EndpointSchema),
});
export type TestBackupTargetInput = v.InferOutput<typeof TestBackupTargetSchema>;

export const BackupTargetListResponseSchema = v.object({ targets: v.array(BackupTargetSchema) });
export type BackupTargetListResponse = v.InferOutput<typeof BackupTargetListResponseSchema>;

export const BackupTargetWriteResponseSchema = v.object({ target: BackupTargetSchema });
export type BackupTargetWriteResponse = v.InferOutput<typeof BackupTargetWriteResponseSchema>;

export const BackupTestResultSchema = v.object({
  ok: v.boolean(),
  /** 失败原因（平铺给用户看，不含凭据） */
  message: v.string(),
});
export type BackupTestResult = v.InferOutput<typeof BackupTestResultSchema>;

/** 一轮推送的结果（Cron 与手动「推一次」共用同一条状态机的返回值） */
export const BackupRunResultSchema = v.object({
  /** 本轮推了多少个文件（外部 PUT 次数） */
  pushed: v.number(),
  /** 本轮删了多少个（仅 `delete_policy = 'sync'` 时可能非零） */
  deleted: v.number(),
  /**
   * 这次调用**开始时**还欠多少个（含本轮推掉的那些）。
   *
   * 单独给这个是为了让客户端能直接算比例而不必自己累加——**它是服务端说的**，
   * 客户端猜的"总量"会随用户一边打字一边推而漂移。
   */
  total: v.number(),
  /** 现在还欠多少（游标落后于最新 sync_seq） */
  remaining: v.number(),
  /** 本轮因为外部子请求上限用尽而停下（下一轮续推） */
  quota_stopped: v.boolean(),
  error: v.nullable(v.string()),
});
export type BackupRunResult = v.InferOutput<typeof BackupRunResultSchema>;
