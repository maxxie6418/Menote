// @vitest-environment jsdom
/**
 * UI 验收点测试（对应 `docs/modules/Menote-M1-界面稿-v1.md` 的逐屏结构）：
 * 顶栏块位、录入框占位与禁用说明、空状态出口、账户菜单、设置分类可见性、状态栏提示、登录页错误就地提示。
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FnBar } from "../src/app/fnbar/FnBar";
import { Topbar } from "../src/app/topbar/Topbar";
import { InsecureContextBanner } from "../src/app/ui/InsecureContextBanner";
import { DEFAULT_USER_SETTINGS } from "@menote/shared";
import { toIndicator } from "../src/app/useSyncStatus";
import { LoginPage } from "../src/features/auth/ui/LoginPage";
import { RegisterPage } from "../src/features/auth/ui/RegisterPage";
import { DocStatusBar } from "../src/features/notes/ui/DocStatusBar";
import { NoteList } from "../src/features/notes/ui/NoteList";
import { SettingsPanel } from "../src/features/settings/ui/SettingsPanel";
import { APP_VERSION, PROJECT_REPO_URL } from "../src/app/about";
import type { LocalItem } from "../src/data/db";

afterEach(cleanup);

function note(id: string, overrides: Partial<LocalItem> = {}): LocalItem {
  return {
    id,
    type: "note",
    folder_id: null,
    title: `标题 ${id}`,
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 10,
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
    updated_at: 1_700_000_000_000,
    last_edit_at: null,
    last_device: null,
    deleted_at: null,
    deleted: false,
    pending: null,
    ...overrides,
  };
}

describe("顶栏块位（DESIGN.md §2.5-1）", () => {
  it("品牌 / 面包屑 / 搜索框 / 同步胶囊 / 账户入口 都在位；未启用隐私锁时不渲染隐私胶囊", () => {
    render(
      <Topbar
        user={{ username: "alice", role: "owner" }}
        breadcrumb="全部笔记"
        sync={toIndicator("idle", 0)}
        searchQuery=""
        onSearchChange={vi.fn()}
        userSettings={DEFAULT_USER_SETTINGS}
        themeMode="light"
        onThemeMode={vi.fn()}
        onFocusSearch={vi.fn()}
        onLock={vi.fn()}
        onOpenTrash={vi.fn()}
        onOpenSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    const topbar = screen.getByRole("banner");
    expect(within(topbar).getByText("Menote")).toBeTruthy();
    expect(within(topbar).getByText("全部笔记")).toBeTruthy();

    // 品牌标记 = 站点图标本体（`public/icon.svg`，与浏览器标签页同一张图），
    // 2026-09-27 用户确认改用图标，不再用 `--primary-grad` 渐变方块
    const brandMark = topbar.querySelector(".topbar__brand img.brandmark");
    expect(brandMark?.getAttribute("src")).toBe("/icon.svg");

    // 搜索框：M2-6 起可用（不再是禁用占位）
    const search = within(topbar).getByLabelText("搜索") as HTMLInputElement;
    expect(search.disabled).toBe(false);
    expect(search.placeholder).toContain("搜索标题");

    expect(within(topbar).getByText("已同步")).toBeTruthy();
    expect(within(topbar).getByRole("button", { name: "账户与设置" })).toBeTruthy();

    // 隐私锁胶囊：未启用隐私锁时不显示（拆解 M02-05）
    expect(within(topbar).queryByText(/隐私/)).toBeNull();
  });

  it("账户菜单里有「设置」与「退出登录」，Esc 关闭", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    const onLogout = vi.fn();

    render(
      <Topbar
        user={{ username: "alice", role: "owner" }}
        breadcrumb="全部笔记"
        sync={toIndicator("idle", 0)}
        searchQuery=""
        onSearchChange={vi.fn()}
        userSettings={DEFAULT_USER_SETTINGS}
        themeMode="light"
        onThemeMode={vi.fn()}
        onFocusSearch={vi.fn()}
        onLock={vi.fn()}
        onOpenTrash={vi.fn()}
        onOpenSettings={onOpenSettings}
        onLogout={onLogout}
      />,
    );

    const trigger = screen.getByRole("button", { name: "账户与设置" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const menu = screen.getByRole("menu", { name: "账户与设置" });
    // 账户菜单顶部显示版本号（用户 2026-09-27 要求）
    expect(within(menu).getByText(`MeNote v${APP_VERSION}`)).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: "设置" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("同步胶囊按队列与离线状态换文案", () => {
    expect(toIndicator("idle", 0)).toMatchObject({ tone: "ok", label: "已同步" });
    expect(toIndicator("syncing", 3)).toMatchObject({ tone: "busy", label: "3 项待上传" });
    expect(toIndicator("offline", 0)).toMatchObject({
      tone: "busy",
      label: "离线，改动会在联网后上传",
    });
    expect(toIndicator("error", 0)).toMatchObject({ tone: "err", label: "同步失败" });
  });
});

describe("功能栏与录入框占位", () => {
  it("三档模式可切换、录入框只有两行（无属性容器）、发布按钮禁用且说明原因", async () => {
    const user = userEvent.setup();
    render(
      <FnBar
        onNewNote={vi.fn()}
        onPublishNote={vi.fn()}
        onPublishMemo={vi.fn()}
        onPublishTask={vi.fn()}
        view={{ kind: "notebook" }}
        onViewChange={vi.fn()}
        notebookPanel={null}
        tags={[]}
        vault={{
          enabled: false,
          locked: false,
          count: 0,
          onOpen: vi.fn(),
          onUnlock: vi.fn(),
          onEnable: vi.fn(),
        }}
      />,
    );

    // 结构不变量：新建按钮 + 录入框两行（输入区 / 模式行）
    expect(screen.getByRole("button", { name: /新建笔记/ })).toBeTruthy();
    const input = screen.getByLabelText("快速录入");
    expect(input).toBeTruthy();
    // 属性行已按用户 2026-10-01 反馈退出功能栏录入框：容器与字段都不在
    expect(screen.queryByTestId("composer-extras")).toBeNull();

    const memo = screen.getByRole("button", { name: "Memo" });
    const task = screen.getByRole("button", { name: "待办" });
    const noteMode = screen.getByRole("button", { name: "笔记" });

    expect(memo.getAttribute("aria-pressed")).toBe("true");

    await user.click(task);
    expect(task.getAttribute("aria-pressed")).toBe("true");
    // 待办档不再有可编辑属性（截止 / 优先级去「添加内容窗口」设）
    expect(screen.queryByLabelText("截止日期")).toBeNull();
    expect(screen.queryByRole("button", { name: "中" })).toBeNull();

    await user.click(noteMode);
    expect(screen.queryByText("首行作标题")).toBeNull();

    // 笔记档已可用：禁用原因是"还没写内容"，不再是"M2 未提供"
    const publish = screen.getByRole("button", { name: "发布" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(publish.title).toContain("先写点内容");

    // Memo 档也已可用（M2-4）：同样只是"还没写内容"
    await user.click(screen.getByRole("button", { name: "Memo" }));
    const memoPublish = screen.getByRole("button", { name: "发布" }) as HTMLButtonElement;
    expect(memoPublish.disabled).toBe(true);
    expect(memoPublish.title).toContain("先写点内容");

    // 三档都已可用（Memo M2-4 / 待办 M2-5）：空内容时的禁用原因都是"还没写内容"
    await user.click(screen.getByRole("button", { name: "待办" }));
    const taskPublish = screen.getByRole("button", { name: "发布" }) as HTMLButtonElement;
    expect(taskPublish.disabled).toBe(true);
    expect(taskPublish.title).toContain("先写点内容");
  });
});

describe("笔记列表空状态", () => {
  it("没有笔记时给出原因与出口按钮", async () => {
    const user = userEvent.setup();
    const onNewNote = vi.fn();
    render(
      <NoteList
        items={[]}
        title="全部笔记"
        selectedId={null}
        loading={false}
        onSelect={vi.fn()}
        onNewNote={onNewNote}
      />,
    );

    expect(screen.getByText("还没有笔记")).toBeTruthy();
    expect(screen.getByText(/联网后自动上传/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /新建笔记/ }));
    expect(onNewNote).toHaveBeenCalledTimes(1);
  });

  it("列出条目并在行内显示待上传标记", () => {
    render(
      <NoteList
        items={[note("a"), note("b", { pending: "save_body" })]}
        title="全部笔记"
        selectedId="a"
        loading={false}
        onSelect={vi.fn()}
        onNewNote={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("待上传")).toBeTruthy();
    expect(screen.getByRole("button", { current: true }).textContent).toContain("标题 a");
  });
});

describe("列表行的加密空间移入/移出（M3-8）", () => {
  function renderList(options: {
    item?: Parameters<typeof note>[1];
    vault?: Parameters<typeof NoteList>[0]["vault"];
  }) {
    render(
      <NoteList
        items={[note("a", options.item)]}
        title="全部笔记"
        selectedId={null}
        loading={false}
        onSelect={vi.fn()}
        onNewNote={vi.fn()}
        vault={options.vault}
      />,
    );
    // 打开该行的更多菜单
    fireEvent.click(screen.getByRole("button", { name: /的更多操作/ }));
  }

  const baseVault = {
    enabled: true,
    locked: false,
    id: "vault",
    folders: [{ id: "vc1", name: "旅行" }],
    onMoveIn: vi.fn(),
    onMoveOut: vi.fn(),
  };

  it("未启用隐私锁：移入入口置灰并说明去哪里启用", () => {
    renderList({ vault: { ...baseVault, enabled: false, id: null, folders: [] } });
    const moveIn = screen.getByRole("menuitem", { name: "移入加密空间" }) as HTMLButtonElement;
    expect(moveIn.disabled).toBe(true);
    expect(moveIn.title).toContain("设置 › 隐私锁");
  });

  it("锁定时只能移入空间根（不下发内部层级），且没有「移出」", () => {
    const onMoveIn = vi.fn();
    renderList({
      vault: { ...baseVault, locked: true, folders: [], onMoveIn },
    });

    const moveIn = screen.getByRole("menuitem", { name: "移入加密空间" }) as HTMLButtonElement;
    expect(moveIn.disabled).toBe(false);
    fireEvent.click(moveIn);
    expect(onMoveIn).toHaveBeenCalledWith("a", null);

    // 锁定时不出现层级项（那些文件夹此时不可见）
    expect(screen.queryByRole("menuitem", { name: /移入 加密空间\// })).toBeNull();
    // 也不该出现「移出」（本来就不在空间里）
    expect(screen.queryByRole("menuitem", { name: "移出加密空间" })).toBeNull();
  });

  it("解锁后可选择空间内层级", () => {
    const onMoveIn = vi.fn();
    renderList({ vault: { ...baseVault, onMoveIn } });

    fireEvent.click(screen.getByRole("menuitem", { name: "移入 加密空间/旅行" }));
    expect(onMoveIn).toHaveBeenCalledWith("a", "vc1");
  });

  it("已在空间里的条目：显示「移出」，锁定时置灰并说明要先解锁", () => {
    const onMoveOut = vi.fn();
    renderList({
      item: { in_enc_space: 1 },
      vault: { ...baseVault, locked: true, folders: [], onMoveOut },
    });

    const moveOut = screen.getByRole("menuitem", { name: "移出加密空间" }) as HTMLButtonElement;
    expect(moveOut.disabled).toBe(true);
    expect(moveOut.title).toContain("先解锁");
    expect(screen.queryByRole("menuitem", { name: "移入加密空间" })).toBeNull();
  });

  it("已在空间里且已解锁：移出可用", () => {
    const onMoveOut = vi.fn();
    renderList({ item: { in_enc_space: 1 }, vault: { ...baseVault, onMoveOut } });

    const moveOut = screen.getByRole("menuitem", { name: "移出加密空间" }) as HTMLButtonElement;
    expect(moveOut.disabled).toBe(false);
    fireEvent.click(moveOut);
    expect(onMoveOut).toHaveBeenCalledWith("a");
  });
});

describe("正文状态栏（M04-04/M04-05）", () => {
  it("硬上限提示与阻止态可见；正常时显示大小与已同步", () => {
    const { rerender } = render(
      <DocStatusBar
        snapshot={{ bytes: 0, sizeLabel: "0.0 MB / 2 MB", sizeLevel: "ok", saveState: "synced" }}
      />,
    );
    expect(screen.getByText("0.0 MB / 2 MB")).toBeTruthy();
    expect(screen.getByText("已同步")).toBeTruthy();

    rerender(
      <DocStatusBar
        snapshot={{
          bytes: 1_900_000,
          sizeLabel: "1.8 MB / 2 MB",
          sizeLevel: "hard",
          saveState: "blocked",
        }}
      />,
    );
    // 破坏性后果必须保持可见，不能收进 InfoHint（DESIGN.md 禁止项 #8）
    expect(screen.getByText("已达硬上限，无法继续保存，请拆分内容")).toBeTruthy();
    expect(screen.getByText("已达硬上限")).toBeTruthy();

    rerender(
      <DocStatusBar
        snapshot={{ bytes: 40, sizeLabel: "0.0 MB / 2 MB", sizeLevel: "ok", saveState: "failed" }}
      />,
    );
    expect(screen.getByText("上传失败")).toBeTruthy();
  });
});

describe("登录与注册页", () => {
  it("登录失败就地提示（不弹窗）；注册入口按开关显隐", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn(async () => {
      throw new Error("用户名或密码错误");
    });

    const { rerender } = render(
      <LoginPage onLogin={onLogin} onGoRegister={vi.fn()} showRegisterEntry={false} />,
    );
    expect(screen.queryByRole("button", { name: /注册/ })).toBeNull();

    // 登录 / 注册页品牌区与顶栏用同一张站点图标
    expect(document.querySelector(".authcard__brand img.brandmark")?.getAttribute("src")).toBe(
      "/icon.svg",
    );

    await user.type(screen.getByLabelText("用户名"), "alice");
    await user.type(screen.getByLabelText("登录密码"), "pw");
    await user.click(screen.getByRole("button", { name: "登录" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("用户名或密码错误");

    rerender(<LoginPage onLogin={onLogin} onGoRegister={vi.fn()} showRegisterEntry />);
    expect(screen.getByRole("button", { name: /还没有账号？注册/ })).toBeTruthy();
  });

  it("注册页：两次密码不一致时就地提示且不能提交；首位用户显示 owner 提示", async () => {
    const user = userEvent.setup();
    const onRegister = vi.fn(async () => undefined);
    render(<RegisterPage onRegister={onRegister} onGoLogin={vi.fn()} firstUser />);

    expect(screen.getByText(/第一个注册的账号将成为管理员/)).toBeTruthy();

    await user.type(screen.getByLabelText("用户名"), "alice");
    await user.type(screen.getByLabelText("登录密码"), "pw1");
    await user.type(screen.getByLabelText("再输一次登录密码"), "pw2");

    const submit = screen.getByRole("button", { name: "注册" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByText("两次输入的密码不一致")).toBeTruthy();
    expect(onRegister).not.toHaveBeenCalled();
  });
});

describe("设置壳", () => {
  const baseProps = {
    role: "owner" as const,
    themeMode: "light" as const,
    onThemeMode: vi.fn(),
    userSettings: DEFAULT_USER_SETTINGS,
    onPatchSettings: vi.fn(),
    registrationOpen: false,
    registrationCloseAt: 0,
    onChangeRegistration: vi.fn(async () => undefined),
    onChangePassword: vi.fn(async () => undefined),
    onLogout: vi.fn(),
    onNavigate: vi.fn(),
  };

  it("owner 能看到全部 9 个分类；通用页有主题三档且当前档被选中", () => {
    render(<SettingsPanel {...baseProps} page="general" />);

    const nav = screen.getByRole("navigation", { name: "设置分类" });
    // 「编辑试验」2026-10-01 暂时收起（用户 2026-10-01），故不在下列清单里。
    // **【v0.8.4】11 类 → 9 类**：「编辑器」与「关于」不再是独立分类（内容并进「通用」），
    // 原「数据管理」改名「附件」。
    for (const label of [
      "通用",
      "账户与安全",
      "备份与导出",
      "隐私锁",
      "版本与回收站",
      "MCP",
      "附件",
      "实例管理",
    ]) {
      expect(within(nav).getByRole("button", { name: label })).toBeTruthy();
    }
    expect(within(nav).queryByRole("button", { name: "编辑试验" })).toBeNull();
    // 「备份」是旧名，现在的分类叫「备份与导出」（2026-10-01 改），不该再出现
    expect(within(nav).queryByRole("button", { name: "备份" })).toBeNull();
    // 被撤销的两个分类不该再作为一级入口出现（老 hash 由 LEGACY_SETTINGS_PAGES 接住）
    expect(within(nav).queryByRole("button", { name: "编辑器" })).toBeNull();
    expect(within(nav).queryByRole("button", { name: "关于" })).toBeNull();
    // 「数据管理」已改名「附件」，旧名不该再出现
    expect(within(nav).queryByRole("button", { name: "数据管理" })).toBeNull();

    const light = screen.getByRole("button", { name: "浅色" });
    expect(light.getAttribute("aria-pressed")).toBe("true");
  });

  it("页头收成一条：`h1` 标题 + 说明收进 ⓘ，**不显示分类计数**（v0.8.4）", () => {
    render(<SettingsPanel {...baseProps} page="general" />);

    // 标题与其它屏同级（首页 `.pane-head h1` / 待办 `.tkhead`）——此前这里是 h2
    expect(screen.getByRole("heading", { level: 1, name: "通用" })).toBeTruthy();
    // 口径说明收进 ⓘ（可点开的按钮），不在正文里平铺
    expect(screen.getByRole("button", { name: "通用分类说明" })).toBeTruthy();
    // **【v0.8.4】删掉「共 N 个分类」**：那个数字对用户零信息量，还会随角色变化
    // （owner 10 / member 9），容易被误读成"漏了分类"。
    expect(screen.queryByText(/共 \d+ 个分类/)).toBeNull();
  });

  it("作用域标记：设备级标「本机」、账号级标「跟随账号」，且平铺可见（v0.8.4）", () => {
    render(<SettingsPanel {...baseProps} page="general" />);

    // 主题是**设备级**偏好，其余几项跟随账号——这正是过去只写在 ⓘ 里、界面上看不出来的那条差别
    const themeRow = screen.getByText("主题").closest(".setrow") as HTMLElement;
    expect(within(themeRow).getByText("本机")).toBeTruthy();

    for (const name of ["启动视图", "时区", "待办筛选条", "笔记本树结构"]) {
      const row = screen.getByText(name).closest(".setrow") as HTMLElement;
      expect(within(row).getByText("跟随账号"), name).toBeTruthy();
      // 作用域是**标识**不是说明文字，不进 ⓘ（DESIGN.md §5.4-1 管的是说明性文字）
      expect(within(row).queryByText("本机"), name).toBeNull();
    }

    // 编辑体验卡里两种作用域并存：开关跟账号、"上次用的那一档"记本机
    const modeRow = screen.getByRole("switch", { name: "仅编辑" }).closest(".setrow") as HTMLElement;
    expect(within(modeRow).getByText("跟随账号")).toBeTruthy();
    const lastUsed = screen.getByText("打开时用哪一档").closest(".setrow") as HTMLElement;
    expect(within(lastUsed).getByText("本机")).toBeTruthy();
  });

  it("「关于」并进「通用」页底部：版本号与项目仓库地址（v0.8.4）", () => {
    render(<SettingsPanel {...baseProps} page="general" />);

    expect(screen.getByText(`v${APP_VERSION}`)).toBeTruthy();
    const link = screen.getByRole("link", { name: PROJECT_REPO_URL }) as HTMLAnchorElement;
    expect(link.href).toBe(PROJECT_REPO_URL);
    expect(link.target).toBe("_blank");
  });

  it("「编辑体验」并进「通用」页：三个编辑模式开关与那张卡都在（v0.8.4）", () => {
    render(<SettingsPanel {...baseProps} page="general" />);

    // 按**卡片的 aria-label** 定位而不是标题：卡片标题里内嵌着 ⓘ 按钮，
    // 它的可访问名不等于纯文本（`getByRole("heading", {name})` 会取不到）
    const card = within(screen.getByRole("region", { name: "编辑体验" }));
    for (const mode of ["仅编辑", "仅预览", "即时渲染"]) {
      expect(card.getByRole("switch", { name: mode }), mode).toBeTruthy();
    }
  });

  it("通用页：启动视图与快捷菜单开关都会即时回调", async () => {
    const user = userEvent.setup();
    const onPatchSettings = vi.fn();

    render(<SettingsPanel {...baseProps} page="general" onPatchSettings={onPatchSettings} />);

    await user.click(screen.getByRole("button", { name: "最近编辑" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ start_view: "recent" });

    // 快捷菜单：默认关着的「搜索」点一下变开启
    await user.click(screen.getByRole("switch", { name: "搜索" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ quick_menu: ["theme", "lock", "search"] });
  });

  it("通用页：待办筛选条的两形态可选，默认是基线「胶囊横排」（v0.5.2）", async () => {
    const user = userEvent.setup();
    const onPatchSettings = vi.fn();

    render(<SettingsPanel {...baseProps} page="general" onPatchSettings={onPatchSettings} />);

    const group = screen.getByRole("group", { name: "待办筛选条形态" });
    // 两档都来自契约 `TASK_FILTER_FORMS`（不是这里另写一份清单）
    expect(within(group).getAllByRole("button")).toHaveLength(2);
    expect(within(group).getByRole("button", { name: "胶囊横排" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    await user.click(within(group).getByRole("button", { name: "悬浮小组件" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ task_view: { filter_form: "floating" } });
  });

  /*
    编辑模式开关组的四条契约面用例已挪到 `settings-editor-modes.test.tsx`
    （2026-09-29 阶段 A：产品清单收敛，那张卡的断言长了一截，本文件要留在 `max-lines` 预算内）。
  */

  it("账户与安全页：改密表单与退出登录都在", () => {
    render(<SettingsPanel {...baseProps} page="account" />);
    expect(screen.getByLabelText("当前登录密码")).toBeTruthy();
    expect(screen.getByRole("button", { name: "修改登录密码" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeTruthy();
  });
});

describe("非安全连接的常驻警告", () => {
  it("给出可行动的解释，并把观测到的事实一并显示", () => {
    const { rerender } = render(
      <InsecureContextBanner
        environment={{
          secure: false,
          protocol: "http:",
          href: "http://me.example/app",
          hasSubtle: false,
          reason: "页面是用 http 打开的。请改用 https 访问。",
        }}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("https");
    expect(alert.textContent).toContain("无法登录");

    rerender(<InsecureContextBanner secure />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("可点元素键盘可达", () => {
  it("列表行是原生 button（可用 Enter 触发）", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <NoteList
        items={[note("a")]}
        title="全部笔记"
        selectedId={null}
        loading={false}
        onSelect={onSelect}
        onNewNote={vi.fn()}
      />,
    );

    // 行本身是 button（行内还有"更多操作"按钮，所以按 class 取行）
    const row = container.querySelector(".itemrow") as HTMLElement;
    expect(row.tagName).toBe("BUTTON");
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith("a");
  });
});
