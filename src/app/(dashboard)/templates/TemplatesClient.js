"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/form";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import {
  TEMPLATE_CATEGORY_SETTINGS,
  getTemplateCategoryOptions,
  getTemplateSubCategoryOptions,
  normalizeTemplateCategory,
  normalizeTemplateSubCategory,
} from "@/lib/templates/templateSettings";

const PAGE_SIZE = 10;

function parseTemplateData(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw;
  return null;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clampPreviewSize(value, fallback) {
  const next = Number(value);
  if (!Number.isFinite(next) || next <= 0) return fallback;
  return Math.max(120, Math.min(2000, Math.round(next)));
}

function buildPreviewFallbackDataUrl({
  name,
  text,
  bgColor,
  textColor,
  width,
  height,
}) {
  const w = clampPreviewSize(width, 1080);
  const h = clampPreviewSize(height, 1080);
  const ratio = h > 0 ? h / w : 1;
  const canvasWidth = 360;
  const canvasHeight = Math.max(360, Math.round(canvasWidth * ratio));
  const displayText = String(text || name || "Template")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 34);
  const safeBg = String(bgColor || "#eef2f7").trim() || "#eef2f7";
  const safeTextColor = String(textColor || "#111827").trim() || "#111827";
  const fontSize = Math.max(22, Math.round(canvasWidth * 0.085));
  const subtitleSize = Math.max(14, Math.round(canvasWidth * 0.045));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
<rect width="100%" height="100%" fill="${escapeXml(safeBg)}"/>
<rect x="${Math.round(canvasWidth * 0.04)}" y="${Math.round(canvasHeight * 0.04)}" width="${Math.round(canvasWidth * 0.92)}" height="${Math.round(canvasHeight * 0.92)}" rx="${Math.round(canvasWidth * 0.05)}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="${Math.max(2, Math.round(canvasWidth * 0.01))}"/>
<text x="50%" y="48%" text-anchor="middle" dominant-baseline="middle" fill="${escapeXml(safeTextColor)}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700">${escapeXml(displayText || "Template")}</text>
<text x="50%" y="60%" text-anchor="middle" dominant-baseline="middle" fill="${escapeXml(safeTextColor)}" fill-opacity="0.72" font-family="Arial, sans-serif" font-size="${subtitleSize}">${escapeXml("Preview")}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function resolveTemplatePreviewMedia(template) {
  const previewVideoUrl = String(template?.preview?.url || template?.previewVideoUrl || "").trim();
  const previewPosterUrl = String(template?.preview?.posterUrl || template?.previewPosterUrl || "").trim();
  if (previewVideoUrl) {
    return {
      type: "video",
      src: previewVideoUrl,
      posterUrl: previewPosterUrl || null,
    };
  }

  const explicit = String(template?.thumbnailDataUrl || "").trim();
  if (explicit) {
    return {
      type: "image",
      src: explicit,
      posterUrl: null,
    };
  }

  const parsed = parseTemplateData(template?.data);
  if (!parsed || typeof parsed !== "object") {
    return {
      type: "image",
      src: buildPreviewFallbackDataUrl({
        name: template?.name,
        bgColor: "#eef2f7",
        width: template?.canvasSize?.width,
        height: template?.canvasSize?.height,
      }),
      posterUrl: null,
    };
  }

  const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
  if (pages.length > 0) {
    const page = pages[0] || {};
    const elements = Array.isArray(page.elements) ? page.elements : [];
    const imageLayer = [...elements]
      .reverse()
      .find(
        (element) =>
          element &&
          element.type === "image" &&
          element.visible !== false &&
          typeof element.src === "string" &&
          element.src.startsWith("data:image/")
      );
    if (imageLayer?.src) {
      return {
        type: "image",
        src: imageLayer.src,
        posterUrl: null,
      };
    }

    const textLayer = elements.find(
      (element) =>
        element &&
        element.type === "text" &&
        element.visible !== false &&
        String(element.text || "").trim()
    );

    return {
      type: "image",
      src: buildPreviewFallbackDataUrl({
        name: template?.name,
        text: String(textLayer?.text || ""),
        bgColor: page?.background?.color || "#eef2f7",
        textColor: textLayer?.color || textLayer?.fill || "#111827",
        width: page?.width || template?.canvasSize?.width,
        height: page?.height || template?.canvasSize?.height,
      }),
      posterUrl: null,
    };
  }

  const fabric = parsed.fabric && typeof parsed.fabric === "object" ? parsed.fabric : parsed;
  const objects = Array.isArray(fabric.objects) ? fabric.objects : [];
  const fabricImage = objects.find(
    (item) => item && typeof item.src === "string" && item.src.startsWith("data:image/")
  );
  if (fabricImage?.src) {
    return {
      type: "image",
      src: fabricImage.src,
      posterUrl: null,
    };
  }
  const fabricText = objects.find(
    (item) =>
      item &&
      typeof item.type === "string" &&
      item.type.toLowerCase().includes("text") &&
      String(item.text || "").trim()
  );

  return {
    type: "image",
    src: buildPreviewFallbackDataUrl({
      name: template?.name,
      text: String(fabricText?.text || ""),
      bgColor: fabric.backgroundColor || "#eef2f7",
      textColor: fabricText?.fill || "#111827",
      width: template?.canvasSize?.width,
      height: template?.canvasSize?.height,
    }),
    posterUrl: null,
  };
}

function resolveTemplateAspectRatio(template) {
  const parsed = parseTemplateData(template?.data);
  const pages = Array.isArray(parsed?.pages) ? parsed.pages : [];
  const firstPage = pages[0] || null;
  const width = Number(firstPage?.width || template?.canvasSize?.width || 0);
  const height = Number(firstPage?.height || template?.canvasSize?.height || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1;
  }
  return Math.max(0.35, Math.min(3, height / width));
}

export default function TemplatesClient() {
  const [templates, setTemplates] = useState([]);
  const [totalTemplates, setTotalTemplates] = useState(0);
  const [status, setStatus] = useState("Loading templates...");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [subCategoryFilter, setSubCategoryFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [taxonomySettings, setTaxonomySettings] = useState(TEMPLATE_CATEGORY_SETTINGS);
  const [locale, setLocale] = useState("en");
  const [deletingTemplateId, setDeletingTemplateId] = useState("");
  const [selectedTemplateIds, setSelectedTemplateIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [previewPopup, setPreviewPopup] = useState(null);
  const selectAllRef = useRef(null);

  const categoryOptions = useMemo(
    () => getTemplateCategoryOptions(taxonomySettings, locale),
    [locale, taxonomySettings]
  );
  const subCategoryOptions = useMemo(
    () =>
      categoryFilter ? getTemplateSubCategoryOptions(categoryFilter, taxonomySettings, locale) : [],
    [categoryFilter, locale, taxonomySettings]
  );
  const selectedTemplateIdsSet = useMemo(() => new Set(selectedTemplateIds), [selectedTemplateIds]);
  const previewByTemplateId = useMemo(() => {
    const next = new Map();
    templates.forEach((template) => {
      next.set(template.id, resolveTemplatePreviewMedia(template));
    });
    return next;
  }, [templates]);
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalTemplates / PAGE_SIZE)),
    [totalTemplates]
  );
  const visibleTemplateIds = useMemo(
    () => templates.map((template) => template.id),
    [templates]
  );
  const selectedVisibleCount = useMemo(
    () => visibleTemplateIds.filter((templateId) => selectedTemplateIdsSet.has(templateId)).length,
    [selectedTemplateIdsSet, visibleTemplateIds]
  );
  const allVisibleSelected = visibleTemplateIds.length > 0 && selectedVisibleCount === visibleTemplateIds.length;
  const hasPartialSelection = selectedVisibleCount > 0 && !allVisibleSelected;

  const onCategoryFilterChange = (value) => {
    const normalizedCategory = value ? normalizeTemplateCategory(value, taxonomySettings) : "";
    setCategoryFilter(normalizedCategory);
    if (!normalizedCategory) {
      setSubCategoryFilter("");
      return;
    }

    const nextSubCategoryOptions = getTemplateSubCategoryOptions(
      normalizedCategory,
      taxonomySettings
    );
    setSubCategoryFilter((prev) =>
      nextSubCategoryOptions.some((option) => option.value === prev)
        ? prev
        : nextSubCategoryOptions[0]?.value || ""
    );
  };

  useEffect(() => {
    const docDir = document?.documentElement?.dir;
    const docLang = document?.documentElement?.lang;
    const browserLang = typeof navigator !== "undefined" ? navigator.language : "";
    setLocale(docDir === "rtl" || /^ar/i.test(docLang || browserLang || "") ? "ar" : "en");
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadTaxonomySettings = async () => {
      try {
        const response = await fetch("/api/settings/template-taxonomy");
        if (!response.ok) return;
        const payload = await response.json();
        if (isMounted && Array.isArray(payload?.settings)) {
          setTaxonomySettings(payload.settings);
        }
      } catch (_error) {
        // Keep defaults when taxonomy request fails.
      }
    };

    loadTaxonomySettings();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!categoryFilter) return;
    const normalizedCategory = normalizeTemplateCategory(categoryFilter, taxonomySettings);
    const normalizedSubCategory = subCategoryFilter
      ? normalizeTemplateSubCategory(subCategoryFilter, normalizedCategory, taxonomySettings)
      : "";
    if (normalizedCategory !== categoryFilter) {
      setCategoryFilter(normalizedCategory);
    }
    if (normalizedSubCategory !== subCategoryFilter) {
      setSubCategoryFilter(normalizedSubCategory);
    }
  }, [categoryFilter, subCategoryFilter, taxonomySettings]);

  const loadTemplates = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (categoryFilter.trim()) query.set("category", categoryFilter.trim());
      if (subCategoryFilter.trim()) query.set("subCategory", subCategoryFilter.trim());
      if (tagFilter.trim()) query.set("tag", tagFilter.trim());
      query.set("page", String(currentPage));
      query.set("perPage", String(PAGE_SIZE));

      const response = await fetch(`/api/templates?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error || "Failed to load templates.");
      }
      const payload = await response.json();
      const nextTemplates = Array.isArray(payload?.templates) ? payload.templates : [];
      const nextTotal = Number(payload?.total);
      const resolvedTotal =
        Number.isFinite(nextTotal) && nextTotal >= 0 ? Math.floor(nextTotal) : nextTemplates.length;
      setTemplates(nextTemplates);
      setTotalTemplates(resolvedTotal);
      setSelectedTemplateIds((current) => {
        const available = new Set(nextTemplates.map((item) => item.id));
        return current.filter((id) => available.has(id));
      });
      setStatus("");
    } catch (error) {
      setStatus(error.message || "Failed to load templates.");
    }
  }, [categoryFilter, subCategoryFilter, currentPage, tagFilter]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    setCurrentPage(1);
  }, [categoryFilter, subCategoryFilter, tagFilter]);

  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = hasPartialSelection;
  }, [hasPartialSelection]);

  const deleteTemplateById = useCallback(async (templateId) => {
    const response = await fetch(`/api/templates/${encodeURIComponent(templateId)}`, {
      method: "DELETE",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || "Failed to delete template.");
    }
    return payload;
  }, []);

  const handleDeleteTemplate = useCallback(async (template) => {
    const templateId = String(template?.id || "").trim();
    if (!templateId) return;

    const templateName = String(template?.name || "this template").trim();
    const confirmed = window.confirm(`Delete "${templateName}"? This action cannot be undone.`);
    if (!confirmed) return;

    setDeletingTemplateId(templateId);
    setStatus("Deleting template...");
    try {
      await deleteTemplateById(templateId);
      await loadTemplates();
      setStatus("Template deleted.");
    } catch (error) {
      setStatus(error.message || "Failed to delete template.");
    } finally {
      setDeletingTemplateId("");
    }
  }, [deleteTemplateById, loadTemplates]);

  const toggleTemplateSelection = useCallback((templateId, checked) => {
    setSelectedTemplateIds((current) => {
      const exists = current.includes(templateId);
      if (checked && !exists) return [...current, templateId];
      if (!checked && exists) return current.filter((id) => id !== templateId);
      return current;
    });
  }, []);

  const toggleSelectAllVisible = useCallback(
    (checked) => {
      setSelectedTemplateIds((current) => {
        const currentSet = new Set(current);
        if (checked) {
          for (const templateId of visibleTemplateIds) {
            currentSet.add(templateId);
          }
        } else {
          for (const templateId of visibleTemplateIds) {
            currentSet.delete(templateId);
          }
        }
        return Array.from(currentSet);
      });
    },
    [visibleTemplateIds]
  );

  const handleDeleteSelected = useCallback(async () => {
    const targetIds = visibleTemplateIds.filter((templateId) => selectedTemplateIdsSet.has(templateId));
    if (!targetIds.length) return;

    const confirmed = window.confirm(
      `Delete ${targetIds.length} selected template${targetIds.length > 1 ? "s" : ""}? This action cannot be undone.`
    );
    if (!confirmed) return;

    setBulkDeleting(true);
    setStatus(`Deleting ${targetIds.length} template${targetIds.length > 1 ? "s" : ""}...`);
    try {
      const results = await Promise.allSettled(targetIds.map((templateId) => deleteTemplateById(templateId)));
      const deletedIds = [];
      let failedCount = 0;

      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          deletedIds.push(targetIds[index]);
        } else {
          failedCount += 1;
        }
      });

      if (deletedIds.length > 0) {
        await loadTemplates();
      }

      if (failedCount > 0) {
        setStatus(
          `${deletedIds.length} template${deletedIds.length === 1 ? "" : "s"} deleted, ${failedCount} failed.`
        );
      } else {
        setStatus(`${deletedIds.length} template${deletedIds.length === 1 ? "" : "s"} deleted.`);
      }
    } catch (error) {
      setStatus(error.message || "Failed to delete selected templates.");
    } finally {
      setBulkDeleting(false);
    }
  }, [deleteTemplateById, loadTemplates, selectedTemplateIdsSet, visibleTemplateIds]);

  const formatUpdatedAt = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString();
  };
  const pageStart = totalTemplates === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = templates.length === 0 ? 0 : Math.min(totalTemplates, pageStart + templates.length - 1);

  return (
    <div>
      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Template library</CardTitle>
              <CardSubtitle>Manage published and draft templates.</CardSubtitle>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="destructive"
                onClick={handleDeleteSelected}
                disabled={selectedVisibleCount === 0 || bulkDeleting || Boolean(deletingTemplateId)}
              >
                {bulkDeleting ? "Deleting..." : `Delete selected${selectedVisibleCount ? ` (${selectedVisibleCount})` : ""}`}
              </Button>
              <Button as="a" href="/editor-pro">
                New template
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="!p-0">
          <div className="space-y-4 p-5">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={categoryFilter} onChange={(event) => onCategoryFilterChange(event.target.value)}>
                  <option value="">All categories</option>
                  {categoryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Sub category</Label>
                <Select
                  value={subCategoryFilter}
                  onChange={(event) => setSubCategoryFilter(event.target.value)}
                  disabled={!categoryFilter}
                >
                  <option value="">{categoryFilter ? "All sub categories" : "Select category first"}</option>
                  {subCategoryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tag</Label>
                <Input
                  placeholder="promo"
                  value={tagFilter}
                  onChange={(event) => setTagFilter(event.target.value)}
                />
              </div>
            </div>

            {status ? (
              <div className="text-sm text-muted-foreground">{status}</div>
            ) : null}
          </div>
          <div className="templates-table-wrap">
            <Table className="templates-table table-fixed">
              <TableHead>
                <TableRow>
                  <TableHeaderCell className="w-10 whitespace-nowrap">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      className="h-4 w-4"
                      checked={allVisibleSelected}
                      onChange={(event) => toggleSelectAllVisible(event.target.checked)}
                      aria-label="Select all templates"
                    />
                  </TableHeaderCell>
                  <TableHeaderCell className="w-20 whitespace-nowrap">Preview</TableHeaderCell>
                  <TableHeaderCell className="w-44 whitespace-nowrap">Name</TableHeaderCell>
                  <TableHeaderCell className="w-24 whitespace-nowrap">Category</TableHeaderCell>
                  <TableHeaderCell className="w-28 whitespace-nowrap">Sub Category</TableHeaderCell>
                  <TableHeaderCell className="w-24 whitespace-nowrap">Tags</TableHeaderCell>
                  <TableHeaderCell className="w-24 whitespace-nowrap">Status</TableHeaderCell>
                  <TableHeaderCell className="w-36 whitespace-nowrap">Updated</TableHeaderCell>
                  <TableHeaderCell className="w-48 whitespace-nowrap">Created by</TableHeaderCell>
                  <TableHeaderCell className="w-24 whitespace-nowrap text-right">Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {templates.map((template) => {
                  const previewMedia = previewByTemplateId.get(template.id) || null;
                  const previewSrc = String(previewMedia?.src || "").trim();
                  const previewAspectRatio = resolveTemplateAspectRatio(template);
                  const previewWidth = Math.max(28, Math.min(64, Math.round(48 / previewAspectRatio)));
                  return (
                  <TableRow key={template.id}>
                    <TableCell className="align-middle">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selectedTemplateIdsSet.has(template.id)}
                        onChange={(event) => toggleTemplateSelection(template.id, event.target.checked)}
                        aria-label={`Select ${template.name}`}
                      />
                    </TableCell>
                    <TableCell className="align-middle">
                      {previewSrc ? (
                        <button
                          type="button"
                          className="rounded-md border border-transparent transition hover:border-[#93b5ee]"
                          onClick={() =>
                            setPreviewPopup({
                              name: template.name,
                              type: previewMedia?.type || "image",
                              src: previewSrc,
                              posterUrl: String(previewMedia?.posterUrl || "").trim() || null,
                            })
                          }
                          aria-label={`Preview ${template.name}`}
                        >
                          {previewMedia?.type === "video" ? (
                            <video
                              src={previewSrc}
                              poster={String(previewMedia?.posterUrl || "").trim() || undefined}
                              className="h-12 rounded-md border border-border object-contain bg-white"
                              style={{ width: `${previewWidth}px` }}
                              muted
                              playsInline
                              autoPlay
                              loop
                              preload="metadata"
                            />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={previewSrc}
                              alt={`${template.name} thumbnail`}
                              className="h-12 rounded-md border border-border object-contain bg-white"
                              style={{ width: `${previewWidth}px` }}
                              loading="lazy"
                            />
                          )}
                        </button>
                      ) : (
                        <div className="h-12 w-12 rounded-md border border-border bg-muted" />
                      )}
                    </TableCell>
                    <TableCell className="font-semibold">
                      <div className="truncate">{template.name}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{template.category || "general"}</TableCell>
                    <TableCell className="whitespace-nowrap">{template.subCategory || "general"}</TableCell>
                    <TableCell>
                      <div className="truncate">
                        {Array.isArray(template.tags) ? template.tags.join(", ") : ""}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant={template.status === "published" ? "success" : "warning"}>
                        {template.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatUpdatedAt(template.updatedAt)}</TableCell>
                    <TableCell>
                      <div className="truncate">
                        {template.ownerName || template.ownerId?.slice(0, 8) || "Unknown"}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          as="a"
                          href={`/editor-pro?templateId=${template.id}&updatedAt=${encodeURIComponent(template.updatedAt || "")}`}
                          variant="secondary"
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => handleDeleteTemplate(template)}
                          disabled={deletingTemplateId === template.id || bulkDeleting}
                        >
                          {deletingTemplateId === template.id ? "Deleting..." : "Delete"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <div className="text-sm text-muted-foreground">
              Showing {pageStart}-{pageEnd} of {totalTemplates}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage <= 1}
              >
                Previous
              </Button>
              <div className="text-sm text-muted-foreground">
                Page {currentPage} / {totalPages}
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
          {!status && totalTemplates === 0 ? (
            <div className="px-5 pb-4 text-sm text-muted-foreground">No templates yet.</div>
          ) : null}
        </CardContent>
      </Card>
      {previewPopup ? (
        <div
          className="fixed inset-0 z-50 bg-black/35"
          onClick={() => setPreviewPopup(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={previewPopup.name || "Template preview"}
            className="absolute left-1/2 top-1/2 w-[min(380px,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[#d0d7e2] bg-white p-3 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="truncate text-sm font-semibold text-[#1f2937]">
                {previewPopup.name || "Template preview"}
              </div>
              <button
                type="button"
                className="rounded px-2 py-1 text-sm text-[#4b5563] hover:bg-[#eef2f8]"
                onClick={() => setPreviewPopup(null)}
              >
                Close
              </button>
            </div>
            <div className="flex max-h-[70vh] items-center justify-center overflow-hidden rounded-lg border border-[#d7dbe1] bg-[#f5f7fa]">
              {previewPopup.type === "video" ? (
                <video
                  src={String(previewPopup.src || "")}
                  poster={String(previewPopup.posterUrl || "").trim() || undefined}
                  className="max-h-[68vh] w-full object-contain"
                  controls
                  playsInline
                  autoPlay
                  loop
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={String(previewPopup.src || "")}
                  alt={previewPopup.name || "Template preview"}
                  className="max-h-[68vh] w-full object-contain"
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
