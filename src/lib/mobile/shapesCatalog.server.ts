import {
  BUILTIN_SHAPE_ASSETS,
  type BuiltInShapeAsset,
} from "@/lib/editor/builtinShapes";
import {
  localizeBuiltInShapeKeywords,
  localizeBuiltInShapeName,
} from "@/lib/mobile/shapeLocalization";

export interface MobileShapeItem {
  id: string;
  name: string;
  nameEn: string;
  nameAr: string | null;
  tags: string[];
  tagsEn: string[];
  tagsAr: string[];
  assetUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
}

export interface ListMobileShapesOptions {
  request: Request | URL;
  locale: string;
  query?: string;
  page?: number;
  pageSize?: number;
}

function getBaseUrl(request: Request | URL) {
  return request instanceof URL ? request : new URL(request.url);
}

function normalizeSearchTokens(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function shapeMatchesQuery(shape: BuiltInShapeAsset, query: string) {
  const tokens = normalizeSearchTokens(query);
  if (tokens.length === 0) return true;

  const nameAr = localizeBuiltInShapeName(shape.name);
  const keywordsAr = localizeBuiltInShapeKeywords(shape.keywords);
  const haystack = [
    shape.id,
    shape.name,
    nameAr,
    shape.category,
    ...shape.keywords,
    ...keywordsAr,
  ]
    .join(" ")
    .toLowerCase();

  return tokens.every((token) => haystack.includes(token));
}

export function resolveMobileBuiltInShapeById(shapeId: string) {
  const normalizedId = String(shapeId || "").trim();
  if (!normalizedId) return null;
  return BUILTIN_SHAPE_ASSETS.find((shape) => shape.id === normalizedId) || null;
}

export function buildMobileShapeFileUrl(request: Request | URL, shapeId: string) {
  const baseUrl = getBaseUrl(request);
  return new URL(`/api/mobile/shapes/${encodeURIComponent(shapeId)}/file`, baseUrl).toString();
}

function toMobileShapeItem(shape: BuiltInShapeAsset, request: Request | URL): MobileShapeItem {
  const assetUrl = buildMobileShapeFileUrl(request, shape.id);
  const nameAr = localizeBuiltInShapeName(shape.name);
  const tagsEn = Array.isArray(shape.keywords) ? shape.keywords : [];
  const tagsAr = localizeBuiltInShapeKeywords(tagsEn);
  return {
    id: shape.id,
    name: nameAr,
    nameEn: shape.name,
    nameAr,
    tags: tagsAr,
    tagsEn,
    tagsAr,
    assetUrl,
    thumbnailUrl: assetUrl,
    width: shape.width,
    height: shape.height,
  };
}

export function listMobileBuiltInShapes(options: ListMobileShapesOptions) {
  const locale = String(options.locale || "en").trim().toLowerCase() === "ar" ? "ar" : "en";
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(options.pageSize) || 100));
  const query = String(options.query || "").trim();

  const filtered = BUILTIN_SHAPE_ASSETS.filter((shape) => shapeMatchesQuery(shape, query));
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const items = filtered
    .slice(start, start + pageSize)
    .map((shape) => {
      const item = toMobileShapeItem(shape, options.request);
      if (locale === "ar") {
        return item;
      }
      return {
        ...item,
        name: item.nameEn,
        tags: item.tagsEn,
      };
    });

  return {
    locale,
    items,
    page: safePage,
    pageSize,
    total,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPrevPage: safePage > 1,
  };
}
