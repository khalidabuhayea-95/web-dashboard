/**
 * The seasonal boost snapshot: which content is linked to an occasion whose boost window
 * covers today. Every mobile catalog route reads it (see src/lib/occasions/hoist.js,
 * templateBoost.js and src/lib/editor/assetBoostOrder.js for how each list applies it).
 *
 * Cached in-process for a minute, like the taxonomy settings, and it NEVER throws: on any
 * failure (including a database that predates the occasions migration) it returns the
 * empty snapshot, and every route then takes its unchanged, pre-boost path.
 */
import type { Occasion, OccasionItem } from "@prisma/client";

import prisma from "@/lib/prisma";
import { resolveTemplateCategoryPairs } from "@/lib/templates/templateSettings";
import { getTemplateTaxonomySettings } from "@/lib/templates/templateSettings.server";

import { OCCASIONS_TIME_ZONE, resolveActiveBoost, todayInTimeZone } from "./dates";
import { isUuid } from "./validate";

export const OCCASION_BOOST_CACHE_TTL_MS = 60_000;
const MAX_IDS_PER_KIND = 1000;

type OccasionWithItems = Occasion & { items: OccasionItem[] };

export interface OccasionCategoryPair {
  category: string;
  subCategory?: string;
}

export interface ActiveOccasionSummary {
  id: string;
  slug: string;
  titleEn: string;
  titleAr: string;
  startIso: string;
  endIso: string;
  phase: string;
  hoistCategories: boolean;
}

export interface OccasionBoostSnapshot {
  isEmpty: boolean;
  todayIso: string;
  generatedAt: number;
  occasions: ActiveOccasionSummary[];

  templateIds: string[];
  templateIdSet: Set<string>;
  /** "category::subCategory" → boosted template ids placed under that rail. */
  templateIdsByPair: Record<string, string[]>;
  /** Every linked template category pair (boosts rows inside them on the flat lists). */
  templateCategoryPairs: OccasionCategoryPair[];
  /** The pairs whose occasion also asked for the category itself to be hoisted. */
  hoistedTemplateCategoryPairs: OccasionCategoryPair[];

  aiTemplateIds: string[];
  aiTemplateIdSet: Set<string>;
  /** AI template ids whose occasion hoists categories (their category moves up). */
  aiTemplateHoistIdSet: Set<string>;
  aiCategorySlugSet: Set<string>;

  elementIds: string[];
  elementCategoryKeys: string[];
  hoistedElementCategoryKeys: string[];

  backgroundIds: string[];
  backgroundCategoryKeys: string[];
  hoistedBackgroundCategoryKeys: string[];

  hasTemplateBoost: boolean;
  hasAiBoost: boolean;
  hasElementBoost: boolean;
  hasBackgroundBoost: boolean;
}

export function createEmptyOccasionBoostSnapshot(todayIso = ""): OccasionBoostSnapshot {
  return {
    isEmpty: true,
    todayIso,
    generatedAt: Date.now(),
    occasions: [],
    templateIds: [],
    templateIdSet: new Set(),
    templateIdsByPair: {},
    templateCategoryPairs: [],
    hoistedTemplateCategoryPairs: [],
    aiTemplateIds: [],
    aiTemplateIdSet: new Set(),
    aiTemplateHoistIdSet: new Set(),
    aiCategorySlugSet: new Set(),
    elementIds: [],
    elementCategoryKeys: [],
    hoistedElementCategoryKeys: [],
    backgroundIds: [],
    backgroundCategoryKeys: [],
    hoistedBackgroundCategoryKeys: [],
    hasTemplateBoost: false,
    hasAiBoost: false,
    hasElementBoost: false,
    hasBackgroundBoost: false,
  };
}

let cached: { value: OccasionBoostSnapshot; expiresAt: number } | null = null;

/** Drop the cached snapshot — called after any occasion or link mutation. */
export function invalidateOccasionBoostCache(): void {
  cached = null;
}

function pushUnique(list: string[], seen: Set<string>, value: string) {
  if (!value || seen.has(value) || list.length >= MAX_IDS_PER_KIND) return;
  seen.add(value);
  list.push(value);
}

function parsePair(itemId: string): OccasionCategoryPair | null {
  const [category, subCategory] = String(itemId || "").split("/");
  if (!category) return null;
  return subCategory ? { category, subCategory } : { category };
}

function pairKey(pair: OccasionCategoryPair): string {
  return `${pair.category}::${pair.subCategory || ""}`;
}

/**
 * Builds the snapshot from the database. Exported for the smoke test; callers should use
 * `getActiveOccasionBoost()` which caches it.
 */
export async function buildOccasionBoostSnapshot(todayIso: string = todayInTimeZone(OCCASIONS_TIME_ZONE)): Promise<OccasionBoostSnapshot> {
  const rows: OccasionWithItems[] = await prisma.occasion.findMany({
    where: { enabled: true, boostEnabled: true },
    include: { items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });

  const active = rows
    .map((row) => ({ row, boost: resolveActiveBoost(row as any, todayIso) }))
    .filter((entry): entry is { row: OccasionWithItems; boost: NonNullable<typeof entry.boost> } => Boolean(entry.boost))
    // Soonest / already-running occasion first: its content wins ties everywhere below.
    .sort((a, b) => a.boost.occurrence.startIso.localeCompare(b.boost.occurrence.startIso));

  if (active.length === 0) return createEmptyOccasionBoostSnapshot(todayIso);

  const snapshot = createEmptyOccasionBoostSnapshot(todayIso);
  snapshot.isEmpty = false;
  const seen = {
    template: new Set<string>(),
    templatePair: new Set<string>(),
    hoistedPair: new Set<string>(),
    ai: new Set<string>(),
    element: new Set<string>(),
    elementCategory: new Set<string>(),
    hoistedElementCategory: new Set<string>(),
    background: new Set<string>(),
    backgroundCategory: new Set<string>(),
    hoistedBackgroundCategory: new Set<string>(),
  };

  for (const { row, boost } of active) {
    snapshot.occasions.push({
      id: row.id,
      slug: row.slug,
      titleEn: row.titleEn,
      titleAr: row.titleAr,
      startIso: boost.occurrence.startIso,
      endIso: boost.occurrence.endIso,
      phase: boost.phase,
      hoistCategories: row.hoistCategories,
    });

    for (const item of row.items) {
      const itemId = String(item.itemId || "").trim();
      switch (item.kind) {
        case "template":
          if (isUuid(itemId)) pushUnique(snapshot.templateIds, seen.template, itemId.toLowerCase());
          break;
        case "template-category": {
          const pair = parsePair(itemId);
          if (!pair) break;
          const key = pairKey(pair);
          if (!seen.templatePair.has(key)) {
            seen.templatePair.add(key);
            snapshot.templateCategoryPairs.push(pair);
          }
          if (row.hoistCategories && !seen.hoistedPair.has(key)) {
            seen.hoistedPair.add(key);
            snapshot.hoistedTemplateCategoryPairs.push(pair);
          }
          break;
        }
        case "ai-template":
          if (isUuid(itemId)) {
            pushUnique(snapshot.aiTemplateIds, seen.ai, itemId.toLowerCase());
            if (row.hoistCategories) snapshot.aiTemplateHoistIdSet.add(itemId.toLowerCase());
          }
          break;
        case "ai-category":
          if (row.hoistCategories && itemId) snapshot.aiCategorySlugSet.add(itemId);
          break;
        case "element":
          if (isUuid(itemId)) pushUnique(snapshot.elementIds, seen.element, itemId.toLowerCase());
          break;
        case "element-category":
          pushUnique(snapshot.elementCategoryKeys, seen.elementCategory, itemId.toLowerCase());
          if (row.hoistCategories) pushUnique(snapshot.hoistedElementCategoryKeys, seen.hoistedElementCategory, itemId.toLowerCase());
          break;
        case "background":
          if (isUuid(itemId)) pushUnique(snapshot.backgroundIds, seen.background, itemId.toLowerCase());
          break;
        case "background-category":
          pushUnique(snapshot.backgroundCategoryKeys, seen.backgroundCategory, itemId.toLowerCase());
          if (row.hoistCategories) pushUnique(snapshot.hoistedBackgroundCategoryKeys, seen.hoistedBackgroundCategory, itemId.toLowerCase());
          break;
        default:
          break;
      }
    }
  }

  snapshot.templateIdSet = new Set(snapshot.templateIds);
  snapshot.aiTemplateIdSet = new Set(snapshot.aiTemplateIds);

  // Which rails hold each boosted template — resolved once here so the home feed never has
  // to select `categories` per rail. No status filter: the audience filter is applied at
  // request time by the route's own `where`.
  if (snapshot.templateIds.length > 0) {
    const [placements, taxonomySettings]: [Array<{ id: string; category: string; subCategory: string; categories: unknown }>, unknown] = await Promise.all([
      prisma.template.findMany({
        where: { id: { in: snapshot.templateIds } },
        select: { id: true, category: true, subCategory: true, categories: true },
      }),
      getTemplateTaxonomySettings(),
    ]);
    const rank = new Map(snapshot.templateIds.map((id, index) => [id, index]));
    const sorted = [...placements].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    for (const row of sorted) {
      for (const pair of resolveTemplateCategoryPairs(row, taxonomySettings as any)) {
        const key = `${pair.category}::${pair.subCategory}`;
        const list = snapshot.templateIdsByPair[key] || (snapshot.templateIdsByPair[key] = []);
        if (!list.includes(row.id)) list.push(row.id);
      }
    }
  }

  snapshot.hasTemplateBoost = snapshot.templateIds.length > 0 || snapshot.templateCategoryPairs.length > 0;
  snapshot.hasAiBoost = snapshot.aiTemplateIds.length > 0 || snapshot.aiCategorySlugSet.size > 0;
  snapshot.hasElementBoost = snapshot.elementIds.length > 0 || snapshot.elementCategoryKeys.length > 0;
  snapshot.hasBackgroundBoost = snapshot.backgroundIds.length > 0 || snapshot.backgroundCategoryKeys.length > 0;
  snapshot.isEmpty = !(snapshot.hasTemplateBoost || snapshot.hasAiBoost || snapshot.hasElementBoost || snapshot.hasBackgroundBoost);
  return snapshot;
}

/** The cached snapshot for today. Never throws. */
export async function getActiveOccasionBoost(): Promise<OccasionBoostSnapshot> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  try {
    const value = await buildOccasionBoostSnapshot();
    cached = { value, expiresAt: now + OCCASION_BOOST_CACHE_TTL_MS };
    return value;
  } catch {
    const value = createEmptyOccasionBoostSnapshot();
    cached = { value, expiresAt: now + OCCASION_BOOST_CACHE_TTL_MS };
    return value;
  }
}
