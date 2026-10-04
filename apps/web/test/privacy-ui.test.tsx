// @vitest-environment jsdom
/**
 * 隐私锁的两件界面（M3-9）：顶栏胶囊与解锁框。
 *
 * 这里只验"界面该做的事"：三态文案与颜色、菜单里的动作、输错后逐次加等待、单篇场景不显示档位、
 * 未启用时整个不渲染。判定与状态机本身在 `privacy-model` / `privacy-lock` 用例里覆盖。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserSettings } from "@menote/shared";
import { PrivacyCapsule } from "../src/features/privacy/ui/PrivacyCapsule";
import { UnlockModal } from "../src/features/privacy/ui/UnlockModal";
import {
  AppUnlockModal,
  type AppUnlockModalProps,
} from "../src/app/PrivacySlot";
import type { PrivacyLockState } from "../src/features/privacy/usePrivacyLock";

afterEach(cleanup);

function renderCapsule(overrides: Partial<Parameters<typeof PrivacyCapsule>[0]> = {}) {
  const props = {
    lockState: "locked" as const,
    tier: "minutes" as const,
    expiresAt: null,
    onRequestUnlock: vi.fn(),
    onLockAll: vi.fn(),
    onChangeTier: vi.fn(),
    onLockDevice: vi.fn(),
    ...overrides,
  };
  const { container } = render(<PrivacyCapsule {...props} />);
  return { container, ...props };
}

describe("顶栏隐私胶囊", () => {
  it("未启用隐私锁时整个不渲染（M2 的验收点）", () => {
    const { container } = renderCapsule({ lockState: "disabled" });
    expect(container.innerHTML).toBe("");
  });

  it("锁定态：中性色「已锁定」，点击请求解锁", () => {
    const { onRequestUnlock } = renderCapsule();
    const button = screen.getByRole("button", { name: /已锁定/ });
    expect(button.className).toContain("pill--neutral");
    fireEvent.click(button);
    expect(onRequestUnlock).toHaveBeenCalledTimes(1);
  });

  it("解锁态（N 分钟档）：琥珀色 + 倒计时", () => {
    const { container } = renderCapsule({
      lockState: "unlocked",
      tier: "minutes",
      expiresAt: Date.now() + 272_000,
    });
    expect(container.textContent).toMatch(/已解锁 · 4:3\d/);
    expect((container.querySelector(".pill") as HTMLElement).className).toContain("pill--busy");
  });

  it("解锁态（本次会话档）：显示档位文字，不显示倒计时", () => {
    const { container } = renderCapsule({ lockState: "unlocked", tier: "session" });
    expect(container.textContent).toContain("已解锁 · 本次会话");
  });

  it("解锁态（设备长期档）：危险色提醒，并多一个「锁定此设备」", () => {
    const { container, onLockDevice } = renderCapsule({
      lockState: "unlocked",
      tier: "device",
    });
    expect(container.textContent).toContain("本设备始终解锁");
    expect((container.querySelector(".pill") as HTMLElement).className).toContain("pill--err");

    // 菜单：立即锁定 + 另外两档 + 锁定此设备
    fireEvent.click(screen.getByRole("button", { name: /隐私锁/ }));
    expect(screen.getByRole("menuitem", { name: /立即锁定/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /改为「N 分钟」/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /改为「本次会话」/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /锁定此设备/ }));
    expect(onLockDevice).toHaveBeenCalledTimes(1);
  });

  it("菜单里的「立即锁定」与改档位都回调出去", () => {
    const { onLockAll, onChangeTier } = renderCapsule({
      lockState: "unlocked",
      tier: "session",
    });
    fireEvent.click(screen.getByRole("button", { name: /隐私锁/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /立即锁定/ }));
    expect(onLockAll).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /隐私锁/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /改为「当前设备长期」/ }));
    expect(onChangeTier).toHaveBeenCalledWith("device");
  });
});

function renderModal(overrides: Partial<Parameters<typeof UnlockModal>[0]> = {}) {
  const props = {
    open: true,
    defaultTier: "minutes" as const,
    minutes: 5,
    onClose: vi.fn(),
    onSubmit: vi.fn(async () => true),
    onForgot: vi.fn(),
    ...overrides,
  };
  const { container } = render(<UnlockModal {...props} />);
  return { container, ...props };
}

/** 在密码框里输入并回车（比 userEvent 更省事：这里不需要真实的键入节奏） */
function typePassword(value: string): void {
  fireEvent.change(screen.getByLabelText("隐私密码"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "解锁" }));
}

describe("解锁框", () => {
  it("隐私锁场景：密码框 + 三档 + 忘记密码入口", () => {
    renderModal();
    expect(screen.getByText("解锁隐私锁")).toBeTruthy();
    expect(screen.getByLabelText("隐私密码")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "忘记隐私密码" })).toBeTruthy();
  });

  it("单篇场景：标题不同、且不显示档位块", () => {
    renderModal({ variant: "item" });
    expect(screen.getByText("解锁此篇")).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("密码正确 → 用所选档位提交并关闭", async () => {
    const { onSubmit, onClose } = renderModal();
    fireEvent.click(screen.getByRole("radio", { name: "本次会话" }));
    typePassword("对的密码");

    await screen.findByText("解锁隐私锁");
    expect(onSubmit).toHaveBeenCalledWith("对的密码", "session");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("密码错误 → 报错并清空输入，且逐次加等待（第二次要等 2 秒）", async () => {
    const onSubmit = vi.fn(async () => false);
    renderModal({ onSubmit });

    typePassword("错的密码");
    const first = await screen.findByRole("alert");
    expect(first.textContent).toContain("请等待 1 秒后再试");
    expect((screen.getByLabelText("隐私密码") as HTMLInputElement).value).toBe("");

    // 等待期间不能再提交
    expect((screen.getByRole("button", { name: "解锁" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("没有本地材料时置灰并说明需要联网（不做点了没反应）", () => {
    renderModal({ unavailable: true });
    expect(screen.getByRole("button", { name: "解锁" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/需要联网校验隐私密码/)).toBeTruthy();
  });

  it("忘记隐私密码 → 走回调（去设置 › 隐私锁 重置），不是死链", () => {
    const { onForgot } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "忘记隐私密码" }));
    expect(onForgot).toHaveBeenCalledTimes(1);
  });
});

/**
 * `AppUnlockModal` 的**装配契约**（2026-10-04 修的单篇死接线）。
 *
 * 上面那组用例直接给 `UnlockModal` 喂 `variant="item"`，所以一直是绿的——但它绕过了
 * 真正出问题的那一层：**由谁决定走哪条密码校验路径**。
 *
 * 修复前 `App` 只有一个 `unlockOpen: boolean`，单篇与范围共用同一个出口、都落到
 * `privacy.unlock`（只开范围门禁、不动单篇集合），于是输对密码后这一篇仍解不开。
 * 组件的 `variant="item"` 分支写得很完整（标题对、不显示档位），却从没被传过值。
 *
 * 这组断言两条路径**互不串**：单篇必须调 `decryptItem(itemId, 密码)` 且**不碰** `unlock`；
 * 范围必须调 `unlock` 且**不碰** `decryptItem`。任一侧被改回共用出口，这里就红。
 */
describe("解锁框的装配层：两种变体各走各的校验路径", () => {
  function renderAppUnlockModal(overrides: Partial<AppUnlockModalProps> = {}) {
    const privacy = {
      enabled: true,
      ready: true,
      unlock: vi.fn(async () => true),
      decryptItem: vi.fn(async () => true),
    } as unknown as PrivacyLockState;
    const props: AppUnlockModalProps = {
      open: true,
      privacy,
      settings: { privacy: { tier: "minutes", minutes: 5 } } as UserSettings,
      onClose: vi.fn(),
      onForgot: vi.fn(),
      ...overrides,
    };
    render(<AppUnlockModal {...props} />);
    // 断言用局部 `privacy`（那对 vi.fn 替身所在的对象），不要用 `...props` 里的同名键覆盖它
    return { privacy, props };
  }

  it("单篇变体：调 decryptItem 并带上条目 id，一次都不调 unlock", async () => {
    const { privacy } = renderAppUnlockModal({ variant: "item", itemId: "n-42" });
    typePassword("对的密码");

    await waitFor(() =>
      expect(privacy.decryptItem).toHaveBeenCalledWith("n-42", "对的密码"),
    );
    expect(privacy.unlock).not.toHaveBeenCalled();
    // 界面形态也确实是单篇：标题对、不显示档位
    expect(screen.getByText("解锁此篇")).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("范围变体：调 unlock，一次都不调 decryptItem", async () => {
    const { privacy } = renderAppUnlockModal();
    typePassword("对的密码");

    await waitFor(() => expect(privacy.unlock).toHaveBeenCalledWith("对的密码", "minutes"));
    expect(privacy.decryptItem).not.toHaveBeenCalled();
  });

  it("传了 variant=item 却漏了 itemId：退回范围形态，不去解一个 undefined 条目", () => {
    // 防御：接线漏传 id 时不能拿着 undefined 去解密（那会往已解密集合塞一个假条目）
    const { privacy } = renderAppUnlockModal({ variant: "item" });
    expect(screen.getByText("解锁隐私锁")).toBeTruthy();
    expect(privacy.decryptItem).not.toHaveBeenCalled();
  });
});
