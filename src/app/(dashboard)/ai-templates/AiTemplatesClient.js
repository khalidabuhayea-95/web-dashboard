"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, ImageOff, Plus, ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardSubtitle,
  CardTitle,
  ImageLightbox,
  Input,
  Label,
  Modal,
  Select,
  Textarea,
} from "@/components/ui";
import {
  AI_TEMPLATE_REFERENCE_KINDS,
  DEFAULT_AI_TEMPLATE_CREDIT_COST,
  DEFAULT_AI_TEMPLATE_REFERENCE_KIND,
} from "@/lib/aiTemplates/constants";
import {
  AI_TEMPLATE_MODEL_DEFINITIONS,
  DEFAULT_AI_TEMPLATE_MODEL_ID,
} from "@/lib/aiTemplates/models";
import GalleryPicker from "@/components/gallery/GalleryPicker";

const modelOptionsFor = (referenceKind) =>
  AI_TEMPLATE_MODEL_DEFINITIONS.filter((definition) =>
    referenceKind === "none" ? definition.supportsTextToImage : definition.supportsImageInput
  );

const modelLabel = (definition) =>
  `${definition.label} — ~$${(definition.priceMicros / 1_000_000).toFixed(3)}/image`;

const EMPTY_CATEGORY_FORM = { titleEn: "", titleAr: "", isNew: false, published: true };

const EMPTY_FORM = {
  categoryId: "",
  titleEn: "",
  titleAr: "",
  prompt: "",
  referenceKind: DEFAULT_AI_TEMPLATE_REFERENCE_KIND,
  model: DEFAULT_AI_TEMPLATE_MODEL_ID,
  creditCost: DEFAULT_AI_TEMPLATE_CREDIT_COST,
  published: true,
};

const ART_SIDES = [
  { kind: "before", label: "Before" },
  { kind: "after", label: "After" },
];

export default function AiTemplatesClient() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  // null = closed, { category: null } = new, { category } = rename
  const [categoryEditor, setCategoryEditor] = useState(null);
  const [categoryForm, setCategoryForm] = useState(EMPTY_CATEGORY_FORM);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState("");
  const [deleting, setDeleting] = useState("");
  const [generating, setGenerating] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  // Staged input for "Generate with AI": picking an image no longer fires the
  // render — it waits here until the explicit Generate click.
  // { kind: "gallery", image } | { kind: "file", file, previewUrl } | null
  const [genSource, setGenSource] = useState(null);
  const [zoomSrc, setZoomSrc] = useState(null);
  const [reordering, setReordering] = useState("");
  // Drag state: the ref survives re-renders during a drag, the state drives the
  // drop indicator. { categoryId, index } identifies a card uniquely, since
  // indexes repeat across categories.
  const draggingRef = useRef(null);
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  const resetDragState = () => {
    draggingRef.current = null;
    setDragging(null);
    setDragOver(null);
  };

  const clearGenSource = useCallback(() => {
    setGenSource((current) => {
      if (current?.kind === "file" && current.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return null;
    });
  }, []);

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/ai-templates");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || `Failed to load templates (${response.status}).`);
      }
      setCategories(payload.categories || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  const stats = useMemo(() => {
    const templates = categories.flatMap((category) => category.templates || []);
    return {
      templates: templates.length,
      categories: categories.length,
      premium: templates.filter((template) => template.isPremium).length,
      missingArt: templates.filter((template) => !template.afterUrl).length,
    };
  }, [categories]);

  const visibleCategories = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return categories;
    return categories
      .map((category) => ({
        ...category,
        templates: (category.templates || []).filter((template) =>
          [template.titleEn, template.titleAr, template.slug]
            .join(" ")
            .toLowerCase()
            .includes(query)
        ),
      }))
      .filter((category) => category.templates.length > 0);
  }, [categories, search]);

  const applyTemplate = useCallback((updated) => {
    setCategories((current) =>
      current.map((category) => ({
        ...category,
        templates: (category.templates || []).map((template) =>
          template.id === updated.id ? updated : template
        ),
      }))
    );
  }, []);

  const openEditor = (template) => {
    setCreating(false);
    setEditing(template);
    setForm({
      categoryId: template.categoryId,
      titleEn: template.titleEn,
      titleAr: template.titleAr,
      prompt: template.prompt,
      referenceKind: template.referenceKind,
      model: template.model,
      creditCost: template.creditCost,
      published: template.published,
    });
    setNotice("");
  };

  const openCreator = () => {
    if (!categories.length) return;
    setEditing(null);
    setCreating(true);
    setForm({ ...EMPTY_FORM, categoryId: categories[0].id });
    setNotice("");
  };

  const closeEditor = () => {
    if (saving || uploading || deleting || generating) return;
    setEditing(null);
    setCreating(false);
    setForm(EMPTY_FORM);
    clearGenSource();
  };

  // Persists a category's full order. The grid is updated optimistically before
  // the request so dragging feels immediate; a failure restores the previous
  // order rather than leaving the screen disagreeing with the database.
  const persistOrder = async (categoryId, orderedTemplates, previousTemplates) => {
    setReordering(categoryId);
    setError("");
    try {
      const response = await fetch(`/api/admin/ai-templates/categories/${categoryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateIds: orderedTemplates.map((item) => item.id) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || `Reorder failed (${response.status}).`);
      }
    } catch (orderError) {
      setError(orderError.message);
      setCategories((current) =>
        current.map((category) =>
          category.id === categoryId ? { ...category, templates: previousTemplates } : category
        )
      );
    } finally {
      setReordering("");
    }
  };

  // Moves the dragged card to sit before or after the drop target.
  const dropTemplate = (categoryId, toIndex, position) => {
    const source = draggingRef.current;
    resetDragState();
    if (!source || source.categoryId !== categoryId) return;

    const category = categories.find((item) => item.id === categoryId);
    if (!category) return;
    const previous = category.templates || [];
    const fromIndex = source.index;
    let target = position === "after" ? toIndex + 1 : toIndex;
    if (target > fromIndex) target -= 1;
    if (fromIndex === target) return;

    const next = [...previous];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(target, 0, moved);

    setCategories((current) =>
      current.map((item) => (item.id === categoryId ? { ...item, templates: next } : item))
    );
    persistOrder(categoryId, next, previous);
  };

  // Reordering swaps with the neighbour server-side; mirror that swap locally so
  // the grid moves instantly instead of waiting on a refetch.
  const moveTemplate = async (categoryId, template, direction) => {
    setReordering(template.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/ai-templates/${template.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || `Reorder failed (${response.status}).`);
      }
      if (!payload.moved) return;
      setCategories((current) =>
        current.map((category) => {
          if (category.id !== categoryId) return category;
          const list = [...(category.templates || [])];
          const index = list.findIndex((item) => item.id === template.id);
          const target = direction === "up" ? index - 1 : index + 1;
          if (index < 0 || target < 0 || target >= list.length) return category;
          [list[index], list[target]] = [list[target], list[index]];
          return { ...category, templates: list };
        })
      );
    } catch (moveError) {
      setError(moveError.message);
    } finally {
      setReordering("");
    }
  };

  const deleteTemplate = async () => {
    if (!editing) return;
    if (!window.confirm(`Delete “${editing.titleEn}”? This cannot be undone.`)) return;
    setDeleting(editing.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/ai-templates/${editing.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || `Delete failed (${response.status}).`);
      }
      setCategories((current) =>
        current.map((category) => ({
          ...category,
          templates: (category.templates || []).filter((template) => template.id !== payload.id),
        }))
      );
      setNotice(`Deleted “${editing.titleEn}”.`);
      setEditing(null);
      setForm(EMPTY_FORM);
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setDeleting("");
    }
  };

  const openCategoryCreator = () => {
    setCategoryEditor({ category: null });
    setCategoryForm(EMPTY_CATEGORY_FORM);
    setNotice("");
  };

  const openCategoryEditor = (category) => {
    setCategoryEditor({ category });
    setCategoryForm({
      titleEn: category.titleEn,
      titleAr: category.titleAr,
      isNew: category.isNew,
      published: category.published,
    });
    setNotice("");
  };

  const saveCategory = async (event) => {
    event.preventDefault();
    if (!categoryEditor) return;
    const existing = categoryEditor.category;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        existing ? `/api/admin/ai-templates/categories/${existing.id}` : "/api/admin/ai-templates/categories",
        {
          method: existing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(categoryForm),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || `Save failed (${response.status}).`);
      }
      if (existing) {
        setCategories((current) =>
          current.map((item) =>
            item.id === payload.category.id ? { ...item, ...payload.category } : item
          )
        );
      } else {
        setCategories((current) => [...current, payload.category]);
      }
      setNotice(
        existing
          ? `Saved “${payload.category.titleEn}”.`
          : `Created category “${payload.category.titleEn}” (${payload.category.slug}).`
      );
      setCategoryEditor(null);
      setCategoryForm(EMPTY_CATEGORY_FORM);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (category) => {
    const count = category.templates?.length || 0;
    const warning = count
      ? `Delete “${category.titleEn}” and its ${count} template${count === 1 ? "" : "s"}? This cannot be undone.`
      : `Delete “${category.titleEn}”? This cannot be undone.`;
    if (!window.confirm(warning)) return;
    setDeleting(category.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/ai-templates/categories/${category.id}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || `Delete failed (${response.status}).`);
      }
      setCategories((current) => current.filter((item) => item.id !== payload.id));
      setNotice(
        `Deleted “${category.titleEn}” and ${payload.deletedTemplates} template${
          payload.deletedTemplates === 1 ? "" : "s"
        }.`
      );
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setDeleting("");
    }
  };

  // Runs the template's saved prompt + model server-side and updates both card
  // images, using whatever input is staged in genSource (none needed for
  // generation-only templates). Renders take 10-60s, so the modal stays open
  // with everything disabled rather than pretending to be instant.
  const generateArt = async () => {
    if (!editing) return;
    const needsInput = editing.referenceKind !== "none";
    if (needsInput && !genSource) return;
    setGenerating(true);
    setError("");
    setNotice("");
    try {
      const formData = new FormData();
      if (needsInput && genSource.kind === "file") formData.set("file", genSource.file);
      if (needsInput && genSource.kind === "gallery") {
        formData.set("galleryImageId", genSource.image.id);
      }
      const response = await fetch(`/api/admin/ai-templates/${editing.id}/generate`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || `Generation failed (${response.status}).`);
      }
      applyTemplate(payload.template);
      setEditing(payload.template);
      clearGenSource();
      setNotice(`Generated new card art for “${payload.template.titleEn}”.`);
    } catch (generateError) {
      setError(generateError.message);
    } finally {
      setGenerating(false);
    }
  };

  const stageFile = (file) => {
    if (!file) return;
    setGenSource((current) => {
      if (current?.kind === "file" && current.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return { kind: "file", file, previewUrl: URL.createObjectURL(file) };
    });
  };

  const stageGalleryImage = (image) => {
    setGalleryOpen(false);
    setGenSource((current) => {
      if (current?.kind === "file" && current.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return { kind: "gallery", image };
    });
  };

  // Art replacement is its own request: the upload endpoint stores the object and
  // writes the URL in one step, so it lands immediately rather than waiting for
  // the text fields to be saved.
  const replaceArt = async (kind, file) => {
    if (!editing || !file) return;
    setUploading(kind);
    setError("");
    try {
      const formData = new FormData();
      formData.set("kind", kind);
      formData.set("file", file);
      const response = await fetch(`/api/admin/ai-templates/${editing.id}/image`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || `Upload failed (${response.status}).`);
      }
      applyTemplate(payload.template);
      setEditing(payload.template);
      setNotice(`Updated the ${kind} image for “${payload.template.titleEn}”.`);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading("");
    }
  };

  const saveTemplate = async (event) => {
    event.preventDefault();
    if (!editing && !creating) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        categoryId: form.categoryId,
        titleEn: form.titleEn,
        titleAr: form.titleAr,
        prompt: form.prompt,
        referenceKind: form.referenceKind,
        model: form.model,
        creditCost: Number(form.creditCost),
        published: form.published,
      };
      const response = await fetch(
        creating ? "/api/admin/ai-templates" : `/api/admin/ai-templates/${editing.id}`,
        {
          method: creating ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || `Save failed (${response.status}).`);
      }
      // A create, or a move between categories, changes which group the row
      // belongs to — refetch rather than trying to splice it into place.
      if (creating || payload.template.categoryId !== editing?.categoryId) {
        await fetchCatalog();
      } else {
        applyTemplate(payload.template);
      }
      setNotice(
        creating
          ? `Created “${payload.template.titleEn}” (${payload.template.slug}).`
          : `Saved “${payload.template.titleEn}”.`
      );
      setEditing(null);
      setCreating(false);
      setForm(EMPTY_FORM);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Sparkles className="h-6 w-6 text-primary" aria-hidden="true" />
          AI Templates
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The prompt catalog behind the mobile AI Tools tab. Prompts stay server-side — edit them
          here, re-render the card art with <code>npm run render:ai-templates</code>.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {[
          [stats.templates, "Templates"],
          [stats.categories, "Categories"],
          [stats.premium, "Premium"],
          [stats.missingArt, "Missing art"],
        ].map(([value, label]) => (
          <div key={label} className="rounded-xl border bg-card px-3.5 py-2.5">
            <div className="text-lg font-semibold leading-none">{value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search templates…"
            aria-label="Search templates"
            className="w-56"
          />
          <Button
            variant="secondary"
            onClick={openCategoryCreator}
            className="inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New category
          </Button>
          <Button
            onClick={openCreator}
            disabled={!categories.length}
            className="inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New template
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading templates…</p> : null}
      {!loading && !categories.length && !error ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No templates yet. Seed the catalog with{" "}
              <code>npm run seed:ai-templates -- --renders &lt;dir&gt;</code>.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {visibleCategories.map((category) => (
        <Card key={category.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              {category.titleEn}
              <span dir="rtl" className="text-base font-medium text-primary">
                {category.titleAr}
              </span>
              {category.isNew ? <Badge variant="success">New</Badge> : null}
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {category.templates.length} template{category.templates.length === 1 ? "" : "s"}
              </span>
              <Button
                variant="secondary"
                onClick={() => openCategoryEditor(category)}
                disabled={Boolean(deleting)}
                aria-label={`Rename category ${category.titleEn}`}
              >
                Rename
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteCategory(category)}
                disabled={Boolean(deleting)}
                aria-label={`Delete category ${category.titleEn}`}
              >
                {deleting === category.id ? "Deleting…" : "Delete"}
              </Button>
            </CardTitle>
            <CardSubtitle>{category.slug}</CardSubtitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
              {category.templates.map((template, templateIndex) => {
                const isDragging =
                  dragging?.categoryId === category.id && dragging.index === templateIndex;
                const isDragOver =
                  dragOver?.categoryId === category.id && dragOver.index === templateIndex;
                // Cards flow left-to-right, so the insertion side is decided by
                // the horizontal midpoint rather than the vertical one.
                const sideFromEvent = (event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  return event.clientX - rect.left > rect.width / 2 ? "after" : "before";
                };
                const noteDragOver = (event) => {
                  if (!draggingRef.current || draggingRef.current.categoryId !== category.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  const position = sideFromEvent(event);
                  if (dragOver?.index !== templateIndex || dragOver?.position !== position) {
                    setDragOver({ categoryId: category.id, index: templateIndex, position });
                  }
                };
                return (
                <div
                  key={template.id}
                  className={`rounded-lg border bg-card p-2 transition-shadow ${
                    isDragging ? "opacity-50" : ""
                  } ${
                    isDragOver
                      ? dragOver.position === "after"
                        ? "border-r-2 border-r-primary"
                        : "border-l-2 border-l-primary"
                      : ""
                  }`}
                  draggable
                  onDragStart={(event) => {
                    draggingRef.current = { categoryId: category.id, index: templateIndex };
                    setDragging({ categoryId: category.id, index: templateIndex });
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", template.id);
                  }}
                  onDragOver={noteDragOver}
                  onDragEnter={noteDragOver}
                  onDrop={(event) => {
                    event.preventDefault();
                    dropTemplate(category.id, templateIndex, sideFromEvent(event));
                  }}
                  onDragEnd={resetDragState}
                >
                  {/* The artwork is the card. Everything else floats over it on
                      hover so nothing competes with the image at rest. */}
                  <div className="group relative overflow-hidden rounded-md">
                    {template.afterUrl ? (
                      <button
                        type="button"
                        className="block w-full cursor-zoom-in"
                        onClick={() => setZoomSrc(template.afterUrl)}
                        aria-label={`Zoom ${template.titleEn}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={template.afterUrl}
                          alt={template.titleEn}
                          className="aspect-[3/4] w-full object-cover"
                          loading="lazy"
                        />
                      </button>
                    ) : (
                      <div className="flex aspect-[3/4] w-full items-center justify-center bg-muted">
                        <span className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
                          <ImageOff className="h-4 w-4" aria-hidden="true" /> No render
                        </span>
                      </div>
                    )}

                    {/* Small "before" chip — a hint of the input, not a second image. */}
                    {template.beforeUrl ? (
                      <button
                        type="button"
                        className="absolute bottom-1.5 left-1.5 h-9 w-9 overflow-hidden rounded border border-white/90 shadow-sm transition-transform hover:scale-110"
                        onClick={() => setZoomSrc(template.beforeUrl)}
                        aria-label={`Zoom ${template.titleEn} input photo`}
                        title="Input photo"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={template.beforeUrl}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </button>
                    ) : null}

                    {/* Status corner. Solid fills rather than the tinted .badge
                        style, so they stay legible over any artwork. */}
                    <div className="pointer-events-none absolute left-1.5 top-1.5 flex gap-1">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white shadow-sm ${
                          template.published ? "bg-emerald-600/90" : "bg-amber-500"
                        }`}
                      >
                        {template.published ? "Published" : "Hidden"}
                      </span>
                      {template.isPremium ? (
                        <span className="rounded bg-white/95 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-destructive shadow-sm">
                          Pro
                        </span>
                      ) : null}
                    </div>

                    {/* Controls appear on hover, over a gradient so they stay
                        readable on any artwork. */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 pt-6 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <span
                        className="pointer-events-auto cursor-grab text-white/80 active:cursor-grabbing"
                        title="Drag to reorder"
                        aria-hidden="true"
                      >
                        <GripVertical className="h-4 w-4" />
                      </span>
                      <button
                        type="button"
                        className="pointer-events-auto rounded p-0.5 text-white/80 hover:bg-white/20 hover:text-white disabled:opacity-30"
                        onClick={() => moveTemplate(category.id, template, "up")}
                        disabled={templateIndex === 0 || Boolean(reordering)}
                        aria-label={`Move ${template.titleEn} earlier`}
                        title="Move earlier"
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="pointer-events-auto rounded p-0.5 text-white/80 hover:bg-white/20 hover:text-white disabled:opacity-30"
                        onClick={() => moveTemplate(category.id, template, "down")}
                        disabled={
                          templateIndex === category.templates.length - 1 || Boolean(reordering)
                        }
                        aria-label={`Move ${template.titleEn} later`}
                        title="Move later"
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="pointer-events-auto ml-auto rounded bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-foreground hover:bg-white"
                        onClick={() => openEditor(template)}
                      >
                        Edit
                      </button>
                    </div>
                  </div>

                  {/* Titles sit together on one line: English leads, Arabic
                      trails right — the same pairing the app itself uses. */}
                  <div className="mt-1.5 flex items-baseline justify-between gap-1.5">
                    <span
                      className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-tight"
                      title={template.titleEn}
                    >
                      {template.titleEn}
                    </span>
                    <span
                      dir="rtl"
                      className="min-w-0 flex-1 truncate text-right text-[11px] text-primary"
                      title={template.titleAr}
                    >
                      {template.titleAr}
                    </span>
                  </div>
                </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}

      <Modal
        open={Boolean(categoryEditor)}
        onClose={() => (saving ? null : setCategoryEditor(null))}
        className="max-h-[85vh] overflow-y-auto"
      >
        {categoryEditor ? (
          <form onSubmit={saveCategory} className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">
                {categoryEditor.category ? "Rename category" : "New category"}
              </h2>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                {categoryEditor.category
                  ? categoryEditor.category.slug
                  : "Slug is generated from the English title."}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ai-category-title-en">Title (English)</Label>
                <Input
                  id="ai-category-title-en"
                  value={categoryForm.titleEn}
                  onChange={(event) =>
                    setCategoryForm((f) => ({ ...f, titleEn: event.target.value }))
                  }
                  required
                />
              </div>
              <div>
                <Label htmlFor="ai-category-title-ar">Title (Arabic)</Label>
                <Input
                  id="ai-category-title-ar"
                  dir="rtl"
                  value={categoryForm.titleAr}
                  onChange={(event) =>
                    setCategoryForm((f) => ({ ...f, titleAr: event.target.value }))
                  }
                  required
                />
              </div>
            </div>

            {categoryEditor.category ? (
              <p className="field-help mt-0">
                The slug stays fixed — template slugs are built from it, and the seed matches on it.
              </p>
            ) : null}

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={categoryForm.isNew}
                  onChange={(event) =>
                    setCategoryForm((f) => ({ ...f, isNew: event.target.checked }))
                  }
                />
                Show “New” badge
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={categoryForm.published}
                  onChange={(event) =>
                    setCategoryForm((f) => ({ ...f, published: event.target.checked }))
                  }
                />
                Published
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                type="button"
                onClick={() => setCategoryEditor(null)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving
                  ? "Saving…"
                  : categoryEditor.category
                    ? "Save changes"
                    : "Create category"}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(editing) || creating}
        onClose={closeEditor}
        className="max-h-[85vh] overflow-y-auto"
      >
        {editing || creating ? (
          <form onSubmit={saveTemplate} className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">
                {creating ? "New template" : "Edit template"}
              </h2>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                {creating ? "Slug is generated from the category and English title." : editing.slug}
              </p>
            </div>

            <div>
              <Label htmlFor="ai-template-category">Category</Label>
              <Select
                id="ai-template-category"
                value={form.categoryId}
                onChange={(event) => setForm((f) => ({ ...f, categoryId: event.target.value }))}
                required
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.titleEn} — {category.titleAr}
                  </option>
                ))}
              </Select>
              {!creating && form.categoryId !== editing?.categoryId ? (
                <p className="field-help">Saving moves this template into the new category.</p>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ai-template-title-en">Title (English)</Label>
                <Input
                  id="ai-template-title-en"
                  value={form.titleEn}
                  onChange={(event) => setForm((f) => ({ ...f, titleEn: event.target.value }))}
                  required
                />
              </div>
              <div>
                <Label htmlFor="ai-template-title-ar">Title (Arabic)</Label>
                <Input
                  id="ai-template-title-ar"
                  dir="rtl"
                  value={form.titleAr}
                  onChange={(event) => setForm((f) => ({ ...f, titleAr: event.target.value }))}
                  required
                />
              </div>
              <div>
                <Label htmlFor="ai-template-credits">Credit cost</Label>
                <Input
                  id="ai-template-credits"
                  type="number"
                  min="0"
                  max="10000"
                  value={form.creditCost}
                  onChange={(event) => setForm((f) => ({ ...f, creditCost: event.target.value }))}
                  required
                />
              </div>
              <div>
                <Label htmlFor="ai-template-reference">Input photo</Label>
                <Select
                  id="ai-template-reference"
                  value={form.referenceKind}
                  onChange={(event) => {
                    const referenceKind = event.target.value;
                    setForm((f) => {
                      const options = modelOptionsFor(referenceKind);
                      const modelStillValid = options.some((option) => option.id === f.model);
                      return {
                        ...f,
                        referenceKind,
                        model: modelStillValid ? f.model : options[0]?.id || f.model,
                      };
                    });
                  }}
                >
                  {AI_TEMPLATE_REFERENCE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind === "none" ? "none — generated from the prompt" : kind}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="ai-template-model">Model</Label>
                <Select
                  id="ai-template-model"
                  value={form.model}
                  onChange={(event) => setForm((f) => ({ ...f, model: event.target.value }))}
                >
                  {modelOptionsFor(form.referenceKind).map((definition) => (
                    <option key={definition.id} value={definition.id}>
                      {modelLabel(definition)}
                    </option>
                  ))}
                </Select>
                <p className="field-help">
                  Options match the input kind — generation-only models hide when the template
                  edits a photo.
                </p>
              </div>
            </div>

            <div>
              <Label htmlFor="ai-template-prompt">Prompt (server-side only)</Label>
              <Textarea
                id="ai-template-prompt"
                rows={8}
                value={form.prompt}
                onChange={(event) => setForm((f) => ({ ...f, prompt: event.target.value }))}
                required
              />
              <p className="field-help">
                State what must be preserved before what should change.{" "}
                {editing ? (
                  <>
                    After editing, re-render this card with{" "}
                    <code>npm run render:ai-templates -- --only {editing.slug}</code> and re-seed.
                  </>
                ) : (
                  <>
                    A prompt that opens with “Keep the … identical” edits the user’s photo;
                    otherwise it generates a design from scratch and needs no input.
                  </>
                )}
              </p>
            </div>

            {editing ? (
            <div>
              <Label>Card art</Label>
              <p className="field-help mb-1.5 mt-0">
                {editing.referenceKind === "none" ? (
                  <>
                    Generated from the prompt alone — this template has no input photo, so it has no
                    before image.
                  </>
                ) : (
                  <>
                    Expects a <strong>{editing.referenceKind}</strong> photo as input; the before
                    image should be that kind of subject.
                  </>
                )}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-4">
                {ART_SIDES.map(({ kind, label }) => {
                  const url = kind === "before" ? editing.beforeUrl : editing.afterUrl;
                  const busy = uploading === kind;
                  return (
                    <div key={kind} className="flex w-28 flex-col gap-1.5">
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {label}
                      </span>
                      {url ? (
                        <button
                          type="button"
                          className="cursor-zoom-in"
                          onClick={() => setZoomSrc(url)}
                          aria-label={`Zoom ${kind} image`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`${editing.titleEn} — ${kind}`}
                            className="aspect-[3/4] w-full rounded-lg object-cover"
                          />
                        </button>
                      ) : (
                        <div className="flex aspect-[3/4] w-full items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
                          None
                        </div>
                      )}
                      <label
                        className={`btn btn-secondary ${
                          uploading ? "pointer-events-none opacity-60" : "cursor-pointer"
                        }`}
                      >
                        {busy ? "Uploading…" : url ? "Replace" : "Upload"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={Boolean(uploading)}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            replaceArt(kind, file);
                          }}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
              <p className="field-help">
                Images are resized and saved as soon as you pick one — the fields above still need
                Save changes.
              </p>

              <div className="mt-3 rounded-xl bg-[var(--ds-surface-muted,#f4f6f6)] p-3.5">
                <div className="text-sm font-semibold">Generate with AI</div>
                <p className="field-help mt-0.5">
                  Runs this template’s saved prompt and model
                  {editing.referenceKind === "none"
                    ? " from scratch — no input photo needed."
                    : ` on a ${editing.referenceKind} photo, and fills both card images.`}{" "}
                  Save prompt changes first.
                </p>
                {editing.referenceKind !== "none" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setGalleryOpen(true)}
                      disabled={generating || Boolean(uploading) || Boolean(deleting)}
                    >
                      Choose from gallery
                    </Button>
                    <label
                      className={`btn btn-secondary ${
                        generating || uploading ? "pointer-events-none opacity-60" : "cursor-pointer"
                      }`}
                    >
                      Upload photo
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={generating || Boolean(uploading)}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          stageFile(file);
                        }}
                      />
                    </label>
                  </div>
                ) : null}

                {genSource ? (
                  <div className="mt-2.5 flex items-center gap-3 rounded-lg bg-card p-2">
                    <button
                      type="button"
                      className="shrink-0 cursor-zoom-in"
                      onClick={() =>
                        setZoomSrc(
                          genSource.kind === "file" ? genSource.previewUrl : genSource.image.url
                        )
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={genSource.kind === "file" ? genSource.previewUrl : genSource.image.url}
                        alt="Selected input"
                        className="h-14 w-14 rounded-md object-cover"
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">
                        {genSource.kind === "file"
                          ? genSource.file.name
                          : genSource.image.name || "Gallery image"}
                      </div>
                      <div className="text-[11px] text-muted-foreground">Ready to generate</div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={clearGenSource}
                      disabled={generating}
                    >
                      Remove
                    </Button>
                  </div>
                ) : null}

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={generateArt}
                    disabled={
                      generating ||
                      Boolean(uploading) ||
                      Boolean(deleting) ||
                      (editing.referenceKind !== "none" && !genSource)
                    }
                  >
                    {generating
                      ? "Generating…"
                      : editing.referenceKind === "none"
                        ? "Generate from prompt"
                        : "Generate"}
                  </Button>
                  {generating ? (
                    <span className="text-xs text-muted-foreground">
                      This can take up to a minute — leave the dialog open.
                    </span>
                  ) : editing.referenceKind !== "none" && !genSource ? (
                    <span className="text-xs text-muted-foreground">
                      Pick or upload a photo first.
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            ) : null}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.published}
                onChange={(event) => setForm((f) => ({ ...f, published: event.target.checked }))}
              />
              Published
            </label>

            <div className="flex items-center justify-between gap-2">
              {editing ? (
                <Button
                  variant="destructive"
                  type="button"
                  onClick={deleteTemplate}
                  disabled={saving || Boolean(uploading) || Boolean(deleting)}
                >
                  {deleting === editing.id ? "Deleting…" : "Delete template"}
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  type="button"
                  onClick={closeEditor}
                  disabled={saving || Boolean(uploading) || Boolean(deleting)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saving || Boolean(uploading) || Boolean(deleting)}
                >
                  {saving ? "Saving…" : creating ? "Create template" : "Save changes"}
                </Button>
              </div>
            </div>
          </form>
        ) : null}
      </Modal>

      {/* Mounted last and with a raised backdrop so it stacks above the edit
          modal it is opened from. Selecting stages the image; the explicit
          Generate button fires the render. */}
      <GalleryPicker
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onSelect={stageGalleryImage}
        title={editing ? `Pick a ${editing.referenceKind} photo` : "Choose from gallery"}
      />

      <ImageLightbox src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </div>
  );
}
