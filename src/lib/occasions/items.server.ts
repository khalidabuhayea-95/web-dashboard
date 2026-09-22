/**
 * Linked content of an occasion. The targets live in four different stores (Prisma
 * templates / AI templates, two @@ignore'd raw-SQL asset tables, and three category
 * settings blobs), so this module owns the per-kind lookups: proving a target exists
 * before it is linked, and hydrating linked rows with a title + thumbnail for the
 * dashboard. Dangling links (the target was deleted later) come back `missing` and the
 * GET route deletes them, so nothing else in the codebase has to know about occasions.
 */
import prisma from "@/lib/prisma";
import { getBackgroundCategorySettings } from "@/lib/backgrounds/categorySettings.server";
import { getElementCategorySettings } from "@/lib/elements/categorySettings.server";
import { getTemplateTaxonomySettings } from "@/lib/templates/templateSettings.server";

import { invalidateOccasionBoostCache } from "./boost.server";
import { OccasionValidationError, type OccasionItemKind } from "./validate";

export interface OccasionItemRow {
  id: string;
  occasionId: string;
  kind: string;
  itemId: string;
  sortOrder: number;
  createdAt: Date;
}

export interface HydratedOccasionItem {
  id: string;
  occasionId: string;
  kind: OccasionItemKind;
  itemId: string;
  sortOrder: number;
  title: string;
  titleAr: string;
  subtitle: string;
  thumbnailUrl: string | null;
  missing: boolean;
}

type CategoryEntry = { value: string; labelEn?: string; labelAr?: string; subCategories?: CategoryEntry[] };

function labelOf(entry: CategoryEntry | null | undefined, locale: "en" | "ar"): string {
  if (!entry) return "";
  const en = String(entry.labelEn || "").trim();
  const ar = String(entry.labelAr || "").trim();
  return locale === "ar" ? ar || en || entry.value : en || ar || entry.value;
}

function findTemplateCategory(settings: CategoryEntry[], key: string) {
  const [category, subCategory] = key.split("/");
  const entry = settings.find((item) => String(item.value || "") === category) || null;
  if (!entry) return null;
  if (!subCategory) return { entry, sub: null };
  const sub = (entry.subCategories || []).find((item) => String(item.value || "") === subCategory) || null;
  return sub ? { entry, sub } : null;
}

async function loadAssetRows(table: "editor_element_assets" | "editor_background_assets", ids: string[]) {
  if (ids.length === 0) return new Map<string, any>();
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT id, title_en, title_ar, thumbnail_url, asset_url, category_value FROM ${table} WHERE id = ANY($1::uuid[])`,
      ids
    )) as any[];
    return new Map(rows.map((row) => [String(row.id), row]));
  } catch {
    // The asset tables are created lazily by their importers; before that, nothing is linked.
    return new Map<string, any>();
  }
}

/** Does the target of a link actually exist right now? */
export async function occasionItemTargetExists(kind: OccasionItemKind, itemId: string): Promise<boolean> {
  switch (kind) {
    case "template":
      return Boolean(await prisma.template.findUnique({ where: { id: itemId }, select: { id: true } }));
    case "ai-template":
      return Boolean(await prisma.aiTemplate.findUnique({ where: { id: itemId }, select: { id: true } }));
    case "ai-category":
      return Boolean(await prisma.aiTemplateCategory.findUnique({ where: { slug: itemId }, select: { id: true } }));
    case "template-category":
      return Boolean(findTemplateCategory((await getTemplateTaxonomySettings()) as CategoryEntry[], itemId));
    case "element-category":
      return ((await getElementCategorySettings()) as CategoryEntry[]).some((item) => item.value === itemId);
    case "background-category":
      return ((await getBackgroundCategorySettings()) as CategoryEntry[]).some((item) => item.value === itemId);
    case "element":
      return (await loadAssetRows("editor_element_assets", [itemId])).has(itemId);
    case "background":
      return (await loadAssetRows("editor_background_assets", [itemId])).has(itemId);
    default:
      return false;
  }
}

/** Resolves titles + thumbnails for a batch of links; unknown targets come back `missing`. */
export async function hydrateOccasionItems(items: OccasionItemRow[]): Promise<HydratedOccasionItem[]> {
  const byKind = new Map<string, string[]>();
  for (const item of items) {
    const list = byKind.get(item.kind) || [];
    list.push(item.itemId);
    byKind.set(item.kind, list);
  }
  const ids = (kind: string) => Array.from(new Set(byKind.get(kind) || []));

  const [templates, aiTemplates, aiCategories, elements, backgrounds, taxonomy, elementCategories, backgroundCategories] =
    await Promise.all([
      ids("template").length
        ? prisma.template.findMany({
            where: { id: { in: ids("template") } },
            select: { id: true, name: true, status: true, category: true, subCategory: true, thumbnailDataUrl: true },
          })
        : [],
      ids("ai-template").length
        ? prisma.aiTemplate.findMany({
            where: { id: { in: ids("ai-template") } },
            select: { id: true, titleEn: true, titleAr: true, thumbUrl: true, afterUrl: true, published: true, category: { select: { titleEn: true } } },
          })
        : [],
      ids("ai-category").length
        ? prisma.aiTemplateCategory.findMany({ where: { slug: { in: ids("ai-category") } }, select: { slug: true, titleEn: true, titleAr: true } })
        : [],
      loadAssetRows("editor_element_assets", ids("element")),
      loadAssetRows("editor_background_assets", ids("background")),
      byKind.has("template-category") ? getTemplateTaxonomySettings() : [],
      byKind.has("element-category") ? getElementCategorySettings() : [],
      byKind.has("background-category") ? getBackgroundCategorySettings() : [],
    ]);

  const templateById = new Map(templates.map((row: any) => [row.id, row]));
  const aiById = new Map(aiTemplates.map((row: any) => [row.id, row]));
  const aiCategoryBySlug = new Map(aiCategories.map((row: any) => [row.slug, row]));

  return items.map((item) => {
    const base = {
      id: item.id,
      occasionId: item.occasionId,
      kind: item.kind as OccasionItemKind,
      itemId: item.itemId,
      sortOrder: item.sortOrder,
      title: "",
      titleAr: "",
      subtitle: "",
      thumbnailUrl: null as string | null,
      missing: true,
    };
    switch (item.kind) {
      case "template": {
        const row: any = templateById.get(item.itemId);
        if (!row) return base;
        return { ...base, missing: false, title: row.name, subtitle: `${row.status} · ${row.category}/${row.subCategory}`, thumbnailUrl: row.thumbnailDataUrl || null };
      }
      case "ai-template": {
        const row: any = aiById.get(item.itemId);
        if (!row) return base;
        return { ...base, missing: false, title: row.titleEn, titleAr: row.titleAr, subtitle: `${row.category?.titleEn || ""}${row.published ? "" : " · hidden"}`, thumbnailUrl: row.thumbUrl || row.afterUrl || null };
      }
      case "ai-category": {
        const row: any = aiCategoryBySlug.get(item.itemId);
        if (!row) return base;
        return { ...base, missing: false, title: row.titleEn, titleAr: row.titleAr, subtitle: "AI category" };
      }
      case "element": {
        const row = elements.get(item.itemId);
        if (!row) return base;
        return { ...base, missing: false, title: String(row.title_en || row.title_ar || "Element"), titleAr: String(row.title_ar || ""), subtitle: String(row.category_value || ""), thumbnailUrl: row.thumbnail_url || row.asset_url || null };
      }
      case "background": {
        const row = backgrounds.get(item.itemId);
        if (!row) return base;
        return { ...base, missing: false, title: String(row.title_en || row.title_ar || "Background"), titleAr: String(row.title_ar || ""), subtitle: String(row.category_value || ""), thumbnailUrl: row.thumbnail_url || row.asset_url || null };
      }
      case "template-category": {
        const found = findTemplateCategory(taxonomy as CategoryEntry[], item.itemId);
        if (!found) return base;
        const title = found.sub ? `${labelOf(found.entry, "en")} › ${labelOf(found.sub, "en")}` : labelOf(found.entry, "en");
        const titleAr = found.sub ? `${labelOf(found.entry, "ar")} › ${labelOf(found.sub, "ar")}` : labelOf(found.entry, "ar");
        return { ...base, missing: false, title, titleAr, subtitle: found.sub ? "Template sub-category" : "Template category" };
      }
      case "element-category": {
        const entry = (elementCategories as CategoryEntry[]).find((row) => row.value === item.itemId);
        if (!entry) return base;
        return { ...base, missing: false, title: labelOf(entry, "en"), titleAr: labelOf(entry, "ar"), subtitle: "Element category", thumbnailUrl: (entry as any).thumbnailUrl || null };
      }
      case "background-category": {
        const entry = (backgroundCategories as CategoryEntry[]).find((row) => row.value === item.itemId);
        if (!entry) return base;
        return { ...base, missing: false, title: labelOf(entry, "en"), titleAr: labelOf(entry, "ar"), subtitle: "Background category", thumbnailUrl: (entry as any).thumbnailUrl || null };
      }
      default:
        return base;
    }
  });
}

export async function listOccasionItems(occasionId: string): Promise<OccasionItemRow[]> {
  return prisma.occasionItem.findMany({
    where: { occasionId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Hydrated links for the dashboard. Links whose target no longer exists are deleted on
 * the way out (self-healing read), so a template deleted from the editor never leaves a
 * ghost on the occasion page.
 */
export async function listHydratedOccasionItems(occasionId: string): Promise<HydratedOccasionItem[]> {
  const rows = await listOccasionItems(occasionId);
  const hydrated = await hydrateOccasionItems(rows);
  const missing = hydrated.filter((item) => item.missing).map((item) => item.id);
  if (missing.length > 0) {
    await prisma.occasionItem.deleteMany({ where: { id: { in: missing } } });
    invalidateOccasionBoostCache();
  }
  return hydrated.filter((item) => !item.missing);
}

export async function linkOccasionItem(occasionId: string, kind: OccasionItemKind, itemId: string): Promise<OccasionItemRow> {
  if (!(await occasionItemTargetExists(kind, itemId))) {
    throw new OccasionValidationError("That content no longer exists");
  }
  const last = await prisma.occasionItem.findFirst({
    where: { occasionId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const row = await prisma.occasionItem.upsert({
    where: { occasionId_kind_itemId: { occasionId, kind, itemId } },
    create: { occasionId, kind, itemId, sortOrder: (last?.sortOrder ?? -1) + 1 },
    update: {},
  });
  invalidateOccasionBoostCache();
  return row;
}

export async function unlinkOccasionItem(occasionId: string, linkId: string): Promise<boolean> {
  const removed = await prisma.occasionItem.deleteMany({ where: { id: linkId, occasionId } });
  if (removed.count > 0) invalidateOccasionBoostCache();
  return removed.count > 0;
}

/** occasionId → { total, byKind } for the readiness pills, in one groupBy. */
export async function countOccasionItems(occasionIds?: string[]): Promise<Map<string, { total: number; byKind: Record<string, number> }>> {
  const grouped = await prisma.occasionItem.groupBy({
    by: ["occasionId", "kind"],
    where: occasionIds ? { occasionId: { in: occasionIds } } : undefined,
    _count: { _all: true },
  });
  const result = new Map<string, { total: number; byKind: Record<string, number> }>();
  for (const row of grouped) {
    const entry = result.get(row.occasionId) || { total: 0, byKind: {} };
    const count = Number(row._count._all || 0);
    entry.total += count;
    entry.byKind[row.kind] = (entry.byKind[row.kind] || 0) + count;
    result.set(row.occasionId, entry);
  }
  return result;
}
