/**
 * Occasion rows + their calendar status for the dashboard: what is next, which phase it
 * is in, how many items are linked, and the reminder tallies behind the sidebar badge.
 */
import type { Occasion } from "@prisma/client";

import prisma from "@/lib/prisma";

import { invalidateOccasionBoostCache } from "./boost.server";
import {
  OCCASIONS_TIME_ZONE,
  describeNext,
  formatHijri,
  resolveOccurrences,
  supportsHijriCalendar,
  todayInTimeZone,
  type NextOccurrenceInfo,
  type OccasionPhase,
} from "./dates";
import { countOccasionItems } from "./items.server";
import { normalizeOccasionInput, normalizeOccasionPatch, type OccasionWriteData } from "./validate";

export const UPCOMING_HORIZON_DAYS = 60;
const ATTENTION_PHASES: OccasionPhase[] = ["reminder", "boost", "live"];

export interface TodayInfo {
  iso: string;
  timeZone: string;
  hijriAr: string;
  hijriEn: string;
}

export function describeToday(todayIso: string = todayInTimeZone(OCCASIONS_TIME_ZONE)): TodayInfo {
  const hijriOk = supportsHijriCalendar();
  return {
    iso: todayIso,
    timeZone: OCCASIONS_TIME_ZONE,
    hijriAr: hijriOk ? formatHijri(todayIso, "ar") : "",
    hijriEn: hijriOk ? formatHijri(todayIso, "en") : "",
  };
}

function serializeNext(next: NextOccurrenceInfo | null) {
  if (!next) return null;
  return {
    startIso: next.occurrence.startIso,
    endIso: next.occurrence.endIso,
    year: next.occurrence.year,
    hijriYear: next.occurrence.hijriYear,
    overrideKey: next.occurrence.overrideKey,
    estimated: next.occurrence.estimated,
    hijriAr: formatHijri(next.occurrence.startIso, "ar"),
    hijriEn: formatHijri(next.occurrence.startIso, "en"),
    reminderStartIso: next.windows.reminderStartIso,
    boostStartIso: next.windows.boostStartIso,
    daysUntil: next.daysUntil,
    phase: next.phase,
  };
}

export type SerializedOccasion = ReturnType<typeof serializeOccasion>;

export function serializeOccasion(row: any, todayIso: string, counts?: { total: number; byKind: Record<string, number> }) {
  const next = describeNext(row, todayIso);
  const itemCount = counts?.total ?? 0;
  const needsAttention = Boolean(next && ATTENTION_PHASES.includes(next.phase));
  return {
    id: row.id,
    slug: row.slug,
    titleEn: row.titleEn,
    titleAr: row.titleAr,
    kind: row.kind,
    calendar: row.calendar,
    month: row.month,
    day: row.day,
    weekday: row.weekday,
    weekOrdinal: row.weekOrdinal,
    durationDays: row.durationDays,
    reminderLeadDays: row.reminderLeadDays,
    boostLeadDays: row.boostLeadDays,
    countries: Array.isArray(row.countries) ? row.countries : [],
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
    dateOverrides: row.dateOverrides && typeof row.dateOverrides === "object" ? row.dateOverrides : {},
    notes: row.notes || "",
    emoji: row.emoji || "",
    color: row.color || "",
    enabled: Boolean(row.enabled),
    boostEnabled: Boolean(row.boostEnabled),
    hoistCategories: Boolean(row.hoistCategories),
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    next: serializeNext(next),
    itemCount,
    itemCounts: counts?.byKind ?? {},
    needsContent: row.enabled && needsAttention && itemCount === 0,
  };
}

export async function listOccasions(options: { todayIso?: string; fromIso?: string; toIso?: string } = {}) {
  const todayIso = options.todayIso || todayInTimeZone(OCCASIONS_TIME_ZONE);
  const rows: Occasion[] = await prisma.occasion.findMany({ orderBy: [{ sortOrder: "asc" }, { slug: "asc" }] });
  const counts = await countOccasionItems();
  const occasions = rows.map((row) => serializeOccasion(row, todayIso, counts.get(row.id)));

  const occurrences =
    options.fromIso && options.toIso
      ? rows.flatMap((row) =>
          resolveOccurrences(row as any, { fromIso: options.fromIso!, toIso: options.toIso! }).map((occurrence) => ({
            occasionId: row.id,
            startIso: occurrence.startIso,
            endIso: occurrence.endIso,
            estimated: occurrence.estimated,
            overrideKey: occurrence.overrideKey,
          }))
        )
      : [];

  return { today: describeToday(todayIso), occasions, occurrences };
}

export async function getOccasion(id: string, todayIso: string = todayInTimeZone(OCCASIONS_TIME_ZONE)) {
  const row = await prisma.occasion.findUnique({ where: { id } });
  if (!row) return null;
  const counts = await countOccasionItems([id]);
  return serializeOccasion(row, todayIso, counts.get(id));
}

/** Enabled occasions starting within the horizon (or running now), soonest first. */
export async function listUpcomingOccasions(options: { todayIso?: string; horizonDays?: number } = {}) {
  const todayIso = options.todayIso || todayInTimeZone(OCCASIONS_TIME_ZONE);
  const horizonDays = options.horizonDays ?? UPCOMING_HORIZON_DAYS;
  const rows: Occasion[] = await prisma.occasion.findMany({ where: { enabled: true } });
  const counts = await countOccasionItems(rows.map((row) => row.id));
  return rows
    .map((row) => serializeOccasion(row, todayIso, counts.get(row.id)))
    .filter((item: SerializedOccasion) => item.next && item.next.daysUntil <= horizonDays)
    .sort((a: SerializedOccasion, b: SerializedOccasion) => (a.next!.startIso < b.next!.startIso ? -1 : a.next!.startIso > b.next!.startIso ? 1 : a.slug.localeCompare(b.slug)));
}

/** The sidebar badge tallies: `needsContent` is the number that lights the badge. */
export async function countOccasionReminders(todayIso: string = todayInTimeZone(OCCASIONS_TIME_ZONE)) {
  const rows: Occasion[] = await prisma.occasion.findMany({ where: { enabled: true } });
  const counts = await countOccasionItems(rows.map((row) => row.id));
  let needsContent = 0;
  let reminding = 0;
  let live = 0;
  for (const row of rows) {
    const item = serializeOccasion(row, todayIso, counts.get(row.id));
    if (!item.next) continue;
    if (ATTENTION_PHASES.includes(item.next.phase as OccasionPhase)) reminding += 1;
    if (item.next.phase === "live") live += 1;
    if (item.needsContent) needsContent += 1;
  }
  return { needsContent, reminding, live };
}

function slugify(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createOccasion(input: any) {
  const data = normalizeOccasionInput(input);
  const requested = slugify(String(input?.slug || "")) || slugify(data.titleEn) || "occasion";
  let slug = requested;
  for (let attempt = 2; await prisma.occasion.findUnique({ where: { slug }, select: { id: true } }); attempt += 1) {
    slug = `${requested}-${attempt}`;
  }
  const last = await prisma.occasion.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const row = await prisma.occasion.create({ data: { slug, ...data, sortOrder: (last?.sortOrder ?? -1) + 1 } });
  invalidateOccasionBoostCache();
  return row;
}

export async function updateOccasion(id: string, input: any) {
  const current = await prisma.occasion.findUnique({ where: { id } });
  if (!current) return null;
  const patch = normalizeOccasionPatch(input, current as unknown as OccasionWriteData);
  const row = await prisma.occasion.update({ where: { id }, data: patch as any });
  invalidateOccasionBoostCache();
  return row;
}

export async function deleteOccasion(id: string) {
  const current = await prisma.occasion.findUnique({ where: { id }, select: { id: true, slug: true } });
  if (!current) return null;
  await prisma.occasion.delete({ where: { id } }); // items cascade
  invalidateOccasionBoostCache();
  return current;
}
