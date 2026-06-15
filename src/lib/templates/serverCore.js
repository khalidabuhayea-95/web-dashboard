// Framework-free template helpers. Deliberately free of any `next/*` or auth
// imports so they can be pulled into the standalone import worker's dependency
// graph (see scripts/worker.ts) without dragging in Next. The fuller
// src/lib/templates/server.js re-exports these for existing callers.

export function normalizeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
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
