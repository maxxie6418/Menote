/**
 * 「空白种子」在工作区的两个接线点（判据与回收都在 `data/db/seed`，这里只管"什么时候去问一次"）。
 *
 * 用户 2026-10-11 口径：新建之后没写任何可见文字、也没写过标题，就不该保存——所以空白种子
 * **根本不入队**（服务端从没见过它），留给本地回收：
 * 1. `loadFirstScreen()`：启动先扫一遍，清掉上次"建完直接关标签页"残留的那一篇；
 * 2. `reapBlankSeedOnLeave()`：选中项被换掉的那一刻回收上一篇。
 *
 * 为什么单独一个模块：`useNotesWorkspace.ts` 已经贴着 500 行预算（架构 §2.3.1），
 * 而这两件事都值得带注释讲清楚，放进去会把预算顶破。
 */
import {
  listLocalBodyIds,
  listLocalItems,
  purgeBlankSeed,
  purgeBlankSeeds,
  type LocalItem,
} from "../../data/db";

/** 首屏列表 + "本地有正文"的键集合（先扫一遍空白种子，免得列表里先闪一条幽灵条目） */
export async function loadFirstScreen(): Promise<[LocalItem[], Set<string>]> {
  await purgeBlankSeeds();
  const [rows, bodyIds] = await Promise.all([listLocalItems(), listLocalBodyIds()]);
  return [rows, bodyIds];
}

/**
 * 离开这一篇时回收：只有它确实是"空白种子"才会真删（判据在回收里，见 `data/db/seed`）。
 * `changed()` 只在真删掉的那一刻叫一次——调用方据此刷新列表（否则列表里会留一条打不开的幽灵行）。
 */
export function reapBlankSeedOnLeave(
  previousId: string | null,
  currentId: string | null,
  changed: () => void,
): void {
  if (previousId === null || previousId === currentId) return;
  void purgeBlankSeed(previousId).then((purged) => {
    if (purged) changed();
  });
}
