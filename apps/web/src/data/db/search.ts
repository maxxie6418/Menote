/**
 * 本地搜索索引与检索（架构 §2.3.2 的 `data/db/`；M2-6 建，M3-5 改）。
 *
 * **离线优先**：索引与检索全在本地（IndexedDB），默认不发网络请求。服务端兜底只在"索引还没建完"
 * 时由界面层调用，见 `isSearchIndexComplete()`。
 *
 * **增量**：以条目的 `sync_seq` 为版本号——同步后只重建版本变了的条目；已删除的条目连索引行一起清掉。
 *
 * **M3-5 的两处口径改动**（《隐私锁设计》§3.5、§5.1）：
 * 1. **隐私条目照常进索引**（`sync_seq` 不变的就不重建）：这样才能做到"解锁后立刻搜到"，
 *    不必在每次锁定/解锁切换时重建整张索引；
 * 2. 过滤放在**查询时**：`searchLocal(query, filters, gate)` 用共享的 `searchFields()` 判定
 *    这一条此刻能不能按标题 / 按正文命中。锁定时空间内条目**连标题都不命中**；
 *    单篇加密条目的**标题任何状态都可搜**、正文只在该篇已解密后可搜。
 */
import { searchFields, type PrivacyGate, type PrivacyItemFlags } from "@menote/shared";
import {
  buildBodyText,
  buildTitleText,
  searchRows,
  tokenize,
  type SearchHit,
  type SearchableRow,
} from "../../features/search/model";
import { db } from "./database";
import { getCachedBody, getDraft } from "./bodies";
import type { LocalItem, SearchIndexRow } from "./schema";

/** 判定只需要这几个字段：结构化取出来，避免把整个 LocalItem 传进共享包 */
function flagsOf(item: LocalItem): PrivacyItemFlags {
  return {
    id: item.id,
    type: item.type,
    enc_self: item.enc_self,
    in_enc_space: item.in_enc_space,
    deleted_at: item.deleted_at,
  };
}

/** 建索引覆盖哪些条目：**全部未删除的**（含隐私条目） */
export function isIndexable(item: LocalItem): boolean {
  return item.deleted_at === null;
}

export interface SearchFilters {
  /** 条目类型；`all` = 不限 */
  type?: "note" | "table" | "memo" | "all";
  /** 文件夹；`all` = 不限，`null` = 根目录 */
  folderId?: string | null | "all";
  /** 标签（精确匹配，不带 `#`）；`null` = 不限 */
  tag?: string | null;
  /** 修改时间范围（毫秒，含端点）；`null` = 不限 */
  from?: number | null;
  to?: number | null;
}

export const EMPTY_SEARCH_FILTERS: SearchFilters = { type: "all", folderId: "all", tag: null };

/** 重建索引（增量）。返回本次新建/更新与删除的行数，便于测试与诊断 */
export async function refreshSearchIndex(): Promise<{ indexed: number; removed: number }> {
  const items = await db.items.toArray();
  const existing = new Map((await db.searchIndex.toArray()).map((row) => [row.item_id, row]));

  const indexable = items.filter(isIndexable);
  const keep = new Set<string>();
  const upserts: SearchIndexRow[] = [];
  const now = Date.now();

  for (const item of indexable) {
    keep.add(item.id);
    const cached = existing.get(item.id);
    // 版本没变就跳过——这是"按 sync_seq 增量"的落点（隐私条目也一样，不因为锁定状态重建）
    if (cached && cached.sync_seq === item.sync_seq) continue;

    const draft = await getDraft(item.id);
    const body = draft?.body ?? (await getCachedBody(item.id))?.body ?? "";
    const titleText = buildTitleText({ title: item.title, tags: item.tags });
    const bodyText = buildBodyText(body);
    upserts.push({
      item_id: item.id,
      sync_seq: item.sync_seq,
      title_text: titleText,
      title_haystack: titleText.toLowerCase(),
      title_tokens: tokenize(titleText).join(" "),
      body_text: bodyText,
      body_haystack: bodyText.toLowerCase(),
      body_tokens: tokenize(bodyText).join(" "),
      updated_at: item.updated_at,
      indexed_at: now,
    });
  }

  const stale = [...existing.keys()].filter((id) => !keep.has(id));
  if (stale.length > 0) await db.searchIndex.bulkDelete(stale);
  if (upserts.length > 0) await db.searchIndex.bulkPut(upserts);

  return { indexed: upserts.length, removed: stale.length };
}

/** 索引是否已覆盖全部未删除条目（没建完时界面层回退服务端并提示） */
export async function isSearchIndexComplete(): Promise<boolean> {
  const items = await db.items.toArray();
  const indexable = items.filter(isIndexable);
  if (indexable.length === 0) return true;

  const rows = new Map((await db.searchIndex.toArray()).map((row) => [row.item_id, row]));
  return indexable.every((item) => rows.get(item.id)?.sync_seq === item.sync_seq);
}

/**
 * 本地检索：先按门禁决定"这一条此刻能按哪些字段命中"，再在索引里检索。
 *
 * 结果按 `item_id` 去重：同一条同时命中标题与正文时**保留正文那条**
 * （片段更有信息量，且正文命中意味着用户已经能看到内容）。
 */
export async function searchLocal(
  query: string,
  filters: SearchFilters = EMPTY_SEARCH_FILTERS,
  gate: PrivacyGate,
): Promise<Array<{ item: LocalItem; snippet: SearchHit["snippet"]; score: number; field: "title" | "body" }>> {
  const indexRows = await db.searchIndex.toArray();
  if (indexRows.length === 0) return [];

  const items = await db.items.bulkGet(indexRows.map((row) => row.item_id));
  const byId = new Map(
    items.filter(Boolean).map((item) => [(item as LocalItem).id, item as LocalItem]),
  );

  // 按门禁把索引行摊成"可检索的字段行"：不允许的字段根本不参与检索
  const rows: SearchableRow[] = [];
  for (const row of indexRows) {
    const item = byId.get(row.item_id);
    if (!item || !isIndexable(item)) continue;
    const fields = searchFields(flagsOf(item), gate);
    if (fields.title) {
      rows.push({
        item_id: row.item_id,
        field: "title",
        text: row.title_text,
        haystack: row.title_haystack,
        tokens: row.title_tokens,
        updated_at: row.updated_at,
      });
    }
    if (fields.body) {
      rows.push({
        item_id: row.item_id,
        field: "body",
        text: row.body_text,
        haystack: row.body_haystack,
        tokens: row.body_tokens,
        updated_at: row.updated_at,
      });
    }
  }

  const hits = searchRows(query, rows);
  if (hits.length === 0) return [];

  // 同一条去重：正文优先（分数更高时天然在前，这里显式保证）
  const best = new Map<string, SearchHit>();
  for (const hit of hits) {
    const current = best.get(hit.itemId);
    if (!current || (current.field === "title" && hit.field === "body")) {
      best.set(hit.itemId, hit);
    }
  }

  const out: Array<{
    item: LocalItem;
    snippet: SearchHit["snippet"];
    score: number;
    field: "title" | "body";
  }> = [];
  for (const hit of best.values()) {
    const item = byId.get(hit.itemId);
    if (!item) continue;

    if (filters.type && filters.type !== "all" && item.type !== filters.type) continue;
    if (filters.folderId !== undefined && filters.folderId !== "all") {
      if ((item.folder_id ?? null) !== filters.folderId) continue;
    }
    if (filters.tag && !item.tags.includes(filters.tag)) continue;
    if (filters.from !== undefined && filters.from !== null && item.updated_at < filters.from) continue;
    if (filters.to !== undefined && filters.to !== null && item.updated_at > filters.to) continue;

    out.push({ item, snippet: hit.snippet, score: hit.score, field: hit.field });
  }

  return out.sort((a, b) => b.score - a.score || b.item.updated_at - a.item.updated_at);
}

/** 清空索引（`full_resync` 或本地数据重置后用） */
export async function clearSearchIndex(): Promise<void> {
  await db.searchIndex.clear();
}
