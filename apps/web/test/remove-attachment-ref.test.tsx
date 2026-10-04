// @vitest-environment jsdom
/**
 * 「移除附件引用」入口（M10-新 · M6 批 2b）。
 *
 * 这条功能与上一批的「保存正文时对齐附件引用集合」是同一件事的两面：服务端已经会在保存正文时
 * 把引用集合换成正文里实际引用的那批，**但用户此前没有任何入口能把正文里的某张图删掉**，
 * 对齐只落地了一半。所以这里要盯住三件事：
 *
 * 1. **入口的可用性要说实话**：没有引用就置灰并说明原因（`DESIGN.md` §6.1）；
 * 2. **只删那一行**：其余内容与别的附件引用必须原样不动（删多了就是丢数据）；
 * 3. **移除引用 ≠ 删除文件**——所以这里不碰 `removeAttachmentMeta`（那是删上传元数据行，
 *    删了会让本机元数据与服务端失配），正文一改，保存链路自然就把那个 sha 带走。
 *
 * CodeMirror 换成受控替身（同 `note-workspace.test.tsx`）：真实 CM6 依赖布局 API，不适合进单测。
 * 替身保留 `replace` 的**语义**（按标记替换 + 触发 `onChange`），这样"移除 → 保存带出的引用集合"
 * 这条链能在单测里真的走一遍。
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractAttachmentRefs } from "@menote/shared";

vi.mock("../src/app/editor/Editor", () => ({
  Editor: (props: { initialValue: string; onChange: (value: string) => void }) => (
    <div data-testid="editor" data-initial={props.initialValue}>
      <button type="button" onClick={() => props.onChange("如图所示 ![图二](/api/attachments/h/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)")}>
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

import { NoteWorkspace } from "../src/features/notes/ui/NoteWorkspace";
import { RemoveAttachmentRefDialog } from "../src/features/attachments/ui/RemoveAttachmentRefDialog";
import { planAttachmentRefRemoval } from "../src/features/attachments/model";
import type { LocalItem } from "../src/data/db";
import type { EditorHandle } from "../src/app/editor/Editor";

afterEach(cleanup);

beforeEach(() => {
  // "上次用的那一档"记在本机：用例之间必须隔离，否则互相串档
  window.localStorage.clear();
});

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

function refOf(sha: string, alt: string): string {
  return `![${alt}](/api/attachments/h/${sha})`;
}

const noop = (): void => undefined;

function item(id = "a"): LocalItem {
  return {
    id,
    type: "note",
    folder_id: null,
    title: "笔记",
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 0,
    content_hash: "h",
    tags: [],
    memo_at: null,
    is_task: 0,
    task_status: null,
    task_due: null,
    task_priority: null,
    pinned: 0,
    starred: 0,
    rev: 1,
    meta_rev: 1,
    sealed_rev: null,
    sync_seq: 1,
    created_at: 1,
    updated_at: 1,
    last_edit_at: null,
    last_device: null,
    deleted_at: null,
    deleted: false,
    pending: null,
  };
}

/** 隐私锁那一组（不给它就没有「更多」菜单——它是隐私入口的集合） */
const encryption = {
  enabled: true,
  encrypted: false,
  unlocked: true,
  unlockedCount: 1,
  onUnlock: noop,
  onLock: noop,
  onToggle: noop,
  onLockAll: noop,
};

/** 打开「更多」菜单并取回（菜单项是 `role="menuitem"` 的按钮） */
async function openMoreMenu(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "更多" }));
  return screen.getByRole("menu", { name: "更多" });
}

function menuItem(menu: HTMLElement, name: string): HTMLButtonElement {
  return within(menu).getByRole("menuitem", { name }) as HTMLButtonElement;
}

/**
 * 编辑器句柄的替身：`replace` 照 `app/editor/Editor.tsx` 的做法按标记替换，并回调 `onChange`
 * （真实的 `updateListener` 也是这么把变更抛给宿主的）。
 */
function fakeHandle(doc: { text: string }, onChange: (text: string) => void): EditorHandle {
  return {
    read: () => doc.text,
    insert: (text: string) => {
      doc.text += text;
      onChange(doc.text);
    },
    replace: (marker: string, text: string) => {
      const at = doc.text.indexOf(marker);
      if (at < 0) return;
      doc.text = doc.text.slice(0, at) + text + doc.text.slice(at + marker.length);
      onChange(doc.text);
    },
    applyFormat: noop,
    // 与真 Editor 同口径：区间从**替身自己的文本**算，不收 expected
    replaceFrontmatter: (next: string): boolean => {
      const at = doc.text.indexOf("---", 3);
      const end = at < 0 ? -1 : doc.text.indexOf("\n", at + 1);
      doc.text = end < 0 ? next + doc.text : next + doc.text.slice(end + 1);
      onChange(doc.text);
      return true;
    },
  };
}

describe("「更多」菜单里的入口", () => {
  it("正文里没有附件引用时置灰，并说明原因", async () => {
    const onRemoveAttachmentRef = vi.fn();
    render(
      <NoteWorkspace
        item={item()}
        initialBody="只有文字的正文"
        snapshot={null}
        encryption={encryption}
        onInput={noop}
        onTitleChange={noop}
        onRemoveAttachmentRef={onRemoveAttachmentRef}
      />,
    );

    const entry = menuItem(await openMoreMenu(), "移除附件引用…");
    expect(entry.disabled).toBe(true);
    expect(entry.getAttribute("title")).toBe("这一篇没有附件引用");
  });

  it("正文里有附件引用时可用；点它交上去的是**当前正文**（不是打开时的快照）", async () => {
    const onRemoveAttachmentRef = vi.fn();
    render(
      <NoteWorkspace
        item={item()}
        initialBody={refOf(SHA_A, "图一")}
        snapshot={null}
        encryption={encryption}
        onInput={noop}
        onTitleChange={noop}
        onRemoveAttachmentRef={onRemoveAttachmentRef}
      />,
    );
    await screen.findByTestId("editor");

    // 用户在正文里敲了字（还没保存）：菜单项的可用性与交上去的正文都得跟着**当前文本**走
    fireEvent.click(screen.getByRole("button", { name: "模拟输入" }));

    const entry = menuItem(await openMoreMenu(), "移除附件引用…");
    expect(entry.disabled).toBe(false);

    fireEvent.click(entry);
    expect(onRemoveAttachmentRef).toHaveBeenCalledTimes(1);
    const handed = onRemoveAttachmentRef.mock.calls[0]?.[0] as string;
    expect(handed).toContain(SHA_B);
    expect(extractAttachmentRefs(handed)).toEqual([SHA_B]);
  });

  it("锁定态置灰，原因与导出 / 分享同一口径", async () => {
    render(
      <NoteWorkspace
        item={item()}
        initialBody={refOf(SHA_A, "图一")}
        snapshot={null}
        encryption={{ ...encryption, encrypted: true, unlocked: false, unlockedCount: 0 }}
        onInput={noop}
        onTitleChange={noop}
        onRemoveAttachmentRef={vi.fn()}
      />,
    );

    const entry = menuItem(await openMoreMenu(), "移除附件引用…");
    expect(entry.disabled).toBe(true);
    expect(entry.getAttribute("title")).toBe("解锁后才能移除附件引用");
  });

  it("预览档置灰并说明怎么才能做（那一档没有编辑器句柄可落这一段）", async () => {
    render(
      <NoteWorkspace
        item={item()}
        initialBody={refOf(SHA_A, "图一")}
        snapshot={null}
        initialMode="preview"
        encryption={encryption}
        onInput={noop}
        onTitleChange={noop}
        onRemoveAttachmentRef={vi.fn()}
      />,
    );

    const entry = menuItem(await openMoreMenu(), "移除附件引用…");
    expect(entry.disabled).toBe(true);
    expect(entry.getAttribute("title")).toBe("切到「仅编辑」才能移除附件引用");
  });

  it("没给回调时不出现这一项（组件不假设宿主有移除能力）", async () => {
    render(
      <NoteWorkspace
        item={item()}
        initialBody={refOf(SHA_A, "图一")}
        snapshot={null}
        encryption={encryption}
        onInput={noop}
        onTitleChange={noop}
      />,
    );

    const menu = await openMoreMenu();
    expect(within(menu).queryByRole("menuitem", { name: "移除附件引用…" })).toBeNull();
  });
});

describe("弹窗：列出这一篇引用的附件", () => {
  it("逐行列出 alt 名字，每行一个「移除引用」", () => {
    render(
      <RemoveAttachmentRefDialog
        body={`前言\n\n${refOf(SHA_A, "截图一")}\n${refOf(SHA_B, "截图二")}`}
        onClose={noop}
        onRemove={noop}
      />,
    );

    expect(screen.getByText("截图一")).toBeTruthy();
    expect(screen.getByText("截图二")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "移除引用" })).toHaveLength(2);
  });

  it("头部说清「移除引用不会删除文件」", () => {
    render(<RemoveAttachmentRefDialog body={refOf(SHA_A, "图")} onClose={noop} onRemove={noop} />);

    expect(screen.getByText(/文件本身不会被删除/)).toBeTruthy();
  });

  it("没有 alt 时退回「未命名附件」", () => {
    render(
      <RemoveAttachmentRefDialog
        body={`![](/api/attachments/h/${SHA_A})`}
        onClose={noop}
        onRemove={noop}
      />,
    );

    expect(screen.getByText("未命名附件")).toBeTruthy();
  });

  it("这一篇没有附件引用时是空态：给出可见说明，不崩也不空白", () => {
    render(<RemoveAttachmentRefDialog body="只有文字的正文" onClose={noop} onRemove={noop} />);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/已经没有可移除的附件引用/)).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: "移除引用" })).toHaveLength(0);
  });
});

describe("移除一条引用", () => {
  it("正文里那一条连同所在行消失，其余内容与其它引用原样不动", () => {
    const onRemove = vi.fn();
    const body = `第一段文字\n\n${refOf(SHA_A, "截图一")}\n中间文字\n${refOf(SHA_B, "截图二")}\n结尾`;
    render(<RemoveAttachmentRefDialog body={body} onClose={noop} onRemove={onRemove} />);

    fireEvent.click(screen.getAllByRole("button", { name: "移除引用" })[0]!);

    // 弹窗就地更新：这一行不再列出来，另一张还在
    expect(screen.queryByText("截图一")).toBeNull();
    expect(screen.getByText("截图二")).toBeTruthy();

    // 真正改正文的是宿主：按它交来的那一段原样替换
    const marker = onRemove.mock.calls[0]?.[0] as string;
    expect(marker).toBe(`${refOf(SHA_A, "截图一")}\n`);
    expect(body.replace(marker, "")).toBe(
      `第一段文字\n\n中间文字\n${refOf(SHA_B, "截图二")}\n结尾`,
    );
  });

  it("走编辑器句柄之后，保存带出的引用集合里不再有那个 sha（其余照旧）", () => {
    const doc = { text: `开头\n${refOf(SHA_A, "图一")}\n${refOf(SHA_B, "图二")}\n${refOf(SHA_C, "图三")}` };
    const onInput = vi.fn();
    const handle = fakeHandle(doc, onInput);

    render(
      <RemoveAttachmentRefDialog
        body={doc.text}
        onClose={noop}
        onRemove={(marker) => handle.replace(marker, "")}
      />,
    );

    // 移除中间那张（列表按 sha 去重保序，第 2 行是 SHA_B）
    fireEvent.click(screen.getAllByRole("button", { name: "移除引用" })[1]!);

    // 保存链路照常：编辑器把变更抛给宿主
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(doc.text).toBe(`开头\n${refOf(SHA_A, "图一")}\n${refOf(SHA_C, "图三")}`);
    expect(extractAttachmentRefs(doc.text)).toEqual([SHA_A, SHA_C]);
    expect(extractAttachmentRefs(doc.text)).not.toContain(SHA_B);
  });

  it("移到最后一条时弹窗转成空态（而不是留一个点了没反应的按钮）", () => {
    render(
      <RemoveAttachmentRefDialog body={refOf(SHA_A, "图一")} onClose={noop} onRemove={noop} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "移除引用" }));

    expect(screen.getByText(/已经没有可移除的附件引用/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "移除引用" })).toBeNull();
  });
});

describe("planAttachmentRefRemoval（纯函数）", () => {
  it("独占一行：整行连同尾随换行一起删", () => {
    const body = `前\n${refOf(SHA_A, "图")}\n后`;
    expect(planAttachmentRefRemoval(body, SHA_A)).toEqual({
      marker: `${refOf(SHA_A, "图")}\n`,
      body: "前\n后",
    });
  });

  it("末行且没有尾随换行：带上前面那个换行，不在文末留空行", () => {
    const body = `前\n${refOf(SHA_A, "图")}`;
    expect(planAttachmentRefRemoval(body, SHA_A)).toEqual({
      marker: `\n${refOf(SHA_A, "图")}`,
      body: "前",
    });
  });

  it("整篇只有这一行：删到空正文", () => {
    expect(planAttachmentRefRemoval(refOf(SHA_A, "图"), SHA_A)).toEqual({
      marker: refOf(SHA_A, "图"),
      body: "",
    });
  });

  it("行内引用：只删引用那一段，不动用户写的字", () => {
    const body = `如图 ${refOf(SHA_A, "图")} 所示`;
    expect(planAttachmentRefRemoval(body, SHA_A)).toEqual({
      marker: refOf(SHA_A, "图"),
      body: "如图  所示",
    });
  });

  it("列表项里只有这一张图：整行删掉（不留下孤零零的项目符号）", () => {
    const body = `清单\n- ${refOf(SHA_A, "图")}\n下一项`;
    expect(planAttachmentRefRemoval(body, SHA_A)?.body).toBe("清单\n下一项");
  });

  it("非图片附件（链接写法）同样能定位", () => {
    const body = `资料\n[手册](/api/attachments/h/${SHA_A})`;
    // 末行没有尾随换行：连它前面那个换行一起删（与图片那条同一口径）
    expect(planAttachmentRefRemoval(body, SHA_A)).toEqual({
      marker: `\n[手册](/api/attachments/h/${SHA_A})`,
      body: "资料",
    });
  });

  it("同一个 sha 出现多次时取第一次", () => {
    const body = `${refOf(SHA_A, "图")}\n${refOf(SHA_A, "图")}`;
    expect(planAttachmentRefRemoval(body, SHA_A)?.body).toBe(refOf(SHA_A, "图"));
  });

  it("正文里没有这个 sha：返回 null（界面不假装删掉了什么）", () => {
    expect(planAttachmentRefRemoval("没有附件", SHA_A)).toBeNull();
  });
});
