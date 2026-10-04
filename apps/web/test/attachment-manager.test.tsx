// @vitest-environment jsdom
/**
 * 设置 › 数据管理 › 附件管理（M10-03 · M6 批 2c；设计稿 §4.2）。
 *
 * 这一屏的验收点集中在**别让用户看错**上，所以用例盯的是四件事：
 * 1. **概览三数**（总数 / 占用 / 孤儿）是从列表现算的，占用不许编一个接口出来；
 * 2. **三种空态分得开**——一个附件都没有 / 有附件但没有孤儿 / 筛选后为空，三者文案与出口都不同；
 * 3. **清理孤儿有二次确认**，后果写明（不可撤销、空间真正释放），且**确认之前不许发请求**；
 * 4. **失败看得见**（DESIGN.md §5.4-2）：错误留在页面上，不用会自动消失的提示承载。
 *
 * 数据层整体替身（`vi.mock`）：这一屏只关心"拿到列表之后怎么显示"，取数与形状由
 * `apps/worker/test/attachments-list.test.ts` 与 `api-client.test.ts` 各自覆盖。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentListResponse, AttachmentListRow } from "@menote/shared";
import { assertLabelledControls } from "./helpers/a11y";

type ListOptions = { kind?: "original" | "thumb"; state?: "active" | "orphaned"; limit?: number };

const listMock = vi.fn<(options?: ListOptions) => Promise<AttachmentListResponse>>();
const gcMock = vi.fn<() => Promise<{ marked: number; removed: number }>>();

vi.mock("../src/data/api/endpoints", () => ({
  attachmentsApi: {
    list: (options?: ListOptions) => listMock(options),
    gc: () => gcMock(),
  },
}));

import { AttachmentManagerPage } from "../src/features/attachments/ui/AttachmentManagerPage";

afterEach(cleanup);

beforeEach(() => {
  listMock.mockReset();
  gcMock.mockReset();
});

function row(overrides: Partial<AttachmentListRow> = {}): AttachmentListRow {
  return {
    id: "att-1",
    sha256: "a".repeat(64),
    kind: "original",
    filename: "照片.png",
    mime: "image/png",
    size_bytes: 1024 * 1024,
    width: 800,
    height: 600,
    created_at: 1,
    updated_at: 2,
    orphaned_at: null,
    ref_count: 1,
    ...overrides,
  };
}

function respond(attachments: AttachmentListRow[], hasMore = false): void {
  listMock.mockResolvedValue({ attachments, has_more: hasMore });
}

async function renderPage(): Promise<HTMLElement> {
  const { container } = render(<AttachmentManagerPage />);
  await waitFor(() => expect(listMock).toHaveBeenCalled());
  await screen.findByText("附件概览");
  // 读屏底线：这一屏有筛选分段与清理按钮，最容易漏名字
  assertLabelledControls(container, { buttons: 4 });
  return container;
}

describe("概览三数", () => {
  it("总数 / 占用 / 孤儿数都从列表现算", async () => {
    respond([
      row({ id: "a", filename: "一.png", size_bytes: 1024 * 1024, ref_count: 2 }),
      row({ id: "b", filename: "二.png", size_bytes: 512 * 1024, ref_count: 1 }),
      row({ id: "c", filename: "三.png", size_bytes: 256 * 1024, ref_count: 0, orphaned_at: null }),
    ]);
    await renderPage();

    expect(screen.getByText("3 个")).toBeTruthy();
    expect(screen.getByText("1.8 MB")).toBeTruthy();
    expect(screen.getByText(/1 个可以开始标记/)).toBeTruthy();
  });

  it("列表行给出文件名、类型、尺寸、大小与引用条目数", async () => {
    respond([row({ filename: "截图.png", ref_count: 3 })]);
    await renderPage();

    expect(screen.getByText("截图.png")).toBeTruthy();
    // 元信息在 JSX 里是几段表达式（mime / 尺寸 / 大小 / 引用数），没有一个元素包住整句，
    // 所以按**整行的 textContent** 断言，而不是 getByText 正则（那样必然匹配不到）
    const rowEl = screen.getByText("截图.png").closest(".setrow");
    const meta = rowEl?.textContent ?? "";
    expect(meta).toContain("image/png");
    expect(meta).toContain("800×600");
    expect(meta).toContain("1.0 MB");
    expect(meta).toContain("被 3 条");
    // 「在用」既出现在行标签也出现在筛选按钮上，**必须收窄到行内**再断言
    expect(rowEl?.textContent).toContain("在用");
  });

  it("被截断时如实说「只列出最近 N 个」（不拿截断的列表冒充全部）", async () => {
    respond([row()], true);
    await renderPage();

    expect(screen.getByText("只列出最近 1 个附件，更早的请在正文里找。")).toBeTruthy();
  });

  it("隐私条目的附件照常显示文件名与缩略图（附件按明文存储，门禁只在正文层）", async () => {
    respond([row({ filename: "私密笔记里的图.png" })]);
    await renderPage();

    expect(screen.getByText("私密笔记里的图.png")).toBeTruthy();
    // alt 为空（文件名已经念过了），但**图确实渲染了**——没有被隐私过滤藏起来
    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toContain(`/api/attachments/h/${"a".repeat(64)}`);
  });
});

describe("三种空态", () => {
  it("① 一个附件都没有：说清为什么空 + 下一步", async () => {
    respond([]);
    await renderPage();

    expect(screen.getByText("还没有附件")).toBeTruthy();
    expect(screen.getByText(/正文里.*插入图片/)).toBeTruthy();
    // 没有孤儿也就没有可清理的对象：这一句保持可见，不藏进 ⓘ
    expect(screen.getByText("当前没有可清理的孤儿附件")).toBeTruthy();
    expect((screen.getByRole("button", { name: "清理孤儿附件" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("② 有附件但没有孤儿：给「当前没有可清理的孤儿附件」，列表照常显示", async () => {
    respond([row({ filename: "在用.png", ref_count: 1 })]);
    await renderPage();

    expect(screen.getByText("在用.png")).toBeTruthy();
    expect(screen.getByText("当前没有可清理的孤儿附件")).toBeTruthy();
    expect(screen.queryByText("还没有附件")).toBeNull();
  });

  it("③ 筛选后为空：与 ① 的文案不同，并给回到「全部」的出口", async () => {
    const user = userEvent.setup();
    respond([row({ filename: "在用.png", ref_count: 1 })]);
    await renderPage();

    await user.click(screen.getByRole("button", { name: "孤儿" }));

    expect(screen.getByText("没有符合这个筛选的附件")).toBeTruthy();
    expect(screen.queryByText("还没有附件")).toBeNull();
    expect(screen.queryByText("在用.png")).toBeNull();

    await user.click(screen.getByRole("button", { name: "回到全部" }));
    expect(screen.getByText("在用.png")).toBeTruthy();
  });

  it("筛选按「有没有引用」判：0 引用算孤儿（不按 orphaned_at 标记）", async () => {
    const user = userEvent.setup();
    respond([
      row({ id: "a", filename: "在用.png", ref_count: 1 }),
      row({ id: "b", filename: "没人用.png", ref_count: 0, orphaned_at: null }),
    ]);
    await renderPage();

    // 这条的关键是「**按有没有引用判**，不看 `orphaned_at`」——而 `orphaned_at` 恰好是
    // null。标签既出现在筛选按钮也出现在行内，收窄到那一行再断言
    const orphanRow = screen.getByText("没人用.png").closest(".setrow");
    expect(orphanRow?.textContent).toContain("孤儿");
    await user.click(screen.getByRole("button", { name: "孤儿" }));
    expect(screen.getByText("没人用.png")).toBeTruthy();
    expect(screen.queryByText("在用.png")).toBeNull();
  });
});

describe("手动清理孤儿附件", () => {
  it("先二次确认、确认之后才调 gc", async () => {
    const user = userEvent.setup();
    respond([row({ id: "a", filename: "没人用.png", ref_count: 0 }), row({ id: "b" })]);
    // `gc` 正常会返回 `{ marked, removed }`（响应过一遍 schema）；不设返回值的话
    // `await gc()` 拿到 undefined，组件读 `result.removed` 会抛错并被 catch 吃掉，
    // 于是**永远走不到 refresh**——那测的就不是「清完重读列表」了
    gcMock.mockResolvedValue({ marked: 1, removed: 0 });
    await renderPage();

    await user.click(screen.getByRole("button", { name: "清理孤儿附件" }));

    /*
      **确认框不能说做不到的话**（v0.8.2 修的就是这条）。
      旧文案无条件写着「删除不可撤销，占用的空间会真正释放」——而这一次点下去
      **一个文件都不会被删**（30 天保留期）。把不可逆操作的确认话说满，
      用户点了发现什么都没发生，只能反复点，于是判定「这按钮坏了」。
    */
    const dialog = screen.getByRole("dialog", { name: "清理孤儿附件" });
    expect(dialog.textContent).toContain("不会删除任何文件");
    expect(dialog.textContent).not.toContain("空间会真正释放");
    expect(gcMock).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "确认标记 1 个" }));
    await waitFor(() => expect(gcMock).toHaveBeenCalledTimes(1));
    // 清完要重读列表，否则界面还停在清理前
    await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThan(1));
  });

  it("**有过期的孤儿时**，确认框明说会真删几个、释放多少（两种情况不许混说）", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    respond([
      // 已满 30 天 → 这次真的会删
      row({ id: "old", filename: "过期.png", ref_count: 0, orphaned_at: now - 31 * 24 * 3600_000, size_bytes: 2 * 1024 * 1024 }),
      // 刚标记 → 只开始倒计时
      row({ id: "new", filename: "刚标记.png", ref_count: 0, orphaned_at: now - 1000 }),
    ]);
    gcMock.mockResolvedValue({ marked: 0, removed: 1 });
    await renderPage();

    await user.click(screen.getByRole("button", { name: "清理孤儿附件" }));
    const dialog = screen.getByRole("dialog", { name: "清理孤儿附件" });
    expect(dialog.textContent).toContain("将永久删除 1 个");
    expect(dialog.textContent).toContain("2.0 MB");
    expect(dialog.textContent).toContain("不可撤销");
    // 同时也如实说清楚**这次不会被删的**那批（含"已标记但还在保留期里"的）
    expect(dialog.textContent).toContain("另有 1 个这次不会被删");
    await user.click(within(dialog).getByRole("button", { name: "确认删除 1 个" }));
  });

  it("取消不发请求", async () => {
    const user = userEvent.setup();
    respond([row({ ref_count: 0 })]);
    await renderPage();

    await user.click(screen.getByRole("button", { name: "清理孤儿附件" }));
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(gcMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "清理孤儿附件" })).toBeNull();
  });

  it("清完的提示留在页面上（不是会自动消失的 toast）", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    respond([row({ ref_count: 0, orphaned_at: now - 31 * 24 * 3600_000 })]);
    gcMock.mockResolvedValue({ marked: 0, removed: 1 });
    await renderPage();

    await user.click(screen.getByRole("button", { name: "清理孤儿附件" }));
    const dialog = screen.getByRole("dialog", { name: "清理孤儿附件" });
    await user.click(within(dialog).getByRole("button", { name: "确认删除 1 个" }));

    expect(await screen.findByText("已删除 1 个到期孤儿附件，空间已释放")).toBeTruthy();
  });

  it("**只标记没删除**时，提示要说清「现在还没有删掉任何文件」", async () => {
    const user = userEvent.setup();
    respond([row({ ref_count: 0, orphaned_at: null })]);
    gcMock.mockResolvedValue({ marked: 1, removed: 0 });
    await renderPage();

    await user.click(screen.getByRole("button", { name: "清理孤儿附件" }));
    const dialog = screen.getByRole("dialog", { name: "清理孤儿附件" });
    await user.click(within(dialog).getByRole("button", { name: "确认标记 1 个" }));

    expect(
      await screen.findByText("已标记 1 个孤儿附件；它们要满 30 天才会真正删除，现在还没有删掉任何文件"),
    ).toBeTruthy();
  });

  it("**没有事可做时不说「已标记 0 个」**（那是句自相矛盾的话）", async () => {
    const now = Date.now();
    // 全部已标记但都没到期：按钮应当置灰，根本点不到
    respond([row({ ref_count: 0, orphaned_at: now - 5 * 24 * 3600_000 })]);
    await renderPage();

    const button = screen.getByRole("button", { name: "清理孤儿附件" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // 禁用必须说明为何，不许只置灰（DESIGN.md §6.1）
    expect(screen.getByText(/1 个都在 30 天保留期里/)).toBeTruthy();
  });
});

describe("孤儿的保留期倒计时（v0.8.2 修）", () => {
  it("**行里写出「已标记 N 天 · M 天后清理」**——点了要有看得见的变化", async () => {
    const now = Date.now();
    respond([
      row({ id: "waiting", filename: "倒计时中.png", ref_count: 0, orphaned_at: now - 5 * 24 * 3600_000 }),
      // 没标记的孤儿**不留空位**（否则会多出一个空的说明行）
      row({ id: "unmarked", filename: "还没标记.png", ref_count: 0, orphaned_at: null }),
    ]);
    await renderPage();

    const rowEl = screen.getByText("倒计时中.png").closest(".setrow");
    expect(rowEl?.textContent).toContain("已标记 5 天");
    expect(rowEl?.textContent).toContain("25 天后清理");

    const other = screen.getByText("还没标记.png").closest(".setrow");
    expect(other?.textContent).not.toContain("后清理");
  });

  it("已到期的写成「明天清理时会被删」，不给「0 天后」这种别扭说法", async () => {
    const now = Date.now();
    respond([row({ ref_count: 0, orphaned_at: now - 30 * 24 * 3600_000 })]);
    await renderPage();

    const rowEl = screen.getByText("照片.png").closest(".setrow");
    expect(rowEl?.textContent).toContain("明天清理时会被删");
  });

  it("在用的附件不写倒计时（它不会进清理这一步）", async () => {
    const now = Date.now();
    respond([row({ ref_count: 2, orphaned_at: now - 5 * 24 * 3600_000 })]);
    await renderPage();

    const rowEl = screen.getByText("照片.png").closest(".setrow");
    expect(rowEl?.textContent).not.toContain("后清理");
  });
});

describe("失败", () => {
  it("列表读不出来：错误可见，页面仍给出重试之外的下一步", async () => {
    listMock.mockRejectedValue(new Error("附件列表加载失败：网络不通"));
    await renderPage();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("网络不通");
  });

  it("清理失败：错误可见、确认框不消失（可以再试）", async () => {
    const user = userEvent.setup();
    respond([row({ ref_count: 0 })]);
    gcMock.mockRejectedValue(new Error("清理失败，请稍后重试"));
    await renderPage();

    await user.click(screen.getByRole("button", { name: "清理孤儿附件" }));
    const dialog = screen.getByRole("dialog", { name: "清理孤儿附件" });
    await user.click(within(dialog).getByRole("button", { name: "确认标记 1 个" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("清理失败");
  });
});

describe("缩略图", () => {
  it("缩略图取 ?thumb=1；加载失败回退文件图标（不留破图）", async () => {
    respond([row({ filename: "图.png" }), row({ id: "att-2", filename: "文档.pdf", mime: "application/pdf" })]);
    await renderPage();

    const images = [...document.querySelectorAll("img")];
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute("src")).toContain("?thumb=1");

    // 非图片根本不请求缩略图，直接给文件图标
    expect(screen.getByText("文档.pdf")).toBeTruthy();

    fireEvent.error(images[0] as HTMLImageElement);
    await waitFor(() => expect(document.querySelectorAll("img")).toHaveLength(0));
    // 图标仍与文件名同在（不是把整行清掉）
    expect(screen.getByText("图.png")).toBeTruthy();
  });
});
