/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 回收站（M4-6；《M4 设计》§5.1 / §5.2）。
 *
 * 用例名与《M4 实施计划》M4-6 的验收清单对应。这一摊的关键不是"能删"，而是四条容易做错的语义：
 * 软删不动 `rev`、恢复回原位置（原夹没了回根）、永久删除**写墓碑且共享同一 `sync_seq`**、
 * 以及"语句数留有余量"（D1 的 45 条是硬上限）。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import {
  ITEM_META_HEADER,
  PERMANENT_DELETE_BATCH,
  base64UrlEncode,
  encodeItemWriteMeta,
  newUlid,
  type ItemWriteMeta,
} from "@menote/shared";
import { freshDatabase } from "./helpers";
import { permanentDeleteItems } from "../src/services/trash-purge";

const ORIGIN = "https://menote.test";

let seq = 1;

function nextDevice(): number {
  seq += 1;
  return seq;
}

function loginKey(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return base64UrlEncode(bytes);
}

function headers(cookie: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Menote": "1",
    Origin: ORIGIN,
    Cookie: cookie,
    ...extra,
  };
}

/** 各测试文件自带一份最小助手（与 items.test.ts / folders-vault.test.ts 的写法一致） */
async function registerUser(username: string, seed: number): Promise<{ cookie: string; id: string }> {
  const response = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
    body: JSON.stringify({ username, login_key: loginKey(seed) }),
  });
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookie = (setCookie.split(";")[0] ?? "").trim();
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
  const body = (await me.json()) as { id: string };
  return { cookie, id: body.id };
}

/** 打开注册开关（第一个账号之后需要它，否则第二个人注册不了） */
async function openRegistration(cookie: string): Promise<void> {
  const response = await SELF.fetch(`${ORIGIN}/api/admin/registration`, {
    method: "PUT",
    headers: headers(cookie),
    body: JSON.stringify({ open: true }),
  });
  if (response.status !== 200) throw new Error(`打开注册开关失败：${response.status}`);
}

/** 正文哈希：服务端会核对，缺了会 422 */
async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 建笔记：`PUT /api/items/:id`（元数据走请求头，正文是请求体）——与 items.test.ts 同一套形状 */
async function createNote(cookie: string, title: string, folderId: string | null = null): Promise<string> {
  const id = newUlid();
  const body = `---\nmenote:\n  type: note\n---\n\n# ${title}\n`;
  const meta: ItemWriteMeta = {
    type: "note",
    title,
    folder_id: folderId,
    tags: [],
    memo_at: null,
    is_task: 0,
    task_status: null,
    task_due: null,
    task_priority: null,
    content_hash: await contentHash(body),
  };
  const response = await SELF.fetch(`${ORIGIN}/api/items/${id}`, {
    method: "PUT",
    headers: headers(cookie, { [ITEM_META_HEADER]: encodeItemWriteMeta(meta) }),
    body,
  });
  if (response.status !== 200) throw new Error(`建笔记失败：${response.status}`);
  return id;
}

async function createFolder(cookie: string, name: string): Promise<string> {
  const id = newUlid();
  const response = await SELF.fetch(`${ORIGIN}/api/folders`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({ id, name, parent_id: null }),
  });
  if (response.status !== 200) throw new Error(`建文件夹失败：${response.status}`);
  return id;
}

async function deleteItem(cookie: string, id: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/items/${id}`, { method: "DELETE", headers: headers(cookie) });
}

async function restoreItem(cookie: string, id: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/items/${id}/restore`, {
    method: "POST",
    headers: headers(cookie),
    body: "{}",
  });
}

async function permanentDelete(cookie: string, ids: string[]): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/trash/permanent`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({ ids }),
  });
}

async function emptyTrashRequest(cookie: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/trash/empty`, {
    method: "POST",
    headers: headers(cookie),
    body: "{}",
  });
}

beforeEach(async () => {
  await freshDatabase();
});

describe("软删与恢复", () => {
  it("软删只写 deleted_at：rev 不变、meta_rev + 1、条目仍在库里", async () => {
    const user = await registerUser("Alice", nextDevice());
    await openRegistration(user.cookie);
    const id = await createNote(user.cookie, "要删的");

    const before = await env.DB.prepare("SELECT rev, meta_rev FROM items WHERE id = ?")
      .bind(id)
      .first<{ rev: number; meta_rev: number }>();

    const response = await deleteItem(user.cookie, id);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { deleted_at: number | null; meta_rev: number };
    expect(body.deleted_at).toBeGreaterThan(0);
    expect(body.meta_rev).toBe((before?.meta_rev ?? 0) + 1);

    const after = await env.DB.prepare(
      "SELECT rev, meta_rev, deleted_at FROM items WHERE id = ?",
    )
      .bind(id)
      .first<{ rev: number; meta_rev: number; deleted_at: number | null }>();
    expect(after?.rev).toBe(before?.rev); // 正文没动
    expect(after?.deleted_at).toBe(body.deleted_at);
    // 正文与版本都不受影响（回收站里的条目仍可被恢复成原样）
    const bodyRow = await env.DB.prepare("SELECT body FROM item_bodies WHERE item_id = ?")
      .bind(id)
      .first<{ body: string }>();
    expect(bodyRow?.body).toContain("要删的");
  });

  it("重复软删不白推 sync_seq（已经在回收站里就不再写一次）", async () => {
    const user = await registerUser("Alice", nextDevice());
    await openRegistration(user.cookie);
    const id = await createNote(user.cookie, "删两次");

    await deleteItem(user.cookie, id);
    const seqAfterFirst = await env.DB.prepare("SELECT sync_seq FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ sync_seq: number }>();
    await deleteItem(user.cookie, id);
    const seqAfterSecond = await env.DB.prepare("SELECT sync_seq FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ sync_seq: number }>();

    expect(seqAfterSecond?.sync_seq).toBe(seqAfterFirst?.sync_seq);
  });

  it("恢复回原文件夹", async () => {
    const user = await registerUser("Alice", nextDevice());
    await openRegistration(user.cookie);
    const folder = await createFolder(user.cookie, "工作");
    const id = await createNote(user.cookie, "在文件夹里", folder);

    await deleteItem(user.cookie, id);
    const response = await restoreItem(user.cookie, id);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { folder_id: string | null; deleted_at: number | null };
    expect(body.folder_id).toBe(folder);
    expect(body.deleted_at).toBeNull();
  });

  it("原文件夹已删除则回根目录（Q12 定案）", async () => {
    const user = await registerUser("Alice", nextDevice());
    await openRegistration(user.cookie);
    const folder = await createFolder(user.cookie, "会被删的夹");
    const id = await createNote(user.cookie, "在夹里", folder);
    await deleteItem(user.cookie, id);

    // 直接软删文件夹（文件夹删除入口属 M4-12 前端 + 后续服务端步骤，这里先造出"原夹没了"的状态）
    await env.DB.prepare("UPDATE folders SET deleted_at = ? WHERE id = ?")
      .bind(Date.now(), folder)
      .run();

    const response = await restoreItem(user.cookie, id);
    const body = (await response.json()) as { folder_id: string | null };
    expect(body.folder_id).toBeNull();
  });

  it("恢复分配新 sync_seq 且 meta_rev + 1（版本号 rev 不变）", async () => {
    const user = await registerUser("Alice", nextDevice());
    await openRegistration(user.cookie);
    const id = await createNote(user.cookie, "恢复的");
    await deleteItem(user.cookie, id);

    const beforeRestore = await env.DB.prepare(
      "SELECT rev, meta_rev, sync_seq FROM items WHERE id = ?",
    )
      .bind(id)
      .first<{ rev: number; meta_rev: number; sync_seq: number }>();

    await restoreItem(user.cookie, id);
    const after = await env.DB.prepare("SELECT rev, meta_rev, sync_seq FROM items WHERE id = ?")
      .bind(id)
      .first<{ rev: number; meta_rev: number; sync_seq: number }>();

    expect(after?.rev).toBe(beforeRestore?.rev);
    expect(after?.meta_rev).toBe((beforeRestore?.meta_rev ?? 0) + 1);
    expect(after?.sync_seq).toBeGreaterThan(beforeRestore?.sync_seq ?? 0);
  });

  it("恢复不自动恢复分享（占位用例：M4 只验它不报错，分享在 M5）", async () => {
    const user = await registerUser("Alice", nextDevice());
    await openRegistration(user.cookie);
    const id = await createNote(user.cookie, "分享占位");

    await deleteItem(user.cookie, id);
    const response = await restoreItem(user.cookie, id);
    expect(response.status).toBe(200);
    // 现在还没有 shares 表：这条用例钉住"将来加了分享，恢复也不能顺手把它复活"的语义位置
    expect(await env.DB.prepare("SELECT 1 AS x").first()).toBeTruthy();
  });
});

describe("永久删除", () => {
  it("永久删除写墓碑，且同批共享同一个 sync_seq", async () => {
    const user = await registerUser("Alice", nextDevice());
    await openRegistration(user.cookie);
    const first = await createNote(user.cookie, "甲");
    const second = await createNote(user.cookie, "乙");
    await deleteItem(user.cookie, first);
    await deleteItem(user.cookie, second);

    const response = await permanentDelete(user.cookie, [first, second]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { deleted: number; sync_seq: number };
    expect(body.deleted).toBe(2);

    const rows = await env.DB.prepare(
      "SELECT entity, entity_id, sync_seq FROM tombstones WHERE user_id = ? ORDER BY entity_id",
    )
      .bind(user.id)
      .all<{ entity: string; entity_id: string; sync_seq: number }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results.every((row) => row.entity === "item")).toBe(true);
    expect(new Set(rows.results.map((row) => row.sync_seq))).toEqual(new Set([body.sync_seq]));

    // 条目本体与正文都没了
    expect(await env.DB.prepare("SELECT 1 AS x FROM items WHERE id = ?").bind(first).first()).toBeNull();
    expect(
      await env.DB.prepare("SELECT 1 AS x FROM item_bodies WHERE item_id = ?").bind(first).first(),
    ).toBeNull();
  });

  it("永久删除把版本的 r2_key 全部登记 r2_gc_queue（R2 对象交给 Cron）", async () => {
    const user = await registerUser("Alice", nextDevice());
    await openRegistration(user.cookie);
    const id = await createNote(user.cookie, "带版本的");
    await deleteItem(user.cookie, id);

    // 造两条版本元数据（版本服务端属 M4-5，这里直接落库，专测"永久删除的登记行为"）
    for (const versionId of ["v1", "v2"]) {
      await env.DB.prepare(
        `INSERT INTO item_versions (id, item_id, user_id, rev, reason, codec, size_bytes, content_hash, r2_key, created_at)
         VALUES (?, ?, ?, 1, 'manual', 'gzip', 10, 'h', ?, 1)`,
      )
        .bind(versionId, id, user.id, `v/${user.id}/${id}/${versionId}`)
        .run();
    }

    await permanentDelete(user.cookie, [id]);

    const queued = await env.DB.prepare(
      "SELECT r2_key, reason FROM r2_gc_queue WHERE user_id = ? ORDER BY r2_key",
    )
      .bind(user.id)
      .all<{ r2_key: string; reason: string }>();
    expect(queued.results.map((row) => row.r2_key)).toEqual([
      `v/${user.id}/${id}/v1`,
      `v/${user.id}/${id}/v2`,
    ]);
    expect(queued.results.every((row) => row.reason === "delete")).toBe(true);

    // 版本元数据也删干净了
    const versions = await env.DB.prepare("SELECT COUNT(*) AS n FROM item_versions WHERE item_id = ?")
      .bind(id)
      .first<{ n: number }>();
    expect(versions?.n).toBe(0);
  });

  it("永久删除不动附件对象（留给每日维护的孤儿流程）", async () => {
    const user = await registerUser("Alice", nextDevice());
    await openRegistration(user.cookie);
    const id = await createNote(user.cookie, "带附件的");
    await env.DB.prepare(
      `INSERT INTO attachments (id, user_id, kind, sha256, r2_key, size_bytes, created_at, updated_at)
       VALUES ('att1', ?, 'original', 'h1', ?, 10, 1, 1)`,
    )
      .bind(user.id, `a/${user.id}/h1`)
      .run();
    await env.DB.prepare(
      "INSERT INTO attachment_refs (item_id, version_id, attachment_id, created_at) VALUES (?, NULL, 'att1', 1)",
    )
      .bind(id)
      .run();
    await deleteItem(user.cookie, id);
    await permanentDelete(user.cookie, [id]);

    // 引用没了，但附件本体与它的 R2 对象都还在（孤儿流程按"标孤儿 + 30 天"处理）
    const refs = await env.DB.prepare("SELECT COUNT(*) AS n FROM attachment_refs WHERE item_id = ?")
      .bind(id)
      .first<{ n: number }>();
    expect(refs?.n).toBe(0);
    const attachment = await env.DB.prepare("SELECT orphaned_at FROM attachments WHERE id = 'att1'")
      .first<{ orphaned_at: number | null }>();
    expect(attachment).not.toBeNull();
    expect(attachment?.orphaned_at).toBeNull(); // 还没标孤儿
    const queued = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM r2_gc_queue WHERE r2_key = ?",
    )
      .bind(`a/${user.id}/h1`)
      .first<{ n: number }>();
    expect(queued?.n).toBe(0); // 附件对象不进这一批的删除队列
  });

  it(`单请求超过 ${PERMANENT_DELETE_BATCH} 条被拒（客户端分批判定边界）`, async () => {
    const user = await registerUser("Alice", nextDevice());
    await openRegistration(user.cookie);
    const ids = Array.from({ length: PERMANENT_DELETE_BATCH + 1 }, (_, index) =>
      `01JC${String(index).padStart(24, "0")}`,
    );

    const response = await permanentDelete(user.cookie, ids);
    expect(response.status).toBe(422);
  });

  it("清空回收站：分批删完，且不动没进回收站的条目", async () => {
    const user = await registerUser("Alice", nextDevice());
    await openRegistration(user.cookie);
    const trashIds: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const id = await createNote(user.cookie, `回收站里的 ${index}`);
      trashIds.push(id);
      await deleteItem(user.cookie, id);
    }
    const kept = await createNote(user.cookie, "不在回收站");

    const response = await emptyTrashRequest(user.cookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { deleted: number; batches: number };
    expect(body.deleted).toBe(12);
    expect(body.batches).toBe(2); // 12 条 = 10 + 2

    expect(await env.DB.prepare("SELECT 1 AS x FROM items WHERE id = ?").bind(kept).first()).toBeTruthy();
    const tombstones = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM tombstones WHERE user_id = ?",
    )
      .bind(user.id)
      .first<{ n: number }>();
    expect(tombstones?.n).toBe(12);
    // 显式放宽超时（v0.8.17）：本用例天生要串行发 13 个请求（建 12 条 + 清空），
    // 实测满负载下耗时 5187ms、正好摸到 vitest 默认的 5s，而单独跑只要 526ms。
    // 那是负载不是逻辑——别让它在 CI 上随机变红。
  }, 20_000);

  it("永久删除的 D1 语句数留有余量（10 条时打印实际条数并断言 ≤45）", async () => {
    // 用最小替身只数语句：真库跑的是同一批语句，这里要钉的是"语句预算"这个容易悄悄变胖的指标
    const batches: unknown[][] = [];
    const stub = {
      prepare: () => ({
        bind: (...args: unknown[]) => ({
          first: async () => ({ next: 1 }),
          // 批 3 加了「远端删除记账」：删之前要先查哪些 id 真的存在
          all: async () => ({ results: args.slice(2, 12).map((id) => ({ id: String(id) })) }),
          __args: args,
        }),
      }),
      batch: async (statements: unknown[]) => {
        batches.push(statements);
        return statements.map(() => ({ meta: { changes: 0 } }));
      },
    };

    const ids = Array.from({ length: PERMANENT_DELETE_BATCH }, (_, index) =>
      newUlid().replace(/.$/, String(index % 10)),
    );
    const result = await permanentDeleteItems(stub as unknown as D1Database, "u1", ids, 1_000);

    expect(result.sync_seq).toBe(1);
    expect(batches).toHaveLength(1);
    const statementCount = batches[0]?.length ?? 0;
    // 失败时把实际条数打出来，便于判断是哪一步变胖了
    expect(statementCount, `永久删除 10 条用了 ${statementCount} 条语句`).toBeLessThanOrEqual(45);
    // 2 墓碑（条目 + 文件夹）+ 1 计数器 + 1 GC 登记 + 5 删除（引用/版本/正文/条目/文件夹）
    // + 1 外部备份的删除记账（批 3 加的）
    expect(statementCount).toBe(10);
  });
});

describe("文件夹连同内容进回收站（M4-6 后半）", () => {
  async function deleteFolder(cookie: string, id: string): Promise<Response> {
    return SELF.fetch(`${ORIGIN}/api/folders/${id}`, { method: "DELETE", headers: headers(cookie) });
  }

  async function restoreFolderRequest(cookie: string, id: string): Promise<Response> {
    return SELF.fetch(`${ORIGIN}/api/folders/${id}/restore`, {
      method: "POST",
      headers: headers(cookie),
      body: "{}",
    });
  }

  async function createChildFolder(cookie: string, name: string, parentId: string): Promise<string> {
    const id = newUlid();
    const response = await SELF.fetch(`${ORIGIN}/api/folders`, {
      method: "POST",
      headers: headers(cookie),
      body: JSON.stringify({ id, name, parent_id: parentId }),
    });
    if (response.status !== 200) throw new Error(`建子文件夹失败：${response.status}`);
    return id;
  }

  it("删文件夹：自己 + 子夹 + 里面的条目一起进回收站，且共享同一个 sync_seq", async () => {
    const user = await registerUser("Alice", nextDevice());
    await openRegistration(user.cookie);
    const parent = await createFolder(user.cookie, "项目");
    const child = await createChildFolder(user.cookie, "子项", parent);
    const inParent = await createNote(user.cookie, "父夹里的", parent);
    const inChild = await createNote(user.cookie, "子夹里的", child);
    const outside = await createNote(user.cookie, "不在夹里的");

    const response = await deleteFolder(user.cookie, parent);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { folders: number; items: number; deleted_at: number };
    expect(body.folders).toBe(2); // 自己 + 子夹
    expect(body.items).toBe(2); // 两个夹各一条
    expect(body.deleted_at).toBeGreaterThan(0);

    const rows = await env.DB.prepare(
      "SELECT id, deleted_at, sync_seq FROM items WHERE user_id = ? ORDER BY id",
    )
      .bind(user.id)
      .all<{ id: string; deleted_at: number | null; sync_seq: number }>();
    const byId = new Map(rows.results.map((row) => [row.id, row]));
    expect(byId.get(inParent)?.deleted_at).toBe(body.deleted_at);
    expect(byId.get(inChild)?.deleted_at).toBe(body.deleted_at);
    expect(byId.get(outside)?.deleted_at).toBeNull(); // 夹外的条目不受影响
    // 同一个逻辑写 → 同一个 sync_seq
    expect(byId.get(inParent)?.sync_seq).toBe(byId.get(inChild)?.sync_seq);

    const folders = await env.DB.prepare(
      "SELECT id, deleted_at FROM folders WHERE user_id = ? AND is_enc_space = 0",
    )
      .bind(user.id)
      .all<{ id: string; deleted_at: number | null }>();
    expect(folders.results.every((row) => row.deleted_at === body.deleted_at)).toBe(true);
  });

  it("恢复文件夹：父夹没了则回根目录；里面的条目仍留在回收站（各自恢复）", async () => {
    const user = await registerUser("Alice", nextDevice());
    await openRegistration(user.cookie);
    const parent = await createFolder(user.cookie, "项目");
    const child = await createChildFolder(user.cookie, "子项", parent);
    const note = await createNote(user.cookie, "子夹里的", child);

    await deleteFolder(user.cookie, parent);

    // 子夹先恢复：父夹还在回收站里 → 回根目录
    const childRestore = await restoreFolderRequest(user.cookie, child);
    expect(childRestore.status).toBe(200);
    const childBody = (await childRestore.json()) as { parent_id: string | null };
    expect(childBody.parent_id).toBeNull();

    // 父夹恢复后，子夹不会自动回到它下面（恢复只恢复这个夹本身）
    await restoreFolderRequest(user.cookie, parent);
    const childRow = await env.DB.prepare("SELECT parent_id FROM folders WHERE id = ?")
      .bind(child)
      .first<{ parent_id: string | null }>();
    expect(childRow?.parent_id).toBeNull();

    // 条目仍在回收站：要单独恢复（恢复时原夹已回来，所以回原位置）
    const noteRow = await env.DB.prepare("SELECT deleted_at FROM items WHERE id = ?")
      .bind(note)
      .first<{ deleted_at: number | null }>();
    expect(noteRow?.deleted_at).not.toBeNull();
    const restored = await restoreItem(user.cookie, note);
    const restoredBody = (await restored.json()) as { folder_id: string | null };
    expect(restoredBody.folder_id).toBe(child);
  });

  it("加密空间行不可删（M3-6 留下的守卫，删除入口到 M4 才有）", async () => {
    const user = await registerUser("Alice", nextDevice());
    const space = await env.DB.prepare(
      "SELECT id FROM folders WHERE user_id = ? AND is_enc_space = 1",
    )
      .bind(user.id)
      .first<{ id: string }>();
    expect(space).not.toBeNull();

    const response = await deleteFolder(user.cookie, space?.id ?? "");
    expect(response.status).toBe(422);
    const body = (await response.json()) as { message?: string; detail?: { reason?: string } };
    expect(body.message ?? "").toContain("加密空间不能删除");

    const row = await env.DB.prepare("SELECT deleted_at FROM folders WHERE id = ?")
      .bind(space?.id ?? "")
      .first<{ deleted_at: number | null }>();
    expect(row?.deleted_at).toBeNull();
  });

  it("删别人的文件夹 404、重复删除不白推 sync_seq", async () => {
    const alice = await registerUser("Alice", nextDevice());
    await openRegistration(alice.cookie);
    const bob = await registerUser("Bob", nextDevice());
    const folder = await createFolder(alice.cookie, "Alice 的夹");

    expect((await deleteFolder(bob.cookie, folder)).status).toBe(404);

    expect((await deleteFolder(alice.cookie, folder)).status).toBe(200);
    const seq1 = await env.DB.prepare("SELECT sync_seq FROM users WHERE id = ?")
      .bind(alice.id)
      .first<{ sync_seq: number }>();
    expect((await deleteFolder(alice.cookie, folder)).status).toBe(200);
    const seq2 = await env.DB.prepare("SELECT sync_seq FROM users WHERE id = ?")
      .bind(alice.id)
      .first<{ sync_seq: number }>();
    expect(seq2?.sync_seq).toBe(seq1?.sync_seq);
  });
});

describe("多用户隔离与鉴权", () => {
  it("不能删/恢复别人的条目；未登录 401", async () => {
    const alice = await registerUser("Alice", nextDevice());
    await openRegistration(alice.cookie);
    const bob = await registerUser("Bob", nextDevice());

    const id = await createNote(alice.cookie, "Alice 的");
    const bobDelete = await deleteItem(bob.cookie, id);
    expect(bobDelete.status).toBe(404);

    // 未登录：带上 CSRF 头（否则会先被 CSRF 守卫拦成 403，测不到鉴权这一层）
    const anonymous = await SELF.fetch(`${ORIGIN}/api/items/${id}`, {
      method: "DELETE",
      headers: { "X-Menote": "1", Origin: ORIGIN },
    });
    expect(anonymous.status).toBe(401);

    // Alice 自己删得掉，Bob 也恢复不了
    expect((await deleteItem(alice.cookie, id)).status).toBe(200);
    expect((await restoreItem(bob.cookie, id)).status).toBe(404);
  });
});
