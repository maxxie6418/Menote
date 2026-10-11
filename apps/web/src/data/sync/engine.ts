/**
 * 同步引擎编排（拆解 M13-02/13-03；设计稿《同步引擎设计》§4.2/§4.3/§4.4）。
 *
 * 一次运行 = 抢到同步主标签页锁 → 推送 outbox → 拉取增量。
 * 触发时机：应用打开、写入成功后（`notifyLocalWrite`）、标签页重新可见、网络恢复、前台每 5 分钟。
 * 不做实时推送（需求 §15.2）。
 */
import { SYNC_FOREGROUND_INTERVAL_MS } from "@menote/shared";
import { getSyncState, outboxCount } from "../db";
import { createSyncChannel, type SyncChannel } from "./broadcast";
import { withSyncLock } from "./leader";
import { pullOnce, type PullApi, type PullResult } from "./pull";
import { pushQueue, type PushApi, type PushBatchResult } from "./push";

export type SyncStatus = "idle" | "syncing" | "offline" | "error";

export interface SyncEngineOptions {
  api?: PushApi;
  pullApi?: PullApi;
  now?: () => number;
  random?: () => number;
  deviceLabel?: string | null;
  /** 本机设备标识（`syncState.device_id`）：随正文保存上报，服务端写进 `items.last_device` */
  deviceId?: string | null;
  onStatus?: (status: SyncStatus) => void;
  /** 别的标签页同步完了：本页据此刷新（M2-9 跨标签页通知） */
  onRemoteChange?: (event: "item-updated" | "cursor-advanced") => void;
  /**
   * 本页自己跑完一轮同步（含推送与拉取）后回调，先于 `onStatus("idle")`——
   * UI 用 `result.pushed.pushedItemIds` 把"打开时的正文基线"跟到刚推上去的内容
   * （编辑器专项优化 v0.8.24：新建笔记后第一次编辑不再误报"别处改过"）。
   */
  onSynced?: (result: SyncRunResult) => void;
  /** 便于测试注入广播通道替身 */
  channel?: SyncChannel;
}

export interface SyncRunResult {
  ran: boolean;
  pushed?: PushBatchResult;
  pulled?: PullResult;
  reason?: "busy" | "not-leader" | "offline" | "error";
  error?: string;
}

export interface SyncEngine {
  runOnce(): Promise<SyncRunResult>;
  /** 本地写入成功后调用：短暂防抖后触发一次同步 */
  notifyLocalWrite(): void;
  start(): void;
  stop(): void;
  pendingCount(): Promise<number>;
}

/** 写入成功后的防抖：把连续几次输入合并成一次同步 */
const WRITE_TRIGGER_DELAY_MS = 300;

export function createSyncEngine(options: SyncEngineOptions = {}): SyncEngine {
  const now = options.now ?? Date.now;
  const channel = options.channel ?? createSyncChannel();
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let unsubscribe: (() => void) | null = null;

  async function runOnce(): Promise<SyncRunResult> {
    if (running) return { ran: false, reason: "busy" };
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      options.onStatus?.("offline");
      return { ran: false, reason: "offline" };
    }

    running = true;
    options.onStatus?.("syncing");
    try {
      const outcome = await withSyncLock(async () => {
        /*
          设备标识**在这里读**（`syncState.device_id`，本地首次生成后持久化）：
          与 `pullOnce` 读游标同一个来源，省得从 `App` 一路传下来。
          `options.deviceId` 仍可覆盖（测试用）。
        */
        const deviceId = options.deviceId ?? (await getSyncState()).device_id;
        const pushed = await pushQueue({
          api: options.api,
          now,
          random: options.random,
          deviceLabel: options.deviceLabel,
          deviceId,
        });
        const pulled = await pullOnce(options.pullApi, now);
        return { pushed, pulled };
      });

      if (!outcome) {
        // 另一个标签页正在同步：不必报错，等下一次触发
        options.onStatus?.("idle");
        return { ran: false, reason: "not-leader" };
      }

      // 广播给别的标签页：它们据此刷新（本页不需要广播给自己）
      const pushedAny = outcome.pushed.succeeded > 0 || outcome.pushed.conflicted > 0;
      if (pushedAny || outcome.pulled.applied > 0) {
        channel.post({ kind: "cursor-advanced", cursor: outcome.pulled.cursor });
      }

      // 先报"同步完成"再回 idle：UI 要先把基线跟上去，随后的刷新才不会误报
      const runResult: SyncRunResult = { ran: true, pushed: outcome.pushed, pulled: outcome.pulled };
      options.onSynced?.(runResult);
      options.onStatus?.("idle");
      return runResult;
    } catch (error) {
      options.onStatus?.("error");
      return {
        ran: false,
        reason: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      running = false;
    }
  }

  function schedule(delayMs: number): void {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void runOnce();
    }, delayMs);
  }

  function onOnline(): void {
    schedule(0);
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === "visible") schedule(0);
  }

  return {
    runOnce,

    notifyLocalWrite(): void {
      schedule(WRITE_TRIGGER_DELAY_MS);
    },

    start(): void {
      if (started) return;
      started = true;
      schedule(0); // 应用打开

      // 别的标签页写入/同步完 → 本页刷新（M2-9）。**不做成"再来一次同步"**：
      // 它们已经把数据落到本地库了，这里只需要重新读库，省掉一轮网络往返。
      unsubscribe = channel.subscribe((event) => {
        // 广播通道是共用的，M3 起还承载隐私事件；同步引擎只关心这两种，其余交给各自的订阅方
        if (event.kind === "item-updated" || event.kind === "cursor-advanced") {
          options.onRemoteChange?.(event.kind);
        }
      });

      if (typeof window === "undefined") return; // 非浏览器环境（测试）不挂监听
      window.addEventListener("online", onOnline);
      document.addEventListener("visibilitychange", onVisibilityChange);
      interval = setInterval(() => schedule(0), SYNC_FOREGROUND_INTERVAL_MS);
    },

    stop(): void {
      started = false;
      unsubscribe?.();
      unsubscribe = null;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    },

    pendingCount: () => outboxCount(),
  };
}
