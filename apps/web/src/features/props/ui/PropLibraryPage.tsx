/**
 * 设置 › 属性库（管理页，2026-10-11 重设计 v1 §3）。
 *
 * 它是**一张表**：内置五行在上（淡底、不可删），自建行在下，表头与数据行共用同一份列宽。
 * 六列 = 属性名 / 显示名 / 类型 / 候选取值 / 用到 / 操作。从前是两张卡、两套版式，
 * 同一个"键"在两处字号、对齐、留白全不一样，而内置键那一卡连显示名都改不了。
 *
 * 四条口径：
 * 1. **这里是属性库唯一的删除口**：正文侧只能「用 / 不用」，改类型、增删候选值、删除条目都只在这一页。
 *    删除不可逆，所以走 `ConfirmDialog`，并把后果写清楚（md 不动、键变成"未入库"）；
 * 2. **新建只影响"以后"**：库里加一个键不会给任何一篇 md 添上它，删一个键也不会从任何一篇 md 里
 *    去掉它。这句话必须留在界面上，否则"删了却没变化"看着像 bug；
 * 3. **显示名只改界面**：写回 md、导出、分享、备份一律仍是源键名。内置键的显示名也能设（走
 *    `prop_labels`），但它的**类型与候选取值不可改**——类型由功能语义决定，值域扩展是设计稿 §8
 *    明确不在本期的"路 B"，所以那两格是只读陈述，不是控件；
 * 4. **内置键不可删、不可改键名**，所以它们的操作列是空的、属性名列带「内置」标记。
 *
 * 「被 N 篇用到」的口径见 `../usage`（只数本机已有的正文），页脚把这件事写出来。
 */
import { useEffect, useMemo, useState } from "react";
import type { PropLibraryEntry, PropType } from "@menote/shared";
import { Button } from "../../../app/ui/Controls";
import { ConfirmDialog } from "../../../app/ui/ConfirmDialog";
import { InfoHint } from "../../../app/ui/InfoHint";
import {
  BUILTIN_PROP_ENTRIES,
  BUILTIN_PROP_LABELS,
  PROP_KEY_PATTERN,
  PROP_TYPE_LABELS,
  RESERVED_PROP_KEYS,
  addEntry,
  builtinValueOptions,
  entryFor,
  isPropType,
  normalizeLibrary,
  removeEntry,
  renameEntry,
  updateEntry,
  withPropLabel,
  type PropLabels,
} from "../model";
import { countPropUsage, type PropUsage } from "../usage";

export interface PropLibraryPageProps {
  library: readonly PropLibraryEntry[];
  /** 显示名表（键 → 界面叫法）；只影响界面，写回 md 的永远还是源键名 */
  labels: PropLabels;
  onChange: (next: PropLibraryEntry[]) => void;
  onLabelsChange: (next: PropLabels) => void;
}

const TYPE_OPTIONS = Object.keys(PROP_TYPE_LABELS) as PropType[];

/** 候选取值的输入形状：一行文本，用逗号 / 顿号分隔（去空、去重，顺序就是优先级） */
function parseValues(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,，、]/)) {
    const value = raw.trim();
    if (value !== "" && !out.includes(value)) out.push(value);
  }
  return out;
}

function formatValues(values: readonly string[]): string {
  return values.join("、");
}

/**
 * 内置键的「候选取值」格：清单两键的值域是功能定死的（`todo / doing / done` 等），
 * 其余类型没有候选。这一格是**陈述**（灰字），不是输入框——改它要走路 B。
 */
function builtinValueText(key: string): string {
  const values = builtinValueOptions(key);
  return values.length > 0 ? values.join("、") : "— 这种类型没有候选取值";
}

export function PropLibraryPage({
  library,
  labels,
  onChange,
  onLabelsChange,
}: PropLibraryPageProps) {
  /** 同步下来的旧数据可能带重复键或非法键：界面只面对规范化后的形状，写回也用它 */
  const entries = useMemo(() => normalizeLibrary(library), [library]);
  const [usage, setUsage] = useState<PropUsage | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newType, setNewType] = useState<PropType>("text");
  const [error, setError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void countPropUsage()
      .then((next) => {
        if (!cancelled) setUsage(next);
      })
      .catch(() => {
        if (!cancelled) setUsageError("统计「被多少篇用到」失败；下面的编辑不受影响。");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 键名的问题；`null` = 可以用 */
  function keyProblem(key: string): string | null {
    if (key === "") return "先写一个键名。";
    if (!PROP_KEY_PATTERN.test(key)) return "键名只能用字母、数字、下划线、连字符。";
    if (RESERVED_PROP_KEYS.has(key)) {
      return `「${key}」是 MeNote 自己的键，上面已经有它的位置了。`;
    }
    if (entryFor(entries, key)) return `库里已经有「${key}」了。`;
    return null;
  }

  function usageText(key: string): string {
    if (usageError !== null) return "—";
    if (!usage) return "统计中…";
    const count = usage.counts.get(key) ?? 0;
    return count === 0 ? "还没被用到" : `${count} 篇`;
  }

  function create(): void {
    const key = newKey.trim();
    const problem = keyProblem(key);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setError(null);
    setNewKey("");
    onChange(addEntry(entries, key, newType));
  }

  function rename(from: string, raw: string): void {
    const to = raw.trim();
    if (to === from) return;
    const problem = keyProblem(to);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setError(null);
    onChange(renameEntry(entries, from, to));
    // 显示名跟着键走：改叫法不该把用户设的中文名丢掉
    const carried = labels[from] ?? "";
    if (carried !== "") {
      onLabelsChange(withPropLabel(withPropLabel(labels, to, carried), from, ""));
    }
  }

  function changeType(key: string, raw: string): void {
    if (!isPropType(raw)) return;
    setError(null);
    onChange(updateEntry(entries, key, { type: raw }));
  }

  function changeValues(key: string, raw: string): void {
    setError(null);
    onChange(updateEntry(entries, key, { values: parseValues(raw) }));
  }

  function setLabel(key: string, raw: string): void {
    onLabelsChange(withPropLabel(labels, key, raw.trim()));
  }

  /** 表头与数据行共用这一份列宽（改列宽只改 `app.css` 那一处 grid 模板） */
  const head = (
    <li className="proplib__row proplib__row--head" aria-hidden="true">
      <span className="proplib__cell">属性名</span>
      <span className="proplib__cell">显示名</span>
      <span className="proplib__cell">类型</span>
      <span className="proplib__cell">候选取值</span>
      <span className="proplib__cell">用到</span>
      <span className="proplib__cell">操作</span>
    </li>
  );

  return (
    <>
      <section className="setcard" aria-label="属性库">
        <h3 className="setcard__title">属性库</h3>
        <p className="proplib__note">
          类型决定正文里给什么控件，候选取值只是输入时的提示，都不会改 md 的写法。
          <InfoHint label="属性库的说明">
            库里的条目只影响"以后怎么填"：新建一个键不会给任何一篇 md 添上它，
            删掉一个键也不会从任何一篇 md 里去掉它。「显示名」只改界面上的叫法，
            写进文件、导出、分享、备份的永远是源名。
          </InfoHint>
        </p>

        <div className="proplib__new">
          <input
            className="field__input"
            aria-label="新属性的键名"
            placeholder="新属性的键名（字母、数字、下划线、连字符）"
            value={newKey}
            onChange={(event) => setNewKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") create();
            }}
          />
          <select
            className="field__input"
            aria-label="新属性的类型"
            value={newType}
            onChange={(event) => {
              if (isPropType(event.target.value)) setNewType(event.target.value);
            }}
          >
            {TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {PROP_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <Button onClick={create} disabled={newKey.trim() === ""}>
            新建
          </Button>
        </div>
        {error !== null ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}

        <ul className="proplib__list">
          {head}
          {BUILTIN_PROP_ENTRIES.map((entry) => (
            <li className="proplib__row proplib__row--builtin" key={entry.key}>
              <div className="proplib__cell">
                <span className="proplib__keyname">
                  {entry.key}
                  <span className="proplib__badge">内置</span>
                </span>
              </div>
              <div className="proplib__cell" data-label="显示名">
                <input
                  className="field__input"
                  aria-label={`${entry.key} 的显示名`}
                  defaultValue={labels[entry.key] ?? ""}
                  placeholder={BUILTIN_PROP_LABELS[entry.key] ?? entry.key}
                  onBlur={(event) => setLabel(entry.key, event.target.value)}
                />
              </div>
              <div className="proplib__cell" data-label="类型">
                {/* 内置键的类型由功能语义决定（状态必须是定值、截止必须是日期），不给改 */}
                <select
                  className="field__input"
                  aria-label={`${entry.key} 的类型`}
                  value={entry.type}
                  disabled
                  title="内置键的类型由功能语义决定，不可改"
                >
                  <option value={entry.type}>{PROP_TYPE_LABELS[entry.type]}</option>
                </select>
              </div>
              <div className="proplib__cell proplib__fixed" data-label="候选取值">
                {builtinValueText(entry.key)}
              </div>
              <div className="proplib__cell proplib__usage" data-label="用到">
                {usageText(entry.key)}
              </div>
              {/* 内置行没有可删的东西：给一个破折号，免得那一格看着像"漏了按钮" */}
              <div className="proplib__cell proplib__fixed">—</div>
            </li>
          ))}

          {entries.length === 0 ? (
            <li className="proplib__empty">
              还没有自建属性。新建一个之后，正文属性卡片的「用一个属性」里就能选到它。
            </li>
          ) : null}

          {entries.map((entry) => (
            <li className="proplib__row" key={entry.key}>
              <div className="proplib__cell" data-label="属性名">
                {/* 键名可以改：改的只是库里的叫法，已经用了它的 md 一个字不动 */}
                <input
                  className="field__input"
                  aria-label={`键名 ${entry.key}`}
                  defaultValue={entry.key}
                  onBlur={(event) => rename(entry.key, event.target.value)}
                />
              </div>
              <div className="proplib__cell" data-label="显示名">
                <input
                  className="field__input"
                  aria-label={`${entry.key} 的显示名`}
                  defaultValue={labels[entry.key] ?? ""}
                  placeholder="未设显示名"
                  onBlur={(event) => setLabel(entry.key, event.target.value)}
                />
              </div>
              <div className="proplib__cell" data-label="类型">
                <select
                  className="field__input"
                  aria-label={`${entry.key} 的类型`}
                  value={entry.type}
                  onChange={(event) => changeType(entry.key, event.target.value)}
                >
                  {TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>
                      {PROP_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="proplib__cell" data-label="候选取值">
                <input
                  className="field__input"
                  aria-label={`${entry.key} 的候选取值`}
                  defaultValue={formatValues(entry.values)}
                  placeholder="候选取值（用逗号分隔）"
                  onBlur={(event) => changeValues(entry.key, event.target.value)}
                />
              </div>
              <div className="proplib__cell proplib__usage" data-label="用到">
                {usageText(entry.key)}
              </div>
              <div className="proplib__cell" data-label="操作">
                <Button
                  size="sm"
                  variant="danger"
                  aria-label={`删除属性 ${entry.key}`}
                  onClick={() => setPendingRemove(entry.key)}
                >
                  删除
                </Button>
              </div>
            </li>
          ))}
        </ul>

        <p className="proplib__note">
          「用到」按本机已有的正文统计
          {usage ? `（已看 ${usage.scanned} 篇）` : ""}
          ：加密条目与还没同步下来的不在其中。
          {usageError !== null ? ` ${usageError}` : ""}
        </p>
      </section>

      <ConfirmDialog
        open={pendingRemove !== null}
        title={`删除属性 ${pendingRemove ?? ""}？`}
        desc="库里删掉后，已经用了它的笔记里的键还在（md 一动不动），只是变成「未入库的键」、不再出现在候选里。要让某一篇不再有这个属性，得去那篇正文的属性卡片里点「本篇不再用」。（显示名会留着：这个键以后再加回库里，界面叫法还在。）"
        confirmLabel="删除条目"
        onConfirm={() => {
          if (pendingRemove !== null) {
            // 显示名**不跟着删**（设计 §4.1：它独立于条目，能覆盖内置键与未入库的键）——
            // 删了条目、以后再加回来，用户设过的叫法不该凭空消失。
            onChange(removeEntry(entries, pendingRemove));
          }
          setPendingRemove(null);
        }}
        onClose={() => setPendingRemove(null)}
      />
    </>
  );
}
