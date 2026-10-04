/**
 * 设置（结构见 `docs/modules/Menote-M1-界面稿-v1.md` §六；DESIGN.md §2.7：左列分类导航与右侧内容各自滚动）。
 *
 * **【v0.8.4】11 类 → 9 类**（决定与影响面见 `docs/modules/Menote-M8-设置页信息架构-v1.md`）：
 * 「编辑器」与「关于」不再是独立分类，内容并进「通用」；原「数据管理」改名「附件」。
 * 理由是粒度严重不均——「编辑器」整页只有 3 个开关，而「隐私锁」有 5 张卡，差 12 倍。
 *
 * M1 起初只放 3 个分类（通用 / 账户与安全 / 实例管理），其余分类在 M2/M6 补内容后再进导航。
 * 「实例管理」仅 owner 可见。
 */
import { useState, type FormEvent, type ReactNode } from "react";
import type { StartView, TaskFilterForm, UserSettings } from "@menote/shared";
import { TASK_FILTER_FORMS } from "@menote/shared";
import { Button, Field } from "../../../app/ui/Controls";
import { InfoHint } from "../../../app/ui/InfoHint";
import type { ThemeMode } from "../../../app/theme/useTheme";
import { SETTINGS_PAGES, type SettingsPageId } from "../../../app/router";
import { CardQuickMenu } from "./CardQuickMenu";
import { AboutCard, EditorModesCard, ScopeTag } from "./GeneralCards";
// 「编辑试验」暂时收起（2026-10-01，与 `router.ts` / `PAGE_META` 同步注释）：
// import { EditorLabPage } from "../../editor-lab/ui/EditorLabPage";
import { BackupPage } from "../../backup/ui/BackupPage";
import { MySharesPage } from "../../shares/ui/MySharesPage";
import { McpSettingsPage } from "../../mcp/ui/McpSettingsPage";
import { AttachmentManagerPage } from "../../attachments/ui/AttachmentManagerPage";
import { InstancePage } from "./InstancePage";

/**
 * 分类的标题与一行简述。
 *
 * `SETTINGS_PAGES` 是唯一真源，这里是**另一半**——漏改任一边会直接编译不过
 * （`Record<SettingsPageId, …>` 的守卫）。
 *
 * **【v0.8.4 调整】9 类**（决定见 `docs/modules/Menote-M8-设置页信息架构-v1.md`）：
 * 原 11 类里「编辑器」与「关于」被撤销、内容并进「通用」；原「数据管理」改名「附件」
 * （**id 仍是 `data`**，只换显示名，老书签与深链照旧能用）。
 * 简述不进页面正文，只进页头那个 ⓘ（DESIGN.md §5.4-1：说明性文字不平铺）。
 */
const PAGE_META: Record<SettingsPageId, { title: string; summary: string }> = {
  general: {
    title: "通用",
    summary: "界面与编辑偏好、启动视图、时区、快捷菜单，以及版本号",
  },
  account: { title: "账户与安全", summary: "登录密码与会话" },
  backup: { title: "备份与导出", summary: "把数据送到外部备份，或从备份恢复" },
  shares: { title: "分享", summary: "管理生效中的分享链接：复制、改密、改期与撤销" },
  mcp: { title: "MCP", summary: "让 AI 工具读写你的内容：地址、令牌与调用记录" },
  // 「编辑试验」暂时收起（2026-10-01）：与 `router.ts` 的 `SETTINGS_PAGES` 同步注释。
  // "editor-lab": {
  //   title: "编辑试验",
  //   summary: "三篇隔离样文，用来看编辑和切换卡不卡。不写入正式笔记",
  // },
  privacy: { title: "隐私锁", summary: "加密空间、门禁与隐私密码" },
  versions: { title: "版本与回收站", summary: "版本封存与保留策略、回收站保留天数" },
  data: { title: "附件", summary: "附件占用、孤儿附件与清理" },
  instance: { title: "实例管理", summary: "本实例的注册开关与分享子域（仅管理员）" },
};

/**
 * 导航顺序即当前生效的 9 类（v0.8.4 起，见 `docs/modules/Menote-M8-设置页信息架构-v1.md`）：
 * 通用 / 账户与安全 / 隐私锁 / 版本与回收站 / 备份与导出 / 分享 / MCP / 附件 / 实例管理。
 * 「实例管理」只对 owner 列出（见下方 `pages` 的过滤）。
 *
 * **清单直接引用路由那一份**：两处各写一份会漂移——M3 加「隐私锁」时只加了
 * 这里、没加路由白名单，点「隐私锁」会落到「通用」。
 */
const NAV_ORDER: readonly SettingsPageId[] = SETTINGS_PAGES;

/**
 * 时区候选（2026-09-28 补全）：**运行时取完整时区表**，不再只给常见几档。
 *
 * `Intl.supportedValuesOf("timeZone")` 是标准 API（Node 18+/各主流浏览器均支持）；
 * 老引擎上取不到时退回"当前值 + 常见几档"，并把当前值放最前——不让设置项因为平台差异变成空的。
 * 控件仍是原生 `<select>`：400+ 项的**可搜索下拉**是另一个组件（见设置页稿 §八-3），本轮不引。
 */
/** 运行时能取到哪些时区；老引擎取不到就返回空数组（由调用方退回常见几档） */
function supportedTimezones(): string[] {
  try {
    return Intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

export function timezoneOptions(current: string): string[] {
  const all = supportedTimezones();
  const fallback = [
    "Asia/Shanghai",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Europe/London",
    "Europe/Berlin",
    "America/New_York",
    "America/Los_Angeles",
    "UTC",
  ];
  const list = [...new Set([current, ...(all.length > 0 ? all : fallback)])];
  return list.sort((a, b) => a.localeCompare(b, "en"));
}

const START_VIEW_OPTIONS: ReadonlyArray<{ id: StartView; label: string }> = [
  { id: "home", label: "首页" },
  { id: "recent", label: "最近编辑" },
  { id: "starred", label: "收藏" },
];

/**
 * 编辑模式的**产品清单文案**已随「编辑体验」卡一并搬进 `GeneralCards.tsx`（v0.8.4）。
 *
 * 这里原本有两份与它同源的清单（`EDITOR_MODE_COPY` / `EDITOR_MODE_OPTIONS`）和
 * `patchEditorModes`；既然那张卡整个搬走，留着它们就成了没人调用的死代码——
 * 而死代码里的"产品档清单"恰恰是最危险的那种：改了一处、另一处悄悄发着旧值。
 */

/**
 * 待办筛选条的两形态（用户 2026-09-27 拍板：两种都留，在设置里自选——定稿原话如此）。
 *
 * **取值顺序来自契约 `TASK_FILTER_FORMS`**，这里只给标签与说明；用 `Record<TaskFilterForm, …>`
 * 收口，所以契约里加一种形态而这里忘了写文案，TypeScript 会直接报错（不是等界面上少一个按钮才发现）。
 */
const TASK_FILTER_FORM_LABELS: Record<TaskFilterForm, { label: string; desc: string }> = {
  capsules: { label: "胶囊横排", desc: "筛选条与待办列表同宽、随内容滚动，默认" },
  floating: { label: "悬浮小组件", desc: "收成左上角常驻的小卡片，不占横排空间" },
};

const THEME_OPTIONS: ReadonlyArray<{ id: ThemeMode; label: string; desc: string }> = [
  { id: "light", label: "浅色", desc: "默认" },
  { id: "dark", label: "深色", desc: "深色下单独核对语义色" },
  { id: "system", label: "跟随系统", desc: "随系统主题变化" },
];

/**
 * 「通用」页里那一长串偏好项的**作用域标记**（v0.8.4）已连同定义搬到 `GeneralCards.tsx`。
 * 本文件只消费不定义——作用域规则一份就够了，两处各写一份必然漂。
 */

export interface SettingsPanelProps {
  page: SettingsPageId;
  onNavigate: (page: SettingsPageId) => void;
  role: "owner" | "member";
  themeMode: ThemeMode;
  onThemeMode: (mode: ThemeMode) => void;
  /** 跟随账号同步的设置（M2-7）；主题不在其中（设备级偏好） */
  userSettings: UserSettings;
  onPatchSettings: (partial: Partial<UserSettings>) => void;
  registrationOpen: boolean;
  /** 注册到期时间戳；`0` = 不自动到期（见 `InstancePage`） */
  registrationCloseAt: number;
  /**
   * 改注册开关。`closeAt = 0` 表示不自动关闭——**清空日期必须显式传 0**：
   * 省略字段服务端会当成"不更新"，清不掉原来的到期时间。
   */
  onChangeRegistration: (open: boolean, closeAt: number) => Promise<void>;
  onChangePassword: (current: string, next: string) => Promise<void>;
  onLogout: () => void;
  /**
   * 「隐私锁」分类的内容（M3-9）。**由 `App` 组装后按插槽传入**：
   * 设置页负责分类与版式，隐私锁的状态机与动作在 feature 层（`features/privacy`），
   * 设置 feature 不认识它——这样两边都不越界。M2 时这里是一个置灰占位。
   */
  privacyPage?: ReactNode;
  /**
   * 「版本与回收站」分类的内容（M4-11）。与 `privacyPage` 同一套做法：
   * 设置页负责分类与版式，策略设置与回收站的数据在 features 里，两边互不认识。
   */
  versionsPage?: ReactNode;
  /**
   * 返回笔记区（设置是独立页，需要有出口）。
   *
   * 缺口背景：设置页此前**只有"退出登录"能离开**——功能栏的视图切换只改笔记视图状态、
   * 搜索框的结果被 `route === "settings"` 分支挡住。现在这里给可见出口，
   * `App` 另外让"去笔记区干活"的动作（切视图 / 搜 / 新建 / 发布）一律先把路由拉回笔记。
   */
  onBackToNotes?: () => void;
}

export function SettingsPanel({
  page,
  onNavigate,
  role,
  themeMode,
  onThemeMode,
  userSettings,
  onPatchSettings,
  registrationOpen,
  registrationCloseAt,
  onChangeRegistration,
  onChangePassword,
  onLogout,
  privacyPage,
  versionsPage,
  onBackToNotes,
}: SettingsPanelProps) {
  const pages = NAV_ORDER.filter((candidate) => candidate !== "instance" || role === "owner");
  const meta = PAGE_META[page];

  return (
    <div className="settings">
      <nav className="settings__nav" aria-label="设置分类">
        <div className="nav">
          {pages.map((candidate) => (
            <button
              key={candidate}
              type="button"
              /*
                分类导航用**语义化的 `.set-nav-item`**（`components.md` §7.5 登记过），
                不再借用功能栏那套 `.nav-item`——两者是同一种"可点行"但归属不同屏，
                共用一个类名会让改功能栏的样式时误伤设置页（2026-09-28）。
              */
              className="set-nav-item"
              data-set={candidate}
              aria-current={candidate === page}
              onClick={() => onNavigate(candidate)}
            >
              {PAGE_META[candidate].title}
              {/*
                owner 专属分类带徽标（功能拆解 M18-01）。徽标**对读屏隐藏**：
                这个分类本来就只对 owner 渲染，徽标是重复信息；留着它会把可访问名污染成
                「实例管理owner」（用例与读屏都会受影响）。
              */}
              {candidate === "instance" ? (
                <span className="badge" aria-hidden="true">
                  owner
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      <div className="settings__body">
        {/*
          页头收成一条（2026-09-28 设置页重构 B 批）：标题（`h1` + `--fs-title`/650，与其它屏的
          页头同级）· 说明（**进 ⓘ**，不平铺）· 出口在右端。
          此前这里是 `h2` + 一个平铺的 `p`，与首页 `.pane-head h1`、待办 `.tkhead` 三套写法。

          **【v0.8.4】删掉原先这里的「共 N 个分类」计数**：那个数字对用户零信息量（左列一眼看得见），
          还会**随角色变化**（owner 10 / member 9），容易被误读成"漏了分类"。
          DESIGN.md §5.4-2 要求保持可见的是**有含义的状态计数**——回收站条目数（`VersionsTrashPage`）、
          令牌数、附件占用、推送进度，那些全部保留。
        */}
        <header className="settings__head">
          <h1 className="settings__title">{meta.title}</h1>
          <InfoHint label={`${meta.title}分类说明`}>{meta.summary}</InfoHint>
          {/*
            出口（2026-09-27 修复）：设置是**主操作区独立页**，此前除了"退出登录"没有别的路回笔记区——
            功能栏的视图切换只改笔记视图状态、搜索框的结果也被 `route === "settings"` 的分支挡住，
            于是"进了设置就出不去"。这里补一个与回收站页「← 返回设置」对称的次操作。
          */}
          {onBackToNotes ? (
            <Button variant="secondary" size="sm" onClick={onBackToNotes}>
              ← 返回笔记
            </Button>
          ) : null}
        </header>

        {page === "general" ? (
          <>
            <section className="setcard" aria-label="界面偏好">
              <h3 className="setcard__title">
                界面偏好
                {/*
                  作用域标记（v0.8.4）：这一卡里两类作用域混着，标记让"改完为什么另一台没变"
                  不用去猜 ⓘ。`本机` = 只这台设备，`跟随账号` = 换设备登录也带过去。
                */}
                <InfoHint label="作用域说明">
                  每项后面的标记说明它跟谁走：「本机」只影响这台设备；「跟随账号」会跟着账号同步到其它设备。
                  主题是设备级偏好，其余都是账号级。
                </InfoHint>
              </h3>
              <div className="setrow">
                <div className="setrow__label">
                  <span className="setrow__name">
                    主题
                    <ScopeTag scope="device" />
                  </span>
                  {/* 实现口径（不改 DOM、不整页重渲染）收进 InfoHint（DESIGN.md §5.4-1） */}
                  <InfoHint label="主题说明">
                    切换只改 `data-theme` 属性与令牌，不重建页面；主题是**设备级**偏好，不跟随账号同步。
                  </InfoHint>
                </div>
                <div className="radioset" role="group" aria-label="主题">
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="radioset__item"
                      aria-pressed={themeMode === option.id}
                      title={option.desc}
                      onClick={() => onThemeMode(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="setrow">
                <div className="setrow__label">
                  <span className="setrow__name">
                    启动视图
                    <ScopeTag scope="account" />
                  </span>
                  <span className="setrow__desc">打开应用时先进哪个视图</span>
                </div>
                <div className="radioset" role="group" aria-label="启动视图">
                  {START_VIEW_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="radioset__item"
                      aria-pressed={userSettings.start_view === option.id}
                      onClick={() => onPatchSettings({ start_view: option.id })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="setrow">
                <div className="setrow__label">
                  <span className="setrow__name">
                    时区
                    <ScopeTag scope="account" />
                  </span>
                  <span className="setrow__desc">Memo 时间轴与待办日期按它分天</span>
                </div>
                {/*
                  版式统一到 `.setrow__control`（与版本页那些行内输入一致）。
                  **控件本身保持原生 `<select>`**：完整时区表 400+ 项做成单选组会把这一页撑爆，
                  可搜索下拉是另一个组件（设置页稿 §八-3），本轮不引——这是稿里"全部改 radioset"
                  那一条的**唯一例外**，按用户口径以本条为准。
                */}
                <div className="setrow__control">
                  <select
                    className="field__input"
                    aria-label="时区"
                    value={userSettings.timezone}
                    onChange={(event) => onPatchSettings({ timezone: event.target.value })}
                  >
                    {timezoneOptions(userSettings.timezone).map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 待办筛选条的形态（v0.5.2；定稿：两种都留，让用户自选） */}
              <div className="setrow">
                <div className="setrow__label">
                  <span className="setrow__name">
                    待办筛选条
                    <ScopeTag scope="account" />
                  </span>
                  <span className="setrow__desc">待办页顶部那排筛选怎么摆</span>
                </div>
                <div className="radioset" role="group" aria-label="待办筛选条形态">
                  {TASK_FILTER_FORMS.map((form) => (
                    <button
                      key={form}
                      type="button"
                      className="radioset__item"
                      aria-pressed={userSettings.task_view.filter_form === form}
                      title={TASK_FILTER_FORM_LABELS[form].desc}
                      onClick={() => onPatchSettings({ task_view: { filter_form: form } })}
                    >
                      {TASK_FILTER_FORM_LABELS[form].label}
                    </button>
                  ))}
                </div>
              </div>

              {/*
                笔记本树的两档展示（用户 2026-10-01 确认）：完整文件树 / 分级文件树。
                持久化仍沿用 `notebook.show_items` 布尔：true = 完整，false = 分级（默认）。
              */}
              <div className="setrow">
                <div className="setrow__label">
                  <span className="setrow__name">
                    笔记本树结构
                    <ScopeTag scope="account" />
                  </span>
                  <span className="setrow__desc">选择左侧树是否把文档列在文件夹下</span>
                </div>
                <span className="setrow__control">
                  <InfoHint label="笔记本树结构说明">
                    「完整文件树」列出两级文件夹和文档；「分级文件树」只列两级文件夹，文档在中间列表查看。
                    完整模式每个文件夹最多列 50 条，超出给「还有 N 条…」。加密空间那一支**永远不列文档**。
                  </InfoHint>
                  <div className="radioset" aria-label="笔记本树结构">
                    <button
                      type="button"
                      className="radioset__item"
                      aria-pressed={userSettings.notebook.show_items}
                      onClick={() => onPatchSettings({ notebook: { show_items: true } })}
                    >
                      完整文件树
                    </button>
                    <button
                      type="button"
                      className="radioset__item"
                      aria-pressed={!userSettings.notebook.show_items}
                      onClick={() => onPatchSettings({ notebook: { show_items: false } })}
                    >
                      分级文件树
                    </button>
                  </div>
                </span>
              </div>
            </section>

            {/*
              「编辑体验」（v0.8.4 由原「编辑器」分类搬来，见 `docs/modules/Menote-M8-设置页信息架构-v1.md` §2.1）。
              内容抽到 `GeneralCards.tsx`：原「编辑器」整页只有 3 个开关却独占一个一级分类，
              而「隐私锁」有 5 张卡——粒度差 12 倍。搬运时控件与不变式一条没变。
            */}
            <EditorModesCard userSettings={userSettings} onPatchSettings={onPatchSettings} />

            <CardQuickMenu
              selected={userSettings.quick_menu}
              onChange={(quickMenu) => onPatchSettings({ quick_menu: quickMenu })}
            />

            {/*
              「关于」（v0.8.4 由原独立分类搬来，放在最底部）。位置是有讲究的：
              版本号与仓库地址是**低频查阅**内容（通常只在报 bug 时要看），
              放页头 ⓘ 会让"我是哪个版本"不可见，而版本号在反馈问题时有实际用途；
              放最后则匹配它的频次——要主动往下滚才看得到。
            */}
            <AboutCard />
          </>
        ) : null}

        {/* 「编辑试验」暂时收起（2026-10-01，与 `router.ts` / `PAGE_META` 同步注释）：
            试验区按桌面稿排布，窄面板里会挤成一条。恢复时把这一行与 import 一起放回即可。 */}
        {/* {page === "editor-lab" ? <EditorLabPage /> : null} */}

        {page === "backup" ? <BackupPage /> : null}

        {page === "shares" ? <MySharesPage /> : null}

        {page === "mcp" ? <McpSettingsPage /> : null}

        {page === "data" ? <AttachmentManagerPage /> : null}

        {page === "privacy" ? (
          privacyPage ?? (
            <section className="setcard" aria-label="隐私锁">
              <h3 className="setcard__title">隐私锁</h3>
              <div className="setrow">
                <div className="setrow__label">
                  <span className="setrow__name">加密空间</span>
                  <span className="setrow__desc">隐私锁的状态与设置暂不可用。</span>
                </div>
              </div>
            </section>
          )
        ) : null}

        {page === "versions" ? (
          versionsPage ?? (
            <section className="setcard" aria-label="版本与回收站">
              <h3 className="setcard__title">版本与回收站</h3>
              <p className="hint-line">这一分类的内容尚未接入。</p>
            </section>
          )
        ) : null}

        {page === "account" ? (
          <>
            <AccountPage onChangePassword={onChangePassword} onLogout={onLogout} />
            <section className="setcard" aria-label="登录设备与会话">
              <h3 className="setcard__title">登录设备与会话</h3>
              <div className="setrow">
                <div className="setrow__label">
                  <span className="setrow__name">已登录设备</span>
                  {/*
                    **"还没有这个功能"保持可见**（右侧），背景收进 ⓘ。
                    【v0.8.4】文案由"将在后续里程碑提供"改为"尚未提供"：它原先指向的 M6
                    已于 v0.7.0 收口且没做这件事，继续写"后续里程碑"会让人以为已经排期、只是没到。
                  */}
                  <InfoHint label="登录设备说明">
                    设备列表与"踢出其他设备"目前尚未提供。在那之前，改登录密码会让其他设备的
                    会话立即失效——这是当前唯一能远程断开别的设备的办法。
                  </InfoHint>
                </div>
                <span className="setrow__desc">尚未提供</span>
              </div>
            </section>
          </>
        ) : null}

        {page === "instance" ? (
          /* 内容抽到 `InstancePage.tsx`：一是这里接近行数预算，二是"注册开关 + 到期"自成一块 */
          <InstancePage
            key={`${registrationOpen}-${registrationCloseAt}`}
            registrationOpen={registrationOpen}
            registrationCloseAt={registrationCloseAt}
            onChangeRegistration={onChangeRegistration}
          />
        ) : null}
      </div>
    </div>
  );
}

function AccountPage({
  onChangePassword,
  onLogout,
}: {
  onChangePassword: (current: string, next: string) => Promise<void>;
  onLogout: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const mismatch = repeat !== "" && repeat !== next;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (next !== repeat) {
      setError("两次输入的新密码不一致");
      return;
    }

    setError(null);
    setDone(false);
    setBusy(true);
    try {
      await onChangePassword(current, next);
      setDone(true);
      setCurrent("");
      setNext("");
      setRepeat("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "修改失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="setcard" aria-label="账户与安全">
      <h3 className="setcard__title">修改登录密码</h3>
      <form className="authcard__form" onSubmit={submit} noValidate>
        <Field
          label="当前登录密码"
          type="password"
          value={current}
          autoComplete="current-password"
          onChange={(event) => setCurrent(event.target.value)}
        />
        <Field
          label="新登录密码"
          type="password"
          value={next}
          autoComplete="new-password"
          onChange={(event) => setNext(event.target.value)}
        />
        <Field
          label="再输一次新密码"
          type="password"
          value={repeat}
          autoComplete="new-password"
          error={mismatch ? "两次输入的新密码不一致" : undefined}
          onChange={(event) => setRepeat(event.target.value)}
        />

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        {done ? <p className="authcard__hint">登录密码已修改；其他设备的登录已失效。</p> : null}

        <Button
          variant="primary"
          type="submit"
          disabled={busy || current === "" || next === "" || mismatch}
        >
          {busy ? "提交中…" : "修改登录密码"}
        </Button>
      </form>

      {/* 间距走 `.setrow` 自身的内边距与上边框，不再给子元素加内联 `margin`（DESIGN.md §4.3 / #14） */}
      <div className="setrow">
        <div className="setrow__label">
          <span className="setrow__name">退出登录</span>
          <span className="setrow__desc">只清除本机会话；本机缓存的笔记不会被删除</span>
        </div>
        <Button variant="danger" size="sm" onClick={onLogout}>
          退出登录
        </Button>
      </div>
    </section>
  );
}
