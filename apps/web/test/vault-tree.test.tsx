// @vitest-environment jsdom
/**
 * 空间内文件夹树的位置（2026-09-29 用户要求"加密空间不需要在功能栏显示文件夹树"）。
 *
 * 树从功能栏那条贴底节点搬到了**加密空间视图的列表列**（`NotesPane`）。这里钉两件事：
 * 1. 只有"当前视图确实在空间子树里"时它才出现（笔记本视图里不许冒出来）；
 * 2. 它渲染在列表**已有的滚动容器**里——不给这一层再加第二个滚动容器（`DESIGN.md` §2.7）。
 *
 * 为什么值得守：这棵树是空间内文件夹的**唯一入口**（切层 / 新建 / 重命名都只在它上面），
 * 位置写错就等于那些文件夹进不去；而"搬家"这类改动最容易出的错就是"两边都没有"或"两边都有"。
 */
import "fake-indexeddb/auto";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { noPrivacyGate } from "@menote/shared";
import { NotesPane } from "../src/app/workarea/NotesPane";
import { db, type LocalFolder } from "../src/data/db";
import { useNotesWorkspace, type NotesWorkspace } from "../src/features/notes/useNotesWorkspace";

const GATE = noPrivacyGate();
const NOOP = (): void => undefined;
const VAULT_ID = "01JCX00000000000000000V";
const VAULT_CHILD_ID = "01JCX00000000000000000W";
const NOTEBOOK_ID = "01JCX00000000000000000N";

function folder(id: string, name: string, extra: Partial<LocalFolder> = {}): LocalFolder {
  return {
    id,
    parent_id: null,
    is_enc_space: 0,
    in_enc_space: 0,
    name,
    depth: 0,
    position: 0,
    meta_rev: 1,
    sync_seq: 1,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    deleted: false,
    pending: null,
    ...extra,
  };
}

const workspaceRef: { current: NotesWorkspace | null } = { current: null };

/** 整屏接线（真实的 `useNotesWorkspace` + `NotesPane`），props 取最简可用值 */
function Harness() {
  const workspace = useNotesWorkspace({ gate: GATE });
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  return (
    <NotesPane
      workspace={workspace}
      editorMode="edit"
      editorModes={["split", "edit", "preview", "live"]}
      encryption={{
        enabled: false,
        gate: GATE,
        unlockedCount: 0,
        onRequestUnlock: NOOP,
        onRequestItemUnlock: NOOP,
        onLockItem: NOOP,
        onLockAllItems: NOOP,
      }}
      onToggleEncryption={NOOP}
      onToast={NOOP}
      vault={{
        enabled: true,
        locked: false,
        id: VAULT_ID,
        folders: [{ id: VAULT_CHILD_ID, name: "私事" }],
        onMoveIn: NOOP,
        onMoveOut: NOOP,
      }}
    />
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.folders.bulkPut([
    folder(VAULT_ID, "加密空间", { is_enc_space: 1 }),
    folder(VAULT_CHILD_ID, "私事", { parent_id: VAULT_ID, in_enc_space: 1, depth: 1 }),
    folder(NOTEBOOK_ID, "工作"),
  ]);
});

afterEach(cleanup);

describe("空间内文件夹树的位置（2026-09-29 从功能栏搬进空间视图）", () => {
  it("笔记本视图里不出现；切进加密空间后出现在列表的滚动区里", async () => {
    const { container } = render(<Harness />);
    await waitFor(() => expect(workspaceRef.current).not.toBeNull());
    await act(async () => {
      await workspaceRef.current!.refresh();
    });

    // 默认视图是笔记本：这棵树不该冒出来
    expect(container.querySelector(".vaulttree")).toBeNull();

    await act(async () => {
      workspaceRef.current!.setView({ kind: "notebook", folderId: VAULT_ID });
    });

    const tree = container.querySelector(".vaulttree");
    expect(tree, "进了加密空间却没看到空间内文件夹树").not.toBeNull();
    // 在列表**已有的**滚动容器里：这一层不允许出现第二个滚动容器
    expect(container.querySelector(".listpane__scroll .vaulttree")).not.toBeNull();
    // 空间内的子夹列出来了
    expect(tree?.textContent).toContain("私事");
  });

  it("进到空间里某一层时，树仍在那、并把那一层标成选中", async () => {
    const { container } = render(<Harness />);
    await waitFor(() => expect(workspaceRef.current).not.toBeNull());
    await act(async () => {
      await workspaceRef.current!.refresh();
      workspaceRef.current!.setView({ kind: "notebook", folderId: VAULT_CHILD_ID });
    });

    const tree = container.querySelector(".vaulttree");
    expect(tree).not.toBeNull();
    const row = [...(tree?.querySelectorAll(".tree-row") ?? [])].find((node) =>
      (node.textContent ?? "").includes("私事"),
    );
    expect(row?.getAttribute("aria-current")).toBe("true");
  });
});

/**
 * 在空间里新建文件夹（2026-09-29 修复）。
 *
 * 起因：搬到空间视图后一测才发现——此前 `createVaultFolder` 把 `parentId`（建在空间根时是 `null`）
 * 原样写进本地行，只靠 `{ inEncSpace: true }` 给标记；而**服务端是按父节点推导 `in_enc_space`**，
 * 建夹的推送又只发 `{ id, parent_id, name }` —— 于是这样建出来的文件夹同步上去会变成**普通文件夹**，
 * 拉回来就跑进笔记本树；同时空间树里也永远看不到它（`vaultChildFolders` 只认"父 = 空间根"）。
 * 这里钉住正确形态：**第 1 层空间文件夹的父就是空间根**。
 */
describe("在空间里新建文件夹：父级指向空间根", () => {
  it("`parentId = null`（建在空间根下）落成空间根的子节点，且带空间标记", async () => {
    const { result } = renderHook(() => useNotesWorkspace({ gate: GATE }));
    await act(async () => {
      await result.current.refresh();
    });

    await act(async () => {
      await result.current.createVaultFolder("私事", null);
    });

    const created = (await db.folders.toArray()).find((row) => row.name === "私事");
    expect(created, "文件夹没建出来").toBeTruthy();
    // 关键：父是**空间根那一行**，不是 null（留 null 会让它同步成普通文件夹）
    expect(created?.parent_id).toBe(VAULT_ID);
    expect(created?.in_enc_space).toBe(1);
    expect(created?.depth).toBe(1);
  });

  it("空间根还没同步下来时明确拒绝，而不是建到笔记本里", async () => {
    const { result } = renderHook(() => useNotesWorkspace({ gate: GATE }));
    await act(async () => {
      await result.current.refresh();
    });
    // 模拟"空间根行还没同步下来"
    await db.folders.clear();
    await act(async () => {
      await result.current.refresh();
    });

    await expect(
      act(async () => {
        await result.current.createVaultFolder("私事", null);
      }),
    ).rejects.toThrow(/加密空间还没同步下来/);
  });
});
