/**
 * 定时自动备份的纯函数（M7 第 4 项 批 1；设计 §三、§四、§六）。
 *
 * **这里只放纯函数**：标签文案、校验、拼请求体。组件只做展示与交互
 * （AGENTS.md「UI 只做展示和交互，复杂逻辑下沉到业务模块」）。
 *
 * ## 三条贯穿的口径
 *
 * 1. **校验在前端也做一遍，但规则与服务端 schema 同源**（`CreateBackupTargetSchema`）——
 *    不是抄一份"我觉得对"的规则，是把同一批约束写在这里好让用户就地看到错在哪。
 *    真正的闸门仍在服务端。
 * 2. **`append_only` 是默认档**（用户 2026-10-03 拍板 Q3）。远端会积垃圾，
 *    但误删不会真丢数据——首期宁可信"多留"不信"少留"。
 * 3. **凭据在表单里是"看不见也拿不回"的东西**：编辑时留空 = 不改，不是"清空"。
 *    这条如果表达错，用户会以为把口令删了就等于换了新口令。
 */
import {
  BACKUP_BATCH_PUT_LIMIT,
  BackupSchedules,
  BackupTargetKinds,
  type BackupDeletePolicy,
  type BackupRunResult,
  type BackupSchedule,
  type BackupTarget,
  type BackupTargetKind,
  type CreateBackupTargetInput,
  type UpdateBackupTargetInput,
} from "@menote/shared";
import { formatRelative } from "../../app/format";

export const KIND_LABEL: Record<BackupTargetKind, string> = {
  webdav: "WebDAV",
  s3: "S3 兼容存储",
};

/** 地址栏的占位提示——让人一眼看出"填目录不是填站点首页" */
export const KIND_ENDPOINT_PLACEHOLDER: Record<BackupTargetKind, string> = {
  webdav: "https://dav.example.com/menote",
  s3: "https://s3.us-east-1.amazonaws.com",
};

export const POLICY_LABEL: Record<BackupDeletePolicy, string> = {
  append_only: "只增不删",
  sync: "与本机保持一致",
};

export const SCHEDULE_LABEL: Record<BackupSchedule, string> = {
  daily: "每天",
  weekly: "每周",
};

/**
 * 选了「与本机保持一致」时**必须平铺**的警告（DESIGN.md §5.4-2：破坏性后果不得藏进 ⓘ）。
 * 返回 `null` 表示当前档位没有需要警告的地方。
 */
export function policyRisk(policy: BackupDeletePolicy): string | null {
  if (policy !== "sync") return null;
  return "本机删掉的，远端也会删。远端被误删或同步出错时，备份就真的没了——这一档不可恢复。";
}

/** 一行说清"推到哪里去" */
export function targetWhere(target: BackupTarget): string {
  const base = `${KIND_LABEL[target.kind]} · ${target.endpoint}`;
  return target.kind === "s3" && target.bucket !== null ? `${base}/${target.bucket}` : base;
}

/**
 * 最近一次推送的口径。
 *
 * `last_run_at` 有了但 `last_result` 是 `null` = 一次都没成功过——
 * 那要说"从没成功过"而不是"X 小时前失败"，两者的含义差很远。
 */
export function lastRunText(target: BackupTarget, now: number): string {
  if (target.last_run_at === null) return "还没跑过";
  const when = formatRelative(target.last_run_at, now, "刚刚");
  if (target.last_result === null) return `从没成功过（${when}试过一次）`;
  if (target.last_result === "ok") return `最近成功 ${when}`;
  if (target.last_result === "partial") return `最近只推了一部分（${when}）`;
  return `最近失败（${when}）`;
}

/** 游标落后多少条（`0` = 已跟上） */
export function pendingCount(target: BackupTarget, latestSeq: number): number {
  return Math.max(0, latestSeq - target.cursor_seq);
}

export interface TargetForm {
  kind: BackupTargetKind;
  label: string;
  endpoint: string;
  bucket: string;
  region: string;
  username: string;
  /** 编辑时留空 = **不改凭据**，不是"清空" */
  secret: string;
  delete_policy: BackupDeletePolicy;
  schedule: BackupSchedule;
}

const DEFAULT_KIND: BackupTargetKind = "webdav";

/** 新建时的初始表单。默认档是安全的那一档（口径 2） */
export function emptyTargetForm(): TargetForm {
  return {
    kind: DEFAULT_KIND,
    label: "",
    endpoint: "",
    bucket: "",
    region: "",
    username: "",
    secret: "",
    delete_policy: "append_only",
    schedule: "daily",
  };
}

/** 编辑时的初始表单：预填现有值，凭据一律留空（服务端也不回显，没有可填的） */
export function formFromTarget(target: BackupTarget): TargetForm {
  return {
    kind: target.kind,
    label: target.label,
    endpoint: target.endpoint,
    bucket: target.bucket ?? "",
    region: target.region ?? "",
    username: target.username ?? "",
    secret: "",
    delete_policy: target.delete_policy,
    schedule: target.schedule,
  };
}

export type FormResult =
  | { ok: true; value: CreateBackupTargetInput | UpdateBackupTargetInput }
  | { ok: false; error: string };

/**
 * 校验 + 拼请求体。
 *
 * 规则与 `CreateBackupTargetSchema` / `UpdateBackupTargetSchema` 一致（`EndpointSchema`
 * 那个 `^https?://` 正则也是照抄的），差别只在**把错误翻成人话就地报出来**。
 * `isNew` 决定 `secret` 是必填还是"留空即不改"。
 */
export function buildTargetPayload(form: TargetForm, isNew: boolean): FormResult {
  const label = form.label.trim();
  if (label === "") return { ok: false, error: "名称必填——要能一眼认出这是哪个备份" };
  if (label.length > 64) return { ok: false, error: "名称最多 64 个字" };

  const endpoint = form.endpoint.trim();
  if (!/^https?:\/\/[^\s]+$/.test(endpoint)) {
    return { ok: false, error: "地址必须以 http:// 或 https:// 开头，且不能有空格" };
  }

  const bucket = form.bucket.trim();
  // S3 的桶名是必填的；WebDAV 没这个字段，填了也不该送（服务端按 kind 忽略，但送了就是误导）
  if (form.kind === "s3" && bucket === "") return { ok: false, error: "S3 必须填桶名（bucket）" };

  const secret = form.secret.trim();
  if (isNew && secret === "") return { ok: false, error: "密钥必填——它只提交这一次，之后不再显示" };

  /** 两种模式共用的那部分字段 */
  const common = {
    label,
    endpoint,
    bucket: form.kind === "s3" ? bucket : null,
    region: form.region.trim() || null,
    username: form.username.trim() || null,
    delete_policy: form.delete_policy,
    schedule: form.schedule,
  };

  // 编辑：密钥留空 = 不改凭据，**不送 `secret` 这个键**（送空串会被当成"清空"）
  if (!isNew) {
    return { ok: true, value: secret === "" ? common : { ...common, secret } };
  }

  // 新建：`enabled` 恒 true——先建出来再关掉，比"建的时候默认关着"更安全
  //（关着的话用户会以为备份在跑，而其实一次都没推过）
  return { ok: true, value: { ...common, kind: form.kind, secret, enabled: true } };
}

/** 该不该显示"桶名 / 区域"这两栏（`region` 只有 S3 有意义） */
export function showsS3Fields(kind: BackupTargetKind): boolean {
  return kind === "s3";
}

/** 凭据字段的 label：新建叫"密钥"，编辑时要说清"留空 = 不改" */
export function secretFieldLabel(hasExisting: boolean, kind: BackupTargetKind): string {
  const what = kind === "s3" ? "Secret Access Key" : "口令";
  return hasExisting ? `换${what}（留空 = 不改）` : what;
}

/** 调一次只推 {limit} 个文件这件事，要在界面上说清，否则用户以为坏了 */
export function quotaNotice(limit: number = BACKUP_BATCH_PUT_LIMIT): string {
  return `每轮最多推 ${limit} 个文件，推不完下一轮接着推——不是出错。`;
}

/**
 * 「推一次」的结果文案。
 *
 * **三条都要分开说**，因为它们对用户的含义完全不同：
 * - `error` 非空 = 这次没推成（原因就在后面，不藏）；
 * - `pushed === 0` 且没有 error = 确实没东西可推（不是"失败"）；
 * - `remaining > 0` = 推了一批还有剩——**这是常态，不是出错**（一轮一批的硬限额）。
 */
export function runResultText(result: BackupRunResult): string {
  if (result.error !== null) return `没推成：${result.error}`;
  if (result.pushed === 0 && result.deleted === 0) return "这次没有需要推送的内容。";
  const parts = [`推了 ${result.pushed} 个文件`];
  if (result.deleted > 0) parts.push(`删了远端 ${result.deleted} 个`);
  if (result.remaining > 0) parts.push(`还有 ${result.remaining} 个没推完`);
  return `${parts.join("，")}。`;
}

/** 循环的终态：四个，不许混成一个「成功 / 失败」 */
export type PushRunPhase = "running" | "done" | "partial" | "failed";

export interface PushRunState {
  phase: PushRunPhase;
  /** 累计推了多少个（跨多轮累加） */
  done: number;
  /** 服务端第一次报的那个总量；后续只会被新内容顶大，不会变小 */
  total: number;
  remaining: number;
  error: string | null;
}

export function initialRunState(): PushRunState {
  return { phase: "running", done: 0, total: 0, remaining: 0, error: null };
}

/**
 * 累加一轮的结果。
 *
 * **`total` 只增不减**：用户可能一边看进度一边继续写东西，欠的文件会变多。
 * 那个总量一旦变小，进度条就会往回跳——**进度条往回跳比不准更让人困惑**。
 */
export function accumulateRun(state: PushRunState, result: BackupRunResult): PushRunState {
  if (result.error !== null) {
    return { ...state, phase: "failed", error: result.error };
  }
  const done = state.done + result.pushed;
  const total = Math.max(state.total, done + result.remaining, result.total);
  const remaining = result.remaining;
  return {
    phase: remaining === 0 ? "done" : "running",
    done,
    total,
    remaining,
    error: null,
  };
}

/** 进度条的比例，**夹在 0–1**（`total` 为 0 时给 1：没东西可推就是"完成了"，不是 0%） */
export function progressOf(state: PushRunState): number {
  if (state.total <= 0) return 1;
  return Math.min(1, Math.max(0, state.done / state.total));
}

/** 进度条下面的数字行。**必须有数字**——DESIGN.md §3.2：语义色不得单独表意 */
export function progressText(state: PushRunState): string {
  if (state.phase === "running" && state.total === 0) return "正在读取待推内容…";
  return `已推 ${state.done} / ${state.total}`;
}

/**
 * 终态文案。**"推了一部分"不是失败**——一轮一批的硬限额下它必然发生。
 *
 * 非终态且被中断的那句「关掉也没关系」是刻意说的：游标在服务端（D1），
 * 关页面不丢进度；不说这句，用户会以为关掉就白推了。
 */
export function pushRunText(state: PushRunState, interrupted: boolean): string {
  if (state.phase === "failed") return `没推成：${state.error ?? "请稍后重试"}`;
  if (state.phase === "done") {
    return state.done === 0 ? "已经是最新的了，没有需要推送的内容。" : `推完了，${state.done} 个文件都已推到远端。`;
  }
  const tail = interrupted ? "关掉也没关系，下次接着推。" : "正在继续推…";
  return `推了 ${state.done} 个，还剩 ${state.remaining} 个没推完。${tail}`;
}

export { BackupTargetKinds, BackupSchedules };
