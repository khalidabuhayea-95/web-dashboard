"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Palette, Plus, ChevronLeft, ChevronRight, GripVertical, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardSubtitle,
  CardTitle,
  Input,
  Label,
  Modal,
  Select,
  Switch,
} from "@/components/ui";
import { normalizeTextEffectSpec, TEXT_EFFECT_FILL_KINDS } from "@/lib/textEffects/spec";
import EffectPreview from "./EffectPreview";

const BLANK_SPEC = {
  fill: { kind: "gradient", angle: 90, stops: [[0, "#5c3d0c"], [0.5, "#fdf3c9"], [1, "#4a3009"]] },
  stroke: { width: 0.05, color: "#2a1c05" },
  shadow: { enabled: true, color: "rgba(0,0,0,0.5)", blur: 0.05, offsetX: 0.025, offsetY: 0.06 },
  sheen: { enabled: true, color: "rgba(255,255,255,0.55)", width: 0.016, offsetY: -0.016 },
};

const EMPTY_FORM = { titleEn: "", titleAr: "", isPremium: false, published: true, spec: BLANK_SPEC };

export default function TextEffectsClient() {
  const [effects, setEffects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [sampleText, setSampleText] = useState("مبروك");
  const [reordering, setReordering] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const draggingRef = useRef(null);

  const normalized = useMemo(() => normalizeTextEffectSpec(form.spec), [form.spec]);

  const fetchEffects = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/text-effects");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load the effects.");
      setEffects(payload.effects || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEffects();
  }, [fetchEffects]);

  const resetDrag = () => {
    draggingRef.current = null;
    setDragging(null);
    setDragOver(null);
  };

  const openEditor = (effect) => {
    setCreating(false);
    setEditing(effect);
    setStatus("");
    setForm({
      titleEn: effect.titleEn,
      titleAr: effect.titleAr,
      isPremium: effect.isPremium,
      published: effect.published,
      spec: normalizeTextEffectSpec(effect.spec),
    });
  };

  const openCreate = () => {
    setCreating(true);
    setEditing({ id: null, slug: "" });
    setStatus("");
    setForm(EMPTY_FORM);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditing(null);
    setCreating(false);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch(
        creating ? "/api/admin/text-effects" : `/api/admin/text-effects/${editing.id}`,
        {
          method: creating ? "POST" : "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            titleEn: form.titleEn,
            titleAr: form.titleAr,
            isPremium: form.isPremium,
            published: form.published,
            spec: form.spec,
          }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not save the effect.");
      await fetchEffects();
      setEditing(payload.effect);
      setCreating(false);
      setStatus("Saved.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing?.id) return;
    if (!window.confirm(`Delete "${editing.titleEn}"?`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/text-effects/${editing.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not delete.");
      setEditing(null);
      await fetchEffects();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setSaving(false);
    }
  };

  const move = async (effect, direction) => {
    setReordering(effect.id);
    try {
      const response = await fetch(`/api/admin/text-effects/${effect.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not reorder.");
      await fetchEffects();
    } catch (moveError) {
      setError(moveError.message);
    } finally {
      setReordering(false);
    }
  };

  // Optimistic: the strip settles immediately and rolls back if the write
  // fails, because a drag that snaps back after a round trip feels broken.
  const drop = async (targetIndex, position) => {
    const source = draggingRef.current;
    resetDrag();
    if (source === null || source === undefined) return;
    const next = [...effects];
    const [moved] = next.splice(source, 1);
    let insertAt = targetIndex + (position === "after" ? 1 : 0);
    if (source < insertAt) insertAt -= 1;
    if (insertAt === source) return;
    next.splice(insertAt, 0, moved);

    const previous = effects;
    setEffects(next);
    setReordering(moved.id);
    try {
      const response = await fetch(`/api/admin/text-effects/${moved.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order: next.map((row) => row.id) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not reorder.");
    } catch (dropError) {
      setEffects(previous);
      setError(dropError.message);
    } finally {
      setReordering(false);
    }
  };

  // ---- spec editing helpers -------------------------------------------------
  const setFill = (patch) =>
    setForm((c) => ({ ...c, spec: { ...c.spec, fill: { ...c.spec.fill, ...patch } } }));
  const setPart = (part, patch) =>
    setForm((c) => ({ ...c, spec: { ...c.spec, [part]: { ...c.spec[part], ...patch } } }));
  const setStop = (index, key, value) =>
    setForm((c) => {
      const stops = c.spec.fill.stops.map((stop, i) =>
        i === index ? (key === "offset" ? [Number(value), stop[1]] : [stop[0], value]) : stop
      );
      return { ...c, spec: { ...c.spec, fill: { ...c.spec.fill, stops } } };
    });
  const addStop = () =>
    setForm((c) => {
      const stops = [...c.spec.fill.stops];
      const last = stops[stops.length - 1] || [0, "#ffffff"];
      stops.push([Math.min(1, (last[0] ?? 0) + 0.1), last[1]]);
      return { ...c, spec: { ...c.spec, fill: { ...c.spec.fill, stops } } };
    });
  const removeStop = (index) =>
    setForm((c) => ({
      ...c,
      spec: { ...c.spec, fill: { ...c.spec.fill, stops: c.spec.fill.stops.filter((_, i) => i !== index) } },
    }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5 text-primary" aria-hidden="true" />
              Text Effects
            </CardTitle>
            <CardSubtitle>
              Material styles for text layers. Rendered natively by the editor and the app — no
              generation, no credits, and the text stays editable.
            </CardSubtitle>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={sampleText}
              dir="rtl"
              onChange={(event) => setSampleText(event.target.value)}
              className="w-40"
              aria-label="Preview text"
            />
            <Button onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New effect
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : effects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No effects yet. Run <code>npm run seed:text-effects -- --create</code>.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {effects.map((effect, index) => {
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
                return (
                  <div
                    key={effect.id}
                    className={`rounded-lg border bg-card p-2 ${dragging === index ? "opacity-50" : ""} ${
                      dragOver?.index === index
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
                      event.dataTransfer.setData("text/plain", effect.id);
                    }}
                    onDragOver={noteDragOver}
                    onDragEnter={noteDragOver}
                    onDrop={(event) => {
                      event.preventDefault();
                      drop(index, sideFromEvent(event));
                    }}
                    onDragEnd={resetDrag}
                  >
                    <div className="group relative overflow-hidden rounded-md bg-[#f7f7fa]">
                      <EffectPreview
                        spec={effect.spec}
                        text={sampleText}
                        width={320}
                        height={150}
                        background="#f7f7fa"
                        className="w-full"
                      />
                      <div className="pointer-events-none absolute left-1.5 top-1.5 flex gap-1">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white shadow-sm ${
                            effect.published ? "bg-emerald-600/90" : "bg-amber-500"
                          }`}
                        >
                          {effect.published ? "Published" : "Hidden"}
                        </span>
                        {effect.isPremium ? (
                          <span className="rounded bg-white/95 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-destructive shadow-sm">
                            Pro
                          </span>
                        ) : null}
                      </div>
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 pt-6 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <span className="pointer-events-auto cursor-grab text-white/80" title="Drag to reorder">
                          <GripVertical className="h-4 w-4" />
                        </span>
                        <button
                          type="button"
                          className="pointer-events-auto rounded p-0.5 text-white/80 hover:bg-white/20 disabled:opacity-30"
                          onClick={() => move(effect, "up")}
                          disabled={index === 0 || Boolean(reordering)}
                          aria-label="Move earlier"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="pointer-events-auto rounded p-0.5 text-white/80 hover:bg-white/20 disabled:opacity-30"
                          onClick={() => move(effect, "down")}
                          disabled={index === effects.length - 1 || Boolean(reordering)}
                          aria-label="Move later"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="pointer-events-auto ml-auto rounded bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-foreground hover:bg-white"
                          onClick={() => openEditor(effect)}
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-baseline justify-between gap-1.5">
                      <span className="truncate text-[11px] font-semibold">{effect.titleEn}</span>
                      <span dir="rtl" className="truncate text-[11px] text-primary">
                        {effect.titleAr}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Modal open={Boolean(editing)} onClose={closeEditor} className="max-h-[88vh] w-[min(760px,94vw)] overflow-y-auto">
        {editing ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">{creating ? "New effect" : editing.titleEn}</h2>
              {editing.slug ? <p className="text-xs text-muted-foreground">{editing.slug}</p> : null}
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {status ? <p className="text-sm text-emerald-600">{status}</p> : null}

            {/* Live preview sits at the top: every control below changes it as
                you type, using the same painter the app ships. */}
            <div className="rounded-lg border bg-[#f7f7fa] p-2">
              <EffectPreview spec={normalized} text={sampleText} width={700} height={190} background="#f7f7fa" className="w-full" />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="fx-en">English title</Label>
                <Input id="fx-en" value={form.titleEn} onChange={(e) => setForm({ ...form, titleEn: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="fx-ar">Arabic title</Label>
                <Input id="fx-ar" dir="rtl" value={form.titleAr} onChange={(e) => setForm({ ...form, titleAr: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="fx-kind">Fill</Label>
                <Select id="fx-kind" value={form.spec.fill.kind} onChange={(e) => setFill({ kind: e.target.value })}>
                  {TEXT_EFFECT_FILL_KINDS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </Select>
              </div>
              {form.spec.fill.kind === "gradient" ? (
                <div>
                  <Label htmlFor="fx-angle">Angle ({form.spec.fill.angle}°)</Label>
                  <input id="fx-angle" type="range" min={0} max={360} className="w-full"
                    value={form.spec.fill.angle} onChange={(e) => setFill({ angle: Number(e.target.value) })} />
                </div>
              ) : (
                <div>
                  <Label htmlFor="fx-color">Colour</Label>
                  <Input id="fx-color" type="color" value={form.spec.fill.color} onChange={(e) => setFill({ color: e.target.value })} />
                </div>
              )}
              {form.spec.fill.kind === "pattern" ? (
                <div>
                  <Label htmlFor="fx-pattern">Texture URL</Label>
                  <Input id="fx-pattern" value={form.spec.fill.patternUrl} onChange={(e) => setFill({ patternUrl: e.target.value })} />
                </div>
              ) : null}
            </div>

            {form.spec.fill.kind === "gradient" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Gradient bands</Label>
                  <button type="button" className="text-xs text-primary underline" onClick={addStop}>
                    Add band
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Metal needs narrow alternating light and dark bands — two stops always reads as
                  plastic. Seven to nine is the sweet spot.
                </p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {form.spec.fill.stops.map((stop, index) => (
                    <div key={index} className="flex items-center gap-2 rounded border p-1.5">
                      <input type="color" value={stop[1]} onChange={(e) => setStop(index, "color", e.target.value)} />
                      <input type="range" min={0} max={1} step={0.01} className="flex-1"
                        value={stop[0]} onChange={(e) => setStop(index, "offset", e.target.value)} />
                      <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
                        {Math.round(stop[0] * 100)}%
                      </span>
                      <button type="button" className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeStop(index)} aria-label="Remove band">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2 rounded border p-2">
                <p className="text-sm font-medium">Outline</p>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.spec.stroke.color} onChange={(e) => setPart("stroke", { color: e.target.value })} />
                  <input type="range" min={0} max={0.15} step={0.005} className="flex-1"
                    value={form.spec.stroke.width} onChange={(e) => setPart("stroke", { width: Number(e.target.value) })} />
                  <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
                    {(form.spec.stroke.width * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="space-y-2 rounded border p-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={form.spec.shadow.enabled}
                    onChange={(e) => setPart("shadow", { enabled: e.target.checked })} />
                  Shadow
                </label>
                <div className="flex items-center gap-2">
                  <input type="range" min={0} max={0.2} step={0.005} className="flex-1"
                    value={form.spec.shadow.blur} onChange={(e) => setPart("shadow", { blur: Number(e.target.value) })} />
                  <span className="w-16 text-right text-[11px] text-muted-foreground">blur</span>
                </div>
                <div className="flex items-center gap-2">
                  <input type="range" min={-0.2} max={0.2} step={0.005} className="flex-1"
                    value={form.spec.shadow.offsetY} onChange={(e) => setPart("shadow", { offsetY: Number(e.target.value) })} />
                  <span className="w-16 text-right text-[11px] text-muted-foreground">offset Y</span>
                </div>
              </div>
            </div>

            <div className="space-y-2 rounded border p-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={form.spec.sheen.enabled}
                  onChange={(e) => setPart("sheen", { enabled: e.target.checked })} />
                Top sheen
              </label>
              <div className="flex items-center gap-2">
                <input type="range" min={0} max={0.06} step={0.002} className="flex-1"
                  value={form.spec.sheen.width} onChange={(e) => setPart("sheen", { width: Number(e.target.value) })} />
                <span className="w-16 text-right text-[11px] text-muted-foreground">width</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
                Published
              </label>
              <Switch
                checked={form.isPremium}
                label="Pro only"
                onChange={(next) => setForm({ ...form, isPremium: next })}
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-3">
              {!creating && editing.id ? (
                <button type="button" className="text-sm text-destructive underline" onClick={remove} disabled={saving}>
                  Delete effect
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={closeEditor} disabled={saving}>Close</Button>
                <Button type="button" onClick={save} disabled={saving}>
                  {saving ? "Saving…" : creating ? "Create" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
