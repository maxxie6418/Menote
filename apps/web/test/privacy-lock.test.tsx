// @vitest-environment jsdom
import "fake-indexeddb/auto";
/**
 * 隐私锁组装层（M3-4）的用例。
 *
 * 这里**不 mock 网络**：hook 拉服务端材料会失败（jsdom 里没有后端），于是正好验证
 * 最重要的那条路径——**有本地缓存时离线也能解锁**；服务端那一侧的行为在 worker 用例里测。
 */
import { renderHook, waitFor, act, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CRYPTO_KDF,
  DEFAULT_PRIVACY_SETTINGS,
  base64UrlEncode,
  type CryptoState,
} from "@menote/shared";
import { usePrivacyLock } from "../src/features/privacy/usePrivacyLock";
import { useUserSettings } from "../src/features/settings/useUserSettings";
import {
  deriveKek,
  makeVerifier,
  randomContentKey,
  randomSalt,
  wrapContentKey,
} from "../src/features/privacy/crypto";
import { db } from "../src/data/db";
import { cacheCryptoState, readCachedCrypto } from "../src/data/db/privacy";

const PASSWORD = "隐私密码-测试用";
const ITERATIONS = 1_000; // 用例里不用 600k，参数从材料读，代码路径一致

/** 造一份本地缓存材料；把明文 K 一并交出来，便于断言"重新包裹确实把它交给了服务端" */
async function seedCache(): Promise<{ state: CryptoState; contentKey: Uint8Array<ArrayBuffer> }> {
  const salt = randomSalt();
  const kek = await deriveKek(PASSWORD, salt, ITERATIONS);
  const contentKey = randomContentKey();
  const state: CryptoState = {
    enabled: true,
    materials: {
      kdf: CRYPTO_KDF,
      kdf_iterations: ITERATIONS,
      kdf_salt: base64UrlEncode(salt),
      verifier: await makeVerifier(kek),
      k_wrapped_pw: await wrapContentKey(contentKey, kek),
      k_wrapped_backup: base64UrlEncode(new Uint8Array(61).fill(7)),
    },
    rev: 1,
    updated_at: 1,
  };
  await cacheCryptoState(state, 1);
  return { state, contentKey };
}

/**
 * 服务端响应的形状要过共享 schema（迭代数下限 10 万，用例里的 1000 过不了），
 * blob 沿用种子那份；`rev` 与本地缓存相同 → 不会覆盖缓存（本组只关心"请求带了什么"）。
 */
function serverStateOf(state: CryptoState): CryptoState {
  return {
    enabled: true,
    materials: { ...state.materials!, kdf_iterations: 100_000 },
    rev: state.rev,
    updated_at: state.updated_at,
  };
}

function mount() {
  return renderHook(() =>
    usePrivacyLock({ authenticated: true, config: DEFAULT_PRIVACY_SETTINGS }),
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  window.localStorage.clear();
});

afterEach(() => {
  /*
    **必须 cleanup**（2026-10-04 补）：本文件的 hook 之间靠 `BroadcastChannel` 联动，而挂载时
    每个 hook 都会发一次 `privacy-state-request`（`usePrivacyLock.ts:219`）——只要**还有**旧
    hook 活着且处于已解锁态，它就会回应"已解锁"，把新挂载的用例直接变成 `unlocked`。
    本项目的 vitest 没开 globals，RTL 的自动清理不生效，于是上一条用例解锁过就会污染下一条
    （症状：单跑绿、连着跑红，且红的位置飘忽）。
  */
  cleanup();
  // 本文件只有"重新包裹"这一组顶替网络，别把替身留给别的用例（它们靠"连不上服务端"验离线路径）
  vi.unstubAllGlobals();
});

describe("材料与初始状态", () => {
  it("没有缓存、也连不上服务端：保持未启用，但 ready 会置位", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.enabled).toBe(false);
    expect(result.current.runtime.lockState).toBe("disabled");
    // 未启用 = 无门禁：判定一律放行
    expect(result.current.gate.lockState).toBe("disabled");
  });

  it("有缓存（离线）：认得「已启用」，并保持锁定态", async () => {
    await seedCache();
    const { result } = mount();

    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(result.current.runtime.lockState).toBe("locked");
    expect(result.current.runtime.unlockedItems.size).toBe(0);
  });
});

describe("解锁（离线靠本地 verifier）", () => {
  it("密码正确则开门禁；错误则不开", async () => {
    await seedCache();
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));

    let wrong = true;
    await act(async () => {
      wrong = await result.current.unlock("不是这个密码", "minutes");
    });
    expect(wrong).toBe(false);
    expect(result.current.runtime.lockState).toBe("locked");

    let ok = false;
    await act(async () => {
      ok = await result.current.unlock(PASSWORD, "minutes");
    });
    expect(ok).toBe(true);
    expect(result.current.runtime.lockState).toBe("unlocked");
    expect(result.current.runtime.expiresAt).not.toBeNull();
  });

  it("没有本地材料时给出可操作的错误（提示联网）", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));

    await expect(
      act(async () => {
        await result.current.unlock(PASSWORD, "minutes");
      }),
    ).rejects.toThrow(/联网/);
  });

  it("锁全部会清掉单篇已解密集合；锁单篇只影响那一篇", async () => {
    await seedCache();
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    await act(async () => {
      await result.current.unlock(PASSWORD, "session");
    });

    act(() => {
      result.current.unlockItem("e1");
      result.current.unlockItem("e2");
    });
    expect(result.current.runtime.unlockedItems.size).toBe(2);

    act(() => {
      result.current.lockItem("e1");
    });
    expect([...result.current.runtime.unlockedItems]).toEqual(["e2"]);
    // 范围门禁没被动
    expect(result.current.runtime.lockState).toBe("unlocked");

    act(() => {
      result.current.lockAll();
    });
    expect(result.current.runtime.lockState).toBe("locked");
    expect(result.current.runtime.unlockedItems.size).toBe(0);
  });
});

describe("设备长期档", () => {
  it("选设备档会写设备标记；锁全部则清掉，且缓存仍在（下次仍能离线解锁）", async () => {
    await seedCache();
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => {
      await result.current.unlock(PASSWORD, "device");
    });
    await waitFor(() =>
      expect(window.localStorage.getItem("menote:privacy:device-unlocked")).toBe("1"),
    );

    act(() => {
      result.current.lockAll();
    });
    expect(window.localStorage.getItem("menote:privacy:device-unlocked")).toBeNull();
    // 材料缓存不因锁定而删（离线解锁要用）
    expect(await readCachedCrypto()).toBeDefined();
  });
});

/**
 * **组合回归**（2026-09-27 线上整站白屏）：库里的设置行缺 `privacy` 时，整棵应用会被卸载。
 *
 * 这里按真实装配走一遍：`useUserSettings` 读盘 → 把 `settings.privacy` 交给 `usePrivacyLock`。
 * 修复前这条链路会在 `usePrivacyLock` 的渲染期抛 TypeError（读 `config.tier`），
 * 于是 `#root` 被清空——只有 CSS 底色、没有任何内容。
 */
describe("旧设置行的组合回归", () => {
  it("行里缺 privacy 时，加载器补齐后隐私锁照常装配", async () => {
    await db.settings.put({
      key: "user",
      json: {
        start_view: "home",
        timezone: "Asia/Shanghai",
        editor_mode: "split",
        quick_menu: ["theme", "lock"],
      } as never,
      rev: 7,
      updated_at: 7,
      pending: null,
    });

    function Harness() {
      const settings = useUserSettings();
      const lock = usePrivacyLock({ authenticated: false, config: settings.settings.privacy });
      // 必须等 `loaded`：读盘是异步的，崩溃发生在"读到旧行之后的那次渲染"，
      // 断言早于它就会变成假通过（本轮实测踩过）。
      return <span data-testid="gate">{settings.loaded ? lock.gate.lockState : "loading"}</span>;
    }

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("gate").textContent).toBe("disabled"));
    // 走到这里说明"读到旧行 → 重新渲染"这一跳没有把整棵树带走
    expect(screen.getByTestId("gate")).toBeTruthy();
  });

  it("消费端兜底：即便拿到的配置是 undefined，hook 也按默认值装起来（不崩）", async () => {
    function Harness() {
      // 故意绕过类型：模拟"某个上游没补齐"的极端情况
      const lock = usePrivacyLock({ authenticated: false, config: undefined });
      return <span data-testid="tier">{lock.runtime.tier}</span>;
    }

    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId("tier").textContent).toBe(DEFAULT_PRIVACY_SETTINGS.tier),
    );
  });
});

/**
 * **逐篇解密 `decryptItem`**（2026-10-04 补的真 bug 修复出口）。
 *
 * 修复前：单篇占位上的「解锁此篇」走的是 `unlock`，只开**范围**门禁；
 * 于是输对密码后 `unlockedItems` 仍是空集、`bodyLocked` 依旧为 true，
 * 占位面板纹丝不动——按钮看着能点，实际什么也没解开。
 *
 * 这组用例刻意**不测组件、只测状态**：断言的是"密码对了这一篇真的进集合、
 * 且范围门禁**没被顺带打开**"（两道门禁正交，`model.ts` 头注、设计 §2.2）。
 */
describe("逐篇解密（只解这一篇，不动范围门禁）", () => {
  it("密码正确：这一篇进 unlockedItems，范围门禁保持原样（仍是 locked）", async () => {
    await seedCache();
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    // 先把前置状态钉死：下面断言"不动"才有意义（若这里不是 locked，测试应当显式失败）
    expect(result.current.runtime.lockState).toBe("locked");

    let ok = false;
    await act(async () => {
      ok = await result.current.decryptItem("e1", PASSWORD);
    });
    expect(ok).toBe(true);
    // 关键断言：这一篇真的被记住了（修复前这里是空集）
    expect([...result.current.runtime.unlockedItems]).toEqual(["e1"]);
    // 关键断言：**范围门禁没有被顺带打开**——只想看一篇不等于解锁整个加密空间
    expect(result.current.runtime.lockState).toBe("locked");
  });

  it("范围已解锁时逐篇解密：两道门各行其是，互不干扰", async () => {
    await seedCache();
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    await act(async () => {
      await result.current.unlock(PASSWORD, "session");
    });
    expect(result.current.runtime.lockState).toBe("unlocked");

    await act(async () => {
      await result.current.decryptItem("e1", PASSWORD);
    });
    expect([...result.current.runtime.unlockedItems]).toEqual(["e1"]);
    expect(result.current.runtime.lockState).toBe("unlocked");
  });

  it("密码错误：不进集合，范围门禁也不动", async () => {
    await seedCache();
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));

    let ok = true;
    await act(async () => {
      ok = await result.current.decryptItem("e1", "不是这个密码");
    });
    expect(ok).toBe(false);
    expect(result.current.runtime.unlockedItems.size).toBe(0);
    expect(result.current.runtime.lockState).toBe("locked");
  });

  it("没有本地材料时给出可操作的错误（提示联网），与 unlock 同一约定", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));

    await expect(
      act(async () => {
        await result.current.decryptItem("e1", PASSWORD);
      }),
    ).rejects.toThrow(/联网/);
  });

  it("逐篇解密后可单独锁上这一篇，范围门禁不受影响", async () => {
    await seedCache();
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    await act(async () => {
      await result.current.unlock(PASSWORD, "session");
      await result.current.decryptItem("e1", PASSWORD);
    });

    act(() => {
      result.current.lockItem("e1");
    });
    expect(result.current.runtime.unlockedItems.size).toBe(0);
    expect(result.current.runtime.lockState).toBe("unlocked");
  });
});

/**
 * 「重新包裹内容密钥」（2026-09-28 补的运维修复入口）在**组装层**的契约。
 *
 * 界面那侧只验到"点了按钮就把当前密码交给组装层"（`privacy-settings.test.tsx`）；
 * 这里再走一步，验组装层**真的把明文 `k` 交给了服务端**——那是修复生效的唯一条件。
 * 网络用替身顶住（本文件其余用例刻意不 mock，靠"连不上服务端"验离线路径）。
 */
describe("重新包裹内容密钥（组装层 → 服务端必须收到明文 k）", () => {
  it("当前密码正确：解出 K 并随 PUT 提交，材料其余部分原样带回", async () => {
    const { state, contentKey } = await seedCache();
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(JSON.stringify(serverStateOf(state)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));

    let ok = false;
    await act(async () => {
      ok = await result.current.rewrapContentKey(PASSWORD);
    });
    expect(ok).toBe(true);

    const put = calls.find((call) => call.method === "PUT");
    expect(put, "重新包裹应当发一次 PUT /api/crypto").toBeTruthy();
    const body = JSON.parse(put?.body ?? "{}") as {
      materials: Record<string, unknown>;
      k?: string;
    };
    // 明文 K 必须带上——服务端据此重包备份包裹
    expect(body.k).toBe(base64UrlEncode(contentKey));
    // 这个动作不改密码：校验块与密码包裹原样带回
    expect(body.materials.verifier).toBe(state.materials?.verifier);
    expect(body.materials.k_wrapped_pw).toBe(state.materials?.k_wrapped_pw);
    // 旧备份包裹**不带**：由服务端用当前根机密重包（带回去可能把坏包裹又写回来）
    expect(body.materials.k_wrapped_backup).toBeUndefined();
  });

  it("当前密码不对：返回 false，一个写请求都不发", async () => {
    const { state } = await seedCache();
    const methods: string[] = [];
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return new Response(JSON.stringify(serverStateOf(state)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));

    let ok = true;
    await act(async () => {
      ok = await result.current.rewrapContentKey("不是这个密码");
    });
    expect(ok).toBe(false);
    expect(methods).not.toContain("PUT");
  });
});
