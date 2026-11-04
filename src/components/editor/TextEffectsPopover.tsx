"use client";

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";

import { cx, PopoverHeader, SliderField, ToolButton, ToolPopover } from "@/components/editor/EditorChrome";
import EffectPreview from "@/components/text-effects/EffectPreview";
import {
  normalizeEditorTextEffect,
  textEffectUnsupportedReason,
  useTextEffectCatalogList,
  type EditorTextEffect,
  type EditorTextEffectOverrides,
} from "@/lib/editor/textEffects";
import { textSpansAffectLayout } from "@/lib/editor/textSpans";
import { resolveCssFontFamily } from "@/lib/templates/fontCatalog";
import { TEXT_EFFECT_CATEGORIES } from "@/lib/textEffects/spec";
import type { EditorElement } from "@/store/editorStore";

const UNSUPPORTED_NOTE = {
  curved: "التأثيرات لا تُطبَّق على النص المنحني بعد — أزل الانحناء لتظهر.",
  "mixed-layout": "هذا النص يحوي خطوطاً أو أحجاماً مختلفة؛ التأثيرات تُطبَّق على النص بنمط واحد فقط.",
} as const;

const categoryLabel = (value: string) => TEXT_EFFECT_CATEGORIES.find((c) => c.value === value)?.labelAr || value;

/**
 * The text layer's "تأثيرات" sheet: the dashboard's published effects, previewed on the layer's own
 * words in its own font through the shared renderer, plus the two things a user may tune — the
 * texture's intensity and, for a greyscale ("bw") texture, its colour. The layer stores only
 * `{ effectId, overrides }`.
 */
export function TextEffectsPopover({
  element,
  onApply,
}: {
  element: EditorElement;
  onApply: (patch: Partial<EditorElement>) => void;
}) {
  const catalog = useTextEffectCatalogList();
  const [category, setCategory] = useState("");
  const [hovered, setHovered] = useState("");

  const current = normalizeEditorTextEffect(element.textEffect);
  const active = current ? catalog.find((item) => item.id === current.effectId) || null : null;
  const unsupported = textEffectUnsupportedReason({
    ...element,
    spansAffectLayout: textSpansAffectLayout(element.textSpans),
  });
  const categories = useMemo(() => {
    const present = new Set(catalog.map((item) => item.category).filter(Boolean));
    return [
      ...TEXT_EFFECT_CATEGORIES.map((c) => c.value).filter((value) => present.has(value)),
      ...[...present].filter((value) => !TEXT_EFFECT_CATEGORIES.some((c) => c.value === value)),
    ];
  }, [catalog]);
  const visible = category ? catalog.filter((item) => item.category === category) : catalog;

  // The layer's own words (first line, kept short) in its own face, so the user judges the effect
  // on what they wrote.
  const sample = Array.from(String(element.text || "").split("\n")[0].trim()).slice(0, 10).join("") || "محمد";
  const fontFamily = resolveCssFontFamily(element.fontFamily);
  const fontWeight = Number(element.fontWeight) || 700;

  const texture = active?.spec?.fill?.kind === "texture" ? active.spec.fill.texture : null;
  const tintable = texture?.renderMode === "bw";
  const intensityPct = Math.round((current?.overrides?.intensity ?? 1) * 100);
  const tint = current?.overrides?.tintColor || texture?.tint || "#d4af37";

  const apply = (next: EditorTextEffect | null) => onApply({ textEffect: next ?? undefined });
  const setOverrides = (patch: EditorTextEffectOverrides) => {
    if (!current) return;
    apply({ ...current, overrides: { ...current.overrides, ...patch } });
  };

  return (
    <ToolPopover
      label="تأثيرات النص"
      width={320}
      trigger={({ open, triggerProps }) => (
        <ToolButton icon={Sparkles} label="تأثيرات" showLabel active={open || Boolean(current)} chevron {...triggerProps} />
      )}
    >
      <div dir="rtl">
        <PopoverHeader title="تأثيرات">
          {current ? (
            <button
              type="button"
              className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium text-t-secondary hover:bg-[#f1f2f4] hover:text-t-primary"
              onClick={() => apply(null)}
            >
              بدون تأثير
            </button>
          ) : null}
        </PopoverHeader>

        {unsupported ? (
          <p className="mb-3 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-4 text-amber-800">
            {UNSUPPORTED_NOTE[unsupported]}
          </p>
        ) : null}

        {categories.length > 1 ? (
          <div className="mb-2 flex flex-wrap gap-1">
            {["", ...categories].map((value) => (
              <button
                key={value || "all"}
                type="button"
                onClick={() => setCategory(value)}
                className={cx(
                  "rounded-full px-2.5 py-0.5 text-[11px]",
                  category === value ? "bg-[var(--brand-teal)] text-white" : "bg-[#f1f2f4] text-t-secondary hover:text-t-primary"
                )}
              >
                {value ? categoryLabel(value) : "الكل"}
              </button>
            ))}
          </div>
        ) : null}

        {catalog.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-t-tertiary">لا توجد تأثيرات منشورة بعد.</p>
        ) : (
          <div className="grid max-h-[260px] grid-cols-3 gap-1.5 overflow-y-auto pb-1">
            {visible.map((item) => {
              const selected = current?.effectId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.titleAr || item.titleEn}
                  onClick={() => apply({ effectId: item.id, overrides: current?.overrides })}
                  onMouseEnter={() => setHovered(item.id)}
                  onMouseLeave={() => setHovered((id) => (id === item.id ? "" : id))}
                  className={cx(
                    "relative overflow-hidden rounded-lg bg-[#f1f2f4] text-start ring-offset-1 transition",
                    selected ? "ring-2 ring-[var(--brand-teal)]" : "hover:ring-1 hover:ring-black/15"
                  )}
                >
                  <EffectPreview
                    spec={item.spec}
                    text={sample}
                    fontFamily={fontFamily}
                    fontWeight={fontWeight}
                    width={96}
                    height={56}
                    background="#f1f2f4"
                    tintColor={selected ? current?.overrides?.tintColor : undefined}
                    animate={hovered === item.id}
                    className="block"
                  />
                  <span className="block truncate px-1.5 pb-1 text-[10px] text-t-secondary">{item.titleAr || item.titleEn}</span>
                  {item.isPremium ? (
                    <span className="absolute left-1 top-1 rounded bg-white/90 px-1 text-[9px] font-bold text-[#e5484d]">Pro</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        {active && texture ? (
          <div className="mt-3 space-y-3 border-t border-black/5 pt-3">
            <SliderField
              label="الشدّة"
              min={0}
              max={100}
              value={intensityPct}
              display={`${intensityPct}%`}
              onChange={(value) => setOverrides({ intensity: Math.max(0, Math.min(1, value / 100)) })}
            />
            {tintable ? (
              <label className="flex items-center justify-between text-[12px] text-t-secondary">
                <span>اللون</span>
                <span className="relative inline-flex h-7 w-12 items-center justify-center rounded-lg bg-[#f1f2f4]">
                  <span className="h-4 w-8 rounded ring-1 ring-black/10" style={{ backgroundColor: tint }} />
                  <input
                    type="color"
                    aria-label="لون التأثير"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    value={/^#[0-9a-f]{6}$/i.test(tint) ? tint : "#d4af37"}
                    onChange={(event) => setOverrides({ tintColor: event.target.value })}
                  />
                </span>
              </label>
            ) : null}
          </div>
        ) : null}
      </div>
    </ToolPopover>
  );
}
