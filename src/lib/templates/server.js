import { NextResponse } from "next/server";

import { getDashboardSession } from "@/lib/auth/roles";
import { appendVersionParam } from "@/lib/storage/objectStorage.server";
import {
  normalizeTemplateCategory,
  normalizeTemplateSubCategory,
} from "@/lib/templates/templateSettings";
// Pure, framework-free helpers live in serverCore so the import worker can use
// them without importing next/server. Re-exported here for existing callers.
import { buildSnapshot, normalizeSlug } from "@/lib/templates/serverCore";

export { buildSnapshot, normalizeSlug };

const EDITOR_ROLES = new Set(["admin", "designer"]);

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

export function mapTemplatePreview(template) {
  const status = String(template?.previewStatus || "").trim();
  const rawUrl = String(template?.previewVideoUrl || "").trim();
  const rawPosterUrl = String(template?.previewPosterUrl || "").trim();
  const durationMs = Number(template?.previewDurationMs);
  const version = Number(template?.previewVersion);
  const updatedAtRaw = template?.previewUpdatedAt;
  const error = String(template?.previewError || "").trim();

  if (!status && !rawUrl && !rawPosterUrl && !Number.isFinite(durationMs) && !Number.isFinite(version) && !updatedAtRaw && !error) {
    return null;
  }

  const updatedAt =
    updatedAtRaw instanceof Date
      ? updatedAtRaw.getTime()
      : updatedAtRaw
        ? new Date(updatedAtRaw).getTime()
        : null;
  const versionToken = Number.isFinite(updatedAt)
    ? String(updatedAt)
    : Number.isFinite(version)
      ? String(version)
      : "";
  const url = appendVersionParam(rawUrl, versionToken);
  const posterUrl = appendVersionParam(rawPosterUrl, versionToken);

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

// Templates are a shared library: any dashboard user may open and edit any
// template regardless of who imported it. getEditorSession already turned away
// everyone who is not an admin or a designer, so reaching here is authorization
// enough. Template.ownerId is kept for attribution and asset pathing, not for
// access control — narrow this again if per-owner silos are ever wanted back.
export function canAccessTemplate(_session, _template) {
  return true;
}
