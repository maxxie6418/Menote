// @vitest-environment jsdom
/**
 * 版本历史面板（M4-11；《M4 界面稿》§四）。
 *
 * 对着界面稿的可验收条目写：唯一实心主按钮是「存为版本」、恢复确认框三段可见、
 * 行菜单四件事、对比区空状态、diff 有 +/- 前缀、锁定态下入口不可用（在 NoteWorkspace 上测）。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VersionDiff } from "../src/features/versions/ui/VersionDiff";
import {
  VersionHistoryPanel,
  type VersionHistoryPanelProps,
} from "../src/features/versions/ui/VersionHistoryPanel";
import { lineDiff, versionRows } from "../src/features/versions/model";
import type { VersionMeta } from "@menote/shared";
import { assertLabelledControls } from "./helpers/a11y";
import { assertSinglePrimaryAction } from "./helpers/design";

afterEach(cleanup);

const NOW = new Date(2026, 8, 27, 13, 0).getTime();

function version(overrides: Partial<VersionMeta> = {}): VersionMeta {
  return {
    id: "v1",
    rev: 1,
    reason: "manual",
    label: null,
    keep: 1,
    codec: "gzip",
    size_bytes: 2048,
    content_hash: "h",
    title: "标题",
    created_at: new Date(2026, 8, 27, 12, 3).getTime(),
    ...overrides,
  };
}

function renderPanel(overrides: Partial<VersionHistoryPanelProps> = {}) {
  const actions = {
    onClose: vi.fn(),
    onSeal: vi.fn(),
    onRestore: vi.fn(),
    onToggleKeep: vi.fn(),
    onOpenVersion: vi.fn(),
  };
  const { container } = render(
    <VersionHistoryPanel
      itemTitle="我的笔记"
      rows={versionRows([version()], NOW)}
      bodies={{ v1: "版本里的正文" }}
      currentBody="当前稿的正文"
      {...actions}
      {...overrides}
    />,
  );
  // 读屏底线（渲染层断言，见 helpers/a11y.ts）
  assertLabelledControls(container, { buttons: 1 });
  assertSinglePrimaryAction(container);
  return { container, ...actions };
}

describe("面板骨架", () => {
  it("页头是标题 + 条目标题 + 关闭；底部**只有「存为版本」一个实心主按钮**", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();

    expect(screen.getByRole("heading", { name: "版本历史" })).toBeTruthy();
    expect(screen.getByText("我的笔记")).toBeTruthy();

    // 主操作唯一：出现主色按钮的地方只有「存为版本」
    const primaries = [...document.querySelectorAll(".btn--primary")].map((el) => el.textContent?.trim());
    expect(primaries).toEqual(["存为版本"]);

    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("版本行显示时间 / 中文原因 / 大小 / 保留标记", () => {
    renderPanel();
    const row = document.querySelector(".versionrow") as HTMLElement;
    expect(row.textContent).toContain("09-27 12:03");
    expect(row.textContent).toContain("手动保存"); // 中文，不是 manual
    expect(row.textContent).toContain("2.0 KB");
    expect(row.textContent).toContain("保留");
  });

  it("没有版本时给空状态与出口提示，不显示空白列表", () => {
    renderPanel({ rows: [] });
    expect(screen.getByText("还没有版本")).toBeTruthy();
    expect(screen.getByText(/可以点下面的「存为版本」/)).toBeTruthy();
  });

  it("未选中版本时对比区给空状态（选一个看全文，选两个看差异）", () => {
    renderPanel();
    expect(screen.getByText(/选一个版本看全文/)).toBeTruthy();
  });
});

describe("行菜单与对比", () => {
  it("行菜单四件事：查看全文 / 与当前稿对比 / 恢复此版本 / 取消保留", async () => {
    const user = userEvent.setup();
    const { onOpenVersion, onToggleKeep } = renderPanel();

    await user.click(screen.getByRole("button", { name: "更多" }));
    const menu = screen.getByRole("menu", { name: /的版本操作/ });
    expect(within(menu).getByRole("menuitem", { name: "查看全文" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "与当前稿对比" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "恢复此版本" })).toBeTruthy();
    // 已保留 → 菜单项是「取消保留」
    expect(within(menu).getByRole("menuitem", { name: "取消保留" })).toBeTruthy();

    await user.click(within(menu).getByRole("menuitem", { name: "取消保留" }));
    expect(onToggleKeep).toHaveBeenCalledWith("v1", false);

    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(screen.getByRole("menuitem", { name: "查看全文" }));
    expect(onOpenVersion).toHaveBeenCalledWith("v1");
  });

  it("选一个版本看全文", async () => {
    const user = userEvent.setup();
    renderPanel();

    // 行的「选它」按钮与行菜单的触发器都含时间文案，这里取前者（`.versionrow__pick`）
    const pick = document.querySelector(".versionrow__pick") as HTMLElement;
    await user.click(pick);
    expect(screen.getByText("版本里的正文")).toBeTruthy();
  });

  it("与当前稿对比时显示 diff，并带 +/- 前缀文字", async () => {
    const user = userEvent.setup();
    renderPanel({
      bodies: { v1: "第一行\n旧的一行" },
      currentBody: "第一行\n新的一行",
    });

    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(screen.getByRole("menuitem", { name: "与当前稿对比" }));

    expect(screen.getByText(/新增 1 行 · 删除 1 行/)).toBeTruthy();
    const prefixes = [...document.querySelectorAll(".versiondiff__prefix")].map((el) => el.textContent);
    expect(prefixes).toContain("-");
    expect(prefixes).toContain("+");
  });
});

describe("恢复与存为版本", () => {
  it("恢复必须二次确认，且三段文案都在", async () => {
    const user = userEvent.setup();
    const { onRestore } = renderPanel();

    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(screen.getByRole("menuitem", { name: "恢复此版本" }));

    const dialog = screen.getByRole("dialog", { name: "恢复此版本" });
    expect(within(dialog).getByText(/覆盖当前稿/)).toBeTruthy();
    // 第 2 段必须在确认框里可见
    expect(within(dialog).getByText(/当前稿会先自动封存/)).toBeTruthy();
    expect(within(dialog).getByText(/版本表不动/)).toBeTruthy();
    expect(onRestore).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "恢复此版本" }));
    expect(onRestore).toHaveBeenCalledWith("v1");
  });

  it("「存为版本」弹窗可填备注，保存时把备注交出去（可空 → null）", async () => {
    const user = userEvent.setup();
    const { onSeal } = renderPanel();

    await user.click(screen.getByRole("button", { name: "存为版本" }));
    const dialog = screen.getByRole("dialog", { name: "存为版本" });
    await user.type(within(dialog).getByLabelText("备注（可空）"), "发布前");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(onSeal).toHaveBeenCalledWith("发布前");

    // 备注留空 → null（不是空字符串，服务端 schema 要 null）
    await user.click(screen.getByRole("button", { name: "存为版本" }));
    const second = screen.getByRole("dialog", { name: "存为版本" });
    await user.click(within(second).getByRole("button", { name: "保存" }));
    expect(onSeal).toHaveBeenLastCalledWith(null);
  });

  it("底部提示写明「恢复前会先保存当前稿」（前置条件可见）", () => {
    renderPanel();
    expect(screen.getByText(/恢复前会先保存当前稿/)).toBeTruthy();
  });
});

describe("对比视图", () => {
  it("只渲染一个滚动容器（列表与对比区各一个，不嵌套）", () => {
    const { container } = render(
      <VersionDiff leftTitle="此版本" rightTitle="当前稿" result={lineDiff("a", "b")} />,
    );
    expect(container.querySelectorAll(".versiondiff__scroll")).toHaveLength(1);
  });

  it("前后标题与摘要都在（读得出来在比什么）", () => {
    render(<VersionDiff leftTitle="此版本" rightTitle="当前稿" result={lineDiff("a", "b")} />);
    expect(screen.getByText("此版本")).toBeTruthy();
    expect(screen.getByText("当前稿")).toBeTruthy();
    expect(screen.getByText(/新增 1 行 · 删除 1 行/)).toBeTruthy();
  });

  it("滚动容器挂了 `hscroll` 且可聚焦（理由同表格网格）", () => {
    /*
      2026-10-04：横条改成「悬停/聚焦才显形」后，不可聚焦的容器等于把这条提示
      对键盘用户关在门外（DESIGN.md §6.1）。类名与 tabIndex 一起钉。
    */
    const { container } = render(
      <VersionDiff leftTitle="此版本" rightTitle="当前稿" result={lineDiff("a", "b")} />,
    );
    const scroll = container.querySelector(".versiondiff__scroll") as HTMLElement;
    expect(scroll.classList.contains("hscroll")).toBe(true);
    expect(scroll.getAttribute("tabindex")).toBe("0");
  });
});
