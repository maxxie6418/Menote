/**
 * 用户设置（需求 §7.5；功能拆解 M18-01/M18-02/M18-03）。
 *
 * 只有**跟随账号同步**的设置进这里：启动视图、时区、默认编辑模式、账户快捷菜单的配置。
 * 「主题」是**设备级**偏好（同一账号在手机与桌面可以不同），M1 起就存在 `localStorage`，
 * 不进这份契约——设置页里的主题行直接调主题 hook。
 *
 * 并发口径：设置是"整份覆盖"的，**以后写为准**（不做冲突副本——它不是用户内容）。
 */
import * as v from "valibot";
import { VERSIONS_KEEP_MAX, VERSIONS_KEEP_MIN } from "./content";

const IntSchema = v.pipe(v.number(), v.integer());

/** 启动视图（需求 §7.5：首页 / 最近编辑 / 收藏，默认首页） */
export const StartViewSchema = v.picklist(["home", "recent", "starred"]);
export type StartView = v.InferOutput<typeof StartViewSchema>;

/**
 * 编辑模式的**读兼容取值**（M04-03）。四档：双栏 / 仅编辑 / 仅预览 / **即时渲染**。
 *
 * 「即时渲染」于 2026-09-28 落地（wiki 设计文档 §7.1 的既定需求；首期覆盖范围见
 * `docs/modules/Menote-即时渲染-设计-v1.md`）。加这一档**只扩取值、不动字段**：
 * 旧客户端只发前三档仍然合法；前端与 Worker 同一次部署上线，不存在新旧值卡壳。
 *
 * 【2026-09-29 语义调整】设置页不再让用户"四选一当默认档"，改成**开关组选"显示哪几档"**
 * （见 `editor_modes`）；打开笔记时用**哪一档**由本机记住的"上次用的那档"决定，
 * `editor_mode` 退为**首次初始值**（见 `UserSettingsSchema` 里该字段的说明）。
 *
 * 【2026-09-29 三轮扩档 · 编辑拓展阶段 C】用户验收即时渲染后，生产清单回到
 * {@link PRODUCT_EDITOR_MODES} = 仅编辑 / 仅预览 / 即时渲染（顺序即规范顺序）：**双栏仍留在产品外**
 * （四档里只有它没回来）。本 schema 仍收四值——旧行、旧客户端整份 PUT、本机旧记忆都要读得进来，
 * **删值才是兼容事故**（会被 422、或让老用户升级后第一次打开就换档）。所以：**读兼容四档，
 * 写只写产品档**。
 */
export const EditorModeSchema = v.picklist(["split", "edit", "preview", "live"]);
export type EditorMode = v.InferOutput<typeof EditorModeSchema>;

/** 四档的**规范顺序**：契约、设置页开关、正文区切换条都用它，顺序不随设置变 */
export const EDITOR_MODES: readonly EditorMode[] = ["split", "edit", "preview", "live"];

/**
 * **生产允许用户切到的档**——唯一的"产品清单"（阶段 C = 仅编辑 / 仅预览 / 即时渲染）。
 *
 * 只留一份的理由：此前差点变成 `EDITOR_MODES` + `DEFAULT_EDITOR_MODES` + 新的 `PRODUCT_*`
 * 三份清单，改一处漏两处就是漂移。现在 `DEFAULT_EDITOR_MODES` 直接指向它，设置页开关、
 * 正文区切换条、schema 默认值**全部**由它推导。
 *
 * 扩档时**不要**顺手改 `DEFAULT_USER_SETTINGS.editor_mode`：那是"首次初始值"，不是"默认档"
 * （打开笔记用哪一档由本机记住的上次那一档决定，见 `editor-mode.ts`）。这里的扩档只影响
 * "新用户能切到哪几档"。
 *
 * 顺序按 {@link EDITOR_MODES} 的规范顺序写（`edit` → `preview` → `live`），不另立一套：
 * 界面上的先后由规范顺序决定（`normalizeEditorModes()` 也照它排），这里若写成别的次序，
 * 就会出现"清单顺序"和"显示顺序"两份答案。即时渲染因此**排在最后**——它是编辑与预览的
 * 混合态，追加在末尾不打扰已经记住前两档位置的用户。
 */
export const PRODUCT_EDITOR_MODES = ["edit", "preview", "live"] as const;
export type ProductEditorMode = (typeof PRODUCT_EDITOR_MODES)[number];

const PRODUCT_MODE_SET: ReadonlySet<string> = new Set(PRODUCT_EDITOR_MODES);

/** 这个档当前在产品清单里吗？（写"上次用的那一档"前用它收口） */
export function isProductEditorMode(mode: EditorMode): mode is ProductEditorMode {
  return PRODUCT_MODE_SET.has(mode);
}

/**
 * 「显示哪些档」的默认值 = 生产清单。
 *
 * 变的是"默认发哪几档"，不是 schema：`editor_modes` 仍是 optional + 默认值，老行与旧客户端
 * PUT 不带它时补的就是这几档（旧值 `split` 因此**自然退出**生产，不需要迁移；`live` 则回到
 * 默认全开的清单里）。
 */
export const DEFAULT_EDITOR_MODES: readonly ProductEditorMode[] = PRODUCT_EDITOR_MODES;

/**
 * 归一化「显示哪些档」，**一步到位**：用户开着的档 ∩ 产品清单，按 {@link EDITOR_MODES} 的规范顺序
 * 排；**空**则兜成产品清单全集。
 *
 * 两个边界都在这里收口，调用方（`NoteWorkspace` 渲染前、设置页写回前）不需要再写第二套过滤：
 * - 设置是**整份 JSON**，可能被手改、被旧客户端整份覆盖成空 → 空数组的后果是"正文区一个档都切不了、
 *   正文也没了"，兜成产品全集最不伤（宁可多显示，不可没得用）；
 * - 旧值 `split` / `live` 仍在存储里 → 这里静默滤掉，界面拿到的永远是产品档。
 */
export function normalizeEditorModes(value: readonly EditorMode[] | undefined): EditorMode[] {
  const wanted = new Set(value ?? []);
  const kept = EDITOR_MODES.filter((mode) => wanted.has(mode) && PRODUCT_MODE_SET.has(mode));
  return kept.length > 0 ? [...kept] : [...PRODUCT_EDITOR_MODES];
}

/** 账户快捷菜单的可配置功能项（M18-03：第一版 5 个候选） */
export const QuickMenuFeatureSchema = v.picklist(["theme", "lock", "search", "trash", "backup"]);
export type QuickMenuFeature = v.InferOutput<typeof QuickMenuFeatureSchema>;

/** 5 个候选的清单——菜单与设置页**同一份数据驱动**（功能拆解 M18-03 的要求） */
export const QUICK_MENU_FEATURES: ReadonlyArray<{
  id: QuickMenuFeature;
  label: string;
  /** 默认是否开启（M18-03：主题切换与立即锁定默认开，其余默认关，让菜单保持短小） */
  defaultOn: boolean;
  /** 未实现时的说明（`null` = 已可用） */
  pendingStep: string | null;
}> = [
  { id: "theme", label: "主题切换", defaultOn: true, pendingStep: null },
  { id: "lock", label: "立即锁定", defaultOn: true, pendingStep: null },
  { id: "search", label: "搜索", defaultOn: false, pendingStep: null },
  // 2026-09-28：回收站（M4）已交付，接线完成 —— 这里曾写着 "M4"，菜单里也一直禁用
  { id: "trash", label: "回收站", defaultOn: false, pendingStep: null },
  /*
    2026-10-04：这一项的 `pendingStep` 曾写着 "M5"——而 M5 早已收口，它属于**过期标记**。
    但**不能直接改成 `null`**：菜单里这一项从未接线（`AccountQuickMenu` 硬编码 disabled），
    标成"可用"等于给用户一个会失灵的入口。

    按用户 2026-10-04 决定，**它是「入口」而不是「动作」**：点一下去「备份与导出」页，
    推哪个目标由用户在那页自己选。理由是备份目标可以**有多个**（WebDAV / S3 各配一个），
    "立即备份"一键推的话**推哪个**没有答案——真要做成动作得先加"默认目标"概念
    （要动契约与服务端），那是新功能，不是一个标记的事。
  */
  { id: "backup", label: "立即备份", defaultOn: false, pendingStep: null },
];

/** 隐私锁解锁档位（三档；「仅本次查看」已于 2026-09-27 作废，见《隐私锁设计》§4.2） */
export const PrivacyTierSchema = v.picklist(["session", "minutes", "device"]);
export type PrivacyTier = v.InferOutput<typeof PrivacyTierSchema>;

/** 「N 分钟」档的可选值（默认 5，见《隐私锁设计》§4.2） */
export const PrivacyMinutesSchema = v.picklist([1, 5, 15, 30, 60]);
export type PrivacyMinutes = v.InferOutput<typeof PrivacyMinutesSchema>;

/** N 分钟档的候选值清单（界面按钮与契约**同一份数据**，避免两处漂移） */
export const PRIVACY_MINUTES_OPTIONS: ReadonlyArray<PrivacyMinutes> = [1, 5, 15, 30, 60];

/**
 * 隐私锁设置（M3；《隐私锁设计》§7.1）。
 *
 * 注意：**门禁的判定契约不在这里**——运行时 gate 见 `privacy.ts`。这里只是"用户配置的持久形态"。
 */
export const PrivacySettingsSchema = v.object({
  /** 范围成员；加密空间恒在范围内，不落库 */
  scope: v.object({ memo: v.boolean() }),
  tier: PrivacyTierSchema,
  minutes: PrivacyMinutesSchema,
  /** 「解锁时可搜索加密内容」——**只作用于隐私条目的正文命中**（标题不看它） */
  search_bodies_when_unlocked: v.boolean(),
});
export type PrivacySettings = v.InferOutput<typeof PrivacySettingsSchema>;

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  scope: { memo: true },
  tier: "minutes",
  minutes: 5,
  search_bodies_when_unlocked: true,
};

/**
 * 版本与回收站的策略设置（M4；《M4 设计》§4 / §八、【已定】默认值）。
 *
 * 四条都是**可改的设置**而不是常量，因为它们是用户偏好：封存多勤、留多少条、留多久、回收站留几天。
 * 范围由契约在这里收口（`versions_keep` 20–500 等），界面只管显示错误，不自己再定一套数。
 */
export const VersionTrashSettingsSchema = v.object({
  /** 停编辑多少分钟后自动封存一个版本（设计 §4.1 默认 10 分钟） */
  seal_idle_minutes: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1440)),
  /** 每条最多保留多少版本（默认 100，可选 20–500） */
  versions_keep: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(VERSIONS_KEEP_MIN),
    v.maxValue(VERSIONS_KEEP_MAX),
  ),
  /**
   * 最长保留时长（天）。`0` = **不限**（默认）。
   * 用 0 而不是 `null`：整份覆盖的设置里，少一个可空字段就多一类"没传/传 null/传 0"的分支。
   */
  versions_max_age_days: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** 回收站保留天数（默认 30，到期由每日维护永久删除） */
  trash_retention_days: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365)),
});
export type VersionTrashSettings = v.InferOutput<typeof VersionTrashSettingsSchema>;

export const DEFAULT_VERSION_TRASH_SETTINGS: VersionTrashSettings = {
  seal_idle_minutes: 10,
  versions_keep: 100,
  versions_max_age_days: 0,
  trash_retention_days: 30,
};

/**
 * 版本条数的可选范围：**定义在 `content.ts`**（上限常量集中一处），这里转出去给界面与用例。
 *
 * 2026-09-27 修：此前 `content.ts` 有 `VERSIONS_MIN/MAX`（**零消费方**）、这里又有
 * `VERSIONS_KEEP_MIN/MAX`，同一件事两套名字——迟早漂移。现在只留一份。
 */
export { VERSIONS_KEEP_MAX, VERSIONS_KEEP_MIN };

/** 保留密度（设计 §4.3【已定】：定稿规则，M4 只读展示） */
export const VERSION_KEEP_DENSITY_HINT =
  "24 小时内全留 / 1–7 天每 6 小时 / 7–30 天每天 / 30 天–1 年每周 / 1 年以上每月";

/**
 * 待办筛选条的**形态**取值（用户 2026-09-27 拍板：两种都留，让用户在设置里自选）。
 *
 * 定稿（`prototype/menote-framework.html` 07 待办）原话是"两者都保留，将来在「设置」里让用户自选"，
 * 所以它是一条**用户偏好**而不是写死的实现选择——这也是它进这份契约（跟随账号同步）的原因：
 * 换设备后筛选条该长什么样是用户预期的一部分。
 *
 * - `capsules`：基线，胶囊横排（与列表同一个内容上限、同样居中）；
 * - `floating`：收成左侧顶部的紧凑卡片（零高度 sticky 外壳），且只在列表模式出现。
 *
 * 取值清单**只在这里写一份**（`v.picklist` 直接引用它）：契约与设置页选项各写一遍迟早漂移
 * ——本仓此前 `VERSIONS_MIN/MAX` 就吃过这个亏（v0.4.34 合并过一次）。
 */
export const TASK_FILTER_FORMS = ["capsules", "floating"] as const;

export const TaskFilterFormSchema = v.picklist(TASK_FILTER_FORMS);
export type TaskFilterForm = v.InferOutput<typeof TaskFilterFormSchema>;

export const TaskViewSettingsSchema = v.object({
  filter_form: TaskFilterFormSchema,
});
export type TaskViewSettings = v.InferOutput<typeof TaskViewSettingsSchema>;

export const DEFAULT_TASK_VIEW_SETTINGS: TaskViewSettings = {
  filter_form: "capsules",
};

/**
 * Memo 侧栏的模块清单——**唯一真源**：契约的 `v.picklist`（下面的 schema）与渲染层的注册表
 * 都从它推导，加一块模块只在这里加一个 id + 在 `features/memos/sidebar/` 注册一项，
 * 漏写一处会编译不过（与 `QUICK_MENU_FEATURES` / `TASK_FILTER_FORMS` 同一个做法）。
 *
 * 顺序即**默认顺序**：概述 → 热力图 → 随机漫步 → 那年今日 → 日期 → 标签。
 */
export const MEMO_SIDEBAR_MODULES = [
  "stats",
  "heatmap",
  "random",
  "onThisDay",
  "date",
  "tags",
] as const;

export const MemoSidebarModuleIdSchema = v.picklist(MEMO_SIDEBAR_MODULES);
export type MemoSidebarModuleId = v.InferOutput<typeof MemoSidebarModuleIdSchema>;

/**
 * Memo 侧栏的用户自定义（v0.5.10）：**只做隐藏与调位置**，不做用户级增删模块。
 *
 * 两条刻意的设计（用户 2026-09-28 口径：以后要能配置，复杂了就只做隐藏与位置）：
 * 1. `order` 里没出现的模块按 `MEMO_SIDEBAR_MODULES` 的默认顺序补在后面；
 * 2. **`order` / `hidden` 存的是字符串数组，不是 `v.picklist`** —— 这样"旧客户端读到新模块的 id
 *    再保存"不会因为校验不过而把它丢掉（服务端 schema 也不会 422）；不认识/已下线的 id
 *    由**渲染层忽略**。这是"配置能向上兼容"的关键，别改成 picklist。
 */
export const MemoSidebarSettingsSchema = v.object({
  order: v.optional(v.array(v.string())),
  hidden: v.optional(v.array(v.string())),
});
export type MemoSidebarSettings = v.InferOutput<typeof MemoSidebarSettingsSchema>;

export const MemoViewSettingsSchema = v.object({
  sidebar: v.optional(MemoSidebarSettingsSchema, {}),
});
export type MemoViewSettings = v.InferOutput<typeof MemoViewSettingsSchema>;

export const DEFAULT_MEMO_VIEW_SETTINGS: MemoViewSettings = { sidebar: {} };

/**
 * 笔记本视图的偏好（B2 批）：**左侧笔记本树里是否列出条目**（笔记 / 表格）。
 *
 * 默认 **`false`**（用户 2026-09-28 拍板：默认贴原型形态——树里只列文件夹；
 * 想在树里看到"文件"，去设置 › 通用 里打开）。
 * 同样是 **optional + 默认值**：旧客户端 PUT 设置不带该字段不会被 422。
 */
export const NotebookSettingsSchema = v.object({
  show_items: v.optional(v.boolean(), false),
});
export type NotebookSettings = v.InferOutput<typeof NotebookSettingsSchema>;

export const DEFAULT_NOTEBOOK_SETTINGS: NotebookSettings = { show_items: false };

export const UserSettingsSchema = v.object({
  start_view: StartViewSchema,
  timezone: v.string(),
  /**
   * 编辑模式的**首次初始值**（2026-09-29 起不再由设置页直接改）。
   *
   * 打开笔记用哪一档：优先用**本机记住的"上次用的那档"**（设备级偏好，像主题那样），
   * 本机还没记住过才用它；它被用户关掉了（不在 `editor_modes` 里）则落到开着的第一档。
   * **字段保留**：老行里存着用户当年选的档，直接拿掉会让升级后第一次打开悄悄换档（行为倒退）；
   * 旧客户端整份 PUT 仍会原样带上它，不构成兼容问题。
   *
   * 默认值由 `split` 改为 `edit`（编辑拓展阶段 A：双栏退出产品，双栏不再是"新用户的第一屏"）；
   * 2026-09-30 再由 `edit` 改为 **`live`**（用户验收后拍板：即时渲染是设计稿 §一-2 写的"最终默认与
   * 重点打磨的写作形态"，`edit` 只是过渡期的保守选择——它让用户"感受不到这次改了什么"）。
   * 老行里存着的 `split` **不改写**——读侧 `initialEditorMode` 会因为它不在产品清单里而落到
   * 产品第一档（仅编辑），效果一致，但不制造一次性迁移；老行里存着 `edit` 的同样保留
   * （用户当年选过的档优先于新默认值，想换一条 `设置 › 编辑器` 里改，或在切换条上切一次即记忆）。
   */
  editor_mode: EditorModeSchema,
  /**
   * **显示哪几档**（2026-09-29 加）：设置页用开关组改它，正文区的切换条只列这里开着的档；
   * 至少留一档（UI 保证最后一个不许关，见 `apps/web` 的编辑器设置卡）。
   *
   * **optional + 默认值 = 全开**：与加字段之前的行为一致——老行、旧客户端 PUT 不带它时，
   * 四档照旧都在（**不需要迁移**：设置是整份 JSON，读侧由 schema 补默认值）。
   * 顺序由 {@link normalizeEditorModes} 收口，不依赖存储里的顺序。
   */
  editor_modes: v.optional(v.array(EditorModeSchema), () => [...DEFAULT_EDITOR_MODES]),
  /** 选中的功能项；**数组顺序即菜单里的显示顺序** */
  quick_menu: v.array(QuickMenuFeatureSchema),
  /**
   * 隐私锁设置（M3）。
   *
   * **optional + 默认值**：部署窗口内旧客户端（不带该字段）PUT 设置不会被 422——
   * 与 M2 给 `user_settings` 加字段时的处理一致；输出类型里它是必有的（默认值已补齐）。
   */
  privacy: v.optional(PrivacySettingsSchema, DEFAULT_PRIVACY_SETTINGS),
  /**
   * 版本与回收站的策略（M4）。同样是 **optional + 默认值**：
   * 部署窗口内旧客户端 PUT 设置（不带该字段）不会被 422，输出类型里它必有。
   */
  version_trash: v.optional(VersionTrashSettingsSchema, DEFAULT_VERSION_TRASH_SETTINGS),
  /**
   * 待办视图的偏好（v0.5.2）。同样 **optional + 默认值**：旧客户端 PUT 设置不带该字段不会被 422，
   * 服务端读旧 JSON 时由 schema 补默认值（**不需要迁移**：设置是整份 JSON）。
   */
  task_view: v.optional(TaskViewSettingsSchema, DEFAULT_TASK_VIEW_SETTINGS),
  /**
   * Memo 视图的偏好（v0.5.10）：侧栏模块的顺序与隐藏。同样 **optional + 默认值**
   * （旧客户端 PUT 设置不带该字段不会被 422）。语义与可演进纪律见 `MemoSidebarSettingsSchema`。
   */
  memo_view: v.optional(MemoViewSettingsSchema, DEFAULT_MEMO_VIEW_SETTINGS),
  /**
   * 笔记本视图的偏好（B2 批）：左侧树里是否列出条目。同样 **optional + 默认值**
   * （旧客户端 PUT 设置不带该字段不会被 422）；默认 `false`，见 `NotebookSettingsSchema`。
   */
  notebook: v.optional(NotebookSettingsSchema, DEFAULT_NOTEBOOK_SETTINGS),
});
export type UserSettings = v.InferOutput<typeof UserSettingsSchema>;

export const DEFAULT_USER_SETTINGS: UserSettings = {
  start_view: "home",
  timezone: "Asia/Shanghai",
  editor_mode: "live",
  editor_modes: [...DEFAULT_EDITOR_MODES],
  quick_menu: QUICK_MENU_FEATURES.filter((feature) => feature.defaultOn).map(
    (feature) => feature.id,
  ),
  privacy: DEFAULT_PRIVACY_SETTINGS,
  version_trash: DEFAULT_VERSION_TRASH_SETTINGS,
  task_view: DEFAULT_TASK_VIEW_SETTINGS,
  memo_view: DEFAULT_MEMO_VIEW_SETTINGS,
  notebook: DEFAULT_NOTEBOOK_SETTINGS,
};

/** `GET /api/settings` 与同步响应里的设置载荷 */
export const UserSettingsPayloadSchema = v.object({
  settings: UserSettingsSchema,
  rev: IntSchema,
  updated_at: IntSchema,
});
export type UserSettingsPayload = v.InferOutput<typeof UserSettingsPayloadSchema>;

/** `PUT /api/settings`：整份覆盖，`base_rev` 仅用于诊断（后写为准，不拒绝旧基线） */
export const UserSettingsWriteSchema = v.object({
  settings: UserSettingsSchema,
  base_rev: IntSchema,
});
export type UserSettingsWrite = v.InferOutput<typeof UserSettingsWriteSchema>;
