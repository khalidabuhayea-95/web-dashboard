"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Wand2, ImageOff, Plus, ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import {
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
  Switch,
  Textarea,
} from "@/components/ui";
import {
  DEFAULT_MAGIC_TOOL_CREDIT_COST,
  MAX_MAGIC_TOOL_SUBTITLE_LENGTH,
} from "@/lib/magicTools/constants";
import {
  DEFAULT_MAGIC_TOOL_MODEL_ID,
  MAGIC_TOOL_MODEL_DEFINITIONS,
  getMagicToolModelDefinition,
  resolveMagicToolOptions,
} from "@/lib/magicTools/models";
import GalleryPicker from "@/components/gallery/GalleryPicker";

const modelLabel = (definition) =>
  definition.priceMicros === 0
    ? `${definition.label} — free (self-hosted)`
    : `${definition.label} — ~$${(definition.priceMicros / 1_000_000).toFixed(3)}/run`;

const EMPTY_FORM = {
  titleEn: "",
  titleAr: "",
  subtitleAr: "",
  prompt: "",
  model: DEFAULT_MAGIC_TOOL_MODEL_ID,
  modelOptions: {},
  creditCost: DEFAULT_MAGIC_TOOL_CREDIT_COST,
  published: true,
  isPremium: false,
};

const ART_SIDES = [
  { kind: "before", label: "Before" },
  { kind: "after", label: "After" },
];

// Cut-outs are published as transparent PNGs, so their card needs something
// behind the alpha or the result reads as a plain white square.
const CHECKERBOARD =
  "repeating-conic-gradient(rgb(0 0 0 / 0.06) 0% 25%, transparent 0% 50%) 50% / 14px 14px";

export default function MagicToolsClient() {
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const [reordering, setReordering] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const draggingRef = useRef(null);

  const [uploadingSide, setUploadingSide] = useState("");
  const [generating, setGenerating] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [staged, setStaged] = useState(null);
  const [zoomSrc, setZoomSrc] = useState(null);

  const definition = useMemo(() => getMagicToolModelDefinition(form.model), [form.model]);
  const resolvedOptions = useMemo(
    () => (definition ? resolveMagicToolOptions(definition, form.modelOptions) : {}),
    [definition, form.modelOptions]
  );

  const fetchTools = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/magic-tools");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not load the magic tools.");
      }
      setTools(payload.tools || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  const resetDragState = () => {
    draggingRef.current = null;
    setDragging(null);
    setDragOver(null);
  };

  const openEditor = (tool) => {
    setCreating(false);
    setEditing(tool);
    setStaged(null);
    setStatus("");
    setForm({
      titleEn: tool.titleEn,
      titleAr: tool.titleAr,
      subtitleAr: tool.subtitleAr || "",
      prompt: tool.prompt || "",
      model: tool.model,
      modelOptions: tool.modelOptions || {},
      creditCost: tool.creditCost,
      published: tool.published,
      isPremium: tool.isPremium,
    });
  };

  const openCreate = () => {
    setCreating(true);
    setEditing({ id: null, slug: "", titleEn: "", titleAr: "" });
    setStaged(null);
    setStatus("");
    setForm(EMPTY_FORM);
  };

  const closeEditor = () => {
    if (saving || generating || uploadingSide) return;
    setEditing(null);
    setCreating(false);
    setStaged(null);
  };

  // Switching models changes which knobs exist and whether a prompt is even
  // read, so the form drops both rather than carrying stale settings across.
  const changeModel = (modelId) => {
    const next = getMagicToolModelDefinition(modelId);
    setForm((current) => ({
      ...current,
      model: modelId,
      modelOptions: {},
      prompt: next?.requiresPrompt ? current.prompt : "",
    }));
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const payloadBody = {
        titleEn: form.titleEn,
        titleAr: form.titleAr,
        subtitleAr: form.subtitleAr,
        prompt: form.prompt,
        model: form.model,
        modelOptions: Object.keys(form.modelOptions || {}).length ? form.modelOptions : null,
        creditCost: Number(form.creditCost),
        published: form.published,
        isPremium: form.isPremium,
      };
      const response = await fetch(
        creating ? "/api/admin/magic-tools" : `/api/admin/magic-tools/${editing.id}`,
        {
          method: creating ? "POST" : "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payloadBody),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not save the tool.");
      await fetchTools();
      setStatus(creating ? "Tool created." : "Saved.");
      if (creating) {
        setCreating(false);
        setEditing(payload.tool);
      } else {
        setEditing(payload.tool);
      }
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing?.id) return;
    if (!window.confirm(`Delete "${editing.titleEn}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/magic-tools/${editing.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not delete the tool.");
      setEditing(null);
      await fetchTools();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setSaving(false);
    }
  };

  const moveTool = async (tool, direction) => {
    setReordering(tool.id);
    try {
      const response = await fetch(`/api/admin/magic-tools/${tool.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not reorder.");
      await fetchTools();
    } catch (moveError) {
      setError(moveError.message);
    } finally {
      setReordering(false);
    }
  };

  // Optimistic: the grid settles immediately and rolls back if the write fails,
  // because a drag that visibly snaps back after a round trip feels broken.
  const dropTool = async (targetIndex, position) => {
    const source = draggingRef.current;
    resetDragState();
    if (source === null || source === undefined) return;

    const next = [...tools];
    const [moved] = next.splice(source, 1);
    let insertAt = targetIndex + (position === "after" ? 1 : 0);
    if (source < insertAt) insertAt -= 1;
    if (insertAt === source) return;
    next.splice(insertAt, 0, moved);

    const previous = tools;
    setTools(next);
    setReordering(moved.id);
    try {
      const response = await fetch(`/api/admin/magic-tools/${moved.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order: next.map((tool) => tool.id) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not reorder.");
    } catch (dropError) {
      setTools(previous);
      setError(dropError.message);
    } finally {
      setReordering(false);
    }
  };

  const replaceArt = async (kind, file) => {
    if (!file || !editing?.id) return;
    setUploadingSide(kind);
    setError("");
    setStatus("");
    try {
      const body = new FormData();
      body.append("kind", kind);
      body.append("file", file);
      const response = await fetch(`/api/admin/magic-tools/${editing.id}/image`, {
        method: "POST",
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not replace the image.");
      setEditing(payload.tool);
      await fetchTools();
      setStatus(`${kind === "before" ? "Before" : "After"} image replaced.`);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploadingSide("");
    }
  };

  // Staged, not immediate: picking a photo should not spend money on its own —
  // the run happens when Generate is pressed.
  const stageGalleryImage = (image) => {
    setGalleryOpen(false);
    setStaged({ galleryImageId: image.id, preview: image.url, name: image.name || "gallery image" });
    setStatus("");
  };

  const stageFile = (file) => {
    if (!file) return;
    setStaged({ file, preview: URL.createObjectURL(file), name: file.name });
    setStatus("");
  };

  const generate = async () => {
    if (!editing?.id || !staged) return;
    setGenerating(true);
    setError("");
    setStatus("");
    try {
      const body = new FormData();
      if (staged.file) body.append("file", staged.file);
      else body.append("galleryImageId", staged.galleryImageId);
      const response = await fetch(`/api/admin/magic-tools/${editing.id}/generate`, {
        method: "POST",
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not generate the art.");
      setEditing(payload.tool);
      setStaged(null);
      await fetchTools();
      setStatus("Card art generated.");
    } catch (generateError) {
      setError(generateError.message);
    } finally {
      setGenerating(false);
    }
  };

  const setOption = (key, value) => {
    setForm((current) => ({ ...current, modelOptions: { ...current.modelOptions, [key]: value } }));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" aria-hidden="true" />
              Magic Tools
            </CardTitle>
            <CardSubtitle>
              One-tap fixes for the app. The user picks a photo — no prompt, no choices.
            </CardSubtitle>
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New tool
          </Button>
        </CardHeader>
        <CardContent>
          {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tools.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tools yet. Run <code>npm run seed:magic-tools -- --create</code> to load the library.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
              {tools.map((tool, index) => {
                const isDragging = dragging === index;
                const isDragOver = dragOver?.index === index;
                // Cards flow left-to-right, so the insertion side is decided by
                // the horizontal midpoint rather than the vertical one.
                const sideFromEvent = (event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  return event.clientX - rect.left > rect.width / 2 ? "after" : "before";
                };
                const noteDragOver = (event) => {
                  if (draggingRef.current === null || draggingRef.current === undefined) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  const position = sideFromEvent(event);
                  if (dragOver?.index !== index || dragOver?.position !== position) {
                    setDragOver({ index, position });
                  }
                };
                const toolModel = getMagicToolModelDefinition(tool.model);
                return (
                  <div
                    key={tool.id}
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
                      draggingRef.current = index;
                      setDragging(index);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", tool.id);
                    }}
                    onDragOver={noteDragOver}
                    onDragEnter={noteDragOver}
                    onDrop={(event) => {
                      event.preventDefault();
                      dropTool(index, sideFromEvent(event));
                    }}
                    onDragEnd={resetDragState}
                  >
                    {/* The artwork is the card. Everything else floats over it on
                        hover so nothing competes with the image at rest. */}
                    <div className="group relative overflow-hidden rounded-md">
                      {tool.afterUrl ? (
                        <button
                          type="button"
                          className="block w-full cursor-zoom-in"
                          onClick={() => setZoomSrc(tool.afterUrl)}
                          aria-label={`Zoom ${tool.titleEn}`}
                          style={{ background: CHECKERBOARD }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={tool.afterUrl}
                            alt={tool.titleEn}
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
                      {tool.beforeUrl ? (
                        <button
                          type="button"
                          className="absolute bottom-1.5 left-1.5 h-9 w-9 overflow-hidden rounded border border-white/90 shadow-sm transition-transform hover:scale-110"
                          onClick={() => setZoomSrc(tool.beforeUrl)}
                          aria-label={`Zoom ${tool.titleEn} input photo`}
                          title="Input photo"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={tool.beforeUrl}
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
                            tool.published ? "bg-emerald-600/90" : "bg-amber-500"
                          }`}
                        >
                          {tool.published ? "Published" : "Hidden"}
                        </span>
                        {tool.isPremium ? (
                          <span className="rounded bg-white/95 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-destructive shadow-sm">
                            Pro
                          </span>
                        ) : null}
                      </div>

                      {/* Cost sits on the art: it is the number that decides
                          whether a tool earns its place. */}
                      <span className="pointer-events-none absolute right-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm">
                        {tool.creditCost}
                        {toolModel ? ` · ${(toolModel.priceMicros / 10_000).toFixed(1)}¢` : ""}
                      </span>

                      {/* Controls appear on hover, over a gradient so they stay
                          readable on any artwork. */}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 pt-6 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
                          onClick={() => moveTool(tool, "up")}
                          disabled={index === 0 || Boolean(reordering)}
                          aria-label={`Move ${tool.titleEn} earlier`}
                          title="Move earlier"
                        >
                          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="pointer-events-auto rounded p-0.5 text-white/80 hover:bg-white/20 hover:text-white disabled:opacity-30"
                          onClick={() => moveTool(tool, "down")}
                          disabled={index === tools.length - 1 || Boolean(reordering)}
                          aria-label={`Move ${tool.titleEn} later`}
                          title="Move later"
                        >
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="pointer-events-auto ml-auto rounded bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-foreground hover:bg-white"
                          onClick={() => openEditor(tool)}
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
                        title={tool.titleEn}
                      >
                        {tool.titleEn}
                      </span>
                      <span
                        dir="rtl"
                        className="min-w-0 flex-1 truncate text-right text-[11px] text-primary"
                        title={tool.titleAr}
                      >
                        {tool.titleAr}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={Boolean(editing)}
        onClose={closeEditor}
        className="max-h-[85vh] w-[min(720px,92vw)] overflow-y-auto"
      >
        {editing ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">
                {creating ? "New magic tool" : editing.titleEn}
              </h2>
              {editing.slug ? (
                <p className="text-xs text-muted-foreground">{editing.slug}</p>
              ) : null}
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {status ? <p className="text-sm text-emerald-600">{status}</p> : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="tool-title-en">English title</Label>
                <Input
                  id="tool-title-en"
                  value={form.titleEn}
                  onChange={(event) => setForm({ ...form, titleEn: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="tool-title-ar">Arabic title</Label>
                <Input
                  id="tool-title-ar"
                  dir="rtl"
                  value={form.titleAr}
                  onChange={(event) => setForm({ ...form, titleAr: event.target.value })}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="tool-subtitle">Arabic subtitle (shown under the name in the app)</Label>
              <Input
                id="tool-subtitle"
                dir="rtl"
                maxLength={MAX_MAGIC_TOOL_SUBTITLE_LENGTH}
                value={form.subtitleAr}
                onChange={(event) => setForm({ ...form, subtitleAr: event.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="tool-model">Model</Label>
                <Select
                  id="tool-model"
                  value={form.model}
                  onChange={(event) => changeModel(event.target.value)}
                >
                  {MAGIC_TOOL_MODEL_DEFINITIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {modelLabel(option)}
                    </option>
                  ))}
                </Select>
                {definition?.notes ? (
                  <p className="mt-1 text-xs text-muted-foreground">{definition.notes}</p>
                ) : null}
              </div>
              <div>
                <Label htmlFor="tool-credit">Credit cost</Label>
                <Input
                  id="tool-credit"
                  type="number"
                  min={0}
                  value={form.creditCost}
                  onChange={(event) => setForm({ ...form, creditCost: event.target.value })}
                />
                {definition ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Costs us ~${(definition.priceMicros / 1_000_000).toFixed(3)} per run.
                  </p>
                ) : null}
              </div>
            </div>

            {definition?.requiresPrompt ? (
              <div>
                <Label htmlFor="tool-prompt">Prompt (server-side — never sent to the app)</Label>
                <Textarea
                  id="tool-prompt"
                  rows={6}
                  value={form.prompt}
                  onChange={(event) => setForm({ ...form, prompt: event.target.value })}
                />
              </div>
            ) : (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                This model takes no instruction — it is configured by the settings below.
              </p>
            )}

            {definition?.optionFields?.length ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {definition.optionFields.map((field) => (
                  <div key={field.key}>
                    <Label htmlFor={`tool-option-${field.key}`}>{field.label}</Label>
                    {field.type === "boolean" ? (
                      <label className="mt-1 flex items-center gap-2 text-sm">
                        <input
                          id={`tool-option-${field.key}`}
                          type="checkbox"
                          checked={Boolean(resolvedOptions[field.key])}
                          onChange={(event) => setOption(field.key, event.target.checked)}
                        />
                        Enabled
                      </label>
                    ) : field.type === "enum" ? (
                      <Select
                        id={`tool-option-${field.key}`}
                        value={String(resolvedOptions[field.key] ?? "")}
                        onChange={(event) => setOption(field.key, event.target.value)}
                      >
                        {field.values.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        id={`tool-option-${field.key}`}
                        type="number"
                        min={field.min}
                        max={field.max}
                        value={String(resolvedOptions[field.key] ?? "")}
                        onChange={(event) => setOption(field.key, Number(event.target.value))}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.published}
                  onChange={(event) => setForm({ ...form, published: event.target.checked })}
                />
                Published
              </label>
              <Switch
                checked={form.isPremium}
                label="Pro only"
                onChange={(next) => setForm({ ...form, isPremium: next })}
              />
            </div>

            {!creating && editing.id ? (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-sm font-medium">Card art</p>
                <div className="grid grid-cols-2 gap-3">
                  {ART_SIDES.map((side) => {
                    const src = side.kind === "before" ? editing.beforeUrl : editing.afterUrl;
                    return (
                      <div key={side.kind} className="space-y-1.5">
                        <p className="text-xs text-muted-foreground">{side.label}</p>
                        {src ? (
                          <button
                            type="button"
                            className="block w-full cursor-zoom-in"
                            onClick={() => setZoomSrc(src)}
                            style={
                              side.kind === "after" ? { background: CHECKERBOARD } : undefined
                            }
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={src}
                              alt={side.label}
                              className="aspect-[3/4] w-full rounded-lg object-cover"
                            />
                          </button>
                        ) : (
                          <div className="flex aspect-[3/4] w-full items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
                            None
                          </div>
                        )}
                        <label className="block cursor-pointer text-xs text-primary underline">
                          {uploadingSide === side.kind ? "Uploading…" : "Replace"}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) => replaceArt(side.kind, event.target.files?.[0])}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-2 border-t pt-3">
                  <p className="text-sm font-medium">Generate with this tool</p>
                  <p className="text-xs text-muted-foreground">
                    Runs the tool on a photo you choose and stores the pair as its card art.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" onClick={() => setGalleryOpen(true)}>
                      Choose from gallery
                    </Button>
                    <label className="cursor-pointer text-xs text-primary underline">
                      or upload a file
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => stageFile(event.target.files?.[0])}
                      />
                    </label>
                  </div>
                  {staged ? (
                    <div className="flex items-center gap-3 rounded-md border p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={staged.preview}
                        alt=""
                        className="h-14 w-14 rounded object-cover"
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {staged.name}
                      </span>
                      <Button type="button" onClick={generate} disabled={generating}>
                        {generating ? "Generating…" : "Generate"}
                      </Button>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline"
                        onClick={() => setStaged(null)}
                        disabled={generating}
                      >
                        Clear
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3 border-t pt-3">
              {!creating && editing.id ? (
                <button
                  type="button"
                  className="text-sm text-destructive underline"
                  onClick={remove}
                  disabled={saving}
                >
                  Delete tool
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={closeEditor} disabled={saving}>
                  Close
                </Button>
                <Button type="button" onClick={save} disabled={saving}>
                  {saving ? "Saving…" : creating ? "Create" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <GalleryPicker
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onSelect={stageGalleryImage}
        title="Pick a photo to run the tool on"
      />

      <ImageLightbox src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </div>
  );
}
