/**
 * 正文区两侧面板（属性 / 大纲）的**本机**偏好：展开态与「最后动过哪一侧」。
 *
 * ## 为什么记在**本机**而不是跟着账号
 *
 * 照抄 `editor-mode.ts` 的两条理由，它们在这里同样成立：
 * 1. 它是**设备级偏好**——桌面上开着属性面板方便，手机上先收起来可能更舒服，同主题那一类；
 * 2. 展开/收起是高频动作，每次切换都上行会给同步添噪声。
 *
 * ## 旧 key 的反向迁移（2026-10-11）
 *
 * 属性栏原来只有「折叠态」一个记号（`props-collapsed`，`1` = 折着），而且折叠控件长在卡片自己
 * 的卡头上。现在折叠由**侧面轨道**负责（卡头那个折叠控件去掉，一个面板不该有两个收起按钮），
 * 记号的语义顺势翻成「展开态」（`props-open`）。
 *
 * 读不到新 key、却读到旧 key 时**就地反向迁移一次**（`1` → 收起、其余 → 展开）并删掉旧 key：
 * 老用户上次特意收起来的那一侧，不该在升级后自己弹开。
 *
 * ## 兜底
 *
 * 读不出来的（没记过、手改过、隐私模式无 localStorage）一律**静默回落成"展开"**：
 * 面板是正文区的工具，默认展开才看得见；读不到就当成没折过，绝不因为一个坏值把属性藏起来。
 */
export const PROPS_OPEN_KEY = "menote:notes:props-open";
export const OUTLINE_OPEN_KEY = "menote:notes:outline-open";
export const RAILS_LAST_KEY = "menote:notes:rails-last";
/** 旧记号（`1` = 折着），只读一次做迁移，之后就是死 key */
export const PROPS_COLLAPSED_KEY = "menote:notes:props-collapsed";

/** 哪一侧的面板 */
export type RailSide = "props" | "outline";

export interface RailsIntent {
  propsOpen: boolean;
  outlineOpen: boolean;
  /**
   * 最后动过的那一侧。**只被用户操作改**：宽度不够、必须收掉一侧时留它
   * （见 `useRails.ts` 的让位规则）。
   */
  last: RailSide;
}

function readStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // 隐私模式 / 无 localStorage
    return null;
  }
}

function readFlag(key: string, fallback: boolean): boolean {
  const ls = readStorage();
  if (!ls) return fallback;
  try {
    const raw = ls.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

/** 属性面板是否展开（含旧 key 的一次性反向迁移） */
function readPropsOpen(): boolean {
  const ls = readStorage();
  if (!ls) return true;
  try {
    const current = ls.getItem(PROPS_OPEN_KEY);
    if (current === "1") return true;
    if (current === "0") return false;

    const legacy = ls.getItem(PROPS_COLLAPSED_KEY);
    if (legacy !== null) {
      const open = legacy !== "1";
      ls.setItem(PROPS_OPEN_KEY, open ? "1" : "0");
      ls.removeItem(PROPS_COLLAPSED_KEY);
      return open;
    }
    return true;
  } catch {
    return true;
  }
}

/** 读出两侧面板的展开态与「最后动过哪一侧」；读不到一律按展开 + 左侧 */
export function readRailsIntent(): RailsIntent {
  const ls = readStorage();
  let last: RailSide = "props";
  try {
    if (ls?.getItem(RAILS_LAST_KEY) === "outline") last = "outline";
  } catch {
    // 同上：坏值当没记过
  }
  return {
    propsOpen: readPropsOpen(),
    outlineOpen: readFlag(OUTLINE_OPEN_KEY, true),
    last,
  };
}

/** 记下两侧面板的状态；写不进去也不影响这一次的展开/收起 */
export function writeRailsIntent(next: RailsIntent): void {
  const ls = readStorage();
  if (!ls) return;
  try {
    ls.setItem(PROPS_OPEN_KEY, next.propsOpen ? "1" : "0");
    ls.setItem(OUTLINE_OPEN_KEY, next.outlineOpen ? "1" : "0");
    ls.setItem(RAILS_LAST_KEY, next.last);
  } catch {
    // 退化成"这次没记住"，不报错、不打断编辑
  }
}
