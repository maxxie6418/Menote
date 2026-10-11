// @vitest-environment jsdom
/**
 * 改标题与 md 的关系（2026-10-04 标题入档 → **2026-10-11 收窄**，设计 §9）。
 *
 * 背景：为了跟外部 Markdown 工具（Obsidian 等）互通、往返不丢标题，标题曾经统一进 md 的
 * 顶层 `title:` 键——`items.title` 只是派生列。**新口径反过来了**：新建笔记不再写
 * `title:`（不设置属性就不该有 YAML），标题的家是 `items.title` 列；但**外部导入的稿
 * 自带 `title:` 时那个键要跟着改**，否则下次按 md 派生会把标题弹回去。
 *
 * 钉五件事：
 * 1. **md 有 `title:` 时更新它**，且本地列同步（两边不一致 = 下次同步会把标题弹回去）；
 * 2. **md 没有 `title:` 时一个字都不加**（只写列，连草稿都不落）；
 * 3. **只改标题这一条**——外来 front matter、`menote:` 块、正文都不许被动；
 * 4. **Memo 不写 `title:`**（`assertItemShape` 要求 `items.title` 为 null，Memo 没有独立标题）；
 * 5. **没变化就不写**（防抖会重复提交同一个值，白写一次 outbox 是浪费）。
 */
import "fake-indexeddb/auto";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveTitle, parseMenoteMeta } from "@menote/mdcore";
import { noPrivacyGate } from "@menote/shared";
import { createLocalItem, db, getDraft, getLocalItem } from "../src/data/db";
import { useNotesWorkspace, type NotesWorkspace } from "../src/features/notes/useNotesWorkspace";

const NOW = Date.now();
/** 无门禁的 gate 是单例（稳定引用） */
const GATE = noPrivacyGate();

/** 外来 front matter：外部工具写的属性，改标题时必须一根不动 */
const FOREIGN = `---
title: "外来标题"
url: "https://example.com/a"
tags: [外部]
menote:
  type: note
---

正文内容。
`;

function Harness({ capture }: { capture: (value: NotesWorkspace) => void }) {
  const workspace = useNotesWorkspace({ gate: GATE });
  useEffect(() => {
    capture(workspace);
  }, [capture, workspace]);
  return null;
}

async function mountWorkspace(): Promise<() => NotesWorkspace> {
  const seen: NotesWorkspace[] = [];
  render(<Harness capture={(value) => seen.push(value)} />);
  await waitFor(() => expect(seen.at(-1)?.loading).toBe(false));
  return () => {
    const value = seen.at(-1);
    if (!value) throw new Error("工作区还没挂上");
    return value;
  };
}

/** 打开一篇并改标题，然后读回草稿里的 md */
async function renameTo(title: string, id = "n1"): Promise<string> {
  const current = await mountWorkspace();
  await act(async () => {
    await current().open(id);
  });
  await act(async () => {
    await current().changeTitle(title);
  });
  const draft = await getDraft(id);
  return draft?.body ?? "";
}

/** 正文里**没有** `title:` 键的那种稿（新建笔记从出生起就是这样） */
const NO_TITLE_KEY = `---
url: "https://example.com/b"
tags: [外部]
---

正文内容。
`;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await createLocalItem(
    { id: "n1", type: "note", title: "旧标题", folder_id: null, body: FOREIGN },
    NOW,
  );
});

afterEach(cleanup);

describe("改标题：md 为准，列是派生列", () => {
  it("md 顶层 title: 更新，且本地列同步", async () => {
    const body = await renameTo("新标题");

    expect(deriveTitle(body).value).toBe("新标题");
    const item = await getLocalItem("n1");
    expect(item?.title).toBe("新标题");
  });

  it("只改标题：外来 front matter、menote 块、正文都不动", async () => {
    const body = await renameTo("新标题");

    expect(body).toContain('url: "https://example.com/a"');
    expect(body).toContain("tags: [外部]");
    expect(body).toContain("menote:\n  type: note");
    expect(body).toContain("正文内容。");
    // 外来 title 被覆盖了——这正是「md 为准」：用户在 MeNote 里改标题即改 md
    expect(body).not.toContain("外来标题");
  });

  it("md 仍可被完整解析（不是拼字符串拼出来的）", async () => {
    const body = await renameTo("新标题");
    const parsed = parseMenoteMeta(body);

    expect(parsed.meta.type).toBe("note");
    expect(parsed.meta.tags).toEqual(["外部"]);
    expect(parsed.body.trim()).toBe("正文内容。");
  });

  it("同一个值不重复写（防抖会重复提交，白写一次 outbox 是浪费）", async () => {
    const current = await mountWorkspace();
    await act(async () => {
      await current().open("n1");
    });
    const before = await db.drafts.count();

    await act(async () => {
      await current().changeTitle("旧标题"); // 与库里一致
    });

    expect(await db.drafts.count()).toBe(before);
  });

  it("Memo 不写 title: 键（items.title 必须为 null）", async () => {
    const current = await mountWorkspace();
    await act(async () => {
      await current().open("n1");
    });
    // 把这一篇就地换成 Memo，再试改标题
    await db.items.update("n1", { type: "memo", title: null, memo_at: NOW });
    await act(async () => {
      await current().refresh();
    });

    await act(async () => {
      await current().changeTitle("不该写进去");
    });

    const item = await getLocalItem("n1");
    expect(item?.title).toBeNull();
    const draft = await getDraft("n1");
    expect(draft?.body ?? "").not.toContain("不该写进去");
  });
});

/* ———————————————— 新口径：md 里没有 title: 就不写 md（2026-10-11，设计 §9） ———————————————— */

describe("md 里没有 title: → 改标题只写列，一个字都不进正文", () => {
  beforeEach(async () => {
    await createLocalItem(
      { id: "n2", type: "note", title: "旧标题", folder_id: null, body: NO_TITLE_KEY },
      NOW,
    );
  });

  it("列更新了，正文与草稿一动不动", async () => {
    const current = await mountWorkspace();
    await act(async () => {
      await current().open("n2");
    });
    // 打开这一篇时编辑器会把正文物化成草稿（既有行为），拿它当基线
    const bodyBefore = (await getDraft("n2"))?.body;
    expect(bodyBefore).toBe(NO_TITLE_KEY);

    await act(async () => {
      await current().changeTitle("新标题");
    });

    // 列照旧更新（列表 / 搜索读它），并入了 meta 补丁
    expect((await getLocalItem("n2"))?.title).toBe("新标题");
    const ops = (
      await db.outbox.where("[entity+entity_id]").equals(["item", "n2"]).toArray()
    ).map((row) => row.op);
    expect(ops).toContain("patch_meta");
    // 但没有正文入队、草稿内容也没被动过——这一次改标题根本没碰 md
    expect(ops).not.toContain("save_body");
    expect((await getDraft("n2"))?.body).toBe(bodyBefore);
  });

  it("反过来：md 里本来有 title: 时仍然跟着改（导入的稿）", async () => {
    await createLocalItem(
      { id: "n3", type: "note", title: "旧标题", folder_id: null, body: FOREIGN },
      NOW,
    );
    const body = await renameTo("新标题", "n3");

    expect(body).toContain("title: 新标题");
    expect(body).toContain('url: "https://example.com/a"');
  });
});
