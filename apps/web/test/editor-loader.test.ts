// @vitest-environment jsdom
/**
 * 编辑器**共享加载器**与空闲预载（设计 v1 目标①、§3.1 / §3.2 / §3.3 / §3.4）。
 *
 * 钉的是四条容易悄悄坏掉的约定：
 * 1. 预载与按需加载**共用同一个 Promise**（否则同一份代码下载两遍，§3.3）；
 * 2. 网络策略：`saveData` 与慢速档跳过，**拿不到信息时默认允许**（§3.2）；
 * 3. 页面隐藏时不排期、已排期但还没跑的取消（§3.1）；
 * 4. 失败**不自动重试**，`resetEditorLoad` 之后才回到可重试的初始态（§3.4）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  editorLoadState,
  loadEditorModule,
  preloadNetworkAllows,
  resetEditorLoad,
  scheduleEditorPreload,
} from "../src/app/editor/loader";

vi.mock("../src/app/editor/Editor", () => ({ Editor: () => null }));

/** 换一份 `navigator.connection`（jsdom 默认没有 Network Information API） */
function setConnection(value: unknown): void {
  Object.defineProperty(navigator, "connection", { value, configurable: true, writable: true });
}

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetEditorLoad();
  setConnection(undefined);
  setVisibility("visible");
});

afterEach(() => {
  resetEditorLoad();
  vi.restoreAllMocks();
});

describe("编辑器共享加载器", () => {
  it("预载与按需加载共用同一个 Promise（进行中只有一份）", async () => {
    const preload = loadEditorModule("prefetch");
    const user = loadEditorModule("user");
    expect(user).toBe(preload);
    expect(editorLoadState()).toEqual({ status: "loading", triggeredBy: "prefetch" });
    await preload;
    expect(editorLoadState().status).toBe("ready");
  });

  it("网络策略：拿不到信息允许，saveData / 2g 跳过，3g 允许", () => {
    setConnection(undefined);
    expect(preloadNetworkAllows()).toBe(true);
    setConnection({ saveData: true });
    expect(preloadNetworkAllows()).toBe(false);
    setConnection({ effectiveType: "2g" });
    expect(preloadNetworkAllows()).toBe(false);
    setConnection({ effectiveType: "slow-2g" });
    expect(preloadNetworkAllows()).toBe(false);
    setConnection({ effectiveType: "3g" });
    expect(preloadNetworkAllows()).toBe(true);
  });

  it("网络不划算 → 记 skipped，不排期、不加载", async () => {
    setConnection({ saveData: true });
    scheduleEditorPreload();
    await tick();
    expect(editorLoadState()).toEqual({ status: "skipped", triggeredBy: null });
  });

  it("空闲时预载：触发方记为 prefetch，加载完成后 ready", async () => {
    scheduleEditorPreload();
    await tick();
    expect(editorLoadState()).toEqual({ status: "ready", triggeredBy: "prefetch" });
  });

  it("页面隐藏时不排期", async () => {
    setVisibility("hidden");
    scheduleEditorPreload();
    await tick();
    expect(editorLoadState()).toEqual({ status: "skipped", triggeredBy: null });
  });

  it("排期后页面被隐藏 → 还没跑起来的预载被取消", async () => {
    setVisibility("visible");
    scheduleEditorPreload();
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await tick();
    expect(editorLoadState()).toEqual({ status: "idle", triggeredBy: null });
  });

  // 放最后：这条会替换模块注册表，别影响上面的用例（`vi.doMock` 是"此后生效"）
  it("加载失败后不再自动重试——重调拿到的还是同一个被拒的 Promise", async () => {
    vi.resetModules();
    vi.doMock("../src/app/editor/Editor", () => {
      throw new Error("chunk 404");
    });
    const fresh = await import("../src/app/editor/loader");
    const first = fresh.loadEditorModule("prefetch");
    await expect(first).rejects.toThrow();
    expect(fresh.editorLoadState().status).toBe("failed");
    expect(fresh.loadEditorModule("user")).toBe(first);
    fresh.resetEditorLoad();
    expect(fresh.editorLoadState()).toEqual({ status: "idle", triggeredBy: null });
    vi.doUnmock("../src/app/editor/Editor");
  });
});
