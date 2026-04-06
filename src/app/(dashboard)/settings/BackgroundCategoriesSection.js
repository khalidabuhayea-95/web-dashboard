"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  GripVertical,
  ImageIcon,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";

import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form";
import { uploadEditorMediaFile } from "@/lib/editor/mediaUpload";
import { BACKGROUND_CATEGORY_SETTINGS } from "@/lib/backgrounds/categorySettings";

function createEmptyBackgroundCategory() {
  return {
    value: "",
    labelEn: "",
    labelAr: "",
    thumbnailUrl: "",
    published: true,
  };
}

function isBlank(value) {
  return String(value || "").trim().length === 0;
}

export default function BackgroundCategoriesSection({ canEdit }) {
  const [settings, setSettings] = useState(BACKGROUND_CATEGORY_SETTINGS);
  const [expandedCategories, setExpandedCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Loading background categories...");
  const [sectionCollapsed, setSectionCollapsed] = useState(false);
  const [uploadingThumbnailIndex, setUploadingThumbnailIndex] = useState(null);
  const [draggingCategoryIndex, setDraggingCategoryIndex] = useState(null);
  const [dragOverCategory, setDragOverCategory] = useState({
    index: null,
    position: "before",
  });
  const draggingCategoryIndexRef = useRef(null);
  const thumbnailInputRefs = useRef({});

  useEffect(() => {
    setExpandedCategories((previous) =>
      Array.from({ length: settings.length }, (_, index) => previous[index] ?? false)
    );
  }, [settings.length]);

  useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      try {
        const response = await fetch("/api/settings/background-categories", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load background categories.");
        }

        if (!isMounted) return;
        setSettings(Array.isArray(payload?.settings) ? payload.settings : BACKGROUND_CATEGORY_SETTINGS);
        setStatus("");
      } catch (error) {
        if (!isMounted) return;
        setStatus(error?.message || "Failed to load background categories.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void loadSettings();
    return () => {
      isMounted = false;
    };
  }, []);

  const validationCount = useMemo(() => {
    return settings.reduce((count, category) => {
      let next = count;
      if (isBlank(category.labelEn)) next += 1;
      if (isBlank(category.labelAr)) next += 1;
      return next;
    }, 0);
  }, [settings]);

  const updateCategory = useCallback((index, field, value) => {
    setSettings((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item))
    );
  }, []);

  const addCategory = useCallback(() => {
    setSettings((current) => [...current, createEmptyBackgroundCategory()]);
  }, []);

  const removeCategory = useCallback((index) => {
    setSettings((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  const moveCategory = useCallback((fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    setSettings((current) => {
      if (
        !Number.isInteger(fromIndex) ||
        !Number.isInteger(toIndex) ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.length ||
        toIndex >= current.length
      ) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return current;
      next.splice(toIndex, 0, moved);
      return next;
    });

    setExpandedCategories((current) => {
      if (
        !Number.isInteger(fromIndex) ||
        !Number.isInteger(toIndex) ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.length ||
        toIndex >= current.length
      ) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      if (typeof moved === "undefined") return current;
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const toggleCategoryPublished = useCallback((index) => {
    setSettings((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, published: !(item?.published !== false) } : item
      )
    );
  }, []);

  const handleSave = async () => {
    setBusy(true);
    setStatus("Saving background categories...");
    try {
      const response = await fetch("/api/settings/background-categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save background categories.");
      }

      setSettings(Array.isArray(payload?.settings) ? payload.settings : BACKGROUND_CATEGORY_SETTINGS);
      setStatus("Background categories saved.");
    } catch (error) {
      setStatus(error?.message || "Failed to save background categories.");
    } finally {
      setBusy(false);
    }
  };

  const triggerThumbnailPicker = useCallback((index) => {
    const input = thumbnailInputRefs.current[index];
    if (input) {
      input.click();
    }
  }, []);

  const handleThumbnailUpload = useCallback(
    async (index, files) => {
      const file = Array.from(files || []).find((item) => item?.type?.startsWith("image/"));
      if (!file) return;

      const displayName = String(
        settings[index]?.labelEn || settings[index]?.labelAr || settings[index]?.value || `category ${index + 1}`
      ).trim();

      setUploadingThumbnailIndex(index);
      setStatus(`Uploading thumbnail for ${displayName}...`);
      try {
        const uploaded = await uploadEditorMediaFile(file, "image");
        updateCategory(index, "thumbnailUrl", String(uploaded.url || "").trim());
        setStatus("Thumbnail uploaded. Save background categories to persist the change.");
      } catch (error) {
        setStatus(error?.message || "Failed to upload category thumbnail.");
      } finally {
        setUploadingThumbnailIndex((current) => (current === index ? null : current));
      }
    },
    [settings, updateCategory]
  );

  const statusTone = status.toLowerCase().includes("fail")
    ? "error"
    : status.toLowerCase().includes("saved")
      ? "success"
      : "neutral";

  const toggleCategoryExpanded = useCallback((index) => {
    setExpandedCategories((current) =>
      current.map((value, itemIndex) => (itemIndex === index ? !value : value))
    );
  }, []);

  const collapseAllCategories = useCallback(() => {
    setExpandedCategories(settings.map(() => false));
  }, [settings]);

  const expandAllCategories = useCallback(() => {
    setExpandedCategories(settings.map(() => true));
  }, [settings]);

  const resetCategoryDragState = useCallback(() => {
    draggingCategoryIndexRef.current = null;
    setDraggingCategoryIndex(null);
    setDragOverCategory({ index: null, position: "before" });
  }, []);

  const handleCategoryDrop = useCallback(
    (fromIndex, targetIndex, position) => {
      if (
        !Number.isInteger(fromIndex) ||
        !Number.isInteger(targetIndex) ||
        fromIndex < 0 ||
        targetIndex < 0 ||
        fromIndex >= settings.length ||
        targetIndex >= settings.length
      ) {
        resetCategoryDragState();
        return;
      }

      const baseTarget = position === "after" ? targetIndex + 1 : targetIndex;
      const nextIndex = fromIndex < baseTarget ? baseTarget - 1 : baseTarget;
      moveCategory(fromIndex, nextIndex);
      resetCategoryDragState();
    },
    [moveCategory, resetCategoryDragState, settings.length]
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Background Categories</CardTitle>
          <CardSubtitle>
            Manage the categories used when importing Freepik backgrounds on the importer page.
          </CardSubtitle>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setSectionCollapsed((current) => !current)}
          aria-expanded={!sectionCollapsed}
        >
          {sectionCollapsed ? (
            <>
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
              Expand
            </>
          ) : (
            <>
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
              Collapse
            </>
          )}
        </Button>
      </CardHeader>
      {!sectionCollapsed ? (
        <CardContent className="space-y-4">
          <section className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-r from-primary/10 via-transparent to-primary/5"
            />
            <div className="relative p-5 sm:p-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <div className="text-xs text-muted-foreground">Categories</div>
                  <div className="mt-1 text-xl font-semibold">{settings.length}</div>
                </div>
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <div className="text-xs text-muted-foreground">Validation issues</div>
                  <div className="mt-1 text-xl font-semibold">{validationCount}</div>
                </div>
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <div className="text-xs text-muted-foreground">Mode</div>
                  <div className="mt-1 text-sm font-semibold">{canEdit ? "Editable mode" : "Read-only mode"}</div>
                </div>
              </div>

              <div
                role="status"
                aria-live="polite"
                className="mt-4 min-h-10 rounded-xl border border-border bg-background/80 px-3 py-2 text-sm"
              >
                {status ? (
                  <div className="flex items-center gap-2">
                    {statusTone === "success" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    ) : statusTone === "error" ? (
                      <AlertCircle className="h-4 w-4 text-red-600" aria-hidden="true" />
                    ) : busy || loading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                    ) : (
                      <ImageIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span className="text-muted-foreground">{status}</span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">Background category changes stay local until you save.</span>
                )}
              </div>

              {canEdit ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={addCategory}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add background category
                  </Button>
                  <Button type="button" onClick={handleSave} disabled={busy || loading}>
                    <Save className="h-4 w-4" aria-hidden="true" />
                    Save background categories
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={expandAllCategories}
                    disabled={loading || settings.length === 0}
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    Expand all
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={collapseAllCategories}
                    disabled={loading || settings.length === 0}
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    Collapse all
                  </Button>
                </div>
              ) : null}
            </div>
          </section>

          {loading ? (
            <div className="space-y-3">
              {[0, 1].map((item) => (
                <div key={item} className="animate-pulse rounded-xl border border-border bg-muted/30 p-4">
                  <div className="h-4 w-40 rounded bg-muted" />
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="h-10 rounded bg-muted" />
                    <div className="h-10 rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : settings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground">
              No background categories available.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {settings.map((category, categoryIndex) => {
                const isPublished = category?.published !== false;
                const isExpanded = expandedCategories[categoryIndex] ?? true;
                const displayName = String(category?.labelEn || category?.labelAr || category?.value || "Untitled").trim();
                const isDragging = draggingCategoryIndex === categoryIndex;
                const isDragOver = dragOverCategory.index === categoryIndex;
                return (
                  <article
                    key={`${category.value || "background-category"}-${categoryIndex}`}
                    className={`h-fit rounded-xl border bg-background p-4 transition-shadow hover:shadow-sm ${
                      isDragOver
                        ? dragOverCategory.position === "after"
                          ? "border-b-2 border-b-primary"
                          : "border-t-2 border-t-primary"
                        : "border-border"
                    } ${isDragging ? "opacity-70" : ""}`}
                    draggable={canEdit}
                    onDragStart={(event) => {
                      if (!canEdit) return;
                      draggingCategoryIndexRef.current = categoryIndex;
                      setDraggingCategoryIndex(categoryIndex);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("application/x-background-category-index", String(categoryIndex));
                      event.dataTransfer.setData("text/plain", String(categoryIndex));
                    }}
                    onDragOver={(event) => {
                      if (!canEdit || !Number.isInteger(draggingCategoryIndexRef.current)) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      const rect = event.currentTarget.getBoundingClientRect();
                      const position = event.clientY - rect.top > rect.height / 2 ? "after" : "before";
                      if (
                        dragOverCategory.index !== categoryIndex ||
                        dragOverCategory.position !== position
                      ) {
                        setDragOverCategory({ index: categoryIndex, position });
                      }
                    }}
                    onDragEnter={(event) => {
                      if (!canEdit || !Number.isInteger(draggingCategoryIndexRef.current)) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      const position = event.clientY - rect.top > rect.height / 2 ? "after" : "before";
                      if (
                        dragOverCategory.index !== categoryIndex ||
                        dragOverCategory.position !== position
                      ) {
                        setDragOverCategory({ index: categoryIndex, position });
                      }
                    }}
                    onDrop={(event) => {
                      if (!canEdit) return;
                      event.preventDefault();
                      const payload =
                        event.dataTransfer.getData("application/x-background-category-index") ||
                        event.dataTransfer.getData("text/plain");
                      const parsedPayload = Number.parseInt(payload, 10);
                      const fromIndex = Number.isInteger(parsedPayload)
                        ? parsedPayload
                        : draggingCategoryIndexRef.current;
                      const rect = event.currentTarget.getBoundingClientRect();
                      const position = event.clientY - rect.top > rect.height / 2 ? "after" : "before";
                      handleCategoryDrop(fromIndex, categoryIndex, position);
                    }}
                    onDragEnd={() => {
                      resetCategoryDragState();
                    }}
                  >
                    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        {canEdit ? (
                          <span
                            className="mt-1 inline-flex cursor-grab items-center text-muted-foreground"
                            title="Drag to reorder background category"
                            aria-hidden="true"
                          >
                            <GripVertical className="h-4 w-4" />
                          </span>
                        ) : null}
                        <div className="relative aspect-square w-[72px] shrink-0 overflow-hidden rounded-2xl border border-border bg-muted/30">
                          <input
                            ref={(node) => {
                              if (node) {
                                thumbnailInputRefs.current[categoryIndex] = node;
                              } else {
                                delete thumbnailInputRefs.current[categoryIndex];
                              }
                            }}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) => {
                              void handleThumbnailUpload(categoryIndex, event.target.files);
                              event.currentTarget.value = "";
                            }}
                          />
                          {String(category?.thumbnailUrl || "").trim() ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={String(category?.thumbnailUrl || "").trim()}
                              alt={`${displayName} thumbnail`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#eef2ff_0%,#f8fafc_55%,#e2e8f0_100%)]">
                              <ImageIcon className="h-7 w-7 text-muted-foreground/70" aria-hidden="true" />
                            </div>
                          )}
                          {canEdit ? (
                            <button
                              type="button"
                              onClick={() => triggerThumbnailPicker(categoryIndex)}
                              className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/60 bg-white/90 text-foreground shadow-sm transition hover:bg-white"
                              aria-label={
                                String(category?.thumbnailUrl || "").trim()
                                  ? `Replace thumbnail for ${displayName}`
                                  : `Upload thumbnail for ${displayName}`
                              }
                              title={String(category?.thumbnailUrl || "").trim() ? "Replace thumbnail" : "Upload thumbnail"}
                              disabled={uploadingThumbnailIndex === categoryIndex}
                            >
                              {uploadingThumbnailIndex === categoryIndex ? (
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <Upload className="h-4 w-4" aria-hidden="true" />
                              )}
                            </button>
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1 space-y-2 pt-1">
                          <h2 className="line-clamp-2 text-base font-semibold leading-tight text-foreground">
                            {displayName}({categoryIndex + 1})
                          </h2>
                          <Badge variant={isPublished ? "success" : "warning"}>
                            {isPublished ? "Published" : "Unpublished"}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-start justify-end gap-2">
                        {canEdit ? (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => toggleCategoryPublished(categoryIndex)}
                              aria-label={`${isPublished ? "Unpublish" : "Publish"} background category ${categoryIndex + 1}`}
                            >
                              {isPublished ? (
                                <>
                                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                                  Unpublish
                                </>
                              ) : (
                                <>
                                  <Eye className="h-4 w-4" aria-hidden="true" />
                                  Publish
                                </>
                              )}
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              onClick={() => removeCategory(categoryIndex)}
                              aria-label={`Remove background category ${categoryIndex + 1}`}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              Remove
                            </Button>
                          </>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => toggleCategoryExpanded(categoryIndex)}
                          aria-expanded={isExpanded}
                          aria-controls={`background-category-panel-${categoryIndex}`}
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp className="h-4 w-4" aria-hidden="true" />
                              Collapse
                            </>
                          ) : (
                            <>
                              <ChevronDown className="h-4 w-4" aria-hidden="true" />
                              Expand
                            </>
                          )}
                        </Button>
                      </div>
                    </header>

                    {isExpanded ? (
                      <div
                        id={`background-category-panel-${categoryIndex}`}
                        className="mt-4 grid gap-3 md:grid-cols-2"
                      >
                        <div className="space-y-1.5">
                          <Label htmlFor={`background-category-en-${categoryIndex}`}>Category English value</Label>
                          <Input
                            id={`background-category-en-${categoryIndex}`}
                            value={category.labelEn || ""}
                            onChange={(event) => updateCategory(categoryIndex, "labelEn", event.target.value)}
                            placeholder="General"
                            disabled={!canEdit}
                          />
                          {isBlank(category.labelEn) ? (
                            <p className="field-help text-red-600 dark:text-red-400">Required field.</p>
                          ) : null}
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor={`background-category-ar-${categoryIndex}`}>Category Arabic value</Label>
                          <Input
                            id={`background-category-ar-${categoryIndex}`}
                            value={category.labelAr || ""}
                            onChange={(event) => updateCategory(categoryIndex, "labelAr", event.target.value)}
                            placeholder="عام"
                            disabled={!canEdit}
                          />
                          {isBlank(category.labelAr) ? (
                            <p className="field-help text-red-600 dark:text-red-400">Required field.</p>
                          ) : null}
                        </div>

                        <div className="space-y-1.5 md:col-span-2">
                          <Label htmlFor={`background-category-thumbnail-${categoryIndex}`}>Category thumbnail URL</Label>
                          <Input
                            id={`background-category-thumbnail-${categoryIndex}`}
                            value={String(category?.thumbnailUrl || "")}
                            onChange={(event) => updateCategory(categoryIndex, "thumbnailUrl", event.target.value)}
                            placeholder="Upload or paste a thumbnail URL"
                            disabled={!canEdit || uploadingThumbnailIndex === categoryIndex}
                          />
                          <p className="field-help text-muted-foreground">
                            Upload manually from the thumbnail card above, or paste an image URL if you already have one.
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}
