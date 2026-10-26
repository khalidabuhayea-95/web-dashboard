/**
 * The on-canvas text editor: a contentEditable box laid over the text layer that shows every
 * styled range (lib/editor/textSpans.ts) in its own font, size, colour, outline and highlight, so
 * any word or part of a text can be selected and styled on its own — Andalusi's "حدد أي كلمة أو
 * جزء من النص، ثم نسقه بصورة مستقلة", Canva's rich text.
 *
 *  • The DOM is the source of truth while typing (the browser handles caret, IME, bidi and
 *    selection); every edit is read back into `text` + spans. Text typed inside a range lands in
 *    that range's element, so it takes the range's style — the model's "inherit the letter before"
 *    rule for free. Line breaks and pastes go through the model (plain text only).
 *  • The selection is reported in text offsets and kept when focus moves to the editor's chrome
 *    (toolbars, panels, popovers): style controls then apply to that range (useTextStyleTarget),
 *    and the range stays painted as selected until the text is clicked again.
 *  • Enter (without Shift) commits, Escape cancels, a click anywhere outside the chrome commits.
 */
import {
  normalizeTextSpans,
  remapTextSpansForEdit,
  resolveTextRunStyle,
  textSpanBaseStyle,
  textSpanRuns,
  textSpansEqual,
  type ResolvedTextRunStyle,
  type TextSpan,
  type TextSpanStyle,
} from "@/lib/editor/textSpans";
import { resolveTextStrokeWidthPx } from "@/lib/editor/textStroke";
import type { EditorElement } from "@/store/editorStore";

const RUN_ATTRIBUTE = "data-text-run";
const FAKE_SELECTION_SHADOW = "inset 0 0 0 9999px rgba(59, 130, 246, 0.28)";

export interface InlineRichTextEditorOptions {
  element: EditorElement;
  /** Screen position of the text box's top-left corner (before rotation). */
  left: number;
  top: number;
  /** Canvas zoom: design px → screen px. */
  scale: number;
  direction: "rtl" | "ltr";
  /** Font family → the CSS family list the canvas draws it with. */
  resolveFamily: (family: string) => string;
  /** Every edit, as the new text and its spans. */
  onChange: (text: string, spans: TextSpan[]) => void;
  /** The selection inside the text, in offsets (collapsed = a caret). */
  onSelectionChange: (start: number, end: number) => void;
  onCommit: (text: string, spans: TextSpan[]) => void;
  onCancel: () => void;
  /** True for a node inside the editor's chrome: focus moving there keeps the editor open. */
  isChromeNode: (node: Node | null) => boolean;
}

export interface InlineRichTextEditor {
  /** Re-renders after the layer changed outside the editor (a style applied from the toolbar). */
  update(element: EditorElement): void;
  /** Closes without committing or cancelling (the caller already did). */
  close(): void;
}

function rgbaOf(color: string, opacity: number) {
  const raw = String(color || "").trim();
  const alpha = Math.max(0, Math.min(1, opacity));
  if (/^#[0-9a-f]{6}$/i.test(raw)) {
    const r = parseInt(raw.slice(1, 3), 16);
    const g = parseInt(raw.slice(3, 5), 16);
    const b = parseInt(raw.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return raw;
}

/** CSS for one run at the canvas zoom. */
function runStyleCss(style: ResolvedTextRunStyle, scale: number, resolveFamily: (family: string) => string) {
  const declarations: string[] = [
    `font-family:${resolveFamily(style.fontFamily)}`,
    `font-size:${style.fontSize * scale}px`,
    `font-weight:${style.fontWeight}`,
    `font-style:${style.fontStyle}`,
    `color:${style.color}`,
    `letter-spacing:${style.letterSpacing * scale}px`,
    `text-decoration-line:${style.textDecoration || "none"}`,
  ];
  const stroke = style.stroke ? resolveTextStrokeWidthPx(style.strokeWidth, style.fontSize) * scale : 0;
  if (stroke > 0) {
    declarations.push(`-webkit-text-stroke:${stroke}px ${style.stroke}`, "paint-order:stroke fill");
  }
  if (style.highlightColor && style.highlightOpacity > 0) {
    const band = rgbaOf(style.highlightColor, style.highlightOpacity);
    declarations.push(
      `background-color:${band}`,
      `box-shadow:0 0 0 ${0.1 * style.fontSize * scale}px ${band}`,
      `border-radius:${0.25 * style.fontSize * scale}px`,
      "-webkit-box-decoration-break:clone",
      "box-decoration-break:clone"
    );
  }
  return declarations.join(";");
}

export function openInlineRichTextEditor(options: InlineRichTextEditorOptions): InlineRichTextEditor {
  let element = options.element;
  let text = String(element.text || "");
  let spans: TextSpan[] = normalizeTextSpans(element.textSpans, text);
  let lastSelection = { start: text.length, end: text.length };
  let runTable: TextSpanStyle[] = [];
  let showingFakeSelection = false;
  let pointerDownInChrome = false;
  let finished = false;

  const root = document.createElement("div");
  root.contentEditable = "true";
  root.spellcheck = false;
  root.setAttribute("data-inline-text-editor", "");
  root.setAttribute("role", "textbox");
  root.setAttribute("aria-multiline", "true");
  root.dir = options.direction;

  const applyBoxStyle = () => {
    const base = textSpanBaseStyle(element);
    const scale = options.scale;
    Object.assign(root.style, {
      position: "absolute",
      left: `${options.left}px`,
      top: `${options.top}px`,
      width: `${Math.max(40, element.width * scale)}px`,
      minHeight: `${Math.max(24, element.height * scale)}px`,
      margin: "0",
      padding: "0",
      border: "none",
      outline: "1px dashed #3b82f6",
      outlineOffset: "2px",
      background: "transparent",
      zIndex: "9999",
      transformOrigin: "left top",
      transform: `rotate(${element.rotation || 0}deg)`,
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      textAlign: element.align,
      direction: options.direction,
      lineHeight: String(element.lineHeight || 1),
      fontFamily: options.resolveFamily(base.fontFamily),
      fontSize: `${base.fontSize * scale}px`,
      fontWeight: base.fontWeight,
      fontStyle: base.fontStyle,
      color: base.color,
      letterSpacing: `${base.letterSpacing * scale}px`,
      caretColor: "#3b82f6",
      cursor: "text",
      userSelect: "text",
    } satisfies Partial<CSSStyleDeclaration>);
  };

  // ── Model ⇄ DOM ────────────────────────────────────────────────────────────────────────────────

  const render = (fakeSelection: { start: number; end: number } | null) => {
    const base = textSpanBaseStyle(element);
    runTable = [];
    const fragment = document.createDocumentFragment();
    const cuts = fakeSelection && fakeSelection.end > fakeSelection.start ? [fakeSelection.start, fakeSelection.end] : [];
    for (const run of textSpanRuns(text, spans)) {
      const edges = [run.start, ...cuts.filter((cut) => cut > run.start && cut < run.end), run.end];
      for (let index = 0; index + 1 < edges.length; index += 1) {
        const from = edges[index];
        const to = edges[index + 1];
        const piece = document.createElement("span");
        piece.setAttribute(RUN_ATTRIBUTE, String(runTable.length));
        runTable.push(run.style);
        piece.style.cssText = runStyleCss(resolveTextRunStyle(base, run.style), options.scale, options.resolveFamily);
        if (fakeSelection && from >= fakeSelection.start && to <= fakeSelection.end && fakeSelection.end > fakeSelection.start) {
          piece.style.boxShadow = FAKE_SELECTION_SHADOW;
          piece.setAttribute("data-fake-selection", "");
        }
        piece.textContent = text.slice(from, to);
        fragment.appendChild(piece);
      }
    }
    root.replaceChildren(fragment);
    showingFakeSelection = Boolean(fakeSelection && fakeSelection.end > fakeSelection.start);
  };

  /** Walks the editor's content in reading order, as text pieces with the run they belong to. */
  const walk = (visit: (piece: { node: Node; text: string; style: TextSpanStyle | null }) => boolean | void) => {
    let produced = "";
    let stop = false;
    const emit = (node: Node, value: string, style: TextSpanStyle | null) => {
      if (stop) return;
      produced += value;
      if (visit({ node, text: value, style }) === true) stop = true;
    };
    const visitNode = (node: Node, style: TextSpanStyle | null) => {
      if (stop) return;
      if (node.nodeType === Node.TEXT_NODE) {
        emit(node, String(node.nodeValue || "").replace(/ /g, " "), style);
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (node.tagName === "BR") {
        // The browser's placeholder <br> in an emptied box is no line break.
        if (node.parentNode === root && node === root.lastChild && (produced === "" || produced.endsWith("\n"))) return;
        emit(node, "\n", style);
        return;
      }
      const runIndex = node.getAttribute(RUN_ATTRIBUTE);
      const ownStyle = runIndex !== null ? (runTable[Number(runIndex)] ?? null) : style;
      const isBlock = node !== root && (node.tagName === "DIV" || node.tagName === "P");
      if (isBlock && produced.length > 0 && !produced.endsWith("\n")) emit(node, "\n", ownStyle);
      node.childNodes.forEach((child) => visitNode(child, ownStyle));
    };
    visitNode(root, null);
  };

  const readDom = () => {
    let value = "";
    const pieces: TextSpan[] = [];
    walk(({ text: piece, style }) => {
      const start = value.length;
      value += piece;
      if (style && piece) pieces.push({ start, end: value.length, ...style });
    });
    return { text: value, spans: normalizeTextSpans(pieces, value) };
  };

  /** Text offset of a DOM position inside the editor. */
  const offsetOf = (container: Node, offset: number) => {
    const point = document.createRange();
    point.setStart(container, offset);
    point.collapse(true);
    let result = 0;
    walk(({ node, text: piece }) => {
      if (node === container) {
        result += Math.min(offset, piece.length);
        return true;
      }
      // Count every piece that starts before the position; stop at the first one that doesn't.
      if (point.comparePoint(node, 0) < 0) {
        result += piece.length;
        return;
      }
      return true;
    });
    return result;
  };

  const domPositionOf = (offset: number): { node: Node; offset: number } => {
    let remaining = Math.max(0, offset);
    let position: { node: Node; offset: number } | null = null;
    let lastText: Node | null = null;
    walk(({ node, text: piece }) => {
      if (node.nodeType === Node.TEXT_NODE) lastText = node;
      if (remaining <= piece.length && node.nodeType === Node.TEXT_NODE) {
        position = { node, offset: remaining };
        return true;
      }
      remaining -= piece.length;
    });
    if (position) return position;
    if (lastText) return { node: lastText, offset: String((lastText as Node).nodeValue || "").length };
    return { node: root, offset: root.childNodes.length };
  };

  const selectionInEditor = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    const a = offsetOf(range.startContainer, range.startOffset);
    const b = offsetOf(range.endContainer, range.endOffset);
    return { start: Math.min(a, b), end: Math.max(a, b) };
  };

  const placeSelection = (start: number, end: number) => {
    const selection = window.getSelection();
    if (!selection) return;
    const from = domPositionOf(start);
    const to = domPositionOf(end);
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const reportSelection = (start: number, end: number) => {
    lastSelection = { start, end };
    options.onSelectionChange(start, end);
  };

  /** Replaces [start, end) with [insert] through the model (line breaks, pastes). */
  const replaceRange = (start: number, end: number, insert: string) => {
    const nextText = `${text.slice(0, start)}${insert}${text.slice(end)}`;
    spans = remapTextSpansForEdit(spans, text, nextText);
    text = nextText;
    render(null);
    const caret = start + insert.length;
    placeSelection(caret, caret);
    reportSelection(caret, caret);
    options.onChange(text, spans);
  };

  const clearFakeSelection = () => {
    if (!showingFakeSelection) return;
    root.querySelectorAll("[data-fake-selection]").forEach((node) => {
      (node as HTMLElement).style.boxShadow = "";
      node.removeAttribute("data-fake-selection");
    });
    showingFakeSelection = false;
  };

  // ── Events ─────────────────────────────────────────────────────────────────────────────────────

  const finish = (commit: boolean) => {
    if (finished) return;
    finished = true;
    if (commit) {
      const read = readDom();
      options.onCommit(read.text, read.spans);
    } else {
      options.onCancel();
    }
    teardown();
  };

  const handleInput = () => {
    const read = readDom();
    if (read.text === text && textSpansEqual(read.spans, spans)) return;
    text = read.text;
    spans = read.spans;
    options.onChange(text, spans);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
      return;
    }
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      if (!event.shiftKey) {
        finish(true);
        return;
      }
      const selection = selectionInEditor() ?? lastSelection;
      replaceRange(selection.start, selection.end, "\n");
    }
  };

  const handlePaste = (event: ClipboardEvent) => {
    event.preventDefault();
    const pasted = String(event.clipboardData?.getData("text/plain") || "").replace(/\r\n?/g, "\n");
    if (!pasted) return;
    const selection = selectionInEditor() ?? lastSelection;
    replaceRange(selection.start, selection.end, pasted);
  };

  const handleSelectionChange = () => {
    const selection = selectionInEditor();
    if (!selection) return;
    if (selection.start === lastSelection.start && selection.end === lastSelection.end) return;
    reportSelection(selection.start, selection.end);
  };

  const handleFocus = () => clearFakeSelection();

  const handleBlur = () => {
    window.setTimeout(() => {
      if (finished) return;
      const active = document.activeElement;
      if (active && root.contains(active)) return;
      if (pointerDownInChrome || options.isChromeNode(active)) {
        // Styling the selection from the toolbar: keep the range visibly selected.
        render(lastSelection);
        return;
      }
      finish(true);
    }, 0);
  };

  const handlePointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    pointerDownInChrome = Boolean(target && !root.contains(target) && options.isChromeNode(target));
  };

  const teardown = () => {
    root.removeEventListener("input", handleInput);
    root.removeEventListener("keydown", handleKeyDown);
    root.removeEventListener("paste", handlePaste);
    root.removeEventListener("blur", handleBlur);
    root.removeEventListener("focus", handleFocus);
    document.removeEventListener("selectionchange", handleSelectionChange);
    document.removeEventListener("pointerdown", handlePointerDown, true);
    root.remove();
  };

  applyBoxStyle();
  render(null);
  document.body.appendChild(root);
  root.addEventListener("input", handleInput);
  root.addEventListener("keydown", handleKeyDown);
  root.addEventListener("paste", handlePaste);
  root.addEventListener("blur", handleBlur);
  root.addEventListener("focus", handleFocus);
  document.addEventListener("selectionchange", handleSelectionChange);
  document.addEventListener("pointerdown", handlePointerDown, true);
  root.focus();
  placeSelection(text.length, text.length);
  reportSelection(text.length, text.length);

  return {
    update(next: EditorElement) {
      if (finished) return;
      const nextText = String(next.text || "");
      const nextSpans = normalizeTextSpans(next.textSpans, nextText);
      const baseChanged =
        next.fontFamily !== element.fontFamily ||
        next.fontSize !== element.fontSize ||
        next.fontWeight !== element.fontWeight ||
        next.fontStyle !== element.fontStyle ||
        (next.color || next.fill) !== (element.color || element.fill) ||
        next.letterSpacing !== element.letterSpacing ||
        next.lineHeight !== element.lineHeight ||
        next.align !== element.align ||
        next.textDecoration !== element.textDecoration ||
        next.stroke !== element.stroke ||
        next.strokeWidth !== element.strokeWidth ||
        next.width !== element.width;
      element = next;
      if (!baseChanged && nextText === text && textSpansEqual(nextSpans, spans)) return;
      text = nextText;
      spans = nextSpans;
      applyBoxStyle();
      const focused = document.activeElement === root || root.contains(document.activeElement);
      if (focused) {
        render(null);
        placeSelection(Math.min(lastSelection.start, text.length), Math.min(lastSelection.end, text.length));
      } else {
        render({ start: Math.min(lastSelection.start, text.length), end: Math.min(lastSelection.end, text.length) });
      }
    },
    close() {
      if (finished) return;
      finished = true;
      teardown();
    },
  };
}
