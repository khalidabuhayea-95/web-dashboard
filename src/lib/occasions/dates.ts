/**
 * Occasion date engine — pure functions, no database, no dependencies.
 *
 * Hijri dates come from the runtime's ICU data through `Intl.DateTimeFormat` with the
 * `islamic-umalqura` calendar (the Umm al-Qura calendar Saudi Arabia publishes). Node and
 * every evergreen browser ship it, so the same module runs on the server and inside the
 * dashboard's calendar grid. Umm al-Qura is a predictive calendar: the real start of
 * Ramadan or an Eid is announced by moon sighting, which is what `dateOverrides` are for.
 *
 * Every date is a `YYYY-MM-DD` string and every calculation runs on UTC-midnight `Date`s,
 * so daylight-saving rules can never shift a day. "Today" is taken in `OCCASIONS_TIME_ZONE`
 * because the user base and the admin team live there.
 */

export const OCCASIONS_TIME_ZONE = "Asia/Riyadh";

export const OCCASION_CALENDARS = ["hijri", "gregorian"] as const;
export type OccasionCalendar = (typeof OCCASION_CALENDARS)[number];

export const OCCASION_KINDS = ["islamic", "national", "international", "seasonal"] as const;
export type OccasionKind = (typeof OCCASION_KINDS)[number];

export const OCCASION_PHASES = ["upcoming", "reminder", "boost", "live"] as const;
export type OccasionPhase = (typeof OCCASION_PHASES)[number];

/** The date-bearing subset of an Occasion row. */
export interface OccasionDateRule {
  calendar: OccasionCalendar | string;
  month: number;
  day?: number | null;
  weekday?: number | null;
  weekOrdinal?: number | null;
  durationDays?: number | null;
  reminderLeadDays?: number | null;
  boostLeadDays?: number | null;
  dateOverrides?: Record<string, unknown> | null;
}

export interface OccasionOccurrence {
  startIso: string;
  endIso: string;
  /** Gregorian year of the start. */
  year: number;
  /** Hijri year of the start (hijri occasions only). */
  hijriYear: number | null;
  /** The key `dateOverrides` uses for this occurrence (hijri year for hijri rules). */
  overrideKey: string;
  /** True when the date is a calendar prediction rather than an admin-confirmed date. */
  estimated: boolean;
}

export interface OccasionWindows {
  reminderStartIso: string;
  boostStartIso: string;
  startIso: string;
  endIso: string;
}

export interface NextOccurrenceInfo {
  occurrence: OccasionOccurrence;
  windows: OccasionWindows;
  /** Days from today to the start; negative while the occasion is running. */
  daysUntil: number;
  phase: OccasionPhase;
}

const DAY_MS = 86_400_000;
const MEAN_HIJRI_MONTH_DAYS = 29.530589;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const HIJRI_MONTHS_EN = [
  "Muharram",
  "Safar",
  "Rabi' al-Awwal",
  "Rabi' al-Thani",
  "Jumada al-Ula",
  "Jumada al-Akhirah",
  "Rajab",
  "Sha'ban",
  "Ramadan",
  "Shawwal",
  "Dhu al-Qi'dah",
  "Dhu al-Hijjah",
];

const HIJRI_MONTHS_AR = [
  "محرم",
  "صفر",
  "ربيع الأول",
  "ربيع الآخر",
  "جمادى الأولى",
  "جمادى الآخرة",
  "رجب",
  "شعبان",
  "رمضان",
  "شوال",
  "ذو القعدة",
  "ذو الحجة",
];

let hijriFormatter: Intl.DateTimeFormat | null = null;

function getHijriFormatter(): Intl.DateTimeFormat {
  if (!hijriFormatter) {
    hijriFormatter = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  return hijriFormatter;
}

/** True when this runtime's ICU data knows the Umm al-Qura calendar. */
export function supportsHijriCalendar(): boolean {
  try {
    const parts = getHijriFormatter().formatToParts(new Date(Date.UTC(2026, 1, 18)));
    const year = parts.find((part) => part.type === "year")?.value;
    return Number.parseInt(String(year || ""), 10) === 1447;
  } catch {
    return false;
  }
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return toIso(date) === value;
}

export function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fromIso(iso: string): Date {
  const match = ISO_DATE_RE.exec(iso);
  if (!match) throw new Error(`Invalid ISO date: ${iso}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function addDays(iso: string, days: number): string {
  return toIso(new Date(fromIso(iso).getTime() + Math.round(days) * DAY_MS));
}

/** Whole days from `fromIso` to `toIso` (positive when `toIso` is later). */
export function diffDays(fromIsoValue: string, toIsoValue: string): number {
  return Math.round((fromIso(toIsoValue).getTime() - fromIso(fromIsoValue).getTime()) / DAY_MS);
}

export function daysInGregorianMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The calendar date it currently is in `timeZone`, as an ISO date. */
export function todayInTimeZone(timeZone: string = OCCASIONS_TIME_ZONE, now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export interface HijriDate {
  hy: number;
  hm: number;
  hd: number;
}

const hijriPartsCache = new Map<number, HijriDate>();

function hijriPartsOf(date: Date): HijriDate {
  const key = date.getTime();
  const cached = hijriPartsCache.get(key);
  if (cached) return cached;
  const parts = getHijriFormatter().formatToParts(date);
  const read = (type: string) => Number.parseInt(parts.find((part) => part.type === type)?.value || "", 10);
  const result = { hy: read("year"), hm: read("month"), hd: read("day") };
  if (!Number.isFinite(result.hy) || !Number.isFinite(result.hm) || !Number.isFinite(result.hd)) {
    throw new Error("Hijri calendar data is unavailable in this runtime");
  }
  hijriPartsCache.set(key, result);
  return result;
}

export function gregorianToHijri(iso: string): HijriDate {
  return hijriPartsOf(fromIso(iso));
}

const monthStartCache = new Map<string, Date>();
let epoch: { date: Date; parts: HijriDate } | null = null;

function getEpoch() {
  if (!epoch) {
    const date = new Date(Date.UTC(2000, 0, 1));
    epoch = { date, parts: hijriPartsOf(date) };
  }
  return epoch;
}

/**
 * UTC-midnight date of the 1st of Hijri month (hy, hm). Estimates from a fixed epoch by
 * the mean month length, then walks day by day against the ICU calendar until it lands on
 * day 1 — a handful of iterations, and exact by construction.
 */
function hijriMonthStart(hy: number, hm: number): Date {
  const key = `${hy}-${hm}`;
  const cached = monthStartCache.get(key);
  if (cached) return cached;

  const { date: epochDate, parts: epochParts } = getEpoch();
  const monthsAhead = (hy - epochParts.hy) * 12 + (hm - epochParts.hm);
  const estimateDays = Math.round(monthsAhead * MEAN_HIJRI_MONTH_DAYS - (epochParts.hd - 1));
  let guess = new Date(epochDate.getTime() + estimateDays * DAY_MS);

  for (let iteration = 0; iteration < 80; iteration += 1) {
    const parts = hijriPartsOf(guess);
    if (parts.hy === hy && parts.hm === hm) {
      if (parts.hd === 1) {
        monthStartCache.set(key, guess);
        return guess;
      }
      guess = new Date(guess.getTime() - (parts.hd - 1) * DAY_MS);
      continue;
    }
    const monthsOff = (parts.hy - hy) * 12 + (parts.hm - hm);
    const daysOff = monthsOff * MEAN_HIJRI_MONTH_DAYS + (parts.hd - 1);
    let step = -Math.round(daysOff);
    if (step === 0) step = daysOff > 0 ? -1 : 1;
    guess = new Date(guess.getTime() + step * DAY_MS);
  }
  throw new Error(`Could not resolve Hijri month ${hy}-${hm}`);
}

export function hijriMonthLength(hy: number, hm: number): number {
  const start = hijriMonthStart(hy, hm);
  const next = hm === 12 ? hijriMonthStart(hy + 1, 1) : hijriMonthStart(hy, hm + 1);
  return Math.round((next.getTime() - start.getTime()) / DAY_MS);
}

/** Gregorian ISO date of a Hijri date. A day past the month's end clamps to its last day. */
export function hijriToGregorian(hy: number, hm: number, hd: number): string {
  const month = Math.min(Math.max(Math.round(hm), 1), 12);
  const day = Math.min(Math.max(Math.round(hd), 1), hijriMonthLength(hy, month));
  const start = hijriMonthStart(hy, month);
  return toIso(new Date(start.getTime() + (day - 1) * DAY_MS));
}

const ARABIC_INDIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

export function toArabicIndicDigits(value: number | string): string {
  return String(value).replace(/\d/g, (digit) => ARABIC_INDIC_DIGITS[Number(digit)]);
}

/** "9 Rabi' al-Thani 1448" / "٩ ربيع الآخر ١٤٤٨". */
export function formatHijri(iso: string, locale: "ar" | "en" = "ar"): string {
  const { hy, hm, hd } = gregorianToHijri(iso);
  if (locale === "ar") {
    return `${toArabicIndicDigits(hd)} ${HIJRI_MONTHS_AR[hm - 1]} ${toArabicIndicDigits(hy)}`;
  }
  return `${hd} ${HIJRI_MONTHS_EN[hm - 1]} ${hy}`;
}

export function hijriMonthName(hm: number, locale: "ar" | "en" = "ar"): string {
  const list = locale === "ar" ? HIJRI_MONTHS_AR : HIJRI_MONTHS_EN;
  return list[Math.min(Math.max(hm, 1), 12) - 1];
}

/** ISO date of the nth `weekday` (0=Sun) of a Gregorian month; `ordinal` -1 = last. */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, ordinal: number): string {
  if (ordinal > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    const dayOfMonth = 1 + offset + (ordinal - 1) * 7;
    const clamped = Math.min(dayOfMonth, daysInGregorianMonth(year, month));
    return toIso(new Date(Date.UTC(year, month - 1, clamped)));
  }
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return toIso(new Date(last.getTime() - offset * DAY_MS));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

function readOverride(rule: OccasionDateRule, key: string): string | null {
  const overrides = rule.dateOverrides;
  if (!overrides || typeof overrides !== "object") return null;
  const value = (overrides as Record<string, unknown>)[key];
  return isIsoDate(value) ? value : null;
}

function buildOccurrence(rule: OccasionDateRule, computedStart: string, year: number, hijriYear: number | null): OccasionOccurrence {
  const overrideKey = String(hijriYear ?? year);
  const override = readOverride(rule, overrideKey);
  const startIso = override || computedStart;
  const durationDays = clampInt(rule.durationDays, 1, 1, 366);
  return {
    startIso,
    endIso: addDays(startIso, durationDays - 1),
    year: Number(startIso.slice(0, 4)),
    hijriYear,
    overrideKey,
    estimated: rule.calendar === "hijri" && !override,
  };
}

function gregorianStart(rule: OccasionDateRule, year: number): string | null {
  const month = clampInt(rule.month, 0, 1, 12);
  if (!month) return null;
  if (rule.weekday !== null && rule.weekday !== undefined && rule.weekOrdinal) {
    const weekday = clampInt(rule.weekday, 0, 0, 6);
    const ordinal = clampInt(rule.weekOrdinal, 1, -1, 4) || 1;
    return nthWeekdayOfMonth(year, month, weekday, ordinal);
  }
  const day = clampInt(rule.day, 1, 1, 31);
  return toIso(new Date(Date.UTC(year, month - 1, Math.min(day, daysInGregorianMonth(year, month)))));
}

/**
 * Every occurrence of the rule whose [start, end] overlaps [fromIso, toIso], ascending.
 * Hijri rules iterate the Hijri years that touch the range: a Gregorian year can hold
 * two Muharrams, so the loop runs on Hijri years, not Gregorian ones.
 */
export function resolveOccurrences(rule: OccasionDateRule, range: { fromIso: string; toIso: string }): OccasionOccurrence[] {
  const results: OccasionOccurrence[] = [];
  const overlaps = (occurrence: OccasionOccurrence) =>
    occurrence.startIso <= range.toIso && occurrence.endIso >= range.fromIso;

  if (rule.calendar === "hijri") {
    const month = clampInt(rule.month, 0, 1, 12);
    if (!month) return results;
    const day = clampInt(rule.day, 1, 1, 30);
    const fromHy = gregorianToHijri(range.fromIso).hy - 1;
    const toHy = gregorianToHijri(range.toIso).hy + 1;
    for (let hy = fromHy; hy <= toHy; hy += 1) {
      const computed = hijriToGregorian(hy, month, day);
      const occurrence = buildOccurrence(rule, computed, Number(computed.slice(0, 4)), hy);
      if (overlaps(occurrence)) results.push(occurrence);
    }
    return results.sort((a, b) => a.startIso.localeCompare(b.startIso));
  }

  const fromYear = Number(range.fromIso.slice(0, 4)) - 1;
  const toYear = Number(range.toIso.slice(0, 4)) + 1;
  for (let year = fromYear; year <= toYear; year += 1) {
    const computed = gregorianStart(rule, year);
    if (!computed) continue;
    const occurrence = buildOccurrence(rule, computed, year, null);
    if (overlaps(occurrence)) results.push(occurrence);
  }
  return results.sort((a, b) => a.startIso.localeCompare(b.startIso));
}

export function occurrenceWindows(rule: OccasionDateRule, occurrence: OccasionOccurrence): OccasionWindows {
  const reminderLeadDays = clampInt(rule.reminderLeadDays, 30, 0, 365);
  const boostLeadDays = clampInt(rule.boostLeadDays, 14, 0, 365);
  return {
    reminderStartIso: addDays(occurrence.startIso, -reminderLeadDays),
    boostStartIso: addDays(occurrence.startIso, -boostLeadDays),
    startIso: occurrence.startIso,
    endIso: occurrence.endIso,
  };
}

export function resolvePhase(windows: OccasionWindows, todayIso: string): OccasionPhase {
  if (todayIso > windows.endIso) return "upcoming";
  if (todayIso >= windows.startIso) return "live";
  if (todayIso >= windows.boostStartIso) return "boost";
  if (todayIso >= windows.reminderStartIso) return "reminder";
  return "upcoming";
}

/** The running or next occurrence relative to `todayIso`, with its phase. */
export function describeNext(rule: OccasionDateRule, todayIso: string): NextOccurrenceInfo | null {
  const occurrences = resolveOccurrences(rule, {
    fromIso: addDays(todayIso, -400),
    toIso: addDays(todayIso, 800),
  });
  const occurrence = occurrences.find((item) => item.endIso >= todayIso);
  if (!occurrence) return null;
  const windows = occurrenceWindows(rule, occurrence);
  return {
    occurrence,
    windows,
    daysUntil: diffDays(todayIso, occurrence.startIso),
    phase: resolvePhase(windows, todayIso),
  };
}

/** The occurrence whose boost window covers `todayIso`, if any. */
export function resolveActiveBoost(rule: OccasionDateRule, todayIso: string): NextOccurrenceInfo | null {
  const next = describeNext(rule, todayIso);
  if (!next) return null;
  return next.phase === "boost" || next.phase === "live" ? next : null;
}
