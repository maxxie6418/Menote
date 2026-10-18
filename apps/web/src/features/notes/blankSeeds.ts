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
 *
 * `changed` 允许返回 Promise（`() => refresh()`）：**回收方负责等它、也负责兜住它的失败**。
 * 调用方若写成 `() => void refresh()`，那条刷新就成了一条没人接的浮动 Promise——
 * 它多半会晚于"库被关掉"发生（切档 / 卸载 / 测试收尾），于是炸成一条未处理拒绝。
 */
export function reapBlankSeedOnLeave(
  previousId: string | null,
  currentId: string | null,
  changed: () => void | Promise<void>,
): void {
  if (previousId === null || previousId === currentId) return;
  void purgeBlankSeed(previousId)
    .then(async (purged) => {
      if (purged) await changed();
    })
    /*
      这是"尽力而为"的收尾动作，**不许把拒绝漏到全局**：库被关掉（退出登录、隐私锁切档、
      测试收尾）或页面正要卸载时，这条查询会变成孤儿，`DatabaseClosedError` 会以
      "unhandled rejection" 的形式炸到窗口上（CI 里直接把整轮测试判失败）。
      这里既没有补救手段、也不该打断正在进行的切档——真漏掉了，下一次启动的
      `purgeBlankSeeds` 兜底扫一遍；刷新失败也只是列表暂时旧一帧。
    */
    .catch((error: unknown) => {
      console.warn("[blank-seed] 回收空白种子失败，留给启动兜底", error);
    });
}
