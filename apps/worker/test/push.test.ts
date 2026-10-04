/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 外部备份的推送状态机（M7 第 4 项 批 3）。
 *
 * 用一个**假的远端**（`fetch` 桩）而不是真连 WebDAV/S3：真连会让用例依赖外部服务、
 * 也拿不到"到底发出了几个请求"这种关键计数。适配器本身在批 1 用真 fetch 测过连接与签名，
 * 这里要验的是**状态机**——它一次发几个、失败后停在哪、要不要删。
 *
 * 盯的是三条不变量（理由见 `jobs/push.ts` 文件头）：
 * 1. **推不许超过快照已物化的位置**——推一个还没写出来的文件必然失败，而失败若被当成
 *    "推过了"，游标一过就**永久丢一次备份**。
 * 2. **游标只推过"连续成功"的那一段**——第 3 个失败时游标必须停在第 2 个。
 * 3. **`append_only` 绝不 DELETE 远端**；`sync` 才删，且只删变更队列里明确记着的路径。
 */
import {
  ITEM_BASE_REV_HEADER,
  ITEM_HASH_HEADER,
  ITEM_META_HEADER,
  base64UrlEncode,
  encodeItemWriteMeta,
  newUlid,
  notePath,
  type BackupRunResult,
  type ItemWriteMeta,
} from "@menote/shared";
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE_KEY_PREFIX, type BackupTargetRow } from "../src/db/backup-tables";
import { pushOneRound } from "../src/jobs/push";
import { materializeSnapshot, SNAP_PREFIX } from "../src/jobs/snapshot";
import { sealWithBackupKey } from "../src/services/crypto";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";
const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);

async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function headers(cookie: string, extra: Record<string, string> = {}): Record<string, string> {
  return { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN, Cookie: cookie, ...extra };
}

async function registerUser(username: string): Promise<{ cookie: string; id: string }> {
  const key = new Uint8Array(32).fill(9);
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
    body: JSON.stringify({ username, login_key: base64UrlEncode(key) }),
  });
  const cookie = ((res.headers.get("set-cookie") ?? "").split(";")[0] ?? "").trim();
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
  return { cookie, id: ((await me.json()) as { id: string }).id };
}

async function createItem(cookie: string, id: string, body: string): Promise<void> {
  const meta: ItemWriteMeta = {
    type: "note",
    title: "未命名笔记",
    folder_id: null,
    tags: [],
    memo_at: null,
    is_task: 0,
    task_status: null,
    task_due: null,
    task_priority: null,
    content_hash: await contentHash(body),
  };
  const res = await SELF.fetch(`${ORIGIN}/api/items/${id}`, {
    method: "PUT",
    headers: headers(cookie, { [ITEM_META_HEADER]: encodeItemWriteMeta(meta) }),
    body,
  });
  if (res.status >= 300) throw new Error(`建条目失败：${res.status}`);
}

async function updateBody(cookie: string, id: string, body: string, baseRev: number): Promise<void> {
  const res = await SELF.fetch(`${ORIGIN}/api/items/${id}/body`, {
    method: "PUT",
    headers: headers(cookie, {
      [ITEM_BASE_REV_HEADER]: String(baseRev),
      [ITEM_HASH_HEADER]: await contentHash(body),
    }),
    body,
  });
  if (res.status >= 300) throw new Error(`改正文失败：${res.status} ${await res.text()}`);
}

/** 软删（`permanent` 接口只吃**已经在回收站里**的行） */
async function softDelete(cookie: string, id: string): Promise<void> {
  const res = await SELF.fetch(`${ORIGIN}/api/items/${id}`, { method: "DELETE", headers: headers(cookie) });
  if (res.status >= 300) throw new Error(`软删失败：${res.status} ${await res.text()}`);
}

/** 软删 + 永久删（只有这两步都做了，`export_queue` 里才会有 `del:` 记账） */
async function purge(cookie: string, id: string): Promise<string> {
  await softDelete(cookie, id);
  const res = await SELF.fetch(`${ORIGIN}/api/trash/permanent`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({ ids: [id] }),
  });
  return res.status < 300 ? res.text() : `HTTP ${res.status}`;
}

/** 直接造一条目标行（不去调接口：这里要的是状态机，不是接口） */
async function makeTarget(
  userId: string,
  overrides: Partial<BackupTargetRow> = {},
): Promise<BackupTargetRow> {
  const secret = await sealWithBackupKey(env as never, new TextEncoder().encode("口令") as Uint8Array<ArrayBuffer>);
  const secretWrapped: ArrayBuffer = Uint8Array.from(
    atob(secret.replace(/-/g, "+").replace(/_/g, "/")),
    (char) => char.charCodeAt(0),
  ).buffer as ArrayBuffer;
  const row: BackupTargetRow = {
    id: newUlid(),
    user_id: userId,
    kind: "webdav",
    label: "假远端",
    endpoint: "https://dav.example.com/menote",
    bucket: null,
    region: null,
    username: "me",
    secret_wrapped: secretWrapped,
    enabled: 1,
    delete_policy: "append_only",
    schedule: "daily",
    cursor_seq: 0,
    last_run_at: null,
    last_result: null,
    last_error: null,
    created_at: NOW,
    ...overrides,
  };
  await env.DB.prepare(
    `INSERT INTO user_backup_targets (id, user_id, kind, label, endpoint, bucket, region, username, secret_wrapped, enabled, delete_policy, schedule, cursor_seq, last_run_at, last_result, last_error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      row.user_id,
      row.kind,
      row.label,
      row.endpoint,
      row.bucket,
      row.region,
      row.username,
      row.secret_wrapped,
      row.enabled,
      row.delete_policy,
      row.schedule,
      row.cursor_seq,
      row.last_run_at,
      row.last_result,
      row.last_error,
      row.created_at,
    )
    .run();
  return row;
}

/** 假远端：记录发出过的每一个请求 */
interface FakeRemote {
  puts: string[];
  deletes: string[];
  /** 让第 n 个 PUT 失败（1 起）；`null` = 全成 */
  failPutAt: number | null;
}

let remote: FakeRemote;

function installFakeRemote(): void {
  remote = { puts: [], deletes: [], failPutAt: null };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT") {
      remote.puts.push(url);
      if (remote.failPutAt !== null && remote.puts.length === remote.failPutAt) {
        return new Response("nope", { status: 403 });
      }
      return new Response(null, { status: 201 });
    }
    if (method === "DELETE") {
      remote.deletes.push(url);
      return new Response(null, { status: 204 });
    }
    // PROPFIND / HEAD：连通性探测
    return new Response("", { status: 207 });
  });
}

async function readTarget(id: string): Promise<BackupTargetRow> {
  const row = await env.DB.prepare("SELECT * FROM user_backup_targets WHERE id = ?").bind(id).first<BackupTargetRow>();
  if (!row) throw new Error("目标行不见了");
  return row;
}

async function queuedDeletes(userId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM export_queue WHERE user_id = ? AND key LIKE ?")
    .bind(userId, `${DELETE_KEY_PREFIX}%`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  await freshDatabase();
  installFakeRemote();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("推送状态机 · 基本", () => {
  it("把快照里的文件推到远端，并把游标推到已推完的位置", async () => {
    const { cookie, id } = await registerUser("owner");
    await createItem(cookie, newUlid(), "第一篇");
    await createItem(cookie, newUlid(), "第二篇");
    await materializeSnapshot(env, id, NOW);
    const target = await makeTarget(id);

    const result = await pushOneRound(env, target, NOW);
    expect(result.pushed).toBe(2);
    expect(result.error).toBeNull();
    expect(remote.puts).toHaveLength(2);

    const after = await readTarget(target.id);
    expect(after.last_result).toBe("ok");
    expect(after.cursor_seq).toBeGreaterThan(0);
  });

  it("快照还没物化时如实说「还没有新东西可推」，一个请求都不发", async () => {
    const { cookie, id } = await registerUser("owner");
    await createItem(cookie, newUlid(), "有内容");
    const target = await makeTarget(id);
    // **故意不跑 materializeSnapshot**：不变量 1 就在这里
    const result = await pushOneRound(env, target, NOW);
    expect(result.skipped).toContain("快照还没有新东西");
    expect(remote.puts).toHaveLength(0);
  });

  it("快照里有、但 R2 读不到时停下并报错（绝不当作推过了）", async () => {
    const { cookie, id } = await registerUser("owner");
    const itemId = newUlid();
    await createItem(cookie, itemId, "会丢文件的那篇");
    await materializeSnapshot(env, id, NOW);
    // 人为制造"游标说有、文件却没了"
    await (env.ATTACHMENTS as R2Bucket).delete(`${SNAP_PREFIX}/${id}/${notePath(itemId)}`);
    const target = await makeTarget(id);

    const result = await pushOneRound(env, target, NOW);
    expect(result.pushed).toBe(0);
    expect(result.error).toContain("快照里还没有这个文件");
    expect((await readTarget(target.id)).last_result).toBe("failed");
  });
});

describe("推送状态机 · 批次与续推", () => {
  it("一轮只推一批（预算用尽就停），下一轮接着推", async () => {
    const { cookie, id } = await registerUser("owner");
    for (let i = 0; i < 5; i += 1) await createItem(cookie, newUlid(), `第 ${i} 篇`);
    await materializeSnapshot(env, id, NOW);
    const target = await makeTarget(id);

    // 显式给一个小预算：**默认的 40 装得下 5 篇**，那样测不到"批次用尽"这条路
    const first = await pushOneRound(env, target, NOW, 3);
    expect(first.pushed).toBe(3);
    expect(first.quotaStopped).toBe(true);
    expect(first.remaining).toBe(2);

    /*
      **必须重读目标行**再推第二轮。`target` 是建目标那一刻抓下来的快照，它的
      `cursor_seq` 还是 0；生产里每轮 Cron 都重新查（`runPushSlot` 走
      `SQL_SELECT_ENABLED_BACKUP_TARGETS`），所以拿旧对象连推会退化成"每轮从头再推一遍"。
    */
    const second = await pushOneRound(env, await readTarget(target.id), NOW + 1000, 3);
    expect(second.pushed).toBe(2);
    expect(second.remaining).toBe(0);
    expect((await readTarget(target.id)).last_result).toBe("ok");
  });

  it("**一轮的外部 PUT 不超过预算**（架构 §14.3 的硬限额）", async () => {
    const { cookie, id } = await registerUser("owner");
    for (let i = 0; i < 6; i += 1) await createItem(cookie, newUlid(), `第 ${i} 篇`);
    await materializeSnapshot(env, id, NOW);
    const target = await makeTarget(id);

    const result = await pushOneRound(env, target, NOW, 2);
    expect(result.pushed).toBe(2);
    expect(remote.puts.length).toBeLessThanOrEqual(2);
  });
});

describe("推送状态机 · 失败不跳号", () => {
  it("中间那条失败时，游标停在它**之前**（不变量 2）", async () => {
    const { cookie, id } = await registerUser("owner");
    const a = newUlid();
    const b = newUlid();
    await createItem(cookie, a, "第一篇");
    await createItem(cookie, b, "第二篇");
    await createItem(cookie, newUlid(), "第三篇");
    await materializeSnapshot(env, id, NOW);
    const target = await makeTarget(id);

    const seqOf = async (itemId: string): Promise<number> => {
      const row = await env.DB.prepare("SELECT sync_seq FROM items WHERE user_id = ? AND id = ?")
        .bind(id, itemId)
        .first<{ sync_seq: number }>();
      return row?.sync_seq ?? 0;
    };

    remote.failPutAt = 2; // 第二个 PUT 失败
    const result = await pushOneRound(env, target, NOW);
    expect(result.pushed).toBe(1);
    expect(result.error).not.toBeNull();

    const after = await readTarget(target.id);
    // 游标恰好等于**成功那一条**的 sync_seq
    expect(after.cursor_seq).toBe(await seqOf(a));
    expect(after.cursor_seq).toBeLessThan(await seqOf(b));
    expect(after.last_result).toBe("failed");
  });

  it("失败原因不含凭据（要平铺给用户看的）", async () => {
    const { cookie, id } = await registerUser("owner");
    await createItem(cookie, newUlid(), "会失败的那篇");
    await materializeSnapshot(env, id, NOW);
    const target = await makeTarget(id);
    remote.failPutAt = 1;

    const result = await pushOneRound(env, target, NOW);
    expect(result.error).toBeTruthy();
    expect(result.error).not.toContain("口令");
    expect((await readTarget(target.id)).last_error).not.toContain("口令");
  });
});

describe("推送状态机 · 远端删除", () => {
  it("默认档 append_only：一个远端 DELETE 都不发，记账留着", async () => {
    const { cookie, id } = await registerUser("owner");
    const itemId = newUlid();
    await createItem(cookie, itemId, "会被删掉的那篇");
    await materializeSnapshot(env, id, NOW);
    const target = await makeTarget(id, { delete_policy: "append_only" });

    const purgeText = await purge(cookie, itemId);
    expect(purgeText).toContain('"deleted":1');
    // 永久删除确实写了 `del:` 记账
    expect(await queuedDeletes(id)).toBe(1);

    const result = await pushOneRound(env, target, NOW + 1000);
    expect(result.deleted).toBe(0);
    expect(remote.deletes).toHaveLength(0);
    // 记账**还留着**——这正是 `append_only` 的意思：远端会积垃圾，但不会真丢
    expect(await queuedDeletes(id)).toBe(1);
  });

  it("sync 档才删远端，且删完把记账清掉", async () => {
    const { cookie, id } = await registerUser("owner");
    const itemId = newUlid();
    await createItem(cookie, itemId, "会被删掉的那篇");
    await materializeSnapshot(env, id, NOW);
    const target = await makeTarget(id, { delete_policy: "sync" });

    await purge(cookie, itemId);
    const result = await pushOneRound(env, target, NOW + 1000);
    expect(result.deleted).toBe(1);
    expect(remote.deletes).toHaveLength(1);
    expect(remote.deletes[0]).toContain(notePath(itemId));
    expect(await queuedDeletes(id)).toBe(0);
  });

  it("删目标**不删远端**（设计 §四：只清账本）", async () => {
    const { cookie, id } = await registerUser("owner");
    const target = await makeTarget(id);
    const res = await SELF.fetch(`${ORIGIN}/api/backup/targets/${target.id}`, {
      method: "DELETE",
      headers: headers(cookie),
    });
    expect(res.status).toBeLessThan(300);
    expect(remote.deletes).toHaveLength(0);
    expect(remote.puts).toHaveLength(0);
  });
});

describe("推送状态机 · 增量与续推", () => {
  it("删过之后正文变了，游标只推变化的那一条", async () => {
    const { cookie, id } = await registerUser("owner");
    const a = newUlid();
    const b = newUlid();
    await createItem(cookie, a, "第一篇");
    await createItem(cookie, b, "第二篇");
    await materializeSnapshot(env, id, NOW);
    const target = await makeTarget(id);

    expect((await pushOneRound(env, target, NOW)).pushed).toBe(2);

    await updateBody(cookie, b, "第二篇改过了", 1);
    await materializeSnapshot(env, id, NOW + 1000);
    // 同样要重读：游标是上一轮落进 D1 的
    const result = await pushOneRound(env, await readTarget(target.id), NOW + 1000);
    expect(result.pushed).toBe(1);
    expect(remote.puts).toHaveLength(3);
  });
});

describe("推送状态机 · 调度档位", () => {
  it("weekly 档：距上次不足 7 天就跳过", async () => {
    const { cookie, id } = await registerUser("owner");
    await createItem(cookie, newUlid(), "内容");
    await materializeSnapshot(env, id, NOW);
    const target = await makeTarget(id, { schedule: "weekly", last_run_at: NOW - 60_000 });

    const result = await pushOneRound(env, target, NOW);
    expect(result.skipped).toContain("推送日");
    expect(remote.puts).toHaveLength(0);
  });

  it("weekly 档：从来没推过就立刻到期", async () => {
    const { cookie, id } = await registerUser("owner");
    await createItem(cookie, newUlid(), "内容");
    await materializeSnapshot(env, id, NOW);
    const target = await makeTarget(id, { schedule: "weekly", last_run_at: null });

    const result = await pushOneRound(env, target, NOW);
    expect(result.skipped).toBeUndefined();
    expect(result.pushed).toBe(1);
  });

  it("手动「推一次」**忽略档位**（用户点了就是要现在推）", async () => {
    const { cookie, id } = await registerUser("owner");
    await createItem(cookie, newUlid(), "内容");
    await materializeSnapshot(env, id, NOW);
    const target = await makeTarget(id, { schedule: "weekly", last_run_at: NOW - 60_000 });

    // 同一行、同一档位：自动跳过，手动照推
    const auto = await pushOneRound(env, target, NOW);
    expect(auto.skipped).toContain("推送日");
    const manual = await pushOneRound(env, target, NOW, undefined, { ignoreSchedule: true });
    expect(manual.skipped).toBeUndefined();
    expect(manual.pushed).toBe(1);
  });

  it("手动「推一次」**仍然要过「快照有没有新东西」那一关**（不变量与谁触发无关）", async () => {
    const { cookie, id } = await registerUser("owner");
    await createItem(cookie, newUlid(), "内容");
    const target = await makeTarget(id);
    const manual = await pushOneRound(env, target, NOW, undefined, { ignoreSchedule: true });
    expect(manual.skipped).toContain("快照还没有新东西");
    expect(remote.puts).toHaveLength(0);
  });

  it("`total` 是**这次调用开始时**还欠的量（客户端靠它算进度比例）", async () => {
    const { cookie, id } = await registerUser("owner");
    for (let i = 0; i < 5; i += 1) await createItem(cookie, newUlid(), `第 ${i} 篇`);
    await materializeSnapshot(env, id, NOW);
    const target = await makeTarget(id);

    // 第一轮：开始时欠 5 个，推掉 2 个
    const first = await pushOneRound(env, target, NOW, 2);
    expect(first.total).toBe(5);
    expect(first.pushed).toBe(2);
    expect(first.remaining).toBe(3);

    // 第二轮：**重新数**（3 个），不是沿用上一轮那个 5
    const second = await pushOneRound(env, await readTarget(target.id), NOW + 1000, 2);
    expect(second.total).toBe(3);
    expect(second.pushed).toBe(2);
    expect(second.remaining).toBe(1);
  });

  it("`total` 只数**在上限之内**的那些（超出预算的下一轮再算）", async () => {
    const { cookie, id } = await registerUser("owner");
    for (let i = 0; i < 5; i += 1) await createItem(cookie, newUlid(), `第 ${i} 篇`);
    await materializeSnapshot(env, id, NOW);
    const target = await makeTarget(id);

    // 限死成 1 个：还欠 5 个，但这一轮只推 1 个
    const first = await pushOneRound(env, target, NOW, 1);
    expect(first.total).toBe(5);
    expect(first.pushed).toBe(1);
    expect(first.remaining).toBe(4);
  });
});

describe("推送状态机 · HTTP 接口", () => {
  it("POST /api/backup/targets/:id/run 返回一轮结果（推了几个、还剩几个）", async () => {
    const { cookie, id } = await registerUser("owner");
    await createItem(cookie, newUlid(), "内容");
    await materializeSnapshot(env, id, NOW);
    const target = await makeTarget(id);

    const res = await SELF.fetch(`${ORIGIN}/api/backup/targets/${target.id}/run`, {
      method: "POST",
      headers: headers(cookie),
    });
    expect(res.status).toBeLessThan(300);
    const body = (await res.json()) as BackupRunResult;
    expect(body.pushed).toBe(1);
    expect(body.total).toBe(1);
    expect(body.remaining).toBe(0);
    expect(body.error).toBeNull();
  });

  it("别人的目标 id → 404，且与「不存在」的响应逐字相同（不泄露 id 是否存在）", async () => {
    const { cookie } = await registerUser("owner");
    const missing = await SELF.fetch(`${ORIGIN}/api/backup/targets/${newUlid()}/run`, {
      method: "POST",
      headers: headers(cookie),
    });
    const mine = await SELF.fetch(`${ORIGIN}/api/backup/targets/${newUlid()}/run`, {
      method: "POST",
      headers: headers(cookie),
    });
    expect(missing.status).toBe(404);
    expect(mine.status).toBe(404);
    expect(await mine.text()).toBe(await missing.text());
    expect(remote.puts).toHaveLength(0);
  });

  it("没会话 → 401，一个请求都不该发出去", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/backup/targets/${newUlid()}/run`, {
      method: "POST",
      headers: { "X-Menote": "1", Origin: ORIGIN },
    });
    expect(res.status).toBe(401);
    expect(remote.puts).toHaveLength(0);
  });
});
