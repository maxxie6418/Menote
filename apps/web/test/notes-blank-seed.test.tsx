// @vitest-environment jsdom
/**
 * 「空白种子」：新建之后**没写任何可见文字、也没写过标题**的条目不入库（用户 2026-10-11 口径）。
 *
 * 原话：「如果点了新建文档但是没有写任何文字，也没有写标题，那么这篇文章就不要保存。
 * 哪怕创建了几个空格和换行，只要文本里看不到任何东西就不保存，包括只改动属性没写内容也不保存」。
 *
 * 实现落在 `data/db/seed.ts`（判据 + 回收）与 `data/db/repository.ts`（三个入队口子）：
 * 1. **内容全空 → 新建时不入队**（`createLocalItem` 的 `holdWhileBlank`），条目只活在本机；
 * 2. **写出内容（可见文字或标题）→ 补一条 `create`**——服务端还没有这一条，发
 *    `save_body` / `patch_meta` 只会 404；
 * 3. **一直是空的 → 离开这一篇时整条回收**，启动时再兜底扫一遍（建完关标签页那种）。
 *
 * 四条要钉住的边界：只改属性不算内容、已上传过的条目清空照旧正常编辑、
 * 队列里有行的空白条目（备份恢复的形态）**不许**被扫掉、刚建的种子有宽限期。
 */
import "fake-indexeddb/auto";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noPrivacyGate } from "@menote/shared";
import {
  createLocalItem,
  db,
  DEFAULT_NOTE_TITLE,
  DEFAULT_TABLE_TITLE,
  enqueueBodySave,
  getLocalItem,
  isBlankBody,
  isBlankSeed,
  isPlaceholderTitle,
  listItemOutbox,
  saveDraft,
} from "../src/data/db";
import { patchItemTags } from "../src/features/notes/actions";
import { reapBlankSeedOnLeave } from "../src/features/notes/blankSeeds";
import { useNotesWorkspace, type NotesWorkspace } from "../src/features/notes/useNotesWorkspace";

/** 无门禁的 gate 是单例（稳定引用） */
const GATE = noPrivacyGate();

/** 既有的一篇：切走时用它当"另一篇" */
const EXISTING = `---
tags: [外部]
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

/** 建一条（默认走"空白种子"那条路：`holdWhileBlank`） */
async function seed(id: string, now: number, body = "", title = DEFAULT_NOTE_TITLE): Promise<string> {
  await createLocalItem({ id, type: "note", title, folder_id: null, body, holdWhileBlank: true }, now);
  return id;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await createLocalItem(
    { id: "n1", type: "note", title: "既有的一篇", folder_id: null, body: EXISTING },
    Date.now(),
  );
});

afterEach(cleanup);

describe("判据：什么叫「什么都没有」", () => {
  it("这几个正文都算空：空串、只有空白、只有 front matter", () => {
    expect(isBlankBody("")).toBe(true);
    expect(isBlankBody("   \n\n \t ")).toBe(true);
    expect(isBlankBody("---\ntags: [美术]\n---\n\n")).toBe(true);
  });

  it("有可见文字就不算空（front matter 之外的部分说了算）", () => {
    expect(isBlankBody("# 标题")).toBe(false);
    expect(isBlankBody("---\ntags: [美术]\n---\n\n正文")).toBe(false);
    expect(isBlankBody("   <!-- 注释 -->  ")).toBe(false);
  });

  it("占位标题算「没写过标题」（空串与两头空格也算）", () => {
    expect(isPlaceholderTitle(null)).toBe(true);
    expect(isPlaceholderTitle("")).toBe(true);
    expect(isPlaceholderTitle("   ")).toBe(true);
    expect(isPlaceholderTitle(DEFAULT_NOTE_TITLE)).toBe(true);
    expect(isPlaceholderTitle(`  ${DEFAULT_TABLE_TITLE}  `)).toBe(true);
    expect(isPlaceholderTitle("真的标题")).toBe(false);
  });

  it("标题与正文两样都空才是空白种子", () => {
    expect(isBlankSeed({ title: DEFAULT_NOTE_TITLE }, "")).toBe(true);
    expect(isBlankSeed({ title: null }, "  \n")).toBe(true);
    expect(isBlankSeed({ title: "标题" }, "")).toBe(false);
    // 只有标题、没有正文：写得少也是写，不该被当成空
    expect(isBlankSeed({ title: "只有标题" }, "")).toBe(false);
    expect(isBlankSeed({ title: DEFAULT_NOTE_TITLE }, "一个字")).toBe(false);
  });
});

describe("新建：空白就不入队", () => {
  it("点什么都不填 → 本地有这一条，但一条队列项都没有", async () => {
    const current = await mountWorkspace();
    let id = "";
    await act(async () => {
      id = await current().createNote();
    });

    const item = await getLocalItem(id);
    expect(item?.title).toBe(DEFAULT_NOTE_TITLE);
    expect(await listItemOutbox(id)).toEqual([]);
  });

  it("写了标题、或带了正文 → 照旧立刻入队一条 create", async () => {
    const current = await mountWorkspace();
    let withTitle = "";
    let withBody = "";
    await act(async () => {
      withTitle = await current().createNote({ title: "有标题了" });
      withBody = await current().createNote({ body: "有正文了" });
    });

    expect((await listItemOutbox(withTitle)).map((row) => row.op)).toEqual(["create"]);
    expect((await listItemOutbox(withBody)).map((row) => row.op)).toEqual(["create"]);
  });

  it("只改属性（标签）不算内容 → 仍然一条都不发", async () => {
    const current = await mountWorkspace();
    let id = "";
    await act(async () => {
      id = await current().createNote();
    });

    await act(async () => {
      await patchItemTags(id, ["美术"]);
    });

    expect((await getLocalItem(id))?.tags).toEqual(["美术"]);
    expect(await listItemOutbox(id)).toEqual([]);
  });

  it("空白种子上写了标题 → 补的是 create（不是 patch_meta：服务端还没有这一条）", async () => {
    const current = await mountWorkspace();
    let id = "";
    await act(async () => {
      id = await current().createNote();
    });

    await act(async () => {
      await current().changeTitle("现在有标题了");
    });

    expect((await getLocalItem(id))?.title).toBe("现在有标题了");
    expect((await listItemOutbox(id)).map((row) => row.op)).toEqual(["create"]);
  });

  it("空白种子上敲了字 → 同样补 create（编辑器那条路就是这几步）", async () => {
    const current = await mountWorkspace();
    let id = "";
    await act(async () => {
      id = await current().createNote();
    });

    // `model.ts` 的自动保存：先落草稿，再 `enqueueBodySave`
    const now = Date.now();
    await act(async () => {
      await saveDraft(id, "写了点东西", now);
      await enqueueBodySave(id, (await getLocalItem(id))?.rev ?? 0, now);
    });

    expect((await listItemOutbox(id)).map((row) => row.op)).toEqual(["create"]);
  });
});

describe("离开这一篇：空白种子整条回收", () => {
  it("建完什么都没写就切走 → 这一条没了（就当没建过）", async () => {
    const current = await mountWorkspace();
    let id = "";
    await act(async () => {
      id = await current().createNote();
    });

    await act(async () => {
      await current().open("n1");
    });

    await waitFor(async () => {
      expect(await getLocalItem(id)).toBeUndefined();
    });
    // 队列里没留垃圾
    expect(await listItemOutbox(id)).toEqual([]);
  });

  it("写过标题再切走 → 留着（它已经算「真的」了）", async () => {
    const current = await mountWorkspace();
    let id = "";
    await act(async () => {
      id = await current().createNote();
      await current().changeTitle("留得住的标题");
    });

    await act(async () => {
      await current().open("n1");
    });

    await waitFor(async () => {
      expect(await getLocalItem(id)).toBeDefined();
    });
    expect((await listItemOutbox(id)).map((row) => row.op)).toEqual(["create"]);
  });

  /*
    回归：回收是**尽力而为**的收尾动作，库在查询途中被关掉（切档 / 卸载 / 测试收尾）时
    不许把拒绝漏到全局。此前 `void purgeBlankSeed(...).then(...)` 没有 catch，
    孤儿查询会以 `DatabaseClosedError` 的 unhandled rejection 炸上来 —— vitest 会因此
    把**整轮**测试判失败（本机 CI 就这么红的），浏览器里则是控制台里一条未处理拒绝。
  */
  it("回收途中库被关掉 → 只记一条 warn，不漏未处理拒绝", async () => {
    await seed("maybe", Date.now());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const changed = vi.fn();

    db.close();
    expect(() => reapBlankSeedOnLeave("maybe", "n1", changed)).not.toThrow();

    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(changed).not.toHaveBeenCalled();

    warn.mockRestore();
    await db.open();
  });

  /*
    同一条回归的另一半：真回收成功时会去刷新列表，那条刷新的 Promise 也是"没有人接"的
    （调用点是 `() => refresh()`）——回收方必须等它、并把它失败也兜住。
  */
  it("回收成功后刷新列表失败 → 同样只记一条 warn", async () => {
    await seed("blank", Date.now());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const changed = vi.fn(async () => {
      throw new Error("刷新失败");
    });

    reapBlankSeedOnLeave("blank", "n1", changed);

    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(changed).toHaveBeenCalledTimes(1);
    expect(await getLocalItem("blank")).toBeUndefined();

    warn.mockRestore();
  });
});

describe("启动兜底：扫掉上次残留的空白种子", () => {
  it("上一次「建完直接关标签页」的那一条被扫掉", async () => {
    await seed("old", Date.now() - 60_000);

    await mountWorkspace();

    await waitFor(async () => {
      expect(await getLocalItem("old")).toBeUndefined();
    });
  });

  it("刚建的种子有宽限期，启动这一趟不碰它", async () => {
    await seed("fresh", Date.now());

    await mountWorkspace();

    expect(await getLocalItem("fresh")).toBeDefined();
  });

  it("pending=create 但队列里有行（备份恢复的形态）→ 再空也不扫", async () => {
    // 不带 `holdWhileBlank`：正文空白也照旧入队，正是 `restoreLocalItem` 的形状
    await createLocalItem(
      { id: "restored", type: "note", title: DEFAULT_NOTE_TITLE, folder_id: null, body: "" },
      Date.now() - 60_000,
    );

    await mountWorkspace();

    expect(await getLocalItem("restored")).toBeDefined();
    expect((await listItemOutbox("restored")).map((row) => row.op)).toEqual(["create"]);
  });

  it("已上传过的条目被清空 → 不归这一套管（它不属于「从没上传过」）", async () => {
    await db.items.update("n1", { pending: null });
    await db.outbox.clear();

    await mountWorkspace();

    await act(async () => {
      await patchItemTags("n1", ["清空之后的标签"]);
    });

    expect(await getLocalItem("n1")).toBeDefined();
    expect((await listItemOutbox("n1")).map((row) => row.op)).toEqual(["patch_meta"]);
  });
});

describe("回归：既有口径不受影响", () => {
  it("`createLocalItem` 不传 `holdWhileBlank` 时，空白条目照旧入队（M1 起的口径）", async () => {
    await createLocalItem(
      { id: "plain", type: "note", title: null, folder_id: null, body: "" },
      Date.now(),
    );

    expect((await listItemOutbox("plain")).map((row) => row.op)).toEqual(["create"]);
  });

  it("切到另一篇时，被回收的只有空种子——既有的一篇不动", async () => {
    const current = await mountWorkspace();
    await act(async () => {
      await current().open("n1");
    });

    expect(await getLocalItem("n1")).toBeDefined();
  });
});
