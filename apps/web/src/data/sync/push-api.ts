/**
 * 推送的服务端 API 适配层（从 `push.ts` 抽出——v0.8.24 接 `pushedItemIds` 时文件破了
 * 500 行上限，而这一块本来就自成一层：push 逻辑只认 `PushApi` 接口，真实 HTTP 实现在这里）。
 */
import type {
  BatchOp,
  BatchResponse,
  FolderCreate,
  FolderPatch,
  FolderWriteResponse,
  ItemBodyWriteResponse,
  ItemMetaPatch,
  ItemMetaWriteResponse,
  ItemWriteMeta,
  TrashItemResponse,
  UserSettingsPayload,
  UserSettingsWrite,
} from "@menote/shared";
import { foldersApi, itemsApi, settingsApi, trashApi } from "../api/endpoints";

export interface PushApi {
  createItem(id: string, meta: ItemWriteMeta, body: string): Promise<ItemBodyWriteResponse>;
  /**
   * 参数顺序**与 `itemsApi.saveBody` 保持一致**（deviceId 在前、引用集合在后）。
   *
   * 之前两者的顺序不同，于是要靠一层包装来「把 deviceId 插到中间」——那层包装迟早会因为
   * 某个新调用点漏传参数而把引用数组当成 deviceId 发出去。顺序对齐后 `httpPushApi` 直接
   * 引用 `itemsApi.saveBody` 即可，**少一处转接、少一个坑**。
   */
  saveBody(
    id: string,
    baseRev: number,
    contentHash: string,
    body: string,
    deviceId?: string,
    /** 当前稿引用的 sha256 列表（M6 批 2a）；`undefined` = 不带这个头 = 不动引用表 */
    attachmentRefs?: readonly string[],
  ): Promise<ItemBodyWriteResponse>;
  patchMeta(id: string, patch: ItemMetaPatch): Promise<ItemMetaWriteResponse>;
  /** 服务端软删（移入回收站）。目前只由备份恢复的 `trash_item` 出队触发（M5 设计 §4.2） */
  trashItem(id: string): Promise<TrashItemResponse>;
  createFolder(input: FolderCreate): Promise<FolderWriteResponse>;
  patchFolder(id: string, patch: FolderPatch): Promise<FolderWriteResponse>;
  /** 用户设置：整份覆盖（M2-7） */
  putSettings(input: UserSettingsWrite): Promise<UserSettingsPayload>;
  /**
   * 批量写入（M2-9，可选）：把一串条目操作合并成一次请求，省的是客户端到 Worker 的网络往返。
   * 不实现时队列退回逐条调用（假实现与测试用得上）。
   */
  batch?(ops: BatchOp[]): Promise<BatchResponse>;
}

export const httpPushApi: PushApi = {
  createItem: itemsApi.create,
  saveBody: itemsApi.saveBody,
  patchMeta: itemsApi.patchMeta,
  trashItem: trashApi.deleteItem,
  createFolder: foldersApi.create,
  patchFolder: foldersApi.patch,
  putSettings: settingsApi.put,
  batch: itemsApi.batch,
};
