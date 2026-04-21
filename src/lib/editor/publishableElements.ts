import { normalizeHexColor } from "@/lib/editor/colorUtils";
import type { EditorElement, EditorPage } from "@/store/editorStore";

const EXCLUDED_FALLBACK_REASONS = new Set([
  "full-snapshot",
  "text-overlay-background",
  "payload-limit-full-snapshot",
  "backdrop-crop-server",
]);

export type PublishableElementSource = "canva" | "freepik" | "upload" | "editor";

function isGenericElementName(name: string): boolean {
  const normalized = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return /^(image|shape|text)( \d+)?$/.test(normalized);
}

export function getElementArea(element: Pick<EditorElement, "width" | "height" | "scaleX" | "scaleY">): number {
  const width = Math.max(0, Number(element.width || 0) * Math.abs(Number(element.scaleX || 1)));
  const height = Math.max(0, Number(element.height || 0) * Math.abs(Number(element.scaleY || 1)));
  return width * height;
}

export function isBackgroundLikeElement(element: EditorElement, page: Pick<EditorPage, "width" | "height"> | null | undefined): boolean {
  if (!element || element.type !== "image") return true;
  if (element.isBackgroundLayer) return true;

  const reason = String(element.fallbackReason || "").trim().toLowerCase();
  if (reason && EXCLUDED_FALLBACK_REASONS.has(reason)) return true;

  if (!page) return false;

  const scaledWidth = Math.max(0, Number(element.width || 0) * Math.abs(Number(element.scaleX || 1)));
  const scaledHeight = Math.max(0, Number(element.height || 0) * Math.abs(Number(element.scaleY || 1)));
  const pageWidth = Math.max(1, Number(page.width || 1));
  const pageHeight = Math.max(1, Number(page.height || 1));

  if (scaledWidth >= pageWidth * 0.9 && scaledHeight >= pageHeight * 0.9) return true;
  if (scaledWidth * scaledHeight >= pageWidth * pageHeight * 0.8) return true;

  return false;
}

export function getPublishableSkipReason(element: EditorElement, page: Pick<EditorPage, "width" | "height"> | null | undefined): string {
  if (!element) return "missing-element";
  if (element.type !== "image") return "unsupported-type";
  if (!String(element.src || "").trim()) return "missing-source";
  if (isBackgroundLikeElement(element, page)) return "background-like";
  return "";
}

export function isElementPublishable(element: EditorElement, page: Pick<EditorPage, "width" | "height"> | null | undefined): boolean {
  return getPublishableSkipReason(element, page) === "";
}

export function getPublishablePageElements(page: EditorPage | null | undefined): EditorElement[] {
  if (!page || !Array.isArray(page.elements)) return [];
  return page.elements.filter((element) => isElementPublishable(element, page));
}

export function inferPublishSource(element: EditorElement): PublishableElementSource {
  const src = String(element.src || element.rasterOriginalSrc || "").trim().toLowerCase();
  if (/canva\.com|canva\.cn|canva-apps\.com/.test(src) || String(element.importNodeId || "").trim()) {
    return "canva";
  }
  if (/freepik|flaticon/.test(src)) return "freepik";
  if (/r2\.dev|cloudflarestorage|editor-media/.test(src)) return "upload";
  return "editor";
}

export function tokenizeElementName(name: string): string[] {
  if (isGenericElementName(name)) return [];
  return Array.from(
    new Set(
      String(name || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    )
  ).slice(0, 16);
}

export function normalizePaletteForPublish(palette: unknown): string[] {
  if (!Array.isArray(palette)) return [];
  return Array.from(
    new Set(
      palette
        .map((entry) => normalizeHexColor(String(entry || "")))
        .filter((entry): entry is string => Boolean(entry))
    )
  ).slice(0, 16);
}
