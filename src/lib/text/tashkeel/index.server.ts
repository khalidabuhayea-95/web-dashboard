// Arabic diacritization (التشكيل), in process with ichkil: an ONNX model on the app server's own
// CPU, a few milliseconds per text, nothing else to host. See ichkil.server.ts.
//
// Text in, the same text with harakat restored. The model only ADDS marks and must never
// rewrite words, so this layer refuses any result whose letters changed.

import { ICHKIL_MODEL_ID, ichkilDiacritize } from "@/lib/text/tashkeel/ichkil.server";

export const TASHKEEL_MAX_CHARS = 600;

// Every mark a diacritizer may remove or add: harakat, tanween, shadda, sukun, dagger alif, Quranic
// annotation signs and tatweel (the same set ichkil strips before predicting).
const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

export class TashkeelError extends Error {
  status: number;
  code: string;

  constructor(message: string, { status = 500, code = "tashkeel_failed" } = {}) {
    super(message);
    this.name = "TashkeelError";
    this.status = status;
    this.code = code;
  }
}

export function stripArabicDiacritics(value: string): string {
  return String(value || "").replace(DIACRITICS, "");
}

/** Normalizes and validates the text the client sent. */
export function normalizeTashkeelInput(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new TashkeelError("Text is required.", { status: 400, code: "missing_text" });
  }
  if (text.length > TASHKEEL_MAX_CHARS) {
    throw new TashkeelError(
      `Text is too long (${text.length} characters, max ${TASHKEEL_MAX_CHARS}).`,
      { status: 400, code: "text_too_long" }
    );
  }
  if (!/[ء-ي]/.test(text)) {
    throw new TashkeelError("Text has no Arabic letters to diacritize.", {
      status: 400,
      code: "not_arabic",
    });
  }
  return text;
}

function lettersOf(value: string): string {
  return stripArabicDiacritics(value).normalize("NFC").replace(/\s+/g, "");
}

/** Refuses a result whose letters differ from the input: altered words must never reach a design. */
function assertLettersKept(input: string, result: string) {
  if (lettersOf(result) !== lettersOf(input)) {
    throw new TashkeelError("Diacritization changed the words; result rejected.", {
      status: 502,
      code: "letters_changed",
    });
  }
}

export async function diacritizeArabicText(text: string) {
  const startedAt = Date.now();
  const result = await ichkilDiacritize(text).catch((error) => {
    throw new TashkeelError(error instanceof Error ? error.message : "Diacritization failed.", {
      status: 503,
      code: "provider_unavailable",
    });
  });
  if (!result.trim()) {
    throw new TashkeelError("Diacritization returned no text.", { status: 502 });
  }
  assertLettersKept(text, result);
  return { text: result, model: ICHKIL_MODEL_ID, provider: "local", durationMs: Date.now() - startedAt };
}
