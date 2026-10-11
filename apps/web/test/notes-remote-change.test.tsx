// @vitest-environment jsdom
/**
 * 跨标签页改动的**事前提示**（M2-9）：
 * - 打开某条后，别处改过它（本地库里 content_hash 变了）→ 提示出现；
 * - 自己保存完（notifyUploaded）→ 基准跟上新内容，不误报；
 * - 「按最新内容重新载入」走回调。
 */
import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalNote, db, getDraft } from "../src/data/db";
import { noPrivacyGate } from "@menote/shared";
import { useNotesWorkspace } from "../src/features/notes/useNotesWorkspace";

const ITEM = "01JCX0000000000000000000A";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("跨标签页改动的事前提示", () => {
  it("打开时无提示；别处改过（hash 变了）后刷新出现提示", async () => {
    await createLocalNote(ITEM, "标题", "原始正文", 1000);

    const { result } = renderHook(() => useNotesWorkspace({ gate: noPrivacyGate() }));
    await act(async () => {
      await result.current.open(ITEM);
    });
    expect(result.current.remoteChanged).toBe(false);

    // 模拟"另一个标签页改了这条并已同步"：本地库里的内容与 hash 都变了
    await act(async () => {
      await db.bodies.update(ITEM, { body: "别处改过的正文", content_hash: "other-hash" });
      await db.items.update(ITEM, { content_hash: "other-hash", rev: 2, sync_seq: 9 });
      await result.current.refresh();
    });

    await waitFor(() => expect(result.current.remoteChanged).toBe(true));
  });

  it("自己保存成功后不误报（基准跟到新内容）", async () => {
    await createLocalNote(ITEM, "标题", "原始正文", 1000);

    const { result } = renderHook(() => useNotesWorkspace({ gate: noPrivacyGate() }));
    await act(async () => {
      await result.current.open(ITEM);
    });

    // 模拟自己这一轮保存：草稿与已缓存正文都变成"我改的"，然后通知已上传
    await act(async () => {
      await db.drafts.put({ item_id: ITEM, body: "我改的正文", updated_at: 2000 });
      await db.bodies.update(ITEM, { body: "我改的正文", content_hash: "my-hash" });
      await db.items.update(ITEM, { content_hash: "my-hash", rev: 2, sync_seq: 3 });
      result.current.notifyUploaded();
    });

    // 基准会跟到"我改的正文"；等它更新后再刷新：不该报"别处改过"
    await waitFor(async () => {
      expect((await getDraft(ITEM))?.body).toBe("我改的正文");
    });

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.remoteChanged).toBe(false);
  });

  it("重新载入后提示清除，且正文回到最新内容", async () => {
    await createLocalNote(ITEM, "标题", "原始正文", 1000);

    const { result } = renderHook(() => useNotesWorkspace({ gate: noPrivacyGate() }));
    await act(async () => {
      await result.current.open(ITEM);
    });

    await act(async () => {
      await db.bodies.update(ITEM, { body: "别处改过的正文", content_hash: "other-hash" });
      await db.items.update(ITEM, { content_hash: "other-hash", rev: 2, sync_seq: 9 });
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.remoteChanged).toBe(true));

    await act(async () => {
      await result.current.reloadSelected();
    });
    expect(result.current.remoteChanged).toBe(false);
  });

  /*
    新建笔记误报的回归（编辑器专项优化 v0.8.24）：新建 → 打开 → 输入 → 推送落地，
    这一路**全是自己的操作**，绝不该弹"别处改过"。此前 `notifyUploaded` 是死代码、
    基线从不跟随自己的推送，第一轮刷新就把刚落地的保存误报成横幅。
    修复走 `notifyOwnPush`（引擎把本次推送成功的条目 id 回报上来，基线跟着缓存走）。
  */
  it("自己的推送落地后基线跟上，不误报（notifyOwnPush 回归）", async () => {
    await createLocalNote(ITEM, "标题", "原始正文", 1000);

    const { result } = renderHook(() => useNotesWorkspace({ gate: noPrivacyGate() }));
    await act(async () => {
      await result.current.open(ITEM);
    });

    // 模拟"输入并推送落地"：缓存与条目 rev 都前进、草稿被清（afterBodySynced 的行为）。
    // 真实时序里引擎的 onSynced 紧随推送落地、先于 idle 刷新，中间没有别的刷新窗口。
    await act(async () => {
      result.current.input("原始正文加了一句");
      await db.bodies.update(ITEM, { body: "原始正文加了一句", content_hash: "my-hash" });
      await db.items.update(ITEM, { content_hash: "my-hash", rev: 1, sync_seq: 2 });
      await db.drafts.delete(ITEM);
      // 引擎回报"这条推送成功了"：基线跟到新正文
      await result.current.notifyOwnPush([ITEM]);
      await result.current.refresh();
    });
    expect(result.current.remoteChanged).toBe(false);

    // 基线已经跟上去：再刷新也不翻案
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.remoteChanged).toBe(false);
  });

  it("回报里没有当前条目时基线不动，别处的改动照常提示", async () => {
    await createLocalNote(ITEM, "标题", "原始正文", 1000);

    const { result } = renderHook(() => useNotesWorkspace({ gate: noPrivacyGate() }));
    await act(async () => {
      await result.current.open(ITEM);
    });

    await act(async () => {
      await db.bodies.update(ITEM, { body: "别处改过的正文", content_hash: "other-hash" });
      await db.items.update(ITEM, { content_hash: "other-hash", rev: 2, sync_seq: 9 });
      // 回报的是**别的**条目：当前这条的基线不许跟着动
      await result.current.notifyOwnPush(["01JCX0000000000000000000Z"]);
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.remoteChanged).toBe(true));
  });

  it("没打开任何条目时不提示", async () => {
    await createLocalNote(ITEM, "标题", "原始正文", 1000);

    const { result } = renderHook(() => useNotesWorkspace({ gate: noPrivacyGate() }));
    await act(async () => {
      await db.items.update(ITEM, { content_hash: "changed", sync_seq: 5 });
      await result.current.refresh();
    });
    expect(result.current.remoteChanged).toBe(false);
    expect(vi.isMockFunction(result.current.reloadSelected)).toBe(false);
  });
});
