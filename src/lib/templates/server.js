import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  normalizeTemplateCategory,
  normalizeTemplateSubCategory,
} from "@/lib/templates/templateSettings";

const EDITOR_ROLES = new Set(["admin", "editor"]);

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
    data: template.data,
  };
}

export async function getEditorSession() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const role = data.claims.user_role || "editor";
  if (!EDITOR_ROLES.has(role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { userId: data.claims.sub, role };
}

export function canAccessTemplate(session, template) {
  return session.role === "admin" || template.ownerId === session.userId;
}
