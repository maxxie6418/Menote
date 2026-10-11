/**
 * 外来键的值控件（2026-10-11，《MeNote 属性库设计 v1》v2.1 §6.1）。
 *
 * ## 为什么单独一个文件
 *
 * `ItemProps.tsx` 已经贴着 `max-lines` 的 500 行预算，而"按类型给控件"这件事有六种形态 +
 * 三种回落，塞进卡片会把那张卡读不下去。这里只做**一件事**：拿一个键的库定义与当前原值，
 * 决定用哪个控件，并在用户改完时把新值交回宿主。
 *
 * ## 两条硬约束
 *
 * 1. **值不认识就回落纯文本**。`date` 控件拿到 `2026/10/11` 这种值时浏览器会把它显示成空、
 *    失焦再写回一个空值——**等于把用户的数据抹掉**。所以只有值真的符合该类型时才给类型控件，
 *    否则退回纯文本，原值一字不动地摆在框里。
 * 2. **只在真的改过时才交回**。交回一次就意味着"这一篇的这一行重写一次"，而且卡片会把它算作
 *    "用户动过"报给库（设计 §6.4）。只是点进来又点出去不该留下任何痕迹。
 */
import { useEffect, useRef } from "react";
import type { PropLibraryEntry } from "@menote/shared";
import { candidateValues } from "../model";

/** 值是块序列（YAML 的缩进子行）时的框高上限，与旧卡片一致 */
const BLOCK_ROWS_MAX = 4;

const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_TEXT = /^-?\d+(\.\d+)?$/;

/** 六种控件 + 两种文本框（单行 / 多行），回落时也用这两个 */
type PropControl = "text" | "multiline" | "date" | "number" | "boolean" | "choice";

/**
 * 决定用哪个控件。**纯函数，可直接单测。**
 *
 * `block` 是这一行原本的形状：声明成 `text` 却长着子行的值仍按多行给框，否则用户一编辑
 * 就把 `- a` `- b` 压成一行了（形状是用户的，类型只是建议）。
 */
export function controlFor(
  entry: PropLibraryEntry | undefined,
  value: string,
  block: boolean,
): PropControl {
  const fallback: PropControl = block ? "multiline" : "text";
  if (!entry) return fallback;
  switch (entry.type) {
    // 空值也按声明的类型给控件（刚加的 `date` 键要弹日期选择器）；
    // 有值但不是这个形状 → 回落纯文本，绝不交给会清空它的控件
    case "date":
      return value === "" || DATE_TEXT.test(value) ? "date" : fallback;
    case "number":
      return value === "" || NUMBER_TEXT.test(value) ? "number" : fallback;
    case "boolean":
      return value === "" || value === "true" || value === "false" ? "boolean" : fallback;
    case "choice":
      return entry.values.length > 0 ? "choice" : fallback;
    case "multiline":
      return "multiline";
    default:
      return fallback;
  }
}

export interface PropValueFieldProps {
  /** 键名，只用于生成 `datalist` 的 id 与无障碍名称 */
  propKey: string;
  /** 库里的定义（没有 = 未入库，按原形状给框） */
  entry?: PropLibraryEntry;
  /** 当前原值 */
  value: string;
  /** 原值是不是块序列 */
  block: boolean;
  disabled: boolean;
  readOnlyReason?: string;
  /**
   * 值真的变了才调用。`block` 是**该控件**的形态（多行框 → `true`），
   * 所以把单行值改成多行是有意的形状变化，不是 bug。
   */
  onCommit: (value: string, block: boolean) => void;
}

export function PropValueField({
  propKey,
  entry,
  value,
  block,
  disabled,
  readOnlyReason,
  onCommit,
}: PropValueFieldProps) {
  const control = controlFor(entry, value, block);
  const candidates = candidateValues(entry ? [entry] : [], propKey);
  const listId = `propcand-${propKey}`;

  /*
    非受控框靠 `defaultValue` 播种，值从外面变了（同步、撤销、换了一篇）它不会跟着动——
    而同一个键的行在切换条目时**不会重挂**（React 复用节点）。所以用"最后一次交回的值"
    当哨兵：只认自己发出去的改动，外部改动才重新播种。
  */
  const lastCommitted = useRef(value);
  useEffect(() => {
    if (value !== lastCommitted.current) lastCommitted.current = value;
  }, [value]);

  function commit(next: string, shape: boolean): void {
    if (next === value) return;
    lastCommitted.current = next;
    onCommit(next, shape);
  }

  const common = {
    className: "itemprops__input",
    readOnly: disabled,
    title: disabled ? readOnlyReason : undefined,
    "aria-label": `${propKey} 的值`,
  } as const;

  if (control === "choice" || control === "boolean") {
    const options = control === "boolean" ? ["true", "false"] : [...(entry?.values ?? [])];
    // 当前值不在候选里（外部写的、或库改过）时**把它自己列出来**，否则 select 显示成空、看着像丢了
    const withCurrent = value !== "" && !options.includes(value) ? [value, ...options] : options;
    return (
      <select
        {...common}
        value={value}
        disabled={disabled}
        onChange={(event) => commit(event.target.value, false)}
      >
        {value === "" ? <option value="">未设置</option> : null}
        {withCurrent.map((one) => (
          <option key={one} value={one}>
            {one}
          </option>
        ))}
      </select>
    );
  }

  if (control === "multiline") {
    return (
      <textarea
        {...common}
        className="itemprops__input itemprops__input--block"
        rows={Math.min(BLOCK_ROWS_MAX, Math.max(1, value.split("\n").length))}
        defaultValue={value}
        onBlur={(event) => commit(event.target.value, true)}
      />
    );
  }

  return (
    <>
      <input
        {...common}
        type={control}
        defaultValue={value}
        /* 只有纯文本框挂候选（`datalist` 对 date / number 无效，挂了也不报错，但没必要） */
        list={control === "text" && candidates.length > 0 ? listId : undefined}
        onBlur={(event) => commit(event.target.value, false)}
      />
      {control === "text" && candidates.length > 0 ? (
        <datalist id={listId}>
          {candidates.map((one) => (
            <option key={one} value={one} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}
