"use client";

/**
 * Where a text style control writes: the characters selected in the text being edited on the
 * canvas (a multi-style range, lib/editor/textSpans.ts) or, with no selection, every selected text
 * layer as a whole — Canva's and Andalusi's rule. Controls also read their current value through
 * here, so a selected range shows its own colour/size/weight.
 */
import { useCallback, useMemo } from "react";

import {
  applyTextSpanStyle,
  textSpanBaseStyle,
  textSpanStyleOfRange,
  type TextSpanStyle,
  type TextSpanStyleKey,
} from "@/lib/editor/textSpans";
import { useEditorStore, type EditorElement } from "@/store/editorStore";

/** Layer fields a selected RANGE can take, and the span key each one sets. */
const RANGE_KEYS: Record<string, TextSpanStyleKey> = {
  color: "color",
  fill: "color",
  fontFamily: "fontFamily",
  fontWeight: "fontWeight",
  fontStyle: "fontStyle",
  fontSize: "fontSize",
  letterSpacing: "letterSpacing",
  textDecoration: "textDecoration",
  stroke: "stroke",
  strokeWidth: "strokeWidth",
  highlightColor: "highlightColor",
  highlightOpacity: "highlightOpacity",
};

/** The span patch inside a layer patch, or null when the patch holds nothing a range can take. */
export function textRangePatchOf(patch: Record<string, unknown>): Partial<Record<TextSpanStyleKey, unknown>> | null {
  const result: Partial<Record<TextSpanStyleKey, unknown>> = {};
  let found = false;
  for (const [field, key] of Object.entries(RANGE_KEYS)) {
    if (!(field in patch)) continue;
    result[key] = patch[field];
    found = true;
  }
  return found ? result : null;
}

export interface TextStyleTarget {
  /** The selected range of the edited text, when one is selected (non-empty). */
  range: { elementId: string; start: number; end: number } | null;
  /** The overrides the whole range shares (absent keys = mixed or the layer's own). */
  rangeStyle: TextSpanStyle | null;
  /** Applies [patch] to the selected range, or to every selected layer when none is selected. */
  applyTextStyle: (patch: Partial<EditorElement> & Record<string, unknown>, options?: { recordHistory?: boolean }) => void;
}

export function useTextStyleTarget(): TextStyleTarget {
  const selection = useEditorStore((state) => state.textRangeSelection);
  const element = useEditorStore((state) => {
    const target = state.textRangeSelection;
    if (!target) return null;
    for (const page of state.pages) {
      const found = page.elements.find((item) => item.id === target.elementId);
      if (found) return found;
    }
    return null;
  });
  const updateElement = useEditorStore((state) => state.updateElement);
  const updateSelectedElements = useEditorStore((state) => state.updateSelectedElements);

  const range = useMemo(() => {
    if (!selection || !element || element.type !== "text") return null;
    const length = String(element.text || "").length;
    const start = Math.max(0, Math.min(length, selection.start));
    const end = Math.max(0, Math.min(length, selection.end));
    // All of it selected is the whole layer: style the layer, not one span over everything.
    if (start === 0 && end === length) return null;
    return end > start ? { elementId: element.id, start, end } : null;
  }, [element, selection]);

  const rangeStyle = useMemo(
    () => (range && element ? textSpanStyleOfRange(element.textSpans, element.text, range.start, range.end) : null),
    [element, range]
  );

  const applyTextStyle = useCallback<TextStyleTarget["applyTextStyle"]>(
    (patch, options) => {
      if (range && element) {
        const rangePatch = textRangePatchOf(patch);
        if (rangePatch) {
          const textSpans = applyTextSpanStyle(
            element.textSpans,
            element.text,
            range.start,
            range.end,
            rangePatch,
            textSpanBaseStyle(element)
          );
          updateElement(element.id, { textSpans }, options);
          return;
        }
      }
      updateSelectedElements(patch, options);
    },
    [element, range, updateElement, updateSelectedElements]
  );

  return { range, rangeStyle, applyTextStyle };
}
