/**
 * Input validation for Occasion rows — shared by the admin API and the seed script so a
 * date rule the engine cannot resolve can never reach the database from either side.
 * Hand-written normalizers (the repo's convention) that throw `OccasionValidationError`
 * with a message safe to show in the dashboard.
 */
import { OCCASION_CALENDARS, OCCASION_KINDS, isIsoDate } from "./dates";

export const MAX_OCCASION_TITLE_LENGTH = 120;
export const MAX_OCCASION_NOTES_LENGTH = 2000;
export const MAX_OCCASION_KEYWORDS = 24;
export const MAX_OCCASION_KEYWORD_LENGTH = 60;
export const MAX_OCCASION_COUNTRIES = 30;
export const MAX_OCCASION_DATE_OVERRIDES = 40;

export const OCCASION_ITEM_KINDS = [
  "template",
  "template-category",
  "ai-template",
  "ai-category",
  "element",
  "element-category",
  "background",
  "background-category",
] as const;
export type OccasionItemKind = (typeof OCCASION_ITEM_KINDS)[number];

export class OccasionValidationError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "OccasionValidationError";
  }
}

export interface OccasionWriteData {
  titleEn: string;
  titleAr: string;
  kind: string;
  calendar: string;
  month: number;
  day: number | null;
  weekday: number | null;
  weekOrdinal: number | null;
  durationDays: number;
  reminderLeadDays: number;
  boostLeadDays: number;
  countries: string[];
  keywords: string[];
  dateOverrides: Record<string, string>;
  notes: string;
  emoji: string;
  color: string;
  enabled: boolean;
  boostEnabled: boolean;
  hoistCategories: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const COUNTRY_RE = /^[A-Z]{2}$/;
const CATEGORY_KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function readInt(value: unknown, field: string, min: number, max: number, fallback?: number): number {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw new OccasionValidationError(`${field} is required`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.round(parsed) !== parsed) {
    throw new OccasionValidationError(`${field} must be a whole number`);
  }
  if (parsed < min || parsed > max) {
    throw new OccasionValidationError(`${field} must be between ${min} and ${max}`);
  }
  return parsed;
}

function readText(value: unknown, field: string, max: number, required: boolean): string {
  const text = String(value ?? "").trim();
  if (!text && required) throw new OccasionValidationError(`${field} cannot be empty`);
  if (text.length > max) throw new OccasionValidationError(`${field} is too long (max ${max} characters)`);
  return text;
}

function readStringList(value: unknown, field: string, maxCount: number, maxLength: number, transform: (s: string) => string): string[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n]/)
      : [];
  const out: string[] = [];
  for (const raw of list) {
    const text = transform(String(raw ?? "").trim());
    if (!text) continue;
    if (text.length > maxLength) throw new OccasionValidationError(`${field} entries must be at most ${maxLength} characters`);
    if (!out.includes(text)) out.push(text);
  }
  if (out.length > maxCount) throw new OccasionValidationError(`${field} can hold at most ${maxCount} entries`);
  return out;
}

export function normalizeDateOverrides(value: unknown): Record<string, string> {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new OccasionValidationError("dateOverrides must be an object of year → date");
  }
  const out: Record<string, string> = {};
  for (const [rawKey, rawDate] of Object.entries(value as Record<string, unknown>)) {
    const key = String(rawKey).trim();
    if (!/^\d{4}$/.test(key)) throw new OccasionValidationError(`dateOverrides key "${key}" must be a 4-digit year`);
    if (rawDate === null || rawDate === "" || rawDate === undefined) continue; // an emptied input clears it
    if (!isIsoDate(rawDate)) throw new OccasionValidationError(`dateOverrides["${key}"] must be a YYYY-MM-DD date`);
    out[key] = rawDate;
  }
  if (Object.keys(out).length > MAX_OCCASION_DATE_OVERRIDES) {
    throw new OccasionValidationError(`At most ${MAX_OCCASION_DATE_OVERRIDES} date overrides are kept`);
  }
  return out;
}

/**
 * Full normalization for a create (or a seed row). Every field is validated; missing
 * optional fields take their defaults.
 */
export function normalizeOccasionInput(input: any): OccasionWriteData {
  const body = input && typeof input === "object" ? input : {};

  const kind = String(body.kind || "islamic").trim().toLowerCase();
  if (!(OCCASION_KINDS as readonly string[]).includes(kind)) {
    throw new OccasionValidationError(`kind must be one of ${OCCASION_KINDS.join(", ")}`);
  }
  const calendar = String(body.calendar || "gregorian").trim().toLowerCase();
  if (!(OCCASION_CALENDARS as readonly string[]).includes(calendar)) {
    throw new OccasionValidationError(`calendar must be one of ${OCCASION_CALENDARS.join(", ")}`);
  }

  const month = readInt(body.month, "month", 1, 12);
  const hasWeekdayRule =
    calendar === "gregorian" &&
    body.weekday !== undefined && body.weekday !== null && body.weekday !== "" &&
    body.weekOrdinal !== undefined && body.weekOrdinal !== null && body.weekOrdinal !== "";

  let day: number | null = null;
  let weekday: number | null = null;
  let weekOrdinal: number | null = null;
  if (hasWeekdayRule) {
    weekday = readInt(body.weekday, "weekday", 0, 6);
    weekOrdinal = readInt(body.weekOrdinal, "weekOrdinal", -1, 4);
    if (weekOrdinal === 0) throw new OccasionValidationError("weekOrdinal must be 1–4, or -1 for the last week");
  } else {
    day = readInt(body.day, "day", 1, calendar === "hijri" ? 30 : 31);
  }

  const color = readText(body.color, "color", 16, false);
  if (color && !HEX_COLOR_RE.test(color)) throw new OccasionValidationError("color must be a #rrggbb value");

  return {
    titleEn: readText(body.titleEn, "English title", MAX_OCCASION_TITLE_LENGTH, true),
    titleAr: readText(body.titleAr, "Arabic title", MAX_OCCASION_TITLE_LENGTH, true),
    kind,
    calendar,
    month,
    day,
    weekday,
    weekOrdinal,
    durationDays: readInt(body.durationDays, "durationDays", 1, 366, 1),
    reminderLeadDays: readInt(body.reminderLeadDays, "reminderLeadDays", 0, 365, 30),
    boostLeadDays: readInt(body.boostLeadDays, "boostLeadDays", 0, 365, 14),
    countries: readStringList(body.countries, "countries", MAX_OCCASION_COUNTRIES, 2, (s) => s.toUpperCase()).map((code) => {
      if (!COUNTRY_RE.test(code)) throw new OccasionValidationError(`"${code}" is not a two-letter country code`);
      return code;
    }),
    keywords: readStringList(body.keywords, "keywords", MAX_OCCASION_KEYWORDS, MAX_OCCASION_KEYWORD_LENGTH, (s) => s),
    dateOverrides: normalizeDateOverrides(body.dateOverrides),
    notes: readText(body.notes, "notes", MAX_OCCASION_NOTES_LENGTH, false),
    emoji: readText(body.emoji, "emoji", 16, false),
    color: color.toLowerCase(),
    enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    boostEnabled: body.boostEnabled === undefined ? true : Boolean(body.boostEnabled),
    hoistCategories: body.hoistCategories === undefined ? true : Boolean(body.hoistCategories),
  };
}

/**
 * Sparse normalization for a PATCH: only the fields present in `input` come back, validated
 * against the row's current values so a date rule stays coherent (e.g. switching to hijri
 * clears a weekday rule).
 */
export function normalizeOccasionPatch(input: any, current: OccasionWriteData): Partial<OccasionWriteData> {
  const body = input && typeof input === "object" ? input : {};
  const dateFields = ["calendar", "month", "day", "weekday", "weekOrdinal"];
  const touchesDateRule = dateFields.some((field) => body[field] !== undefined);

  const merged = normalizeOccasionInput({
    ...current,
    ...body,
    // A weekday rule and a fixed day are mutually exclusive; whichever the patch sends wins.
    ...(touchesDateRule && body.day !== undefined && body.day !== null && body.day !== ""
      ? { weekday: null, weekOrdinal: null }
      : {}),
    ...(touchesDateRule && body.weekday !== undefined && body.weekday !== null && body.weekday !== ""
      ? { day: null }
      : {}),
    ...(body.calendar === "hijri" ? { weekday: null, weekOrdinal: null } : {}),
  });

  const patch: Partial<OccasionWriteData> = {};
  for (const key of Object.keys(merged) as Array<keyof OccasionWriteData>) {
    const provided = body[key] !== undefined || (touchesDateRule && dateFields.includes(key));
    if (provided) (patch as any)[key] = merged[key];
  }
  if (Object.keys(patch).length === 0) throw new OccasionValidationError("No editable fields in request");
  return patch;
}

/** Validates a link request; `itemId` shape depends on the kind. */
export function normalizeOccasionItemInput(input: any): { kind: OccasionItemKind; itemId: string } {
  const body = input && typeof input === "object" ? input : {};
  const kind = String(body.kind || "").trim().toLowerCase() as OccasionItemKind;
  if (!(OCCASION_ITEM_KINDS as readonly string[]).includes(kind)) {
    throw new OccasionValidationError(`kind must be one of ${OCCASION_ITEM_KINDS.join(", ")}`);
  }
  const itemId = String(body.itemId ?? body.id ?? "").trim();
  if (!itemId) throw new OccasionValidationError("itemId cannot be empty");

  if (kind === "template" || kind === "ai-template" || kind === "element" || kind === "background") {
    if (!isUuid(itemId)) throw new OccasionValidationError("itemId must be a uuid for this kind");
    return { kind, itemId: itemId.toLowerCase() };
  }
  if (kind === "template-category") {
    const [category, subCategory, extra] = itemId.split("/").map((part) => part.trim().toLowerCase());
    if (extra !== undefined || !category) throw new OccasionValidationError('template-category itemId must be "category" or "category/subCategory"');
    return { kind, itemId: subCategory ? `${category}/${subCategory}` : category };
  }
  const key = itemId.toLowerCase();
  if (key.length > 120 || !CATEGORY_KEY_RE.test(key)) throw new OccasionValidationError("itemId is not a valid category key");
  return { kind, itemId: key };
}
