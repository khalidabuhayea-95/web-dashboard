import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { findDashboardUsersByIds } from "@/lib/auth/dashboardUsers.server";
import { hasAnimatedTemplateContent } from "@/lib/editor/animationTimeline";
import { resizeThumbnailBufferHalf } from "@/lib/media/thumbnailResize.server";
import {
  appendVersionParam,
  deleteObjects,
  getTemplateThumbnailBucketName,
  parsePublicObjectKeyFromUrl,
  restorePublicObjectUrlsFromClient,
  restorePublicObjectUrlFromClient,
  rewritePublicObjectUrlsForClient,
  uploadObject,
} from "@/lib/storage/objectStorage.server";
import { findExternalCanvaReferences } from "@/lib/tools/importAssetSanitizer";
import {
  buildSnapshot,
  canAccessTemplate,
  getEditorSession,
  mapTemplatePreview,
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
import { handleApiError, handleBadRequest, handleNotFound, handleForbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";
import { extractFabricData } from "@/lib/templates/editorData";

const THUMBNAIL_BUCKET = getTemplateThumbnailBucketName();
const MAX_THUMBNAIL_BYTES = 12 * 1024 * 1024;
const MAX_CANVA_REFERENCE_ERRORS = 10;
const DEFAULT_LIST_PAGE_SIZE = 20;
const MAX_LIST_PAGE_SIZE = 100;
const MAX_OWNER_LOOKUPS = 50;
const PREVIEW_STATUS_VALUES = new Set(["not_requested", "queued", "processing", "ready", "failed"]);
const OVERWRITABLE_TEMPLATE_MEDIA_CACHE_CONTROL = "public, max-age=60, must-revalidate";

const TEMPLATE_LIST_SELECT: any = {
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
  previewVideoUrl: true,
  previewPosterUrl: true,
  previewStatus: true,
  previewDurationMs: true,
  previewVersion: true,
  previewError: true,
  previewUpdatedAt: true,
  createdAt: true,
  updatedAt: true,
};

function jsonForEditorClient(body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(rewritePublicObjectUrlsForClient(body), init);
}

async function ensureUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
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

async function ensureUniqueName(ownerId: string, baseName: string, excludeId?: string): Promise<string> {
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

function withTemplatePreview(template: any) {
  const updatedAt =
    template?.updatedAt instanceof Date
      ? template.updatedAt.getTime()
      : template?.updatedAt
        ? new Date(template.updatedAt).getTime()
        : NaN;
  const previewUpdatedAt =
    template?.previewUpdatedAt instanceof Date
      ? template.previewUpdatedAt.getTime()
      : template?.previewUpdatedAt
        ? new Date(template.previewUpdatedAt).getTime()
        : NaN;
  const previewVersionToken = Number.isFinite(previewUpdatedAt)
    ? String(previewUpdatedAt)
    : String(template?.previewVersion || "").trim();

  return {
    ...template,
    thumbnailDataUrl: appendVersionParam(
      template?.thumbnailDataUrl,
      Number.isFinite(updatedAt) ? String(updatedAt) : String(template?.version || "")
    ),
    previewVideoUrl: appendVersionParam(template?.previewVideoUrl, previewVersionToken),
    previewPosterUrl: appendVersionParam(template?.previewPosterUrl, previewVersionToken),
    preview: mapTemplatePreview(template),
  };
}

function asPlainObject(value: any): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function extractEditorPages(data: any): Array<Record<string, any>> {
  if (Array.isArray(data?.pages)) return data.pages;
  const extracted = extractFabricData(data);
  if (Array.isArray(extracted?.pages)) return extracted.pages;
  if (Array.isArray(data?.data?.pages)) return data.data.pages;
  if (Array.isArray(extracted?.objects)) {
    return [
      {
        durationMs: data?.timeline?.totalDurationMs,
        elements: extracted.objects,
      },
    ];
  }
  return [];
}

function normalizePreviewStatus(value: unknown) {
  const status = String(value || "").trim().toLowerCase();
  return PREVIEW_STATUS_VALUES.has(status) ? status : null;
}

function normalizePreviewFields(input: any) {
  const preview = asPlainObject(input);
  if (!preview) return null;
  const status = normalizePreviewStatus(preview.status);
  const url = String(preview.url || "").trim();
  const posterUrl = String(preview.posterUrl || "").trim();
  const durationMs = Number(preview.durationMs);
  const version = Number(preview.version);
  const error = String(preview.error || "").trim();
  const updatedAtRaw = preview.updatedAt;
  const updatedAt =
    updatedAtRaw instanceof Date
      ? updatedAtRaw
      : updatedAtRaw
        ? new Date(updatedAtRaw)
        : null;

  if (!status && !url && !posterUrl && !Number.isFinite(durationMs) && !Number.isFinite(version) && !error && !updatedAt) {
    return null;
  }

  return {
    previewVideoUrl: url || null,
    previewPosterUrl: posterUrl || null,
    previewStatus: status || null,
    previewDurationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null,
    previewVersion: Number.isFinite(version) ? Math.max(0, Math.round(version)) : null,
    previewError: error || null,
    previewUpdatedAt: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null,
  };
}

function buildTemplatePreviewUpdate({
  data,
  thumbnailDataUrl,
  existingTemplate,
}: {
  data: any;
  thumbnailDataUrl: string | null;
  existingTemplate?: any;
}) {
  const pages = extractEditorPages(data);
  const timeline = asPlainObject(data?.timeline);
  const isMotionTemplate = hasAnimatedTemplateContent(pages as any, timeline as any);
  const incomingPreview = normalizePreviewFields(timeline?.preview);

  if (!isMotionTemplate) {
    return {
      previewVideoUrl: null,
      previewPosterUrl: null,
      previewStatus: null,
      previewDurationMs: null,
      previewVersion: null,
      previewError: null,
      previewUpdatedAt: null,
    };
  }

  const nextPreviewVersion = existingTemplate ? Math.max(1, Number(existingTemplate.version || 0) + 1) : 1;
  if (!incomingPreview) {
    return {
      previewVideoUrl: null,
      previewPosterUrl:
        thumbnailDataUrl ??
        existingTemplate?.previewPosterUrl ??
        existingTemplate?.thumbnailDataUrl ??
        null,
      previewStatus: "queued",
      previewDurationMs: null,
      previewVersion: nextPreviewVersion,
      previewError: null,
      previewUpdatedAt: null,
    };
  }

  return {
    previewVideoUrl: incomingPreview?.previewVideoUrl ?? null,
    previewPosterUrl:
      incomingPreview?.previewPosterUrl ??
      thumbnailDataUrl ??
      null,
    previewStatus:
      incomingPreview?.previewStatus ??
      "queued",
    previewDurationMs:
      incomingPreview?.previewDurationMs ??
      null,
    previewVersion:
      incomingPreview?.previewVersion ??
      nextPreviewVersion,
    previewError:
      incomingPreview?.previewError ??
      null,
    previewUpdatedAt:
      incomingPreview?.previewUpdatedAt ??
      null,
  };
}

function buildTemplatePreviewTimelinePatch(input: {
  status?: string | null;
  url?: string | null;
  posterUrl?: string | null;
  generatedAt?: Date | null;
  error?: string | null;
}) {
  return {
    status: String(input.status || "").trim() || "not_requested",
    url: String(input.url || "").trim() || null,
    posterUrl: String(input.posterUrl || "").trim() || null,
    generatedAt: input.generatedAt ? input.generatedAt.toISOString() : null,
    error: String(input.error || "").trim() || null,
  };
}

function applyPreviewPatchToTemplateData(data: any, input: {
  status?: string | null;
  url?: string | null;
  posterUrl?: string | null;
  generatedAt?: Date | null;
  error?: string | null;
}) {
  const plainData = asPlainObject(data) || {};
  const timeline = asPlainObject(plainData.timeline) || {};
  return {
    ...plainData,
    timeline: {
      ...timeline,
      preview: buildTemplatePreviewTimelinePatch(input),
    },
  };
}

function getUserDisplayName(user: any): string {
  return (
    String(user?.name || "").trim() ||
    String(user?.email || "").trim() ||
    ""
  );
}

function extensionFromMimeType(mimeType: string): string {
  const value = String(mimeType || "").toLowerCase();
  if (value.includes("png")) return "png";
  if (value.includes("jpeg") || value.includes("jpg")) return "jpg";
  if (value.includes("webp")) return "webp";
  if (value.includes("gif")) return "gif";
  if (value.includes("svg")) return "svg";
  return "png";
}

interface ParsedImageDataUrl {
  mimeType: string;
  buffer: Buffer;
}

function parseImageDataUrl(dataUrl: string): ParsedImageDataUrl | null {
  const raw = String(dataUrl || "").trim();
  if (!raw.startsWith("data:")) return null;

  const commaIndex = raw.indexOf(",");
  if (commaIndex <= 5) return null;

  const meta = raw.slice(5, commaIndex);
  if (!/;base64/i.test(meta)) return null;

  const mimeType = String(meta.split(";")[0] || "image/png")
    .trim()
    .toLowerCase();
  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw.slice(commaIndex + 1), "base64");
  } catch {
    return null;
  }
  return { mimeType, buffer };
}

function createCanvaReferenceErrorResponse(references: any[], actionLabel = "save") {
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

function sanitizePathSegment(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function toPositiveInt(value: any, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

interface ParsedPagination {
  paginationRequested: boolean;
  page: number;
  perPage: number | null;
  skip: number | undefined;
  take: number | undefined;
}

function parseListPagination(searchParams: URLSearchParams): ParsedPagination {
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

interface TemplateListWhereInput {
  templateId?: string;
  status?: string | null;
  hasCategoryFilter: boolean;
  category?: string;
  hasSubCategoryFilter: boolean;
  subCategory?: string;
  tag?: string;
  search?: string;
}

function buildTemplateListWhere(input: TemplateListWhereInput): any {
  const { templateId, status, hasCategoryFilter, category, hasSubCategoryFilter, subCategory, tag, search } = input;
  
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

async function attachTemplateOwnerNames(templates: any[]): Promise<any[]> {
  const ownerIds = Array.from(new Set(templates.map((template) => template.ownerId).filter(Boolean)));
  if (ownerIds.length === 0) return templates;

  const ownerMap = new Map<string, string>();
  const ownerIdsForLookup = ownerIds.slice(0, MAX_OWNER_LOOKUPS);
  const owners = await findDashboardUsersByIds(ownerIdsForLookup);
  owners.forEach((owner) => {
    ownerMap.set(owner.id, getUserDisplayName(owner));
  });

  return templates.map((template) => ({
    ...template,
    ownerName: ownerMap.get(template.ownerId) || template.ownerId?.slice(0, 8) || "Unknown",
  }));
}

function makeTemplateThumbnailPath(ownerId: string, templateId: string, mimeType: string): string {
  const safeTemplateId = sanitizePathSegment(templateId) || "template";
  const ext = extensionFromMimeType(mimeType);
  return `users/${ownerId}/templates/thumbnails/${safeTemplateId}/thumbnail.${ext}`;
}

interface ResolveThumbnailInput {
  thumbnailValue: string;
  ownerId: string;
  templateId: string;
  fallbackUrl?: string | null;
}

async function resolveTemplateThumbnailUrl(input: ResolveThumbnailInput): Promise<string | null> {
  const { thumbnailValue, ownerId, templateId, fallbackUrl = null } = input;
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

  const objectPath = makeTemplateThumbnailPath(ownerId, templateId, thumbnailMimeType);
  const uploaded = await uploadObject({
    bucket: THUMBNAIL_BUCKET,
    key: objectPath,
    body: thumbnailBuffer,
    contentType: thumbnailMimeType,
    cacheControl: OVERWRITABLE_TEMPLATE_MEDIA_CACHE_CONTROL,
    upsert: true,
  });
  const publicUrl = String(uploaded.url || "").trim();
  if (!publicUrl) {
    throw new Error("Template thumbnail uploaded but URL is unavailable.");
  }

  const previousObjectPath = parsePublicObjectKeyFromUrl(fallbackUrl);
  if (previousObjectPath && previousObjectPath !== objectPath) {
    deleteObjects(THUMBNAIL_BUCKET, [previousObjectPath]).catch((error) => {
      logger.warn("Failed to delete previous template thumbnail", {
        previousObjectPath,
        nextObjectPath: objectPath,
        error: error instanceof Error ? error.message : String(error || ""),
      });
    });
  }

  return publicUrl;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
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

    logger.info("Listing templates", {
      userId: session.userId,
      filters: { status, category, tag, search: search ? "yes" : "no" },
      pagination: pagination.paginationRequested,
    });

    let templates: any[] = [];
    let total: number | null = null;

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
      return jsonForEditorClient({ templates: templatesWithOwners.map(withTemplatePreview) });
    }

    return jsonForEditorClient({
      templates: templatesWithOwners.map(withTemplatePreview),
      page: pagination.page,
      perPage: pagination.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(Number(total || 0) / Number(pagination.perPage || 1))),
    });
  } catch (error) {
    return handleApiError(error, "Failed to list templates");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const id = typeof body?.id === "string" ? body.id : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const data = restorePublicObjectUrlsFromClient(body?.data);

    if (!name || !data) {
      return handleBadRequest("Missing template name or data");
    }

    const requestedSlug = normalizeSlug(body?.slug || name);
    const canvasSize = normalizeCanvasSize(body?.canvasSize);
    const taxonomySettings = await getTemplateTaxonomySettings();
    const category = normalizeCategory(body?.category, taxonomySettings);
    const subCategory = normalizeSubCategory(body?.subCategory, category, taxonomySettings);
    const tags = normalizeTags(body?.tags);
    const incomingThumbnailValue =
      typeof body?.thumbnailDataUrl === "string"
        ? restorePublicObjectUrlFromClient(body.thumbnailDataUrl)
        : "";

    if (id) {
      // Update existing template
      const existing = await prisma.template.findUnique({ where: { id } });
      if (!existing) {
        return handleNotFound("Template not found");
      }
      if (!canAccessTemplate(session, existing)) {
        return handleForbidden("Cannot update this template");
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
      let thumbnailDataUrl: string | null;
      try {
        thumbnailDataUrl = await resolveTemplateThumbnailUrl({
          thumbnailValue: incomingThumbnailValue,
          ownerId: existing.ownerId,
          templateId: existing.id,
          fallbackUrl: existing.thumbnailDataUrl,
        });
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Failed to process template thumbnail." },
          { status: 422 }
        );
      }
      const previewUpdate = buildTemplatePreviewUpdate({
        data,
        thumbnailDataUrl,
        existingTemplate: existing,
      });

      logger.info("Updating template", { userId: session.userId, templateId: id });

      const updated = await prisma.$transaction(async (tx: any) => {
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
            ...previewUpdate,
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

      return jsonForEditorClient({ template: withTemplatePreview(updated) });
    }

    // Create new template
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
    const newTemplateId = randomUUID();
    let thumbnailDataUrl: string | null;
    try {
      thumbnailDataUrl = await resolveTemplateThumbnailUrl({
        thumbnailValue: incomingThumbnailValue,
        ownerId: session.userId,
        templateId: newTemplateId,
        fallbackUrl: null,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to process template thumbnail." },
        { status: 422 }
      );
    }
    const previewUpdate = buildTemplatePreviewUpdate({
      data,
      thumbnailDataUrl,
    });

    logger.info("Creating new template", { userId: session.userId, name });

    const created = await prisma.$transaction(async (tx: any) => {
      const item = await tx.template.create({
        data: {
          id: newTemplateId,
          ownerId: session.userId,
          name: uniqueName,
          slug,
          data,
          canvasSize,
          category,
          subCategory,
          tags,
          thumbnailDataUrl,
          ...previewUpdate,
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

    return jsonForEditorClient({ template: withTemplatePreview(created) }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "Failed to save template");
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const id = typeof body?.id === "string" ? body.id : "";
    const action = typeof body?.action === "string" ? body.action : "";

    if (!id || !["publish", "unpublish", "updatePreview"].includes(action)) {
      return handleBadRequest("Invalid template update request");
    }

    const existing = await prisma.template.findUnique({ where: { id } });
    if (!existing) {
      return handleNotFound("Template not found");
    }
    if (!canAccessTemplate(session, existing)) {
      return handleForbidden("Cannot publish this template");
    }

    if (action === "updatePreview") {
      const previewInput = restorePublicObjectUrlsFromClient(body?.preview);
      const clearPreview = previewInput === null;
      const normalizedPreview = clearPreview ? null : normalizePreviewFields(previewInput);

      if (!clearPreview && !normalizedPreview) {
        return handleBadRequest("Invalid preview payload");
      }

      const requestedVersion = Number(
        clearPreview ? existing.version : normalizedPreview?.previewVersion
      );
      if (
        Number.isFinite(requestedVersion) &&
        requestedVersion > 0 &&
        requestedVersion < Number(existing.version || 0)
      ) {
        return jsonForEditorClient(
          {
            error: "Preview update is stale for the current template version.",
            template: withTemplatePreview(existing),
          },
          { status: 409 }
        );
      }

      const previewUpdatedAt =
        clearPreview
          ? null
          : normalizedPreview?.previewUpdatedAt instanceof Date
            ? normalizedPreview.previewUpdatedAt
            : new Date();
      const nextPreviewPatch = clearPreview
        ? {
            previewVideoUrl: null,
            previewPosterUrl: null,
            previewStatus: null,
            previewDurationMs: null,
            previewVersion: null,
            previewError: null,
            previewUpdatedAt: null,
          }
        : {
            previewVideoUrl: normalizedPreview?.previewVideoUrl ?? null,
            previewPosterUrl: normalizedPreview?.previewPosterUrl ?? null,
            previewStatus: normalizedPreview?.previewStatus ?? "not_requested",
            previewDurationMs: normalizedPreview?.previewDurationMs ?? null,
            previewVersion: normalizedPreview?.previewVersion ?? existing.version,
            previewError:
              normalizedPreview?.previewStatus === "ready"
                ? null
                : normalizedPreview?.previewError ?? null,
            previewUpdatedAt,
          };

      const updated = await prisma.template.update({
        where: { id },
        data: {
          ...nextPreviewPatch,
          data: applyPreviewPatchToTemplateData(existing.data, {
            status: nextPreviewPatch.previewStatus,
            url: nextPreviewPatch.previewVideoUrl,
            posterUrl: nextPreviewPatch.previewPosterUrl,
            generatedAt: nextPreviewPatch.previewUpdatedAt,
            error: nextPreviewPatch.previewError,
          }),
        },
      });

      return jsonForEditorClient({ template: withTemplatePreview(updated) });
    }

    const publishData = action === "publish" ? normalizeEditorProMobileFontData(existing.data) : existing.data;
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

    logger.info("Publishing template", { userId: session.userId, templateId: id, action });

    const template = await prisma.$transaction(async (tx: any) => {
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

    return jsonForEditorClient({ template: withTemplatePreview(template) });
  } catch (error) {
    return handleApiError(error, "Failed to publish template");
  }
}
