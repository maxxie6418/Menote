// @vitest-environment jsdom
/**
 * 设置 › 属性库（2026-10-11；界面按《MeNote 属性卡片与属性库-设计 v1》§3 重画）。
 *
 * 这一页有两个容易做错的点，都在这里钉住：
 * 1. **它是删属性的唯一入口**——正文侧只给「用 / 不用」，所以这里的删除必须能真的删掉，
 *    而且必须先二次确认（库里一删，所有笔记的候选里都没有它了）；
 * 2. **内置键只列不删**——`status` / `title` 这些键由专用控件管，库里出现可删的
 *    `status` 会让用户删完发现"没删掉"（卡片里那行还在）。它们的**显示名可改**（走
 *    `prop_labels`），但类型与候选取值不可改（值域扩展是设计 §8 明确不在本期的"路 B"）。
 */
import "fake-indexeddb/auto";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, putCachedBody, saveDraft } from "../src/data/db";
import type { PropLabels, PropLibraryEntry } from "../src/features/props/model";
import { PropLibraryPage } from "../src/features/props/ui/PropLibraryPage";

afterEach(cleanup);

beforeEach(async () => {
  await db.delete();
  await db.open();
});

function entry(key: string, type: PropLibraryEntry["type"] = "text", values: string[] = []): PropLibraryEntry {
  return { key, builtin: false, type, values };
}

function renderPage(
  library: PropLibraryEntry[],
  onChange = vi.fn(),
  labels: PropLabels = {},
  onLabelsChange = vi.fn(),
) {
  render(
    <PropLibraryPage
      library={library}
      labels={labels}
      onChange={onChange}
      onLabelsChange={onLabelsChange}
    />,
  );
  return { onChange, onLabelsChange };
}

/** 内置五行没有自己的卡（重画后是一张表），靠「内置」标记把它们挑出来 */
function builtinRows(): HTMLLIElement[] {
  return screen
    .getAllByText("内置")
    .map((badge) => badge.closest("li"))
    .filter((row): row is HTMLLIElement => row !== null);
}

describe("空态与内置键", () => {
  it("空库给一句能照着做的空态", async () => {
    renderPage([]);
    expect(screen.getByText(/还没有自建属性/)).toBeTruthy();
    // 统计是异步的，等它落地（否则 act 警告）
    await waitFor(() => expect(screen.getByText(/已看 0 篇/)).toBeTruthy());
  });

  it("内置五键在表里、带「内置」标记、没有删除按钮", () => {
    renderPage([]);
    const rows = builtinRows();
    expect(rows).toHaveLength(5);
    const text = rows.map((row) => row.textContent ?? "").join("|");
    for (const key of ["title", "tags", "status", "due", "priority"]) {
      expect(text).toContain(key);
    }
    expect(screen.queryByRole("button", { name: /删除属性 (title|tags|status|due|priority)/ })).toBeNull();
  });

  it("内置键的类型是只读陈述：select 禁用，候选值只展示功能值域", () => {
    renderPage([]);
    expect((screen.getByLabelText("status 的类型") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("due 的类型") as HTMLSelectElement).disabled).toBe(true);
    // 清单两键的值域是功能定死的；没有候选的类型给一句「—」
    expect(screen.getByText("todo、doing、done")).toBeTruthy();
    expect(screen.getByText("high、medium、low")).toBeTruthy();
    expect(screen.getAllByText("— 这种类型没有候选取值")).toHaveLength(3);
  });
});

describe("新建条目", () => {
  it("键名 + 类型 → onChange 收到新条目（排在最前）", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPage([entry("url")]);

    await user.type(screen.getByLabelText("新属性的键名"), "source");
    await user.selectOptions(screen.getByLabelText("新属性的类型"), "date");
    await user.click(screen.getByRole("button", { name: "新建" }));

    expect(onChange).toHaveBeenCalledWith([
      { key: "source", builtin: false, type: "date", values: [] },
      { key: "url", builtin: false, type: "text", values: [] },
    ]);
  });

  it("保留键 / 库里已有 / 形状不合法 → 报错且一个字都不写", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPage([entry("url")]);
    const input = screen.getByLabelText("新属性的键名");

    await user.type(input, "status");
    await user.click(screen.getByRole("button", { name: "新建" }));
    expect(screen.getByRole("alert").textContent).toMatch(/是 MeNote 自己的键/);

    await user.clear(input);
    await user.type(input, "url");
    await user.click(screen.getByRole("button", { name: "新建" }));
    expect(screen.getByRole("alert").textContent).toMatch(/库里已经有/);

    await user.clear(input);
    await user.type(input, "a b");
    await user.click(screen.getByRole("button", { name: "新建" }));
    expect(screen.getByRole("alert").textContent).toMatch(/只能用字母/);

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("改条目", () => {
  it("改类型 / 改候选值 / 改键名都走 onChange", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPage([entry("url")]);

    await user.selectOptions(screen.getByLabelText("url 的类型"), "choice");
    expect(onChange).toHaveBeenLastCalledWith([entry("url", "choice")]);

    const values = screen.getByLabelText("url 的候选取值");
    await user.type(values, "https://a, https://b");
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith([entry("url", "text", ["https://a", "https://b"])]);

    const key = screen.getByLabelText("键名 url");
    await user.clear(key);
    await user.type(key, "source");
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith([entry("source")]);
  });

  it("改成一个保留键 → 报错、库里不动", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPage([entry("url")]);
    const key = screen.getByLabelText("键名 url");
    await user.clear(key);
    await user.type(key, "due");
    await user.tab();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("显示名（翻译层：只改界面叫法，不动 md）", () => {
  it("库里没设时是空框 + 源名当占位；设了就把值填上", () => {
    renderPage([entry("url")], vi.fn(), { url: "链接" });
    expect((screen.getByLabelText("url 的显示名") as HTMLInputElement).value).toBe("链接");
    // 没设过的自建键：空框，占位提示「界面直接显示源名」
    renderPage([entry("other")]);
    expect((screen.getByLabelText("other 的显示名") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("other 的显示名") as HTMLInputElement).placeholder).toMatch(/直接显示 other/);
  });

  it("改显示名 → onLabelsChange 收到新表（清空 = 删掉这个显示名）", async () => {
    const user = userEvent.setup();
    const { onLabelsChange } = renderPage([entry("url")]);
    const input = screen.getByLabelText("url 的显示名");

    await user.type(input, "链接");
    await user.tab();
    expect(onLabelsChange).toHaveBeenLastCalledWith({ url: "链接" });

    await user.clear(input);
    await user.tab();
    expect(onLabelsChange).toHaveBeenLastCalledWith({});
  });

  it("内置键的显示名也能改（从前那张卡不给改）", async () => {
    const user = userEvent.setup();
    const { onLabelsChange } = renderPage([]);
    const input = screen.getByLabelText("status 的显示名");
    expect((input as HTMLInputElement).value).toBe("");
    expect((input as HTMLInputElement).placeholder).toBe("状态");

    await user.type(input, "进度");
    await user.tab();
    expect(onLabelsChange).toHaveBeenLastCalledWith({ status: "进度" });
  });

  it("改键名时显示名跟着键走（不丢用户设的中文名）", async () => {
    const user = userEvent.setup();
    const { onChange, onLabelsChange } = renderPage([entry("url")], vi.fn(), { url: "链接" });
    const key = screen.getByLabelText("键名 url");
    await user.clear(key);
    await user.type(key, "link");
    await user.tab();

    expect(onChange).toHaveBeenLastCalledWith([entry("link")]);
    expect(onLabelsChange).toHaveBeenLastCalledWith({ link: "链接" });
  });
});

describe("删除条目（唯一入口 = 必须二次确认）", () => {
  it("点删除只弹确认框，确认后库里才少一条", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPage([entry("url"), entry("source", "date")]);

    await user.click(screen.getByRole("button", { name: "删除属性 url" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("删除属性 url？")).toBeTruthy();
    // 后果要写清楚：md 不动、别的笔记不受影响
    expect(screen.getByText(/md 一动不动/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "删除条目" }));
    expect(onChange).toHaveBeenCalledWith([entry("source", "date")]);
  });

  it("删条目**不动**显示名（设计 §4.1：显示名独立于条目，加回库时叫法还在）", async () => {
    const user = userEvent.setup();
    const { onLabelsChange } = renderPage([entry("url")], vi.fn(), { url: "链接", other: "别的" });
    await user.click(screen.getByRole("button", { name: "删除属性 url" }));
    await user.click(screen.getByRole("button", { name: "删除条目" }));
    expect(onLabelsChange).not.toHaveBeenCalled();
  });

  it("取消 → 库里一个都不动", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPage([entry("url")]);
    await user.click(screen.getByRole("button", { name: "删除属性 url" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText("删除属性 url？")).toBeNull();
  });
});

describe("「被多少篇用到」只数本机有的正文", () => {
  it("缓存正文 + 草稿一起去重后按篇算，草稿覆盖同一篇的缓存", async () => {
    await putCachedBody("i1", "---\nurl: a\n---\n\n正文", 1, "h1", 1);
    await putCachedBody("i2", "---\nurl: b\n---\n\n正文", 1, "h2", 1);
    // 同一篇 i3 的缓存里有 url，草稿里已经没有它了：**以草稿为准**（否则 url 会算成 3 篇）
    await putCachedBody("i3", "---\nurl: c\n---\n\n正文", 1, "h3", 1);
    await saveDraft("i3", "---\nsource: x\n---\n\n正文", 2);

    renderPage([entry("url"), entry("source", "date")]);
    expect(await screen.findByText("2 篇")).toBeTruthy();
    expect(screen.getByText("1 篇")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/已看 3 篇/)).toBeTruthy());
  });

  it("内置键的用量也在数（它们不在外来键里，得单独算）", async () => {
    await putCachedBody("i1", "---\ntitle: 甲\ntags: [a]\nstatus: todo\n---\n\n正文", 1, "h1", 1);

    renderPage([]);
    // title / tags / status 各 1 篇；due / priority 没出现过
    await waitFor(() => expect(screen.getAllByText("1 篇")).toHaveLength(3));
    expect(screen.getAllByText("还没被用到")).toHaveLength(2);
  });

  it("统计失败时给一句可见的说明，编辑功能不受影响", async () => {
    vi.spyOn(db.bodies, "toArray").mockRejectedValueOnce(new Error("indexeddb 炸了"));
    renderPage([entry("url")]);
    expect(await screen.findByText(/统计「被多少篇用到」失败/)).toBeTruthy();
    // 用量列退化成「—」，但新建/删除照常
    expect(screen.getByRole("button", { name: "删除属性 url" })).toBeTruthy();
  });
});
