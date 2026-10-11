/**
 * `markdown-it-task-lists` 没有官方类型包（npm 404），这里按它的 README 口径补最小声明：
 * 一个 MarkdownIt 插件函数 + 三个布尔选项。其余内部实现不需要暴露。
 */
declare module "markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it";

  interface TaskListsOptions {
    /** `true` 时输出可用的复选框；预览是只读展示，固定传 `false` */
    enabled?: boolean;
    /** `true` 时把文字包进 `<label>`；预览不需要，固定传 `false` */
    label?: boolean;
    /** `true` 时给 `<li>` 加 `task-list-item` 类 */
    liClass?: boolean;
  }

  export default function taskLists(md: MarkdownIt, options?: TaskListsOptions): void;
}
