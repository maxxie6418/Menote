/**
 * 「通用」页里的三块：**编辑体验**、**账户快捷菜单**的兄弟卡、以及**关于**。
 *
 * **【v0.8.4】从 `SettingsPanel.tsx` 抽出来**（`docs/modules/Menote-M8-设置页信息架构-v1.md` §3.1）：
 * 「编辑器」与「关于」两个分类被撤销、内容并进「通用」之后，那个文件涨到 538 行、
 * 触发 `max-lines` 的 500 硬上限（lint error）。抽出的是**纯搬移**：控件、取值、回调、
 * 断言口径一条没变，变的只是它们在哪个文件里。
 *
 * 抽这里而不是塞回 `SettingsPanel` 内部函数：这三块各自自成一张卡、互不共享状态，
 * 放进同目录的独立文件后 `SettingsPanel` 重新只管**分类与版式**（它文件头注释里那层职责）。
 */
import type { EditorMode, UserSettings } from "@menote/shared";
import { PRODUCT_EDITOR_MODES, normalizeEditorModes } from "@menote/shared";
import { InfoHint } from "../../../app/ui/InfoHint";
import { APP_VERSION, PROJECT_REPO_URL } from "../../../app/about";

/**
 * 设置项的**作用域例外标记**（v0.8.4 引入，v0.8.16 收窄）：标出**只在这台设备生效**的项。
 *
 * **【v0.8.16 用户决定】只标例外，不标默认**：此前每项都带作用域（`本机` / `跟随账号`），
 * 但 8 项里 7 项是账号级——把默认逐行标出来，等于把唯一的例外（主题、"上次用的那一档"）
 * 淹在一片同款徽标里，用户想找"哪几项不跟账号走"反而看不见了。**没标 = 跟随账号**，
 * 这是绝大多数项的事实，不需要每行重复一遍。
 *
 * 为什么例外必须**平铺可见**而不进 ⓘ：它回答的是"我改完为什么另一台没变"——用户改完主题
 * 发现另一台没跟着变时，唯一能立刻消除疑问的就是名称旁边这个标记。作用域属**标识**而非
 * **说明性文字**，所以不进 `InfoHint`（DESIGN.md §5.4-1 管的是后者）。
 *
 * 对读屏 `aria-hidden`：这行文字与名称读在一起会被重复播报（"主题 本机"），
 * 真正需要被读屏知道的是名称本身；作用域是视觉辅助。
 */
export function LocalOnlyTag() {
  return (
    <span className="scope-tag" aria-hidden="true">
      本机
    </span>
  );
}

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
 * 「编辑体验」卡（v0.8.4 由原「编辑器」分类搬来）。
 *
 * 搬运而不是删内容：三个开关的取值来源、至少留一档的不变式、落库顺序全部照旧。
 *
 * 两条纪律：①落库顺序一律走契约的规范顺序（`normalizeEditorModes`），不随点击次序漂；
 * ②**至少留一档**——UI 已经把"最后开着的那一个"禁用掉，这里再挡一次（一个不变式不靠单点保证；
 * 注意这里**不能**直接用归一化的兜底，那会把"关掉最后一个"变成"产品档全开"，与用户意图相反）。
 * **【阶段 A】起算点是归一化后的产品档**，不是存储里的原始数组：老行里可能存着 `split` / `live`，
 * 若拿原始数组算，会出现"界面上两档都显示为关，点一下却把两档一起打开"的怪状态。
 */
export function EditorModesCard({ userSettings, onPatchSettings }: EditorModesCardProps) {
  function patchEditorModes(id: EditorMode, on: boolean): void {
    const current = normalizeEditorModes(userSettings.editor_modes);
    const next = on ? [...current, id] : current.filter((mode) => mode !== id);
    if (next.length === 0) return;
    onPatchSettings({ editor_modes: normalizeEditorModes(next) });
  }

  return (
    <section className="setcard" aria-label="编辑体验">
      <h3 className="setcard__title">
        编辑体验
        <InfoHint label="编辑体验说明">
          这里管「打开一篇笔记时看到什么」；上面那张卡管「打开应用时看到什么」。
          开关决定正文区能切到哪几档；关掉的档不再出现在那条切换条里，至少要留一个。
        </InfoHint>
      </h3>
      {PRODUCT_EDITOR_MODES.map((id) => {
        const option = { id, ...MODE_COPY[id] };
        // 同上：按**归一化后的产品档**判断开关状态，老行里的 split / live 不参与
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
 * 「关于 MeNote」卡（v0.8.4 由原独立分类搬来）。
 *
 * 版本号来自 `about.ts` 的构建期注入（`__APP_VERSION__`，由 `vite.config.ts` 从根 `package.json`
 * 读进来）——**不在组件里抄一份**，那是最容易与发布版本脱节的地方。
 * 链接用 `.link`（DESIGN.md §5.4 v1.4：文字链接不得用按钮冒充）。
 */
export function AboutCard() {
  return (
    <section className="setcard" aria-label="关于">
      <h3 className="setcard__title">关于 MeNote</h3>
      <div className="setrow">
        <div className="setrow__label">
          <span className="setrow__name">版本</span>
        </div>
        <span className="setrow__desc">v{APP_VERSION}</span>
      </div>
      <div className="setrow">
        <div className="setrow__label">
          <span className="setrow__name">项目地址</span>
          <span className="setrow__desc">源码仓库（GitHub）</span>
        </div>
        <a className="link" href={PROJECT_REPO_URL} target="_blank" rel="noreferrer noopener">
          {PROJECT_REPO_URL}
        </a>
      </div>
    </section>
  );
}
