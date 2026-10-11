/**
 * 同步引擎的生命周期（登录后创建/销毁、触发与回调装配）。
 *
 * 从 `App.tsx` 抽出（编辑器专项优化 v0.8.24：接线 `onSynced` 后 App 破了 500 行上限，
 * 引擎装配本来就自成一块）。三条回调都走 **ref 持有**：引擎只随登录状态创建/销毁，
 * 回调身份的变化不允许重建引擎——踩过的坑（M1-11 实测：10 秒 35 次 `GET /api/sync`）：
 * 把会 `setState` 的回调直接放进依赖数组，effect 重跑 → 引擎重建 → 立刻又跑一轮。
 */
import { useEffect, useRef } from "react";
import { createSyncEngine, type SyncEngine, type SyncStatus } from "../data/sync";

export interface UseSyncEngineLifecycleInput {
  /** 登录态是否就绪（`authenticated`）；未登录不建引擎 */
  enabled: boolean;
  /** 引擎状态上报（顶栏的"同步中 / 已同步"胶囊） */
  onStatus: (status: SyncStatus) => void;
  /**
   * 本页自己跑完一轮同步：**先**处理"自己推送成功的条目"（把打开时的正文基线跟上去，
   * 见 `useNotesWorkspace.notifyOwnPush`），**再**做界面刷新——顺序反了会把刚落地的
   * 自己的保存误报成"别处改过"（v0.8.24；此前 `notifyUploaded` 是死代码，基线从不更新）。
   */
  onOwnPush: (itemIds: string[]) => Promise<void>;
  onIdle: () => void;
  /** 别的标签页写入/同步完：只重读本地库，不再跑一轮同步（数据已在本地库里） */
  onRemoteChange: () => void | Promise<void>;
  /** 引擎句柄交给宿主（`notifyLocalWrite` 由写入路径调用） */
  onEngine?: (engine: SyncEngine | null) => void;
}

export function useSyncEngineLifecycle(input: UseSyncEngineLifecycleInput): void {
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  });

  const engineRef = useRef<SyncEngine | null>(null);
  const remoteRefreshRunning = useRef(false);
  /** 本次同步自己推送成功的条目（`onSynced` 记下，`idle` 时先跟基线再刷新） */
  const pushedItemIdsRef = useRef<string[]>([]);

  // 引擎只随登录状态创建/销毁；回调经 inputRef 间接调用
  useEffect(() => {
    if (!input.enabled) return undefined;

    const engine = createSyncEngine({
      onStatus: (status) => {
        inputRef.current.onStatus(status);
        // 失败要看得见：被 void 掉的 rejected promise 会让状态永远停在旧值（M1-11 踩过）
        if (status === "idle") {
          const pushedItemIds = pushedItemIdsRef.current;
          pushedItemIdsRef.current = [];
          void (async () => {
            if (pushedItemIds.length > 0) {
              await inputRef.current.onOwnPush(pushedItemIds);
            }
            inputRef.current.onIdle();
          })().catch((error: unknown) => {
            console.error("同步后刷新界面状态失败", error);
          });
        }
      },
      onSynced: (result) => {
        pushedItemIdsRef.current = result.pushed?.pushedItemIds ?? [];
      },
      /**
       * 别的标签页写入/同步完（M2-9）：本页**只重读本地库**，不再跑一轮同步——数据已经在本地
       * 库里了，省掉一次网络往返。用 in-flight 标记合并连发事件，避免多标签页同时活动时刷新风暴。
       */
      onRemoteChange: () => {
        if (remoteRefreshRunning.current) return;
        remoteRefreshRunning.current = true;
        void Promise.resolve(inputRef.current.onRemoteChange())
          .catch((error: unknown) => {
            console.error("跨标签页刷新失败", error);
          })
          .finally(() => {
            remoteRefreshRunning.current = false;
          });
      },
    });
    engineRef.current = engine;
    inputRef.current.onEngine?.(engine);
    engine.start();

    return () => {
      engine.stop();
      engineRef.current = null;
      inputRef.current.onEngine?.(null);
    };
    // enabled（登录态）是唯一的重建条件；回调身份变化由 inputRef 吸收
  }, [input.enabled]);
}
