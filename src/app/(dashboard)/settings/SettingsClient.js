"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  FolderTree,
  GripVertical,
  Languages,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";

import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form";
import { TEMPLATE_CATEGORY_SETTINGS } from "@/lib/templates/templateSettings";

function createEmptySubCategory() {
  return { value: "", labelEn: "", labelAr: "", published: true };
}

function createEmptyCategory() {
  return {
    value: "",
    labelEn: "",
    labelAr: "",
    published: true,
    subCategories: [createEmptySubCategory()],
  };
}

function isBlank(value) {
  return String(value || "").trim().length === 0;
}

export default function SettingsClient({ canEdit }) {
  const [settings, setSettings] = useState(TEMPLATE_CATEGORY_SETTINGS);
  const [expandedCategories, setExpandedCategories] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading category settings...");
  const [toast, setToast] = useState(null);
  const [draggingCategoryIndex, setDraggingCategoryIndex] = useState(null);
  const [dragOverCategory, setDragOverCategory] = useState({
    index: null,
    position: "before",
  });
  const [draggingSubCategory, setDraggingSubCategory] = useState({
    categoryIndex: null,
    subCategoryIndex: null,
  });
  const [dragOverSubCategory, setDragOverSubCategory] = useState({
    categoryIndex: null,
    subCategoryIndex: null,
    position: "before",
  });
  const draggingCategoryIndexRef = useRef(null);
  const draggingSubCategoryRef = useRef({
    categoryIndex: null,
    subCategoryIndex: null,
  });
  const settingsCount = settings.length;

  const showToast = useCallback((tone, message) => {
    setToast({ tone, message });
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        setToast((current) => (current?.message === message ? null : current));
      }, 2600);
    }
  }, []);

  useEffect(() => {
    setExpandedCategories((previous) =>
      Array.from({ length: settingsCount }, (_, index) => previous[index] ?? false)
    );
  }, [settingsCount]);

  useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      try {
        const response = await fetch("/api/settings/template-taxonomy");
        if (!response.ok) {
          const payload = await response.json();
          throw new Error(payload?.error || "Failed to load taxonomy settings.");
        }

        const payload = await response.json();
        if (isMounted) {
          setSettings(Array.isArray(payload?.settings) ? payload.settings : TEMPLATE_CATEGORY_SETTINGS);
          setStatus("");
        }
      } catch (error) {
        if (isMounted) {
          setStatus(error?.message || "Failed to load taxonomy settings.");
          showToast("error", error?.message || "Failed to load taxonomy settings.");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadSettings();
    return () => {
      isMounted = false;
    };
  }, [showToast]);

  const summary = useMemo(() => {
    const totalCategories = settings.length;
    const totalSubCategories = settings.reduce(
      (count, category) => count + (Array.isArray(category.subCategories) ? category.subCategories.length : 0),
      0
    );
    return {
      totalCategories,
      totalSubCategories,
      modeLabel: canEdit ? "Editable mode" : "Read-only mode",
    };
  }, [canEdit, settings]);

  const validationCount = useMemo(() => {
    return settings.reduce((count, category) => {
      let next = count;
      if (isBlank(category.labelEn)) next += 1;
      if (isBlank(category.labelAr)) next += 1;
      const subCategories = Array.isArray(category.subCategories) ? category.subCategories : [];
      subCategories.forEach((subCategory) => {
        if (isBlank(subCategory.labelEn)) next += 1;
        if (isBlank(subCategory.labelAr)) next += 1;
      });
      return next;
    }, 0);
  }, [settings]);

  const updateCategory = (categoryIndex, field, value) => {
    setSettings((current) =>
      current.map((category, index) => (index === categoryIndex ? { ...category, [field]: value } : category))
    );
  };

  const addCategory = () => {
    setSettings((current) => [...current, createEmptyCategory()]);
  };

  const removeCategory = (categoryIndex) => {
    setSettings((current) => current.filter((_, index) => index !== categoryIndex));
  };

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

  const moveSubCategory = useCallback((categoryIndex, fromSubCategoryIndex, toSubCategoryIndex) => {
    if (
      fromSubCategoryIndex === toSubCategoryIndex ||
      !Number.isInteger(categoryIndex) ||
      !Number.isInteger(fromSubCategoryIndex) ||
      !Number.isInteger(toSubCategoryIndex)
    ) {
      return;
    }

    setSettings((current) =>
      current.map((category, index) => {
        if (index !== categoryIndex) return category;
        const subCategories = Array.isArray(category.subCategories) ? [...category.subCategories] : [];
        if (
          fromSubCategoryIndex < 0 ||
          toSubCategoryIndex < 0 ||
          fromSubCategoryIndex >= subCategories.length ||
          toSubCategoryIndex > subCategories.length
        ) {
          return category;
        }
        const [moved] = subCategories.splice(fromSubCategoryIndex, 1);
        if (!moved) return category;
        subCategories.splice(toSubCategoryIndex, 0, moved);
        return { ...category, subCategories };
      })
    );
  }, []);

  const resetCategoryDragState = useCallback(() => {
    draggingCategoryIndexRef.current = null;
    setDraggingCategoryIndex(null);
    setDragOverCategory({ index: null, position: "before" });
  }, []);

  const resetSubCategoryDragState = useCallback(() => {
    draggingSubCategoryRef.current = { categoryIndex: null, subCategoryIndex: null };
    setDraggingSubCategory({ categoryIndex: null, subCategoryIndex: null });
    setDragOverSubCategory({
      categoryIndex: null,
      subCategoryIndex: null,
      position: "before",
    });
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

  const handleSubCategoryDrop = useCallback(
    (fromCategoryIndex, fromSubCategoryIndex, targetCategoryIndex, targetSubCategoryIndex, position) => {
      if (
        !Number.isInteger(fromCategoryIndex) ||
        !Number.isInteger(fromSubCategoryIndex) ||
        !Number.isInteger(targetCategoryIndex) ||
        !Number.isInteger(targetSubCategoryIndex) ||
        fromCategoryIndex < 0 ||
        targetCategoryIndex < 0 ||
        fromCategoryIndex >= settings.length ||
        targetCategoryIndex >= settings.length ||
        fromCategoryIndex !== targetCategoryIndex
      ) {
        resetSubCategoryDragState();
        return;
      }

      const subCategories = Array.isArray(settings[targetCategoryIndex]?.subCategories)
        ? settings[targetCategoryIndex].subCategories
        : [];
      if (
        fromSubCategoryIndex < 0 ||
        targetSubCategoryIndex < 0 ||
        fromSubCategoryIndex >= subCategories.length ||
        targetSubCategoryIndex >= subCategories.length
      ) {
        resetSubCategoryDragState();
        return;
      }

      const baseTarget = position === "after" ? targetSubCategoryIndex + 1 : targetSubCategoryIndex;
      const nextIndex = fromSubCategoryIndex < baseTarget ? baseTarget - 1 : baseTarget;
      moveSubCategory(fromCategoryIndex, fromSubCategoryIndex, nextIndex);
      resetSubCategoryDragState();
    },
    [moveSubCategory, resetSubCategoryDragState, settings]
  );

  const toggleCategoryPublished = (categoryIndex) => {
    setSettings((current) =>
      current.map((category, index) =>
        index === categoryIndex
          ? { ...category, published: !(category?.published !== false) }
          : category
      )
    );
  };

  const addSubCategory = (categoryIndex) => {
    setSettings((current) =>
      current.map((category, index) =>
        index === categoryIndex
          ? {
              ...category,
              subCategories: [
                ...(Array.isArray(category.subCategories) ? category.subCategories : []),
                createEmptySubCategory(),
              ],
            }
          : category
      )
    );
  };

  const updateSubCategory = (categoryIndex, subCategoryIndex, field, value) => {
    setSettings((current) =>
      current.map((category, index) => {
        if (index !== categoryIndex) return category;
        const subCategories = Array.isArray(category.subCategories) ? category.subCategories : [];
        return {
          ...category,
          subCategories: subCategories.map((subCategory, subIndex) =>
            subIndex === subCategoryIndex ? { ...subCategory, [field]: value } : subCategory
          ),
        };
      })
    );
  };

  const removeSubCategory = (categoryIndex, subCategoryIndex) => {
    setSettings((current) =>
      current.map((category, index) => {
        if (index !== categoryIndex) return category;
        const subCategories = Array.isArray(category.subCategories) ? category.subCategories : [];
        return {
          ...category,
          subCategories: subCategories.filter((_, subIndex) => subIndex !== subCategoryIndex),
        };
      })
    );
  };

  const toggleSubCategoryPublished = (categoryIndex, subCategoryIndex) => {
    setSettings((current) =>
      current.map((category, index) => {
        if (index !== categoryIndex) return category;
        const subCategories = Array.isArray(category.subCategories) ? category.subCategories : [];
        return {
          ...category,
          subCategories: subCategories.map((subCategory, subIndex) =>
            subIndex === subCategoryIndex
              ? { ...subCategory, published: !(subCategory?.published !== false) }
              : subCategory
          ),
        };
      })
    );
  };

  const toggleCategoryExpanded = (categoryIndex) => {
    setExpandedCategories((current) =>
      current.map((value, index) => (index === categoryIndex ? !value : value))
    );
  };

  const collapseAllCategories = () => {
    setExpandedCategories(settings.map(() => false));
  };

  const expandAllCategories = () => {
    setExpandedCategories(settings.map(() => true));
  };

  const handleSave = async () => {
    setBusy(true);
    setStatus("Saving settings...");
    try {
      const response = await fetch("/api/settings/template-taxonomy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error || "Failed to save settings.");
      }

      const payload = await response.json();
      setSettings(Array.isArray(payload?.settings) ? payload.settings : TEMPLATE_CATEGORY_SETTINGS);
      setStatus("Settings saved.");
      showToast("success", "Settings saved.");
    } catch (error) {
      setStatus(error?.message || "Failed to save settings.");
      showToast("error", error?.message || "Failed to save settings.");
    } finally {
      setBusy(false);
    }
  };

  const statusTone = status.toLowerCase().includes("fail")
    ? "error"
    : status.toLowerCase().includes("saved")
      ? "success"
      : "neutral";

  return (
    <div className="space-y-6">
      {toast ? (
        <div className="fixed right-4 top-4 z-50">
          <div
            role="status"
            aria-live="polite"
            className={`rounded-xl border px-3 py-2 text-sm shadow-md transition-all ${
              toast.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/70 dark:text-emerald-100"
                : toast.tone === "error"
                  ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/70 dark:text-red-100"
                  : "border-border bg-card text-foreground"
            }`}
          >
            {toast.message}
          </div>
        </div>
      ) : null}

      <section className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-r from-primary/10 via-transparent to-primary/5"
        />
        <div className="relative p-5 sm:p-6">
          <div className="flex justify-end">
            <Badge variant={canEdit ? "success" : "warning"}>
              {canEdit ? "Admin: editable" : "Editor: read only"}
            </Badge>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-background/70 p-3">
              <div className="text-xs text-muted-foreground">Categories</div>
              <div className="mt-1 text-xl font-semibold">{summary.totalCategories}</div>
            </div>
            <div className="rounded-xl border border-border bg-background/70 p-3">
              <div className="text-xs text-muted-foreground">Sub categories</div>
              <div className="mt-1 text-xl font-semibold">{summary.totalSubCategories}</div>
            </div>
            <div className="rounded-xl border border-border bg-background/70 p-3">
              <div className="text-xs text-muted-foreground">Validation issues</div>
              <div className="mt-1 text-xl font-semibold">{validationCount}</div>
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
                ) : busy ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                ) : (
                  <Languages className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="text-muted-foreground">{status}</span>
              </div>
            ) : (
              <span className="text-muted-foreground">All changes are local until you save.</span>
            )}
          </div>

          {canEdit ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={addCategory} className="transition-transform hover:-translate-y-px">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add category
              </Button>
              <Button type="button" onClick={handleSave} disabled={busy}>
                <Save className="h-4 w-4" aria-hidden="true" />
                Save changes
              </Button>
              <Button type="button" variant="ghost" onClick={expandAllCategories}>
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
                Expand all
              </Button>
              <Button type="button" variant="ghost" onClick={collapseAllCategories}>
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
                Collapse all
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Category Groups</CardTitle>
          <CardSubtitle>
            Keep names clear and consistent. English and Arabic values are shown in UI dropdowns.
          </CardSubtitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((item) => (
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
              No categories available.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {settings.map((category, categoryIndex) => {
                const subCategories = Array.isArray(category.subCategories) ? category.subCategories : [];
                const isExpanded = expandedCategories[categoryIndex] ?? true;
                const isCategoryPublished = category?.published !== false;
                const categoryDisplayName = String(
                  category?.labelEn || category?.labelAr || category?.value || "Untitled"
                ).trim();
                const isDragging = draggingCategoryIndex === categoryIndex;
                const isDragOver = dragOverCategory.index === categoryIndex;
                return (
                  <article
                    key={`${category.value || "category"}-${categoryIndex}`}
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
                      event.dataTransfer.setData("application/x-category-index", String(categoryIndex));
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
                        event.dataTransfer.getData("application/x-category-index") ||
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
                    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                      <div className="flex items-center gap-2">
                        {canEdit ? (
                          <span
                            className="inline-flex cursor-grab items-center text-muted-foreground"
                            title="Drag to reorder category"
                            aria-hidden="true"
                          >
                            <GripVertical className="h-4 w-4" />
                          </span>
                        ) : null}
                        <FolderTree className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <h2 className="text-sm font-semibold">
                          {categoryDisplayName}({categoryIndex + 1})
                        </h2>
                        <Badge variant={isCategoryPublished ? "success" : "warning"}>
                          {isCategoryPublished ? "Published" : "Unpublished"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        {canEdit ? (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => toggleCategoryPublished(categoryIndex)}
                            aria-label={`${isCategoryPublished ? "Unpublish" : "Publish"} category ${categoryIndex + 1}`}
                          >
                            {isCategoryPublished ? (
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
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => toggleCategoryExpanded(categoryIndex)}
                          aria-expanded={isExpanded}
                          aria-controls={`category-panel-${categoryIndex}`}
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
                        {canEdit ? (
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={() => removeCategory(categoryIndex)}
                            aria-label={`Remove category ${categoryIndex + 1}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </header>

                    {isExpanded ? (
                      <div id={`category-panel-${categoryIndex}`} className="mt-4 space-y-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor={`category-en-${categoryIndex}`}>Category English value</Label>
                            <Input
                              id={`category-en-${categoryIndex}`}
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
                            <Label htmlFor={`category-ar-${categoryIndex}`}>Category Arabic value</Label>
                            <Input
                              id={`category-ar-${categoryIndex}`}
                              value={category.labelAr || ""}
                              onChange={(event) => updateCategory(categoryIndex, "labelAr", event.target.value)}
                              placeholder="عام"
                              disabled={!canEdit}
                            />
                            {isBlank(category.labelAr) ? (
                              <p className="field-help text-red-600 dark:text-red-400">Required field.</p>
                            ) : null}
                          </div>
                        </div>

                        <div className="overflow-hidden rounded-xl border border-border">
                          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <span>Sub category (EN)</span>
                            <span>Sub category (AR)</span>
                            <span className="text-right">Actions</span>
                          </div>
                          <div className="space-y-2 p-3">
                            {subCategories.map((subCategory, subCategoryIndex) => (
                              <div
                                key={`${subCategory.value || "sub"}-${subCategoryIndex}`}
                                draggable={canEdit}
                                onDragStart={(event) => {
                                  if (!canEdit) return;
                                  draggingSubCategoryRef.current = {
                                    categoryIndex,
                                    subCategoryIndex,
                                  };
                                  setDraggingSubCategory({
                                    categoryIndex,
                                    subCategoryIndex,
                                  });
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData(
                                    "application/x-subcategory-position",
                                    JSON.stringify({ categoryIndex, subCategoryIndex })
                                  );
                                  event.dataTransfer.setData(
                                    "text/plain",
                                    `${categoryIndex}:${subCategoryIndex}`
                                  );
                                }}
                                onDragOver={(event) => {
                                  if (!canEdit) return;
                                  const draggingState = draggingSubCategoryRef.current;
                                  if (
                                    !Number.isInteger(draggingState.categoryIndex) ||
                                    !Number.isInteger(draggingState.subCategoryIndex) ||
                                    draggingState.categoryIndex !== categoryIndex
                                  ) {
                                    return;
                                  }
                                  event.preventDefault();
                                  event.dataTransfer.dropEffect = "move";
                                  const rect = event.currentTarget.getBoundingClientRect();
                                  const position = event.clientY - rect.top > rect.height / 2 ? "after" : "before";
                                  if (
                                    dragOverSubCategory.categoryIndex !== categoryIndex ||
                                    dragOverSubCategory.subCategoryIndex !== subCategoryIndex ||
                                    dragOverSubCategory.position !== position
                                  ) {
                                    setDragOverSubCategory({
                                      categoryIndex,
                                      subCategoryIndex,
                                      position,
                                    });
                                  }
                                }}
                                onDragEnter={(event) => {
                                  if (!canEdit) return;
                                  const draggingState = draggingSubCategoryRef.current;
                                  if (
                                    !Number.isInteger(draggingState.categoryIndex) ||
                                    !Number.isInteger(draggingState.subCategoryIndex) ||
                                    draggingState.categoryIndex !== categoryIndex
                                  ) {
                                    return;
                                  }
                                  const rect = event.currentTarget.getBoundingClientRect();
                                  const position = event.clientY - rect.top > rect.height / 2 ? "after" : "before";
                                  if (
                                    dragOverSubCategory.categoryIndex !== categoryIndex ||
                                    dragOverSubCategory.subCategoryIndex !== subCategoryIndex ||
                                    dragOverSubCategory.position !== position
                                  ) {
                                    setDragOverSubCategory({
                                      categoryIndex,
                                      subCategoryIndex,
                                      position,
                                    });
                                  }
                                }}
                                onDrop={(event) => {
                                  if (!canEdit) return;
                                  event.preventDefault();
                                  const rawPayload =
                                    event.dataTransfer.getData("application/x-subcategory-position") ||
                                    event.dataTransfer.getData("text/plain");
                                  let fromCategoryIndex = draggingSubCategoryRef.current.categoryIndex;
                                  let fromSubCategoryIndex = draggingSubCategoryRef.current.subCategoryIndex;

                                  if (String(rawPayload || "").trim().startsWith("{")) {
                                    try {
                                      const parsed = JSON.parse(rawPayload);
                                      if (Number.isInteger(parsed?.categoryIndex)) {
                                        fromCategoryIndex = parsed.categoryIndex;
                                      }
                                      if (Number.isInteger(parsed?.subCategoryIndex)) {
                                        fromSubCategoryIndex = parsed.subCategoryIndex;
                                      }
                                    } catch {
                                      // Ignore malformed payload and rely on drag ref fallback.
                                    }
                                  } else if (String(rawPayload || "").includes(":")) {
                                    const [categoryPart, subPart] = String(rawPayload || "").split(":");
                                    const parsedCategory = Number.parseInt(categoryPart, 10);
                                    const parsedSub = Number.parseInt(subPart, 10);
                                    if (Number.isInteger(parsedCategory)) fromCategoryIndex = parsedCategory;
                                    if (Number.isInteger(parsedSub)) fromSubCategoryIndex = parsedSub;
                                  }

                                  const rect = event.currentTarget.getBoundingClientRect();
                                  const position = event.clientY - rect.top > rect.height / 2 ? "after" : "before";
                                  handleSubCategoryDrop(
                                    fromCategoryIndex,
                                    fromSubCategoryIndex,
                                    categoryIndex,
                                    subCategoryIndex,
                                    position
                                  );
                                }}
                                onDragEnd={() => {
                                  resetSubCategoryDragState();
                                }}
                                className={`grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-start ${
                                  dragOverSubCategory.categoryIndex === categoryIndex &&
                                  dragOverSubCategory.subCategoryIndex === subCategoryIndex
                                    ? dragOverSubCategory.position === "after"
                                      ? "border-b-2 border-b-primary"
                                      : "border-t-2 border-t-primary"
                                    : ""
                                } ${
                                  draggingSubCategory.categoryIndex === categoryIndex &&
                                  draggingSubCategory.subCategoryIndex === subCategoryIndex
                                    ? "opacity-70"
                                    : ""
                                }`}
                              >
                                <div className="space-y-1">
                                  <Label htmlFor={`subcategory-en-${categoryIndex}-${subCategoryIndex}`}>
                                    <span className="sr-only">Sub category English value</span>
                                  </Label>
                                  <Input
                                    id={`subcategory-en-${categoryIndex}-${subCategoryIndex}`}
                                    value={subCategory.labelEn || ""}
                                    onChange={(event) =>
                                      updateSubCategory(categoryIndex, subCategoryIndex, "labelEn", event.target.value)
                                    }
                                    placeholder="English value"
                                    disabled={!canEdit}
                                  />
                                  {isBlank(subCategory.labelEn) ? (
                                    <p className="field-help text-red-600 dark:text-red-400">Required field.</p>
                                  ) : null}
                                </div>
                                <div className="space-y-1">
                                  <Label htmlFor={`subcategory-ar-${categoryIndex}-${subCategoryIndex}`}>
                                    <span className="sr-only">Sub category Arabic value</span>
                                  </Label>
                                  <Input
                                    id={`subcategory-ar-${categoryIndex}-${subCategoryIndex}`}
                                    value={subCategory.labelAr || ""}
                                    onChange={(event) =>
                                      updateSubCategory(categoryIndex, subCategoryIndex, "labelAr", event.target.value)
                                    }
                                    placeholder="Arabic value"
                                    disabled={!canEdit}
                                  />
                                  {isBlank(subCategory.labelAr) ? (
                                    <p className="field-help text-red-600 dark:text-red-400">Required field.</p>
                                  ) : null}
                                </div>
                                {canEdit ? (
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="inline-flex cursor-grab items-center text-muted-foreground"
                                      title="Drag to reorder sub category"
                                      aria-hidden="true"
                                    >
                                      <GripVertical className="h-4 w-4" />
                                    </span>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      onClick={() => toggleSubCategoryPublished(categoryIndex, subCategoryIndex)}
                                      aria-label={`${
                                        subCategory?.published !== false ? "Unpublish" : "Publish"
                                      } sub category ${subCategoryIndex + 1} from category ${categoryIndex + 1}`}
                                    >
                                      {subCategory?.published !== false ? (
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
                                      onClick={() => removeSubCategory(categoryIndex, subCategoryIndex)}
                                      aria-label={`Remove sub category ${subCategoryIndex + 1} from category ${
                                        categoryIndex + 1
                                      }`}
                                    >
                                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                                      Remove
                                    </Button>
                                  </div>
                                ) : (
                                  <div aria-hidden="true" />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        {canEdit ? (
                          <div>
                            <Button type="button" variant="secondary" onClick={() => addSubCategory(categoryIndex)}>
                              <Plus className="h-4 w-4" aria-hidden="true" />
                              Add sub category
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
