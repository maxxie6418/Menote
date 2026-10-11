/**
 * 大纲面板的宿主侧接线（2026-10-11，设计稿 §4）。
 *
 * 三件事：把正文编译成大纲条目、跟着滚动算"现在在哪一节"、点条目跳过去。
 *
 * **为什么要单独一个文件**：这三件都需要宿主的两样东西——滚动容器（`.doc-split__pane`
 * 那个 div）与编辑器句柄；而"哪一节是当前节"在**两档下用的量法完全不同**：
 * 编辑 / 即时渲染档由 CodeMirror 把屏幕位置翻成字符偏移，仅预览档只能量 DOM。
 * 混进 `NoteWorkspace` 的话，那块本来就长的 JSX 里会多出一整套 effect。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import type { EditorHandle } from "../../app/editor/Editor";
import {
  activeOutlineIndex,
  activeOutlineIndexInPreview,
  buildOutline,
  matchPreviewHeading,
  type OutlineItem,
} from "./outline";

/** 可见区上沿的参考线相对容器上边再往下几像素（正文纸面的上内边距量级） */
const REFERENCE_LINE_INSET = 8;

export interface OutlinePaneApi {
  items: OutlineItem[];
  activeIndex: number | null;
  jump: (item: OutlineItem) => void;
}

export interface UseOutlineOptions {
  /** 编辑器当前文本（含 front matter）。表格档 / 锁定档传空串，并让 `enabled` 为 false */
  source: string;
  enabled: boolean;
  /** 真 = 正文挂在 CodeMirror 上（仅编辑 / 即时渲染档）；假 = 仅预览的 DOM */
  throughEditor: boolean;
  /** 正文的滚动容器（`.doc-split__pane`） */
  container: RefObject<HTMLDivElement | null>;
  handle: EditorHandle | null;
}

export function useOutline({
  source,
  enabled,
  throughEditor,
  container,
  handle,
}: UseOutlineOptions): OutlinePaneApi {
  const items = useMemo(() => (enabled ? buildOutline(source) : []), [enabled, source]);
  /*
    量出来的当前节**单独存**，`activeIndex` 是它的读数：没有标题时它必然是 `null`，
    换了一篇（条目变了）时旧读数可能指向一个不存在的节——都在这里当场修掉。
    这样 effect 里就不必"先 setState(null) 再干活"（那种写法会多渲染一轮，
    eslint 的 `react-hooks/set-state-in-effect` 也会拦住）。
  */
  const [measuredIndex, setMeasuredIndex] = useState<number | null>(null);
  const activeIndex =
    items.length === 0
      ? null
      : (items.find((one) => one.index === measuredIndex)?.index ?? items[0]!.index);

  useEffect(() => {
    if (items.length === 0) return;
    // 表格档没有句柄、锁定档还没有句柄：这两种情况不量，留着上一次的值（比闪成"空"好）
    if (throughEditor && !handle) return;
    /*
      容器在这里取一次就够：ref 在提交阶段就挂上了（effect 之前），而清理阶段再去读
      `container.current` 有可能已经被 React 置空——那时摘不掉监听，滚动监听会留在页面上。
    */
    const node = container.current;

    let frame = 0;
    const measure = (): void => {
      frame = 0;
      if (!node) return;
      if (throughEditor && handle) {
        const line = node.getBoundingClientRect().top + REFERENCE_LINE_INSET;
        setMeasuredIndex(activeOutlineIndex(items, handle.offsetAtViewportY(line)));
      } else {
        setMeasuredIndex(activeOutlineIndexInPreview(items, node));
      }
    };
    // 滚动事件一秒能来几十次，每次都量 DOM 太浪费：用 rAF 合并成"每帧最多一次"
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    measure();
    node?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      node?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [container, handle, items, throughEditor]);

  const jump = useCallback(
    (item: OutlineItem) => {
      if (throughEditor) {
        handle?.scrollToOffset(item.start);
        return;
      }
      const node = container.current;
      if (!node) return;
      const target = matchPreviewHeading(item, [
        ...node.querySelectorAll<HTMLElement>("h1, h2, h3"),
      ]);
      // jsdom 里没有 `scrollIntoView`，可选调用同时兜住它
      target?.scrollIntoView?.({ block: "start" });
    },
    [container, handle, throughEditor],
  );

  return { items, activeIndex, jump };
}
