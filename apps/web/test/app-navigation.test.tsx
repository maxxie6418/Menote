// @vitest-environment jsdom
/**
 * 「进了设置就出不去」的回归（2026-09-27 用户报的 bug）。
 *
 * 缺口：设置与回收站是**独立页**（`App` 的渲染分支优先于搜索与笔记区），
 * 而功能栏的视图切换 / 分栏浏览 / 新建 / 发布都只改笔记区的状态、不改路由——
 * 于是从设置进去之后，除了"退出登录"没有任何路回笔记区；搜索框里打字也看不到结果
 * （结果被 `route === "settings"` 的分支挡住）。
 *
 * 修复两处：①设置页头给可见出口「← 返回笔记」；②所有"去笔记区干活"的动作先 `goNotes()`。
 * 这个文件钉住这两条——**规则只写在 `fnbarWiring` 一处**，所以这里测它就等于测住了全部四个动作。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_SETTINGS } from "@menote/shared";
import { fnbarWiring } from "../src/app/NavPanels";
import { SettingsPanel } from "../src/features/settings/ui/SettingsPanel";
import type { NotesWorkspace } from "../src/features/notes/useNotesWorkspace";
import type { FnBarProps } from "../src/app/fnbar/FnBar";

afterEach(cleanup);

/** 只实现被断言到的那几个方法：多余的方法用不到，铺满会掩盖"到底调了什么" */
function fakeWorkspace(): { workspace: NotesWorkspace; calls: string[] } {
  const calls: string[] = [];
  const workspace = {
    // 返回新 id（"打开这一篇"的提示动作要用它，2026-09-28）
    createNote: async () => {
      calls.push("createNote");
      return "NEW_NOTE_ID";
    },
    publishMemo: async () => {
      calls.push("publishMemo");
    },
    open: async (id: string) => {
      calls.push(`open:${id}`);
    },
  } as unknown as NotesWorkspace;
  return { workspace, calls };
}

function wiring(overrides: Partial<Parameters<typeof fnbarWiring>[0]> = {}) {
  const { workspace, calls } = fakeWorkspace();
  const goNotes = vi.fn();
  const toast = vi.fn();
  const props: FnBarProps = fnbarWiring({
    workspace,
    view: { kind: "recent" },
    browseView: undefined,
    tags: [],
    showHome: false,
    composerMode: "memo",
    notebookPanel: null,
    vault: {} as Parameters<typeof fnbarWiring>[0]["vault"],
    goNotes,
    onViewChange: vi.fn(),
    onBrowseChange: vi.fn(),
    onComposerModeChange: vi.fn(),
    toast,
    ...overrides,
  });
  return { props, goNotes, calls, toast };
}

describe("从独立页回笔记区（fnbarWiring）", () => {
  it("新建笔记：先回笔记区，再真的建笔记", async () => {
    const { props, goNotes, calls } = wiring();
    props.onNewNote();
    expect(goNotes).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["createNote"]);
  });

  it("发布笔记 / 记录 / 待办：三个入口都先回笔记区", async () => {
    const note = wiring();
    note.props.onPublishNote("标题", "正文");
    expect(note.goNotes).toHaveBeenCalledTimes(1);
    expect(note.calls).toEqual(["createNote"]);
    // 提示在 `createNote` 拿到新 id 之后才推（要给"打开这一篇"用），所以让微任务先跑
    await Promise.resolve();
    expect(note.toast).toHaveBeenCalledWith("已新建笔记", "success", expect.anything());

    const memo = wiring();
    memo.props.onPublishMemo("记一笔", undefined as never);
    expect(memo.goNotes).toHaveBeenCalledTimes(1);
    expect(memo.calls).toEqual(["publishMemo"]);

    const task = wiring();
    task.props.onPublishTask("要做的事", undefined as never);
    expect(task.goNotes).toHaveBeenCalledTimes(1);
    expect(task.calls).toEqual(["publishMemo"]);
  });

  it("快捷输入发布后要**看得到结果**：新建笔记先让分栏浏览让位（进编辑界面）", () => {
    const onBrowseChange = vi.fn();
    const { props } = wiring({ onBrowseChange });

    props.onNewNote();
    expect(onBrowseChange).toHaveBeenCalledWith(null);

    onBrowseChange.mockClear();
    props.onPublishNote("标题", "正文");
    expect(onBrowseChange).toHaveBeenCalledWith(null);
  });

  it("轻提示带「快速跳转」动作：笔记=打开这一篇、Memo=去 Memo、待办=去待办", async () => {
    const note = wiring();
    note.props.onPublishNote("标题", "正文");
    // createNote 是异步的，提示在拿到 id 之后才推
    await Promise.resolve();
    const noteAction = note.toast.mock.calls.at(-1)?.[2] as { label: string; onClick: () => void };
    expect(noteAction.label).toBe("打开这一篇");
    noteAction.onClick();
    expect(note.calls).toContain("open:NEW_NOTE_ID");

    const memo = wiring();
    memo.props.onPublishMemo("记一笔", undefined as never);
    const memoAction = memo.toast.mock.calls.at(-1)?.[2] as { label: string; onClick: () => void };
    expect(memoAction.label).toBe("去 Memo");
    const onBrowseChange = vi.fn();
    const memo2 = wiring({ onBrowseChange });
    memo2.props.onPublishMemo("记一笔", undefined as never);
    (memo2.toast.mock.calls.at(-1)?.[2] as { onClick: () => void }).onClick();
    expect(onBrowseChange).toHaveBeenCalledWith("memo");

    const task = wiring({ onBrowseChange });
    task.props.onPublishTask("要做的事", undefined as never);
    const taskAction = task.toast.mock.calls.at(-1)?.[2] as { label: string; onClick: () => void };
    expect(taskAction.label).toBe("去待办");
    taskAction.onClick();
    expect(onBrowseChange).toHaveBeenCalledWith("task");
  });

  it("切分栏浏览（Memo / 待办 / 首页）：先回笔记区再切", () => {
    const onBrowseChange = vi.fn();
    const { props, goNotes } = wiring({ onBrowseChange });

    props.onBrowseChange?.("memo");
    expect(goNotes).toHaveBeenCalledTimes(1);
    expect(onBrowseChange).toHaveBeenCalledWith("memo");
  });

  it("切视图（笔记 / 最近 / 收藏…）：交给调用方，但调用方（App）里它同样先回笔记区", () => {
    const onViewChange = vi.fn();
    const { props, goNotes } = wiring({ onViewChange });

    props.onViewChange?.({ kind: "starred" });
    // 视图切换本身在这里不负责路由（App 的 showNotesView 里 goNotes 在它之前）
    expect(onViewChange).toHaveBeenCalledWith({ kind: "starred" });
    expect(goNotes).not.toHaveBeenCalled();
  });
});

describe("设置页的可见出口", () => {
  const baseProps: Parameters<typeof SettingsPanel>[0] = {
    page: "general",
    onNavigate: vi.fn(),
    role: "owner",
    themeMode: "system",
    onThemeMode: vi.fn(),
    /*
      夹具直接铺 `DEFAULT_USER_SETTINGS` 再改要改的那些：此前是把整份形状抄一遍，
      于是每加一个设置字段（M3 的 privacy、M4 的 version_trash、v0.5.2 的 task_view）
      这里都要跟着抄一次，漏了就报 `Cannot read properties of undefined`。
    */
    userSettings: { ...DEFAULT_USER_SETTINGS, quick_menu: [] },
    onPatchSettings: vi.fn(),
    registrationOpen: false,
    registrationCloseAt: 0,
    onChangeRegistration: vi.fn(async () => undefined),
    onChangePassword: vi.fn(async () => undefined),
    onLogout: vi.fn(),
  };

  it("页头有「← 返回笔记」，点了回笔记区（与回收站页「← 返回设置」对称）", async () => {
    const user = userEvent.setup();
    const onBackToNotes = vi.fn();
    render(<SettingsPanel {...baseProps} onBackToNotes={onBackToNotes} />);

    await user.click(screen.getByRole("button", { name: "← 返回笔记" }));
    expect(onBackToNotes).toHaveBeenCalledTimes(1);
  });

  it("每个设置分类页头都能看到出口（不是只在某一页有）", () => {
    // **【v0.8.4】11 类 → 9 类**：「编辑器」与「关于」不再是独立分类，内容并进「通用」
    for (const page of ["general", "privacy", "versions", "account"] as const) {
      const { unmount } = render(
        <SettingsPanel {...baseProps} page={page} onBackToNotes={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: "← 返回笔记" })).toBeTruthy();
      unmount();
    }
  });

  it("没传 onBackToNotes 时不渲染出口（组件本身不假设路由在哪）", () => {
    render(<SettingsPanel {...baseProps} />);
    expect(screen.queryByRole("button", { name: "← 返回笔记" })).toBeNull();
  });
});
