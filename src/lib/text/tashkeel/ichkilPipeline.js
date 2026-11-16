/**
 * Text pipeline for ichkil, the Arabic diacritization model (MIT, github.com/Ichkil/ichkil-python).
 * Port of ichkil/pipeline.py v1.1.0 / model v0.3.0. No model and no I/O here, so it is
 * unit-tested directly (ichkilPipeline.test.js).
 *
 * The model emits one label per input character:
 *   0       non-letter (space, punctuation, digit, Latin) or padding
 *   1       letter with no diacritic
 *   2..15   harakat / shadda / tanwin combinations
 *
 * One deliberate difference from the Python package: Python normalizes the text (alif wasla →
 * alif, line breaks → space, …) and returns the normalized letters. This port feeds the model
 * the same normalized characters, but attaches the predicted marks to the user's ORIGINAL
 * characters. Line breaks, alif wasla and Persian letters in a design stay exactly as the user
 * wrote them, and "the letters must not change" (index.server.ts) holds by construction. On
 * ordinary single-spaced text the output is identical to Python's, and the parity test checks
 * that.
 */

/** A single Arabic letter the model may decorate. */
const AR_LETTER = /^[ء-غف-ي]$/;

/** Any Arabic diacritic / harakat code point (removed before prediction). */
const AR_DIACRITIC = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;

const TATWEEL = "ـ";

export const NUM_LABELS = 16;

/** label id → diacritic combination */
export const LABEL_TO_COMBO = Object.freeze([
  "", // 0  non-letter
  "", // 1  no diacritic
  "َ", // 2  fatha
  "ُ", // 3  damma
  "ِ", // 4  kasra
  "ْ", // 5  sukun
  "ّ", // 6  shadda
  "َّ", // 7  shadda + fatha
  "ُّ", // 8  shadda + damma
  "ِّ", // 9  shadda + kasra
  "ً", // 10 tanwin fatha
  "ٌ", // 11 tanwin damma
  "ٍ", // 12 tanwin kasra
  "ًّ", // 13 shadda + tanwin fatha
  "ٌّ", // 14 shadda + tanwin damma
  "ٍّ", // 15 shadda + tanwin kasra
]);

/** Presentation variants → the base letter the model was trained on (pipeline._CHAR_MAP). */
const CHAR_MAP = {
  "ٱ": "ا", // alef wasla → alef
  "ی": "ي", // farsi yeh → yeh
  "ک": "ك", // keheh → kaf
  "ہ": "ه", // heh goal → heh
  " ": " ", // no-break space
};
const ZERO_WIDTH = /^[​-‏﻿]$/;
const WHITESPACE = /^\s$/;

export function isArabicLetter(ch) {
  return AR_LETTER.test(ch);
}

export function labelToCombo(label) {
  return label >= 0 && label < NUM_LABELS ? LABEL_TO_COMBO[label] : "";
}

/** NFC, then every diacritic and tatweel removed. Everything else (line breaks included) is kept. */
export function stripForPrediction(text) {
  return String(text ?? "")
    .normalize("NFC")
    .replace(AR_DIACRITIC, "")
    .split(TATWEEL)
    .join("");
}

/**
 * The character the model sees for each character of `base`, one-to-one, so the predictions
 * line up with the original string. Whitespace (a line break too) is a space, as in Python's
 * whitespace collapse. Zero-width characters become a space rather than disappearing; Python
 * drops them, which only differs on text that contains them.
 */
export function modelCharacters(base) {
  return Array.from(base, (ch) => {
    if (CHAR_MAP[ch]) return CHAR_MAP[ch];
    if (ZERO_WIDTH.test(ch) || WHITESPACE.test(ch)) return " ";
    return ch;
  });
}

/** Vocabulary ids for the model characters (out-of-vocabulary → unkId). */
export function encode(chars, sym2id, unkId) {
  return chars.map((ch) => (Object.hasOwn(sym2id, ch) ? sym2id[ch] : unkId));
}

/** Index of the maximum (the first one wins ties, like ONNX Runtime / numpy). */
export function argmaxAt(values, offset, length) {
  let best = 0;
  let bestValue = values[offset];
  for (let i = 1; i < length; i += 1) {
    const value = values[offset + i];
    if (value > bestValue) {
      bestValue = value;
      best = i;
    }
  }
  return best;
}

/** Attaches each letter's predicted marks to the ORIGINAL characters of `base`. */
export function attachToOriginal(base, modelChars, logits, numLabels = NUM_LABELS) {
  const original = Array.from(base);
  let out = "";
  for (let i = 0; i < original.length; i += 1) {
    out += original[i];
    if (isArabicLetter(modelChars[i])) {
      out += labelToCombo(argmaxAt(logits, i * numLabels, numLabels));
    }
  }
  return out;
}
