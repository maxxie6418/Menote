// @vitest-environment jsdom
/**
 * 编辑试验页：三篇可切换，警告可见，写入不碰到正式存储钥匙。
 *
 * `/` 命令（编辑拓展阶段 B / Task B3）加的是第二条边界：命令**只改试验存储**，不写
 * `menote:notes`、也没有任何发布通道。这一页存在的理由就是这个，所以两条各测一遍。
 * 编辑器换成替身——jsdom 跑不了真的 CodeMirror。但 `/` 的判定与执行**复用 `Editor` 导出的纯函数**
 * （`slashQueryAt` / `applyFormatAt`），替身里不另写一套规则，否则测的是替身而不是产品。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as EditorModule from "../src/app/editor/Editor";
import { EDITOR_LAB_STORAGE_KEY } from "../src/features/editor-lab/store";
import { EditorLabPage } from "../src/features/editor-lab/ui/EditorLabPage";

vi.mock("../src/app/editor/Editor", async (importOriginal) => {
  const actual = await importOriginal<typeof EditorModule>();
  const { useEffect, useRef, useState } = await import("react");

  /**
   * 替身只做真 `Editor` 在这几条用例里必须有的五件事：受控地把输入抛给宿主（`onChange`）、
   * 交出句柄（`onReady`，含 `applyFormat`）、按同一规则上报 `/` 触发词（`onSlashQuery`）、
   * 让 `applyFormat` 落在自己的文本上、按真 `Editor` 的时机上报生命周期事件。
   * 读数与菜单接线都在宿主那一侧，这里不替它做判断。
   */
  function EditorStub({
    initialValue,
    ariaLabel,
    onChange,
    onReady,
    onSlashQuery,
    onLifecycle,
    live,
    readOnly,
  }: EditorModule.EditorProps) {
    const [value, setValue] = useState(initialValue);
    const valueRef = useRef(value);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const onLifecycleRef = useRef(onLifecycle);

    useEffect(() => {
      valueRef.current = value;
    }, [value]);

    useEffect(() => {
      onLifecycleRef.current = onLifecycle;
    }, [onLifecycle]);

    useEffect(() => {
      const apply = (next: string): void => {
        setValue(next);
        onChange(next);
      };
      const handle: EditorModule.EditorHandle = {
        read: () => valueRef.current,
        insert: (text) => apply(valueRef.current + text),
        replace: (marker, text) => apply(valueRef.current.replace(marker, text)),
        replaceFrontmatter: (next) => {
          // 区间从**替身自己的文本**算，不收 expected（与真 Editor 同口径）
          const at = valueRef.current.indexOf("---", 3);
          const end = at < 0 ? -1 : valueRef.current.indexOf("\n", at + 1);
          if (end < 0) apply(next + valueRef.current);
          else apply(next + valueRef.current.slice(end + 1));
          return true;
        },
        applyFormat: (command) => {
          const caret = textareaRef.current?.selectionStart ?? valueRef.current.length;
          const result = actual.applyFormatAt(valueRef.current, { from: caret, to: caret }, command);
          apply(result.text);
        },
      };
      onReady?.(handle);
      // 真 Editor 也只在挂载时交一次句柄
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * 生命周期与真 `Editor` 对齐：`created` / `listenerAdded` 发生在视图建好那一刻，
     * `destroyed` / `listenerRemoved` 发生在销毁，`modeReconfigured` 只随档位属性变化发生
     * ——挂载时那两次是"按 props 配置"，不算重配置。
     */
    useEffect(() => {
      onLifecycleRef.current?.("created");
      onLifecycleRef.current?.("listenerAdded");
      return () => {
        onLifecycleRef.current?.("listenerRemoved");
        onLifecycleRef.current?.("destroyed");
      };
    }, []);

    const firstModeRun = useRef(true);
    useEffect(() => {
      if (firstModeRun.current) {
        firstModeRun.current = false;
        return;
      }
      onLifecycleRef.current?.("modeReconfigured");
    }, [live, readOnly]);

    return (
      <textarea
        ref={textareaRef}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setValue(next);
          onChange(next);
          onSlashQuery?.(actual.slashQueryAt(next, event.currentTarget.selectionStart));
        }}
      />
    );
  }

  return { ...actual, Editor: EditorStub };
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

/** 读页面上的生命周期读数（如「本页编辑器实例：1」）；括号里的备注不参与取值。 */
function reading(label: string): number {
  const line = screen.getByText(new RegExp(`^${label}：`));
  return Number(/：(\d+)/.exec(line.textContent ?? "")?.[1]);
}

/** 这一页不许发布：任何网络出口都算越界。 */
function publishStub(): ReturnType<typeof vi.fn> {
  const publish = vi.fn();
  vi.stubGlobal("fetch", publish);
  return publish;
}

describe("编辑试验页", () => {
  it("警告可见，三篇都能切，且只写试验钥匙", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("menote:notes", "正式笔记");
    render(<EditorLabPage />);

    expect(screen.getByRole("status").textContent).toContain("不写入笔记");
    const list = screen.getByRole("complementary", { name: "试验笔记列表" });
    expect(list.className).toContain("listpane");
    expect(screen.getByRole("button", { name: "短文" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "代码块" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "稍长" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "代码块" }));
    expect(screen.getByRole("button", { name: "代码块" }).getAttribute("aria-current")).toBe("true");
    await waitFor(() => {
      expect((screen.getByLabelText("代码块的试验正文") as HTMLTextAreaElement).value).toContain(
        "function greet",
      );
    });

    await waitFor(() => {
      expect(window.localStorage.getItem(EDITOR_LAB_STORAGE_KEY)).toContain("lab-2");
    });
    expect(window.localStorage.getItem("menote:notes")).toBe("正式笔记");
    expect(Object.keys(window.localStorage).filter((key) => key !== "menote:notes")).toEqual([
      EDITOR_LAB_STORAGE_KEY,
    ]);
  });

  it("快捷框的 `/` 命令只改试验存储，不碰正式笔记、不发布", async () => {
    const user = userEvent.setup();
    const publish = publishStub();
    window.localStorage.setItem("menote:notes", "正式笔记");
    render(<EditorLabPage />);

    const memo = screen.getByLabelText("Memo 快捷录入") as HTMLTextAreaElement;
    await user.type(memo, "/");
    expect(await screen.findByRole("option", { name: "加粗" })).toBeTruthy();
    // 快捷输入只给基础命令：标题 / 代码块 / 任务清单不进快捷框
    expect(screen.queryByRole("option", { name: "标题" })).toBeNull();
    await user.type(memo, "加粗");
    expect(await screen.findByRole("option", { name: "加粗" })).toBeTruthy();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(window.localStorage.getItem(EDITOR_LAB_STORAGE_KEY)).toContain("**");
    });
    // 触发词要一并消失，光标落在标记中间（接着打字就是加粗的内容）
    expect(memo.value).toBe("****");
    await waitFor(() => {
      expect(memo.selectionStart).toBe(2);
    });
    expect(window.localStorage.getItem("menote:notes")).toBe("正式笔记");
    expect(publish).not.toHaveBeenCalled();
  });

  it("正文区的 `/` 命令同样只改试验存储、不发布", async () => {
    const user = userEvent.setup();
    const publish = publishStub();
    window.localStorage.setItem("menote:notes", "正式笔记");
    render(<EditorLabPage />);

    const body = (await screen.findByLabelText("短文的试验正文")) as HTMLTextAreaElement;
    // 清空后再打：光标落在行首，`/` 才是触发词（正文里"。"后面直接打 `/` 不算，见下）
    await user.clear(body);
    await user.type(body, "/");
    // 正文给全部命令（与快捷框的基础命令集区分开）
    expect(await screen.findByRole("option", { name: "标题" })).toBeTruthy();
    await user.type(body, "加粗");
    expect(await screen.findByRole("option", { name: "加粗" })).toBeTruthy();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(window.localStorage.getItem(EDITOR_LAB_STORAGE_KEY)).toContain("**");
    });
    expect(body.value).toContain("**");
    expect(body.value).not.toContain("/加粗");
    expect(window.localStorage.getItem("menote:notes")).toBe("正式笔记");
    expect(publish).not.toHaveBeenCalled();

    // 非行首、也非空白后的 `/` 不是触发词——菜单不许自己跳出来
    await user.type(body, "正文/");
    expect(screen.queryByRole("listbox", { name: "命令" })).toBeNull();
  });

  it("同级档位连切 20 次只累计重配置，实例与监听不增", async () => {
    render(<EditorLabPage />);

    const body = await screen.findByLabelText("短文的试验正文");
    await waitFor(() => {
      expect(screen.queryByText(/^本页编辑器实例：1（档位重配置 0 次）$/)).not.toBeNull();
    });

    /*
      「仅编辑 ↔ 即时渲染」在 React 树里是同一个位置、同一个 key，编辑器不会重挂，
      所以这里切的是档位而不是实例。真 `Editor` 走 `Compartment` 重配置——重建文档的话
      实例数会往上爬、撤销历史也会丢，那正是本读数要抓的。
    */
    for (let index = 0; index < 10; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "即时渲染" }));
      fireEvent.click(screen.getByRole("button", { name: "仅编辑" }));
    }

    await waitFor(() => {
      const line = screen.getByText(/^本页编辑器实例：/);
      expect(Number(/档位重配置 (\d+) 次/.exec(line.textContent ?? "")?.[1])).toBeGreaterThanOrEqual(20);
    });
    expect(reading("本页编辑器实例")).toBe(1);
    // 监听数与实例数同步：编辑器视图自己的更新监听，档位切换不动它（Task C1 Step 3）
    expect(reading("本页事件监听")).toBe(1);
    // 同一个替身实例没被换掉：档位切换不该重建正文宿主
    expect(screen.getByLabelText("短文的试验正文")).toBe(body);
  });

  it(
    "连续 20 次模式 / 样文切换后，实例与监听读数回到基线",
    async () => {
      const user = userEvent.setup();
      render(<EditorLabPage />);

      // 懒加载的编辑器先落地，读数才有意义
      await screen.findByLabelText("短文的试验正文");
      await waitFor(() => expect(reading("本页编辑器实例")).toBe(1));
      expect(reading("本页事件监听")).toBe(1);

      /*
        菜单打开期间它把 keydown 挂在 `document` 上，但这一栏**只数编辑器视图自己的监听**
        （Task C1 Step 3），所以开菜单不该让读数动；关掉也不该动——数进去的话这里会变成
        2 → 1，正好掩盖"视图销毁了、菜单监听还挂着"这类分岔。
      */
      await user.type(screen.getByLabelText("Memo 快捷录入"), "/");
      await waitFor(() => expect(screen.getByRole("listbox", { name: "命令" })).toBeTruthy());
      expect(reading("本页事件监听")).toBe(1);
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("listbox", { name: "命令" })).toBeNull());
      expect(reading("本页事件监听")).toBe(1);

      // 切到「仅预览」编辑器就卸了：读数要跟着掉，不然它只是个数 DOM 的
      fireEvent.click(screen.getByRole("button", { name: "仅预览" }));
      await waitFor(() => expect(reading("本页编辑器实例")).toBe(0));

      /*
        这一轮要按二十多次，用 `fireEvent` 而不是 `user.click`：指针事件的模拟在并跑时会把
        这个用例拖过超时线，而它要验的只是"读数回不回基线"——不需要"像真人那样点"。
      */
      for (let index = 0; index < 10; index += 1) {
        fireEvent.click(screen.getByRole("button", { name: "双栏" }));
        fireEvent.click(screen.getByRole("button", { name: index % 2 === 0 ? "代码块" : "短文" }));
        fireEvent.click(screen.getByRole("button", { name: "仅预览" }));
      }
      fireEvent.click(screen.getByRole("button", { name: "双栏" }));

      await waitFor(() => expect(reading("本页编辑器实例")).toBe(1));
      expect(reading("本页事件监听")).toBe(1);
    },
    20_000,
  );
});
