/**
 * 「被 N 篇用到」的口径（2026-10-11，属性库设计 v2.1 §6.2）。
 *
 * 数的是**本机已有的正文**：`db.bodies`（同步下来的缓存）与 `db.drafts`（打开过、正在编辑的）
 * 各取一份、草稿优先，然后交给纯函数 `collectUsedKeys` 去重计篇数。
 *
 * 为什么不做成"全量精确"：正文只在本机用到时才拉下来，服务端没有"某键出现在哪些正文"的索引；
 * 为了一句计数去逐篇拉全量正文，代价与风险都不成比例。所以**口径直接写在界面上**
 * （"按本机已有正文统计"）——0 不等于"没人用"，加密空间里解不开的正文也不会被数进去。
 */
import { parseMenoteMeta } from "@menote/mdcore";
import { db } from "../../data/db";
import { collectUsedKeys } from "./model";

export interface PropUsage {
  /** 键 → 篇数 */
  counts: ReadonlyMap<string, number>;
  /** 实际扫到的篇数（界面用它说明统计范围；`0` = 本机还没有正文） */
  scanned: number;
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

export async function countPropUsage(): Promise<PropUsage> {
  const [bodies, drafts] = await Promise.all([db.bodies.toArray(), db.drafts.toArray()]);
  const latest = new Map<string, string>();
  for (const row of bodies) latest.set(row.item_id, row.body);
  // 草稿比缓存新：同一个条目两处都有时，以草稿为准
  for (const row of drafts) latest.set(row.item_id, row.body);
  const texts = [...latest.values()];
  const counts = collectUsedKeys(texts);
  /*
    内置键要单独数：`readForeignKeys` 按设计**不返回**它们（它们被顶层白名单取走，
    在卡片里各有自己的行），所以这里用 MeNote 自己的解析再看一遍 md 里到底有没有这些键。
    口径是"这一篇的 md 里有这个键"——没有 `title:` 的新笔记就是没有（2026-10-11 的决定）。
  */
  for (const text of texts) {
    const { meta } = parseMenoteMeta(text);
    if (typeof meta.title === "string" && meta.title !== "") bump(counts, "title");
    if (meta.tags.length > 0) bump(counts, "tags");
    if (meta.task?.status != null) bump(counts, "status");
    if (meta.task?.due != null) bump(counts, "due");
    if (meta.task?.priority != null) bump(counts, "priority");
  }
  return { counts, scanned: latest.size };
}
