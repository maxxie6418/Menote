/**
 * 路由往返（2026-09-27 修复的回归）。
 *
 * 背景：`SETTINGS_PAGES` 这份设置分类清单曾漏掉 `editor` / `privacy` / `versions`，
 * `parseRoute` 遇到 `#/settings/privacy` 匹配不到就静默回落到 `general`——
 * **点「隐私锁」显示「通用」**，M3-9 的隐私锁设置页从界面上根本进不去，而且不报错、不白屏，
 * 只有手动对列表才发现。这里钉住"每个分类都能从自己的 URL 解析回自身"。
 */
import { describe, expect, it } from "vitest";
import { LEGACY_SETTINGS_PAGES, SETTINGS_PAGES, parseRoute, routeToHash } from "../src/app/router";

describe("设置分类的路由往返", () => {
  it("清单里的每个分类都能从自己的 hash 解析回自身", () => {
    for (const page of SETTINGS_PAGES) {
      const hash = routeToHash({ name: "settings", page });
      expect(parseRoute(hash), `${page} -> ${hash}`).toEqual({ name: "settings", page });
    }
  });

  it("清单覆盖全部设置分类（漏一个就会落到「通用」）", () => {
    // 期望值独立写在这里：往 SettingsPageId 里加分类时，必须同时进 SETTINGS_PAGES
    // 「编辑试验」2026-10-01 暂时收起（用户 2026-10-01）；
    // **【v0.8.4】11 类 → 9 类**：「编辑器」与「关于」被撤销、内容并进「通用」，
    // 原「数据管理」改名「附件」但**id 仍是 `data`**（老书签与深链不失效）。
    expect([...SETTINGS_PAGES].sort()).toEqual(
      [
        "general",
        "account",
        "backup",
        "shares",
        "mcp",
        "data",
        "privacy",
        "versions",
        "instance",
      ].sort(),
    );
  });

  it("撤销的两个分类：老 hash 仍落到「通用」，不是死链（v0.8.4）", () => {
    /*
      这条是本次调整里**最容易漏、后果最隐蔽**的一条：分类从 `SETTINGS_PAGES` 拿掉后，
      `parseRoute` 里那句"匹配不到就回落 general"会自动接住它们——表现与 2026-09-27
      修过的那个 bug **完全同形**（不报错、不白屏，只是安静地落在别处）。
      所以显式的 `LEGACY_SETTINGS_PAGES` 与"清单里不该再有它们"两件事都要钉住。
    */
    expect(LEGACY_SETTINGS_PAGES).toEqual({ editor: "general", about: "general" });
    expect(parseRoute("#/settings/editor")).toEqual({ name: "settings", page: "general" });
    expect(parseRoute("#/settings/about")).toEqual({ name: "settings", page: "general" });

    // 真正的原因是"已撤销"而不是"拼错了"——两者界面上都落到通用，但只有前者该被有意保留
    expect([...SETTINGS_PAGES]).not.toContain("editor");
    expect([...SETTINGS_PAGES]).not.toContain("about");
  });

  it("未知分类仍回落到「通用」，不抛错", () => {
    expect(parseRoute("#/settings/nope")).toEqual({ name: "settings", page: "general" });
  });

  it("顶层目的地不被设置分类的改动影响", () => {
    expect(parseRoute("#/login")).toEqual({ name: "login" });
    expect(parseRoute("#/register")).toEqual({ name: "register" });
    expect(parseRoute("#/notes")).toEqual({ name: "notes" });
    expect(parseRoute("")).toEqual({ name: "notes" });
  });

  it("回收站是独立页（M4-12）：有自己的路由与 hash", () => {
    expect(parseRoute("#/trash")).toEqual({ name: "trash" });
    expect(routeToHash({ name: "trash" })).toBe("#/trash");
  });
});
