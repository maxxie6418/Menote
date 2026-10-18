/**
 * 编辑器模块的**共享加载器**与空闲预载（《编辑器体验优化设计 v1》目标①、§3）。
 *
 * 为什么单独一个模块：编辑器（CM6 + 各插件）是首屏**最大的一块懒加载代码**，而它有两个入口——
 * **用户点进编辑**（`React.lazy` 的按需加载）与**空闲后台预载**（§3.1）。两个入口必须共用
 * 同一个进行中的 Promise：否则预载还在途、用户又点进编辑，同一份代码会下载两遍（§3.3）。
 *
 * 三条边界（§3.2 / §3.4）：
 * 1. **网络不划算就不预载**：`saveData === true`，或 `effectiveType` 是慢速档（slow-2g / 2g），
 *    直接跳过；拿不到网络信息时**默认允许**（多数浏览器没有 Network Information API）。
 * 2. **失败不自动重试**：预载失败只是"没赚到"，用户点进编辑时照旧走一次按需加载；
 *    真在界面上出错要由错误边界说清楚，并给一个**手动重试**（`resetEditorLoad`）。
 * 3. **页面隐藏就取消**：后台标签页里做这件事没有收益，还抢主线程与带宽。
 *
 * 观测（§3.5）：只在本机时间线上打 mark，**不发任何生产遥测**。
 */
import type * as EditorModuleNS from "./Editor";

type EditorModule = typeof EditorModuleNS;

/** 加载状态；`skipped`（网络不划算 / 页面隐藏）与 `failed` 分开记，§3.5 的四种情形才对得上 */
export type EditorLoadStatus = "idle" | "loading" | "ready" | "failed" | "skipped";

/** 这一次加载是谁触发的：预载命中 / 在途 / 用户按需 */
export type EditorLoadTrigger = "prefetch" | "user";

let pending: Promise<EditorModule> | null = null;
let status: EditorLoadStatus = "idle";
let triggeredBy: EditorLoadTrigger | null = null;
let preloadScheduled = false;
let cancelSchedule: (() => void) | null = null;

/**
 * **共享的加载函数**：预载与按需加载都走这里，进行中的 Promise 只有一份（§3.3）。
 *
 * 返回的是**同一个** Promise，调用方可以安全地 `await` 多次；失败后**不会**自动重试，
 * 只把状态记成 `failed`（要重试必须先 `resetEditorLoad`）。
 */
export function loadEditorModule(by: EditorLoadTrigger = "user"): Promise<EditorModule> {
  if (!pending) {
    status = "loading";
    triggeredBy = by;
    mark("editor:load-start");
    pending = import("./Editor").then(
      (mod) => {
        status = "ready";
        mark("editor:load-ready");
        return mod;
      },
      (error: unknown) => {
        // 不自动重试：只如实记状态，重试交给 `resetEditorLoad`（§3.4）
        status = "failed";
        throw error;
      },
    );
  }
  return pending;
}

/** 当前加载状态（§3.5 的观测与"预载在途"提示用） */
export function editorLoadState(): { status: EditorLoadStatus; triggeredBy: EditorLoadTrigger | null } {
  return { status, triggeredBy };
}

/** 手动重试前**先清掉被拒的 Promise**（§3.4）；调用方还要重建懒加载组件与错误边界 */
export function resetEditorLoad(): void {
  pending = null;
  status = "idle";
  triggeredBy = null;
  preloadScheduled = false;
  cancelSchedule?.();
  cancelSchedule = null;
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", cancelWhenHidden);
  }
}

/**
 * 网络策略（§3.2）：`saveData` 或慢速档就跳过，拿不到信息时默认允许。
 *
 * 单独导出是为了能进 CI——真浏览器里没有 Network Information API 时它必须返回 `true`。
 */
export function preloadNetworkAllows(): boolean {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (!connection) return true;
  if (connection.saveData === true) return false;
  return connection.effectiveType !== "slow-2g" && connection.effectiveType !== "2g";
}

/**
 * **空闲预载编辑器代码**（§3.1 / §3.2）。
 *
 * 入口调用时机：认证通过、主工作区已经可交互之后（调用方负责判断，见 `NotesPane`）。
 * 重复调用只有第一次生效；网络不划算或页面已隐藏时记 `skipped`，不排期。
 *
 * 调度三级回退：`requestIdleCallback(timeout 2000)` → `scheduler.postTask(background)` + 2s
 * 看门狗 → `setTimeout(0)`。**最迟 2 秒**要么开始加载、要么放弃（页面隐藏时直接取消）。
 */
export function scheduleEditorPreload(): void {
  if (preloadScheduled || status !== "idle") return;
  preloadScheduled = true;
  if (!preloadNetworkAllows() || isHidden()) {
    status = "skipped";
    return;
  }
  cancelSchedule = schedule(() => {
    cancelSchedule = null;
    if (isHidden()) return;
    // 预载失败不自动重试、也不打断用户：这里只把拒绝吞掉（§3.4）
    void loadEditorModule("prefetch").catch(() => undefined);
  });
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", cancelWhenHidden);
  }
}

/** 页面隐藏：取消还没跑起来的预载（已经开始的加载不打断，它已经在网络上了） */
function cancelWhenHidden(): void {
  if (!isHidden()) return;
  cancelSchedule?.();
  cancelSchedule = null;
  document.removeEventListener("visibilitychange", cancelWhenHidden);
}

function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** 空闲调度三级回退，返回取消函数 */
function schedule(run: () => void): () => void {
  const idle = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    }
  );
  if (typeof idle.requestIdleCallback === "function") {
    const handle = idle.requestIdleCallback(run, { timeout: 2000 });
    return () => idle.cancelIdleCallback?.(handle);
  }
  const postTask = (
    navigator as Navigator & {
      scheduler?: { postTask?: (cb: () => void, options?: { priority: string }) => Promise<unknown> };
    }
  ).scheduler?.postTask;
  if (typeof postTask === "function") {
    let done = false;
    const watchdog = globalThis.setTimeout(() => {
      done = true;
      run();
    }, 2000);
    void postTask(
      () => {
        if (done) return;
        done = true;
        globalThis.clearTimeout(watchdog);
        run();
      },
      { priority: "background" },
    ).catch(() => undefined);
    return () => {
      done = true;
      globalThis.clearTimeout(watchdog);
    };
  }
  const timer = globalThis.setTimeout(run, 0);
  return () => globalThis.clearTimeout(timer);
}

/** 本机时间线（§3.5）：只是给排查用的 mark，不上报、不依赖 */
function mark(name: string): void {
  if (typeof performance === "undefined") return;
  performance.mark(name);
}
