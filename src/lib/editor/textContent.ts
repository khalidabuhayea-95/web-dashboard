/**
 * Dependency-free text helpers shared by the import routes (server) and the editor store
 * (client). Keep it that way — the import routes must not pull Konva into a server bundle.
 */

/**
 * Drops blank lines hanging off the END of a text layer's content.
 *
 * Konva lays out a trailing empty line as a real line box, so "abc\n" renders as a box one full
 * line taller than the glyphs it shows. That dead space is what the selection overlay draws, and
 * mobile centres the text on the box, so an authoring artefact from an import (Canva and PSD both
 * emit them) reads as padding on the web and as text nudged upward on the app.
 *
 * Trailing only: text is laid out downward from the top of the box, so removing a trailing blank
 * line shrinks the box without moving a single glyph. A LEADING blank line is doing visible work
 * — dropping it would slide the text up — so it is left alone.
 *
 * Whitespace on the last non-empty line is kept: it can carry real width for centred/right
 * alignment, and only whole blank lines are the target here.
 */
export function trimTrailingBlankTextLines(value: unknown): string {
  const text = String(value ?? "");
  if (!text) return text;
  const trimmed = text.replace(/(?:[ \t\u00A0]*(?:\r\n|\r|\n))+[ \t\u00A0]*$/, "");
  // An all-blank text layer has nothing to tighten — don't quietly empty its content.
  return trimmed || text;
}

/** Fabric-ish object types the importers use for text layers. */
const FABRIC_TEXT_TYPES = new Set(["text", "textbox", "i-text"]);

export function isFabricTextObject(object: unknown): boolean {
  if (!object || typeof object !== "object") return false;
  const type = String((object as { type?: unknown }).type || "").toLowerCase();
  return FABRIC_TEXT_TYPES.has(type);
}
