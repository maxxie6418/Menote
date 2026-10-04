/**
 * 属性栏「折叠 / 展开」的本机记忆（用户 2026-10-04 要求「属性栏可整体折叠和展开」）。
 *
 * ## 为什么记在**本机**而不是跟着账号
 *
 * 照抄 `editor-mode.ts` 的两条理由，它们在这里同样成立：
 * 1. 它是**设备级偏好**——桌面上折叠属性栏省地方，手机上未必想折，同主题那一类；
 * 2. 展开/折叠是高频动作，每次切换都上行会给同步添噪声。
 *
 * ## 兜底
 *
 * 读不出来的（没记过、手改过、隐私模式无 localStorage）一律**静默回落成"展开"**：
 * 属性栏是正文上方那条带，默认展开才看得见它；折叠是用户主动收起的动作。
 * 读不到就当成没折过，绝不因为一个坏值把属性藏起来。
 */
export const PROPS_COLLAPSED_KEY = "menote:notes:props-collapsed";

/** 读出「上次是不是折着的」；没记过 / 记的值不认识 → `false`（展开） */
export function readPropsCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(PROPS_COLLAPSED_KEY) === "1";
  } catch {
    // 隐私模式 / 无 localStorage：当作"没折过"
    return false;
  }
}

/** 记下「这次是折着还是展开着」；写不进去也不影响折叠本身 */
export function writePropsCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) globalThis.localStorage?.setItem(PROPS_COLLAPSED_KEY, "1");
    else globalThis.localStorage?.removeItem(PROPS_COLLAPSED_KEY);
  } catch {
    // 同上：退化成"这次没记住"，不报错、不打断编辑
  }
}
