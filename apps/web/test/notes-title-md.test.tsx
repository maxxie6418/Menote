// @vitest-environment jsdom
/**
 * 改标题要**同时写 md 与派生列**（2026-10-04，标题入档）。
 *
 * 背景：为了跟外部 Markdown 工具（Obsidian 等）互通、往返不丢标题，标题进了 md 的**顶层
 * `title:` 键**——`items.title` 从此只是派生列（与 `tags` / `task` 同一套哲学）。
 * 于是改标题不再是纯元数据操作：md 与列两边都得写。
 *
 * 钉四件事：
 * 1. **md 顶层 `title:` 更新**，且本地列同步（两边不一致 = 下次同步会把标题弹回去）；
 * 2. **只改标题这一条**——外来 front matter、`menote:` 块、正文都不许被动；
 * 3. **Memo 不写 `title:`**（`assertItemShape` 要求 `items.title` 为 null，Memo 没有独立标题）；
 * 4. **没变化就不写**（防抖会重复提交同一个值，白写一次 outbox 是浪费）。
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
async function renameTo(title: string): Promise<string> {
  const current = await mountWorkspace();
  await act(async () => {
    await current().open("n1");
  });
  await act(async () => {
    await current().changeTitle(title);
  });
  const draft = await getDraft("n1");
  return draft?.body ?? "";
}

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
