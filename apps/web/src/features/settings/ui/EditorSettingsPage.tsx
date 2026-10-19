/**
 * 设置 › 编辑设置（v0.8.40，设计 `docs/modules/Menote-编辑设置-设计-v1.md`）。
 *
 * 四张卡，自上而下——**编辑模式 / 正文排版 / 标题样式 / 工具栏**：
 *
 * 1. **编辑模式**：v0.8.4 并进「通用」的那张卡**搬到这里**（用户 2026-10-19 口径：
 *    「新建独立分类 + 把「通用」里的「编辑体验」卡搬进来」）。契约一个字没改。
 * 2. **正文排版**（账号级）：字号 / 字体 / 纸面宽度。**缺省 = 跟随主题**——不写值就用
 *    `DESIGN.md` §3.3 的令牌值，所以"清空"与"全新账号"是同一种状态。
 * 3. **标题样式**（账号级）：六级标题的字号 / 粗细 / 颜色，同样"缺省 = 跟随主题"。
 * 4. **工具栏**（**本机**）：图标与按钮盒子的档位。它跟设备走（用户的原话是"有的分辨率下太小了"），
 *    所以名称旁挂 `<LocalOnlyTag/>`。
 *
 * 这一页为什么单独成文件：`SettingsPanel.tsx` 已经贴着 `max-lines` 的 500 上限
 * （v0.8.4 就是因为撞上限才把「通用」那两张卡抽进 `GeneralCards.tsx`）——新页只做
 * "分类与版式"的 `SettingsPanel` 再加两百行必然超线。
 */
import { useState } from "react";
import {
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  EDITOR_PAPER_WIDTH_MAX,
  EDITOR_PAPER_WIDTH_MIN,
  HEADING_FONT_SIZE_MAX,
  HEADING_FONT_SIZE_MIN,
  HEADING_LEVELS,
  HEADING_WEIGHTS,
  PRODUCT_EDITOR_MODES,
  normalizeEditorModes,
  type EditorFontFamily,
  type EditorMode,
  type EditorTypography,
  type HeadingLevel,
  type HeadingStyle,
  type UserSettings,
} from "@menote/shared";
import { Button } from "../../../app/ui/Controls";
import { InfoHint } from "../../../app/ui/InfoHint";
import {
  DEFAULT_TOOLBAR_SIZE,
  TOOLBAR_SIZES,
  readToolbarSize,
  writeToolbarSize,
  type ToolbarSize,
} from "../../../app/editor/toolbar-size";
import { paperWidthOf, textColumnWidth } from "../editor-typography";
import { LocalOnlyTag } from "./GeneralCards";

/** 产品清单的标签与说明——取值与顺序来自契约，这里只给文案（与 `EDITOR_MODE_COPY` 同一口径） */
const MODE_COPY = {
  edit: { label: "仅编辑", desc: "只显示编辑区" },
  preview: { label: "仅预览", desc: "只显示预览区" },
  live: { label: "即时渲染", desc: "边写边渲染，代码块与表格回到源码" },
} as const satisfies Record<(typeof PRODUCT_EDITOR_MODES)[number], { label: string; desc: string }>;

export interface EditorModesCardProps {
  userSettings: UserSettings;
  onPatchSettings: (partial: Partial<UserSettings>) => void;
}

/**
 * 「编辑模式」卡（v0.8.4 由原「编辑器」分类搬进「通用」，v0.8.40 再搬到这里）。
 *
 * 两条纪律（搬家时一字未改）：①落库顺序一律走契约的规范顺序（`normalizeEditorModes`），
 * 不随点击次序漂；②**至少留一档**——UI 已经把"最后开着的那一个"禁用掉，这里再挡一次
 * （注意这里**不能**直接用归一化的兜底：那会把"关掉最后一个"变成"产品档全开"，与用户意图相反）。
 */
export function EditorModesCard({ userSettings, onPatchSettings }: EditorModesCardProps) {
  function patchEditorModes(id: EditorMode, on: boolean): void {
    const current = normalizeEditorModes(userSettings.editor_modes);
    const next = on ? [...current, id] : current.filter((mode) => mode !== id);
    if (next.length === 0) return;
    onPatchSettings({ editor_modes: normalizeEditorModes(next) });
  }

  return (
    <section className="setcard" aria-label="编辑模式">
      <h3 className="setcard__title">
        编辑模式
        <InfoHint label="编辑模式说明">
          这里管「一篇笔记能切到哪几档」；关掉的档不再出现在正文区那条切换条里，至少要留一个。
        </InfoHint>
      </h3>
      {PRODUCT_EDITOR_MODES.map((id) => {
        const option = { id, ...MODE_COPY[id] };
        // 按**归一化后的产品档**判断开关状态，老行里的 split / live 不参与
        const active = normalizeEditorModes(userSettings.editor_modes);
        const on = active.includes(id);
        const lastOne = on && active.length === 1;
        return (
          <div className="setrow" key={id}>
            <div className="setrow__label">
              <span className="setrow__name">{option.label}</span>
              <span className="setrow__desc">{option.desc}</span>
              {/* 禁用不能只靠悬停（DESIGN.md §6.1）：最后开着的那一档把原因平铺出来 */}
              {lastOne ? (
                <span className="setrow__desc">至少保留一个模式，所以这一个不能再关</span>
              ) : null}
            </div>
            <span className="setrow__control">
              <button
                type="button"
                role="switch"
                className="toggle"
                aria-checked={on}
                aria-label={option.label}
                disabled={lastOne}
                onClick={() => patchEditorModes(id, !on)}
              />
            </span>
          </div>
        );
      })}
      {/*
        「上次用的那一档」是设备级记忆，与上面三个跟账号同步的开关**作用域不同**——
        同一张卡里点破这件事的是下面那行的 `本机` 标记（v0.8.16 起只有例外才标）。
      */}
      <div className="setrow">
        <div className="setrow__label">
          <span className="setrow__name">
            打开时用哪一档
            <LocalOnlyTag />
          </span>
          <span className="setrow__desc">记的是你上次用的那一档，只在本机生效</span>
        </div>
        <span className="setrow__desc">本机记忆</span>
      </div>
    </section>
  );
}

/**
 * 数字行（设置页里"控件 + 单位 + 越界可见报错"的统一形状）。
 *
 * 三条做法与版本与回收站页一致：①受控 draft，**合法才落库**（不把 3000 这类值写进账号设置）；
 * ②**清空 = 跟随主题**（`onCommit(null)`），所以"回位"有一条明确的路；③越界时把范围**平铺**在
 * 行下方（`role="alert"`），不做成只靠悬停的提示（`DESIGN.md` §6.1）。
 */
function NumberRow({
  name,
  desc,
  value,
  min,
  max,
  unit,
  onCommit,
}: {
  name: string;
  desc?: string;
  value: number | undefined;
  min: number;
  max: number;
  unit?: string;
  onCommit: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  // 外部值变了（点了「跟随主题」、别的设备同步下来）→ 在**渲染期**对齐，不放进 effect：
  // 在 effect 里同步 setState 会多渲染一轮、还会触发级联渲染（React 推荐的"记住上一次的 prop"写法）。
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(value === undefined ? "" : String(value));
  }

  const trimmed = draft.trim();
  const digits = /^\d+$/.test(trimmed);
  const parsed = digits ? Number.parseInt(trimmed, 10) : null;
  const outOfRange = parsed !== null && (parsed < min || parsed > max);
  const invalid = trimmed !== "" && !digits ? true : outOfRange;

  return (
    <>
      <div className="setrow">
        <div className="setrow__label">
          <span className="setrow__name">{name}</span>
          {desc ? <span className="setrow__desc">{desc}</span> : null}
        </div>
        <div className="setrow__control">
          <input
            className="field__input"
            aria-label={name}
            inputMode="numeric"
            value={draft}
            aria-invalid={invalid || undefined}
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              const text = next.trim();
              if (text === "") {
                onCommit(null);
                return;
              }
              if (!/^\d+$/.test(text)) return;
              const parsedNext = Number.parseInt(text, 10);
              if (parsedNext >= min && parsedNext <= max) onCommit(parsedNext);
            }}
          />
          {unit ? <span className="setrow__unit">{unit}</span> : null}
        </div>
      </div>
      {invalid ? (
        <p className="field__error" role="alert">
          请填 {min}–{max}
        </p>
      ) : null}
    </>
  );
}

/** 「正文排版」卡：字号 / 字体 / 纸面宽度——三项都**账号级**（换设备后排版不变） */
function TypographyCard({
  typography,
  onPatch,
}: {
  typography: EditorTypography;
  onPatch: (partial: Partial<EditorTypography>) => void;
}) {
  const paperWidth = paperWidthOf(typography);
  return (
    <section className="setcard" aria-label="正文排版">
      <h3 className="setcard__title">
        正文排版
        <InfoHint label="正文排版说明">
          这三项跟随账号，换设备打开同一篇笔记看到的是同一套排版。每一项都可以清空——
          清空就是「跟随主题」，回到 MeNote 默认的取值。
        </InfoHint>
      </h3>
      <NumberRow
        name="正文字号"
        desc="编辑档与即时渲染档同字号；仅预览档一并跟随"
        value={typography.font_size}
        min={EDITOR_FONT_SIZE_MIN}
        max={EDITOR_FONT_SIZE_MAX}
        unit="px"
        onCommit={(next) => onPatch({ font_size: next ?? undefined })}
      />
      <div className="setrow">
        <div className="setrow__label">
          <span className="setrow__name">字体</span>
          <span className="setrow__desc">目前提供主题自带的两族；更多字体会在后续版本内置</span>
        </div>
        <div className="setrow__control">
          <select
            className="field__input"
            aria-label="字体"
            value={typography.font_family ?? ""}
            onChange={(event) =>
              onPatch({
                font_family: (event.target.value || undefined) as EditorFontFamily | undefined,
              })
            }
          >
            <option value="">跟随主题</option>
            <option value="sans">系统无衬线</option>
            <option value="mono">等宽</option>
          </select>
        </div>
      </div>
      <NumberRow
        name="纸面宽度"
        desc={`文字列 ${textColumnWidth(paperWidth)}px（纸面每侧留白 48px）`}
        value={typography.paper_width}
        min={EDITOR_PAPER_WIDTH_MIN}
        max={EDITOR_PAPER_WIDTH_MAX}
        unit="px"
        onCommit={(next) => onPatch({ paper_width: next ?? undefined })}
      />
    </section>
  );
}

const LEVEL_LABELS: Record<HeadingLevel, string> = {
  h1: "一级标题",
  h2: "二级标题",
  h3: "三级标题",
  h4: "四级标题",
  h5: "五级标题",
  h6: "六级标题",
};

/** 「标题样式」卡：六级标题各自的字号 / 粗细 / 颜色；空 = 该级跟随主题 */
function HeadingStylesCard({
  typography,
  onPatch,
}: {
  typography: EditorTypography;
  onPatch: (partial: Partial<EditorTypography>) => void;
}) {
  const headings = typography.headings ?? {};

  function patchLevel(level: HeadingLevel, next: HeadingStyle | null): void {
    const merged: Record<string, HeadingStyle> = { ...headings };
    if (next === null) {
      delete merged[level];
    } else {
      const cleaned: HeadingStyle = {};
      if (next.size !== undefined) cleaned.size = next.size;
      if (next.weight !== undefined) cleaned.weight = next.weight;
      if (next.color !== undefined) cleaned.color = next.color;
      if (Object.keys(cleaned).length === 0) delete merged[level];
      else merged[level] = cleaned;
    }
    onPatch({ headings: merged });
  }

  return (
    <section className="setcard" aria-label="标题样式">
      <h3 className="setcard__title">
        标题样式
        <InfoHint label="标题样式说明">
          即时渲染档与仅预览档共用同一份标题样式，改一次两处都变。留空的一项跟随主题；
          颜色用系统取色器选，「跟随主题」把它清回去。五级与六级标题默认比正文小，这是刻意的。
        </InfoHint>
      </h3>
      {HEADING_LEVELS.map((level) => {
        const style = headings[level] ?? {};
        const invalidSize =
          style.size !== undefined &&
          (style.size < HEADING_FONT_SIZE_MIN || style.size > HEADING_FONT_SIZE_MAX);
        return (
          <div className="setrow" key={level}>
            <div className="setrow__label">
              <span className="setrow__name">{LEVEL_LABELS[level]}</span>
            </div>
            <div className="setrow__control">
              <input
                className="field__input heading-style__size"
                aria-label={`${LEVEL_LABELS[level]}字号`}
                inputMode="numeric"
                placeholder="跟随"
                value={style.size === undefined ? "" : String(style.size)}
                aria-invalid={invalidSize || undefined}
                onChange={(event) => {
                  const text = event.target.value.trim();
                  if (text === "") {
                    patchLevel(level, { ...style, size: undefined });
                    return;
                  }
                  if (!/^\d+$/.test(text)) return;
                  patchLevel(level, { ...style, size: Number.parseInt(text, 10) });
                }}
              />
              <span className="setrow__unit">px</span>
              {invalidSize ? (
                <span className="field__error" role="alert">
                  {HEADING_FONT_SIZE_MIN}–{HEADING_FONT_SIZE_MAX}
                </span>
              ) : null}
              <select
                className="field__input heading-style__weight"
                aria-label={`${LEVEL_LABELS[level]}粗细`}
                value={style.weight === undefined ? "" : String(style.weight)}
                onChange={(event) =>
                  patchLevel(level, {
                    ...style,
                    weight: event.target.value === "" ? undefined : Number(event.target.value),
                  })
                }
              >
                <option value="">跟随主题</option>
                {HEADING_WEIGHTS.map((weight) => (
                  <option key={weight} value={weight}>
                    {weight === 400 ? "常规" : weight === 500 ? "中粗" : weight === 600 ? "半粗" : "粗"}
                  </option>
                ))}
              </select>
              <input
                type="color"
                // 没设过时给空串、由原生控件用自己的默认色（`#rrggbb` 字面量进不了源码——
                // `test/css-colors.test.ts` 扫全部 .ts/.tsx，一切颜色只能来自令牌或用户输入）；
                // `--auto` 让"没设过"看得出与"设成了某个颜色"不同
                className={style.color === undefined ? "colorfield colorfield--auto" : "colorfield"}
                aria-label={`${LEVEL_LABELS[level]}颜色`}
                value={style.color ?? ""}
                onChange={(event) => patchLevel(level, { ...style, color: event.target.value })}
              />
              {style.color === undefined ? (
                <span className="setrow__desc">跟随主题</span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => patchLevel(level, { ...style, color: undefined })}
                >
                  跟随主题
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** 「工具栏」卡：本机偏好——同一账号在不同屏幕上要的大小不一样 */
function ToolbarSizeCard() {
  const [size, setSize] = useState<ToolbarSize>(() => readToolbarSize());
  return (
    <section className="setcard" aria-label="工具栏">
      <h3 className="setcard__title">
        工具栏
        <InfoHint label="工具栏说明">
          正文上方的格式工具栏。「小」是默认大小；屏幕大、分辨率高看着小，就往上调一档。
          它只在这台设备生效——另一台设备按自己的设置显示。
        </InfoHint>
      </h3>
      <div className="setrow">
        <div className="setrow__label">
          <span className="setrow__name">
            大小
            <LocalOnlyTag />
          </span>
          <span className="setrow__desc">按钮与图标的尺度，只影响这台设备</span>
        </div>
        <div className="setrow__control">
          <select
            className="field__input"
            aria-label="工具栏大小"
            value={size}
            onChange={(event) => {
              const next = event.target.value as ToolbarSize;
              setSize(next);
              writeToolbarSize(next);
            }}
          >
            {TOOLBAR_SIZES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate === "sm" ? "小" : candidate === "md" ? "中" : "大"}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="setrow">
        <div className="setrow__label">
          <span className="setrow__desc">
            当前档位：{size === DEFAULT_TOOLBAR_SIZE ? "小（默认）" : size === "md" ? "中" : "大"}
          </span>
        </div>
      </div>
    </section>
  );
}

export interface EditorSettingsPageProps {
  userSettings: UserSettings;
  onPatchSettings: (partial: Partial<UserSettings>) => void;
}

/** 设置 › 编辑设置：四张卡，自上而下 */
export function EditorSettingsPage({ userSettings, onPatchSettings }: EditorSettingsPageProps) {
  const typography = userSettings.editor_typography;
  /**
   * 排版的写入：**整份替换**（与属性库同一条路数）。删掉一项就是"给出少了的那份"，
   * 不做"逐字段合并"——那会让"清空 = 跟随主题"变得不可能表达。
   */
  function patchTypography(partial: Partial<EditorTypography>): void {
    /*
      `headings` 是**嵌套的一份映射**，要单独合：`patchLevel` 交上来的已经是"整份新 headings"，
      若这里再拿 `typography.headings` 去盖，就永远写不进去（v0.8.40 真机验收时踩到——
      改标题字号/粗细/颜色后控件立刻弹回"跟随"）。
      没有新 headings 时沿用旧的；旧新都没有就不写这个键（`undefined` = 该级跟随主题）。
    */
    const headings = partial.headings ?? typography.headings;
    const next: Record<string, unknown> = { ...typography, ...partial };
    if (headings === undefined || Object.keys(headings).length === 0) delete next.headings;
    else next.headings = headings;
    for (const [key, value] of Object.entries(partial)) {
      if (value === undefined) delete next[key];
    }
    onPatchSettings({ editor_typography: next as EditorTypography });
  }

  return (
    <>
      <EditorModesCard userSettings={userSettings} onPatchSettings={onPatchSettings} />
      <TypographyCard typography={typography} onPatch={patchTypography} />
      <HeadingStylesCard typography={typography} onPatch={patchTypography} />
      <ToolbarSizeCard />
    </>
  );
}
