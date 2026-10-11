/**
 * 图标（DESIGN.md §5.5）：
 * - 一律走 **SVG symbol sprite**，不在组件里内联 path、不引外部图标库、不用字体图标；
 * - 三档尺寸：常规 16、小 13、大 20，与文字并排时对齐光学中线；
 * - 描边规格统一 `.ic`（1.6px、无填充、`currentColor`）；
 * - 图标**不可作为唯一表意手段**：调用处必须配文字或 `aria-label`。
 *
 * sprite 挂载一次（`<IconSprite />` 放在应用根部）。
 */

export type IconName =
  | "plus"
  | "search"
  | "chevron-down"
  | "chevron-right"
  | "settings"
  | "logout"
  | "info"
  | "cloud-ok"
  | "cloud-off"
  | "alert"
  | "note"
  | "home"
  | "clock"
  | "check-square"
  | "refresh"
  | "star"
  | "folder"
  | "tag"
  | "lock"
  | "table"
  | "more"
  | "close"
  /* Memo 屏（B3 批）用到的四个 */
  | "list"
  | "grid"
  | "image"
  | "bolt"
  /* 笔记本 `+` 菜单的「导入笔记」（2026-10-02 补：原型没有这一项，故无原型对应） */
  | "import"
  /* 待办页的「列表 / 看板」切换（2026-09-29 补：此前只有文字，原型 `#i-kanban` 那个字形没有） */
  | "kanban"
  /* 正文格式工具栏（编辑器专项优化 P1，蓝本：inkstone 工具栏的按钮分组） */
  | "bold"
  | "italic"
  | "strikethrough"
  | "code"
  | "code-block"
  | "heading"
  | "list-ul"
  | "list-ol"
  | "quote"
  | "link";

export function IconSprite() {
  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: "absolute" }}>
      <symbol id="i-plus" viewBox="0 0 16 16">
        <path d="M8 3.2v9.6M3.2 8h9.6" />
      </symbol>
      <symbol id="i-search" viewBox="0 0 16 16">
        <circle cx="7" cy="7" r="4.2" />
        <path d="M10.2 10.2 13.5 13.5" />
      </symbol>
      <symbol id="i-chevron-down" viewBox="0 0 16 16">
        <path d="M4 6.5 8 10.5l4-4" />
      </symbol>
      {/*
        「更多」（三点）：照用户原型 `#i-more`（三个实心圆点）。
        实心元素要显式 `fill="currentColor" stroke="none"`——`.ic` 的基础规则是"无填充 + 描边"。
      */}
      <symbol id="i-more" viewBox="0 0 16 16">
        <circle cx="4" cy="8" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="12" cy="8" r="1.4" fill="currentColor" stroke="none" />
      </symbol>
      <symbol id="i-settings" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="2.2" />
        <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1" />
      </symbol>
      <symbol id="i-logout" viewBox="0 0 16 16">
        <path d="M9.5 3H4.2A1.2 1.2 0 0 0 3 4.2v7.6A1.2 1.2 0 0 0 4.2 13h5.3" />
        <path d="M10 5.5 12.5 8 10 10.5M12.5 8H6.5" />
      </symbol>
      <symbol id="i-info" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 7.2v4M8 4.8v.6" />
      </symbol>
      <symbol id="i-cloud-ok" viewBox="0 0 16 16">
        <path d="M4.6 11.5h6.9a2.4 2.4 0 0 0 .3-4.8A3.4 3.4 0 0 0 5 6.2a2.7 2.7 0 0 0-.4 5.3Z" />
        <path d="M6.4 8.9 7.6 10l2-2.2" />
      </symbol>
      <symbol id="i-cloud-off" viewBox="0 0 16 16">
        <path d="M4.6 11.5h6.9a2.4 2.4 0 0 0 .3-4.8A3.4 3.4 0 0 0 5 6.2a2.7 2.7 0 0 0-.4 5.3Z" />
        <path d="M3 3l10 10" />
      </symbol>
      <symbol id="i-alert" viewBox="0 0 16 16">
        <path d="M8 2.6 14 13H2L8 2.6Z" />
        <path d="M8 6.6v3.1M8 11.5v.4" />
      </symbol>
      <symbol id="i-note" viewBox="0 0 16 16">
        <path d="M3.6 2.5h6.2l2.6 2.6v8.4H3.6z" />
        <path d="M9.6 2.6v2.6h2.6M5.6 8.4h4.8M5.6 10.8h3.4" />
      </symbol>
      <symbol id="i-chevron-right" viewBox="0 0 16 16">
        <path d="M6 3.5 10.5 8 6 12.5" />
      </symbol>
      <symbol id="i-home" viewBox="0 0 16 16">
        <path d="M2.8 7.2 8 2.8l5.2 4.4v5.6a1 1 0 0 1-1 1H3.8a1 1 0 0 1-1-1z" />
        <path d="M6.4 13.6V9.4h3.2v4.2" />
      </symbol>
      <symbol id="i-clock" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="5.6" />
        <path d="M8 4.8V8l2.2 1.6" />
      </symbol>
      <symbol id="i-check-square" viewBox="0 0 16 16">
        <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2" />
        <path d="M5.6 8.2 7.4 10l3-3.6" />
      </symbol>
      <symbol id="i-refresh" viewBox="0 0 16 16">
        <path d="M13 8a5 5 0 1 1-1.6-3.7" />
        <path d="M13.2 2.6v3.2h-3.2" />
      </symbol>
      <symbol id="i-star" viewBox="0 0 16 16">
        <path d="M8 2.6l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.3l-3.4 1.8.7-3.8L2.5 6.6l3.8-.5z" />
      </symbol>
      <symbol id="i-folder" viewBox="0 0 16 16">
        <path d="M2.6 4.4a1 1 0 0 1 1-1h2.6l1.4 1.6h4.8a1 1 0 0 1 1 1v5.6a1 1 0 0 1-1 1H3.6a1 1 0 0 1-1-1z" />
      </symbol>
      <symbol id="i-tag" viewBox="0 0 16 16">
        <path d="M8.4 2.6H13v4.6l-5.6 5.6-4.6-4.6z" />
        <path d="M10.6 5.4v.4" />
      </symbol>
      <symbol id="i-lock" viewBox="0 0 16 16">
        <rect x="3.6" y="7" width="8.8" height="6.4" rx="1.4" />
        <path d="M5.8 7V5.4a2.2 2.2 0 0 1 4.4 0V7" />
      </symbol>
      <symbol id="i-table" viewBox="0 0 16 16">
        <rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.4" />
        <path d="M2.6 6.6h10.8M6.6 6.6v6M10.2 6.6v6" />
      </symbol>
      {/* 「关闭」（原型 `#i-x`）：用在待办详情浮层的关闭按钮上（侧滑详情与菜单一样要有明确出口） */}
      <symbol id="i-close" viewBox="0 0 16 16">
        <path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2" />
      </symbol>
      {/* —— Memo 屏（B3 批）—— */}
      {/* 「时间轴 / 列表」（原型 `#i-list`） */}
      <symbol id="i-list" viewBox="0 0 16 16">
        <path d="M5.6 4.4h7.2M5.6 8h7.2M5.6 11.6h7.2" />
        <circle cx="3.2" cy="4.4" r=".9" fill="currentColor" stroke="none" />
        <circle cx="3.2" cy="8" r=".9" fill="currentColor" stroke="none" />
        <circle cx="3.2" cy="11.6" r=".9" fill="currentColor" stroke="none" />
      </symbol>
      {/* 「瀑布流 / 图册」（原型 `#i-grid`） */}
      <symbol id="i-grid" viewBox="0 0 16 16">
        <rect x="2.6" y="2.6" width="4.6" height="4.6" rx="1" />
        <rect x="8.8" y="2.6" width="4.6" height="4.6" rx="1" />
        <rect x="2.6" y="8.8" width="4.6" height="4.6" rx="1" />
        <rect x="8.8" y="8.8" width="4.6" height="4.6" rx="1" />
      </symbol>
      {/* 「图片」（原型 `#i-image`）：图册空态用 */}
      <symbol id="i-image" viewBox="0 0 16 16">
        <rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.4" />
        <circle cx="6" cy="6.8" r="1.1" />
        <path d="M3.2 11.6 6.6 9l2.2 1.8 1.8-1.4 2.2 2.2" />
      </symbol>
      {/* 「随机漫步」（原型 `#i-bolt`） */}
      <symbol id="i-bolt" viewBox="0 0 16 16">
        <path d="M8.8 1.8 4.4 8.8h3l-.8 5.4 4.6-7.2h-3z" />
      </symbol>
      {/*
        「看板」（原型 `#i-kanban`：三列不等高）。原型画在 24 网格上，这里按本套 sprite 的
        16 网格重画——列宽 3、列间距 1.4，与 `#i-grid` 的间距同一量级（1.6px 描边下才不会糊成一块）。
      */}
      <symbol id="i-kanban" viewBox="0 0 16 16">
        <rect x="2.2" y="3.3" width="3" height="9.4" rx="1" />
        <rect x="6.6" y="3.3" width="3" height="6.2" rx="1" />
        <rect x="11" y="3.3" width="3" height="8.2" rx="1" />
      </symbol>
      {/*
        「导入笔记」（2026-10-02）：箭头向下落进一条底线 = 文件进到本子里。与 `#i-plus` 同为
        1.6px 描边、16 网格。
      */}
      <symbol id="i-import" viewBox="0 0 16 16">
        <path d="M8 2.6v7.2M5.2 7.2 8 10l2.8-2.8" />
        <path d="M3 11.4v1.2a.8.8 0 0 0 .8.8h8.4a.8.8 0 0 0 .8-.8v-1.2" />
      </symbol>
      {/*
        —— 正文格式工具栏的十个字形（编辑器专项优化 P1）——
        与 `#i-kanban` 同一画法：16 网格、1.6px 描边、`currentColor`；实心元素显式
        `fill="currentColor" stroke="none"`。字形参考 inkstone 用的 lucide 语义（加粗=实心 B
        的轮廓、列表=点 + 线），按本套 sprite 的网格与描边重画，不引外部图标库（DESIGN §5.5）。
      */}
      <symbol id="i-bold" viewBox="0 0 16 16">
        <path d="M5 2.8h3.3a2.6 2.6 0 0 1 0 5.2H5zM5 8h3.9a2.7 2.7 0 0 1 0 5.4H5z" />
        <path d="M5 2.8v10.6" />
      </symbol>
      <symbol id="i-italic" viewBox="0 0 16 16">
        <path d="M6.6 2.8h5M4.4 13.2h5M9.8 2.8 6.2 13.2" />
      </symbol>
      <symbol id="i-strikethrough" viewBox="0 0 16 16">
        <path d="M5.1 5.2c.4-1.4 1.6-2.3 3.1-2.3 1.7 0 2.9.9 2.9 2.2M5 10.8c.3 1.4 1.6 2.3 3.2 2.3 1.8 0 3-.9 3-2.2" />
        <path d="M2.9 8h10.2" />
      </symbol>
      <symbol id="i-code" viewBox="0 0 16 16">
        <path d="M5.3 4.5 2.3 8l3 3.5M10.7 4.5l3 3.5-3 3.5" />
      </symbol>
      <symbol id="i-code-block" viewBox="0 0 16 16">
        <rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.4" />
        <path d="M6.2 6.4 4.6 8l1.6 1.6M9.8 6.4 11.4 8l-1.6 1.6" />
      </symbol>
      <symbol id="i-heading" viewBox="0 0 16 16">
        <path d="M3.4 2.9v10.2M12.6 2.9v10.2M3.4 8h9.2" />
      </symbol>
      <symbol id="i-list-ul" viewBox="0 0 16 16">
        <circle cx="3.1" cy="4.1" r="1" fill="currentColor" stroke="none" />
        <circle cx="3.1" cy="8" r="1" fill="currentColor" stroke="none" />
        <circle cx="3.1" cy="11.9" r="1" fill="currentColor" stroke="none" />
        <path d="M6.2 4.1h6.8M6.2 8h6.8M6.2 11.9h6.8" />
      </symbol>
      <symbol id="i-list-ol" viewBox="0 0 16 16">
        <path d="M4.1 3.3 5 2.7v3" />
        <path d="M3.7 10.8c.2-.5.7-.9 1.3-.9.7 0 1.1.4 1.1.9 0 1-2.4 1.2-2.4 2.5h2.5" />
        <path d="M8.3 3.9h4.9M8.3 8h4.9M8.3 12.1h4.9" />
      </symbol>
      <symbol id="i-quote" viewBox="0 0 16 16">
        <path d="M7.2 4.2C5 4.9 3.9 6.3 3.9 8.4v3.4h3.5V8.3H5.2c.1-1.1.7-1.9 2-2.4zM13.4 4.2c-2.2.7-3.3 2.1-3.3 4.2v3.4h3.5V8.3h-2.2c.1-1.1.7-1.9 2-2.4z" />
      </symbol>
      <symbol id="i-link" viewBox="0 0 16 16">
        <path d="M6.6 9.4 9.4 6.6" />
        <path d="M7.6 4.4l1.3-1.3a2.5 2.5 0 0 1 3.5 3.5L11.1 7.9M8.4 11.6l-1.3 1.3a2.5 2.5 0 0 1-3.5-3.5L4.9 8.1" />
      </symbol>
    </svg>
  );
}

export interface IconProps {
  name: IconName;
  size?: 13 | 16 | 20;
  className?: string;
}

export function Icon({ name, size = 16, className = "ic" }: IconProps) {
  return (
    <svg className={className} width={size} height={size} aria-hidden="true" focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  );
}
