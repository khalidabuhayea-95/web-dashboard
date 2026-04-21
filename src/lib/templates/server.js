import { NextResponse } from "next/server";

import { getDashboardSession } from "@/lib/auth/roles";
import {
  normalizeTemplateCategory,
  normalizeTemplateSubCategory,
} from "@/lib/templates/templateSettings";

const EDITOR_ROLES = new Set(["admin", "designer"]);

export function normalizeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function normalizeCanvasSize(canvasSize) {
  const width = Number(canvasSize?.width);
  const height = Number(canvasSize?.height);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1080,
    height: Number.isFinite(height) && height > 0 ? height : 1080,
  };
}

export function normalizeCategory(value, settings) {
  return normalizeTemplateCategory(value, settings);
}

export function normalizeSubCategory(value, category, settings) {
  return normalizeTemplateSubCategory(value, category, settings);
}

export function normalizeTags(value) {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => String(item).trim().toLowerCase())
          .filter(Boolean)
          .map((item) => item.slice(0, 32))
      )
    );
  }
  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
          .map((item) => item.slice(0, 32))
      )
    );
  }
  return [];
}

export function buildSnapshot(template) {
  return {
    name: template.name,
    slug: template.slug,
    status: template.status,
    canvasSize: template.canvasSize,
    category: template.category,
    subCategory: template.subCategory,
    tags: template.tags,
    thumbnailDataUrl: template.thumbnailDataUrl,
    previewVideoUrl: template.previewVideoUrl ?? null,
    previewPosterUrl: template.previewPosterUrl ?? null,
    previewStatus: template.previewStatus ?? null,
    previewDurationMs: template.previewDurationMs ?? null,
    previewVersion: template.previewVersion ?? null,
    previewError: template.previewError ?? null,
    previewUpdatedAt: template.previewUpdatedAt ?? null,
    data: template.data,
  };
}

export function mapTemplatePreview(template) {
  const status = String(template?.previewStatus || "").trim();
  const url = String(template?.previewVideoUrl || "").trim();
  const posterUrl = String(template?.previewPosterUrl || "").trim();
  const durationMs = Number(template?.previewDurationMs);
  const version = Number(template?.previewVersion);
  const updatedAtRaw = template?.previewUpdatedAt;
  const error = String(template?.previewError || "").trim();

  if (!status && !url && !posterUrl && !Number.isFinite(durationMs) && !Number.isFinite(version) && !updatedAtRaw && !error) {
    return null;
  }

  const updatedAt =
    updatedAtRaw instanceof Date
      ? updatedAtRaw.getTime()
      : updatedAtRaw
        ? new Date(updatedAtRaw).getTime()
        : null;

  return {
    status: status || "not_requested",
    url: url || null,
    posterUrl: posterUrl || null,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null,
    version: Number.isFinite(version) ? Math.max(0, Math.round(version)) : null,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
    error: error || null,
  };
}

export async function getEditorSession() {
  const session = await getDashboardSession();
  if (!session?.userId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  if (!EDITOR_ROLES.has(session.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { userId: session.userId, role: session.role };
}

export function canAccessTemplate(session, template) {
  return session.role === "admin" || template.ownerId === session.userId;
}
