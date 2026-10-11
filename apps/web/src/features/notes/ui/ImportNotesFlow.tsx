/**
 * 「导入笔记」的界面流程（v0.6.16）：隐藏的文件选择器 → 多选确认 → 结果。
 *
 * 为什么单独一个文件：`NotebookPanel` 已 350 行、顶着 500 行预算（架构 §2.3.1），
 * 而"文件选择器 + 确认框 + 失败清单"自成一块界面职责。
 *
 * 三条口径：
 * 1. **单选直接进，多选才确认**。导入是新增不是覆盖（不像备份恢复会覆盖同 id 条目），
 *    单个文件没什么可反悔的；多个一旦落错地方清理很烦，所以留一道，写清"几个 → 哪个笔记本"；
 * 2. **失败清单用弹窗而不是轻提示**。`DESIGN.md` §5.4-2：错误与校验提示**必须保持可见**，
 *    Toast 会自动消失，装不下"哪几个文件、为什么"；
 * 3. `input.value` 每次用完清空——同一个文件连选两次也要能再次触发；
 * 4. **录入步在"结果之前"**（2026-10-11 设计 §6.3）：传了 `library` 才有这一步，只列**陌生键**、
 *    默认全不勾、跳过不影响导入。插在这里是因为"这个属性要不要收进库"只有看着文件才答得上来。
 */
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { Button } from "../../../app/ui/Controls";
import { Modal } from "../../../app/ui/Modal";
import { pushToast, type ToastTone } from "../../../app/ui/Toast";
import type { ImportNotesSummary } from "../import-md";
import { addEntry, PROP_TYPE_LABELS, registerValue, type PropLibraryEntry } from "../../props/model";
import { scanUnknownKeys, type UnknownKeyHit } from "../../props/scan";
import type { PropType } from "@menote/shared";

/** 录入步里一行勾选后的两个选项：类型（只影响控件）与要不要把样例值记成候选 */
interface LearnPick {
  type: PropType;
  remember: boolean;
}

const LEARN_TYPES = Object.keys(PROP_TYPE_LABELS) as PropType[];

/** 触发器在 `+` 菜单里（`DropdownMenu` 的菜单项），所以由外面拿 `ref` 唤起文件选择器 */
export interface ImportNotesFlowHandle {
  open: () => void;
}

export interface ImportNotesFlowProps {
  ref?: Ref<ImportNotesFlowHandle>;
  /** 落点名字：确认框与结果里都用它（如「工作」/「根目录」/加密空间名） */
  targetLabel: string;
  onImport: (files: readonly File[]) => Promise<ImportNotesSummary>;
  /** 注入用：测试里替掉轻提示 */
  notify?: (message: string, tone: ToastTone) => void;
  /**
   * 属性库（2026-10-11 设计 §6.3 录入步）。**缺省 = 不做这一步**（老调用点与用例不必补参数）；
   * 传了才在"选完文件、真正导入之前"插一步：列出文件里 MeNote 还不认识的属性，逐条勾选是否收进库。
   */
  library?: readonly PropLibraryEntry[];
  /** 收录勾选的那些键（写入在宿主那一侧：`user_settings.prop_library`） */
  onLearn?: (next: PropLibraryEntry[]) => void;
}

function defaultNotify(message: string, tone: ToastTone): void {
  pushToast(message, tone);
}

/** 录入步的一行提示：值可能很长或成块，只取首行前 40 字，够认出是哪个属性就行 */
function sampleHint(hit: UnknownKeyHit): string {
  const first = hit.sample.split("\n")[0]?.trim() ?? "";
  if (first === "") return "（空值）";
  return first.length > 40 ? `${first.slice(0, 40)}…` : first;
}

export function ImportNotesFlow({
  ref,
  targetLabel,
  onImport,
  notify = defaultNotify,
  library,
  onLearn,
}: ImportNotesFlowProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** 已选、待确认的文件（只有多选才会进这里） */
  const [pending, setPending] = useState<File[] | null>(null);
  /** 导入完没能进来的文件：名字 + 原因 */
  const [skipped, setSkipped] = useState<ImportNotesSummary["skipped"] | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * 录入步（设计 §6.3）：文件已选好、**还没**导入的那一步。
   * `picks` **默认为空**——一个都不勾也照样导入（"跳过不影响导入结果"）。
   */
  const [learnStep, setLearnStep] = useState<{
    files: File[];
    hits: UnknownKeyHit[];
    picks: Readonly<Record<string, LearnPick>>;
  } | null>(null);

  // 空依赖：句柄只做一件事（代点文件选择器），不随渲染换身份
  useImperativeHandle(ref, () => ({ open: () => inputRef.current?.click() }), []);

  async function runImport(files: readonly File[]): Promise<void> {
    setPending(null);
    setBusy(true);
    try {
      const summary = await onImport(files);
      if (summary.skipped.length > 0) setSkipped(summary.skipped);
      // 一个都没进来时也要说话：光弹失败清单不够，得先给一句结论
      if (summary.created === 0) notify("没能导入任何文件，详见下面的清单", "error");
      else if (summary.skipped.length === 0) {
        notify(`已导入 ${summary.created} 篇笔记`, "success");
      } else {
        notify(`已导入 ${summary.created} 篇，${summary.skipped.length} 个没成功`, "warn");
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "导入失败，请稍后重试", "error");
    } finally {
      setBusy(false);
    }
  }

  /**
   * 真正导入**之前**的收口：先看有没有陌生属性要问。
   * 没传 `library`（或扫不出陌生键）就直接导——这一步是加分项，不能变成导入路径上的新堵点；
   * 扫描本身失败也照样往下走（`scanUnknownKeys` 内部已按文件吞错，这里只是最后一道保险）。
   */
  async function beginImport(files: readonly File[]): Promise<void> {
    setPending(null);
    if (!library) {
      await runImport(files);
      return;
    }
    let hits: UnknownKeyHit[];
    try {
      hits = await scanUnknownKeys(files, library);
    } catch {
      hits = [];
    }
    if (hits.length === 0) {
      await runImport(files);
      return;
    }
    setLearnStep({ files: [...files], hits, picks: {} });
  }

  /** 勾选 / 取消一行「录入」；勾上时给一个推出来的默认类型（块序列 → 多行） */
  function toggleAccepted(hit: UnknownKeyHit, on: boolean): void {
    setLearnStep((current) => {
      if (!current) return current;
      const picks = { ...current.picks };
      if (on) picks[hit.key] = { type: hit.block ? "multiline" : "text", remember: false };
      else delete picks[hit.key];
      return { ...current, picks };
    });
  }

  /** 改某一行的类型或「记住取值」 */
  function patchPick(key: string, patch: Partial<LearnPick>): void {
    setLearnStep((current) => {
      if (!current) return current;
      const pick = current.picks[key];
      if (!pick) return current;
      return { ...current, picks: { ...current.picks, [key]: { ...pick, ...patch } } };
    });
  }

  /** 勾了的收进库，然后照常导入 */
  async function finishLearn(): Promise<void> {
    const step = learnStep;
    if (!step) return;
    setLearnStep(null);
    if (library && onLearn) {
      const next = step.hits.reduce<PropLibraryEntry[]>((acc, hit) => {
        const pick = step.picks[hit.key];
        if (!pick) return acc;
        const added = addEntry(acc, hit.key, pick.type);
        // 「记住取值」= 把抽到的样例值记成候选（`registerValue` 不动已定的类型）
        return pick.remember ? registerValue(added, hit.key, hit.sample, hit.block) : added;
      }, [...library]);
      // 一个都没勾就不动库（"跳过不影响导入结果"）
      if (Object.keys(step.picks).length > 0) onLearn(next);
    }
    await runImport(step.files);
  }

  /** 「都不收」= 直接导入；点遮罩 / `Esc` 也走这里（文件已经选好了，不该卡在这一步） */
  function skipLearn(): void {
    const step = learnStep;
    setLearnStep(null);
    if (step) void runImport(step.files);
  }

  function onFilesPicked(list: FileList | null): void {
    const files = [...(list ?? [])];
    if (files.length === 0) return;
    // 单个直接进；多个先确认
    if (files.length === 1) void beginImport(files);
    else setPending(files);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".md,text/markdown"
        multiple
        className="visually-hidden"
        aria-label="选择要导入的 Markdown 文件"
        tabIndex={-1}
        disabled={busy}
        onChange={(event) => {
          onFilesPicked(event.currentTarget.files);
          // 同一个文件连选两次也要能触发
          event.currentTarget.value = "";
        }}
      />

      <Modal
        open={pending !== null}
        title={`把 ${pending?.length ?? 0} 个文件导入「${targetLabel}」？`}
        desc="一个文件建一篇笔记：标题取文件名，正文原样导入。内容是表格或待办的 .md 会按原样打开。"
        onClose={() => setPending(null)}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setPending(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => void beginImport(pending ?? [])}
            >
              导入
            </Button>
          </>
        }
      >
        <p className="hint-line">{pending?.map((file) => file.name).join("、")}</p>
      </Modal>

      {/* 录入步（设计 §6.3）：默认全不勾；勾上的收进属性库，跳过的不影响导入 */}
      <Modal
        open={learnStep !== null}
        title="这些属性要收进属性库吗？"
        desc="文件里有 MeNote 还不认识的属性。收进库只是让以后新建这个属性时能选中它、按类型给控件，不改这一篇的内容；一个都不勾也照样导入，键和值原样留着。"
        onClose={skipLearn}
        dismissable={false}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={skipLearn}>
              都不收
            </Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void finishLearn()}>
              继续导入
            </Button>
          </>
        }
      >
        <ul className="learnlist">
          {(learnStep?.hits ?? []).map((hit) => {
            const pick = learnStep?.picks[hit.key];
            return (
              <li key={hit.key} className="learnlist__row">
                <label className="learnlist__main">
                  <input
                    type="checkbox"
                    checked={pick !== undefined}
                    onChange={(event) => toggleAccepted(hit, event.currentTarget.checked)}
                  />{" "}
                  <span className="learnlist__key">{hit.key}</span>
                  {hit.count > 1 ? <span>（{hit.count} 篇）</span> : null}
                  <span className="learnlist__sample">· 例：{sampleHint(hit)}</span>
                </label>
                {pick ? (
                  <div className="learnlist__opts">
                    <label>
                      类型{" "}
                      <select
                        className="field__input"
                        value={pick.type}
                        onChange={(event) =>
                          patchPick(hit.key, { type: event.currentTarget.value as PropType })
                        }
                      >
                        {LEARN_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {PROP_TYPE_LABELS[type]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={pick.remember}
                        onChange={(event) =>
                          patchPick(hit.key, { remember: event.currentTarget.checked })
                        }
                      />{" "}
                      记住取值
                    </label>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Modal>

      <Modal
        open={skipped !== null}
        title="这些文件没能导入"
        desc="其余文件已经导入成功，下面这些没有动。"
        onClose={() => setSkipped(null)}
        footer={
          <Button variant="secondary" size="sm" onClick={() => setSkipped(null)}>
            知道了
          </Button>
        }
      >
        <ul className="hint-line">
          {(skipped ?? []).map((entry) => (
            <li key={entry.name}>
              {entry.name}：{entry.reason}
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
