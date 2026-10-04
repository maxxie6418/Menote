// @vitest-environment jsdom
/**
 * 设置页「实例管理」（仅 owner）：注册开关 + **到期自动关闭**（`功能拆解` M19-02）。
 *
 * 从这里单独起文件（2026-09-28）：`ui.test.tsx` 已经贴着 500 行预算，而"注册开关 + 到期日期"
 * 自成一块（含日期 → 时间戳的换算约定）。
 *
 * 换算约定见 `features/settings/deadline.ts`：**填的日期按当天结束**（次日零点前一直有效），
 * **清空 = 显式传 `0`**（省略字段服务端会当成"不更新 close_at"，清不掉原来的到期时间）。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_SETTINGS } from "@menote/shared";
import { SettingsPanel } from "../src/features/settings/ui/SettingsPanel";

afterEach(cleanup);

const OCT_1_END = new Date(2026, 9, 1, 23, 59, 59, 999).getTime();

/** 带签名的替身：`vi.fn(async () => …)` 会把入参推成 `[]`，断言 `calls.at(-1)?.[1]` 就取不到 */
function registrationSpy() {
  return vi.fn<(open: boolean, closeAt: number) => Promise<void>>(async () => undefined);
}

function baseProps(overrides: Partial<Parameters<typeof SettingsPanel>[0]> = {}) {
  return {
    page: "instance" as const,
    onNavigate: vi.fn(),
    role: "owner" as const,
    themeMode: "light" as const,
    onThemeMode: vi.fn(),
    userSettings: DEFAULT_USER_SETTINGS,
    onPatchSettings: vi.fn(),
    registrationOpen: true,
    registrationCloseAt: 0,
    onChangeRegistration: registrationSpy(),
    onChangePassword: vi.fn(async () => undefined),
    onLogout: vi.fn(),
    ...overrides,
  };
}

describe("实例管理：注册开关与到期自动关闭", () => {
  it("member 看不到实例管理这个分类", () => {
    render(<SettingsPanel {...baseProps({ role: "member", page: "general" })} />);
    expect(screen.queryByRole("button", { name: "实例管理" })).toBeNull();
  });

  it("关掉注册开关：把当前到期值一起提交（不清掉别人设过的到期时间）", async () => {
    const user = userEvent.setup();
    const onChangeRegistration = registrationSpy();
    render(
      <SettingsPanel
        {...baseProps({ registrationCloseAt: OCT_1_END, onChangeRegistration })}
      />,
    );

    const toggle = screen.getByRole("switch", { name: "允许新用户注册" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await user.click(toggle);
    expect(onChangeRegistration).toHaveBeenCalledWith(false, OCT_1_END);
  });

  it("填日期：换算成**当天结束**的时间戳；没设过时不出现「不限」", async () => {
    const user = userEvent.setup();
    const onChangeRegistration = registrationSpy();
    render(<SettingsPanel {...baseProps({ onChangeRegistration })} />);

    const date = screen.getByLabelText("注册到期日") as HTMLInputElement;
    expect(date.value).toBe("");
    expect(screen.queryByRole("button", { name: "不限" })).toBeNull();

    await user.type(date, "2026-10-01");
    expect(onChangeRegistration.mock.calls.at(-1)?.[1]).toBe(OCT_1_END);
  });

  it("已有到期时间：日期框回显，「不限」把它显式清成 0", async () => {
    const user = userEvent.setup();
    const onChangeRegistration = registrationSpy();
    render(
      <SettingsPanel
        {...baseProps({ registrationCloseAt: OCT_1_END, onChangeRegistration })}
      />,
    );

    expect((screen.getByLabelText("注册到期日") as HTMLInputElement).value).toBe("2026-10-01");
    await user.click(screen.getByRole("button", { name: "不限" }));
    expect(onChangeRegistration).toHaveBeenCalledWith(true, 0);
  });

  it("注册开关关着时，到期日期框禁用，且**可见地**写着要先打开开关（不靠悬停）", () => {
    render(<SettingsPanel {...baseProps({ registrationOpen: false })} />);

    const date = screen.getByLabelText("注册到期日") as HTMLInputElement;
    expect(date.disabled).toBe(true);
    // 原因必须看得见（DESIGN.md §6.1 / §145：禁用不能只靠 `title` 悬停）
    expect(date.getAttribute("title")).toBeNull();
    expect(screen.getByText("先打开注册开关，才能设到期时间")).toBeTruthy();
  });

  it("未实现的项保持**可见**的标记（不能只靠悬停），且不再指向已过去的里程碑（v0.8.4）", () => {
    render(<SettingsPanel {...baseProps()} />);
    // 【v0.8.4】由「M6」改为「尚未提供」：M6 已于 v0.7.0 收口且没做这件事，
    // 继续挂着那个编号等于宣称"已排期、只是没到"。占位行本身保留——
    // 让用户知道这个能力被考虑过，比悄悄消失好。
    expect(screen.getByText("尚未提供")).toBeTruthy();
    expect(screen.queryByText("M6")).toBeNull();
    // 背景收进 ⓘ（用途/口径类说明不平铺）
    expect(screen.getByRole("button", { name: "成员账户管理说明" })).toBeTruthy();
  });
});
