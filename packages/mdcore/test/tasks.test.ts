import { describe, expect, it } from "vitest";
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  deriveTaskFields,
  hasTaskValues,
  parseTaskDue,
  parseTaskPriority,
  parseTaskStatus,
} from "../src/tasks";

describe("任务字段字面量", () => {
  it("写入用英文，界面文案用中文标签", () => {
    expect(TASK_STATUS_LABELS).toEqual({ todo: "待办", doing: "进行中", done: "已完成" });
    expect(TASK_PRIORITY_LABELS).toEqual({ high: "高", medium: "中", low: "低" });
  });

  it("读取兼容中文写法（md 允许手工编辑）", () => {
    expect(parseTaskStatus("进行中")).toBe("doing");
    expect(parseTaskStatus("已完成")).toBe("done");
    expect(parseTaskStatus('"todo"')).toBe("todo");
    expect(parseTaskPriority("高")).toBe("high");
    expect(parseTaskPriority("低")).toBe("low");
  });

  it("无法识别的值归零而不抛错", () => {
    expect(parseTaskStatus("whatever")).toBeNull();
    expect(parseTaskStatus(null)).toBeNull();
    expect(parseTaskPriority(42)).toBeNull();
  });

  it("日期只接受真实存在的 YYYY-MM-DD", () => {
    expect(parseTaskDue("2026-09-30")).toBe("2026-09-30");
    expect(parseTaskDue("2026-02-30")).toBeNull(); // 2 月没有 30 日
    expect(parseTaskDue("2026-13-01")).toBeNull();
    expect(parseTaskDue("2026/09/30")).toBeNull();
    expect(parseTaskDue("")).toBeNull();
  });
});

describe("清单字段派生（is_task + 三个派生列）", () => {
  it("有 task 键即清单条目，字段照常解析", () => {
    const doc = `---
menote:
  type: memo
  task:
    status: doing
    due: 2026-09-30
    priority: 中
---

买牛奶 #生活
`;
    expect(deriveTaskFields(doc)).toEqual({
      isTask: true,
      status: "doing",
      due: "2026-09-30",
      priority: "medium",
    });
  });

  it("没有 task 键就不是清单条目", () => {
    expect(deriveTaskFields("---\nmenote:\n  type: memo\n---\n\n普通 Memo")).toEqual({
      isTask: false,
      status: null,
      due: null,
      priority: null,
    });
  });

  it("task 键存在但字段全空：仍是清单条目（三个字段可为空）", () => {
    expect(deriveTaskFields("---\nmenote:\n  task:\n---\n\n空清单")).toEqual({
      isTask: true,
      status: null,
      due: null,
      priority: null,
    });
  });
});

describe("hasTaskValues：写侧口径的清单标记（平铺后有值才有键）", () => {
  it("null 与三值全空都写不出清单条目", () => {
    expect(hasTaskValues(null)).toBe(false);
    expect(hasTaskValues(undefined)).toBe(false);
    expect(hasTaskValues({ status: null, due: null, priority: null })).toBe(false);
  });

  it("任一值有内容就算（与 renderTaskLines 的真值判断一致，空串不算）", () => {
    expect(hasTaskValues({ status: "todo", due: null, priority: null })).toBe(true);
    expect(hasTaskValues({ status: null, due: "2026-04-01", priority: null })).toBe(true);
    expect(hasTaskValues({ status: null, due: null, priority: "low" })).toBe(true);
    expect(hasTaskValues({ status: "", due: "", priority: "" })).toBe(false);
  });

  it("与读侧刻意不同：旧写法那种「键在但值全空」的条目，写侧表示不出来", () => {
    const legacy = "---\nmenote:\n  task:\n---\n\n空清单";
    expect(deriveTaskFields(legacy).isTask).toBe(true);
    expect(hasTaskValues(deriveTaskFields(legacy))).toBe(false);
  });
});
