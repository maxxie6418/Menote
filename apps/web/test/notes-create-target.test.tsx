// @vitest-environment jsdom
/**
 * 新建条目的**落点**（2026-09-28 用户反馈的问题 1："其他新建要附属于笔记本"）。
 *
 * 此前的实现里只有**加密空间**那条分支带 `folder_id`，普通笔记本一律走 `createLocalNote`
 * （= `folder_id: null`）→ 选中「工作」后点「新建笔记」，新笔记却出现在根目录「全部笔记」里
 * （实测复现：`工作 / 0 条` 不变，根视图多出一篇「未命名笔记」）。
 *
 * 这里钉三条口径：
 * 1. 「笔记本」视图选中文件夹 → 落在**那个文件夹**（第 2 层子夹同样）；
 * 2. 「最近编辑 / 收藏 / 标签」没有笔记本上下文 → 落根目录；
 * 3. 加密空间里的文件夹 → 落在那里**并带空间标记**（`in_enc_space`，不走"先建后移"）。
 *
 * 另钉一条派生值：列表头要显示的**层级路径**（`工作 › 本周`）。
 */
import "fake-indexeddb/auto";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { noPrivacyGate } from "@menote/shared";
import { parseTableDocument, renderTableDocument, ROW_ID_COLUMN, type TableDoc } from "@menote/mdcore";
import { createLocalFolder, db } from "../src/data/db";
import type { LocalFolder } from "../src/data/db";
import type { ImportNotesSummary } from "../src/features/notes/import-md";
import { useNoteCreation } from "../src/features/notes/useNoteCreation";
import { useNotesWorkspace, type NotesWorkspace } from "../src/features/notes/useNotesWorkspace";
import type { NotesView } from "../src/features/notes/views";

const NOW = Date.UTC(2026, 8, 28, 10, 0, 0);
const NOOP = (): void => undefined;
/** 无门禁的 gate 是单例（稳定引用） */
const GATE = noPrivacyGate();

function folder(
  id: string,
  name: string,
  parentId: string | null,
  depth: number,
  overrides: Partial<LocalFolder> = {},
): LocalFolder {
  return {
    id,
    parent_id: parentId,
    is_enc_space: 0,
    in_enc_space: 0,
    name,
    depth,
    position: 0,
    meta_rev: 1,
    sync_seq: 1,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    deleted: false,
    pending: null,
    ...overrides,
  };
}

const PARENT = folder("f1", "工作", null, 1);
const CHILD = folder("f2", "本周", "f1", 2);
const VAULT_CHILD = folder("v2", "私事", "v1", 1, { in_enc_space: 1 });

/** `open` 收到的新 id 就是新建条目的 id（用 ref 拿，effect 里抓不到快照值） */
interface CreationApi {
  createNote: (options?: { title?: string; body?: string }) => Promise<string>;
  importNotes: (files: readonly File[]) => Promise<ImportNotesSummary>;
  createTable: (doc: TableDoc) => Promise<string>;
  opened: { current: string | null };
}

function CreationHarness({
  folders,
  view,
  capture,
}: {
  folders: readonly LocalFolder[];
  view: NotesView;
  capture: (api: CreationApi) => void;
}) {
  const opened = useRef<string | null>(null);
  const { createNote, importNotes, createTable } = useNoteCreation({
    folders,
    view,
    refresh: async () => undefined,
    open: async (id: string) => {
      opened.current = id;
    },
    setView: NOOP,
    onLocalWrite: NOOP,
  });

  useEffect(() => {
    capture({ createNote, importNotes, createTable, opened });
  }, [capture, createNote, createTable, importNotes]);

  return null;
}

/** 建一条并读回本地库里那一行 */
async function createAndRead(
  folders: readonly LocalFolder[],
  view: NotesView,
): Promise<{ folder_id: string | null; in_enc_space: 0 | 1 }> {
  const api: { current: CreationApi | null } = { current: null };
  render(
    <CreationHarness folders={folders} view={view} capture={(next) => (api.current = next)} />,
  );
  const handle = api.current;
  if (!handle) throw new Error("新建动作还没接上");
  await act(async () => {
    await handle.createNote();
  });
  const opened = handle.opened.current;
  if (!opened) throw new Error("createNote 没有打开新建的条目");
  const row = await db.items.get(opened);
  if (!row) throw new Error("本地库里没有新建的条目");
  return { folder_id: row.folder_id, in_enc_space: row.in_enc_space };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await createLocalFolder(PARENT.id, PARENT.name, null, 1, NOW);
  await createLocalFolder(CHILD.id, CHILD.name, PARENT.id, 2, NOW);
  // 空间里的子夹：`in_enc_space = 1` 就足以让 `isInVault` 判真（空间根行由服务端补建）
  await createLocalFolder(VAULT_CHILD.id, VAULT_CHILD.name, VAULT_CHILD.parent_id, 1, NOW, {
    inEncSpace: true,
  });
});

afterEach(cleanup);

describe("新建笔记的落点", () => {
  it("选中第 1 层笔记本 → 落在那里面", async () => {
    const created = await createAndRead([PARENT, CHILD], { kind: "notebook", folderId: "f1" });
    expect(created.folder_id).toBe("f1");
    expect(created.in_enc_space).toBe(0);
  });

  it("选中第 2 层子夹 → 落在子夹里", async () => {
    const created = await createAndRead([PARENT, CHILD], { kind: "notebook", folderId: "f2" });
    expect(created.folder_id).toBe("f2");
  });

  it("笔记本根视图（folderId 为 null）→ 落根目录", async () => {
    const created = await createAndRead([PARENT, CHILD], { kind: "notebook" });
    expect(created.folder_id).toBeNull();
  });

  it("最近编辑 / 收藏 / 标签这些没有笔记本上下文的视图 → 落根目录", async () => {
    expect((await createAndRead([PARENT], { kind: "recent" })).folder_id).toBeNull();
    expect((await createAndRead([PARENT], { kind: "starred" })).folder_id).toBeNull();
    expect((await createAndRead([PARENT], { kind: "tag", tag: "项目" })).folder_id).toBeNull();
  });

  it("加密空间里的文件夹 → 落在那里并带空间标记（不走先建后移）", async () => {
    const created = await createAndRead([PARENT, CHILD, VAULT_CHILD], {
      kind: "notebook",
      folderId: "v2",
    });
    expect(created.folder_id).toBe("v2");
    expect(created.in_enc_space).toBe(1);
  });
});

/* —————————————————————— 导入笔记 / 新建表格的落点（v0.6.16） —————————————————————— */

/** 跑一次导入并把建出来的那些行读回来（按标题认，导入不返回 id） */
async function importAndRead(
  folders: readonly LocalFolder[],
  view: NotesView,
  files: readonly File[],
): Promise<Array<{ title: string | null; type: string; folder_id: string | null; in_enc_space: 0 | 1; body: string }>> {
  const api: { current: CreationApi | null } = { current: null };
  render(
    <CreationHarness folders={folders} view={view} capture={(next) => (api.current = next)} />,
  );
  const handle = api.current;
  if (!handle) throw new Error("新建动作还没接上");

  let summary: ImportNotesSummary | null = null;
  await act(async () => {
    summary = await handle.importNotes(files);
  });
  expect(summary).toEqual({ created: files.length, skipped: [] });

  const titles = files.map((file) => file.name.replace(/\.md$/, ""));
  const rows = [];
  for (const title of titles) {
    const row = await db.items
      .filter((item) => item.title === title)
      .first();
    if (!row) throw new Error(`本地库里没有导入的条目：${title}`);
    const body = await db.bodies.get(row.id);
    rows.push({
      title: row.title,
      type: row.type,
      folder_id: row.folder_id,
      in_enc_space: row.in_enc_space,
      body: body?.body ?? "",
    });
  }
  return rows;
}

function md(name: string, text: string): File {
  return new File([text], name, { type: "text/markdown" });
}

/** 一张有数据列的表格文档（列定义面板确认后交回来的那种） */
function tableDoc(name: string): TableDoc {
  return {
    columns: [
      { id: ROW_ID_COLUMN, name: ROW_ID_COLUMN, type: "text", hidden: true },
      { id: "c1", name, type: "text" },
    ],
    rowIdColumn: ROW_ID_COLUMN,
    views: { default: "table" },
    rows: [],
    attachments: [],
    notices: [],
    preservedLines: [],
    tags: [],
    foreignLines: [],
  };
}

describe("导入笔记的落点", () => {
  it("落在当前选中的笔记本里（第 1 层与第 2 层都算）", async () => {
    const [first] = await importAndRead([PARENT, CHILD], { kind: "notebook", folderId: "f1" }, [
      md("甲.md", "a"),
    ]);
    expect(first?.folder_id).toBe("f1");
    expect(first?.in_enc_space).toBe(0);

    cleanup();
    const [second] = await importAndRead([PARENT, CHILD], { kind: "notebook", folderId: "f2" }, [
      md("乙.md", "b"),
    ]);
    expect(second?.folder_id).toBe("f2");
  });

  it("没有笔记本上下文的视图 → 落根目录（与新建笔记同一套口径）", async () => {
    const [row] = await importAndRead([PARENT], { kind: "recent" }, [md("丙.md", "c")]);
    expect(row?.folder_id).toBeNull();
  });

  it("加密空间里的文件夹 → 带空间标记（与新建笔记同一套口径）", async () => {
    const [row] = await importAndRead([PARENT, VAULT_CHILD], { kind: "notebook", folderId: "v2" }, [
      md("丁.md", "d"),
    ]);
    expect(row?.folder_id).toBe("v2");
    expect(row?.in_enc_space).toBe(1);
  });

  it("导入不打开任何一篇（多选时不该把编辑器刷过去）", async () => {
    const api: { current: CreationApi | null } = { current: null };
    render(<CreationHarness folders={[PARENT]} view={{ kind: "notebook", folderId: "f1" }} capture={(next) => (api.current = next)} />);
    const handle = api.current;
    if (!handle) throw new Error("新建动作还没接上");

    await act(async () => {
      await handle.importNotes([md("戊.md", "e"), md("己.md", "f")]);
    });

    expect(handle.opened.current).toBeNull();
  });

  it("表格 `.md` 导进来就是表格条目（`type=table` 且正文能解析回来）", async () => {
    const source = renderTableDocument(tableDoc("事项"));
    const [row] = await importAndRead([PARENT], { kind: "notebook", folderId: "f1" }, [
      md("清单.md", source),
    ]);

    // 表格界面看的是 `item.type`（NoteWorkspace），不是正文解析——所以这条不能只看正文
    expect(row?.type).toBe("table");
    const parsed = parseTableDocument(row?.body ?? "");
    expect(parsed.ok).toBe(true);
  });

  it("普通 `.md` 导进来是笔记条目，正文逐字相同", async () => {
    const [row] = await importAndRead([PARENT], { kind: "notebook", folderId: "f1" }, [
      md("随手记.md", "# 标题\n\n- 一条\n"),
    ]);
    expect(row?.type).toBe("note");
    expect(row?.body).toBe("# 标题\n\n- 一条\n");
  });
});

describe("新建表格", () => {
  it("建出来的条目是 `type=table`，正文能解析回同一张表", async () => {
    const api: { current: CreationApi | null } = { current: null };
    render(<CreationHarness folders={[PARENT]} view={{ kind: "notebook", folderId: "f1" }} capture={(next) => (api.current = next)} />);
    const handle = api.current;
    if (!handle) throw new Error("新建动作还没接上");

    let id: string | null = null;
    await act(async () => {
      id = await handle.createTable(tableDoc("事项"));
    });

    const row = await db.items.get(id ?? "");
    expect(row?.type).toBe("table");
    expect(row?.folder_id).toBe("f1");

    const body = await db.bodies.get(id ?? "");
    const parsed = parseTableDocument(body?.body ?? "");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.doc.columns.map((column) => column.name)).toContain("事项");
    }
  });

  it("定完列会打开新表格（与新建笔记一致）", async () => {
    const api: { current: CreationApi | null } = { current: null };
    render(<CreationHarness folders={[PARENT]} view={{ kind: "notebook", folderId: "f1" }} capture={(next) => (api.current = next)} />);
    const handle = api.current;
    if (!handle) throw new Error("新建动作还没接上");

    await act(async () => {
      await handle.createTable(tableDoc("事项"));
    });

    expect(handle.opened.current).not.toBeNull();
  });
});

/** 工作区外壳：只为拿派生值 `viewPath` */
function WorkspaceHarness({ capture }: { capture: (value: NotesWorkspace) => void }) {
  const workspace = useNotesWorkspace({ gate: GATE });
  useEffect(() => {
    capture(workspace);
  }, [capture, workspace]);
  return null;
}

describe("列表头的层级路径（viewPath）", () => {
  it("子夹给出「父夹 › 子夹」，根视图为空", async () => {
    const seen: NotesWorkspace[] = [];
    render(<WorkspaceHarness capture={(value) => seen.push(value)} />);
    await waitFor(() => expect(seen.at(-1)?.loading).toBe(false));

    // folders 状态由 refresh() 填：先读一次本地库
    await act(async () => {
      await seen.at(-1)?.refresh();
    });
    expect(
      (seen.at(-1)?.folders ?? []).map((row) => row.id).sort(),
    ).toEqual(["f1", "f2", "v2"]);

    act(() => {
      seen.at(-1)?.setView({ kind: "notebook", folderId: "f2" });
    });
    await waitFor(() => expect(seen.at(-1)?.viewPath).toEqual(["工作", "本周"]));

    act(() => {
      seen.at(-1)?.setView({ kind: "notebook" });
    });
    await waitFor(() => expect(seen.at(-1)?.viewPath).toEqual([]));
  });
});
