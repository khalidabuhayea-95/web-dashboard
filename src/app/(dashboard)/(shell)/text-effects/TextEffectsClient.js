"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  ImagePlus,
  Palette,
  Plus,
  Trash2,
  Video,
} from "lucide-react";
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
import {
  normalizeTextEffectSpec,
  serializeTextEffect,
  TEXT_EFFECT_BLEND_MODES,
  TEXT_EFFECT_CATEGORIES,
  TEXT_EFFECT_FILL_KINDS,
} from "@/lib/textEffects/spec";
import EffectPreview, { drawEffectPreview, loadEffectImage } from "@/components/text-effects/EffectPreview";

const BLANK_SPEC = {
  fill: { kind: "gradient", angle: 90, stops: [[0, "#5c3d0c"], [0.5, "#fdf3c9"], [1, "#4a3009"]] },
  stroke: { width: 0.05, color: "#2a1c05" },
  shadow: { enabled: true, color: "rgba(0,0,0,0.5)", blur: 0.05, offsetX: 0.025, offsetY: 0.06 },
  sheen: { enabled: true, color: "rgba(255,255,255,0.55)", width: 0.016, offsetY: -0.016 },
};

const EMPTY_FORM = { titleEn: "", titleAr: "", category: "", isPremium: false, published: true, spec: BLANK_SPEC };

const SAMPLE_TEXTS = ["محمد", "دعوة زفاف"];

const FILL_KIND_LABELS = {
  gradient: "تدرّج معدني",
  solid: "لون واحد",
  pattern: "نقش متكرر",
  texture: "خامة (صورة أو فيديو)",
};

const BLEND_MODE_LABELS = {
  "source-over": "عادي",
  multiply: "ضرب (Multiply)",
  screen: "شاشة (Screen)",
  overlay: "تراكب (Overlay)",
  "soft-light": "ضوء ناعم",
  "hard-light": "ضوء قوي",
  "color-dodge": "تفتيح لوني",
  "color-burn": "حرق لوني",
  darken: "تغميق",
  lighten: "تفتيح",
  luminosity: "إضاءة",
  color: "لون",
};

const BACKGROUNDS = [
  { value: "#f7f7fa", label: "فاتح" },
  { value: "#1d1b22", label: "داكن" },
];

const CUSTOM_CATEGORY = "__custom";
const categoryLabel = (value) => TEXT_EFFECT_CATEGORIES.find((c) => c.value === value)?.labelAr || value;

// Library fonts the preview can switch to; declared once per family, loaded on pick.
const declaredFonts = new Set();
async function ensureFontFace(font) {
  if (!font?.family || declaredFonts.has(font.family) || typeof FontFace !== "function") return;
  declaredFonts.add(font.family);
  const cuts = Array.isArray(font.variants) && font.variants.length
    ? font.variants
    : [{ weight: 400, style: "normal", fileUrl: font.fileUrl }];
  await Promise.all(
    cuts
      .filter((cut) => cut?.fileUrl || font.fileUrl)
      .map(async (cut) => {
        const face = new FontFace(font.family, `url("${cut.fileUrl || font.fileUrl}")`, {
          weight: String(Math.round(Number(cut.weight)) || 400),
          style: String(cut.style || "normal").toLowerCase() === "italic" ? "italic" : "normal",
        });
        document.fonts.add(face);
        await face.load().catch(() => undefined);
      })
  );
}

// The first decodable frame of a clip, for a thumbnail of a video-only effect.
function firstVideoFrame(url) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.addEventListener("loadeddata", () => resolve(video), { once: true });
    video.addEventListener("error", () => resolve(null), { once: true });
    video.src = url;
  });
}

function Slider({ label, min, max, step, value, onChange, format = (v) => v }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        className="flex-1"
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span dir="ltr" className="w-12 text-left tabular-nums text-muted-foreground">
        {format(value)}
      </span>
    </label>
  );
}

// A picker for hex plus a text field, so rgba() values (shadows, rims) stay editable.
function ColorField({ label, value, onChange }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <input type="color" value={hex} onChange={(event) => onChange(event.target.value)} />
      <input
        dir="ltr"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 rounded border bg-transparent px-1.5 py-0.5 font-mono text-[11px]"
      />
    </label>
  );
}

const percent = (value) => `${Math.round(value * 100)}%`;
const fraction = (value) => `${(value * 100).toFixed(1)}%`;

export default function TextEffectsClient() {
  const [effects, setEffects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState("");

  const [sampleText, setSampleText] = useState(SAMPLE_TEXTS[0]);
  const [fonts, setFonts] = useState([]);
  const [fontFamily, setFontFamily] = useState("");
  const [background, setBackground] = useState(BACKGROUNDS[0].value);
  const [intensity, setIntensity] = useState(1);
  const [tintColor, setTintColor] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [hovered, setHovered] = useState(null);

  const [reordering, setReordering] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const draggingRef = useRef(null);
  const imageInputRef = useRef(null);
  const inlayInputRef = useRef(null);
  const videoInputRef = useRef(null);

  const fetchEffects = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/text-effects");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذّر تحميل التأثيرات.");
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

  // Arabic library fonts for the preview's font picker.
  useEffect(() => {
    let live = true;
    fetch("/api/editor/fonts", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (!live) return;
        const arabic = (Array.isArray(payload?.fonts) ? payload.fonts : [])
          .filter((font) => Array.isArray(font.categories) && font.categories.includes("ARABIC"))
          .filter((font) => font.fileUrl || font.variants?.length)
          .sort((a, b) => String(a.displayName || a.family).localeCompare(String(b.displayName || b.family)));
        setFonts(arabic);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const pickFont = async (family) => {
    const font = fonts.find((item) => item.family === family);
    if (font) await ensureFontFace(font);
    setFontFamily(family);
  };

  // "" = the dashboard's own Arabic face (the canvas inherits it).
  const canvasFont = fontFamily ? `"${fontFamily}"` : "inherit";

  // Client-shaped specs (texture URLs folded in), exactly what the editor will receive.
  const clientSpecs = useMemo(
    () => new Map(effects.map((effect) => [effect.id, serializeTextEffect(effect).spec])),
    [effects]
  );
  const editingSpec = useMemo(
    () =>
      serializeTextEffect({
        ...(editing || {}),
        spec: normalizeTextEffectSpec(form.spec),
      }).spec,
    [editing, form.spec]
  );

  const categories = useMemo(() => {
    const present = Array.from(new Set(effects.map((effect) => effect.category).filter(Boolean)));
    const known = TEXT_EFFECT_CATEGORIES.map((c) => c.value).filter((value) => present.includes(value));
    return [...known, ...present.filter((value) => !known.includes(value)).sort()];
  }, [effects]);
  const visible = categoryFilter ? effects.filter((effect) => effect.category === categoryFilter) : effects;
  // Reordering rewrites the whole strip's order, so it needs the whole strip on screen.
  const canReorder = !categoryFilter;

  const resetDrag = () => {
    draggingRef.current = null;
    setDragging(null);
    setDragOver(null);
  };

  const openEditor = (effect) => {
    setCreating(false);
    setEditing(effect);
    setStatus("");
    setError("");
    setForm({
      titleEn: effect.titleEn,
      titleAr: effect.titleAr,
      category: effect.category || "",
      isPremium: effect.isPremium,
      published: effect.published,
      spec: normalizeTextEffectSpec(effect.spec),
    });
  };

  const openCreate = () => {
    setCreating(true);
    setEditing({ id: null, slug: "" });
    setStatus("");
    setError("");
    setForm(EMPTY_FORM);
  };

  const closeEditor = () => {
    if (saving || uploading) return;
    setEditing(null);
    setCreating(false);
  };

  const replaceRow = (row) => setEffects((rows) => rows.map((item) => (item.id === row.id ? row : item)));

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
            category: form.category,
            isPremium: form.isPremium,
            published: form.published,
            spec: form.spec,
          }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذّر حفظ التأثير.");
      await fetchEffects();
      setEditing(payload.effect);
      setCreating(false);
      setStatus(creating ? "تم إنشاء التأثير — يمكنك الآن رفع الخامة." : "تم الحفظ.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing?.id) return;
    if (!window.confirm(`حذف «${editing.titleAr || editing.titleEn}»؟ ستُحذف ملفاته أيضاً.`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/text-effects/${editing.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذّر الحذف.");
      setEditing(null);
      await fetchEffects();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setSaving(false);
    }
  };

  const uploadFile = async (kind, file) => {
    if (!file || !editing?.id) return;
    setUploading(kind);
    setError("");
    setStatus("");
    try {
      const body = new FormData();
      body.set("kind", kind);
      body.set("file", file);
      const response = await fetch(`/api/admin/text-effects/${editing.id}/texture`, { method: "POST", body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذّر رفع الملف.");
      setEditing(payload.effect);
      replaceRow(payload.effect);
      setStatus(kind === "preview" ? "تم حفظ الصورة المصغّرة." : kind === "inlay" ? "تم رفع خامة الترصيع." : "تم رفع الخامة.");
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading("");
    }
  };

  const removeTexture = async (column) => {
    if (!editing?.id) return;
    setUploading(column);
    setError("");
    try {
      const response = await fetch(`/api/admin/text-effects/${editing.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [column]: null }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذّرت الإزالة.");
      setEditing(payload.effect);
      replaceRow(payload.effect);
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setUploading("");
    }
  };

  // The strip thumbnail: the same renderer, on transparent, from the loaded files.
  const saveThumbnail = async () => {
    if (!editing?.id) return;
    setUploading("preview");
    try {
      const texture = editingSpec.fill.texture;
      const still =
        editingSpec.fill.kind === "texture"
          ? (await loadEffectImage(texture.url)) || (texture.videoUrl ? await firstVideoFrame(texture.videoUrl) : null)
          : null;
      const pattern = editingSpec.fill.kind === "pattern" ? await loadEffectImage(editingSpec.fill.patternUrl) : null;
      const inlayTexture = editingSpec.inlay?.enabled ? await loadEffectImage(editingSpec.inlay.texture?.url) : null;
      const canvas = document.createElement("canvas");
      document.body.appendChild(canvas);
      canvas.style.cssText = "position:fixed;left:-9999px;top:0";
      try {
        drawEffectPreview(canvas, {
          spec: editingSpec,
          text: sampleText,
          fontFamily: canvasFont === "inherit" ? getComputedStyle(canvas).fontFamily : canvasFont,
          width: 512,
          height: 256,
          background: null,
          texture: still,
          pattern,
          inlayTexture,
          pixelRatio: 1,
        });
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("تعذّر إنشاء الصورة المصغّرة.");
        setUploading("");
        await uploadFile("preview", new File([blob], `${editing.slug || "effect"}-preview.png`, { type: "image/png" }));
      } finally {
        canvas.remove();
      }
    } catch (thumbError) {
      setError(thumbError.message);
      setUploading("");
    }
  };

  const togglePublished = async (effect) => {
    replaceRow({ ...effect, published: !effect.published });
    try {
      const response = await fetch(`/api/admin/text-effects/${effect.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ published: !effect.published }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذّر تغيير الحالة.");
      replaceRow(payload.effect);
    } catch (toggleError) {
      replaceRow(effect);
      setError(toggleError.message);
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
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذّر تغيير الترتيب.");
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
      if (!response.ok || !payload.ok) throw new Error(payload.error || "تعذّر تغيير الترتيب.");
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
  const setTexture = (patch) =>
    setForm((c) => ({
      ...c,
      spec: { ...c.spec, fill: { ...c.spec.fill, texture: { ...c.spec.fill.texture, ...patch } } },
    }));
  const setPart = (part, patch) =>
    setForm((c) => ({ ...c, spec: { ...c.spec, [part]: { ...c.spec[part], ...patch } } }));
  // The inlay keeps its sub-objects (texture, innerShadow, sparkles) whole on every edit.
  const setInlay = (patch, sub) =>
    setForm((c) => {
      const current = normalizeTextEffectSpec(c.spec).inlay;
      const stored = { ...current, ...(c.spec.inlay || {}) };
      const next = sub ? { ...stored, [sub]: { ...current[sub], ...(c.spec.inlay?.[sub] || {}), ...patch } } : { ...stored, ...patch };
      return { ...c, spec: { ...c.spec, inlay: next } };
    });
  const setStop = (index, key, value) =>
    setForm((c) => {
      const stops = c.spec.fill.stops.map((stop, i) =>
        i === index ? (key === "offset" ? [Number(value), stop[1]] : [stop[0], value]) : stop
      );
      return { ...c, spec: { ...c.spec, fill: { ...c.spec.fill, stops } } };
    });
  const addStop = () =>
    setForm((c) => {
      const stops = [...(c.spec.fill.stops || [])];
      const last = stops[stops.length - 1] || [0, "#ffffff"];
      stops.push([Math.min(1, (last[0] ?? 0) + 0.1), last[1]]);
      return { ...c, spec: { ...c.spec, fill: { ...c.spec.fill, stops } } };
    });
  const removeStop = (index) =>
    setForm((c) => ({
      ...c,
      spec: { ...c.spec, fill: { ...c.spec.fill, stops: c.spec.fill.stops.filter((_, i) => i !== index) } },
    }));

  const spec = normalizeTextEffectSpec(form.spec);
  const fillKind = form.spec.fill?.kind || spec.fill.kind;
  const categoryChoice =
    !form.category || TEXT_EFFECT_CATEGORIES.some((c) => c.value === form.category) ? form.category : CUSTOM_CATEGORY;

  const sampleControls = (
    <div className="flex flex-wrap items-center gap-1.5">
      {SAMPLE_TEXTS.map((text) => (
        <button
          key={text}
          type="button"
          onClick={() => setSampleText(text)}
          className={`rounded-full px-3 py-1 text-xs ${
            sampleText === text ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70"
          }`}
        >
          {text}
        </button>
      ))}
      <Input
        value={sampleText}
        dir="rtl"
        onChange={(event) => setSampleText(event.target.value)}
        className="!w-36"
        aria-label="نص المعاينة"
        placeholder="نص آخر…"
      />
      <Select
        value={fontFamily}
        onChange={(event) => pickFont(event.target.value)}
        className="!w-48"
        aria-label="خط المعاينة"
      >
        <option value="">خط لوحة التحكم</option>
        {fonts.map((font) => (
          <option key={font.id} value={font.family}>
            {font.displayName || font.family}
          </option>
        ))}
      </Select>
      <div className="flex overflow-hidden rounded-full bg-muted p-0.5">
        {BACKGROUNDS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setBackground(option.value)}
            className={`rounded-full px-2.5 py-0.5 text-xs ${background === option.value ? "bg-card shadow-sm" : ""}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4" dir="rtl">
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5 text-primary" aria-hidden="true" />
              التأثيرات
            </CardTitle>
            <CardSubtitle>
              خامات وأنماط للنصوص (ذهب، فضة، زجاج، تطريز…) تُرسم مباشرة في المحرّر والتطبيق
              والتصدير — بلا ذكاء اصطناعي ولا رصيد، والنص يبقى قابلاً للتعديل.
            </CardSubtitle>
          </div>
          <Button onClick={openCreate}>
            <Plus className="ml-1.5 h-4 w-4" aria-hidden="true" /> تأثير جديد
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {sampleControls}
          {categories.length ? (
            <div className="flex flex-wrap gap-1.5">
              {["", ...categories].map((value) => (
                <button
                  key={value || "all"}
                  type="button"
                  onClick={() => setCategoryFilter(value)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    categoryFilter === value ? "border-primary bg-primary/10 text-primary" : "border-transparent bg-muted"
                  }`}
                >
                  {value ? categoryLabel(value) : "الكل"}
                  <span className="mr-1 text-muted-foreground">
                    {value ? effects.filter((effect) => effect.category === value).length : effects.length}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {error && !editing ? <p className="text-sm text-destructive">{error}</p> : null}
          {loading ? (
            <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>
          ) : effects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              لا توجد تأثيرات بعد. شغّل <code dir="ltr">npm run seed:text-effects -- --create</code>.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {visible.map((effect) => {
                const index = effects.indexOf(effect);
                // RTL strip: the right half of a card is "before" it.
                const sideFromEvent = (event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  return event.clientX - rect.left > rect.width / 2 ? "before" : "after";
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
                          ? "border-l-2 border-l-primary"
                          : "border-r-2 border-r-primary"
                        : ""
                    }`}
                    draggable={canReorder}
                    onMouseEnter={() => setHovered(effect.id)}
                    onMouseLeave={() => setHovered((current) => (current === effect.id ? null : current))}
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
                    <div className="group relative overflow-hidden rounded-md" style={{ background }}>
                      <EffectPreview
                        spec={clientSpecs.get(effect.id)}
                        text={sampleText}
                        fontFamily={canvasFont}
                        width={320}
                        height={150}
                        background={background}
                        animate={hovered === effect.id}
                        className="mx-auto block"
                      />
                      <div className="pointer-events-none absolute right-1.5 top-1.5 flex gap-1">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm ${
                            effect.published ? "bg-emerald-600/90" : "bg-amber-500"
                          }`}
                        >
                          {effect.published ? "منشور" : "مخفي"}
                        </span>
                        {effect.isPremium ? (
                          <span className="rounded bg-white/95 px-1.5 py-0.5 text-[10px] font-bold text-destructive shadow-sm">
                            Pro
                          </span>
                        ) : null}
                        {effect.textureVideoUrl ? (
                          <span className="rounded bg-black/60 px-1 py-0.5 text-white shadow-sm" title="خامة متحركة">
                            <Video className="h-3 w-3" aria-hidden="true" />
                          </span>
                        ) : null}
                      </div>
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 pt-6 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        {canReorder ? (
                          <>
                            <span className="pointer-events-auto cursor-grab text-white/80" title="اسحب لتغيير الترتيب">
                              <GripVertical className="h-4 w-4" />
                            </span>
                            <button
                              type="button"
                              className="pointer-events-auto rounded p-0.5 text-white/80 hover:bg-white/20 disabled:opacity-30"
                              onClick={() => move(effect, "up")}
                              disabled={index === 0 || Boolean(reordering)}
                              aria-label="نقل للأمام"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              className="pointer-events-auto rounded p-0.5 text-white/80 hover:bg-white/20 disabled:opacity-30"
                              onClick={() => move(effect, "down")}
                              disabled={index === effects.length - 1 || Boolean(reordering)}
                              aria-label="نقل للخلف"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="pointer-events-auto rounded p-0.5 text-white/80 hover:bg-white/20"
                          onClick={() => togglePublished(effect)}
                          aria-label={effect.published ? "إخفاء" : "نشر"}
                          title={effect.published ? "إخفاء من التطبيق والمحرّر" : "نشر"}
                        >
                          {effect.published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                        <button
                          type="button"
                          className="pointer-events-auto mr-auto rounded bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-foreground hover:bg-white"
                          onClick={() => openEditor(effect)}
                        >
                          تعديل
                        </button>
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-baseline justify-between gap-1.5">
                      <span className="truncate text-xs font-semibold">{effect.titleAr}</span>
                      <span dir="ltr" className="truncate text-[11px] text-muted-foreground">
                        {effect.category ? `${categoryLabel(effect.category)} · ` : ""}
                        {effect.titleEn}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Modal open={Boolean(editing)} onClose={closeEditor} className="max-h-[90vh] !w-[min(860px,94vw)] overflow-y-auto">
        {editing ? (
          <div className="space-y-4" dir="rtl">
            <div>
              <h2 className="text-lg font-semibold">{creating ? "تأثير جديد" : editing.titleAr || editing.titleEn}</h2>
              {editing.slug ? (
                <p dir="ltr" className="text-right text-xs text-muted-foreground">
                  {editing.slug}
                </p>
              ) : null}
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {status ? <p className="text-sm text-emerald-600">{status}</p> : null}

            {/* Live preview at the top: every control below changes it as you type, through
                the same renderer the editor and the exports use. */}
            <div className="space-y-2">
              <div className="overflow-hidden rounded-lg" style={{ background }}>
                <EffectPreview
                  spec={editingSpec}
                  text={sampleText}
                  fontFamily={canvasFont}
                  width={800}
                  height={220}
                  background={background}
                  intensity={intensity}
                  tintColor={tintColor || undefined}
                  animate
                  className="mx-auto block"
                />
              </div>
              {sampleControls}
              {fillKind === "texture" ? (
                <div className="grid grid-cols-1 gap-2 rounded-lg bg-muted/50 p-2 sm:grid-cols-2">
                  <Slider label="الشدّة (المحرّر)" min={0} max={1} step={0.01} value={intensity} onChange={setIntensity} format={percent} />
                  {spec.fill.texture.renderMode === "bw" ? (
                    <label className="flex items-center gap-2 text-xs">
                      <span className="w-24 shrink-0 text-muted-foreground">لون المستخدم</span>
                      <input
                        type="color"
                        value={tintColor || spec.fill.texture.tint}
                        onChange={(event) => setTintColor(event.target.value)}
                      />
                      {tintColor ? (
                        <button type="button" className="text-primary underline" onClick={() => setTintColor("")}>
                          اللون الافتراضي
                        </button>
                      ) : null}
                    </label>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="fx-ar">الاسم بالعربية</Label>
                <Input id="fx-ar" dir="rtl" value={form.titleAr} onChange={(e) => setForm({ ...form, titleAr: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="fx-en">الاسم بالإنجليزية</Label>
                <Input id="fx-en" dir="ltr" value={form.titleEn} onChange={(e) => setForm({ ...form, titleEn: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="fx-category">التصنيف</Label>
                <Select
                  id="fx-category"
                  value={categoryChoice}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value === CUSTOM_CATEGORY ? form.category || "custom" : e.target.value })
                  }
                >
                  <option value="">بدون تصنيف</option>
                  {TEXT_EFFECT_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.labelAr}
                    </option>
                  ))}
                  <option value={CUSTOM_CATEGORY}>تصنيف آخر…</option>
                </Select>
                {categoryChoice === CUSTOM_CATEGORY ? (
                  <Input
                    dir="ltr"
                    className="mt-1"
                    value={form.category}
                    placeholder="slug-name"
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  />
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="fx-kind">نوع التعبئة</Label>
                <Select id="fx-kind" value={fillKind} onChange={(e) => setFill({ kind: e.target.value })}>
                  {TEXT_EFFECT_FILL_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {FILL_KIND_LABELS[k] || k}
                    </option>
                  ))}
                </Select>
              </div>
              {fillKind === "gradient" ? (
                <div className="sm:col-span-2">
                  <Label>اتجاه التدرّج</Label>
                  <Slider label="الزاوية" min={0} max={360} step={1} value={spec.fill.angle} onChange={(angle) => setFill({ angle })} format={(v) => `${v}°`} />
                </div>
              ) : (
                <div>
                  <Label htmlFor="fx-color">اللون الأساسي</Label>
                  <Input id="fx-color" type="color" value={/^#[0-9a-f]{6}$/i.test(spec.fill.color) ? spec.fill.color : "#111111"} onChange={(e) => setFill({ color: e.target.value })} />
                </div>
              )}
              {fillKind === "pattern" ? (
                <div>
                  <Label htmlFor="fx-pattern">رابط صورة النقش</Label>
                  <Input id="fx-pattern" dir="ltr" value={form.spec.fill.patternUrl || ""} onChange={(e) => setFill({ patternUrl: e.target.value })} />
                </div>
              ) : null}
            </div>

            {fillKind === "texture" ? (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-sm font-medium">الخامة</p>
                {creating || !editing.id ? (
                  <p className="text-xs text-muted-foreground">احفظ التأثير أولاً، ثم ارفع صورة الخامة أو الفيديو.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {[
                      { kind: "image", column: "textureUrl", url: editing.textureUrl, label: "صورة (PNG/JPG/WebP)", icon: ImagePlus, ref: imageInputRef, accept: "image/png,image/jpeg,image/webp" },
                      { kind: "video", column: "textureVideoUrl", url: editing.textureVideoUrl, label: "فيديو متحرك (MP4/WebM)", icon: Video, ref: videoInputRef, accept: "video/mp4,video/webm" },
                    ].map((slot) => {
                      const Icon = slot.icon;
                      return (
                        <div key={slot.kind} className="flex items-center gap-2 rounded-md bg-muted/50 p-2">
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-card">
                            {slot.url ? (
                              slot.kind === "image" ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={slot.url} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <video src={slot.url} muted loop autoPlay playsInline className="h-full w-full object-cover" />
                              )
                            ) : (
                              <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-xs">{slot.label}</p>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                className="!px-3 !py-1 text-xs"
                                disabled={Boolean(uploading)}
                                onClick={() => slot.ref.current?.click()}
                              >
                                {uploading === slot.kind ? "جارٍ الرفع…" : slot.url ? "استبدال" : "رفع"}
                              </Button>
                              {slot.url ? (
                                <button
                                  type="button"
                                  className="text-xs text-destructive underline disabled:opacity-40"
                                  disabled={Boolean(uploading)}
                                  onClick={() => removeTexture(slot.column)}
                                >
                                  إزالة
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <input
                            ref={slot.ref}
                            type="file"
                            accept={slot.accept}
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.target.value = "";
                              uploadFile(slot.kind, file);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-xs">
                    <span className="w-24 shrink-0 text-muted-foreground">وضع الدمج</span>
                    <Select value={spec.fill.texture.blendMode} onChange={(e) => setTexture({ blendMode: e.target.value })} className="flex-1">
                      {TEXT_EFFECT_BLEND_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {BLEND_MODE_LABELS[mode] || mode}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <span className="w-24 shrink-0 text-muted-foreground">نمط الألوان</span>
                    <Select value={spec.fill.texture.renderMode} onChange={(e) => setTexture({ renderMode: e.target.value })} className="flex-1">
                      <option value="color">ملوّنة كما هي</option>
                      <option value="bw">رمادية — تأخذ لون المستخدم</option>
                    </Select>
                  </label>
                  <Slider label="الشفافية" min={0} max={1} step={0.01} value={spec.fill.texture.opacity} onChange={(opacity) => setTexture({ opacity })} format={percent} />
                  <Slider label="تكبير الخامة" min={0.25} max={6} step={0.05} value={spec.fill.texture.scale} onChange={(scale) => setTexture({ scale })} format={(v) => `${v.toFixed(2)}×`} />
                  {spec.fill.texture.renderMode === "bw" ? (
                    <ColorField label="اللون الافتراضي" value={spec.fill.texture.tint} onChange={(tint) => setTexture({ tint })} />
                  ) : null}
                </div>
              </div>
            ) : null}

            {fillKind === "gradient" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>شرائط التدرّج</Label>
                  <button type="button" className="text-xs text-primary underline" onClick={addStop}>
                    إضافة شريط
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  المعدن يحتاج شرائط ضيّقة متناوبة بين الفاتح والداكن — لونان فقط يبدوان كالبلاستيك. من 7 إلى 9 هو الأنسب.
                </p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {(form.spec.fill.stops || []).map((stop, index) => (
                    <div key={index} className="flex items-center gap-2 rounded border p-1.5">
                      <input type="color" value={stop[1]} onChange={(e) => setStop(index, "color", e.target.value)} />
                      <input type="range" min={0} max={1} step={0.01} className="flex-1"
                        value={stop[0]} onChange={(e) => setStop(index, "offset", e.target.value)} />
                      <span dir="ltr" className="w-9 text-left text-[11px] tabular-nums text-muted-foreground">
                        {Math.round(stop[0] * 100)}%
                      </span>
                      <button type="button" className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeStop(index)} aria-label="حذف الشريط">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2 rounded border p-2">
                <p className="text-sm font-medium">الحدّ الخارجي</p>
                <ColorField label="اللون" value={spec.stroke.color} onChange={(color) => setPart("stroke", { color })} />
                <Slider label="السماكة" min={0} max={0.15} step={0.005} value={spec.stroke.width} onChange={(width) => setPart("stroke", { width })} format={fraction} />
              </div>
              <div className="space-y-2 rounded border p-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={spec.shadow.enabled} onChange={(e) => setPart("shadow", { enabled: e.target.checked })} />
                  الظل
                </label>
                <ColorField label="اللون" value={spec.shadow.color} onChange={(color) => setPart("shadow", { color })} />
                <Slider label="النعومة" min={0} max={0.2} step={0.005} value={spec.shadow.blur} onChange={(blur) => setPart("shadow", { blur })} format={fraction} />
                <Slider label="إزاحة أفقية" min={-0.2} max={0.2} step={0.005} value={spec.shadow.offsetX} onChange={(offsetX) => setPart("shadow", { offsetX })} format={fraction} />
                <Slider label="إزاحة رأسية" min={-0.2} max={0.2} step={0.005} value={spec.shadow.offsetY} onChange={(offsetY) => setPart("shadow", { offsetY })} format={fraction} />
              </div>
              <div className="space-y-2 rounded border p-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={spec.bevel.enabled} onChange={(e) => setPart("bevel", { enabled: e.target.checked })} />
                  البروز (Bevel)
                </label>
                <Slider label="العمق" min={0} max={0.12} step={0.002} value={spec.bevel.depth} onChange={(depth) => setPart("bevel", { depth })} format={fraction} />
                <Slider label="النعومة" min={0} max={1} step={0.05} value={spec.bevel.softness} onChange={(softness) => setPart("bevel", { softness })} format={percent} />
                <ColorField label="الحافة المضيئة" value={spec.bevel.light} onChange={(light) => setPart("bevel", { light })} />
                <ColorField label="الحافة المظلمة" value={spec.bevel.dark} onChange={(dark) => setPart("bevel", { dark })} />
              </div>
              <div className="space-y-2 rounded border p-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={spec.sheen.enabled} onChange={(e) => setPart("sheen", { enabled: e.target.checked })} />
                  لمعة علوية
                </label>
                <ColorField label="اللون" value={spec.sheen.color} onChange={(color) => setPart("sheen", { color })} />
                <Slider label="العرض" min={0} max={0.06} step={0.002} value={spec.sheen.width} onChange={(width) => setPart("sheen", { width })} format={fraction} />
              </div>
            </div>

            <div className="space-y-3 rounded-lg border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={spec.inlay.enabled} onChange={(e) => setInlay({ enabled: e.target.checked })} />
                ترصيع (إطار من الخامة الأساسية + حشوة بخامة ثانية — مثل الألماس)
              </label>
              {spec.inlay.enabled ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    التعبئة والبروز والحدّ أعلاه تصير الإطار. الحشوة تملأ داخل الحروف بعد ترك شريط الإطار.
                  </p>
                  {creating || !editing.id ? (
                    <p className="text-xs text-muted-foreground">احفظ التأثير أولاً، ثم ارفع خامة الحشوة.</p>
                  ) : (
                    <div className="flex items-center gap-2 rounded-md bg-muted/50 p-2">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-card">
                        {editing.inlayTextureUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={editing.inlayTextureUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <ImagePlus className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-xs">خامة الحشوة (PNG/JPG/WebP)</p>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            className="!px-3 !py-1 text-xs"
                            disabled={Boolean(uploading)}
                            onClick={() => inlayInputRef.current?.click()}
                          >
                            {uploading === "inlay" ? "جارٍ الرفع…" : editing.inlayTextureUrl ? "استبدال" : "رفع"}
                          </Button>
                          {editing.inlayTextureUrl ? (
                            <button
                              type="button"
                              className="text-xs text-destructive underline disabled:opacity-40"
                              disabled={Boolean(uploading)}
                              onClick={() => removeTexture("inlayTextureUrl")}
                            >
                              إزالة
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <input
                        ref={inlayInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          uploadFile("inlay", file);
                        }}
                      />
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                    <Slider label="عرض الإطار للداخل" min={0} max={0.2} step={0.002} value={spec.inlay.inset} onChange={(inset) => setInlay({ inset })} format={fraction} />
                    <Slider label="تمدّد الإطار للخارج" min={0} max={0.2} step={0.002} value={spec.inlay.outset} onChange={(outset) => setInlay({ outset })} format={fraction} />
                    <ColorField label="لون الحشوة الأساسي" value={spec.inlay.color} onChange={(color) => setInlay({ color })} />
                    <label className="flex items-center gap-2 text-xs">
                      <span className="w-24 shrink-0 text-muted-foreground">طريقة الملء</span>
                      <Select value={spec.inlay.texture.fit} onChange={(e) => setInlay({ fit: e.target.value }, "texture")} className="flex-1">
                        <option value="tile">تكرار (الفصوص بحجم ثابت)</option>
                        <option value="cover">صورة واحدة تغطي النص</option>
                      </Select>
                    </label>
                    <Slider label="حجم الخامة" min={0.1} max={6} step={0.05} value={spec.inlay.texture.scale} onChange={(scale) => setInlay({ scale }, "texture")} format={(v) => `${v.toFixed(2)}×`} />
                    <Slider label="شفافية الخامة" min={0} max={1} step={0.01} value={spec.inlay.texture.opacity} onChange={(opacity) => setInlay({ opacity }, "texture")} format={percent} />
                    <label className="flex items-center gap-2 text-xs">
                      <span className="w-24 shrink-0 text-muted-foreground">وضع الدمج</span>
                      <Select value={spec.inlay.texture.blendMode} onChange={(e) => setInlay({ blendMode: e.target.value }, "texture")} className="flex-1">
                        {TEXT_EFFECT_BLEND_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {BLEND_MODE_LABELS[mode] || mode}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <span className="w-24 shrink-0 text-muted-foreground">نمط الألوان</span>
                      <Select value={spec.inlay.texture.renderMode} onChange={(e) => setInlay({ renderMode: e.target.value }, "texture")} className="flex-1">
                        <option value="color">ملوّنة كما هي</option>
                        <option value="bw">رمادية — تأخذ لوناً</option>
                      </Select>
                    </label>
                    {spec.inlay.texture.renderMode === "bw" ? (
                      <ColorField label="لون الخامة" value={spec.inlay.texture.tint} onChange={(tint) => setInlay({ tint }, "texture")} />
                    ) : null}
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2 rounded border p-2">
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input type="checkbox" checked={spec.inlay.innerShadow.enabled} onChange={(e) => setInlay({ enabled: e.target.checked }, "innerShadow")} />
                        ظل داخلي (الحشوة غاطسة)
                      </label>
                      <ColorField label="اللون" value={spec.inlay.innerShadow.color} onChange={(color) => setInlay({ color }, "innerShadow")} />
                      <Slider label="النعومة" min={0} max={0.3} step={0.005} value={spec.inlay.innerShadow.blur} onChange={(blur) => setInlay({ blur }, "innerShadow")} format={fraction} />
                      <Slider label="إزاحة رأسية" min={-0.2} max={0.2} step={0.002} value={spec.inlay.innerShadow.offsetY} onChange={(offsetY) => setInlay({ offsetY }, "innerShadow")} format={fraction} />
                    </div>
                    <div className="space-y-2 rounded border p-2">
                      <p className="text-sm font-medium">لمعات</p>
                      <Slider label="العدد" min={0} max={200} step={1} value={spec.inlay.sparkles.count} onChange={(count) => setInlay({ count }, "sparkles")} />
                      <Slider label="الحجم" min={0.005} max={0.2} step={0.005} value={spec.inlay.sparkles.size} onChange={(size) => setInlay({ size }, "sparkles")} format={fraction} />
                      <ColorField label="اللون" value={spec.inlay.sparkles.color} onChange={(color) => setInlay({ color }, "sparkles")} />
                      <Slider label="توزيع" min={1} max={500} step={1} value={spec.inlay.sparkles.seed} onChange={(seed) => setInlay({ seed }, "sparkles")} />
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
                منشور
              </label>
              <Switch checked={form.isPremium} label="للمشتركين (Pro) فقط" onChange={(next) => setForm({ ...form, isPremium: next })} />
              {!creating && editing.id ? (
                <div className="mr-auto flex items-center gap-2">
                  {editing.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={editing.previewUrl} alt="" className="h-10 rounded bg-muted object-contain" />
                  ) : null}
                  <Button type="button" variant="secondary" onClick={saveThumbnail} disabled={Boolean(uploading) || saving}>
                    {uploading === "preview" ? "جارٍ الحفظ…" : "حفظ الصورة المصغّرة"}
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-3">
              {!creating && editing.id ? (
                <button type="button" className="text-sm text-destructive underline" onClick={remove} disabled={saving}>
                  حذف التأثير
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={closeEditor} disabled={saving || Boolean(uploading)}>
                  إغلاق
                </Button>
                <Button type="button" onClick={save} disabled={saving || Boolean(uploading)}>
                  {saving ? "جارٍ الحفظ…" : creating ? "إنشاء" : "حفظ"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
