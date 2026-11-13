// Input shapes for the design-sync routes. Hand validation, like every mobile route.

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{5,79}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CONTENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9.+-]{0,40}\/[a-z0-9][a-z0-9.+-]{0,60}$/;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export const MAX_DESIGN_NAME_LENGTH = 200;
export const MAX_FOLDER_NAME_LENGTH = 80;

export function isValidSyncId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function isValidSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function isValidMutationId(value: unknown): value is string {
  return typeof value === "string" && MUTATION_ID_PATTERN.test(value);
}

export function normalizeContentType(value: unknown): string | null {
  const type = String(value ?? "").trim().toLowerCase();
  return CONTENT_TYPE_PATTERN.test(type) ? type : null;
}

/** A non-negative safe integer, or null. Accepts numbers and numeric strings. */
export function toSafeInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function cleanName(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
