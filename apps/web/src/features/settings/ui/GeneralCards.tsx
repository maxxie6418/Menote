/**
 * 「通用」页里的两张卡：**账户快捷菜单**的兄弟卡、以及**关于**。
 *
 * **【v0.8.4】从 `SettingsPanel.tsx` 抽出来**（`docs/modules/Menote-M8-设置页信息架构-v1.md` §3.1）：
 * 「编辑器」与「关于」两个分类被撤销、内容并进「通用」之后，那个文件涨到 538 行、
 * 触发 `max-lines` 的 500 硬上限（lint error）。抽出的是**纯搬移**：控件、取值、回调、
 * 断言口径一条没变，变的只是它们在哪个文件里。
 *
 * **【v0.8.40】「编辑体验」卡再搬一次**：用户 2026-10-18 要求"设置里要有一个编辑设置"，
 * 2026-10-19 选定"新建独立分类 + 把这张卡搬进去"。卡整个搬去 `EditorSettingsPage.tsx`
 * （连同它的文案与不变式），**不在这里留一份**——两处各留一份，迟早一处改了一处没改。
 */
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
