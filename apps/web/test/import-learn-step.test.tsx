// @vitest-environment jsdom
/**
 * 导入时的「属性录入步」（2026-10-11，《MeNote 属性库设计 v1》v2.1 §6.3）。
 *
 * 这一步最容易做坏的地方是**它挡住了导入**：文件已经选好、用户只想把笔记导进来，
 * 却被迫回答"这些属性要不要收进库"。所以逐条钉住：
 * - 不传 `library` / 没有陌生键 → 这一步根本不出现；
 * - 一个都不勾、「都不收」、点遮罩、按 `Esc` → **导入照常发生**，库一个键都不多；
 * - 勾了才写库，且写的是"键 + 类型（+ 记住的样例值）"，不是把文件内容抄进库。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportNotesSummary } from "../src/features/notes/import-md";
import { ImportNotesFlow } from "../src/features/notes/ui/ImportNotesFlow";
import type { PropLibraryEntry } from "../src/features/props/model";

afterEach(cleanup);

function md(name: string, text: string): File {
  return new File([text], name, { type: "text/markdown" });
}

function entry(key: string, type: PropLibraryEntry["type"] = "text"): PropLibraryEntry {
  return { key, builtin: false, type, values: [] };
}

const UNKNOWN = "---\ntitle: 甲\nsource: https://example.com/a\n---\n\n正文";
const WITH_BLOCK = "---\ntitle: 甲\nauthor:\n  - 某人\n---\n\n正文";
const ALL_KNOWN = "---\ntitle: 甲\nsource: https://example.com/a\n---\n\n正文";

function setup(options: { library?: PropLibraryEntry[] } = {}) {
  const onImport = vi.fn(
    async (files: readonly File[]): Promise<ImportNotesSummary> => ({
      created: files.length,
      skipped: [],
    }),
  );
  const onLearn = vi.fn();
  render(
    <ImportNotesFlow
      targetLabel="工作"
      onImport={onImport}
      notify={() => undefined}
      library={options.library}
      onLearn={onLearn}
    />,
  );
  const input = screen.getByLabelText("选择要导入的 Markdown 文件");
  return { onImport, onLearn, input };
}

function pick(input: HTMLElement, files: File[]): void {
  fireEvent.change(input, { target: { files } });
}

describe("什么时候出这一步", () => {
  it("不传 library → 老路子，一个字都不多问", async () => {
    const { onImport, onLearn, input } = setup();
    pick(input, [md("a.md", UNKNOWN)]);
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("这些属性要收进属性库吗？")).toBeNull();
    expect(onLearn).not.toHaveBeenCalled();
  });

  it("传了 library 但文件里全是已知属性 → 也不出这一步", async () => {
    const { onImport, input } = setup({ library: [entry("source")] });
    pick(input, [md("a.md", ALL_KNOWN)]);
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("这些属性要收进属性库吗？")).toBeNull();
  });

  it("有陌生键 → 出这一步，列出键名、篇数与样例；**默认一个都不勾**", async () => {
    const user = userEvent.setup();
    const { input } = setup({ library: [] });
    pick(input, [md("a.md", UNKNOWN), md("b.md", UNKNOWN), md("c.md", WITH_BLOCK)]);

    // 多个文件先过确认框，确认之后才是录入步
    await screen.findByText(/把 3 个文件导入「工作」？/);
    await user.click(screen.getByRole("button", { name: "导入" }));

    await screen.findByText("这些属性要收进属性库吗？");
    const source = screen.getByRole("checkbox", { name: /source/ }) as HTMLInputElement;
    const author = screen.getByRole("checkbox", { name: /author/ }) as HTMLInputElement;
    expect(source.checked).toBe(false);
    expect(author.checked).toBe(false);
    // 两篇里有它才报篇数；样例取首行的值
    expect(screen.getByText("（2 篇）")).toBeTruthy();
    expect(screen.getByText(/例：https:\/\/example\.com\/a/)).toBeTruthy();
    // 块序列的样例取的是那一行原文（`- 某人`），只要求能认出是哪个属性
    expect(screen.getByText(/例：.*某人/)).toBeTruthy();
    // 未勾选时不出类型选择（少两行噪音）
    expect(screen.queryByLabelText(/类型/)).toBeNull();
  });
});

describe("跳过都不影响导入", () => {
  it("「继续导入」一个都不勾 → 库不动，笔记照常进", async () => {
    const user = userEvent.setup();
    const { onImport, onLearn, input } = setup({ library: [] });
    pick(input, [md("a.md", UNKNOWN)]);
    await screen.findByText("这些属性要收进属性库吗？");

    await user.click(screen.getByRole("button", { name: "继续导入" }));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onLearn).not.toHaveBeenCalled();
  });

  it("「都不收」→ 库不动，笔记照常进", async () => {
    const user = userEvent.setup();
    const { onImport, onLearn, input } = setup({ library: [] });
    pick(input, [md("a.md", UNKNOWN)]);
    await screen.findByText("这些属性要收进属性库吗？");

    await user.click(screen.getByRole("button", { name: "都不收" }));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onLearn).not.toHaveBeenCalled();
  });
});

describe("勾了才写库", () => {
  it("勾选 + 选类型 + 记住取值 → 交回「键 + 类型 + 那条样例值」，随后导入", async () => {
    const user = userEvent.setup();
    const { onImport, onLearn, input } = setup({ library: [] });
    pick(input, [md("a.md", UNKNOWN)]);
    await screen.findByText("这些属性要收进属性库吗？");

    await user.click(screen.getByRole("checkbox", { name: /source/ }));
    // 块序列默认给多行，这里改成日期，验"类型是用户选的、不是猜的"
    await user.selectOptions(screen.getByLabelText(/类型/), "date");
    await user.click(screen.getByRole("checkbox", { name: /记住取值/ }));
    await user.click(screen.getByRole("button", { name: "继续导入" }));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onLearn).toHaveBeenCalledTimes(1);
    const next = onLearn.mock.calls[0]?.[0] as PropLibraryEntry[];
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ key: "source", builtin: false, type: "date" });
    expect(next[0]?.values[0]).toContain("https://example.com/a");
  });

  it("只勾不选类型 → 按原形状给类型（块序列 = 多行），且不登记样例值", async () => {
    const user = userEvent.setup();
    const { onLearn, input } = setup({ library: [entry("source")] });
    pick(input, [md("a.md", WITH_BLOCK)]);
    await screen.findByText("这些属性要收进属性库吗？");

    await user.click(screen.getByRole("checkbox", { name: /author/ }));
    await user.click(screen.getByRole("button", { name: "继续导入" }));

    await waitFor(() => expect(onLearn).toHaveBeenCalledTimes(1));
    // 新收的键排在最前（和设置页里"新建排最前"一致），库里原有的一个都不动
    expect(onLearn).toHaveBeenCalledWith([entry("author", "multiline"), entry("source")]);
  });
});
