/**
 * The stable key ("value") of a category row in the element, background and template category
 * settings. It is set once, from the English name, and never changes on rename.
 */

export function toCategoryKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The key for one row of a settings list being saved.
 *
 * A row that already has a key keeps it; a key seen twice is a duplicate of the same category,
 * so the caller drops the second one (this returns "" for it).
 *
 * A new row takes its key from its English name. A name with no Latin letters (an Arabic name
 * in the English field) or one that repeats another category used to give an empty or taken
 * key, and the row disappeared on save while the page still said "saved". Such a row now gets
 * the numbered fallback or a "-2", "-3" suffix instead.
 *
 * @param {object} options
 * @param {unknown} options.storedValue the row's existing key, if any
 * @param {string} options.label the row's English name
 * @param {string} options.fallback the key to use when the name has no Latin letters
 * @param {Set<string>} options.used keys already taken by earlier rows
 * @param {string[]} options.reserved keys stored on any row of the list, so a new row never
 *   takes the key of an existing category further down
 */
export function resolveCategoryKey({ storedValue, label, fallback, used, reserved }) {
  const stored = toCategoryKey(storedValue);
  if (stored) {
    return used.has(stored) ? "" : stored;
  }
  const base = toCategoryKey(label) || toCategoryKey(fallback);
  if (!base) return "";
  const taken = (key) => used.has(key) || reserved.includes(key);
  let key = base;
  let suffix = 2;
  while (taken(key)) {
    key = `${base}-${suffix}`;
    suffix += 1;
  }
  return key;
}

/** Every stored key in a settings list (see resolveCategoryKey's `reserved`). */
export function storedCategoryKeys(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => toCategoryKey(row?.value)).filter(Boolean);
}
