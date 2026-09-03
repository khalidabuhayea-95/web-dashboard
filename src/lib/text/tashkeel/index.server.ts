// Arabic diacritization (التشكيل) on our own worker.
//
// Text in, the same text with harakat restored — the model only ADDS marks, it
// must never rewrite words, so the worker reports whether the letters survived
// and this layer refuses the result when they didn't.

import {
  isSelfhostConfigured,
  selfhostRunSync,
} from "@/lib/media/selfhost/client.server";

export const TASHKEEL_MAX_CHARS = 600;

const DIACRITICS = /[ً-ْٰٓ-ٕـ]/g;

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

export async function diacritizeArabicText(text: string) {
  if (!isSelfhostConfigured()) {
    throw new TashkeelError("Diacritization is not configured (set SELFHOST_AI_URL).", {
      status: 503,
      code: "provider_unavailable",
    });
  }

  const output = await selfhostRunSync({ op: "tashkeel", text }, { timeoutMs: 60_000 }).catch(
    (error) => {
      throw new TashkeelError(
        error instanceof Error ? error.message : "Diacritization failed.",
        { status: 502, code: "provider_failed" }
      );
    }
  );

  const result = String(output.text || "").trim();
  if (!result) {
    throw new TashkeelError("Diacritization returned no text.", { status: 502 });
  }
  // The model is generative: a bad sample can paraphrase instead of marking up.
  // Returning altered words into someone's design would be worse than doing
  // nothing, so that result is refused rather than shown.
  if (stripArabicDiacritics(result).replace(/\s+/g, "") !== stripArabicDiacritics(text).replace(/\s+/g, "")) {
    throw new TashkeelError("Diacritization changed the words; result rejected.", {
      status: 502,
      code: "letters_changed",
    });
  }

  return {
    text: result,
    model: String(output.model || "fine-tashkeel"),
    provider: "selfhost",
    durationMs: Number(output.duration_ms) || 0,
  };
}
