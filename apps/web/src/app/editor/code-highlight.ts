/**
 * 代码块语言高亮（编辑器专项优化 P2-2，蓝本：inkstone `enhance.ts` 的 Prism 路线；
 * 即时渲染设计 §七-5 销账）。
 *
 * **两个消费方，一份实现**：
 * - 即时渲染：`highlightSpans()` 给出 **token 区间**，插件层把它们变成 mark 装饰
 *   （代码内容行原地上色，围栏保持源码可见——§八 的既定取舍不动）；
 * - 预览：`highlightToHtml()` 给出**带 span 的 HTML**，`MarkdownPreview` 渲染后补色。
 *   两边产出同一批类名（`tok-*`），配色在 `app.css` 写一份（全走现有令牌，零新色值）。
 *
 * **体积纪律**：Prism 核心 + 语言组件全部**动态 `import()`**——首屏一个字节都不付，
 * 只有正文里真的出现代码块才拉。语言按「内容里的 info string」按需加载，
 * 没实现的语言返回 `null`（调用方保持无高亮的纯文本，不报错）。
 *
 * **Prism 组件的全局依赖**：语言组件文件引用裸的 `Prism` 全局变量，
 * ESM 下必须先把核心挂到 `globalThis.Prism` 再 import 组件（Vite 下的已知坑）。
 */
/** Prism token 的最小结构面（不依赖 @types 的内部路径） */
interface PrismToken {
  type: string;
  content: string | PrismToken[];
  length: number;
}

/** 一个 token 区间：相对代码文本起点的偏移（不含围栏行） */
export interface TokenSpan {
  start: number;
  end: number;
  /** CSS 类名（`tok-keyword` 这类），配色在 `app.css` 的令牌规则里 */
  cls: string;
}

/** info string → Prism 语言名；不在表里的语言不做高亮（保持纯文本） */
const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  json: "json",
  jsonc: "json",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  python: "python",
  py: "python",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  markdown: "markdown",
  md: "markdown",
  html: "markup",
  xml: "markup",
  svg: "markup",
  css: "css",
  java: "java",
  go: "go",
  golang: "go",
  rust: "rust",
  rs: "rust",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  csharp: "csharp",
  cs: "csharp",
  diff: "diff",
  toml: "toml",
  dockerfile: "dockerfile",
  docker: "dockerfile",
};

type PrismModule = {
  languages: Record<string, unknown>;
  tokenize: (text: string, grammar: unknown) => Array<string | PrismToken>;
};

let corePromise: Promise<PrismModule | null> | null = null;

async function loadCore(): Promise<PrismModule | null> {
  corePromise ??= (async () => {
    try {
      const core = (await import("prismjs")).default as unknown as PrismModule;
      const holder = globalThis as { Prism?: unknown };
      if (!holder.Prism) holder.Prism = core;
      return core;
    } catch {
      return null;
    }
  })();
  return corePromise;
}

/*
  语言组件的加载器：**逐个静态字面量**（Vite 才能静态分析、按需分包）。
  依赖顺序按 Prism 的要求排：tsx 依赖 jsx 与 typescript，cpp 依赖 c，markdown 依赖 markup（核心自带）。
  核心自带 markup / css / clike / javascript，这四个不用加载。
*/
const GRAMMAR_LOADERS: Record<string, () => Promise<unknown>> = {
  typescript: () => import("prismjs/components/prism-typescript"),
  jsx: () => import("prismjs/components/prism-jsx"),
  tsx: async () => {
    await GRAMMAR_LOADERS.jsx?.();
    await GRAMMAR_LOADERS.typescript?.();
    return import("prismjs/components/prism-tsx");
  },
  json: () => import("prismjs/components/prism-json"),
  bash: () => import("prismjs/components/prism-bash"),
  python: () => import("prismjs/components/prism-python"),
  yaml: () => import("prismjs/components/prism-yaml"),
  sql: () => import("prismjs/components/prism-sql"),
  markdown: () => import("prismjs/components/prism-markdown"),
  go: () => import("prismjs/components/prism-go"),
  rust: () => import("prismjs/components/prism-rust"),
  java: () => import("prismjs/components/prism-java"),
  c: () => import("prismjs/components/prism-c"),
  cpp: async () => {
    await GRAMMAR_LOADERS.c?.();
    return import("prismjs/components/prism-cpp");
  },
  csharp: () => import("prismjs/components/prism-csharp"),
  diff: () => import("prismjs/components/prism-diff"),
  toml: () => import("prismjs/components/prism-toml"),
  dockerfile: () => import("prismjs/components/prism-docker"),
};

const loadedGrammars = new Set<string>();
const failedGrammars = new Set<string>();

async function grammarFor(language: string): Promise<unknown | null> {
  const prism = await loadCore();
  if (!prism) return null;
  const lang = LANG_ALIASES[language.toLowerCase()] ?? "";
  if (!lang) return null;
  if (prism.languages[lang]) return prism.languages[lang];
  if (failedGrammars.has(lang)) return null;
  try {
    const loader = GRAMMAR_LOADERS[lang];
    if (!loader) {
      failedGrammars.add(lang);
      return null;
    }
    await loader();
    loadedGrammars.add(lang);
  } catch {
    failedGrammars.add(lang);
    return null;
  }
  return prism.languages[lang] ?? null;
}

/** 把 Prism 的嵌套 token 流摊平成区间（外层类型优先；内容里的子 token 单独成段） */
function flatten(
  tokens: Array<string | PrismToken>,
  start: number,
  out: TokenSpan[],
): void {
  let cursor = start;
  for (const token of tokens) {
    if (typeof token === "string") {
      cursor += token.length;
      continue;
    }
    const end = cursor + token.length;
    out.push({ start: cursor, end, cls: `tok-${token.type}` });
    if (Array.isArray(token.content)) flatten(token.content, cursor, out);
    cursor = end;
  }
}

/** 高亮结果的缓存（内容 → 区间）：同一段代码重复滚回视口不再重算 */
const spanCache = new Map<string, TokenSpan[]>();
const CACHE_LIMIT = 40;

/** 把 `key → value` 重新写回 Map 尾部，超限清最旧的一批（LRU 的最简形态） */
function remember<V>(cache: Map<string, V>, key: string, value: V): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/**
 * 高亮一段代码，返回 **token 区间**（即时渲染用）。
 * 语言不支持 / Prism 加载失败 / 内容为空时返回 `null`——调用方保持纯文本，不当作错误。
 */
export async function highlightSpans(
  code: string,
  language: string,
): Promise<TokenSpan[] | null> {
  const trimmed = language.trim();
  if (trimmed === "" || code.trim() === "") return null;
  const key = `${LANG_ALIASES[trimmed.toLowerCase()] ?? trimmed.toLowerCase()}\u0000${code}`;
  const cached = spanCache.get(key);
  if (cached) return cached;

  const prism = await loadCore();
  if (!prism) return null;
  const grammar = await grammarFor(trimmed);
  if (!grammar) return null;

  const tokens = prism.tokenize(code, grammar);
  const spans: TokenSpan[] = [];
  flatten(tokens, 0, spans);
  remember(spanCache, key, spans);
  return spans;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 高亮一段代码，返回**带 `tok-*` span 的 HTML**（预览用；转义齐全，可安全 `innerHTML`）。
 * 语言不支持 / 加载失败时返回 `null`。
 */
export async function highlightToHtml(code: string, language: string): Promise<string | null> {
  const spans = await highlightSpans(code, language);
  if (spans === null) return null;
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    out += escapeHtml(code.slice(cursor, span.start));
    if (span.end > span.start) {
      out += `<span class="${span.cls}">${escapeHtml(code.slice(span.start, span.end))}</span>`;
      cursor = span.end;
    }
  }
  out += escapeHtml(code.slice(cursor));
  return out;
}
