/**
 * 本地数据层入口（架构 §2.3.2：`data/db/` 放 Dexie 模式与本地仓储）。
 *
 * 界面层只从这里读写数据，不直接碰 Dexie（架构 §3.1：界面层不直接访问 Dexie 或网络）。
 */
export * from "./conflicts";
export * from "./database";
export * from "./attachments";
export * from "./bodies";
export * from "./privacy";
export * from "./repository";
export * from "./schema";
export * from "./search";
export * from "./settings";
export * from "./trash";
