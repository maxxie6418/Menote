/**
 * 清单三字段平铺到顶层（2026-10-11，《属性栏与清单字段平铺》设计 §3 / §5）。
 *
 * 两条口径钉在这里：
 * - **键存在即清单条目**：平铺之后判据是"顶层三键有没有一个在"，不再看 `menote.task`；
 * - **懒迁移**：旧写法仍读，但任何一次 `patch.task` 写入都把它搬到顶层——不写迁移脚本。
 */
import { describe, expect, it } from "vitest";
import { parseMenoteMeta, updateMenoteKeys } from "../src/frontmatter";

describe("清单三字段平铺（status / due / priority 顶层键）", () => {
  it("读：顶层三键取出来，值原样（不认识的值不在这里归零）", () => {
    const parsed = parseMenoteMeta("---\nstatus: todo\ndue: 2026-04-01\npriority: high\n---\n\n正文");
    expect(parsed.meta.task).toEqual({ status: "todo", due: "2026-04-01", priority: "high" });
  });

  it("读：只写一个键也算清单条目，其余留 null", () => {
    const parsed = parseMenoteMeta("---\ndue: 2026-04-01\n---\n\n正文");
    expect(parsed.meta.task).toEqual({ status: null, due: "2026-04-01", priority: null });
  });

  it("读：键在但值为空 = 清单条目、该字段没设（与旧写法同一口径）", () => {
    const parsed = parseMenoteMeta("---\nstatus:\n---\n\n正文");
    expect(parsed.meta.task).toEqual({ status: null, due: null, priority: null });
    expect(parsed.meta.foreignLines).toEqual([]);
  });

  it("读：三个键都没有 → 不是清单条目，且不进 foreignLines", () => {
    const parsed = parseMenoteMeta("---\ntags: [a]\n---\n\n正文");
    expect(parsed.meta.task).toBeNull();
    expect(parsed.meta.foreignLines).toEqual([]);
  });

  it("写：顶层平铺、顺序固定 status → due → priority，空值不写行", () => {
    const next = updateMenoteKeys("---\ntags: [a]\n---\n\n正文", {
      task: { status: "doing", due: null, priority: "low" },
    });
    expect(next).toBe("---\ntags: [a]\nstatus: doing\npriority: low\n---\n\n正文");
  });

  it("写：旧写法 menote.task 命中一次就整段搬到顶层（懒迁移）", () => {
    const legacy = "---\ntitle: T\nmenote:\n  type: note\n  task:\n    status: todo\n    due: 2026-04-01\n---\n\n正文";
    const next = updateMenoteKeys(legacy, { task: { status: "done", due: "2026-04-01", priority: null } });

    expect(next).not.toContain("task:");
    expect(next).toBe(
      "---\ntitle: T\nstatus: done\ndue: 2026-04-01\nmenote:\n  type: note\n---\n\n正文",
    );
    expect(parseMenoteMeta(next).meta.task).toEqual({
      status: "done",
      due: "2026-04-01",
      priority: null,
    });
  });

  it("读：两种写法并存时**顶层优先**，缺的字段回落到旧块", () => {
    const both = "---\nstatus: doing\nmenote:\n  task:\n    status: todo\n    due: 2026-04-01\n---\n\n正文";
    expect(parseMenoteMeta(both).meta.task).toEqual({
      status: "doing",
      due: "2026-04-01",
      priority: null,
    });
  });

  it("读：没打 patch 时旧写法原样留着（只是读，不主动改写正文）", () => {
    const legacy = "---\nmenote:\n  task:\n    status: todo\n---\n\n正文";
    expect(updateMenoteKeys(legacy, { tags: ["a"] })).toContain("  task:\n    status: todo");
  });

  it("写：patch.task = null 把顶层三键与旧块一起删掉", () => {
    const source = "---\nstatus: todo\ndue: 2026-04-01\nmenote:\n  type: note\n  task:\n    priority: high\n---\n\n正文";
    const next = updateMenoteKeys(source, { task: null });

    expect(next).not.toContain("status:");
    expect(next).not.toContain("due:");
    expect(next).not.toContain("task:");
    expect(next).toBe("---\nmenote:\n  type: note\n---\n\n正文");
    expect(parseMenoteMeta(next).meta.task).toBeNull();
  });

  it("清掉最后一个属性时**不留空围栏**（从前会留下 `---\\n\\n---`）", () => {
    expect(updateMenoteKeys("---\ntags: [a]\n---\n\n正文", { tags: [] })).toBe("正文");
    expect(updateMenoteKeys("---\ntitle: T\n---\n\n正文", { title: null })).toBe("正文");
    expect(updateMenoteKeys("---\nstatus: todo\n---\n\n正文", { task: null })).toBe("正文");
    // 只清掉自有键、外来键还在 → front matter 留着
    expect(updateMenoteKeys("---\nurl: u\ntags: [a]\n---\n\n正文", { tags: [] })).toBe(
      "---\nurl: u\n---\n\n正文",
    );
  });
});
