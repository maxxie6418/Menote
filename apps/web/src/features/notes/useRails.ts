/**
 * 正文区两侧面板（属性 / 大纲）的展开意图与**让位规则**（2026-10-11，设计稿
 * `docs/modules/MeNote-属性卡与大纲悬浮-设计-v1.md` §2.3）。
 *
 * ## 让位规则（用户 2026-10-11 拍板）
 *
 * - 两侧同时展开要**够宽**：正文区 ≥ 1304px（= 240 + 12 两侧各一份 + 800 的纸面上限）；
 * - 不够宽时**同时只展开一侧**，另一侧自动收成把手——宁可纸面变窄，也不要面板压住正文；
 * - 让位时收起的是「**不是你刚点的那一侧**」；跟着窗口变窄时保留**最后动过的那一侧**。
 *
 * 窗口宽度可以随便变，`ResizeObserver` 量的是**正文区**（`.docpane__body`）自己的宽度，
 * 所以左右两条侧栏、功能栏、列表宽窄怎么变都自动算得对——不用维护断点表，也不会出现
 * "断点列了三个、实际窗口落在缝隙里"这类问题。
 *
 * **意图与呈现分开**：被窗口挤掉的那一侧，只影响这一次的呈现，**不改用户的意图**——
 * 窗口变宽后它会自己回来；而用户自己点开/收起则会写进意图（并记在本机）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  readRailsIntent,
  writeRailsIntent,
  type RailSide as PropsRailSide,
  type RailsIntent,
} from "./props-collapse";

export type RailSide = PropsRailSide;

/** 面板展开时的宽度，与 `app.css` 的 `--doc-rail-w` 同源 */
export const RAIL_OPEN_WIDTH = 240;
/** 面板与正文之间的间距，与 `app.css` 的 `--doc-rail-gap` 同源 */
export const RAIL_GAP = 12;
/** 一侧展开实占的宽度 */
export const RAIL_SLOT = RAIL_OPEN_WIDTH + RAIL_GAP;
/** 纸面宽度（`DESIGN.md` §2.8，`app.css` 的 `.cm-scroller { max-width: 800px }`）。
 *  注意 §2.3 的 740px 是**文字列**上限，纸面两侧各有 48px 内边距，所以文字列是 704px。 */
export const DOC_PAPER_MAX = 800;

/** 两侧同时展开所需的最小正文区宽度：252 + 800 + 252 = **1304px** */
export const BOTH_RAILS_MIN_PANE = 2 * RAIL_SLOT + DOC_PAPER_MAX;

export interface RailOpenState {
  props: boolean;
  outline: boolean;
}

/**
 * 由「用户意图 + 量到的正文区宽度」算出这一帧两侧到底开不开。
 *
 * `paneWidth === 0` 当作"还没量到"（首帧、`ResizeObserver` 不可用的环境）：**不抢跑**，
 * 按用户意图渲染。否则一进来就会在宽度未知时先收掉一侧，闪一下才回来。
 */
export function railOpenState(intent: RailsIntent, paneWidth: number): RailOpenState {
  const tooNarrow = paneWidth > 0 && paneWidth < BOTH_RAILS_MIN_PANE;
  if (tooNarrow && intent.propsOpen && intent.outlineOpen) {
    return intent.last === "outline"
      ? { props: false, outline: true }
      : { props: true, outline: false };
  }
  return { props: intent.propsOpen, outline: intent.outlineOpen };
}

export interface RailsApi {
  /** 这一帧属性面板是否展开（已按宽度让过位） */
  propsOpen: boolean;
  /** 这一帧大纲面板是否展开 */
  outlineOpen: boolean;
  /** 用户点了某侧的把手：展开 / 收起，并把它记成「最后动过的那一侧」 */
  toggle(side: RailSide): void;
  /** 挂到 `.docpane__body` 上量宽度（ref 回调，换节点会重新观察） */
  attachPane: (node: HTMLElement | null) => void;
}

export function useRails(): RailsApi {
  const [intent, setIntent] = useState<RailsIntent>(readRailsIntent);
  const [paneWidth, setPaneWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    writeRailsIntent(intent);
  }, [intent]);

  const attachPane = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) {
      setPaneWidth(0);
      return;
    }
    setPaneWidth(node.clientWidth);
    // jsdom / 老浏览器没有 ResizeObserver：量不到就保持"没量到"，按意图渲染（见函数头注释）
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setPaneWidth(node.clientWidth));
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  const toggle = useCallback(
    (side: RailSide) => {
      /*
        收起 / 展开要看**这一帧实际显示的是什么**，不能看意图：宽度不够时另一侧是被挤掉的，
        而意图里它还开着——照着意图翻，用户点了会"没反应"（意图从 true 翻成 false，
        屏幕上那一侧本来就是收着的）。
        打开这一侧时若宽度只够一侧，**顺手把另一侧的意图也收掉**：让位是这一点的直接结果，
        否则意图里两侧都开着，下次窗口一变宽又冒出来，像在跟用户抢。
      */
      setIntent((previous) => {
        const now = railOpenState(previous, paneWidth);
        const opening = side === "props" ? !now.props : !now.outline;
        const next: RailsIntent = { ...previous, last: side };
        if (side === "props") next.propsOpen = opening;
        else next.outlineOpen = opening;
        if (opening && paneWidth > 0 && paneWidth < BOTH_RAILS_MIN_PANE) {
          if (side === "props") next.outlineOpen = false;
          else next.propsOpen = false;
        }
        return next;
      });
    },
    [paneWidth],
  );

  const open = railOpenState(intent, paneWidth);
  return { propsOpen: open.props, outlineOpen: open.outline, toggle, attachPane };
}
