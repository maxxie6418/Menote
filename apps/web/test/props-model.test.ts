/**
 * 属性库的纯函数（2026-10-11，《MeNote 属性库设计 v1》v2.1 §3）。
 *
 * 这一层的错**一个都不会报错**：规范化漏掉一个内置键，管理页就能新建出 `status` 条目；
 * `registerValue` 顺手把类型改掉，卡片里的控件就从日期变成文本框。所以逐条钉住。
 */
import { describe, expect, it } from "vitest";
import {
  BUILTIN_PROP_ENTRIES,
  VALUE_CANDIDATE_LIMIT,
  addEntry,
  candidateValues,
  collectUsedKeys,
  entryFor,
  isBuiltinKey,
  isPropKey,
  normalizeLibrary,
  registerValue,
  removeEntry,
  renameEntry,
  updateEntry,
  type PropLibraryEntry,
} from "../src/features/props/model";

function entry(key: string, extra: Partial<PropLibraryEntry> = {}): PropLibraryEntry {
  return { key, builtin: false, type: "text", values: [], ...extra };
}

describe("键名与保留字", () => {
  it("形状对的普通键可以进库", () => {
    expect(isPropKey("url")).toBe(true);
    expect(isPropKey("my-key_2")).toBe(true);
    expect(isPropKey("URL")).toBe(true);
  });

  it("内置五个 + menote 不能当外来属性（否则卡片里会出现两个 status）", () => {
    for (const key of ["title", "tags", "status", "due", "priority", "menote"]) {
      expect(isPropKey(key), key).toBe(false);
    }
    // 内置清单与「拦住的键」两处口径必须一致
    for (const one of BUILTIN_PROP_ENTRIES) expect(isBuiltinKey(one.key)).toBe(true);
    expect(isBuiltinKey("menote")).toBe(false);
    expect(BUILTIN_PROP_ENTRIES).toHaveLength(5);
  });

  it("含空格 / 冒号的键不行（写进 YAML 会让整块坏掉）", () => {
    expect(isPropKey("a b")).toBe(false);
    expect(isPropKey("a:b")).toBe(false);
    expect(isPropKey("")).toBe(false);
  });
});

describe("normalizeLibrary：读盘数据一律先过这一道", () => {
  it("剔掉内置键与非法键名", () => {
    const next = normalizeLibrary([entry("url"), entry("status"), entry("a b"), entry("menote")]);
    expect(next.map((one) => one.key)).toEqual(["url"]);
  });

  it("重复键：后者覆盖内容，但保留先出现的位置", () => {
    const next = normalizeLibrary([
      entry("url", { type: "text", values: ["https://a"] }),
      entry("source", { type: "date" }),
      entry("url", { type: "choice", values: ["https://b"] }),
    ]);
    expect(next.map((one) => one.key)).toEqual(["url", "source"]);
    expect(next[0]).toEqual({ key: "url", builtin: false, type: "choice", values: ["https://b"] });
  });

  it("类型不认识回落 text，values 去空去重并截到上限", () => {
    const many = Array.from({ length: VALUE_CANDIDATE_LIMIT + 5 }, (_, index) => `v${index}`);
    const next = normalizeLibrary([
      entry("url", { type: "wat" as PropLibraryEntry["type"], values: ["a", "", "a", ...many] }),
    ]);
    expect(next[0]?.type).toBe("text");
    expect(next[0]?.values).toHaveLength(VALUE_CANDIDATE_LIMIT);
    expect(next[0]?.values[0]).toBe("a");
  });

  it("库里进来的一律不是内置（builtin 由这份清单现成给出）", () => {
    const next = normalizeLibrary([entry("url", { builtin: true })]);
    expect(next[0]?.builtin).toBe(false);
  });
});

describe("增 / 删 / 改 / 改名", () => {
  it("新建的条目排在最前", () => {
    const next = addEntry([entry("url")], "source", "date");
    expect(next.map((one) => one.key)).toEqual(["source", "url"]);
    expect(next[0]).toEqual({ key: "source", builtin: false, type: "date", values: [] });
  });

  it("已存在的键只提到最前，类型与取值都不动（已存在的定义说了算）", () => {
    const next = addEntry([entry("url", { type: "date", values: ["2026-10-11"] }), entry("z")], "url");
    expect(next.map((one) => one.key)).toEqual(["url", "z"]);
    expect(next[0]?.type).toBe("date");
  });

  it("保留键原样返回（纯函数不抛：它还要在渲染期被调用）", () => {
    const library = [entry("url")];
    expect(addEntry(library, "status")).toEqual(library);
    expect(registerValue(library, "menote", "x")).toEqual(library);
  });

  it("删条目按 key 过滤", () => {
    expect(removeEntry([entry("url"), entry("z")], "url").map((one) => one.key)).toEqual(["z"]);
  });

  it("改名只动库里那一处，不回写任何文档", () => {
    const next = renameEntry([entry("url"), entry("z")], "url", "source");
    expect(next.map((one) => one.key)).toEqual(["source", "z"]);
    // 目标已存在 / 形状非法 / 源不存在 → 一个都不动
    expect(renameEntry([entry("url"), entry("z")], "url", "z")).toHaveLength(2);
    expect(renameEntry([entry("url")], "url", "a b")[0]?.key).toBe("url");
    expect(renameEntry([entry("url")], "nope", "source")[0]?.key).toBe("url");
  });

  it("改类型 / 改候选；不认识的类型回落成原来那个", () => {
    const before = [entry("url", { type: "text", values: ["a"] })];
    const next = updateEntry(before, "url", { type: "choice", values: ["a", "b"] });
    expect(next[0]).toMatchObject({ type: "choice", values: ["a", "b"] });
    const guarded = updateEntry(before, "url", { type: "wat" as PropLibraryEntry["type"] });
    expect(guarded[0]?.type).toBe("text");
    // 键不在库里 → 原样
    expect(updateEntry(before, "nope", { type: "date" })).toEqual(before);
  });
});

describe("registerValue：用户填过的值才登记", () => {
  it("空值不登记（清空一个框不该在库里留痕）", () => {
    expect(registerValue([], "url", "")).toEqual([]);
  });

  it("新值排在最前，已存在的条目保持自己的类型", () => {
    const next = registerValue([entry("url", { type: "choice", values: ["a"] })], "url", "b");
    expect(next[0]).toMatchObject({ type: "choice", values: ["b", "a"] });
    // 重复登记只是再提到最前，不会越攒越多
    expect(registerValue(next, "url", "a")[0]?.values).toEqual(["a", "b"]);
  });

  it("键不在库里时建条目，类型按原形状推（块序列 → 多行）", () => {
    expect(registerValue([], "author", '  - "Unknown"', true)[0]).toMatchObject({
      key: "author",
      type: "multiline",
    });
    expect(registerValue([], "url", "https://x")[0]).toMatchObject({ key: "url", type: "text" });
  });

  it("登记到上限就不再加（`VALUE_CANDIDATE_LIMIT` 是用户可见行为）", () => {
    let library: PropLibraryEntry[] = [];
    for (let index = 0; index < VALUE_CANDIDATE_LIMIT + 3; index += 1) {
      library = registerValue(library, "url", `v${index}`);
    }
    expect(library[0]?.values).toHaveLength(VALUE_CANDIDATE_LIMIT);
    expect(library[0]?.values[0]).toBe(`v${VALUE_CANDIDATE_LIMIT + 2}`);
  });
});

describe("查询与用量统计", () => {
  it("entryFor 找不到就是 undefined（不是抛错），candidateValues 回落空数组", () => {
    const library = [entry("url", { values: ["a"] })];
    expect(entryFor(library, "nope")).toBeUndefined();
    expect(candidateValues(library, "nope")).toEqual([]);
    expect(candidateValues(library, "url")).toEqual(["a"]);
  });

  it("collectUsedKeys 按篇数计，同一篇里同一个键只算一次，且不数内置键", () => {
    const one = "---\nurl: a\nurl: b\nauthor:\n  - x\nstatus: todo\n---\n\n正文";
    const two = "---\nurl: c\n---\n\n正文";
    const counts = collectUsedKeys([one, two, "没有 front matter 的正文"]);
    expect(counts.get("url")).toBe(2);
    expect(counts.get("author")).toBe(1);
    // `status` 被顶层白名单取走，不在外来键里 —— 内置键的用量由 `usage.ts` 另算
    expect(counts.has("status")).toBe(false);
  });
});
