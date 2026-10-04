// @vitest-environment jsdom
/**
 * 点笔记 → 界面**立刻**有反馈、正文后到（2026-09-27 用户反馈"切换笔记很卡"的根因之一）。
 *
 * 症状：点下去到界面换过去之间**完全没有反馈**——列表高亮不动、正文区还停在上一条。
 * 根因：`open()` 里 `setSelectedId()` 排在 `await editor.load()` **之后**，而正文不在本机时
 * `load()` 会去服务端补拉（一次网络往返），这段时间用户看到的就是"点了没反应"，
 * 甚至对着上一篇的正文敲字。
 *
 * 修法把 `open()` 拆成两阶段：**同步**先落选中态（列表高亮立刻移动、正文区先给占位），
 * 异步读完正文再挂正文区。本文件钉住这条对外契约：
 * 1. `docLoading` 为真时正文区是「正在打开…」占位，**没有**编辑器、**没有**标题输入框；
 * 2. 正文到位后标题与正文都是这一篇的（正文不在本机时，就是服务端补拉回来的那一份）；
 * 3. 连点两篇时**后点的那篇赢**——先点的慢请求回来也不许覆盖；
 * 4. `docEpoch` 拼进正文区的 `key`，所以"按最新内容重新载入"同一篇会**重新挂载**并拿到新正文
 *    （`selectedId` 没变，光看 id 认不出"正文换了"）。
 *
 * CodeMirror 与 Markdown 预览同样换成受控替身（真实 CM6 依赖布局 API，jsdom 里跑不动），
 * 与 `note-workspace.test.tsx` 同一套做法：`NoteWorkspace` 用 `lazy()` 动态 import 这两个模块，
 * `vi.mock` 一样生效。
 *
 * 这三个用例是上面这条契约的守卫：两阶段 `open()`（含"被更晚的点击取代就不再回写"）与
 * `docLoading` / `docEpoch` 哪一个退回旧写法，它们就该红——**不要**为了让它变绿去删断言或改源码。
 */
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/app/editor/Editor", () => ({
  Editor: (props: {
    initialValue: string;
    onChange: (value: string) => void;
    ariaLabel?: string;
  }) => (
    <div data-testid="editor" data-initial={props.initialValue}>
      <button type="button" onClick={() => props.onChange("改过的内容")}>
        模拟输入
      </button>
    </div>
  ),
}));

vi.mock("../src/app/editor/MarkdownPreview", () => ({
  MarkdownPreview: (props: { source: string }) => (
    <div data-testid="preview" data-source={props.source} />
  ),
}));

import { noPrivacyGate } from "@menote/shared";
import { NotesPane } from "../src/app/workarea/NotesPane";
import { createLocalNote, db, putCachedBody } from "../src/data/db";
import { useNotesWorkspace, type NotesWorkspace } from "../src/features/notes/useNotesWorkspace";

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

/** 无门禁的 gate 是**单例**（`noPrivacyGate` 返回同一份冻结对象）：放到模块级才是稳定引用 */
const GATE = noPrivacyGate();
const NOOP = (): void => undefined;

const FIRST = "01JCX0000000000000000000A";
const SECOND = "01JCX0000000000000000000B";

/** 渲染后把最新一次的工作区存下来：「重新载入」那条用例要从外面触发一次 `refresh()` */
const workspaceRef: { current: NotesWorkspace | null } = { current: null };

function currentWorkspace(): NotesWorkspace {
  if (!workspaceRef.current) throw new Error("工作区还没渲染出来");
  return workspaceRef.current;
}

/** 整屏接线（真实的 `useNotesWorkspace` + `NotesPane`），props 取 `NotesPaneProps` 的最简可用值 */
function Harness() {
  const workspace = useNotesWorkspace({ gate: GATE });
  // 在 effect 里同步（渲染期写 ref 是 React 明确禁止的；仓库里 App.tsx 同一写法）
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
        enabled: false,
        locked: true,
        id: null,
        folders: [],
        onMoveIn: NOOP,
        onMoveOut: NOOP,
      }}
    />
  );
}

/**
 * 列表里某一篇的**行按钮**。
 *
 * 不能只按无障碍名字找：行菜单的触发按钮名字里也含标题。`.itemrow` 才是那一行本身
 * （选中态就挂在它的 `aria-current` 上，见 `NoteRow`）。
 */
function rowOf(title: string): HTMLButtonElement {
  const row = [...document.querySelectorAll<HTMLButtonElement>("button.itemrow")].find((node) =>
    (node.textContent ?? "").includes(title),
  );
  if (!row) throw new Error(`没找到标题为「${title}」的列表行`);
  return row;
}

function delay(ms: number): Promise<void> {
  // 不用假定时器：那会把 `waitFor` 一起冻住
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 一个"什么时候 resolve 由测试说了算"的正文响应：能停在"请求已发出、正文还没到"的那一刻 */
function deferredBody(): { promise: Promise<Response>; resolve: (body: string) => void } {
  let settle: ((response: Response) => void) | null = null;
  const promise = new Promise<Response>((resolve) => {
    settle = resolve;
  });

  return {
    promise,
    resolve: (body: string) => {
      settle?.(new Response(body, { status: 200, headers: { ETag: '"h1"' } }));
    },
  };
}

/**
 * 只接管**正文端点**（形如 `/api/items/<id>/body`）的 `fetch` 替身；别的地址一律 404——
 * 这样"意外打到别的接口"会立刻失败，而不是挂在测试里等真实的网络。
 */
function stubBodyFetch(handler: (itemId: string) => Promise<Response> | Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const matched = /\/api\/items\/([^/]+)\/body$/.exec(String(input));
      if (matched?.[1]) return handler(decodeURIComponent(matched[1]));
      return new Response(JSON.stringify({ code: "not_found", message: "测试里没有这个端点" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

/** 造"**同步下来但正文不在本机**"的形态（元数据在、没有草稿、没有正文缓存）→ 打开时要发请求 */
async function seedSyncedOnly(id: string, title: string): Promise<void> {
  await createLocalNote(id, title, "", NOW);
  await db.drafts.delete(id);
  await db.bodies.delete(id);
}

/** 造"正文就在本机"的形态（有正文缓存、删掉草稿）→ 打开时**不发请求** */
async function seedCachedOnly(id: string, title: string, body: string): Promise<void> {
  await createLocalNote(id, title, body, NOW);
  await db.drafts.delete(id);
}

/** 渲染整屏并等列表铺好（`useNotesWorkspace` 首次读本地库是异步的） */
async function renderWorkspace(rowCount: number): Promise<void> {
  render(<Harness />);
  await waitFor(() =>
    expect(document.querySelectorAll("button.itemrow")).toHaveLength(rowCount),
  );
}

/** 编辑器是 lazy 分包，首帧在 Suspense 里：等它挂出来再读它的初始正文 */
async function editorInitial(): Promise<string | null> {
  return (await screen.findByTestId("editor")).getAttribute("data-initial");
}

beforeEach(async () => {
  workspaceRef.current = null;
  await db.delete();
  await db.open();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("点笔记的即时反馈与正文后到", () => {
  it("正文不在本机时：点下去正文区立刻给「正在打开…」占位（没有编辑器与标题输入框）", async () => {
    await seedCachedOnly(FIRST, "第一篇", "第一篇的正文");
    await seedSyncedOnly(SECOND, "第二篇");

    const pending = deferredBody();
    const requested: string[] = [];
    stubBodyFetch((itemId) => {
      requested.push(itemId);
      // 第二篇的正文不在本机：这次补拉被挂住，好停在"请求已发出、正文还没到"的那一刻
      if (itemId === SECOND) return pending.promise;
      return new Response(null, { status: 404 });
    });

    await renderWorkspace(2);

    // 先打开第一篇：正文在本机，不发请求，直接有基线
    fireEvent.click(rowOf("第一篇"));
    await waitFor(() => expect(rowOf("第一篇").getAttribute("aria-current")).toBe("true"));
    expect(await editorInitial()).toBe("第一篇的正文");
    expect(requested).toEqual([]);

    fireEvent.click(rowOf("第二篇"));

    /*
      —— 正文还没到：这一帧就该有反馈 ——

      反馈由**正文区占位**承担，而不是提前抬列表的 `selectedId`：
      抬 `selectedId` 会让整张列表（2000 行时几十毫秒）连同 App 整棵树多提交一次，
      而正文通常 1–5ms 就到（实测：缓存命中路径中位 72ms → 250ms）。
      所以这里**故意断言高亮仍停在上一篇**——把这条取舍钉住，改回去就会红。
    */
    expect(rowOf("第一篇").getAttribute("aria-current")).toBe("true");
    expect(screen.getByText(/正在打开/)).toBeTruthy();
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(screen.queryByLabelText("标题")).toBeNull();

    // —— 正文到了：选中态与正文在同一次提交里落地 ——
    pending.resolve("服务端补拉的正文");
    await waitFor(async () => expect(await editorInitial()).toBe("服务端补拉的正文"));
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("第二篇");
    expect(rowOf("第二篇").getAttribute("aria-current")).toBe("true");
    expect(requested).toEqual([SECOND]);
  });

  it("连点两篇：先点的慢请求回来也不覆盖后点的那篇", async () => {
    await seedSyncedOnly(FIRST, "第一篇");
    await seedSyncedOnly(SECOND, "第二篇");

    const settled: string[] = [];
    stubBodyFetch(async (itemId) => {
      // 先点的慢（80ms）、后点的快（5ms）：模拟两篇都要补拉、网络先后回来
      await delay(itemId === FIRST ? 80 : 5);
      settled.push(itemId);
      return new Response(itemId === FIRST ? "第一篇的正文" : "第二篇的正文", {
        status: 200,
        headers: { ETag: `"h-${itemId}"` },
      });
    });

    await renderWorkspace(2);

    fireEvent.click(rowOf("第一篇"));
    fireEvent.click(rowOf("第二篇"));

    // 等两篇的请求都回来（先点的那篇更慢），再断言最终显示的是**后点**的那篇
    await waitFor(() => expect(settled).toHaveLength(2));
    await act(async () => {
      await delay(50);
    });

    expect(settled).toEqual([SECOND, FIRST]);
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("第二篇");
    expect(rowOf("第二篇").getAttribute("aria-current")).toBe("true");
    expect(await editorInitial()).toBe("第二篇的正文");
  });

  it("「按最新内容重新载入」重新挂载正文区并拿到新正文（docEpoch 进 key 的意义）", async () => {
    await seedCachedOnly(FIRST, "第一篇", "旧正文");
    stubBodyFetch(() => new Response(null, { status: 404 }));

    await renderWorkspace(1);

    fireEvent.click(rowOf("第一篇"));
    await waitFor(async () => expect(await editorInitial()).toBe("旧正文"));

    // 模拟"另一个标签页改过并已同步"：本地正文缓存换成了新内容，工作区随后刷新一次
    await act(async () => {
      await putCachedBody(FIRST, "新正文", 2, "h-new", NOW + 5000);
      await currentWorkspace().refresh();
    });

    const reload = await screen.findByRole("button", { name: "按最新内容重新载入" });
    fireEvent.click(reload);

    // 同一篇、`selectedId` 没变：只有 key 里的 `docEpoch` 变了才会重挂并拿到新正文
    await waitFor(async () => expect(await editorInitial()).toBe("新正文"));
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("第一篇");
  });
});

/**
 * 单篇加密条目的**解锁出口接线**（2026-10-04 修的真 bug）。
 *
 * 症状：点开一篇已加密的笔记，正文区是「这一篇已加密」占位；点「解锁此篇」弹出的是
 * **范围**解锁框，输对密码后占位面板纹丝不动——这一篇永远解不开。
 *
 * 根因在 `NotesPane` 那一行接线：占位按钮的 `onUnlock` 传的是 `onRequestUnlock`（范围），
 * 而范围解锁按设计**不动单篇集合**（`model.ts` 头注："解锁范围门禁（不动单篇集合）"），
 * 于是 `unlockedItems` 始终为空、`bodyLocked` 恒为 true。
 *
 * 这条用例在**整屏接线**上钉死契约：占位按钮必须带上**这一篇的 id** 去请求逐篇解密，
 * 绝不能去开范围门禁。组件层与组装层的用例都盖不住这个接缝（前者直接喂 props、
 * 后者直接调 `decryptItem`），所以必须有这一层。
 */
describe("单篇加密条目的解锁出口", () => {
  it("占位上的「解锁此篇」请求的是**这一篇**的逐篇解密，不是范围解锁", async () => {
    await createLocalNote(FIRST, "加密的笔记", "正文", NOW);
    await db.drafts.delete(FIRST);
    // 打上单篇加密标记
    await db.items.update(FIRST, { enc_self: 1 });
    stubBodyFetch(() => new Response(null, { status: 404 }));

    const scopeUnlocks: number[] = [];
    const itemUnlocks: string[] = [];
    render(
      <EncryptedHarness
        onRequestUnlock={() => scopeUnlocks.push(1)}
        onRequestItemUnlock={(id) => itemUnlocks.push(id)}
      />,
    );
    await waitFor(() =>
      expect(document.querySelectorAll("button.itemrow")).toHaveLength(1),
    );

    fireEvent.click(rowOf("加密的笔记"));
    // 选中后正文区换锁定占位
    expect(await screen.findByText("这一篇已加密")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "解锁此篇" }));

    // 关键断言：走的是逐篇解密，且**带上正确的条目 id**
    expect(itemUnlocks).toEqual([FIRST]);
    // 关键断言：范围解锁一次都没被触发（修复前这里会是 1）
    expect(scopeUnlocks).toEqual([]);
  });
});

/** 上面那条用例专用的整屏接线：两个解锁出口各自可观测 */
function EncryptedHarness(props: {
  onRequestUnlock: () => void;
  onRequestItemUnlock: (itemId: string) => void;
}) {
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
        enabled: true,
        gate: GATE,
        unlockedCount: 0,
        onRequestUnlock: props.onRequestUnlock,
        onRequestItemUnlock: props.onRequestItemUnlock,
        onLockItem: NOOP,
        onLockAllItems: NOOP,
      }}
      onToggleEncryption={NOOP}
      onToast={NOOP}
      vault={{ enabled: false, locked: true, id: null, folders: [], onMoveIn: NOOP, onMoveOut: NOOP }}
    />
  );
}
