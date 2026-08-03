import prisma from "@/lib/prisma";

// Data layer for mobile users' favorite templates. A favorite is a (mobileUser,
// template) pair: a user saves a template id to revisit it later. Rows cascade
// away automatically when either the user or the template is deleted.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

// Minimal template columns needed to render a favorite in a list without a
// second round trip. The heavy localized summary lives behind the catalog
// endpoints; here we expose raw, stable fields plus a thumbnail URL.
const FAVORITE_TEMPLATE_SELECT = {
  id: true,
  name: true,
  status: true,
  category: true,
  subCategory: true,
  canvasSize: true,
  pageCount: true,
  updatedAt: true,
};

export function isValidTemplateId(value) {
  return UUID_PATTERN.test(String(value || "").trim());
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampPage(value) {
  const parsed = Math.floor(numberOr(value, 1));
  return parsed >= 1 ? parsed : 1;
}

function clampPageSize(value) {
  const parsed = Math.floor(numberOr(value, DEFAULT_PAGE_SIZE));
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function buildThumbnailUrl(templateId, origin) {
  const path = `/api/mobile/templates/${templateId}/assets?scope=thumbnail`;
  const base = String(origin || "").trim();
  return base ? `${base}${path}` : path;
}

function serializeFavoriteTemplate(template, origin) {
  if (!template) return null;
  const canvasSize = template.canvasSize || {};
  return {
    id: String(template.id || ""),
    title: String(template.name || "Untitled"),
    status: String(template.status || "draft"),
    category: String(template.category || "general"),
    subCategory: String(template.subCategory || "general"),
    canvasWidth: Math.max(numberOr(canvasSize.width, 1080), 1),
    canvasHeight: Math.max(numberOr(canvasSize.height, 1080), 1),
    pageCount: Math.max(1, Math.round(numberOr(template.pageCount, 1))),
    thumbnailUrl: buildThumbnailUrl(template.id, origin),
    updatedAt: new Date(template.updatedAt || Date.now()).getTime(),
  };
}

function serializeFavorite(row, origin) {
  return {
    id: String(row.id || ""),
    templateId: String(row.templateId || ""),
    favoritedAt: new Date(row.createdAt || Date.now()).getTime(),
    template: serializeFavoriteTemplate(row.template, origin),
  };
}

/**
 * Resolve a template that is eligible to be favorited. Only published templates
 * are favoritable, mirroring what the mobile catalog exposes. Returns the
 * template id when allowed, otherwise null.
 */
export async function findFavoritableTemplate(templateId) {
  const id = String(templateId || "").trim();
  if (!isValidTemplateId(id)) return null;
  return prisma.template.findFirst({
    where: { id, status: "published" },
    select: { id: true },
  });
}

export async function getFavorite({ mobileUserId, templateId, origin } = {}) {
  const userId = String(mobileUserId || "").trim();
  const id = String(templateId || "").trim();
  if (!userId || !isValidTemplateId(id)) return null;

  const row = await prisma.mobileFavoriteTemplate.findUnique({
    where: { mobileUserId_templateId: { mobileUserId: userId, templateId: id } },
    include: { template: { select: FAVORITE_TEMPLATE_SELECT } },
  });
  return row ? serializeFavorite(row, origin) : null;
}

/**
 * Add a favorite for a user. Idempotent: favoriting an already-favorited
 * template returns the existing row with `created: false` instead of erroring.
 */
export async function addFavorite({ mobileUserId, templateId, origin } = {}) {
  const userId = String(mobileUserId || "").trim();
  const id = String(templateId || "").trim();

  const existing = await prisma.mobileFavoriteTemplate.findUnique({
    where: { mobileUserId_templateId: { mobileUserId: userId, templateId: id } },
    include: { template: { select: FAVORITE_TEMPLATE_SELECT } },
  });
  if (existing) {
    return { favorite: serializeFavorite(existing, origin), created: false };
  }

  try {
    const row = await prisma.mobileFavoriteTemplate.create({
      data: { mobileUserId: userId, templateId: id },
      include: { template: { select: FAVORITE_TEMPLATE_SELECT } },
    });
    return { favorite: serializeFavorite(row, origin), created: true };
  } catch (error) {
    // Lost a race with a concurrent insert: fetch the winning row.
    if (error?.code === "P2002") {
      const row = await prisma.mobileFavoriteTemplate.findUnique({
        where: { mobileUserId_templateId: { mobileUserId: userId, templateId: id } },
        include: { template: { select: FAVORITE_TEMPLATE_SELECT } },
      });
      if (row) return { favorite: serializeFavorite(row, origin), created: false };
    }
    throw error;
  }
}

/**
 * Remove a favorite. Idempotent: returns whether a row was actually deleted so
 * the route can report it without a prior existence check.
 */
export async function removeFavorite({ mobileUserId, templateId } = {}) {
  const userId = String(mobileUserId || "").trim();
  const id = String(templateId || "").trim();
  if (!userId || !isValidTemplateId(id)) return { removed: false };

  const result = await prisma.mobileFavoriteTemplate.deleteMany({
    where: { mobileUserId: userId, templateId: id },
  });
  return { removed: result.count > 0 };
}

/**
 * List a user's favorites, newest first, with a lightweight template summary
 * inlined for each. Paginated with the same envelope the catalog endpoints use.
 */
export async function listFavorites({ mobileUserId, page, pageSize, origin } = {}) {
  const userId = String(mobileUserId || "").trim();
  const safePage = clampPage(page);
  const safePageSize = clampPageSize(pageSize);

  const where = { mobileUserId: userId };
  const total = await prisma.mobileFavoriteTemplate.count({ where });
  const totalPages = total === 0 ? 1 : Math.ceil(total / safePageSize);
  const currentPage = Math.min(safePage, totalPages);

  const rows = await prisma.mobileFavoriteTemplate.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (currentPage - 1) * safePageSize,
    take: safePageSize,
    include: { template: { select: FAVORITE_TEMPLATE_SELECT } },
  });

  return {
    favorites: rows.map((row) => serializeFavorite(row, origin)),
    page: currentPage,
    pageSize: safePageSize,
    total,
    totalPages,
    hasNextPage: currentPage < totalPages,
    hasPrevPage: currentPage > 1,
  };
}
