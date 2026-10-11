/**
 * 推送（outbox → 服务端；设计稿《同步引擎设计》§4.2、§4.6、§4.7）。
 *
 * 关键行为：
 * - 正文从哪里来：**读 `drafts`**（outbox 只存引用，不复制正文）。
 * - 上传成功后只清"没被改动过"的草稿：正文与上传内容一致才清，否则再排一次保存，
 *   避免把用户在飞行期间敲的字丢掉。
 * - 409 分两种：**哈希与本地一致 → 视为上次已成功**；否则 → 本地内容另存**冲突副本**，
 *   原条目采纳服务端版本。
 * - 422/403/404 这类不可重试的错误 → 移入"上传失败"列表（排到队尾，不阻塞其他项）。
 */
import {
  BATCH_MAX_OPS,
  extractAttachmentRefs,
  newUlid,
  sha256Hex,
  type ApiErrorCode,
  type BatchOp,
  type BatchResult,
  type ItemBodyWriteResponse,
  type ItemMetaPatch,
  type ItemWriteMeta,
} from "@menote/shared";
import { ApiError } from "../api/client";
import { type PushApi } from "./push-api";
import { httpPushApi } from "./push-api";
import {
  clearDraft,
  createLocalItem,
  db,
  enqueueBodySave,
  getDraft,
  getEditableBody,
  getLocalFolder,
  getLocalItem,
  getLocalSettings,
  headOutbox,
  listDueOutbox,
  markFolderSynced,
  markItemSynced,
  markOutboxFailure,
  markSettingsSynced,
  putCachedBody,
  recordConflict,
  removeOutbox,
  type OutboxRow,
} from "../db";
import { FAILED_RETRY_AT, backoffDelayMs } from "./backoff";

/** 单次推送最多处理多少项，避免长时间占住主线程 */
const MAX_OPS_PER_RUN = 20;

// PushApi 接口与 HTTP 实现在 `./push-api`（v0.8.24 抽出，见该文件头）；类型原样再出口给既有引用方。

export type { PushApi } from "./push-api";

export interface PushContext {  api?: PushApi;
  now?: () => number;
  random?: () => number;
  deviceLabel?: string | null;
  /**
   * 本机设备标识（`syncState.device_id`），随正文保存上报，服务端写进 `items.last_device`。
   *
   * 为什么要上报：需求 §12.2-3 的"**另一台设备改过**"就靠它判断（M11-01 的 `session` 封存触发）。
   * 服务端一直支持这个头，但客户端此前从没发过 → 那一列永远是 null、这个判断无从做起。
   */
  deviceId?: string | null;
}

interface ResolvedContext {
  api: PushApi;
  now: () => number;
  random: () => number;
  deviceLabel: string | null;
  deviceId: string | null;
}

export interface PushBatchResult {
  processed: number;
  succeeded: number;
  conflicted: number;
  failed: number;
  /** 队列里还有到点的项（调用方可以立刻再跑一轮） */
  more: boolean;
  /**
   * 本次**推送成功**的条目 id（只含 create / save_body——它们动了正文）。
   * UI 层用它把"打开时的正文基线"跟到刚推上去的内容，避免把自己的上传误报成
   * "别的标签页改过"（编辑器专项优化 v0.8.24）。
   */
  pushedItemIds: string[];
}

type PushOutcome = "done" | "conflict" | "failed";

/** "MM-DD HH:mm"（本地时间）：冲突副本标题用 */
function formatStamp(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 正文上传成功后的统一落地 */
async function afterBodySynced(
  itemId: string,
  uploadedBody: string,
  contentHash: string,
  result: ItemBodyWriteResponse,
  ctx: ResolvedContext,
  seq: number,
): Promise<void> {
  await putCachedBody(itemId, uploadedBody, result.rev, contentHash, ctx.now());
  await markItemSynced(itemId, {
    rev: result.rev,
    content_hash: contentHash,
    size_bytes: result.bytes,
  });

  // 先出队再处理草稿：否则紧接着的入队会被"队列里还有这一条"挡住，新草稿就悬空了
  await removeOutbox(seq);

  const draft = await getDraft(itemId);
  if (draft && draft.body === uploadedBody) {
    await clearDraft(itemId);
  } else if (draft) {
    // 上传期间用户又改了：立刻再排一次保存，别让它停在"有草稿但没入队"的状态
    await enqueueBodySave(itemId, result.rev, ctx.now());
  }
}

async function pushCreate(row: OutboxRow, ctx: ResolvedContext, seq: number): Promise<PushOutcome> {
  const item = await getLocalItem(row.entity_id);
  if (!item) {
    // 本地已删（例如建完又删）：没有可上传的内容，直接出队
    await removeOutbox(seq);
    return "done";
  }

  const { body } = await getEditableBody(item.id);
  const contentHash = await sha256Hex(body);
  const meta: ItemWriteMeta = {
    type: item.type,
    title: item.title,
    folder_id: item.folder_id,
    tags: item.tags,
    memo_at: item.memo_at,
    is_task: item.is_task,
    task_status: item.task_status,
    task_due: item.task_due,
    task_priority: item.task_priority,
    content_hash: contentHash,
  };

  const result = await ctx.api.createItem(item.id, meta, body);
  await afterBodySynced(item.id, body, contentHash, result, ctx, seq);
  return "done";
}

async function pushBodySave(row: OutboxRow, ctx: ResolvedContext, seq: number): Promise<PushOutcome> {
  const item = await getLocalItem(row.entity_id);
  if (!item) {
    await removeOutbox(seq);
    return "done";
  }

  const { body } = await getEditableBody(item.id);
  const contentHash = await sha256Hex(body);
  const result = await ctx.api.saveBody(
    item.id,
    row.base_rev,
    contentHash,
    body,
    ctx.deviceId ?? undefined,
    // 与批量路径同一套抽取（见下方 buildOp 的注释）：不另写一份解析
    [...extractAttachmentRefs(body)],
  );
  await afterBodySynced(item.id, body, contentHash, result, ctx, seq);
  return "done";
}

async function pushMetaPatch(row: OutboxRow, ctx: ResolvedContext, seq: number): Promise<PushOutcome> {
  const item = await getLocalItem(row.entity_id);
  if (!item) {
    await removeOutbox(seq);
    return "done";
  }

  /*
    本地条目已经带着"想要的元数据"，整组发过去；服务端逐字段判定。

    **必须包含隐私相关的两列**（2026-09-27 修）：此前只发了 title / folder_id / tags / pinned / starred，
    `enc_self` 与 `in_enc_space` **一个都没发**——于是"切换单篇加密""移入/移出加密空间"只改了本地，
    服务端那份始终没变；下一次同步拉回时本地标记被覆盖回去，**加密标记自己消失**
    （门禁在前端，标记一丢正文就直接明文呈现）。这类"写了没接上"本程已抓到多次，
    这里是最严重的一处：它不是显示问题，而是隐私保护失效。
  */
  const patch: ItemMetaPatch = {
    base_meta_rev: row.base_meta_rev,
    title: item.title,
    folder_id: item.folder_id,
    tags: item.tags,
    pinned: item.pinned,
    starred: item.starred,
    enc_self: item.enc_self,
    in_enc_space: item.in_enc_space,
  };

  const result = await ctx.api.patchMeta(item.id, patch);
  await markItemSynced(item.id, { meta_rev: result.meta_rev });
  await removeOutbox(seq);
  return "done";
}

/**
 * 备份恢复的收尾（M5 设计 §4.2）：回收站条目先 `create` 推上去（服务端只会建成正常条目），
 * 这一步再补一次服务端软删，才算真正回到回收站。
 *
 * 本地行在导入时就已写成回收站态，所以这里**以本地为准**：到出队时本地已不是回收站态
 * （用户等不及先恢复了）或条目已不在，就什么都不调直接出队——不把过时的意图推给服务端。
 */
async function pushTrashItem(row: OutboxRow, ctx: ResolvedContext, seq: number): Promise<PushOutcome> {
  const item = await getLocalItem(row.entity_id);
  if (!item || item.deleted_at === null) {
    await removeOutbox(seq);
    return "done";
  }

  const result = await ctx.api.trashItem(item.id);
  // 服务端软删会推进条目的 meta_rev，记回来：之后这条即便再被恢复/改元数据，
  // 本地的 base_meta_rev 也不会故意落后一截
  await markItemSynced(item.id, { meta_rev: result.meta_rev });
  await removeOutbox(seq);
  return "done";
}

async function pushCreateFolder(row: OutboxRow, ctx: ResolvedContext, seq: number): Promise<PushOutcome> {
  const folder = await getLocalFolder(row.entity_id);
  if (!folder) {
    await removeOutbox(seq);
    return "done";
  }

  const result = await ctx.api.createFolder({
    id: folder.id,
    parent_id: folder.parent_id,
    name: folder.name,
  });
  await markFolderSynced(folder.id, { meta_rev: result.meta_rev });
  await removeOutbox(seq);
  return "done";
}

async function pushPatchFolder(row: OutboxRow, ctx: ResolvedContext, seq: number): Promise<PushOutcome> {
  const folder = await getLocalFolder(row.entity_id);
  if (!folder) {
    await removeOutbox(seq);
    return "done";
  }

  const result = await ctx.api.patchFolder(folder.id, {
    base_meta_rev: row.base_meta_rev,
    name: folder.name,
    parent_id: folder.parent_id,
  });
  await markFolderSynced(folder.id, { meta_rev: result.meta_rev });
  await removeOutbox(seq);
  return "done";
}

/**
 * 推送用户设置（M2-7）：整份覆盖、后写为准。
 *
 * 本地行先落盘再入队，所以这里读的是"用户最新的那份"；成功后把服务端返回的 `rev`
 * 记回本地并清掉待上传标记。设置没有冲突语义（不是用户内容），服务端也不会回 409。
 */
async function pushPutSettings(row: OutboxRow, ctx: ResolvedContext, seq: number): Promise<PushOutcome> {
  const local = await getLocalSettings();
  if (!local.pending) {
    await removeOutbox(seq);
    return "done";
  }

  const result = await ctx.api.putSettings({
    settings: local.settings,
    base_rev: local.rev,
  });
  await markSettingsSynced(result.rev, result.updated_at);
  await removeOutbox(seq);
  return "done";
}

/** 冲突处理：哈希相同视为重放成功；否则本地内容另存冲突副本，原条目采纳服务端版本 */
async function handleConflict(
  row: OutboxRow,
  error: ApiError,
  ctx: ResolvedContext,
  seq: number,
): Promise<PushOutcome> {
  const detail = (error.detail ?? {}) as { rev?: number; meta_rev?: number; content_hash?: string };

  if (error.code === "meta_conflict") {
    // 元数据冲突不生成副本：服务端版本胜出，下一次拉取会把新值带下来
    await markItemSynced(row.entity_id, detail.meta_rev === undefined ? {} : { meta_rev: detail.meta_rev });
    await removeOutbox(seq);
    return "conflict";
  }

  const item = await getLocalItem(row.entity_id);
  const { body } = await getEditableBody(row.entity_id);
  const contentHash = await sha256Hex(body);

  if (detail.content_hash === contentHash) {
    // 上次写入其实已成功，只是响应丢了
    await putCachedBody(row.entity_id, body, detail.rev ?? item?.rev ?? 1, contentHash, ctx.now());
    await markItemSynced(row.entity_id, {
      rev: detail.rev ?? item?.rev ?? 1,
      content_hash: contentHash,
    });
    await clearDraft(row.entity_id);
    await removeOutbox(seq);
    return "done";
  }

  const copyId = newUlid(ctx.now());
  const baseTitle = item?.title ?? "未命名笔记";
  const device = ctx.deviceLabel ?? "本机";
  const copyTitle = `${baseTitle}（冲突副本 ${formatStamp(ctx.now())} · ${device}）`;

  // 本地内容另存为新条目（它自己会入队一条 create）
  await createLocalItem(
    {
      id: copyId,
      type: item?.type ?? "note",
      title: copyTitle,
      folder_id: item?.folder_id ?? null,
      tags: item?.tags ?? [],
      memo_at: item?.memo_at ?? null,
      body,
    },
    ctx.now(),
  );
  // 记下副本出自哪条：对比 UI 靠这条关联（不依赖标题，改名/重名都不会指错）
  await recordConflict(copyId, row.entity_id, ctx.now());

  // 原条目采纳服务端版本：正文缓存失效，等下次按需重取
  await markItemSynced(row.entity_id, {
    rev: detail.rev ?? item?.rev ?? 1,
    content_hash: detail.content_hash ?? item?.content_hash ?? "",
  });
  await db.bodies.delete(row.entity_id);
  await clearDraft(row.entity_id);
  await removeOutbox(seq);
  return "conflict";
}

async function scheduleRetry(row: OutboxRow, message: string, ctx: ResolvedContext, seq: number): Promise<void> {
  await markOutboxFailure(seq, message, ctx.now() + backoffDelayMs(row.retries + 1, ctx.random));
}

async function failPermanently(row: OutboxRow, message: string, seq: number): Promise<void> {
  await markOutboxFailure(seq, message, FAILED_RETRY_AT);
}

async function pushOne(row: OutboxRow, ctx: ResolvedContext): Promise<PushOutcome> {
  const seq = row.seq;
  if (seq === undefined) return "failed";

  try {
    switch (row.op) {
      case "create":
        return await pushCreate(row, ctx, seq);
      case "save_body":
        return await pushBodySave(row, ctx, seq);
      case "patch_meta":
        return await pushMetaPatch(row, ctx, seq);
      case "trash_item":
        return await pushTrashItem(row, ctx, seq);
      case "create_folder":
        return await pushCreateFolder(row, ctx, seq);
      case "patch_folder":
        return await pushPatchFolder(row, ctx, seq);
      case "put_settings":
        return await pushPutSettings(row, ctx, seq);
      default:
        await failPermanently(row, `未知操作：${String(row.op)}`, seq);
        return "failed";
    }
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === "rev_conflict" || error.code === "meta_conflict") {
        return await handleConflict(row, error, ctx, seq);
      }
      if (error.retryable) {
        await scheduleRetry(row, error.message, ctx, seq);
        return "failed";
      }
      // 422 / 403 / 404：重试也不会成功，移入"上传失败"列表
      await failPermanently(row, error.message, seq);
      return "failed";
    }
    await scheduleRetry(row, error instanceof Error ? error.message : String(error), ctx, seq);
    return "failed";
  }
}

// ——————————————————————————— 批量路径（M2-9） ———————————————————————————

/** 可批量的三类条目操作（文件夹与设置不走批量：它们不是同步热点） */
const BATCHABLE_OPS = new Set(["create", "save_body", "patch_meta"]);

interface PreparedBatchOp {
  op: BatchOp;
  /** `create` / `save_body` 才有：成功后要写回本地正文与哈希 */
  body?: string;
  contentHash?: string;
}

/**
 * 把一行 outbox 准备成批量操作。
 *
 * 返回 `null` 表示"这一行不该进批次"：要么类型不可批量，要么本地条目已被删除（调用方直接出队）。
 * 入参形状与 `pushCreate` / `pushBodySave` / `pushMetaPatch` 完全一致——**同一个本地状态来源**，
 * 避免批量与单条两条路径各写一份 payload 逻辑。
 */
async function prepareBatchOp(row: OutboxRow): Promise<PreparedBatchOp | null> {
  if (!BATCHABLE_OPS.has(row.op)) return null;

  const item = await getLocalItem(row.entity_id);
  if (!item) return null;

  if (row.op === "patch_meta") {
    return {
      op: {
        kind: "patch_meta",
        id: item.id,
        patch: {
          base_meta_rev: row.base_meta_rev,
          title: item.title,
          folder_id: item.folder_id,
          tags: item.tags,
          pinned: item.pinned,
          starred: item.starred,
        },
      },
    };
  }

  const { body } = await getEditableBody(item.id);
  const contentHash = await sha256Hex(body);

  if (row.op === "create") {
    return {
      op: {
        kind: "create",
        id: item.id,
        meta: {
          type: item.type,
          title: item.title,
          folder_id: item.folder_id,
          tags: item.tags,
          memo_at: item.memo_at,
          is_task: item.is_task,
          task_status: item.task_status,
          task_due: item.task_due,
          task_priority: item.task_priority,
          content_hash: contentHash,
        },
        body,
      },
      body,
      contentHash,
    };
  }

  /*
   * 引用集合跟着 `save_body` 一起推（M6 批 2a）。
   *
   * **这一条是离线主路径**：本应用离线优先，正文大多经批量落库。只在单条端点上对齐引用、
   * 而这里漏掉，等于「正常直连时对齐、断网重连后不对齐」——而后者恰好是引用最容易漂的场合
   * （用户在没网的时候改了好几篇的图）。
   *
   * 用 `extractAttachmentRefs(body)` 抽，**不另写一套解析**：分享查看器取附件用的就是它
   * （`features/share-viewer/model.ts` 的 `loadAttachmentBlobs`）。
   */
  return {
    op: {
      kind: "save_body",
      id: item.id,
      base_rev: row.base_rev,
      content_hash: contentHash,
      body,
      refs: [...extractAttachmentRefs(body)],
    },
    body,
    contentHash,
  };
}

/** 把批量里的一条结果落到本地：成功照单条路径写回，失败按单条路径的规则分派 */
async function applyBatchResult(
  row: OutboxRow,
  prepared: PreparedBatchOp,
  result: BatchResult,
  ctx: ResolvedContext,
  seq: number,
): Promise<PushOutcome> {
  if (result.ok) {
    if (result.kind === "patch_meta") {
      await markItemSynced(row.entity_id, { meta_rev: result.rev });
      await removeOutbox(seq);
      return "done";
    }
    await afterBodySynced(
      row.entity_id,
      prepared.body ?? "",
      prepared.contentHash ?? "",
      { id: row.entity_id, rev: result.rev, bytes: result.bytes ?? 0, chars: result.chars ?? 0 },
      ctx,
      seq,
    );
    return "done";
  }

  // 失败：按单条路径同一套规则分派（冲突 → 副本；可重试 → 退避；其余 → 上传失败列表）
  const error = new ApiError(result.code as ApiErrorCode, result.message, 0, result.detail);
  if (error.code === "rev_conflict" || error.code === "meta_conflict") {
    return await handleConflict(row, error, ctx, seq);
  }
  if (error.retryable) {
    await scheduleRetry(row, error.message, ctx, seq);
    return "failed";
  }
  await failPermanently(row, error.message, seq);
  return "failed";
}

/** 推送队列：按顺序处理到点的项，最多 `MAX_OPS_PER_RUN` 项 */
export async function pushQueue(context: PushContext = {}): Promise<PushBatchResult> {
  const ctx: ResolvedContext = {
    /*
      默认 API 直接用 `httpPushApi`：`PushApi.saveBody` 的设备标识由调用处从 `ctx` 传进来，
      不再需要「按上下文包一层」。原来那层包装存在只是因为两处参数顺序不同（见接口注释）。
    */
    api: context.api ?? httpPushApi,
    now: context.now ?? Date.now,
    random: context.random ?? Math.random,
    deviceLabel: context.deviceLabel ?? null,
    deviceId: context.deviceId ?? null,
  };

  const result: PushBatchResult = {
    processed: 0,
    succeeded: 0,
    conflicted: 0,
    failed: 0,
    more: false,
    pushedItemIds: [],
  };

  /** 一批最多 `BATCH_MAX_OPS` 个操作（服务端按 3 条写语句/操作、45 条上限算出来的） */
  const batchApi = ctx.api.batch?.bind(ctx.api);

  for (let guard = 0; guard < MAX_OPS_PER_RUN; guard += 1) {
    // 批量快路径：队首连续 ≥2 个可批量操作时合并成一次请求（省的是客户端到 Worker 的往返）
    if (batchApi) {
      const head = await listDueOutbox(ctx.now(), BATCH_MAX_OPS);
      const prepared: Array<{ row: OutboxRow; ready: PreparedBatchOp }> = [];

      for (const row of head) {
        // 队首一旦遇到不可批量的操作就停：保持 FIFO，不让后面的操作抢先上传
        if (!BATCHABLE_OPS.has(row.op)) break;
        if (row.seq === undefined) continue;

        const ready = await prepareBatchOp(row);
        if (!ready) {
          // 本地条目已删（例如建完又删）：没有可上传的内容，直接出队
          await removeOutbox(row.seq);
          continue;
        }
        prepared.push({ row, ready });
      }

      if (prepared.length > 1) {
        const ops = prepared.map((entry) => entry.ready.op);
        const response = await batchApi(ops);

        for (const [index, entry] of prepared.entries()) {
          const seq = entry.row.seq;
          if (seq === undefined) continue;

          // 结果按**批次内序号**对齐；服务端漏回某条时当可重试失败处理（不放任它静默丢失）
          const opResult: BatchResult = response.results.find((row) => row.index === index) ?? {
            ok: false,
            index,
            kind: entry.ready.op.kind,
            id: entry.ready.op.id,
            code: "retry_later",
            message: "服务端未返回该操作的结果",
          };

          const outcome = await applyBatchResult(entry.row, entry.ready, opResult, ctx, seq);
          result.processed += 1;
          if (outcome === "done") {
            result.succeeded += 1;
            // 只记动了正文的条目操作：基线跟随只关心 create / save_body
            if (entry.row.entity === "item" && (entry.row.op === "create" || entry.row.op === "save_body")) {
              result.pushedItemIds.push(entry.row.entity_id);
            }
          } else if (outcome === "conflict") result.conflicted += 1;
          else result.failed += 1;
        }
        continue;
      }
    }

    const row = await headOutbox(ctx.now());
    if (!row) break;

    result.processed += 1;
    const outcome = await pushOne(row, ctx);
    if (outcome === "done") {
      result.succeeded += 1;
      if (row.entity === "item" && (row.op === "create" || row.op === "save_body")) {
        result.pushedItemIds.push(row.entity_id);
      }
    } else if (outcome === "conflict") result.conflicted += 1;
    else result.failed += 1;
  }

  result.more = (await headOutbox(ctx.now())) !== undefined;
  return result;
}
