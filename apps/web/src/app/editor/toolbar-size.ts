/**
 * 编辑器顶部格式工具栏的**大小**（本机偏好，2026-10-19，设置 › 编辑设置，设计 §5）。
 *
 * ## 为什么记在**本机**而不是跟着账号
 *
 * 用户的原话是「有的分辨率下太小了」——这是**设备与屏幕**的问题，不是审美偏好：
 * 同一账号在 4K 显示器上要「大」、在笔记本上要「中」，跟着账号同步反而会让两台机器互相打架。
 * 同 `editor-mode.ts`（上次用的那一档）与 `props-collapse.ts`（两侧面板展开态）一类。
 *
 * ## 兜底
 *
 * 读不出（没记过、手改过、隐私模式无 localStorage）一律静默回落「中」：工具栏大一号小一号
 * 都不影响使用，绝不因为一个坏值把工具栏藏起来或报错。
 */
export const TOOLBAR_SIZE_KEY = "menote:editor:toolbar-size";

export const TOOLBAR_SIZES = ["sm", "md", "lg"] as const;
export type ToolbarSize = (typeof TOOLBAR_SIZES)[number];

export const DEFAULT_TOOLBAR_SIZE: ToolbarSize = "sm";

/**
 * 每档的图标尺寸（px）。**图标尺寸只能是 prop**（图标的 `width` / `height` 由组件写出），
 * 所以它没法像内边距那样交给 CSS——两处都得改：这里给图标，`app.css` 给盒子。
 *
 * 取值落在公共 `IconButton` 已有的三档（13 / 16 / 20）里，**不为了这个功能扩公共组件的类型**。
 * 缺省档就是现状（13px 图标 + 24px 盒子），所以"没配过"的用户看到的工具栏与 v0.8.39 逐像素相同；
 * 「小」是**当前的样子**而不是"变小了"——用户报的是"有的分辨率下太小"，所以只有往上调的方向有意义。
 */
/** 公共 `IconButton` 现有的三档图标尺寸（不为了这个功能扩它的类型） */
export type ToolbarIconSize = 13 | 16 | 20;

export const TOOLBAR_ICON_SIZE: Record<ToolbarSize, ToolbarIconSize> = { sm: 13, md: 16, lg: 20 };

export function isToolbarSize(value: unknown): value is ToolbarSize {
  return typeof value === "string" && (TOOLBAR_SIZES as readonly string[]).includes(value);
}

function readStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // 隐私模式 / 无 localStorage
    return null;
  }
}

export function readToolbarSize(): ToolbarSize {
  const ls = readStorage();
  if (!ls) return DEFAULT_TOOLBAR_SIZE;
  try {
    const raw = ls.getItem(TOOLBAR_SIZE_KEY);
    return isToolbarSize(raw) ? raw : DEFAULT_TOOLBAR_SIZE;
  } catch {
    return DEFAULT_TOOLBAR_SIZE;
  }
}

/** 记下工具栏大小；写不进去也不影响这一次的生效 */
export function writeToolbarSize(next: ToolbarSize): void {
  const ls = readStorage();
  if (!ls) return;
  try {
    ls.setItem(TOOLBAR_SIZE_KEY, next);
  } catch {
    // 退化成"这次没记住"，不报错、不打断编辑
  }
}
