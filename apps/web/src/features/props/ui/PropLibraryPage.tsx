/**
 * 设置 › 属性库（管理页，2026-10-11 设计 §6.2）。
 *
 * 三条口径：
 * 1. **这里是属性库唯一的删除口**：正文侧只能「用 / 不用」，改类型、增删候选值、删除条目都只在这一页。
 *    删除不可逆，所以走 `ConfirmDialog`，并把后果写清楚（md 不动、键变成"未入库"）；
 * 2. **新建只影响"以后"**：库里加一个键不会给任何一篇 md 添上它，删一个键也不会从任何一篇 md 里
 *    去掉它。这句话必须留在界面上，否则"删了却没变化"看着像 bug；
 * 3. **内置键只读**：`title` / `tags` / `status` / `due` / `priority` 各有专用控件（标题输入框、
 *    标签 chip、清单三行），不能被删、也不能改键名，所以单独一张卡列出来说明。
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
  PROP_KEY_PATTERN,
  PROP_TYPE_LABELS,
  RESERVED_PROP_KEYS,
  addEntry,
  entryFor,
  normalizeLibrary,
  removeEntry,
  renameEntry,
  updateEntry,
} from "../model";
import { countPropUsage, type PropUsage } from "../usage";

export interface PropLibraryPageProps {
  library: readonly PropLibraryEntry[];
  onChange: (next: PropLibraryEntry[]) => void;
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

export function PropLibraryPage({ library, onChange }: PropLibraryPageProps) {
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
  }

  return (
    <>
      <section className="setcard" aria-label="属性库">
        <h3 className="setcard__title">
          属性库
          <InfoHint label="属性库说明">
            属性库是一份账号级的键值字典：有哪些属性、各是什么类型、有哪些候选取值。
            它只影响新建属性时的候选与控件——正文里写了什么、原格式怎么保留，都不由它决定。
            这里是删除属性的唯一入口：正文侧只能「用 / 不用」，不提供删除。
          </InfoHint>
        </h3>

        <div className="proplib__new">
          <input
            className="field__input"
            aria-label="新属性的键名"
            placeholder="键名（如 source）"
            value={newKey}
            onChange={(event) => setNewKey(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") create();
            }}
          />
          <select
            className="field__input"
            aria-label="新属性的类型"
            value={newType}
            onChange={(event) => setNewType(event.currentTarget.value as PropType)}
          >
            {TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {PROP_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" onClick={create} disabled={newKey.trim() === ""}>
            新建
          </Button>
        </div>
        {error !== null ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}

        {entries.length === 0 ? (
          <p className="proplib__note">
            还没有自建属性。新建一个之后，正文里的属性卡片就能选中它、按类型给控件。
          </p>
        ) : (
          <ul className="proplib__list">
            {entries.map((entry) => (
              <li key={entry.key} className="proplib__row">
                <div className="proplib__key">
                  <input
                    className="field__input"
                    aria-label={`键名 ${entry.key}`}
                    defaultValue={entry.key}
                    onBlur={(event) => rename(entry.key, event.currentTarget.value)}
                  />
                  <span className="proplib__usage">{usageText(entry.key)}</span>
                </div>
                <select
                  className="field__input"
                  aria-label={`${entry.key} 的类型`}
                  value={entry.type}
                  onChange={(event) =>
                    onChange(updateEntry(entries, entry.key, { type: event.currentTarget.value as PropType }))
                  }
                >
                  {TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>
                      {PROP_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
                <input
                  className="field__input"
                  aria-label={`${entry.key} 的候选取值`}
                  placeholder="候选取值（用逗号分隔）"
                  defaultValue={formatValues(entry.values)}
                  onBlur={(event) =>
                    onChange(updateEntry(entries, entry.key, { values: parseValues(event.currentTarget.value) }))
                  }
                />
                <Button
                  size="sm"
                  variant="danger"
                  aria-label={`删除属性 ${entry.key}`}
                  onClick={() => setPendingRemove(entry.key)}
                >
                  删除
                </Button>
              </li>
            ))}
          </ul>
        )}

        <p className="proplib__note">
          {usageError !== null
            ? usageError
            : `「被多少篇用到」按本机已有的正文统计${
                usage ? `（已看 ${usage.scanned} 篇）` : ""
              }：没同步下来的、以及加密空间里解不开的正文都不在其中。`}
        </p>
      </section>

      <section className="setcard" aria-label="内置属性">
        <h3 className="setcard__title">
          内置属性
          <InfoHint label="内置属性说明">
            title / tags / status / due / priority 是 MeNote 自己的键：标题输入框、标签 chip 与清单三行
            各有专用控件。它们不能被删、也不能改键名，所以只在这里列出来看。
          </InfoHint>
        </h3>
        <ul className="proplib__list">
          {BUILTIN_PROP_ENTRIES.map((entry) => (
            <li key={entry.key} className="proplib__row proplib__row--builtin">
              <span className="proplib__keyname">{entry.key}</span>
              <span className="proplib__type">{PROP_TYPE_LABELS[entry.type]}</span>
              <span className="proplib__usage">{usageText(entry.key)}</span>
              <span className="proplib__badge">内置</span>
            </li>
          ))}
        </ul>
      </section>

      <ConfirmDialog
        open={pendingRemove !== null}
        title={`删除属性 ${pendingRemove ?? ""}？`}
        desc="库里删掉后，已经用了它的笔记里的键还在（md 一动不动），只是变成「未入库的键」、不再出现在候选里。要让某一篇不再有这个属性，得去那篇正文的属性卡片里点「本篇不再用」。"
        confirmLabel="删除条目"
        onConfirm={() => {
          if (pendingRemove !== null) onChange(removeEntry(entries, pendingRemove));
          setPendingRemove(null);
        }}
        onClose={() => setPendingRemove(null)}
      />
    </>
  );
}
