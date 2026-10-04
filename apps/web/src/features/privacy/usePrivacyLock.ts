/**
 * 隐私锁的**组装层**（M3-4；《隐私锁设计》§5）。
 *
 * 把三样东西接到一起：纯状态机（`model.ts`）、浏览器端原语（`crypto.ts`）、
 * 服务端材料与本地缓存（`cryptoApi` / `data/db/privacy`），再补上多标签一致性与档位计时。
 *
 * 三条工程口径：
 * 1. **不保管密钥到磁盘**：解锁时派生的 KEK 只放内存 ref，锁定即清；没有任何持久化密钥材料。
 * 2. **门禁只有一处**：本 hook 产出 `gate`（来自 `model.gateFrom`），其它 feature 只接收它，
 *    不自己拼判定（`packages/shared/privacy.ts` 是唯一判定实现）。
 * 3. **广播只带状态**：跨标签只同步"解锁了 / 锁上了 / 哪一篇解密了"，从不带内容。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CRYPTO_KDF,
  CRYPTO_KDF_ITERATIONS,
  DEFAULT_PRIVACY_SETTINGS,
  base64UrlEncode,
  cryptoBlobFromBase64Url,
  type PrivacyGate,
  type PrivacySettings,
} from "@menote/shared";
import { cryptoApi } from "../../data/api/endpoints";
import { cacheCryptoState, clearCachedCrypto, cachedMaterials } from "../../data/db/privacy";
import { createSyncChannel, type SyncChannel } from "../../data/sync/broadcast";
import { deriveKek, makeVerifier, randomContentKey, randomSalt, unwrapContentKey, verifyPassword, wrapContentKey } from "./crypto";
import {
  DEVICE_UNLOCK_KEY,
  changeTier as changeTierIn,
  expiryFor,
  gateFrom,
  initialRuntime,
  lockAll as lockAllIn,
  lockAllItems as lockAllItemsIn,
  lockItem as lockItemIn,
  lockScope as lockScopeIn,
  needsDeviceFlag,
  tick,
  unlock as unlockIn,
  unlockItem as unlockItemIn,
  type PrivacyRuntime,
  type PrivacyTier,
} from "./model";

export interface PrivacyLockState {
  /** 服务端/缓存里记着"已启用隐私锁" */
  enabled: boolean;
  runtime: PrivacyRuntime;
  /** 判定用门禁：交给各视图（列表 / 搜索 / Memo / 编辑器） */
  gate: PrivacyGate;
  /** 材料缓存已就绪（离线也能解锁） */
  ready: boolean;
  /** 正在跑一次写操作（启用 / 改密 / 关闭） */
  busy: boolean;
  unlock: (password: string, tier: PrivacyTier) => Promise<boolean>;
  enable: (password: string) => Promise<void>;
  /**
   * 改密（M3-9）：先用旧密码解出内容密钥 K，再用新密码重新包裹——
   * **K 不变**，所以已加密的内容不会被这次改密"锁死"。
   */
  changePassword: (oldPassword: string, newPassword: string) => Promise<boolean>;
  /**
   * 重置隐私密码（忘记密码，M3-9）：服务端用**当前根机密**（`AUTH_PEPPER` 派生的备份包裹键）
   * 解出 K → 浏览器用新密码重新包裹。同样**K 不变**；`k_wrapped_backup` 由服务端重新包一份。
   */
  resetPassword: (newPassword: string) => Promise<void>;
  /**
   * **重新包裹内容密钥**（2026-09-28 加的运维修复入口）。
   *
   * 什么时候需要：实例的根机密变更过，或从"另配第二个机密 `BACKUP_CRED_KEY`"的旧版本升级上来——
   * 那时库里的 `k_wrapped_backup` 用**现在**的派生键解不开，表现是"忘记隐私密码 → 重置"失败。
   * 这个动作把 K 从 `k_wrapped_pw` 解出来、交给服务端用当前键重包一次。
   *
   * 需要**当前隐私密码**（解 K 的唯一途径）；**不改密码、不动内容**；
   * 密码不对返回 `false`（与 `changePassword` 同一约定），由调用方就地给可见提示。
   */
  rewrapContentKey: (password: string) => Promise<boolean>;
  disable: () => Promise<void>;
  lockAll: () => void;
  lockScope: () => void;
  /**
   * **逐篇解密**（2026-10-04 接线）：校验隐私密码，通过后把这一篇记进"本次会话已解密"。
   *
   * 与 `unlock` 的关键差别：**不动范围门禁**。两道门禁正交（`model.ts` 头注、设计 §2.2）——
   * 解开一篇不等于解锁整个加密空间，范围门禁原本是什么状态就仍是什么状态。
   * 密码错返回 `false`（与 `unlock` 同一约定），由解锁框就地显示错误并计次。
   *
   * 此前 `unlockItem` 只有广播事件处理器在用，界面侧从无调用方——于是「解锁此篇」按钮
   * 走的是 `unlock`（只开范围门禁），**输对密码后这一篇依然进不了 `unlockedItems`**，
   * 占位面板纹丝不动。这条是真 bug，本动作是它的修复出口。
   */
  decryptItem: (itemId: string, password: string) => Promise<boolean>;
  unlockItem: (itemId: string) => void;
  lockItem: (itemId: string) => void;
  lockAllItems: () => void;
  setTier: (tier: PrivacyTier) => void;
  /** 重新拉一次服务端材料（登录后、同步后、跨设备改密后） */
  refresh: () => Promise<void>;
}

export interface UsePrivacyLockOptions {
  /** 未登录时不拉材料、不装广播（材料要会话） */
  authenticated: boolean;
  /**
   * 用户设置里的隐私锁配置。
   *
   * **声明成可选是刻意的**：契约里它是可选字段，旧行可能真没有；hook 内部会补齐默认值
   * （见下方的 `config` 归一化与 2026-09-27 的线上白屏记录）。
   */
  config?: PrivacySettings;
}

function readDeviceFlag(): boolean {
  try {
    return globalThis.localStorage?.getItem(DEVICE_UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDeviceFlag(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.setItem(DEVICE_UNLOCK_KEY, "1");
    else globalThis.localStorage?.removeItem(DEVICE_UNLOCK_KEY);
  } catch {
    // 隐私模式 / 无 localStorage：设备长期档退化成"本次会话"
  }
}

export function usePrivacyLock(options: UsePrivacyLockOptions): PrivacyLockState {
  const authenticated = options.authenticated;

  /**
   * **配置必须先补齐再用**——2026-09-27 的线上整站白屏正是这里踩的：
   * `privacy` 在设置契约里是**可选字段**，而本地库里的旧行真的可能没有它；
   * 消费端直接读 `config.tier` 就抛 TypeError，React 卸载整棵树 → 只剩 CSS 底色。
   *
   * 数据层已经补了一道（`data/db/settings.ts` 的 `withSettingsDefaults`，旧行读出来即补齐）；
   * 这里再加一层**消费端兜底**，因为道理是通用的：**可选字段的消费方不能假定它一定在**。
   * 用 `useMemo` 兜住身份——这个对象会进 `useMemo`/`useEffect` 依赖，每渲染新建会让下游重算。
   */
  const config = useMemo<PrivacySettings>(
    () => ({
      ...DEFAULT_PRIVACY_SETTINGS,
      ...options.config,
      scope: { ...DEFAULT_PRIVACY_SETTINGS.scope, ...options.config?.scope },
    }),
    [options.config],
  );

  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runtime, setRuntime] = useState<PrivacyRuntime>(() =>
    initialRuntime(false, config.tier),
  );

  /** 本次解锁派生的 KEK：只在内存，锁定即清（改密/解包 K 时才需要） */
  const kekRef = useRef<CryptoKey | null>(null);
  const channelRef = useRef<SyncChannel | null>(null);
  /** 最新 runtime 的镜像：广播回调里要读它，但不能在 setState 更新器里做副作用 */
  const runtimeRef = useRef(runtime);

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  const publishUnlocked = useCallback((tier: PrivacyTier, expiresAt: number | null) => {
    channelRef.current?.post({ kind: "privacy-unlocked", tier, expiresAt });
  }, []);

  // —— 广播：订阅 + 新标签页握手 ——
  useEffect(() => {
    if (!authenticated) return undefined;
    const channel = createSyncChannel();
    channelRef.current = channel;

    const unsubscribe = channel.subscribe((event) => {
      switch (event.kind) {
        case "privacy-unlocked":
          // 别的标签页已解锁：跟着开（KEK 不共享——本页要读隐私内容时仍需自己解锁单篇）
          setRuntime((current) =>
            current.lockState === "disabled"
              ? current
              : {
                  ...current,
                  lockState: "unlocked",
                  tier: event.tier,
                  expiresAt: event.expiresAt,
                },
          );
          break;
        case "privacy-locked":
          setRuntime((current) =>
            current.lockState === "disabled" ? current : lockAllIn(current),
          );
          kekRef.current = null;
          break;
        case "privacy-item-unlocked":
          setRuntime((current) => unlockItemIn(current, event.itemId));
          break;
        case "privacy-item-locked":
          setRuntime((current) => lockItemIn(current, event.itemId));
          break;
        case "privacy-state-request": {
          // 有标签页在问"现在解锁着吗"：只有确实解锁着才回，避免把锁态广播成解锁
          const current = runtimeRef.current;
          if (current.lockState === "unlocked") {
            publishUnlocked(current.tier, current.expiresAt);
          }
          break;
        }
        default:
          break;
      }
    });

    // 加入时问一次：没人回就说明本次会话还没解锁（与"所有标签页关闭即锁"一致）
    channel.post({ kind: "privacy-state-request" });

    return () => {
      unsubscribe();
      channel.close();
      channelRef.current = null;
    };
  }, [authenticated, publishUnlocked]);

  // —— 材料：先读缓存（离线可用），再拉服务端（rev 变高就清解锁态）——
  const refresh = useCallback(async () => {
    if (!authenticated) return;

    const cached = await cachedMaterials();
    if (cached) {
      // 有缓存就先把门禁装上——**离线时这是唯一的保护**（服务端拉不到也要能锁住）
      setEnabled(true);
      setReady(true);
      setRuntime((current) => {
        if (current.lockState !== "disabled") return current;
        const base = initialRuntime(true, config.tier);
        return readDeviceFlag()
          ? unlockIn(base, "device", Date.now(), config.minutes)
          : base;
      });
    }

    try {
      const state = await cryptoApi.get();
      const result = await cacheCryptoState(state);
      setEnabled(state.enabled);
      setRuntime((current) => {
        if (!state.enabled) {
          kekRef.current = null;
          writeDeviceFlag(false);
          return initialRuntime(false, config.tier);
        }
        if (result.invalidatesUnlock) {
          // 密码在别处改过（或重置过）：旧解锁态一律作废，设备标记也清掉
          kekRef.current = null;
          writeDeviceFlag(false);
          return initialRuntime(true, config.tier);
        }
        if (current.lockState === "disabled") {
          // 刚知道"已启用"：若本设备此前选了长期解锁，就按设备档恢复门禁
          // （只是门禁状态，没有任何密钥落盘）
          const base = initialRuntime(true, config.tier);
          return readDeviceFlag()
            ? unlockIn(base, "device", Date.now(), config.minutes)
            : base;
        }
        return current;
      });
    } catch {
      // 离线：保持缓存状态（有缓存就能解锁）
    } finally {
      setReady(true);
    }
  }, [authenticated, config.tier, config.minutes]);

  useEffect(() => {
    // 走一个微任务再拉：避免在 effect 体内同步 setState（React 会判定为级联渲染），
    // 也让"读缓存 → 拉服务端"这条链与手动 `refresh()` 复用同一份实现。
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  // —— 设备长期档：只放一个设备级标记（不是密钥）；恢复在 refresh 的状态更新里做 ——
  useEffect(() => {
    if (!enabled) return;
    writeDeviceFlag(needsDeviceFlag(runtime));
  }, [enabled, runtime]);

  // —— 档位计时：只有 minutes 档需要；到期只锁范围门禁 ——
  useEffect(() => {
    if (runtime.lockState !== "unlocked" || runtime.expiresAt === null) return undefined;
    const timer = setInterval(() => {
      setRuntime((current) => {
        const next = tick(current, Date.now());
        if (next !== current) {
          kekRef.current = null;
          channelRef.current?.post({ kind: "privacy-locked" });
        }
        return next;
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [runtime.lockState, runtime.expiresAt]);

  // —— 动作 ——

  const unlock = useCallback(
    async (password: string, tier: PrivacyTier): Promise<boolean> => {
      const materials = await cachedMaterials();
      if (!materials) {
        throw new Error("本地没有校验材料，请联网后重试");
      }
      const kek = await deriveKek(
        password,
        cryptoBlobFromBase64Url(materials.kdf_salt),
        materials.kdf_iterations,
      );
      if (!(await verifyPassword(kek, materials.verifier))) return false;

      kekRef.current = kek;
      const now = Date.now();
      const expiresAt = expiryFor(tier, now, config.minutes);
      setRuntime((current) => unlockIn(current, tier, now, config.minutes));
      publishUnlocked(tier, expiresAt);
      return true;
    },
    [config.minutes, publishUnlocked],
  );

  const enable = useCallback(
    async (password: string): Promise<void> => {
      setBusy(true);
      try {
        const salt = randomSalt();
        const kek = await deriveKek(password, salt);
        const verifier = await makeVerifier(kek);
        const contentKey = randomContentKey();
        const wrapped = await wrapContentKey(contentKey, kek);

        const state = await cryptoApi.put({
          materials: {
            kdf: CRYPTO_KDF,
            kdf_iterations: CRYPTO_KDF_ITERATIONS,
            kdf_salt: base64UrlEncode(salt),
            verifier,
            k_wrapped_pw: wrapped,
          },
          // 第二份包裹由服务端用根机密 `AUTH_PEPPER` 派生的键包（浏览器拿不到该机密）
          k: base64UrlEncode(contentKey),
        });

        await cacheCryptoState(state);
        kekRef.current = kek;
        setEnabled(true);
        // 刚输过密码、也刚派生出 KEK：直接开门禁，用户接着就能给内容打标记（M08-01 的流程）
        setRuntime(() => {
          const base = initialRuntime(true, config.tier);
          return unlockIn(base, config.tier, Date.now(), config.minutes);
        });
        publishUnlocked(config.tier, expiryFor(config.tier, Date.now(), config.minutes));
      } finally {
        setBusy(false);
      }
    },
    [config.tier, config.minutes, publishUnlocked],
  );

  /**
   * 改密（M3-9）：旧密码解出 K → 新盐 → 新 KEK/verifier → 用新 KEK 重新包裹 K。
   * `k_wrapped_backup` 原样带回（服务端用它兜底重置），所以这一步**只需要联网**、
   * 不需要浏览器碰实例机密（它拿不到，备份包裹一直是服务端包的）。
   */
  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string): Promise<boolean> => {
      const materials = await cachedMaterials();
      if (!materials) throw new Error("本地没有校验材料，请联网后重试");

      const oldSalt = cryptoBlobFromBase64Url(materials.kdf_salt);
      const oldKek = await deriveKek(oldPassword, oldSalt, materials.kdf_iterations);
      if (!(await verifyPassword(oldKek, materials.verifier))) return false;

      setBusy(true);
      try {
        const contentKey = await unwrapContentKey(materials.k_wrapped_pw, oldKek);
        const salt = randomSalt();
        const kek = await deriveKek(newPassword, salt);
        const state = await cryptoApi.put({
          materials: {
            kdf: CRYPTO_KDF,
            kdf_iterations: CRYPTO_KDF_ITERATIONS,
            kdf_salt: base64UrlEncode(salt),
            verifier: await makeVerifier(kek),
            k_wrapped_pw: await wrapContentKey(contentKey, kek),
            // 备份包裹不重做：它包的是同一把 K，服务端手里那份仍然有效
            k_wrapped_backup: materials.k_wrapped_backup,
          },
        });
        await cacheCryptoState(state);
        kekRef.current = kek;
        setEnabled(true);
        setRuntime(() => {
          const base = initialRuntime(true, config.tier);
          return unlockIn(base, config.tier, Date.now(), config.minutes);
        });
        return true;
      } finally {
        setBusy(false);
      }
    },
    [config.tier, config.minutes],
  );

  /**
   * 重置（忘记密码，M3-9）：服务端解出 K → 新密码重新包裹。
   *
   * 重置**不需要**旧的隐私密码（那正是"忘记"的意思），但需要联网 + 实例配好根机密
   * （`AUTH_PEPPER`；缺它会在服务端明确报错）。
   * 重置后 `k_wrapped_backup` 由服务端用新的一份随机 IV 重新包（K 不变）。
   */
  const resetPassword = useCallback(
    async (newPassword: string): Promise<void> => {
      setBusy(true);
      try {
        const { k } = await cryptoApi.reset();
        const contentKey = cryptoBlobFromBase64Url(k);
        const salt = randomSalt();
        const kek = await deriveKek(newPassword, salt);
        const state = await cryptoApi.put({
          materials: {
            kdf: CRYPTO_KDF,
            kdf_iterations: CRYPTO_KDF_ITERATIONS,
            kdf_salt: base64UrlEncode(salt),
            verifier: await makeVerifier(kek),
            k_wrapped_pw: await wrapContentKey(contentKey, kek),
          },
          // 明文 K 交给服务端，由它用当前根机密派生的键重新包第二份
          k,
        });
        await cacheCryptoState(state);
        kekRef.current = kek;
        setEnabled(true);
        setRuntime(unlockIn(initialRuntime(true, config.tier), config.tier, Date.now(), config.minutes));
      } finally {
        setBusy(false);
      }
    },
    [config.tier, config.minutes],
  );

  /**
   * 重新包裹内容密钥：输入当前隐私密码 → 解出 K → 让服务端用**当前**根机密派生的键重包一次
   * `k_wrapped_backup`。用途与三条口径见 `PrivacyLockState.rewrapContentKey` 的说明。
   *
   * 为什么是"再 PUT 一次、只多带个 `k`"：服务端**只要收到 `k` 就重包**（`services/crypto.ts`
   * 的 `putCryptoMaterials`），与是不是首次启用无关——所以这条路不需要新端点、也不改契约。
   */
  const rewrapContentKey = useCallback(async (password: string): Promise<boolean> => {
    const materials = await cachedMaterials();
    if (!materials) throw new Error("本地没有校验材料，请联网后重试");

    const salt = cryptoBlobFromBase64Url(materials.kdf_salt);
    const kek = await deriveKek(password, salt, materials.kdf_iterations);
    if (!(await verifyPassword(kek, materials.verifier))) return false;

    setBusy(true);
    try {
      const contentKey = await unwrapContentKey(materials.k_wrapped_pw, kek);
      // 材料原样带回（KDF 参数、verifier、密码包裹都不动），只额外带上明文 K
      const state = await cryptoApi.put({
        materials: {
          kdf: materials.kdf,
          kdf_iterations: materials.kdf_iterations,
          kdf_salt: materials.kdf_salt,
          verifier: materials.verifier,
          k_wrapped_pw: materials.k_wrapped_pw,
        },
        k: base64UrlEncode(contentKey),
      });
      await cacheCryptoState(state);
      return true;
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await cryptoApi.remove();
      await clearCachedCrypto();
      kekRef.current = null;
      writeDeviceFlag(false);
      setEnabled(false);
      setRuntime(initialRuntime(false, config.tier));
      channelRef.current?.post({ kind: "privacy-locked" });
    } finally {
      setBusy(false);
    }
  }, [config.tier]);

  const lockAll = useCallback((): void => {
    kekRef.current = null;
    writeDeviceFlag(false);
    setRuntime((current) => lockAllIn(current));
    channelRef.current?.post({ kind: "privacy-locked" });
  }, []);

  const lockScope = useCallback((): void => {
    setRuntime((current) => lockScopeIn(current));
  }, []);

  const unlockItem = useCallback((itemId: string): void => {
    setRuntime((current) => unlockItemIn(current, itemId));
    channelRef.current?.post({ kind: "privacy-item-unlocked", itemId });
  }, []);

  /**
   * 逐篇解密：验密码 → 把这一篇记进 `unlockedItems`。
   *
   * **刻意不碰 `lockState`**：范围门禁与单篇门禁正交（`model.ts` 头注）。这里若顺手把
   * 范围也开了，用户只想看一篇，加密空间与范围内的 Memo 却一并可见——那是另一件事，
   * 该由顶栏胶囊 / 空间节点触发。
   *
   * 也**不写 `kekRef`**：那把 KEK 只在改密 / 重置 / 重包裹时用得到（`enable` 等已持有），
   * 单篇解锁不产生新的密钥生命周期，凭空存一份只会让"锁定即清"的约定变得含糊。
   */
  const decryptItem = useCallback(
    async (itemId: string, password: string): Promise<boolean> => {
      const materials = await cachedMaterials();
      if (!materials) {
        throw new Error("本地没有校验材料，请联网后重试");
      }
      const kek = await deriveKek(
        password,
        cryptoBlobFromBase64Url(materials.kdf_salt),
        materials.kdf_iterations,
      );
      if (!(await verifyPassword(kek, materials.verifier))) return false;

      unlockItem(itemId);
      return true;
    },
    [unlockItem],
  );

  const lockItem = useCallback((itemId: string): void => {
    setRuntime((current) => lockItemIn(current, itemId));
    channelRef.current?.post({ kind: "privacy-item-locked", itemId });
  }, []);

  const lockAllItems = useCallback((): void => {
    setRuntime((current) => {
      const next = lockAllItemsIn(current);
      if (next !== current) {
        channelRef.current?.post({ kind: "privacy-locked" });
      }
      return next;
    });
  }, []);

  const setTier = useCallback(
    (tier: PrivacyTier): void => {
      const now = Date.now();
      setRuntime((current) => changeTierIn(current, tier, now, config.minutes));
      if (tier === "device" && runtime.lockState === "unlocked") {
        publishUnlocked(tier, null);
      }
    },
    [config.minutes, publishUnlocked, runtime.lockState],
  );

  const gate = useMemo(() => gateFrom(runtime, config), [runtime, config]);

  return {
    enabled,
    runtime,
    gate,
    ready,
    busy,
    unlock,
    enable,
    changePassword,
    resetPassword,
    rewrapContentKey,
    disable,
    lockAll,
    lockScope,
    decryptItem,
    unlockItem,
    lockItem,
    lockAllItems,
    setTier,
    refresh,
  };
}
