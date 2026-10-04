/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 孤儿附件「**跳过保留期立即删除**」（v0.8.3；用户 2026-10-04 拍板「有」）。
 *
 * 30 天保留期是 M4 的安全属性（"删错了还有救"），本轮**不删它**——补的是一条
 * **用户明确知道自己要放弃这层保护**时才走的路径。所以钉的是三道闸：
 * ① 只删**无引用**的（跳过保留期 ≠ 跳过「在用」这个判定）；
 * ② **删除时再判一次**无引用——预告与真删之间可能隔着几秒，用户可能刚好把附件插回去；
 * ③ **只清本用户**（跨用户串数据是红线）。
 *
 * 外加一条：**预告的数与真删的数用同一个口径**，否则"预告 3 个、真删 7 个"比不提供这功能更糟。
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ATTACHMENT_ORPHAN_RETENTION_DAYS, DAY_MS } from "@menote/shared";
import { planAttachmentPurge, purgeOrphanedAttachments } from "../src/services/attachment-purge";
import { freshDatabase } from "./helpers";

const NOW = Date.UTC(2026, 9, 4, 6, 0, 0);

async function seedUser(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, username, role, auth_salt, auth_kdf, auth_verifier, sync_seq, tombstone_floor, created_at, updated_at)
     VALUES (?, ?, 'owner', X'00', 'PBKDF2-SHA-256', X'00', 0, 0, 1, 1)`,
  )
    .bind(id, `user-${id}`)
    .run();
}

/**
 * 造一条附件。
 *
 * `orphanedAt = null` 且 `withRef` 为真 = 正在被引用（**不可删**）；
 * `orphanedAt = null` 且 `withRef` 为假 = 没被引用但**还没标**（标没标不影响"立即删除"）；
 * 其余 = 已标孤儿。
 */
async function seedAttachment(options: {
  id: string;
  userId: string;
  orphanedAt: number | null;
  withRef?: boolean;
  sizeBytes?: number;
  itemId?: string;
}): Promise<void> {
  const { id, userId, orphanedAt, withRef = false, sizeBytes = 10, itemId } = options;
  await env.DB.prepare(
    `INSERT INTO attachments (id, user_id, kind, parent_id, sha256, r2_key, mime, size_bytes,
       width, height, filename, orphaned_at, created_at, updated_at)
     VALUES (?, ?, 'original', NULL, ?, ?, 'image/png', ?, NULL, NULL, 'a.png', ?, 1, 1)`,
  )
    .bind(id, userId, id.padEnd(64, "0").slice(0, 64), `a/${userId}/${id}`, sizeBytes, orphanedAt)
    .run();
  if (withRef) {
    const target = itemId ?? `item-for-${id}`;
    await env.DB.prepare(
      "INSERT OR IGNORE INTO items (id, user_id, type, title, enc_self, in_enc_space, size_bytes, content_hash, tags, is_task, pinned, starred, rev, meta_rev, sync_seq, created_at, updated_at) VALUES (?, ?, 'note', 't', 0, 0, 1, 'h', '[]', 0, 0, 0, 1, 1, 1, 1, 1)",
    )
      .bind(target, userId)
      .run();
    await env.DB.prepare(
      "INSERT INTO attachment_refs (item_id, version_id, attachment_id, created_at) VALUES (?, NULL, ?, 1)",
    )
      .bind(target, id)
      .run();
  }
}

async function remainingOf(userId: string, id: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM attachments WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first();
  return row !== null;
}

beforeEach(async () => {
  await freshDatabase();
  await seedUser("u1");
  await seedUser("u2");
});

describe("立即删除 · 预告", () => {
  it("数的是**全部无引用的附件**，不问标没标、也不问保留期", async () => {
    await seedAttachment({ id: "a1", userId: "u1", orphanedAt: null }); // 没标、没引用
    await seedAttachment({ id: "a2", userId: "u1", orphanedAt: NOW - 2 * DAY_MS }); // 标了、还在保留期
    await seedAttachment({ id: "a3", userId: "u1", orphanedAt: NOW - 90 * DAY_MS }); // 标了、早过期
    await seedAttachment({ id: "a4", userId: "u1", orphanedAt: NOW, withRef: true }); // 在用

    const plan = await planAttachmentPurge(env.DB, "u1", NOW);
    expect(plan.count).toBe(3);
    // 三个里面只有 a2 还在保留期里 → 界面要拿这个数告诉用户"你要放弃几层保护"
    expect(plan.withinRetention).toBe(1);
  });

  it("**只数本用户**（别人的孤儿不进这个数）", async () => {
    await seedAttachment({ id: "a1", userId: "u1", orphanedAt: null });
    await seedAttachment({ id: "b1", userId: "u2", orphanedAt: null });
    await seedAttachment({ id: "b2", userId: "u2", orphanedAt: null });

    expect((await planAttachmentPurge(env.DB, "u1", NOW)).count).toBe(1);
  });

  it("在用的附件**不计入**（跳过保留期 ≠ 跳过「在用」）", async () => {
    await seedAttachment({ id: "a1", userId: "u1", orphanedAt: NOW, withRef: true });
    expect((await planAttachmentPurge(env.DB, "u1", NOW)).count).toBe(0);
  });

  it("bytes 与 count 同源（界面要拿它说「释放多少空间」）", async () => {
    await seedAttachment({ id: "a1", userId: "u1", orphanedAt: null, sizeBytes: 2 * 1024 * 1024 });
    await seedAttachment({ id: "a2", userId: "u1", orphanedAt: null, sizeBytes: 512 * 1024 });
    const plan = await planAttachmentPurge(env.DB, "u1", NOW);
    expect(plan.count).toBe(2);
    expect(plan.bytes).toBe(2.5 * 1024 * 1024);
  });
});

describe("立即删除 · 真删", () => {
  it("删掉本用户所有无引用附件，**并把对象登记进 GC 队列**（due_at = now）", async () => {
    await seedAttachment({ id: "a1", userId: "u1", orphanedAt: NOW - 2 * DAY_MS, sizeBytes: 1024 });
    await seedAttachment({ id: "a2", userId: "u1", orphanedAt: NOW - 90 * DAY_MS, sizeBytes: 2048 });

    const result = await purgeOrphanedAttachments(env.DB, "u1", NOW);
    expect(result).toEqual({ removed: 2, bytes: 3072 });
    expect(await remainingOf("u1", "a1")).toBe(false);
    expect(await remainingOf("u1", "a2")).toBe(false);

    const queued = await env.DB.prepare("SELECT r2_key, due_at FROM r2_gc_queue WHERE user_id = ? ORDER BY r2_key")
      .bind("u1")
      .all<{ r2_key: string; due_at: number }>();
    expect(queued.results).toHaveLength(2);
    // **不，当场就删 R2**：交给 Cron ②，这样请求不会卡在对象存储上
    for (const row of queued.results ?? []) expect(row.due_at).toBe(NOW);
  });

  it("**不删别人的**（只清本用户是红线，用例专门一条）", async () => {
    await seedAttachment({ id: "a1", userId: "u1", orphanedAt: null });
    await seedAttachment({ id: "b1", userId: "u2", orphanedAt: null });

    const result = await purgeOrphanedAttachments(env.DB, "u1", NOW);
    expect(result.removed).toBe(1);
    expect(await remainingOf("u2", "b1")).toBe(true);
  });

  it("**在用的一个都不删**——保留期可以跳过，「在用」不能跳", async () => {
    await seedAttachment({ id: "a1", userId: "u1", orphanedAt: null, withRef: true });
    await seedAttachment({ id: "a2", userId: "u1", orphanedAt: null });

    const result = await purgeOrphanedAttachments(env.DB, "u1", NOW);
    expect(result.removed).toBe(1);
    expect(await remainingOf("u1", "a1")).toBe(true);
  });

  it("**取出来到删它之间被重新引用的，那一行必须留着**（闸二）", async () => {
    // 预告与真删之间隔着"用户把附件插回了笔记"：这里直接造出那个中间态
    await seedAttachment({ id: "a1", userId: "u1", orphanedAt: null });
    const plan = await planAttachmentPurge(env.DB, "u1", NOW);
    expect(plan.count).toBe(1);

    // 用户在这几秒里把 a1 插回了某篇笔记
    await seedAttachment({ id: "dummy", userId: "u1", orphanedAt: null, withRef: true, itemId: "it1" });
    await env.DB.prepare("INSERT INTO attachment_refs (item_id, version_id, attachment_id, created_at) VALUES ('it1', NULL, 'a1', 1)").run();

    const result = await purgeOrphanedAttachments(env.DB, "u1", NOW);
    expect(result.removed).toBe(0);
    expect(await remainingOf("u1", "a1")).toBe(true);
  });

  it("**预告的数与真删的数对得上**（对不上就说明两道闸口径分家了）", async () => {
    await seedAttachment({ id: "a1", userId: "u1", orphanedAt: null });
    await seedAttachment({ id: "a2", userId: "u1", orphanedAt: NOW - 5 * DAY_MS });
    await seedAttachment({ id: "a3", userId: "u1", orphanedAt: NOW - 99 * DAY_MS });
    await seedAttachment({ id: "a4", userId: "u1", orphanedAt: NOW, withRef: true });

    const plan = await planAttachmentPurge(env.DB, "u1", NOW);
    const result = await purgeOrphanedAttachments(env.DB, "u1", NOW);
    expect(result.removed).toBe(plan.count);
    expect(result.bytes).toBe(plan.bytes);
  });

  it("没有孤儿时是空操作（不该报错、也不该白跑）", async () => {
    await seedAttachment({ id: "a1", userId: "u1", orphanedAt: NOW, withRef: true });
    expect(await planAttachmentPurge(env.DB, "u1", NOW)).toEqual({
      count: 0,
      bytes: 0,
      withinRetention: 0,
    });
    expect(await purgeOrphanedAttachments(env.DB, "u1", NOW)).toEqual({ removed: 0, bytes: 0 });
  });

  it("它与 30 天保留期是**并存**的两条路：保留期不动，立即删除只多一个入口", async () => {
    // 这条钉住"做立即删除没有把保留期改掉"：标了 1 天的孤儿，两条路都还轮不到它被删
    await seedAttachment({ id: "a1", userId: "u1", orphanedAt: NOW - DAY_MS });
    const plan = await planAttachmentPurge(env.DB, "u1", NOW);
    expect(plan.withinRetention).toBe(1);
    // 保留期是 30 天：它离"自动可删"还早着
    expect(ATTACHMENT_ORPHAN_RETENTION_DAYS).toBe(30);
  });
});
