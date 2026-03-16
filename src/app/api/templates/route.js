import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { resizeThumbnailBufferHalf } from "@/lib/media/thumbnailResize.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findExternalCanvaReferences } from "@/lib/tools/importAssetSanitizer";
import {
  buildSnapshot,
  canAccessTemplate,
  getEditorSession,
  normalizeCanvasSize,
  normalizeCategory,
  normalizeSlug,
  normalizeSubCategory,
  normalizeTags,
} from "@/lib/templates/server";
import {
  normalizeEditorProMobileFontData,
  validateEditorProMobilePublishCompatibility,
} from "@/lib/templates/mobileCompatibility";
import { getTemplateTaxonomySettings } from "@/lib/templates/templateSettings.server";

const THUMBNAIL_BUCKET =
  process.env.TEMPLATE_THUMBNAIL_BUCKET || process.env.EDITOR_MEDIA_BUCKET || "editor-media";
const MAX_THUMBNAIL_BYTES = 12 * 1024 * 1024;
const MAX_CANVA_REFERENCE_ERRORS = 10;
const DEFAULT_LIST_PAGE_SIZE = 20;
const MAX_LIST_PAGE_SIZE = 100;
const MAX_OWNER_LOOKUPS = 50;

const TEMPLATE_LIST_SELECT = {
  id: true,
  ownerId: true,
  name: true,
  slug: true,
  status: true,
  version: true,
  canvasSize: true,
  category: true,
  subCategory: true,
  tags: true,
  thumbnailDataUrl: true,
  createdAt: true,
  updatedAt: true,
};

async function ensureUniqueSlug(baseSlug, excludeId) {
  const base = normalizeSlug(baseSlug) || `template-${Date.now()}`;
  let candidate = base;
  let counter = 1;

  while (true) {
    const existing = await prisma.template.findUnique({ where: { slug: candidate } });
    if (!existing || existing.id === excludeId) {
      return candidate;
    }
    counter += 1;
    candidate = `${base}-${counter}`;
  }
}

async function ensureUniqueName(ownerId, baseName, excludeId) {
  const normalized = String(baseName || "").trim() || `Untitled ${new Date().toISOString().slice(0, 10)}`;
  let candidate = normalized;
  let counter = 1;

  while (true) {
    const existing = await prisma.template.findFirst({
      where: {
        ownerId,
        name: candidate,
      },
      select: { id: true },
    });

    if (!existing || existing.id === excludeId) {
      return candidate;
    }

    counter += 1;
    candidate = `${normalized} (${counter})`;
  }
}

function getUserDisplayName(user) {
  const metadata = user?.user_metadata || {};
  return (
    String(metadata.full_name || metadata.name || metadata.display_name || "").trim() ||
    String(user?.email || "").trim() ||
    ""
  );
}

function extensionFromMimeType(mimeType) {
  const value = String(mimeType || "").toLowerCase();
  if (value.includes("png")) return "png";
  if (value.includes("jpeg") || value.includes("jpg")) return "jpg";
  if (value.includes("webp")) return "webp";
  if (value.includes("gif")) return "gif";
  if (value.includes("svg")) return "svg";
  return "png";
}

function parseImageDataUrl(dataUrl) {
  const raw = String(dataUrl || "").trim();
  if (!raw.startsWith("data:")) return null;

  const commaIndex = raw.indexOf(",");
  if (commaIndex <= 5) return null;

  const meta = raw.slice(5, commaIndex);
  if (!/;base64/i.test(meta)) return null;

  const mimeType = String(meta.split(";")[0] || "image/png")
    .trim()
    .toLowerCase();
  let buffer;
  try {
    buffer = Buffer.from(raw.slice(commaIndex + 1), "base64");
  } catch {
    return null;
  }
  return { mimeType, buffer };
}

function createCanvaReferenceErrorResponse(references, actionLabel = "save") {
  const list = Array.isArray(references) ? references : [];
  const trimmed = list.slice(0, MAX_CANVA_REFERENCE_ERRORS);
  const first = trimmed[0];
  const location = first?.path || "template data";

  return NextResponse.json(
    {
      error: `External Canva asset references are not allowed when attempting to ${actionLabel}.`,
      details: `Remove or rewrite Canva-hosted URLs before ${actionLabel} (${location}).`,
      references: trimmed,
    },
    { status: 422 }
  );
}

function sanitizePathSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function toPositiveInt(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function parseListPagination(searchParams) {
  const paginationRequested = searchParams.has("page") || searchParams.has("perPage");
  if (!paginationRequested) {
    return {
      paginationRequested: false,
      page: 1,
      perPage: null,
      skip: undefined,
      take: undefined,
    };
  }

  const page = toPositiveInt(searchParams.get("page"), 1);
  const perPage = Math.min(
    Math.max(toPositiveInt(searchParams.get("perPage"), DEFAULT_LIST_PAGE_SIZE), 1),
    MAX_LIST_PAGE_SIZE
  );

  return {
    paginationRequested: true,
    page,
    perPage,
    skip: (page - 1) * perPage,
    take: perPage,
  };
}

function buildTemplateListWhere({
  templateId,
  status,
  hasCategoryFilter,
  category,
  hasSubCategoryFilter,
  subCategory,
  tag,
  search,
}) {
  return {
    ...(status ? { status } : {}),
    ...(templateId ? { id: templateId } : {}),
    ...(hasCategoryFilter ? { category } : {}),
    ...(hasSubCategoryFilter ? { subCategory } : {}),
    ...(tag ? { tags: { array_contains: [tag] } } : {}),
    ...(search
      ? {
          OR: [
            {
              name: {
                contains: search,
                mode: "insensitive",
              },
            },
            {
              slug: {
                contains: search,
                mode: "insensitive",
              },
            },
          ],
        }
      : {}),
  };
}

async function attachTemplateOwnerNames(templates) {
  const ownerIds = Array.from(new Set(templates.map((template) => template.ownerId).filter(Boolean)));
  if (ownerIds.length === 0) return templates;

  const ownerMap = new Map();
  const admin = createAdminClient();
  const ownerIdsForLookup = ownerIds.slice(0, MAX_OWNER_LOOKUPS);

  await Promise.all(
    ownerIdsForLookup.map(async (ownerId) => {
      const { data, error } = await admin.auth.admin.getUserById(ownerId);
      if (error || !data?.user) return;
      ownerMap.set(ownerId, getUserDisplayName(data.user));
    })
  );

  return templates.map((template) => ({
    ...template,
    ownerName: ownerMap.get(template.ownerId) || template.ownerId?.slice(0, 8) || "Unknown",
  }));
}

function makeTemplateThumbnailPath(ownerId, slug, mimeType) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const safeSlug = sanitizePathSegment(slug) || "template";
  const unique =
    typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const ext = extensionFromMimeType(mimeType);
  return `users/${ownerId}/templates/thumbnails/${yyyy}/${mm}/${dd}/${safeSlug}-${unique}.${ext}`;
}

async function ensurePublicBucket(admin) {
  const { data, error } = await admin.storage.getBucket(THUMBNAIL_BUCKET);
  if (error) {
    const created = await admin.storage.createBucket(THUMBNAIL_BUCKET, {
      public: true,
      fileSizeLimit: `${MAX_THUMBNAIL_BYTES}`,
    });
    if (created.error && !String(created.error.message || "").toLowerCase().includes("exists")) {
      throw created.error;
    }
    return;
  }
  if (data && data.public === false) {
    await admin.storage.updateBucket(THUMBNAIL_BUCKET, {
      public: true,
      fileSizeLimit: `${MAX_THUMBNAIL_BYTES}`,
    });
  }
}

async function resolveTemplateThumbnailUrl({ thumbnailValue, ownerId, slug, fallbackUrl = null }) {
  const rawValue = String(thumbnailValue || "").trim();
  if (!rawValue) return fallbackUrl || null;

  const parsed = parseImageDataUrl(rawValue);
  if (!parsed) {
    return rawValue;
  }

  if (!parsed.mimeType.startsWith("image/")) {
    throw new Error("Template thumbnail must be an image.");
  }
  if (!parsed.buffer || parsed.buffer.length === 0) {
    throw new Error("Template thumbnail is empty.");
  }
  if (parsed.buffer.length > MAX_THUMBNAIL_BYTES) {
    throw new Error("Template thumbnail is too large.");
  }

  let thumbnailBuffer = parsed.buffer;
  let thumbnailMimeType = parsed.mimeType;
  const resizedThumbnail = await resizeThumbnailBufferHalf({
    bytes: thumbnailBuffer,
    mimeType: thumbnailMimeType,
  });
  if (resizedThumbnail.resized) {
    thumbnailBuffer = resizedThumbnail.bytes;
    thumbnailMimeType = resizedThumbnail.mimeType;
  }

  const admin = createAdminClient();
  await ensurePublicBucket(admin);

  const objectPath = makeTemplateThumbnailPath(ownerId, slug, thumbnailMimeType);
  const { error: uploadError } = await admin.storage.from(THUMBNAIL_BUCKET).upload(objectPath, thumbnailBuffer, {
    contentType: thumbnailMimeType,
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) {
    throw new Error(uploadError.message || "Failed to upload template thumbnail.");
  }

  const { data: publicUrlData } = admin.storage.from(THUMBNAIL_BUCKET).getPublicUrl(objectPath);
  const publicUrl = String(publicUrlData?.publicUrl || "").trim();
  if (!publicUrl) {
    throw new Error("Template thumbnail uploaded but URL is unavailable.");
  }

  return publicUrl;
}

export async function GET(request) {
  const session = await getEditorSession();
  if (session.error) return session.error;

  const { searchParams } = new URL(request.url);
  const templateId = String(searchParams.get("id") || "").trim();
  const taxonomySettings = await getTemplateTaxonomySettings();
  const status = searchParams.get("status");
  const category = normalizeCategory(searchParams.get("category") || "", taxonomySettings);
  const hasCategoryFilter = searchParams.has("category");
  const subCategory = normalizeSubCategory(
    searchParams.get("subCategory") || "",
    hasCategoryFilter ? category : undefined,
    taxonomySettings
  );
  const hasSubCategoryFilter = searchParams.has("subCategory");
  const tag = String(searchParams.get("tag") || "").trim().toLowerCase();
  const search = String(searchParams.get("q") || "").trim().toLowerCase();
  const pagination = parseListPagination(searchParams);

  const where = buildTemplateListWhere({
    templateId,
    status,
    hasCategoryFilter,
    category,
    hasSubCategoryFilter,
    subCategory,
    tag,
    search,
  });
  const scopedWhere =
    session.role === "admin"
      ? where
      : {
          ...where,
          ownerId: session.userId,
        };

  let templates = [];
  let total = null;

  if (pagination.paginationRequested) {
    const [items, count] = await prisma.$transaction([
      prisma.template.findMany({
        where: scopedWhere,
        orderBy: { updatedAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
        select: TEMPLATE_LIST_SELECT,
      }),
      prisma.template.count({ where: scopedWhere }),
    ]);
    templates = items;
    total = count;
  } else {
    templates = await prisma.template.findMany({
      where: scopedWhere,
      orderBy: { updatedAt: "desc" },
      select: TEMPLATE_LIST_SELECT,
    });
  }

  let templatesWithOwners = templates;
  try {
    templatesWithOwners = await attachTemplateOwnerNames(templates);
  } catch (_error) {
    templatesWithOwners = templates.map((template) => ({
      ...template,
      ownerName: template.ownerId?.slice(0, 8) || "Unknown",
    }));
  }

  if (!pagination.paginationRequested) {
    return NextResponse.json({ templates: templatesWithOwners });
  }

  return NextResponse.json({
    templates: templatesWithOwners,
    page: pagination.page,
    perPage: pagination.perPage,
    total,
    totalPages: Math.max(1, Math.ceil(Number(total || 0) / Number(pagination.perPage || 1))),
  });
}

export async function POST(request) {
  const session = await getEditorSession();
  if (session.error) return session.error;

  const body = await request.json();
  const id = typeof body?.id === "string" ? body.id : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const data = body?.data;

  if (!name || !data) {
    return NextResponse.json(
      { error: "Missing template name or data." },
      { status: 400 }
    );
  }

  const requestedSlug = normalizeSlug(body?.slug || name);
  const canvasSize = normalizeCanvasSize(body?.canvasSize);
  const taxonomySettings = await getTemplateTaxonomySettings();
  const category = normalizeCategory(body?.category, taxonomySettings);
  const subCategory = normalizeSubCategory(body?.subCategory, category, taxonomySettings);
  const tags = normalizeTags(body?.tags);
  const incomingThumbnailValue =
    typeof body?.thumbnailDataUrl === "string" ? body.thumbnailDataUrl : "";

  if (id) {
    const existing = await prisma.template.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Template not found." }, { status: 404 });
    }
    if (!canAccessTemplate(session, existing)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const previewUpdateCanvaReferences = findExternalCanvaReferences(
      {
        data,
        thumbnailDataUrl: incomingThumbnailValue || existing.thumbnailDataUrl,
      },
      { pathPrefix: "template", assetFieldsOnly: true }
    );
    if (previewUpdateCanvaReferences.length > 0) {
      return createCanvaReferenceErrorResponse(previewUpdateCanvaReferences, "save");
    }

    const slug = await ensureUniqueSlug(requestedSlug || existing.slug, id);
    const uniqueName = await ensureUniqueName(existing.ownerId, name, id);
    let thumbnailDataUrl;
    try {
      thumbnailDataUrl = await resolveTemplateThumbnailUrl({
        thumbnailValue: incomingThumbnailValue,
        ownerId: existing.ownerId,
        slug,
        fallbackUrl: existing.thumbnailDataUrl,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to process template thumbnail." },
        { status: 422 }
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.template.update({
        where: { id },
        data: {
          name: uniqueName,
          slug,
          data,
          canvasSize,
          category,
          subCategory,
          tags,
          thumbnailDataUrl,
          version: { increment: 1 },
        },
      });

      await tx.templateRevision.create({
        data: {
          templateId: item.id,
          version: item.version,
          action: "save",
          actorId: session.userId,
          snapshot: buildSnapshot(item),
        },
      });

      return item;
    });

    return NextResponse.json({ template: updated });
  }

  const previewCreateCanvaReferences = findExternalCanvaReferences(
    {
      data,
      thumbnailDataUrl: incomingThumbnailValue,
    },
    { pathPrefix: "template", assetFieldsOnly: true }
  );
  if (previewCreateCanvaReferences.length > 0) {
    return createCanvaReferenceErrorResponse(previewCreateCanvaReferences, "save");
  }

  const slug = await ensureUniqueSlug(requestedSlug);
  const uniqueName = await ensureUniqueName(session.userId, name);
  let thumbnailDataUrl;
  try {
    thumbnailDataUrl = await resolveTemplateThumbnailUrl({
      thumbnailValue: incomingThumbnailValue,
      ownerId: session.userId,
      slug,
      fallbackUrl: null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process template thumbnail." },
      { status: 422 }
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const item = await tx.template.create({
      data: {
        ownerId: session.userId,
        name: uniqueName,
        slug,
        data,
        canvasSize,
        category,
        subCategory,
        tags,
        thumbnailDataUrl,
        status: "draft",
      },
    });

    await tx.templateRevision.create({
      data: {
        templateId: item.id,
        version: item.version,
        action: "create",
        actorId: session.userId,
        snapshot: buildSnapshot(item),
      },
    });

    return item;
  });

  return NextResponse.json({ template: created }, { status: 201 });
}

export async function PATCH(request) {
  const session = await getEditorSession();
  if (session.error) return session.error;

  const body = await request.json();
  const id = typeof body?.id === "string" ? body.id : "";
  const action = typeof body?.action === "string" ? body.action : "";

  if (!id || !["publish", "unpublish"].includes(action)) {
    return NextResponse.json({ error: "Invalid publish request." }, { status: 400 });
  }

  const existing = await prisma.template.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }
  if (!canAccessTemplate(session, existing)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const publishData =
    action === "publish" ? normalizeEditorProMobileFontData(existing.data) : existing.data;
  if (action === "publish") {
    const compatibility = validateEditorProMobilePublishCompatibility(publishData);
    if (!compatibility.valid) {
      return NextResponse.json(
        {
          error: compatibility.errors[0] || "Template is not compatible with mobile publish.",
          errors: compatibility.errors,
        },
        { status: 422 }
      );
    }

    const publishCanvaReferences = findExternalCanvaReferences(
      {
        data: publishData,
        thumbnailDataUrl: existing.thumbnailDataUrl,
      },
      { pathPrefix: "template", assetFieldsOnly: true }
    );
    if (publishCanvaReferences.length > 0) {
      return createCanvaReferenceErrorResponse(publishCanvaReferences, "publish");
    }
  }

  const template = await prisma.$transaction(async (tx) => {
    const item = await tx.template.update({
      where: { id },
      data: {
        ...(action === "publish" ? { data: publishData } : {}),
        status: action === "publish" ? "published" : "draft",
        publishedAt: action === "publish" ? new Date() : null,
        version: { increment: 1 },
      },
    });

    await tx.templateRevision.create({
      data: {
        templateId: item.id,
        version: item.version,
        action,
        actorId: session.userId,
        snapshot: buildSnapshot(item),
      },
    });

    return item;
  });

  return NextResponse.json({ template });
}
