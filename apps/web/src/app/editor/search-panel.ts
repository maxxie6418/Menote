/**
 * 查找/替换的**面板 UI**（编辑器专项优化 P3）。
 *
 * **移植自 shuaiplus/inkstone `src/client/editor/search.ts` 的 `NoteSearchPanel`
 * （LGPL-3.0，本项目已整体转 LGPL-3.0-only）**，改造点：i18n 换中文文案（MeNote 无多语言）、
 * 去掉语言订阅（文案静态）、类名 `ink-note-search` → `cm-note-search`、样式走 `app.css` 令牌。
 *
 * 查询引擎仍是 `@codemirror/search` 的（`SearchQuery` / `replaceAll` / `replaceNext`），
 * 这里只做壳：查找/替换两档、大小写/全字/正则/转义/选区范围五个开关、结果列表（前 100 条）、
 * 替换与撤销、可拖拽缩放、输入法安全的键盘处理（组合期间不抢键）。
 */
import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import { isolateHistory, undo } from "@codemirror/commands";
import {
  SearchQuery,
  closeSearchPanel,
  getSearchQuery,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from "@codemirror/search";
import { searchOptions, setOptions, withinScope, type SearchRange } from "./search-state";

export interface Match extends SearchRange {
  /** `false` = 含正则组引用等不可直接替换的匹配 */
  precise: boolean;
}

export const searchPanels = new WeakMap<EditorView, NoteSearchPanel>();
const minimumPanelSize = { width: 320, height: 220 };
const panelSizes = new WeakMap<EditorView, { width: string; height: string }>();

export const createNoteSearchPanel = (view: EditorView) => new NoteSearchPanel(view);

export class NoteSearchPanel implements Panel {
  readonly dom = document.createElement("section");
  readonly top = true;
  private readonly searchField = this.field("search", "查找");
  private readonly replaceField = this.field("replace", "替换为");
  private readonly findTab = this.button("find-tab", "查找", () => this.setMode("find"));
  private readonly replaceTab = this.button("replace-tab", "替换", () => this.setMode("replace"));
  private readonly previous = this.button("previous", "上一处", () => this.navigate(-1), "up");
  private readonly next = this.button("next", "下一处", () => this.navigate(1), "down");
  private readonly replaceButton = this.button("replace", "替换", () => this.replace(false));
  private readonly replaceAllButton = this.button("replace-all", "全部替换", () => this.replace(true));
  private readonly undoButton = this.button("undo-replace", "撤销替换", () => {
    if (undo(this.view)) {
      this.feedback.textContent = "已撤销替换";
      this.undoButton.hidden = true;
    }
  });
  private readonly close = this.button("close", "关闭", () => closeSearchPanel(this.view), "close");
  private readonly resizeHandle = this.button("resize", "调整大小", () => {}, "resize");
  private readonly count = document.createElement("span");
  private readonly feedback = document.createElement("span");
  private readonly context = document.createElement("span");
  private readonly options = document.createElement("div");
  private readonly replaceRow = document.createElement("div");
  private readonly results = document.createElement("details");
  private readonly resultsTitle = document.createElement("summary");
  private readonly resultsList = document.createElement("div");
  private readonly resultsLimit = document.createElement("p");
  private readonly caseField = this.checkbox("case", "区分大小写");
  private readonly wordField = this.checkbox("word", "全字匹配");
  private readonly regexpField = this.checkbox("regexp", "正则表达式");
  private readonly escapesField = this.checkbox("escapes", "转义字符");
  private readonly scopeField = this.checkbox("selection", "仅在选区内");
  private query: SearchQuery;
  private matches: Match[] = [];
  private resultButtons: HTMLButtonElement[] = [];
  private resizeCleanup?: () => void;
  private resizeObserver?: ResizeObserver;
  private composing = false;

  constructor(private readonly view: EditorView) {
    searchPanels.set(view, this);
    this.query = getSearchQuery(view.state);
    this.dom.className = "cm-note-search";
    this.dom.style.setProperty("--note-search-min-width", `${minimumPanelSize.width}px`);
    this.dom.style.setProperty("--note-search-min-height", `${minimumPanelSize.height}px`);
    const size = panelSizes.get(view);
    if (size) {
      this.dom.style.width = size.width;
      this.dom.style.height = size.height;
    }
    this.dom.setAttribute("aria-label", "在本篇内查找与替换");
    this.dom.addEventListener("keydown", (event) => this.keydown(event));
    const header = document.createElement("div");
    header.className = "cm-note-search-header";
    const tabs = document.createElement("div");
    tabs.className = "cm-note-search-tabs";
    for (const tab of [this.findTab, this.replaceTab]) tab.setAttribute("aria-pressed", "false");
    tabs.append(this.findTab, this.replaceTab);
    this.context.className = "cm-note-search-context";
    header.append(tabs, this.context, this.close);
    const findRow = document.createElement("div");
    findRow.className = "cm-note-search-row";
    const navigation = document.createElement("div");
    navigation.className = "cm-note-search-navigation";
    this.count.className = "cm-note-search-count";
    navigation.append(this.count, this.previous, this.next);
    findRow.append(this.searchField, navigation);
    this.replaceRow.className = "cm-note-search-row";
    const actions = document.createElement("div");
    actions.className = "cm-note-search-actions";
    this.replaceAllButton.classList.add("cm-note-search-primary");
    actions.append(this.replaceButton, this.replaceAllButton);
    this.replaceRow.append(this.replaceField, actions);
    this.options.className = "cm-note-search-options";
    this.options.append(
      ...[this.caseField, this.wordField, this.regexpField, this.escapesField, this.scopeField].map(
        (field) => field.parentElement!,
      ),
    );
    const status = document.createElement("div");
    status.className = "cm-note-search-status";
    this.feedback.setAttribute("role", "status");
    this.feedback.setAttribute("aria-live", "polite");
    this.feedback.setAttribute("aria-atomic", "true");
    this.undoButton.hidden = true;
    status.append(this.feedback, this.undoButton);
    this.results.className = "cm-note-search-results";
    this.results.open = true;
    this.resultsList.className = "cm-note-search-result-list";
    this.resultsList.setAttribute("role", "group");
    this.resultsLimit.className = "cm-note-search-result-limit";
    this.results.append(this.resultsTitle, this.resultsList, this.resultsLimit);
    const body = document.createElement("div");
    body.className = "cm-note-search-body";
    body.append(header, findRow, this.replaceRow, this.options, status, this.results);
    this.resizeHandle.className = "cm-note-search-resize";
    this.resizeHandle.addEventListener("pointerdown", (event) => this.startResize(event));
    this.resizeHandle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const size = this.currentSize();
      const step = event.shiftKey ? 40 : 10;
      this.applySize(
        size.width + (event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0),
        size.height + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
      );
    });
    this.dom.append(body, this.resizeHandle);
    this.replaceField.addEventListener("input", () => this.commit(false));
    this.searchField.addEventListener("compositionstart", () => {
      this.composing = true;
    });
    this.searchField.addEventListener("compositionend", () => {
      this.composing = false;
      this.commit(true);
    });
    this.searchField.addEventListener("input", () => {
      if (!this.composing) this.commit(true);
    });
    this.scopeField.addEventListener("change", () => {
      const options = view.state.field(searchOptions);
      const selection = view.state.selection.main;
      const candidate = selection.empty ? options.candidate : { from: selection.from, to: selection.to };
      view.dispatch({
        effects: [
          setOptions.of({ scope: this.scopeField.checked ? (options.candidate ?? candidate) : null }),
          setSearchQuery.of(new SearchQuery({ ...this.query, test: withinScope })),
        ],
      });
      this.selectFirst();
    });
    this.syncFields();
    this.refresh(true);
  }

  mount() {
    this.syncSize();
    this.resizeObserver = new ResizeObserver(() => this.syncSize());
    this.resizeObserver.observe(this.view.dom);
    this.resizeObserver.observe(this.dom);
    this.searchField.focus();
    this.searchField.select();
    queueMicrotask(() => {
      if (this.dom.isConnected && this.query.valid) this.selectFirst();
    });
  }

  destroy() {
    this.resizeCleanup?.();
    this.syncSize();
    this.resizeObserver?.disconnect();
    if (searchPanels.get(this.view) === this) searchPanels.delete(this.view);
  }

  private currentSize() {
    const bounds = this.dom.getBoundingClientRect();
    return {
      width: bounds.width || parseFloat(this.dom.style.width) || minimumPanelSize.width,
      height: bounds.height || parseFloat(this.dom.style.height) || minimumPanelSize.height,
    };
  }

  private applySize(width: number, height: number) {
    const target = this.view.dom.ownerDocument.defaultView ?? window;
    const maxWidth = Math.max(1, (this.view.dom.clientWidth || target.innerWidth) - 24);
    const maxHeight = Math.max(1, (this.view.dom.clientHeight || target.innerHeight) - 24);
    this.dom.style.width = `${Math.min(maxWidth, Math.max(Math.min(minimumPanelSize.width, maxWidth), width))}px`;
    this.dom.style.height = `${Math.min(maxHeight, Math.max(Math.min(minimumPanelSize.height, maxHeight), height))}px`;
    this.syncSize();
  }

  private startResize(event: PointerEvent) {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    this.resizeCleanup?.();
    const size = this.currentSize();
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const target = this.view.dom.ownerDocument.defaultView ?? window;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      this.applySize(size.width + startX - next.clientX, size.height + next.clientY - startY);
    };
    const finish = (next: PointerEvent) => {
      if (next.pointerId === pointerId) this.resizeCleanup?.();
    };
    this.resizeCleanup = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
      this.resizeHandle.removeEventListener("lostpointercapture", finish);
      if (this.resizeHandle.hasPointerCapture?.(pointerId)) this.resizeHandle.releasePointerCapture(pointerId);
      this.dom.classList.remove("is-resizing");
      this.resizeCleanup = undefined;
      this.syncSize();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
    this.resizeHandle.addEventListener("lostpointercapture", finish);
    this.resizeHandle.setPointerCapture?.(pointerId);
    this.dom.classList.add("is-resizing");
  }

  private syncSize() {
    const height = this.view.dom.clientHeight;
    if (height > 24) this.dom.style.setProperty("--note-search-max-height", `${height - 24}px`);
    const { width, height: panelHeight } = this.dom.style;
    if (width || panelHeight) panelSizes.set(this.view, { width, height: panelHeight });
  }

  update(update: ViewUpdate) {
    const query = getSearchQuery(update.state);
    const optionsChanged = update.state.field(searchOptions) !== update.startState.field(searchOptions);
    const queryChanged = !query.eq(this.query) || query.literal !== this.query.literal;
    this.query = query;
    if (queryChanged) this.syncFields();
    if (update.docChanged && !update.transactions.some((tr) => tr.isUserEvent("input.replace")))
      this.undoButton.hidden = true;
    if (queryChanged || optionsChanged || update.docChanged) this.refresh(true);
    else if (update.selectionSet) this.refresh(false);
  }

  private field(name: string, placeholder: string): HTMLTextAreaElement {
    const field = document.createElement("textarea");
    field.name = name;
    field.rows = 1;
    field.spellcheck = false;
    field.autocomplete = "off";
    field.placeholder = placeholder;
    field.setAttribute("aria-label", placeholder);
    if (name === "search") field.setAttribute("main-field", "true");
    return field;
  }

  private button(
    name: string,
    label: string,
    action: () => void,
    icon?: "up" | "down" | "close" | "resize",
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.name = name;
    button.addEventListener("click", action);
    if (icon) {
      button.title = label;
      button.setAttribute("aria-label", label);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute(
        "d",
        icon === "up"
          ? "m6 15 6-6 6 6"
          : icon === "down"
            ? "m6 9 6 6 6-6"
            : icon === "resize"
              ? "M4 9 15 20M4 14l6 6M4 19l1 1"
              : "m6 6 12 12M6 18 18 6",
      );
      svg.append(path);
      button.append(svg);
    } else button.textContent = label;
    return button;
  }

  private checkbox(name: string, label: string): HTMLInputElement {
    const labelEl = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    input.addEventListener("change", () => {
      if (name !== "selection") this.commit(true);
    });
    const text = document.createElement("span");
    text.textContent = label;
    labelEl.append(input, text);
    labelEl.title = label;
    return input;
  }

  private setMode(mode: "find" | "replace") {
    this.view.dispatch({ effects: setOptions.of({ mode }) });
    this.searchField.focus();
    this.searchField.select();
  }

  private syncFields() {
    if (this.searchField.value !== this.query.search) this.searchField.value = this.query.search;
    if (this.replaceField.value !== this.query.replace) this.replaceField.value = this.query.replace;
    this.caseField.checked = this.query.caseSensitive;
    this.wordField.checked = this.query.wholeWord;
    this.regexpField.checked = this.query.regexp;
    this.escapesField.checked = !this.query.literal;
  }

  private commit(navigate: boolean) {
    this.feedback.textContent = "";
    this.undoButton.hidden = true;
    this.view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: this.searchField.value,
          replace: this.replaceField.value,
          caseSensitive: this.caseField.checked,
          wholeWord: this.wordField.checked,
          regexp: this.regexpField.checked,
          literal: !this.escapesField.checked,
          test: withinScope,
        }),
      ),
    });
    if (navigate) this.selectFirst();
  }

  private selectFirst() {
    if (!this.matches.length) return;
    const selection = this.view.state.selection.main;
    const match = this.matches.find((item) => item.from >= selection.from) ?? this.matches[0];
    if (match) this.selectMatch(match);
  }

  private selectMatch(match: SearchRange) {
    this.view.dispatch({
      selection: EditorSelection.single(match.from, match.to),
      effects: EditorView.scrollIntoView(match.from, { y: "center" }),
      userEvent: "select.search",
    });
  }

  navigate(direction: number) {
    if (!this.matches.length) return;
    const selection = this.view.state.selection.main;
    const current = this.matches.findIndex((match) => match.from === selection.from && match.to === selection.to);
    const wrapped = direction > 0 ? current === this.matches.length - 1 : current === 0;
    const next =
      current >= 0
        ? (current + direction + this.matches.length) % this.matches.length
        : direction > 0
          ? this.matches.findIndex((match) => match.from >= selection.to)
          : this.matches.findLastIndex((match) => match.to <= selection.from);
    const target = this.matches[next < 0 ? (direction > 0 ? 0 : this.matches.length - 1) : next];
    if (target) this.selectMatch(target);
    this.feedback.textContent = wrapped ? (direction > 0 ? "已到结尾，从头继续" : "已到开头，从尾继续") : "";
  }

  private replace(all: boolean) {
    if (!this.query.valid || this.view.state.readOnly || !this.matches.length) return;
    const selection = this.view.state.selection.main;
    const current = this.matches.find((match) => match.from === selection.from && match.to === selection.to);
    if (!all && !current) {
      this.selectFirst();
      return;
    }
    // 含正则组引用的匹配不能替换（结果依赖原文本，盲目替换会写错内容）
    const count = all ? this.matches.filter((match) => match.precise).length : current?.precise ? 1 : 0;
    if (!count) {
      this.feedback.textContent = "有匹配无法直接替换（含正则引用），请调整表达式";
      return;
    }
    const before = this.view.state.doc;
    // 替换在撤销历史里独立成段：一次「撤销替换」恰好撤掉这一轮
    this.view.dispatch({ annotations: isolateHistory.of("before") });
    (all ? replaceAll : replaceNext)(this.view);
    if (!all && current && current.from === current.to && this.matches.length) {
      const replacedEnd = current.from + this.view.state.doc.length - before.length;
      const next = this.matches.find((match) => match.from > replacedEnd) ?? this.matches[0];
      if (next) this.selectMatch(next);
    }
    this.view.dispatch({ annotations: isolateHistory.of("after") });
    if (this.view.state.doc !== before) {
      this.feedback.textContent = `已替换 ${count} 处`;
      this.undoButton.hidden = false;
    }
  }

  private refresh(rebuild: boolean) {
    const options = this.view.state.field(searchOptions);
    const replacing = options.mode === "replace";
    this.dom.dataset.mode = options.mode;
    this.replaceRow.hidden = !replacing;
    this.findTab.setAttribute("aria-pressed", String(!replacing));
    this.replaceTab.setAttribute("aria-pressed", String(replacing));
    this.context.textContent = options.scope ? "范围：选区" : "范围：全篇";
    this.scopeField.checked = options.scope !== null;
    this.scopeField.disabled = !options.scope && !options.candidate && this.view.state.selection.main.empty;
    this.scopeField.parentElement!.title = "只在打开面板时选中的文字范围内查找";
    this.escapesField.disabled = this.query.regexp;
    const invalid = !!this.query.search && !this.query.valid;
    this.searchField.setAttribute("aria-invalid", String(invalid));
    this.replaceField.disabled = this.view.state.readOnly;
    this.replaceTab.disabled = this.view.state.readOnly;
    if (rebuild) {
      this.matches = [];
      if (this.query.valid) {
        const cursor = this.query.getCursor(this.view.state);
        for (let item = cursor.next(); !item.done; item = cursor.next()) {
          const value = item.value as SearchRange & { precise?: boolean };
          this.matches.push({ from: value.from, to: value.to, precise: value.precise !== false });
        }
      }
      this.renderResults();
      this.feedback.textContent = invalid
        ? "正则表达式无效"
        : !this.query.search
          ? "输入以开始查找"
          : !this.matches.length
            ? "没有匹配"
            : "";
    }
    const selection = this.view.state.selection.main;
    const index = this.matches.findIndex((match) => match.from === selection.from && match.to === selection.to);
    this.count.textContent = this.matches.length ? `${index + 1}/${this.matches.length}` : "";
    this.count.setAttribute("aria-label", `共 ${this.matches.length} 处匹配`);
    this.previous.disabled = this.next.disabled = !this.matches.length;
    this.replaceButton.disabled =
      this.replaceAllButton.disabled = this.view.state.readOnly || !this.matches.some((match) => match.precise);
    this.results.hidden = !this.matches.length;
    this.resultsTitle.textContent = `共 ${this.matches.length} 处`;
    this.resultsList.setAttribute("aria-label", "查找结果");
    for (let i = 0; i < this.resultButtons.length; i += 1) {
      const button = this.resultButtons[i];
      if (!button) continue;
      button.setAttribute("aria-current", String(i === index));
    }
    if (!rebuild && this.results.open && index >= 0 && index < this.resultButtons.length) {
      const button = this.resultButtons[index];
      if (button && typeof button.scrollIntoView === "function") button.scrollIntoView({ block: "nearest" });
    }
  }

  private renderResults() {
    const fragment = document.createDocumentFragment();
    this.resultButtons = this.matches.slice(0, 100).map((match) => {
      const line = this.view.state.doc.lineAt(match.from);
      const start = Math.max(line.from, match.from - 35);
      const end = Math.min(this.view.state.doc.length, Math.max(match.to, Math.min(line.to, match.to + 65)));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-note-search-result";
      button.addEventListener("click", () => this.selectMatch(match));
      const lineNumber = document.createElement("span");
      lineNumber.className = "cm-note-search-line";
      lineNumber.textContent = String(line.number);
      const snippet = document.createElement("span");
      snippet.className = "cm-note-search-snippet";
      const marked = document.createElement("mark");
      marked.textContent = this.view.state.sliceDoc(match.from, Math.min(match.to, match.from + 120)) || "（空匹配）";
      snippet.append(
        (start > line.from ? "…" : "") + this.view.state.sliceDoc(start, match.from),
        marked,
        this.view.state.sliceDoc(match.to, Math.min(end, match.to + 65)) + (end < line.to ? "…" : ""),
      );
      button.setAttribute("aria-label", `第 ${line.number} 行：` + snippet.textContent);
      button.append(lineNumber, snippet);
      fragment.append(button);
      return button;
    });
    this.resultsList.replaceChildren(fragment);
    this.resultsLimit.hidden = this.matches.length <= 100;
    this.resultsLimit.textContent = "仅显示前 100 条";
  }

  private keydown(event: KeyboardEvent) {
    if (event.isComposing || this.composing || event.keyCode === 229) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    let handled = true;
    if (mod && !event.altKey && (key === "f" || key === "h")) this.setMode(key === "h" ? "replace" : "find");
    else if (key === "escape") closeSearchPanel(this.view);
    else if (key === "f3" || (mod && key === "g")) this.navigate(event.shiftKey ? -1 : 1);
    else if (key === "enter" && (event.target === this.searchField || event.target === this.replaceField)) {
      if (event.target === this.replaceField && !event.shiftKey) this.replace(false);
      else this.navigate(event.shiftKey ? -1 : 1);
    } else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
}

/** 给 `EditorState` 之外的地方（如测试）读当前查询用的窄接口 */
export type { EditorState };
