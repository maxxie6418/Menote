/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * MCP 写类工具（M6 批 3）的集成用例：六个工具的机制。
 *
 * 盯的是设计稿 §六-3~§七 的底线：
 * - **乐观锁**：`expected_rev` / `expected_meta_rev` 必带，冲突时报出当前 `rev`；
 *   `on_conflict: "copy"` 生成**新条目**且原条目一个字不动；
 * - **幂等**：同 `operation_id` + 同参数 → 同一结果；同 ID 异参 → 报错；
 *   字段顺序换了不算「另一组参数」；**冲突之后同一个 ID 还能重试**（幂等行必须被清掉）；
 * - **写前封存**：改动正文前留一条 `pre_mcp` 版本（`keep = 1`，10 分钟内不重复）；
 * - **审计**：只记写类调用，四种结果都记，且与写入**同一个 batch**；
 * - **512 KB 门槛**：超了禁整篇 / 小节处理，但区间读与 SQL 追加仍可用。
 *
 * 权限位与可见性的用例在 `mcp-write-scope.test.ts`。
 */
import { ROW_ID_COLUMN, renderTableDocument } from "@menote/mdcore";
import { newUlid } from "@menote/shared";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  auditFor,
  bodyOf,
  call,
  countAudit,
  failure,
  makeFolder,
  makeToken,
  ok,
  preMcpVersions,
  registerUser,
  seedItem,
} from "./mcp-helpers";
import { freshDatabase } from "./helpers";

beforeEach(async () => {
  await freshDatabase();
});

describe("create_item（批 3）", () => {
  it("建出条目：rev=1、哈希服务端自算、审计与幂等同批落库", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);

    const result = ok(
      (await call(secret, "create_item", { type: "note", title: "新笔记", content: "正文", operation_id: "op-1" })).body,
    );
    expect(result.rev).toBe(1);
    const id = String(result.id);

    // 服务端算的哈希要对得上正文（幂等与重放判定都靠它）
    const row = await env.DB.prepare("SELECT content_hash, rev FROM items WHERE id = ?").bind(id).first<{
      content_hash: string;
      rev: number;
    }>();
    expect(row?.content_hash).toHaveLength(64);
    expect(row?.rev).toBe(1);
    // 标题进了 md 的顶层 `title:`（规范数据在 md，列只是派生列——2026-10-04）
    expect(await bodyOf(id)).toBe("---\ntitle: 新笔记\n---\n\n正文");

    const audit = await auditFor(id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.tool).toBe("create_item");
    expect(audit[0]?.result).toBe("ok");
    expect(audit[0]?.rev_after).toBe(1);

    const op = await env.DB
      .prepare("SELECT tool FROM mcp_operations WHERE user_id = ? AND operation_id = ?")
      .bind(userId, "op-1")
      .first<{ tool: string }>();
    expect(op?.tool).toBe("create_item");
  });

  /**
   * `title` / `tags` / `task` 必须**一并写进 md**（2026-10-04）。
   *
   * 这三个在服务端只是派生列，规范数据在 md。只写列的话，客户端按 md 派生时读不到
   * （`deriveTitle` 报 `present: false`、`deriveTags` 空），导出的 `.md` 也不带——
   * 与外部 Markdown 工具的互通就断在这里。
   */
  it("title / tags / task 一并进 md 的 front matter", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);

    const result = ok(
      (
        await call(secret, "create_item", {
          type: "note",
          title: "读书笔记",
          content: "正文",
          tags: ["科幻"],
          task: { status: "todo" },
          operation_id: "op-fm",
        })
      ).body,
    );
    const id = String(result.id);
    const body = await bodyOf(id);

    expect(body).toContain("title: 读书笔记");
    expect(body).toContain("tags: [科幻]");
    expect(body).toContain("  task:\n    status: todo");
    // md 带得动，列也得对（两边不一致 = 下次同步把值弹回去）
    const row = await env.DB.prepare("SELECT title, tags, is_task FROM items WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .first<{ title: string; tags: string; is_task: number }>();
    expect(row?.title).toBe("读书笔记");
    expect(JSON.parse(row?.tags ?? "[]")).toEqual(["科幻"]);
    expect(row?.is_task).toBe(1);
  });

  it("Memo 不写 title: 键（items.title 必须为 null）", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);

    const result = ok(
      (
        await call(secret, "create_item", {
          type: "memo",
          content: "随手记",
          operation_id: "op-memo",
        })
      ).body,
    );

    expect(await bodyOf(String(result.id))).not.toContain("title:");
  });

  it("agent 自己写的 front matter 原样保留，只改命中的键", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);

    const result = ok(
      (
        await call(secret, "create_item", {
          type: "note",
          title: "新标题",
          content: '---\nsource: "https://example.com/a"\n---\n\n正文',
          operation_id: "op-keep",
        })
      ).body,
    );
    const body = await bodyOf(String(result.id));

    expect(body).toContain('source: "https://example.com/a"');
    expect(body).toContain("title: 新标题");
    expect(body).toContain("正文");
  });

  it("幂等：同 ID + 同参数 → 同一结果且不新建第二条", async () => {    const { cookie } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const args = { type: "note", title: "甲", content: "正文", operation_id: "same" };

    const first = ok((await call(secret, "create_item", args)).body);
    const second = ok((await call(secret, "create_item", args)).body);
    expect(second.id).toBe(first.id);

    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM items").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("幂等：同 ID 配了不同参数 → 报错，且不覆盖第一次的结果", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const first = ok((await call(secret, "create_item", { type: "note", title: "甲", content: "a", operation_id: "x" })).body);
    expect(
      failure((await call(secret, "create_item", { type: "note", title: "乙", content: "b", operation_id: "x" })).body),
    ).toContain("另一组参数");

    const row = await env.DB.prepare("SELECT title FROM items WHERE id = ?").bind(String(first.id)).first<{ title: string }>();
    expect(row?.title).toBe("甲");
  });

  it("参数摘要按 key 排序：字段书写顺序换了不算「另一组参数」", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const first = ok((await call(secret, "create_item", { type: "note", title: "甲", content: "a", operation_id: "ord" })).body);
    // 同样的字段、不同的书写顺序 → 必须判成重放
    const second = ok((await call(secret, "create_item", { operation_id: "ord", content: "a", title: "甲", type: "note" })).body);
    expect(second.id).toBe(first.id);
  });

  it("缺 operation_id 报错；文件夹必须已存在且在范围内", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    expect(failure((await call(secret, "create_item", { type: "note", title: "甲", content: "a" })).body)).toContain(
      "operation_id",
    );
    expect(
      failure(
        (await call(secret, "create_item", { type: "note", title: "甲", content: "a", operation_id: "y", folder_id: newUlid() })).body,
      ),
    ).toContain("文件夹不存在");

    const folder = await makeFolder(userId, "正常");
    const made = ok(
      (await call(secret, "create_item", { type: "note", title: "甲", content: "a", operation_id: "z", folder_id: folder })).body,
    );
    expect(made.id).toBeTruthy();
  });
});

describe("append_to_item（批 3）", () => {
  it("追加到文末：rev 递增、写前留 pre_mcp 版本、审计 ok", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "原来", { title: "甲" });

    const result = ok((await call(secret, "append_to_item", { id, text: "追加", operation_id: "a1" })).body);
    expect(result.rev).toBe(2);
    expect(await bodyOf(id)).toBe("原来追加");

    // 写前封存：原内容留了一条 keep=1 的版本（这是"可在版本历史撤回"的前提）
    const versions = await preMcpVersions(id);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.keep).toBe(1);
    expect(versions[0]?.rev).toBe(1);
    expect((await auditFor(id))[0]?.result).toBe("ok");
  });

  it("追加到小节末尾：不吃掉节间分隔", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "## 甲\n\n甲正文\n\n## 乙\n\n乙正文", { title: "多节" });

    ok((await call(secret, "append_to_item", { id, text: "补一句", section: "甲", operation_id: "s1" })).body);
    // 关键断言：分隔空行还在，正文没和下一个标题粘在一起
    expect(await bodyOf(id)).toBe("## 甲\n\n甲正文\n补一句\n\n## 乙\n\n乙正文");
  });

  it("幂等：同 operation_id 追加两次只加一次", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "x", { title: "甲" });

    const first = ok((await call(secret, "append_to_item", { id, text: "y", operation_id: "dup" })).body);
    const second = ok((await call(secret, "append_to_item", { id, text: "y", operation_id: "dup" })).body);
    expect(second.rev).toBe(first.rev);
    expect(await bodyOf(id)).toBe("xy");
  });

  it("10 分钟内不重复封 pre_mcp 版本；超过就再封一条", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "a", { title: "甲" });

    ok((await call(secret, "append_to_item", { id, text: "b", operation_id: "t1" })).body);
    ok((await call(secret, "append_to_item", { id, text: "c", operation_id: "t2" })).body);
    expect(await preMcpVersions(id)).toHaveLength(1);

    // 把上一条 pre_mcp 版本推到 11 分钟前 → 应当再封一条
    await env.DB
      .prepare("UPDATE item_versions SET created_at = created_at - 660000 WHERE reason = 'pre_mcp' AND item_id = ?")
      .bind(id)
      .run();
    ok((await call(secret, "append_to_item", { id, text: "d", operation_id: "t3" })).body);
    expect(await preMcpVersions(id)).toHaveLength(2);
  });
});

describe("edit_item（批 3）", () => {
  it("replace_text：唯一命中才改；出现两次就报错（不替 agent 挑第一处）", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "唯一标记", { title: "甲" });

    const changed = ok(
      (await call(secret, "edit_item", { id, expected_rev: 1, mode: "replace_text", from: "唯一标记", to: "改过" })).body,
    );
    expect(changed.changed).toBe(true);
    expect(await bodyOf(id)).toBe("改过");

    const twice = await seedItem(userId, newUlid(), "X X", { title: "乙" });
    expect(
      failure((await call(secret, "edit_item", { id: twice, expected_rev: 1, mode: "replace_text", from: "X", to: "Y" })).body),
    ).toContain("出现了多次");
    expect(await bodyOf(twice)).toBe("X X");
  });

  it("乐观锁：带旧 rev 被拒，报出当前 rev", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "甲", { title: "甲" });
    await call(secret, "append_to_item", { id, text: "乙", operation_id: "p" });

    // 现在 rev=2，传 1 → 冲突，且提示要重新读取
    const message = failure((await call(secret, "edit_item", { id, expected_rev: 1, mode: "replace_all", content: "丙" })).body);
    expect(message).toContain("版本冲突");
    expect(message).toContain("rev = 2");
    expect(await bodyOf(id)).toBe("甲乙");
  });

  it("缺 expected_rev 直接报错（不给它就不让改）", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "甲", { title: "甲" });
    expect(failure((await call(secret, "edit_item", { id, mode: "replace_all", content: "乙" })).body)).toContain(
      "expected_rev",
    );
  });

  it("on_conflict: copy 生成新条目，原条目一个字都不动", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "原内容", { title: "甲" });

    const copy = ok(
      (await call(secret, "edit_item", { id, expected_rev: 99, mode: "replace_all", content: "新内容", on_conflict: "copy" })).body,
    );
    expect(copy.conflict_copy).toBe(true);
    expect(String(copy.source_id)).toBe(id);
    expect(String(copy.id)).not.toBe(id);

    expect(await bodyOf(id)).toBe("原内容");
    expect(await bodyOf(String(copy.id))).toBe("新内容");
  });

  it("replace_section 换整节；merge_properties 合 YAML；restore_version 恢复", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);

    const sectioned = await seedItem(userId, newUlid(), "## 甲\n\n旧甲\n\n## 乙\n\n乙", { title: "多节" });
    const r1 = ok(
      (await call(secret, "edit_item", { id: sectioned, expected_rev: 1, mode: "replace_section", section: "甲", content: "## 甲\n\n新甲" })).body,
    );
    expect(r1.rev).toBe(2);
    expect(await bodyOf(sectioned)).toBe("## 甲\n\n新甲\n\n## 乙\n\n乙");

    const props = await seedItem(userId, newUlid(), "正文", { title: "带属性" });
    ok(
      (await call(secret, "edit_item", { id: props, expected_rev: 1, mode: "merge_properties", properties: { tags: ["新标签"] } })).body,
    );
    expect(await bodyOf(props)).toContain("新标签");

    // restore_version：先改一次产生 pre_mcp 版本，再恢复回去
    const restorable = await seedItem(userId, newUlid(), "第一版", { title: "可恢复" });
    ok((await call(secret, "edit_item", { id: restorable, expected_rev: 1, mode: "replace_all", content: "第二版" })).body);
    const versions = await env.DB
      .prepare("SELECT id FROM item_versions WHERE item_id = ? AND reason = 'pre_mcp'")
      .bind(restorable)
      .all<{ id: string }>();
    const versionId = versions.results?.[0]?.id;
    expect(versionId).toBeTruthy();

    const restored = ok(
      (await call(secret, "edit_item", { id: restorable, expected_rev: 2, mode: "restore_version", version_id: versionId })).body,
    );
    expect(restored.rev).toBe(3);
    expect(await bodyOf(restorable)).toBe("第一版");
  });

  it("内容没变就不产生新版本（changed: false）", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "一样", { title: "甲" });
    const result = ok((await call(secret, "edit_item", { id, expected_rev: 1, mode: "replace_all", content: "一样" })).body);
    expect(result.changed).toBe(false);
    expect(await preMcpVersions(id)).toHaveLength(0);
  });
});

describe("edit_table_rows（批 3）", () => {
  it("按行 ID 更新与删除；行 ID / 列名不存在都报错且不动数据", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    // 用 mdcore 自己渲染出一份**合法**表格：手写 YAML 容易漏字段，而解析器要求 columns 齐备
    const markdown = renderTableDocument({
      columns: [
        { id: "c1", name: "名称", type: "text" },
        { id: "c2", name: "数量", type: "number" },
      ],
      rowIdColumn: ROW_ID_COLUMN,
      views: { default: "table" },
      rows: [
        { [ROW_ID_COLUMN]: "r1", c1: "甲", c2: "1" },
        { [ROW_ID_COLUMN]: "r2", c1: "乙", c2: "2" },
      ],
      attachments: [],
      notices: [],
      preservedLines: [],
      tags: [],
      foreignLines: [],
    });
    const id = await seedItem(userId, newUlid(), markdown, { type: "table", title: "表" });

    const updated = ok((await call(secret, "edit_table_rows", { id, expected_rev: 1, updates: { r1: { c2: "9" } } })).body);
    expect(updated.rows).toBe(2);
    expect(await bodyOf(id)).toContain("9");

    const afterDelete = ok(
      (await call(secret, "edit_table_rows", { id, expected_rev: updated.rev, deletes: ["r2"] })).body,
    );
    expect(afterDelete.rows).toBe(1);
    expect(await bodyOf(id)).not.toContain("乙");

    // 写不存在的行 / 列：一行都不该动
    expect(
      failure((await call(secret, "edit_table_rows", { id, expected_rev: afterDelete.rev, updates: { rX: { c2: "1" } } })).body),
    ).toContain("没有找到行 ID");
    expect(
      failure((await call(secret, "edit_table_rows", { id, expected_rev: afterDelete.rev, updates: { r1: { 没有这列: "1" } } })).body),
    ).toContain("没有名为");
  });

  it("非表格条目直接拒绝", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "普通笔记", { title: "甲" });
    expect(failure((await call(secret, "edit_table_rows", { id, expected_rev: 1, updates: { r1: { a: "b" } } })).body)).toContain(
      "只有表格",
    );
  });
});

describe("organize_item（批 3）", () => {
  it("改标题 / 标签 / 置顶；带 expected_meta_rev 乐观锁", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "正文", { title: "旧标题" });

    const result = ok(
      (await call(secret, "organize_item", { id, expected_meta_rev: 1, title: "新标题", add_tags: ["工作"], pinned: true })).body,
    );
    expect(result.meta_rev).toBe(2);

    const row = await env.DB.prepare("SELECT title, tags, pinned FROM items WHERE id = ?").bind(id).first<{
      title: string;
      tags: string;
      pinned: number;
    }>();
    expect(row?.title).toBe("新标题");
    expect(row?.tags).toContain("工作");
    expect(row?.pinned).toBe(1);

    // 冲突进审计（这是"agent 撞上了并发"的证据）
    expect(failure((await call(secret, "organize_item", { id, expected_meta_rev: 1, title: "再改" })).body)).toContain("其他设备");
    expect((await auditFor(id)).map((row) => row.result)).toContain("conflict");
    expect(failure((await call(secret, "organize_item", { id, title: "无锁" })).body)).toContain("expected_meta_rev");
  });

  it("成功路径的审计与元数据写入同批落库", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "正文", { title: "甲" });
    ok((await call(secret, "organize_item", { id, expected_meta_rev: 1, title: "改名" })).body);

    const audit = await auditFor(id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.tool).toBe("organize_item");
    expect(audit[0]?.result).toBe("ok");
    expect(audit[0]?.rev_before).toBe(1);
  });
});

describe("trash_item（批 3）", () => {
  it("移到回收站：幂等、审计 ok、顺带撤销分享", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "正文", { title: "甲" });

    const shareId = newUlid();
    await env.DB
      .prepare("INSERT INTO shares (id, user_id, kind, item_id, title, expires_at, created_at) VALUES (?, ?, 'item', ?, NULL, NULL, ?)")
      .bind(shareId, userId, id, Date.now())
      .run();

    const result = ok((await call(secret, "trash_item", { id, expected_rev: 1, operation_id: "t1" })).body);
    expect(result.trashed).toBe(true);

    const row = await env.DB.prepare("SELECT deleted_at FROM items WHERE id = ?").bind(id).first<{ deleted_at: number | null }>();
    expect(row?.deleted_at).toBeGreaterThan(0);

    // 软删顺带撤销分享（M6 批 1 补的），对 MCP 一样成立
    const share = await env.DB.prepare("SELECT revoked_at FROM shares WHERE id = ?").bind(shareId).first<{ revoked_at: number | null }>();
    expect(share?.revoked_at).toBeGreaterThan(0);

    // 幂等重放：不重复写审计
    const replay = ok((await call(secret, "trash_item", { id, expected_rev: 1, operation_id: "t1" })).body);
    expect(replay.trashed).toBe(true);
    expect((await auditFor(id)).filter((row) => row.result === "ok")).toHaveLength(1);
  });

  it("expected_rev 不对：一行都不写、冲突进审计，**同一个 ID 之后还能重试**", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "正文", { title: "甲" });

    expect(failure((await call(secret, "trash_item", { id, expected_rev: 99, operation_id: "retry" })).body)).toContain("版本冲突");

    // 关键：预检冲突**不写幂等行**，所以同一个 operation_id 还能重来
    const op = await env.DB
      .prepare("SELECT operation_id FROM mcp_operations WHERE operation_id = ?")
      .bind("retry")
      .first<{ operation_id: string }>();
    expect(op).toBeNull();
    expect((await auditFor(id)).map((row) => row.result)).toContain("conflict");

    // 重新读一次正确的 rev，用**同一个** operation_id 重试 → 这次该成功
    const retried = ok((await call(secret, "trash_item", { id, expected_rev: 1, operation_id: "retry" })).body);
    expect(retried.trashed).toBe(true);
  });
});

describe("写类的门槛与留痕（批 3）", () => {
  it("512 KB 门槛：超了禁整篇处理，但 SQL 追加仍可用", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    // 用 sizeBytes 报一个超门槛的值（正文本身不用真的写 600 KB）
    const id = await seedItem(userId, newUlid(), "短正文", { title: "很大", sizeBytes: 600 * 1024 });

    expect(failure((await call(secret, "edit_item", { id, expected_rev: 1, mode: "replace_all", content: "x" })).body)).toContain(
      "512 KB",
    );
    // 追加走 `body = body || ?`，不取整篇，所以照样能用
    expect(ok((await call(secret, "append_to_item", { id, text: "尾巴", operation_id: "big" })).body).rev).toBe(2);
  });

  it("审计只记写类调用：只读工具不留痕", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "正文", { title: "甲" });

    await call(secret, "read_item", { id });
    await call(secret, "list_items", {});
    await call(secret, "search", { query: "正文" });
    expect(await countAudit()).toBe(0);

    await call(secret, "organize_item", { id, expected_meta_rev: 1, title: "改名" });
    expect(await countAudit()).toBe(1);
  });
});

