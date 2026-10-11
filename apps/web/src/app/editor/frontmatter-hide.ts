/**
 * 编辑器里把 front matter **整段藏起来**（2026-10-04 首版；2026-10-11 改成完全不显示）。
 *
 * ## 2026-10-11：从「可点芯片」改成零宽隐藏
 *
 * 首版藏成一颗可点的芯片（`title · tags · url`），点一下在正文里展开原始 YAML。用户的决定是：
 * **front matter 的内容不要出现在正文编辑里**——新建文章时顶部会先冒出一颗写着 `title` 的芯片，
 * 看着像正文的一部分。属性的查看与修改**只有一个地方**：正文区顶部的属性卡片。
 * 所以这里改成零宽替换：整段一个字都不显示，也没有展开入口（设计 §7）。
 *
 * **代价（自觉接受，见设计 §7）**：正文编辑器里再没有任何查看 / 展开 YAML 的入口。属性卡片
 * 成为唯一入口，而卡片能改自有键与外来键，覆盖面够用。
 *
 * ## 装饰必须挂在 StateField 上，不能挂 ViewPlugin
 *
 * 首版这里用的是 `ViewPlugin.fromClass` + `Decoration.replace`，结果**编辑器一挂载就抛**：
 *
 * ```
 * Uncaught RangeError: Decorations that replace line breaks may not be specified via plugins
 * ```
 *
 * CodeMirror 6 的硬约束：**插件（plugin）只能提供块级（不跨行）的 replace 装饰**；
 * 凡是**跨过行边界**的 `Decoration.replace`，必须由 **StateField** 经
 * `EditorView.decorations.from(field)` 提供。而 front matter 天然跨行（`---` 到收尾
 * `---` 那一整段），所以它只能走 StateField。
 *
 * 这个坑当初没被任何用例挡住：`frontmatter-hide.test.ts` 只测了纯函数，而 jsdom 里 CodeMirror
 * 建不出真的 `EditorView`（要布局 API），于是插件本身**一次都没被真正执行过**。教训是：
 * 纯函数测得再全，也不能代表扩展能挂上。所以现在把装饰的构建单独做成
 * `buildFrontmatterDecorations(text)` 纯函数进 CI，扩展本身仍要人工点验。
 *
 * ## 为什么不「让编辑器只存正文、保存时再贴回 front matter」
 *
 * 那条路有个会丢数据的坑：标签、清单字段、标题都是**菜单动作直接改 md 的**
 * （`features/tasks/actions.ts` 等各自 `readRawBody` 取最新草稿再改）。编辑器若持有
 * 一份自己的 front matter 副本、每次打字回贴，就会把那些刚写进去的改动**抹回去**。
 * 要根治得让所有菜单动作改走宿主，是一次大改。所以这里只动「看得见」这一层：
 * **文档内容一字不改，保存链路完全不经过本模块。**
 *
 * ## 四条配套
 *
 * 1. **判据与 mdcore 的 `splitFences` 逐条一致**：先摘掉开头的 U+FEFF（BOM），再要求第一行
 *    必须是 `---`、必须能闭合；没闭合就不隐藏（用户可能正在写第一行，此时隐藏只是干扰）。
 *    **两处口径必须一起改**——2026-10-11 就漏了 BOM 这一格（见 `frontmatterRange` 的注释）。
 * 2. **光标不许钻进被藏起来的那一段**：否则用户会「明明看不见却能改，改完还找不到」。
 *    选区落进去就顶到隐藏区末尾；已经在该位置就不再派发，避免自激循环。
 * 3. **隐藏区是原子的**（`EditorView.atomicRanges`）：不然在边界上退格会只吃掉围栏、把
 *    `title: …` 裸露到正文里——那是**看不见的编辑**，最难查（与 `live-preview.ts` 同一手法）。
 * 4. **一个字都不显示**：无 widget、无类名，所以也**没有**任何可点元素（设计 §7）。
 */
import { StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet, type ViewUpdate } from "@codemirror/view";

/**
 * front matter 在文档里的区间（`{from, to}`，to 含结尾围栏后的换行）。
 *
 * **判据与 mdcore 的 `splitFences` 逐条对齐**（`packages/mdcore/src/frontmatter.ts` 里那一份），
 * 因为同一个文件会被两处判两次：这里判「藏不藏」，那里判「属性卡片读得到读不到」。
 * 判据一旦不一致，就会出**只有一边知道**的怪状。
 *
 * 【2026-10-11 补 BOM】此前这里第一句是 `text.startsWith("---\n")`，而 `splitFences` 是
 * **先摘掉开头的 U+FEFF 再判**。于是 Windows 上外部工具存的 `.md`（开头带 BOM）会出现：
 * 属性卡片照读不误（mdcore 摘了 BOM），**编辑器却把整段 YAML 露在正文里**——用户看到的是
 * 「yaml 没被识别到」。现在两边都用「摘 BOM → 首行 trim 后必须是 `---`」这一条判据
 * （`frontmatter-hide.test.ts` 里有一条不变式用例把两边钉在一起）。
 *
 * 前导空行**两边都不接受**（front matter 必须紧贴文件开头）：这是 `splitFences` 的既定判据，
 * 这里跟它对齐。若哪天要放宽，必须两处一起改，否则会出现「藏了但读不到」——
 * 那比露出来更糟：属性看不见、还改不了。
 */
export function frontmatterRange(text: string): { from: number; to: number } | null {
  const bom = text.startsWith("\uFEFF") ? 1 : 0;
  const content = bom === 1 ? text.slice(1) : text;
  // 与 `splitFences` 同一句：必须紧贴文件开头，不许前导空行 / 空格
  if (!content.startsWith("---")) return null;

  const lines = content.split("\n");
  // `trim()` 顺带吃掉了 CRLF 的那个 `\r`（编辑器里的文档已被 CodeMirror 归一成 `\n`，
  // 纯函数这一层仍要能吃 CRLF——它同时被别处的用例直接调用）
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return null;

  // BOM 那一格本身不藏（它是零宽字符，藏不藏都看不见），所以起点跳过它、长度按摘掉 BOM 的文本算
  let to = bom;
  for (let index = 0; index <= end; index += 1) to += (lines[index] ?? "").length + 1;
  return { from: bom, to: Math.min(to, text.length) };
}

/**
 * 给当前文本算出「整段零宽替换」的装饰集（**纯函数**，所以能进 CI）。
 *
 * 刻意只依赖字符串、不碰 `EditorView`：jsdom 里建不出真的视图（CM6 要布局 API），
 * 而「藏了哪一段、有没有可点元素」这类事不该只靠肉眼（`live-preview.ts` 同一手法）。
 *
 * `Decoration.replace({})` 没有 widget、也没有类名 → **一个字都不渲染**，
 * 这正是设计 §7 要的「正文里看不到 YAML」。
 */
export function buildFrontmatterDecorations(text: string): DecorationSet {
  const range = frontmatterRange(text);
  if (!range) return Decoration.none;
  return Decoration.set([Decoration.replace({}).range(range.from, range.to)]);
}

/**
 * 装饰**必须**由 StateField 提供（见文件头「装饰必须挂在 StateField 上」）。
 *
 * `tr.newDoc` 而不是 `tr.state.doc`：字段更新时新文档已经算好了，用它省一次拼接。
 */
const frontmatterField = StateField.define<DecorationSet>({
  create: (state) => buildFrontmatterDecorations(state.doc.toString()),
  update(value, tr) {
    // 文档没动 → 复用上一次的装饰集（每次移光标都重建没有意义）
    if (!tr.docChanged) return value;
    return buildFrontmatterDecorations(tr.newDoc.toString());
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * 选区落进隐藏区时把它顶到隐藏区末尾；已经在该位置就不派发（否则自激）。
 *
 * **必须走 `updateListener` 而不是字段的 `update`**：字段更新期间再 dispatch 是不允许的。
 * 即便有 `atomicRanges` 兜着（光标不会主动进去），这里仍然保留：文档在光标底下被外部改写
 * （菜单动作改 md）时，选区可能直接落在隐藏区内部，那条路 `atomicRanges` 管不着。
 */
function keepCursorOut(update: ViewUpdate): void {
  if (!update.docChanged && !update.selectionSet) return;

  const range = frontmatterRange(update.state.doc.toString());
  if (!range) return;

  const { selection } = update.state;
  const inside = selection.ranges.some((one) => one.from < range.to && one.to > range.from);
  if (!inside) return;
  if (selection.main.from === range.to && selection.main.to === range.to) return;

  update.view.dispatch({ selection: { anchor: range.to, head: range.to }, scrollIntoView: false });
}

/** 装到编辑器上的那一个扩展（`Editor.tsx` 把它放进扩展列表） */
export function frontmatterHide(): Extension {
  return [
    frontmatterField,
    /*
      隐藏区当作一个**原子单元**：光标跳过它，边界上的退格 / 删除整段处理。没有这一条，
      在文档开头（或隐藏区末尾）按退格会「吃掉」隐藏区里的一个字符——用户看不到任何变化，
      而 `title: …` 会一点点裸露到正文里（设计 §7 的不变量 3）。
    */
    EditorView.atomicRanges.of((view) => view.state.field(frontmatterField)),
    EditorView.updateListener.of(keepCursorOut),
  ];
}
