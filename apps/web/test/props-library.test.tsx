// @vitest-environment jsdom
/**
 * 设置 › 属性库（2026-10-11，《MeNote 属性库设计 v1》v2.1 §6.2）。
 *
 * 这一页有两个容易做错的点，都在这里钉住：
 * 1. **它是删属性的唯一入口**——正文侧只给「用 / 不用」，所以这里的删除必须能真的删掉，
 *    而且必须先二次确认（库里一删，所有笔记的候选里都没有它了）；
 * 2. **内置键只列不删**——`status` / `title` 这些键由专用控件管，库里出现可删的
 *    `status` 会让用户删完发现"没删掉"（卡片里那行还在）。
 */
import "fake-indexeddb/auto";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, putCachedBody, saveDraft } from "../src/data/db";
import type { PropLibraryEntry } from "../src/features/props/model";
import { PropLibraryPage } from "../src/features/props/ui/PropLibraryPage";

afterEach(cleanup);

beforeEach(async () => {
  await db.delete();
  await db.open();
});

function entry(key: string, type: PropLibraryEntry["type"] = "text", values: string[] = []): PropLibraryEntry {
  return { key, builtin: false, type, values };
}

function renderPage(library: PropLibraryEntry[], onChange = vi.fn()) {
  render(<PropLibraryPage library={library} onChange={onChange} />);
  return onChange;
}

describe("空态与内置键", () => {
  it("空库给一句能照着做的空态", async () => {
    renderPage([]);
    expect(screen.getByText(/还没有自建属性/)).toBeTruthy();
    // 统计是异步的，等它落地（否则 act 警告）
    await waitFor(() => expect(screen.getByText(/已看 0 篇/)).toBeTruthy());
  });

  it("内置五键只列出来看：有「内置」标记、没有删除按钮", () => {
    renderPage([]);
    const builtin = screen.getByRole("region", { name: "内置属性" });
    for (const key of ["title", "tags", "status", "due", "priority"]) {
      expect(within(builtin).getByText(key)).toBeTruthy();
    }
    expect(within(builtin).getAllByText("内置")).toHaveLength(5);
    // 只列出来看：一个删除按钮都没有（标题旁的 ⓘ 是说明按钮，不算）
    expect(within(builtin).queryByRole("button", { name: /删除/ })).toBeNull();
  });
});

describe("新建条目", () => {
  it("键名 + 类型 → onChange 收到新条目（排在最前）", async () => {
    const user = userEvent.setup();
    const onChange = renderPage([entry("url")]);

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
    const onChange = renderPage([entry("url")]);
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
    const onChange = renderPage([entry("url")]);

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
    const onChange = renderPage([entry("url")]);
    const key = screen.getByLabelText("键名 url");
    await user.clear(key);
    await user.type(key, "due");
    await user.tab();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("删除条目（唯一入口 = 必须二次确认）", () => {
  it("点删除只弹确认框，确认后库里才少一条", async () => {
    const user = userEvent.setup();
    const onChange = renderPage([entry("url"), entry("source", "date")]);

    await user.click(screen.getByRole("button", { name: "删除属性 url" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("删除属性 url？")).toBeTruthy();
    // 后果要写清楚：md 不动、别的笔记不受影响
    expect(screen.getByText(/md 一动不动/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "删除条目" }));
    expect(onChange).toHaveBeenCalledWith([entry("source", "date")]);
  });

  it("取消 → 库里一个都不动", async () => {
    const user = userEvent.setup();
    const onChange = renderPage([entry("url")]);
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
    const builtin = screen.getByRole("region", { name: "内置属性" });
    await waitFor(() => expect(within(builtin).getAllByText("1 篇")).toHaveLength(3));
    // `due` / `priority` 没出现过 → 不能跟着显示成 1 篇
    expect(within(builtin).getAllByText("还没被用到")).toHaveLength(2);
  });

  it("统计失败时给一句可见的说明，编辑功能不受影响", async () => {
    vi.spyOn(db.bodies, "toArray").mockRejectedValueOnce(new Error("indexeddb 炸了"));
    renderPage([entry("url")]);
    expect(await screen.findByText(/统计「被多少篇用到」失败/)).toBeTruthy();
    // 用量列退化成「—」，但新建/删除照常
    expect(screen.getByRole("button", { name: "删除属性 url" })).toBeTruthy();
  });
});
