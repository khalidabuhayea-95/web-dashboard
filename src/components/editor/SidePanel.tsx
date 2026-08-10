"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type MouseEvent as ReactMouseEvent, type UIEvent as ReactUIEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Eye,
  EyeOff,
  Facebook,
  FileText,
  ImagePlus,
  GripVertical,
  Image as ImageIcon,
  Instagram,
  LayoutGrid,
  Linkedin,
  Lock,
  Palette,
  PanelsTopLeft,
  Search,
  Shapes,
  SwatchBook,
  Sparkles,
  Square,
  Info,
  Scaling,
  Tags,
  TextCursorInput,
  Twitter,
  Unlock,
  Upload,
  Trash2,
  X,
  Video as VideoIcon,
  Youtube,
} from "lucide-react";

import Button from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import {
  DEFAULT_EDITOR_FONT_FAMILIES,
  normalizeFontFamilyList,
  normalizeFontFamilyName,
} from "@/lib/editor/fonts";
import {
  computeTrimTransparentPaddingPatch,
  rasterizeSvgDataUrlToPngDataUrl,
  SVG_SHAPE_RASTER_SCALE,
} from "@/lib/editor/imageCrop";
import { recolorSvgSource } from "@/lib/editor/imagePalette";
import {
  BUILTIN_SHAPE_ASSETS,
  BUILTIN_SHAPE_CATEGORIES,
  type BuiltInShapeAsset,
} from "@/lib/editor/builtinShapes";
import { deriveReadableFontLabel } from "@/lib/editor/customFontLabel";
import { uploadEditorMediaFile } from "@/lib/editor/mediaUpload";
import { resolveCssFontFamily } from "@/lib/templates/fontCatalog";
import { TEMPLATE_CATEGORY_SETTINGS } from "@/lib/templates/templateSettings";
import { DEFAULT_BACKGROUND_CATEGORY } from "@/lib/backgrounds/categorySettings";
import {
  DEFAULT_ANIMATION_DURATION_MS,
  DEFAULT_PAGE_DURATION_MS,
  getAnimationPreset,
  hasAnimatedTemplateContent,
  isAnimationInfiniteActive,
  type EditorAnimationType,
  normalizeAnimationDelayMs,
  normalizeAnimationDirection,
  normalizeAnimationEasing,
  normalizeAnimationDurationMs,
  normalizeAnimationInfinite,
  normalizeAnimationIntensity,
  normalizeAnimationMode,
  normalizeAnimationType,
} from "@/lib/editor/animationTimeline";
import {
  ANIMATION_CATALOG,
  ANIMATION_DIRECTIONS,
  ANIMATION_EASINGS,
  getAnimationLabel,
  supportsInfinite,
  type AnimationCategory,
} from "@/lib/editor/animationSpec";
import {
  makeAnimationSpec,
  resolveElementAnimations,
  type EditorAnimationSlots,
} from "@/lib/editor/animationSlots";
import type { AnimationSpecInput } from "@/lib/editor/animationVisual";
import { FRAME_PRESETS, type FramePreset } from "@/lib/editor/frames";
import { getPublishablePageElements } from "@/lib/editor/publishableElements";
import {
  createElementFromAsset,
  isBackgroundLayerElement,
  useEditorStore,
  type EditorDesign,
  type EditorElement,
  type SidebarTab,
} from "@/store/editorStore";

const ANIMATION_SLOT_KEY: Record<AnimationCategory, keyof EditorAnimationSlots> = {
  ENTRANCE: "entrance",
  EXIT: "exit",
  LOOP: "loop",
};

const ANIMATION_SLOT_TABS: Array<{ key: AnimationCategory; label: string; hint: string }> = [
  { key: "ENTRANCE", label: "Entrance", hint: "Plays once as the layer appears." },
  { key: "LOOP", label: "Loop", hint: "Runs continuously between the entrance and the exit." },
  { key: "EXIT", label: "Exit", hint: "Plays once as the layer leaves (its entrance, reversed)." },
];

const TOOL_TABS: Array<{ key: SidebarTab; label: string; icon: ComponentType<{ size?: number; className?: string }> }> = [
  { key: "templates", label: "Templates", icon: LayoutGrid },
  { key: "text", label: "Text", icon: TextCursorInput },
  { key: "videos", label: "Videos", icon: Clapperboard },
  { key: "shapes", label: "Shapes", icon: Shapes },
  { key: "elements", label: "Elements", icon: ImagePlus },
  { key: "frames", label: "Frames", icon: Square },
  { key: "category", label: "Category", icon: Tags },
  { key: "upload", label: "Upload", icon: Upload },
  { key: "backgrounds", label: "Background", icon: SwatchBook },
  { key: "layers", label: "Layers", icon: PanelsTopLeft },
  { key: "resize", label: "Resize", icon: Scaling },
  { key: "animation", label: "Animation", icon: Sparkles },
];

const COLOR_SWATCHES = [
  "#ffffff",
  "#4361ee",
  "#f9844a",
  "#77c95b",
  "#f0cb4b",
  "#c062da",
  "#111827",
];

type ResizePresetItem = {
  label: string;
  width: number;
  height: number;
  displaySize?: string;
};

type ResizePresetGroup = {
  group: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  items: ResizePresetItem[];
};

const PRINT_DPI = 300;
const cmToPx = (value: number) => Math.round((value / 2.54) * PRINT_DPI);
const inToPx = (value: number) => Math.round(value * PRINT_DPI);

const RESIZE_PRESETS: ResizePresetGroup[] = [
  {
    group: "Instagram",
    icon: Instagram,
    items: [
      { label: "Post", width: 1080, height: 1080 },
      { label: "Story", width: 1080, height: 1920 },
      { label: "Ad", width: 1080, height: 1080 },
      { label: "Reel", width: 1080, height: 1920 },
    ],
  },
  {
    group: "Facebook",
    icon: Facebook,
    items: [
      { label: "Post (Landscape)", width: 1200, height: 630 },
      { label: "Post (Square)", width: 1080, height: 1080 },
      { label: "Cover", width: 851, height: 315 },
      { label: "Story", width: 1080, height: 1920 },
    ],
  },
  {
    group: "Youtube",
    icon: Youtube,
    items: [
      { label: "Thumbnail", width: 1280, height: 720 },
      { label: "Channel", width: 2560, height: 1440 },
      { label: "Short", width: 1080, height: 1920 },
    ],
  },
  {
    group: "LinkedIn",
    icon: Linkedin,
    items: [
      { label: "Post", width: 1200, height: 627 },
      { label: "Banner", width: 1584, height: 396 },
      { label: "Square", width: 1080, height: 1080 },
    ],
  },
  {
    group: "Twitter",
    icon: Twitter,
    items: [
      { label: "Post", width: 1600, height: 900 },
      { label: "Header", width: 1500, height: 500 },
      { label: "Square", width: 1080, height: 1080 },
    ],
  },
  {
    group: "Video",
    icon: VideoIcon,
    items: [
      { label: "Full HD", width: 1920, height: 1080 },
      { label: "4K UHD", width: 3840, height: 2160 },
      { label: "Vertical HD", width: 1080, height: 1920 },
      { label: "Square HD", width: 1080, height: 1080 },
    ],
  },
  {
    group: "Print",
    icon: FileText,
    items: [
      { label: "Invitation", width: cmToPx(14), height: cmToPx(14), displaySize: "14x14 cm" },
      { label: "A4 Portrait", width: cmToPx(21), height: cmToPx(29.7), displaySize: "21x29.7 cm" },
      { label: "A4 Landscape", width: cmToPx(29.7), height: cmToPx(21), displaySize: "29.7x21 cm" },
      { label: "A3", width: cmToPx(29.7), height: cmToPx(42), displaySize: "29.7x42 cm" },
      { label: "Letter Portrait", width: inToPx(8.5), height: inToPx(11), displaySize: "8.5x11 in" },
      { label: "Letter Landscape", width: inToPx(11), height: inToPx(8.5), displaySize: "11x8.5 in" },
      { label: "Business card", width: inToPx(3.5), height: inToPx(2), displaySize: "3.5x2 in" },
      { label: "Poster", width: inToPx(18), height: inToPx(24), displaySize: "18x24 in" },
    ],
  },
];

// Preview-tile motion class per animation type. Keyed on the SPEC type names the catalog feeds
// (see ANIMATION_CATALOG). Types that share a motion family reuse one keyframe class — e.g. every
// zoom variant loops the same scale pulse, the gradient reveals reuse their hard-edged twin's
// sweep. New effects added here MUST also get a glyph in AnimationSampleGlyph and (if the class is
// new) a `@keyframes` in the panel's style block.
const ANIMATION_PREVIEW_CLASS: Record<string, string> = {
  NONE: "animation-sample-none",
  // ── original set ─────────────────────────────────────────────────────────
  RISE: "animation-sample-rise",
  PAN: "animation-sample-pan",
  SHIFT: "animation-sample-shift",
  SKATE: "animation-sample-skate",
  ASCEND: "animation-sample-ascend",
  BLOCK: "animation-sample-block",
  FADE: "animation-sample-fade",
  POP: "animation-sample-pop",
  WIPE: "animation-sample-wipe",
  BLUR: "animation-sample-blur",
  SUCCESSION: "animation-sample-succession",
  BREATHE: "animation-sample-breathe",
  BASELINE: "animation-sample-baseline",
  DRIFT: "animation-sample-drift",
  TECTONIC: "animation-sample-tectonic",
  TUMBLE: "animation-sample-tumble",
  NEON: "animation-sample-neon",
  SCRAPBOOK: "animation-sample-scrapbook",
  STOMP: "animation-sample-stomp",
  ROTATE: "animation-sample-rotate",
  FLICKER: "animation-sample-flicker",
  PULSE: "animation-sample-pulse",
  WIGGLE: "animation-sample-wiggle",
  // ── zoom family (scale) ──────────────────────────────────────────────────
  ZOOM: "animation-sample-zoom",
  ZOOM_FADE: "animation-sample-zoom",
  ZOOM_LOOP: "animation-sample-zoom",
  // ── travel ───────────────────────────────────────────────────────────────
  SLIDE: "animation-sample-slide",
  DROP: "animation-sample-drop",
  DIAGONAL: "animation-sample-diagonal",
  DIAGONAL_GRADIENT: "animation-sample-diagonal",
  // ── fade / dissolve ──────────────────────────────────────────────────────
  DISSOLVE: "animation-sample-dissolve",
  // ── mask reveals (sweep) ─────────────────────────────────────────────────
  GRADIENT_WIPE: "animation-sample-wipe",
  RADIAL: "animation-sample-radial",
  RADIAL_GRADIENT: "animation-sample-radial",
  CIRCUAL: "animation-sample-circle",
  CIRCUAL_GRADIENT: "animation-sample-circle",
  // ── text reveals (glyph families → alpha reveal) ─────────────────────────
  TYPEWRITER_CHARS: "animation-sample-type",
  TYPEWRITER_CURSOR: "animation-sample-type",
  TYPEWRITER_WORDS: "animation-sample-type",
  ONE_WORD: "animation-sample-type",
  CH_POSITION_FADE: "animation-sample-rise",
  CH_SCALE_FADE: "animation-sample-pop",
  CH_WIGGLE_Y: "animation-sample-wiggle",
  // ── loop motions ─────────────────────────────────────────────────────────
  WAVE: "animation-sample-wave",
  SHAKE: "animation-sample-shake",
  BOUNCE: "animation-sample-bounce",
  WOBBLE: "animation-sample-wobble",
  RANDOM: "animation-sample-random",
};

function getAnimationPreviewClass(type: string) {
  return ANIMATION_PREVIEW_CLASS[type] ?? "animation-sample-fade";
}

function renderAnimationArrow(d: string, color: string) {
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
    />
  );
}

function renderAnimationSquare(options: {
  x: number;
  y: number;
  size: number;
  fill: string;
  opacity?: number;
  strokeColor?: string;
  radius?: number;
  rotate?: number;
}) {
  const { x, y, size, fill, opacity = 1, strokeColor, radius = 8, rotate = 0 } = options;
  return (
    <rect
      x={x}
      y={y}
      width={size}
      height={size}
      rx={radius}
      fill={fill}
      fillOpacity={opacity}
      stroke={strokeColor}
      strokeWidth={strokeColor ? 1.6 : 0}
      transform={rotate ? `rotate(${rotate} ${x + size / 2} ${y + size / 2})` : undefined}
    />
  );
}

function AnimationSampleGlyph({ type }: { type: string }) {
  const purple = "#7c3aed";
  const purpleMid = "#8b5cf6";
  const purpleSoft = "#c4b5fd";
  const purplePale = "#e9ddff";
  const pink = "#fb7185";
  const pinkSoft = "#fda4af";
  const stroke = "#8b5cf6";
  const className = `animation-sample-glyph ${getAnimationPreviewClass(type)}`;

  const baseProps = { className, viewBox: "0 0 48 48", fill: "none" as const };

  switch (type) {
    case "RISE":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 16, y: 24, size: 16, fill: purpleMid, opacity: 0.28 })}
          {renderAnimationSquare({ x: 16, y: 17, size: 16, fill: purpleMid, opacity: 0.52 })}
          {renderAnimationSquare({ x: 16, y: 10, size: 16, fill: purpleMid })}
          {renderAnimationArrow("M36 29v-11m0 0-3.5 3.5M36 18l3.5 3.5", stroke)}
        </svg>
      );
    case "PAN":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 8, y: 12, size: 18, fill: purpleSoft, opacity: 0.55 })}
          {renderAnimationSquare({ x: 14, y: 12, size: 18, fill: purpleSoft, opacity: 0.75 })}
          {renderAnimationSquare({ x: 20, y: 12, size: 18, fill: purpleMid })}
          {renderAnimationArrow("M16 35h14m0 0-3.5-3.5M30 35l-3.5 3.5", stroke)}
        </svg>
      );
    // SHIFT is RISE mirrored — the block settles DOWNWARD, so the stack and arrow point down.
    case "SHIFT":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 16, y: 8, size: 16, fill: purpleMid, opacity: 0.28 })}
          {renderAnimationSquare({ x: 16, y: 15, size: 16, fill: purpleMid, opacity: 0.52 })}
          {renderAnimationSquare({ x: 16, y: 22, size: 16, fill: purpleMid })}
          {renderAnimationArrow("M36 19v11m0 0-3.5-3.5M36 30l3.5-3.5", stroke)}
        </svg>
      );
    // SKATE is PAN mirrored — the block glides in from the right, travelling left.
    case "SKATE":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 24, y: 12, size: 18, fill: purpleSoft, opacity: 0.55 })}
          {renderAnimationSquare({ x: 18, y: 12, size: 18, fill: purpleSoft, opacity: 0.75 })}
          {renderAnimationSquare({ x: 12, y: 12, size: 18, fill: purpleMid })}
          {renderAnimationArrow("M32 35H18m0 0 3.5-3.5M18 35l3.5 3.5", stroke)}
        </svg>
      );
    // ASCEND is the per-WORD rise: two word-bars lifting in, one leading the other.
    case "ASCEND":
      return (
        <svg {...baseProps}>
          <rect x="9" y="27" width="14" height="5" rx="2.5" fill={purpleMid} opacity="0.4" />
          <rect x="9" y="19" width="14" height="5" rx="2.5" fill={purpleMid} />
          {renderAnimationArrow("M15 15v-1M31 33v-14m0 0-3.5 3.5M31 19l3.5 3.5", stroke)}
        </svg>
      );
    // BLOCK: a solid bar sweeps across and uncovers the frame behind it.
    case "BLOCK":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 10, y: 13, size: 16, fill: purpleSoft, opacity: 0.5 })}
          <rect x="22" y="9" width="9" height="30" rx="2" fill={purpleMid} />
          <rect x="32" y="9" width="4" height="30" rx="1.5" fill={purpleSoft} opacity="0.55" />
        </svg>
      );
    case "FADE":
      return (
        <svg {...baseProps}>
          <rect x="10" y="11" width="9" height="24" rx="5" fill={purpleSoft} opacity="0.45" />
          <rect x="16" y="11" width="9" height="24" rx="5" fill={purpleSoft} opacity="0.65" />
          <rect x="22" y="11" width="9" height="24" rx="5" fill={purpleMid} opacity="0.82" />
          <rect x="28" y="11" width="9" height="24" rx="5" fill={purpleMid} />
        </svg>
      );
    case "POP":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 12, y: 12, size: 24, fill: purplePale, strokeColor: purpleSoft })}
          {renderAnimationSquare({ x: 16, y: 16, size: 16, fill: purpleMid })}
          {renderAnimationArrow("M6 24h3m30 0h3M24 6v3m0 30v3", pink)}
        </svg>
      );
    case "WIPE":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 11, y: 12, size: 24, fill: purpleSoft })}
          <path d="M23 12h12v24H23z" fill={purpleMid} />
          <line x1="23" y1="11" x2="23" y2="37" stroke="#6d28d9" strokeWidth="2" />
        </svg>
      );
    case "BLUR":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 13, y: 13, size: 22, fill: purpleMid })}
          <rect x="13" y="13" width="22" height="22" rx="8" fill={purpleMid} opacity="0.68" style={{ filter: "blur(3px)" }} />
        </svg>
      );
    case "SUCCESSION":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 13, y: 13, size: 22, fill: purpleMid, opacity: 0.18 })}
          <rect x="13" y="13" width="22" height="22" rx="8" fill={purpleMid} opacity="0.5" style={{ filter: "blur(2px)" }} />
          {renderAnimationArrow("M12 14l-3 3m0-3h3M36 14l3 3m-3 0h3M12 34l-3-3m0 3h3M36 34l3-3m-3 0h3", stroke)}
        </svg>
      );
    case "BREATHE":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 11, y: 11, size: 26, fill: "none", strokeColor: purpleSoft, radius: 10 })}
          {renderAnimationSquare({ x: 15, y: 15, size: 18, fill: "none", strokeColor: purpleMid, radius: 8 })}
          {renderAnimationSquare({ x: 19, y: 19, size: 10, fill: purpleMid, radius: 4 })}
          {renderAnimationArrow("M10 10l-3-3m0 3V7M38 10l3-3v3h-3M10 38l-3 3h3v-3M38 38l3 3v-3h-3", stroke)}
        </svg>
      );
    case "BASELINE":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 16, y: 24, size: 16, fill: purpleMid, opacity: 0.28 })}
          {renderAnimationSquare({ x: 16, y: 17, size: 16, fill: purpleMid, opacity: 0.52 })}
          {renderAnimationSquare({ x: 16, y: 10, size: 16, fill: purpleMid })}
          <line x1="10" y1="36" x2="38" y2="36" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "DRIFT":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 10, y: 15, size: 18, fill: purpleSoft, opacity: 0.72 })}
          {renderAnimationSquare({ x: 20, y: 15, size: 18, fill: purpleMid })}
          {renderAnimationArrow("M13 35h15m0 0-3.5-3.5M28 35l-3.5 3.5", stroke)}
        </svg>
      );
    case "TECTONIC":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 8, y: 14, size: 16, fill: purpleSoft, opacity: 0.45 })}
          {renderAnimationSquare({ x: 14, y: 14, size: 16, fill: purpleSoft, opacity: 0.7 })}
          {renderAnimationSquare({ x: 20, y: 14, size: 16, fill: purpleMid })}
          {renderAnimationArrow("M15 35h15m0 0-3.5-3.5M30 35l-3.5 3.5", stroke)}
        </svg>
      );
    case "TUMBLE":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 12, y: 13, size: 18, fill: purpleSoft, opacity: 0.65, rotate: -16 })}
          {renderAnimationSquare({ x: 20, y: 15, size: 18, fill: purpleMid, rotate: 6 })}
          {renderAnimationArrow("M12 11c4-4 12-5 18 0m0 0-1.5-3m1.5 3-3 1.5", stroke)}
        </svg>
      );
    case "NEON":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 18, y: 18, size: 12, fill: purpleMid })}
          {renderAnimationSquare({ x: 15, y: 15, size: 18, fill: "none", strokeColor: purpleMid })}
          {renderAnimationSquare({ x: 20, y: 20, size: 12, fill: "none", strokeColor: pinkSoft, radius: 4 })}
          {renderAnimationArrow("M9 22h3m-1.5-1.5V23.5M36 22h3m-1.5-1.5V23.5", pink)}
        </svg>
      );
    case "SCRAPBOOK":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 11, y: 12, size: 18, fill: purpleSoft, opacity: 0.7, rotate: -18 })}
          {renderAnimationSquare({ x: 20, y: 16, size: 18, fill: purpleMid, rotate: 2 })}
        </svg>
      );
    case "STOMP":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 10, y: 10, size: 28, fill: "none", strokeColor: purpleSoft, radius: 10 })}
          {renderAnimationSquare({ x: 14, y: 14, size: 20, fill: "none", strokeColor: purpleMid, radius: 8 })}
          {renderAnimationSquare({ x: 18, y: 18, size: 12, fill: purpleMid, radius: 5 })}
          {renderAnimationArrow("M10 10l-3-3M38 10l3-3M10 38l-3 3M38 38l3 3", stroke)}
        </svg>
      );
    case "ROTATE":
      return (
        <svg {...baseProps}>
          <circle cx="24" cy="24" r="12" fill={purpleMid} />
          {renderAnimationArrow("M13 13c2-2.5 5.5-4 9.5-4m0 0-2.5-2m2.5 2-1.2 3", stroke)}
          {renderAnimationArrow("M35 35c-2 2.5-5.5 4-9.5 4m0 0 2.5 2m-2.5-2 1.2-3", stroke)}
        </svg>
      );
    case "FLICKER":
      return (
        <svg {...baseProps}>
          <path d="M24 10c7.7 0 14 6.3 14 14s-6.3 14-14 14V10Z" fill={purpleMid} />
          <path d="M24 10c-7.7 0-14 6.3-14 14s6.3 14 14 14V10Z" fill={purpleSoft} />
        </svg>
      );
    case "PULSE":
      return (
        <svg {...baseProps}>
          <circle cx="24" cy="24" r="13" fill="none" stroke={purpleSoft} strokeWidth="4" />
          <circle cx="24" cy="24" r="8.5" fill="none" stroke={purpleMid} strokeWidth="4" />
          <circle cx="24" cy="24" r="4.5" fill={purpleSoft} />
          {renderAnimationArrow("M10 10l-3-3M38 10l3-3M10 38l-3 3M38 38l3 3", stroke)}
        </svg>
      );
    case "WIGGLE":
      return (
        <svg {...baseProps}>
          <circle cx="24" cy="24" r="12" fill={purpleMid} />
          <path d="M9 17c2 1 2 5 4 6 1 1 1 3-1 4" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
          <path d="M39 31c-2-1-2-5-4-6-1-1-1-3 1-4" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    // Zoom family — a core square with a ghost ring growing out of it, plus outward corner ticks.
    case "ZOOM":
    case "ZOOM_FADE":
    case "ZOOM_LOOP":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 10, y: 10, size: 28, fill: "none", strokeColor: purpleSoft, radius: 9 })}
          {renderAnimationSquare({ x: 17, y: 17, size: 14, fill: purpleMid, radius: 5 })}
          {renderAnimationArrow("M9 9l4 0M9 9l0 4M39 9l-4 0M39 9l0 4M9 39l4 0M9 39l0-4M39 39l-4 0M39 39l0-4", pink)}
        </svg>
      );
    // Slide — the block glides in with two trailing motion streaks.
    case "SLIDE":
      return (
        <svg {...baseProps}>
          <line x1="8" y1="20" x2="18" y2="20" stroke={purpleSoft} strokeWidth="2" strokeLinecap="round" />
          <line x1="8" y1="28" x2="18" y2="28" stroke={purpleSoft} strokeWidth="2" strokeLinecap="round" />
          {renderAnimationSquare({ x: 20, y: 14, size: 18, fill: purpleMid })}
          {renderAnimationArrow("M14 35h16m0 0-3.5-3.5M30 35l-3.5 3.5", stroke)}
        </svg>
      );
    // Drop — the block falls from above into place.
    case "DROP":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 16, y: 8, size: 16, fill: purpleMid, opacity: 0.32 })}
          {renderAnimationSquare({ x: 16, y: 22, size: 16, fill: purpleMid })}
          {renderAnimationArrow("M36 12v14m0 0-3.5-3.5M36 26l3.5-3.5", stroke)}
        </svg>
      );
    // Diagonal — travels along the bottom-left → top-right axis.
    case "DIAGONAL":
    case "DIAGONAL_GRADIENT":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 9, y: 21, size: 16, fill: purpleSoft, opacity: 0.5 })}
          {renderAnimationSquare({ x: 21, y: 9, size: 16, fill: purpleMid })}
          {renderAnimationArrow("M14 34 34 14m0 0-5 .3M34 14l-.3 5", stroke)}
        </svg>
      );
    // Dissolve — the block breaks up into scattered particles as it fades.
    case "DISSOLVE":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 11, y: 13, size: 18, fill: purpleMid })}
          <circle cx="32" cy="15" r="2" fill={purpleSoft} />
          <circle cx="36" cy="21" r="1.6" fill={purpleSoft} opacity="0.8" />
          <circle cx="31" cy="26" r="1.6" fill={purpleSoft} opacity="0.7" />
          <circle cx="37" cy="30" r="1.3" fill={purpleSoft} opacity="0.55" />
        </svg>
      );
    // Radial — a clock-sweep wedge fills the ring.
    case "RADIAL":
    case "RADIAL_GRADIENT":
      return (
        <svg {...baseProps}>
          <circle cx="24" cy="24" r="13" fill="none" stroke={purpleSoft} strokeWidth="2.4" />
          <path d="M24 24V11a13 13 0 0 1 11.3 6.5Z" fill={purpleMid} />
          <circle cx="24" cy="24" r="2.4" fill={purple} />
        </svg>
      );
    // Circular — a filled disc grows out from the centre.
    case "CIRCUAL":
    case "CIRCUAL_GRADIENT":
      return (
        <svg {...baseProps}>
          <circle cx="24" cy="24" r="14" fill="none" stroke={purpleSoft} strokeWidth="2" strokeDasharray="3 3" />
          <circle cx="24" cy="24" r="9" fill={purpleMid} />
        </svg>
      );
    // Typewriter / one-word — text lines revealing left→right, with a caret.
    case "TYPEWRITER_CHARS":
    case "TYPEWRITER_CURSOR":
    case "TYPEWRITER_WORDS":
    case "ONE_WORD":
      return (
        <svg {...baseProps}>
          <rect x="10" y="15" width="20" height="3.4" rx="1.7" fill={purpleMid} />
          <rect x="10" y="22.5" width="14" height="3.4" rx="1.7" fill={purpleMid} opacity="0.8" />
          <rect x="10" y="30" width="9" height="3.4" rx="1.7" fill={purpleSoft} opacity="0.6" />
          <rect x={type === "TYPEWRITER_CURSOR" ? 26 : 21} y="29" width="2.4" height="6.4" rx="1" fill={pink} />
        </svg>
      );
    // Per-character families — three letter cells, the lead one lifted/emphasised.
    case "CH_POSITION_FADE":
    case "CH_SCALE_FADE":
    case "CH_WIGGLE_Y":
      return (
        <svg {...baseProps}>
          <rect x="10" y="20" width="8" height="12" rx="2.5" fill={purpleSoft} opacity="0.55" />
          <rect x="20" y="15" width="8" height="12" rx="2.5" fill={purpleMid} />
          <rect x="30" y="20" width="8" height="12" rx="2.5" fill={purpleSoft} opacity="0.75" />
        </svg>
      );
    // Wave — the block rides a sine curve.
    case "WAVE":
      return (
        <svg {...baseProps}>
          <path d="M8 26c4-8 8-8 12 0s8 8 12 0" fill="none" stroke={purpleSoft} strokeWidth="2" strokeLinecap="round" />
          {renderAnimationSquare({ x: 18, y: 12, size: 12, fill: purpleMid, radius: 4 })}
        </svg>
      );
    // Shake — the block jitters sideways, streaks on both flanks.
    case "SHAKE":
      return (
        <svg {...baseProps}>
          <line x1="7" y1="24" x2="12" y2="24" stroke={purpleSoft} strokeWidth="2" strokeLinecap="round" />
          <line x1="36" y1="24" x2="41" y2="24" stroke={purpleSoft} strokeWidth="2" strokeLinecap="round" />
          {renderAnimationSquare({ x: 16, y: 15, size: 16, fill: purpleMid })}
        </svg>
      );
    // Bounce — a ball hopping off a baseline.
    case "BOUNCE":
      return (
        <svg {...baseProps}>
          <circle cx="24" cy="19" r="9" fill={purpleMid} />
          <line x1="11" y1="35" x2="37" y2="35" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
          {renderAnimationArrow("M36 15v8", pinkSoft)}
        </svg>
      );
    // Wobble — a tilted block with a rocking arc.
    case "WOBBLE":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 16, y: 16, size: 18, fill: purpleMid, rotate: -12 })}
          <path d="M12 13a16 16 0 0 1 24 0" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    // Random — the block scattered by stray jitter ticks.
    case "RANDOM":
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 17, y: 17, size: 14, fill: purpleMid, radius: 5 })}
          <circle cx="12" cy="14" r="1.7" fill={purpleSoft} />
          <circle cx="37" cy="17" r="1.7" fill={purpleSoft} opacity="0.8" />
          <circle cx="14" cy="34" r="1.7" fill={purpleSoft} opacity="0.7" />
          <circle cx="35" cy="33" r="1.7" fill={purpleSoft} opacity="0.85" />
        </svg>
      );
    default:
      return (
        <svg {...baseProps}>
          {renderAnimationSquare({ x: 12, y: 12, size: 24, fill: purpleMid })}
        </svg>
      );
  }
}

function AnimationSampleTile({ type }: { type: string }) {
  if (type === "NONE") {
    return (
      <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-[#d6dce6] bg-white">
        <div className="h-8 w-8 rounded-2xl border-2 border-[#a1aab8]" />
        <div className="absolute h-9 w-px rotate-45 bg-[#a1aab8]" />
      </div>
    );
  }

  return (
    <div className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-[linear-gradient(180deg,#f8fbff_0%,#eef3f9_100%)] ring-1 ring-inset ring-[#d8e0ea]">
      <AnimationSampleGlyph type={type} />
    </div>
  );
}

interface StoredTemplate {
  id: string;
  name: string;
  status?: "draft" | "published";
  category?: string;
  subCategory?: string;
  tags?: string[];
  updatedAt?: string;
  data?: unknown;
  canvasSize?: {
    width?: number;
    height?: number;
  } | null;
  thumbnailDataUrl?: string | null;
  previewVideoUrl?: string | null;
  previewPosterUrl?: string | null;
  previewStatus?: string | null;
  previewDurationMs?: number | null;
  previewVersion?: number | null;
  previewError?: string | null;
  previewUpdatedAt?: string | null;
}

interface TaxonomySubCategorySetting {
  value: string;
  labelEn: string;
  labelAr: string;
  published?: boolean;
}

interface TaxonomyCategorySetting {
  value: string;
  labelEn: string;
  labelAr: string;
  published?: boolean;
  subCategories: TaxonomySubCategorySetting[];
}

interface CustomFontRecord {
  id: string;
  family: string;
  fileName: string;
  mimeType: string;
  dataUrl?: string;
  fileUrl?: string;
  categories?: string[];
  source?: string;
  removable?: boolean;
  displayName?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface ImportedElementRecord {
  id: string;
  source: string;
  sourceAssetId?: string;
  categoryValue?: string;
  kind: "icon" | "vector" | "image";
  title: string;
  titleEn: string;
  titleAr: string;
  tags: string[];
  tagsEn?: string[];
  tagsAr?: string[];
  labels: string[];
  labelsEn?: string[];
  labelsAr?: string[];
  assetUrl: string;
  thumbnailUrl: string;
  animatedVideoUrl?: string;
  width?: number | null;
  height?: number | null;
  freeSvg?: boolean;
  sourcePayload?: Record<string, unknown>;
}

interface BackgroundCategoryRecord {
  id?: string;
  value: string;
  labelEn: string;
  labelAr: string;
  thumbnailUrl?: string;
  published?: boolean;
}

function buildTemplateLoadSignature(templateId: string, updatedAt = "") {
  const safeId = String(templateId || "").trim();
  const safeUpdatedAt = String(updatedAt || "").trim();
  return safeId ? `${safeId}::${safeUpdatedAt}` : "";
}

const FONT_UPLOAD_ACCEPT =
  ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2,application/font-woff,application/x-font-ttf,application/x-font-otf";
const RECENT_BUILTIN_SHAPES_STORAGE_KEY = "editor-pro-recent-built-in-shapes";
const BACKGROUND_LIBRARY_SOURCES = new Set(["freepik-background", "background-upload"]);

function toNumber(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function isGifSource(value: unknown) {
  const source = String(value || "").trim().toLowerCase();
  if (!source) return false;
  if (source.startsWith("data:image/gif")) return true;
  try {
    const parsed = new URL(source);
    return /\.gif$/i.test(parsed.pathname || "");
  } catch {
    return /\.gif(?:$|[?#])/i.test(source);
  }
}

function isVideoSource(value: unknown) {
  const source = String(value || "").trim().toLowerCase();
  if (!source) return false;
  if (source.startsWith("data:video/")) return true;
  try {
    const parsed = new URL(source);
    return /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(parsed.pathname || "");
  } catch {
    return /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(source);
  }
}

function resolveImportedElementPreviewUrl(item: ImportedElementRecord) {
  if (isGifSource(item.assetUrl)) {
    return item.assetUrl;
  }
  return item.thumbnailUrl || item.assetUrl;
}

function deriveFreepikAnimatedVideoUrl(item: ImportedElementRecord) {
  const explicit = String(item.animatedVideoUrl || "").trim();
  if (isVideoSource(explicit)) {
    return explicit;
  }

  const likelyAnimated =
    isGifSource(item.assetUrl) ||
    isGifSource(item.thumbnailUrl) ||
    /cdn-icons-gif\.freepik\.com/i.test(String(item.assetUrl || "")) ||
    /cdn-icons-gif\.freepik\.com/i.test(String(item.thumbnailUrl || ""));
  if (!likelyAnimated) {
    return "";
  }

  const sourceAssetId = String(item.sourceAssetId || "").trim();
  if (/^\d+$/.test(sourceAssetId)) {
    const folder = String(Math.floor(Number(sourceAssetId) / 1000));
    return `https://cdn-icons-mp4.freepik.com/512/${folder}/${sourceAssetId}.mp4`;
  }

  const asset = String(item.assetUrl || "").trim();
  if (!asset) return "";
  try {
    const parsed = new URL(asset);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const filePart = parts[parts.length - 1] || "";
    const idPart = filePart.replace(/\.(gif|png|webp)$/i, "");
    if (!/^\d+$/.test(idPart)) return "";
    const folder = parts.length >= 2 && /^\d+$/.test(parts[parts.length - 2])
      ? parts[parts.length - 2]
      : String(Math.floor(Number(idPart) / 1000));
    return `https://cdn-icons-mp4.freepik.com/512/${folder}/${idPart}.mp4`;
  } catch {
    return "";
  }
}

function toEditorBlendMode(mode: unknown): GlobalCompositeOperation | "source-over" {
  if (typeof mode !== "string") return "source-over";
  const normalized = mode.toLowerCase();
  if (normalized === "normal") return "source-over";
  if (
    normalized === "multiply" ||
    normalized === "screen" ||
    normalized === "overlay" ||
    normalized === "darken" ||
    normalized === "lighten" ||
    normalized === "source-over"
  ) {
    return normalized as GlobalCompositeOperation | "source-over";
  }
  return "source-over";
}

function extractFabricData(payload: unknown): { objects: Array<Record<string, unknown>>; backgroundColor?: unknown } | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;

  if (Array.isArray(data.objects)) {
    return data as { objects: Array<Record<string, unknown>>; backgroundColor?: unknown };
  }

  if (data.fabric && typeof data.fabric === "object") {
    const fabric = data.fabric as Record<string, unknown>;
    if (Array.isArray(fabric.objects)) {
      return fabric as { objects: Array<Record<string, unknown>>; backgroundColor?: unknown };
    }
  }

  if (data.data && typeof data.data === "object") {
    const nested = data.data as Record<string, unknown>;
    if (Array.isArray(nested.objects)) {
      return nested as { objects: Array<Record<string, unknown>>; backgroundColor?: unknown };
    }
    if (nested.fabric && typeof nested.fabric === "object") {
      const nestedFabric = nested.fabric as Record<string, unknown>;
      if (Array.isArray(nestedFabric.objects)) {
        return nestedFabric as { objects: Array<Record<string, unknown>>; backgroundColor?: unknown };
      }
    }
  }

  return null;
}

function parseColor(value: unknown, fallback = "#111827") {
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

function parseOptionalColor(value: unknown) {
  if (typeof value !== "string") return "";
  const color = value.trim();
  if (!color) return "";
  const lower = color.toLowerCase();
  if (lower === "transparent" || lower === "rgba(0, 0, 0, 0)") return "";
  return color;
}

function normalizeTextAlign(value: unknown): "left" | "center" | "right" | "justify" {
  if (value === "center" || value === "right" || value === "justify") return value;
  return "left";
}

function normalizeTextDecoration(
  decoration: unknown,
  underline: unknown,
  lineThrough: unknown
): "" | "underline" | "line-through" | "underline line-through" {
  const tokens = new Set<string>();
  const raw = String(decoration || "").toLowerCase();
  if (raw.includes("underline")) tokens.add("underline");
  if (raw.includes("line-through") || raw.includes("linethrough")) tokens.add("line-through");
  if (underline === true) tokens.add("underline");
  if (lineThrough === true) tokens.add("line-through");
  const hasUnderline = tokens.has("underline");
  const hasLineThrough = tokens.has("line-through");
  if (hasUnderline && hasLineThrough) return "underline line-through";
  if (hasUnderline) return "underline";
  if (hasLineThrough) return "line-through";
  return "";
}

function createSolidFillDataUrl(fill: string, width: number, height: number, radius = 0): string {
  if (typeof document === "undefined") return "";
  try {
    const resolvedWidth = Math.max(1, Math.round(width));
    const resolvedHeight = Math.max(1, Math.round(height));
    const canvas = document.createElement("canvas");
    canvas.width = resolvedWidth;
    canvas.height = resolvedHeight;
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.clearRect(0, 0, resolvedWidth, resolvedHeight);
    context.fillStyle = parseColor(fill, "#111827");
    const safeRadius = Math.max(0, Math.min(Number(radius) || 0, Math.min(resolvedWidth, resolvedHeight) / 2));
    if (safeRadius <= 0) {
      context.fillRect(0, 0, resolvedWidth, resolvedHeight);
    } else {
      const right = resolvedWidth;
      const bottom = resolvedHeight;
      context.beginPath();
      context.moveTo(safeRadius, 0);
      context.lineTo(right - safeRadius, 0);
      context.quadraticCurveTo(right, 0, right, safeRadius);
      context.lineTo(right, bottom - safeRadius);
      context.quadraticCurveTo(right, bottom, right - safeRadius, bottom);
      context.lineTo(safeRadius, bottom);
      context.quadraticCurveTo(0, bottom, 0, bottom - safeRadius);
      context.lineTo(0, safeRadius);
      context.quadraticCurveTo(0, 0, safeRadius, 0);
      context.closePath();
      context.fill();
    }
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

async function readImageFileDimensions(file: File) {
  if (typeof window === "undefined" || !file) {
    return { width: null, height: null };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const dimensions = await new Promise<{ width: number | null; height: number | null }>((resolve) => {
      const image = new window.Image();
      image.onload = () => {
        resolve({
          width: Number.isFinite(Number(image.naturalWidth)) ? Number(image.naturalWidth) : null,
          height: Number.isFinite(Number(image.naturalHeight)) ? Number(image.naturalHeight) : null,
        });
      };
      image.onerror = () => {
        resolve({ width: null, height: null });
      };
      image.src = objectUrl;
    });
    return dimensions;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function extractImportUsedFonts(templateData: unknown): string[] {
  if (!templateData || typeof templateData !== "object") return [];
  const data = templateData as Record<string, unknown>;
  const meta = data.meta && typeof data.meta === "object" ? (data.meta as Record<string, unknown>) : null;
  const importMeta =
    (meta?.import && typeof meta.import === "object" ? (meta.import as Record<string, unknown>) : null) ||
    (data.import && typeof data.import === "object" ? (data.import as Record<string, unknown>) : null);
  const usedFonts = Array.isArray(importMeta?.usedFonts) ? importMeta.usedFonts : [];
  return normalizeFontFamilyList(usedFonts);
}

function collectDesignTextFonts(design: EditorDesign): string[] {
  if (!design || !Array.isArray(design.pages)) return [];
  const fonts: string[] = [];
  design.pages.forEach((page) => {
    if (!page || !Array.isArray(page.elements)) return;
    page.elements.forEach((element) => {
      if (element?.type !== "text") return;
      fonts.push(String(element.fontFamily || ""));
    });
  });
  return normalizeFontFamilyList(fonts);
}

function readTemplateImportMeta(templateData: unknown): Record<string, unknown> | null {
  if (!templateData || typeof templateData !== "object") return null;
  const data = templateData as Record<string, unknown>;
  const meta = data.meta && typeof data.meta === "object" ? (data.meta as Record<string, unknown>) : null;
  return (
    (meta?.import && typeof meta.import === "object" ? (meta.import as Record<string, unknown>) : null) ||
    (data.import && typeof data.import === "object" ? (data.import as Record<string, unknown>) : null)
  );
}

function isCanvaImportedTemplate(templateData: unknown) {
  const importMeta = readTemplateImportMeta(templateData);
  const source = String(importMeta?.source || "").toLowerCase();
  return source.includes("canva");
}

function findLikelyBackgroundLayerIndex(elements: EditorElement[], pageWidth: number, pageHeight: number) {
  let bestIndex = -1;
  let bestScore = -1;
  elements.forEach((element, index) => {
    if (!element || element.type !== "image") return;
    const scaleX = Math.max(0.0001, Math.abs(Number(element.scaleX) || 1));
    const scaleY = Math.max(0.0001, Math.abs(Number(element.scaleY) || 1));
    const width = Math.max(1, (Number(element.width) || 0) * scaleX);
    const height = Math.max(1, (Number(element.height) || 0) * scaleY);
    const clippedWidth = Math.min(width, pageWidth);
    const clippedHeight = Math.min(height, pageHeight);
    const coverage = (clippedWidth * clippedHeight) / Math.max(1, pageWidth * pageHeight);
    if (coverage < 0.85) return;
    const nearOrigin =
      Math.abs(Number(element.x) || 0) <= pageWidth * 0.05 &&
      Math.abs(Number(element.y) || 0) <= pageHeight * 0.05;
    const score = coverage * 10 + (nearOrigin ? 2 : 0) + (index === 0 ? 0.25 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function renderedLayerWidth(element: EditorElement) {
  return Math.max(1, Number(element.width || 0) * Math.max(0.0001, Math.abs(Number(element.scaleX) || 1)));
}

function renderedLayerHeight(element: EditorElement) {
  return Math.max(1, Number(element.height || 0) * Math.max(0.0001, Math.abs(Number(element.scaleY) || 1)));
}

function findMatchingShapeLayerIndex(
  elements: EditorElement[],
  target: EditorElement,
  pageWidth: number,
  pageHeight: number
) {
  const targetWidth = renderedLayerWidth(target);
  const targetHeight = renderedLayerHeight(target);
  const xTolerance = Math.max(6, pageWidth * 0.02);
  const yTolerance = Math.max(6, pageHeight * 0.02);
  const wTolerance = Math.max(8, pageWidth * 0.025);
  const hTolerance = Math.max(8, pageHeight * 0.025);

  for (let index = 0; index < elements.length; index += 1) {
    const candidate = elements[index];
    if (!candidate || candidate.type !== "rect") continue;
    if (candidate.syntheticTextBackground) continue;
    if (isBackgroundLayerElement(candidate, { width: pageWidth, height: pageHeight })) continue;

    const candidateWidth = renderedLayerWidth(candidate);
    const candidateHeight = renderedLayerHeight(candidate);
    const closePosition =
      Math.abs((Number(candidate.x) || 0) - (Number(target.x) || 0)) <= xTolerance &&
      Math.abs((Number(candidate.y) || 0) - (Number(target.y) || 0)) <= yTolerance;
    const closeSize =
      Math.abs(candidateWidth - targetWidth) <= wTolerance &&
      Math.abs(candidateHeight - targetHeight) <= hTolerance;

    if (closePosition && closeSize) {
      return index;
    }
  }
  return -1;
}

function dedupeSyntheticTextBackgroundLayers(
  sourceElements: EditorElement[],
  pageWidth: number,
  pageHeight: number
) {
  const elements = sourceElements.map((element) => ({ ...element }));
  const removeIds = new Set<string>();

  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    if (!element?.syntheticTextBackground || element.type !== "image") continue;
    const shapeIndex = findMatchingShapeLayerIndex(elements, element, pageWidth, pageHeight);
    if (shapeIndex < 0) continue;
    const shape = elements[shapeIndex];
    if (shape && !shape.visible) {
      shape.visible = true;
    }
    removeIds.add(element.id);
  }

  if (removeIds.size === 0) return elements;
  return elements.filter((element) => !removeIds.has(element.id));
}

function toEditorDesignFromTemplate(
  template: StoredTemplate,
  fallbackWidth: number,
  fallbackHeight: number
): EditorDesign | null {
  if (!template || !template.id) return null;
  const templateThumbnailSrc = String(template.thumbnailDataUrl || "").trim();
  const dbPreviewUrl = String(template.previewVideoUrl || "").trim();
  const dbPreviewPosterUrl =
    String(template.previewPosterUrl || "").trim() || templateThumbnailSrc || null;
  const dbPreviewStatus = String(template.previewStatus || "").trim() || "not_requested";
  const dbPreviewGeneratedAt = String(template.previewUpdatedAt || "").trim() || null;
  const dbPreviewError = String(template.previewError || "").trim() || null;

  if (template.data && typeof template.data === "object") {
    const maybeDesign = template.data as Partial<EditorDesign>;
    if (Array.isArray(maybeDesign.pages) && maybeDesign.pages.length > 0) {
      return {
        version: Number(maybeDesign.version || 2),
        activePageId: maybeDesign.activePageId || maybeDesign.pages[0].id,
        ...(maybeDesign.timeline
          ? {
              timeline: {
                ...maybeDesign.timeline,
                preview: {
                  ...(maybeDesign.timeline.preview || {}),
                  status: dbPreviewStatus || maybeDesign.timeline.preview?.status || "not_requested",
                  url: dbPreviewUrl || String(maybeDesign.timeline.preview?.url || "").trim() || null,
                  posterUrl:
                    dbPreviewPosterUrl ||
                    String(maybeDesign.timeline.preview?.posterUrl || "").trim() ||
                    templateThumbnailSrc ||
                    null,
                  generatedAt:
                    dbPreviewGeneratedAt ||
                    String(maybeDesign.timeline.preview?.generatedAt || "").trim() ||
                    null,
                  error: dbPreviewError || String(maybeDesign.timeline.preview?.error || "").trim() || null,
                },
              },
            }
          : {}),
        pages: maybeDesign.pages as EditorDesign["pages"],
      };
    }
  }

  const width = Math.max(16, Math.round(toNumber(template.canvasSize?.width, fallbackWidth)));
  const height = Math.max(16, Math.round(toNumber(template.canvasSize?.height, fallbackHeight)));
  const pageId = `template-page-${template.id}`;
  const fabric = extractFabricData(template.data);
  const importMeta = readTemplateImportMeta(template.data);
  const isCanvaTemplate = isCanvaImportedTemplate(template.data);
  const layerTree = Array.isArray(importMeta?.layerTree) ? (importMeta.layerTree as Array<Record<string, unknown>>) : [];
  const layerZIndexByNodeId = new Map<string, number>();
  layerTree.forEach((node, index) => {
    const id = String(node?.id || "").trim();
    if (!id) return;
    const zIndex = Number.isFinite(Number(node?.zIndex)) ? Number(node?.zIndex) : index;
    layerZIndexByNodeId.set(id, zIndex);
  });

  const elements: EditorElement[] = [];

  if (fabric) {
    fabric.objects.forEach((object, index) => {
      if (!object || typeof object !== "object") return;
      const item = object as Record<string, unknown>;
      const type = String(item.type || "").toLowerCase();
      const scaleX = toNumber(item.scaleX, 1);
      const scaleY = toNumber(item.scaleY, 1);
      const scaleXAbs = Math.max(0.0001, Math.abs(scaleX));
      const scaleYAbs = Math.max(0.0001, Math.abs(scaleY));
      const signedScaleX = (item.flipX ? -1 : 1) * (scaleX < 0 ? -1 : 1);
      const signedScaleY = (item.flipY ? -1 : 1) * (scaleY < 0 ? -1 : 1);
      const rotation = toNumber(item.rotation, toNumber(item.angle, 0));
      const explicitX = Number(item.x);
      const explicitY = Number(item.y);
      const explicitWidth = Number(item.width);
      const explicitHeight = Number(item.height);
      const hasExplicitPosition = Number.isFinite(explicitX) && Number.isFinite(explicitY);
      const hasExplicitSize = Number.isFinite(explicitWidth) && Number.isFinite(explicitHeight);
      const originX = String(item.originX || "left").toLowerCase();
      const originY = String(item.originY || "top").toLowerCase();
      const hasTopLeftExplicitFrame =
        hasExplicitPosition &&
        hasExplicitSize &&
        originX === "left" &&
        originY === "top";
      const hasExplicitFrame =
        Number.isFinite(explicitX) &&
        Number.isFinite(explicitY) &&
        Number.isFinite(explicitWidth) &&
        Number.isFinite(explicitHeight);
      const widthValue =
        type === "circle"
          ? toNumber(item.radius, 100) * 2
          : toNumber(item.width, type === "line" ? Math.abs(toNumber(item.x2, 220) - toNumber(item.x1, 0)) : 240);
      const heightValue =
        type === "circle"
          ? toNumber(item.radius, 100) * 2
          : toNumber(item.height, type === "line" ? Math.abs(toNumber(item.y2, 0) - toNumber(item.y1, 0)) : 160);
      const renderedWidth = hasExplicitFrame
        ? Math.max(1, toNumber(item.width, 1))
        : Math.max(1, widthValue * scaleXAbs);
      const renderedHeight = hasExplicitFrame
        ? Math.max(1, toNumber(item.height, 1))
        : Math.max(1, heightValue * scaleYAbs);
      const anchorX = Number.isFinite(Number(item.left))
        ? Number(item.left)
        : hasExplicitPosition
          ? explicitX
          : 0;
      const anchorY = Number.isFinite(Number(item.top))
        ? Number(item.top)
        : hasExplicitPosition
          ? explicitY
          : 0;
      let resolvedX = hasTopLeftExplicitFrame ? explicitX : anchorX;
      let resolvedY = hasTopLeftExplicitFrame ? explicitY : anchorY;
      if (!hasTopLeftExplicitFrame) {
        const originOffsetX = originX === "center" ? renderedWidth / 2 : originX === "right" ? renderedWidth : 0;
        const originOffsetY = originY === "center" ? renderedHeight / 2 : originY === "bottom" ? renderedHeight : 0;
        const localX = -originOffsetX * signedScaleX;
        const localY = -originOffsetY * signedScaleY;
        const radians = (rotation * Math.PI) / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        resolvedX = anchorX + localX * cos - localY * sin;
        resolvedY = anchorY + localX * sin + localY * cos;
      }

      const importNodeId = String(item.importNodeId || "").trim();
      const treeZIndex =
        importNodeId && layerZIndexByNodeId.has(importNodeId)
          ? Number(layerZIndexByNodeId.get(importNodeId))
          : Number.NaN;
      const importZIndex = Number.isFinite(Number(item.importZIndex))
        ? Number(item.importZIndex)
        : Number.isFinite(Number(item.zIndex))
          ? Number(item.zIndex)
          : Number.isFinite(treeZIndex)
            ? treeZIndex
            : index;
      const common: Partial<EditorElement> = {
        id: `tpl-${template.id}-${index}`,
        name: String(item.layerName || item.name || `${type || "Layer"} ${index + 1}`),
        x: resolvedX,
        y: resolvedY,
        width: renderedWidth,
        height: renderedHeight,
        rotation,
        opacity: Math.max(0, Math.min(1, toNumber(item.opacity, 1))),
        visible: item.visible !== false && item.layerHidden !== true,
        locked: item.layerLocked === true || item.selectable === false,
        fill: parseColor(item.fill, "#3b82f6"),
        stroke: parseColor(item.stroke, "#1e293b"),
        strokeWidth: Math.max(0, toNumber(item.strokeWidth, 0)),
        cornerRadius: Math.max(0, toNumber(item.cornerRadius, 0)),
        // Drop shadow. The alpha rides in the colour (`rgba(...)`) — the element has no separate
        // shadow-opacity field, and Konva takes any CSS colour. Offsets can be negative (the
        // shadow falls up/left), so they are NOT clamped at 0 like the blur.
        shadowColor: parseColor(item.shadowColor, "#000000"),
        shadowBlur: Math.max(0, toNumber(item.shadowBlur, 0)),
        shadowOffsetX: toNumber(item.shadowOffsetX, 0),
        shadowOffsetY: toNumber(item.shadowOffsetY, 0),
        scaleX: signedScaleX,
        scaleY: signedScaleY,
        blendMode: toEditorBlendMode(item.blendMode),
        timelineStartMs: Math.max(0, toNumber(item.timelineStartMs, 0)),
        timelineEndMs: Math.max(0, toNumber(item.timelineEndMs, DEFAULT_PAGE_DURATION_MS)),
        mediaAnimationType: normalizeAnimationType(item.mediaAnimationType || item.animationType || undefined),
        mediaAnimationMode: normalizeAnimationMode(item.mediaAnimationMode || item.animationMode || undefined),
        mediaAnimationInfinite: normalizeAnimationInfinite(
          item.mediaAnimationInfinite ?? item.animationInfinite,
          item.mediaAnimationMode || item.animationMode || undefined
        ),
        mediaAnimationDurationMs: normalizeAnimationDurationMs(
          item.mediaAnimationDurationMs ?? item.animationDurationMs ?? item.animationDuration
        ),
        ...(Number(item.mediaAnimationOutDurationMs) > 0
          ? { mediaAnimationOutDurationMs: normalizeAnimationDurationMs(item.mediaAnimationOutDurationMs) }
          : {}),
        ...(Array.isArray(item.mediaMotionPath) && (item.mediaMotionPath as unknown[]).length >= 2
          ? {
              mediaMotionPath: (item.mediaMotionPath as Array<Record<string, unknown>>)
                .map((point) => ({
                  t: Math.max(0, toNumber(point?.t, 0)),
                  x: toNumber(point?.x, 0),
                  y: toNumber(point?.y, 0),
                }))
                .slice(0, 256),
            }
          : {}),
        mediaAnimationDelayMs: normalizeAnimationDelayMs(item.mediaAnimationDelayMs ?? item.animationDelayMs ?? item.animationDelay),
        mediaAnimationDirection: normalizeAnimationDirection(
          item.mediaAnimationDirection ?? item.animationDirection,
          item.mediaAnimationType || item.animationType || undefined
        ),
        mediaAnimationEasing: normalizeAnimationEasing(
          item.mediaAnimationEasing ?? item.animationEasing,
          item.mediaAnimationType || item.animationType || undefined
        ),
        mediaAnimationIntensity: normalizeAnimationIntensity(
          item.mediaAnimationIntensity ?? item.animationIntensity
        ),
        sourceAnimationLabel: String(item.sourceAnimationLabel || item.animationLabel || "").trim() || undefined,
        sourceAnimationName: String(item.sourceAnimationName || item.rawAnimationName || "").trim() || undefined,
        ...(importNodeId ? { importNodeId } : {}),
        ...(String(item.importParentId || "").trim() ? { importParentId: String(item.importParentId).trim() } : {}),
        ...(String(item.importKind || "").trim() ? { importKind: String(item.importKind).trim() } : {}),
        ...(String(item.sourceAssetId || "").trim() ? { sourceAssetId: String(item.sourceAssetId).trim() } : {}),
        ...(String(item.titleEn || "").trim() ? { titleEn: String(item.titleEn).trim() } : {}),
        ...(String(item.titleAr || "").trim() ? { titleAr: String(item.titleAr).trim() } : {}),
        ...(Array.isArray(item.tagsEn) && item.tagsEn.length > 0
          ? { tagsEn: item.tagsEn.map((value) => String(value || "").trim()).filter(Boolean) }
          : {}),
        ...(Array.isArray(item.tagsAr) && item.tagsAr.length > 0
          ? { tagsAr: item.tagsAr.map((value) => String(value || "").trim()).filter(Boolean) }
          : {}),
        ...(Array.isArray(item.labelsEn) && item.labelsEn.length > 0
          ? { labelsEn: item.labelsEn.map((value) => String(value || "").trim()).filter(Boolean) }
          : {}),
        ...(Array.isArray(item.labelsAr) && item.labelsAr.length > 0
          ? { labelsAr: item.labelsAr.map((value) => String(value || "").trim()).filter(Boolean) }
          : {}),
        importZIndex,
        fallback: Boolean(item.fallback),
        fallbackReason: String(item.fallbackReason || ""),
      };

      if (type === "image" && typeof item.src === "string" && item.src) {
        const rasterOriginalSrc = String(item.rasterOriginalSrc || "").trim();
        const rasterPalette = Array.isArray(item.rasterPalette)
          ? item.rasterPalette
              .map((value) => String(value || "").trim())
              .filter(Boolean)
          : [];
        const rasterPaletteVersion = Math.max(
          0,
          Number(item.rasterPaletteVersion || 0)
        );
        const rawRasterColorMap =
          item.rasterColorMap && typeof item.rasterColorMap === "object"
            ? (item.rasterColorMap as Record<string, unknown>)
            : null;
        const rasterColorMap = rawRasterColorMap
          ? Object.fromEntries(
              Object.entries(rawRasterColorMap)
                .map(([key, value]) => [String(key || "").trim(), String(value || "").trim()] as const)
                .filter(([key, value]) => Boolean(key) && Boolean(value))
            )
          : {};

        elements.push(
          createElementFromAsset(pageId, {
            ...common,
            type: "image",
            src: item.src,
            ...(rasterOriginalSrc ? { rasterOriginalSrc } : {}),
            ...(rasterPalette.length > 0 ? { rasterPalette } : {}),
            ...(rasterPaletteVersion > 0 ? { rasterPaletteVersion } : {}),
            ...(Object.keys(rasterColorMap).length > 0 ? { rasterColorMap } : {}),
          })
        );
        return;
      }

      if (type === "textbox" || type === "i-text" || type === "text") {
        const fontSize = Math.max(10, toNumber(item.fontSize, 48));
        const scaledFontSize = Math.max(10, fontSize * scaleYAbs);
        const charSpacingRaw = Number(item.charSpacing);
        const hasCharSpacing = Number.isFinite(charSpacingRaw);
        const explicitLetterSpacing = Number(item.letterSpacing);
        const letterSpacing = hasCharSpacing
          ? (charSpacingRaw / 1000) * scaledFontSize
          : Number.isFinite(explicitLetterSpacing)
            ? explicitLetterSpacing * scaleXAbs
            : 0;
        const textBackgroundColor = parseOptionalColor(
          item.textBackgroundColor || item.backgroundColor || item.bgColor
        );
        const textBackgroundRadius = Math.max(
          0,
          toNumber(item.textBackgroundRadius, 0) * Math.max(scaleXAbs, scaleYAbs)
        );
        if (textBackgroundColor) {
          const backgroundDataUrl = createSolidFillDataUrl(
            textBackgroundColor,
            common.width || 1,
            common.height || 1,
            textBackgroundRadius
          );
          if (backgroundDataUrl) {
            const backgroundElement = createElementFromAsset(pageId, {
              ...common,
              type: "image",
              name: `${String(common.name || "Text")} Background`,
              src: backgroundDataUrl,
              syntheticTextBackground: true,
            });
            backgroundElement.importZIndex = importZIndex - 0.25;
            elements.push(backgroundElement);
          }
        }
        elements.push(
          createElementFromAsset(pageId, {
            ...common,
            type: "text",
            text: String(item.text || ""),
            fontFamily:
              normalizeFontFamilyName(item.fontFamily || item.fontName || DEFAULT_EDITOR_FONT_FAMILIES[0]) ||
              DEFAULT_EDITOR_FONT_FAMILIES[0],
            fontSize: scaledFontSize,
            fontWeight: String(item.fontWeight || "400"),
            fontStyle: item.fontStyle === "italic" ? "italic" : "normal",
            textDecoration: normalizeTextDecoration(
              item.textDecoration,
              item.underline,
              item.linethrough
            ),
            align: normalizeTextAlign(item.textAlign ?? item.align),
            lineHeight: Math.max(0.1, toNumber(item.lineHeight, 1.15)),
            letterSpacing,
            color: parseColor(item.fill, "#111827"),
            fill: parseColor(item.fill, "#111827"),
          })
        );
        return;
      }

      if (type === "circle") {
        elements.push(createElementFromAsset(pageId, { ...common, type: "circle" }));
        return;
      }

      if (type === "line") {
        const x1 = toNumber(item.x1, 0);
        const y1 = toNumber(item.y1, 0);
        const x2 = toNumber(item.x2, common.width || 220);
        const y2 = toNumber(item.y2, 0);
        const points = [0, 0, (x2 - x1) * Math.max(0.0001, Math.abs(scaleX)), (y2 - y1) * Math.max(0.0001, Math.abs(scaleY))];
        elements.push(
          createElementFromAsset(pageId, {
            ...common,
            type: "line",
            points,
            stroke: parseColor(item.stroke || item.fill, "#111827"),
            fill: parseColor(item.fill, "#111827"),
            strokeWidth: Math.max(1, toNumber(item.strokeWidth, 4)),
          })
        );
        return;
      }

      if (type === "arrow") {
        const points = Array.isArray(item.points)
          ? item.points.map((point) => toNumber(point, 0))
          : [0, 0, common.width || 220, common.height || 0];
        elements.push(
          createElementFromAsset(pageId, {
            ...common,
            type: "arrow",
            points,
            stroke: parseColor(item.stroke || item.fill, "#111827"),
            fill: parseColor(item.fill, "#111827"),
            strokeWidth: Math.max(1, toNumber(item.strokeWidth, 4)),
          })
        );
        return;
      }

      if (type === "star") {
        elements.push(createElementFromAsset(pageId, { ...common, type: "star" }));
        return;
      }

      if (type === "rect" || type === "triangle" || type === "polygon") {
        elements.push(
          createElementFromAsset(pageId, {
            ...common,
            type: "rect",
            cornerRadius: Math.max(toNumber(item.rx, 0), toNumber(item.ry, 0)),
          })
        );
      }
    });
  }

  if (elements.length === 0 && template.thumbnailDataUrl) {
    elements.push(
      createElementFromAsset(pageId, {
        type: "image",
        name: "Template preview",
        src: template.thumbnailDataUrl,
        x: 0,
        y: 0,
        width,
        height,
      })
    );
  }

  if (elements.length === 0) return null;

  const parityElements = isCanvaTemplate
    ? dedupeSyntheticTextBackgroundLayers(elements, width, height)
    : elements;

  const sortedElements = parityElements
    .map((element, index) => ({
      element,
      index,
      zIndex: Number((element as EditorElement & { importZIndex?: unknown }).importZIndex),
    }))
    .sort((a, b) => {
      const aFinite = Number.isFinite(a.zIndex);
      const bFinite = Number.isFinite(b.zIndex);
      if (aFinite && bFinite && a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
      if (aFinite !== bFinite) return aFinite ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.element);

  if (isCanvaTemplate && sortedElements.length > 0) {
    const initialBackgroundIndex = sortedElements.findIndex((element) =>
      isBackgroundLayerElement(element, { width, height })
    );
    const backgroundIndex =
      initialBackgroundIndex >= 0
        ? initialBackgroundIndex
        : findLikelyBackgroundLayerIndex(sortedElements, width, height);
    if (backgroundIndex >= 0) {
      const [backgroundLayer] = sortedElements.splice(backgroundIndex, 1);
      if (backgroundLayer) {
        sortedElements.unshift({
          ...backgroundLayer,
          name: "Background",
          isBackgroundLayer: true,
        } as EditorElement);
      }
    }
  }

  const backgroundColor = parseColor(fabric?.backgroundColor, "#ffffff");
  // Derive the page/timeline duration from the imported elements' timeline windows. A sequenced
  // timeline/video design sets each element's timelineEndMs up to its real length (e.g. a 44s
  // wedding video), so the page stretches to fit instead of clamping to the flat 15s default.
  // Static designs leave every element at the default end, so this stays at DEFAULT_PAGE_DURATION_MS.
  const maxElementEndMs = sortedElements.reduce(
    (max, element) => Math.max(max, Number(element.timelineEndMs) || 0),
    0
  );
  const derivedPageDurationMs = Math.min(
    600000,
    Math.max(DEFAULT_PAGE_DURATION_MS, Math.round(maxElementEndMs))
  );
  const isTimelineImport = derivedPageDurationMs > DEFAULT_PAGE_DURATION_MS;

  // Multi-page imports: meta.import.pages lists the design's pages and every fabric object
  // carries an importPageIndex — partition the built elements back into editor pages.
  const importPagesMeta = (() => {
    const meta = (template.data as Record<string, unknown> | null | undefined) ?? null;
    const importMeta =
      meta && typeof meta === "object"
        ? ((meta as { meta?: { import?: { pages?: unknown } } }).meta?.import ?? null)
        : null;
    const pages = importMeta && typeof importMeta === "object" ? importMeta.pages : null;
    return Array.isArray(pages) && pages.length > 1 ? (pages as Array<Record<string, unknown>>) : null;
  })();

  const buildPage = (
    id: string,
    name: string,
    pageWidth: number,
    pageHeight: number,
    pageElements: EditorElement[]
  ): EditorDesign["pages"][number] => {
    const pageMaxEndMs = pageElements.reduce(
      (max, element) => Math.max(max, Number(element.timelineEndMs) || 0),
      0
    );
    return {
      id,
      name,
      width: pageWidth,
      height: pageHeight,
      durationMs: Math.min(600000, Math.max(DEFAULT_PAGE_DURATION_MS, Math.round(pageMaxEndMs))),
      background: {
        type: "color",
        color: backgroundColor,
        gradientFrom: backgroundColor,
        gradientTo: backgroundColor,
      },
      elements: pageElements.map((element) => ({ ...element, pageId: id })),
    };
  };

  let editorPages: EditorDesign["pages"];
  if (importPagesMeta) {
    const pageIndexByNodeId = new Map<string, number>();
    if (fabric) {
      fabric.objects.forEach((object) => {
        if (!object || typeof object !== "object") return;
        const item = object as Record<string, unknown>;
        const nodeId = String(item.importNodeId || item.id || "").trim();
        const rawIndex = Number(item.importPageIndex);
        if (nodeId && Number.isInteger(rawIndex) && rawIndex >= 0) {
          pageIndexByNodeId.set(nodeId, rawIndex);
        }
      });
    }
    const buckets: EditorElement[][] = importPagesMeta.map(() => []);
    sortedElements.forEach((element) => {
      const nodeId = String(element.importNodeId || "").trim();
      const bucketIndex = pageIndexByNodeId.get(nodeId) ?? 0;
      const bounded = bucketIndex >= 0 && bucketIndex < buckets.length ? bucketIndex : 0;
      buckets[bounded].push(element);
    });
    editorPages = importPagesMeta.map((pageMeta, index) =>
      buildPage(
        `template-page-${template.id}-${index + 1}`,
        String(pageMeta?.name || `Page ${index + 1}`),
        Math.max(16, Math.round(toNumber(pageMeta?.width, width))),
        Math.max(16, Math.round(toNumber(pageMeta?.height, height))),
        buckets[index]
      )
    );
  } else {
    editorPages = [buildPage(pageId, template.name || "Template", width, height, sortedElements)];
  }

  const totalDurationMs = editorPages.reduce(
    (total, page) => total + (Number(page.durationMs) || DEFAULT_PAGE_DURATION_MS),
    0
  );

  return {
    version: 2,
    activePageId: editorPages[0].id,
    timeline: {
      enabled: true,
      fps: 30,
      totalDurationMs,
      preview: {
        status: "not_requested",
        url: null,
        posterUrl: templateThumbnailSrc || null,
        generatedAt: null,
        error: null,
      },
      source: {
        origin: isCanvaTemplate ? "canva" : "manual",
        animatedImport: isTimelineImport,
      },
    },
    pages: editorPages,
  };
}

function layerTypeLabel(element: EditorElement) {
  if (element.type === "text") return "Text";
  if (element.type === "image") return "Image";
  if (element.type === "video") return "Video";
  if (element.type === "frame") return "Frame";
  if (element.type === "arrow") return "Arrow";
  if (element.type === "line") return "Line";
  if (element.type === "circle") return "Circle";
  if (element.type === "star") return "Star";
  return "Shape";
}

function isGenericLayerName(name: string) {
  const normalized = String(name || "").trim();
  if (!normalized) return true;
  return /^(image|video|text|shape|rectangle|rect|circle|line|arrow|star)\s+\d+$/i.test(normalized);
}

function layerDisplayName(layer: EditorElement, page: { width: number; height: number }) {
  if (isBackgroundLayerElement(layer, page)) return "Background";
  if (layer.type === "text") {
    const content = String(layer.text || "").replace(/\s+/g, " ").trim();
    if (content) return content;
  }
  if (!isGenericLayerName(layer.name)) {
    return layer.name;
  }
  if (layer.type === "image") return "Image";
  if (layer.type === "video") return "Video";
  return layerTypeLabel(layer);
}

// Subtle checkerboard so transparent shapes/images read as transparent in their thumbnail box
// (this editor's shapes and cut-outs are frequently transparent).
const LAYER_THUMB_CHECKER: CSSProperties = {
  backgroundColor: "#ffffff",
  backgroundImage:
    "linear-gradient(45deg,#e3e7ee 25%,transparent 25%),linear-gradient(-45deg,#e3e7ee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e3e7ee 75%),linear-gradient(-45deg,transparent 75%,#e3e7ee 75%)",
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0,0 4px,4px -4px,-4px 0",
};

/** True for near-white / very light colors, so a text preview can flip to a dark backdrop. */
function isLightColor(input: string) {
  let hex = String(input || "").trim().replace(/^#/, "").toLowerCase();
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/.test(hex)) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.8;
}

/** A small colored glyph standing in for a primitive shape layer (rect/circle/line/arrow/star). */
function ShapeGlyph({ type, fill, stroke }: { type: string; fill: string; stroke: string }) {
  const hasFill = fill && fill !== "none" && fill !== "transparent";
  const solid = hasFill ? fill : stroke && stroke !== "none" ? stroke : "#64748b";
  const line = stroke && stroke !== "none" ? stroke : hasFill ? fill : "#64748b";
  return (
    <svg width={24} height={24} viewBox="0 0 28 28" aria-hidden="true">
      {type === "rect" ? <rect x={4} y={7} width={20} height={14} rx={2.5} fill={solid} /> : null}
      {type === "circle" ? <circle cx={14} cy={14} r={9} fill={solid} /> : null}
      {type === "star" ? (
        <path
          d="M14 3l3.2 6.6 7.3 1.1-5.3 5.1 1.3 7.2L14 19.6 7.5 23l1.3-7.2-5.3-5.1 7.3-1.1z"
          fill={solid}
        />
      ) : null}
      {type === "line" ? (
        <line x1={5} y1={22} x2={23} y2={6} stroke={line} strokeWidth={3} strokeLinecap="round" />
      ) : null}
      {type === "arrow" ? (
        <path
          d="M5 22 L21 8 M21 8 h-7 M21 8 v7"
          fill="none"
          stroke={line}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}

/** Resolves the <img> source for an image layer's thumbnail, honoring an active shape recolor. */
function layerThumbnailImageSrc(layer: EditorElement) {
  const vector = String(layer.vectorSrc || "");
  const colorMap = layer.rasterColorMap;
  const hasActiveRecolor =
    Boolean(vector) &&
    colorMap != null &&
    typeof colorMap === "object" &&
    Object.entries(colorMap).some(
      ([key, value]) => String(key).trim().toLowerCase() !== String(value).trim().toLowerCase()
    );
  // A recolored shape: show the recolored (and crisp) vector so the thumbnail matches the canvas.
  // Otherwise the rasterized `src` is already trimmed to content and frames the box best.
  if (hasActiveRecolor) return recolorSvgSource(vector, layer.rasterPalette, colorMap);
  return String(layer.src || vector || "");
}

/** A compact visual preview of a layer, shown beside its name in the Layers panel. */
function LayerThumbnail({ layer }: { layer: EditorElement }) {
  const [failed, setFailed] = useState(false);
  // `src` for a video is the video file itself (won't render as an <img>), so videos fall through
  // to the icon below; image/frame layers do have a still we can show.
  const imageSrc =
    layer.type === "image"
      ? layerThumbnailImageSrc(layer)
      : layer.type === "frame"
        ? String(layer.frameContent?.posterSrc || layer.frameContent?.src || "")
        : "";

  const boxClass =
    "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#c4cad6]";

  if (imageSrc && !failed) {
    return (
      <div className={boxClass} style={LAYER_THUMB_CHECKER}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt=""
          draggable={false}
          loading="lazy"
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  if (layer.type === "text") {
    const content = String(layer.text || "").replace(/\s+/g, " ").trim() || "Aa";
    // Flip to a dark backdrop for near-white text so it stays visible in the thumbnail.
    const darkBackdrop = isLightColor(String(layer.color || ""));
    return (
      <div className={`${boxClass} px-0.5 ${darkBackdrop ? "bg-[#3a4457]" : "bg-white"}`}>
        <span
          className="overflow-hidden text-center leading-[1.05]"
          style={{
            color: String(layer.color || "#1f2a39"),
            fontFamily: resolveCssFontFamily(layer.fontFamily),
            fontStyle: layer.fontStyle === "italic" ? "italic" : "normal",
            fontWeight: String(layer.fontWeight || "600"),
            fontSize: "9px",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            wordBreak: "break-word",
          }}
        >
          {content.slice(0, 16)}
        </span>
      </div>
    );
  }

  if (
    layer.type === "rect" ||
    layer.type === "circle" ||
    layer.type === "line" ||
    layer.type === "arrow" ||
    layer.type === "star"
  ) {
    return (
      <div className={`${boxClass} bg-white`}>
        <ShapeGlyph type={layer.type} fill={String(layer.fill || "")} stroke={String(layer.stroke || "")} />
      </div>
    );
  }

  const FallbackIcon = layer.type === "video" ? VideoIcon : layer.type === "frame" ? Square : ImageIcon;
  return (
    <div className={`${boxClass} bg-white`}>
      <FallbackIcon size={16} className="text-[#8a93a6]" />
    </div>
  );
}

function assetPayload(payload: Record<string, unknown>) {
  return JSON.stringify(payload);
}

function framePreviewClipPath(preset: FramePreset) {
  if (preset.kind === "circle") return "circle(48% at 50% 50%)";
  if (preset.kind === "rect") {
    const radius = Math.max(0, Math.min(48, Number(preset.cornerRadius || 0)));
    return `inset(0 round ${radius}px)`;
  }
  if (Array.isArray(preset.points) && preset.points.length >= 6) {
    const pairs: string[] = [];
    for (let index = 0; index < preset.points.length; index += 2) {
      pairs.push(`${preset.points[index]}% ${preset.points[index + 1]}%`);
    }
    return `polygon(${pairs.join(", ")})`;
  }
  return "inset(0 round 18px)";
}

function sanitizeFontFamilyFromFileName(fileName: string) {
  const base = String(fileName || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalizeFontFamilyName(base);
}

function escapeCssText(value: string) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function containsArabicScript(value: unknown) {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

function normalizeFontCategories(value: unknown, fallbackSample = "") {
  const categories = Array.isArray(value)
    ? value
        .map((item) => String(item || "").trim().toUpperCase())
        .filter((item) => item === "EXCLUSIVE" || item === "ARABIC" || item === "ENGLISH")
    : [];

  if (!categories.includes("ARABIC") && !categories.includes("ENGLISH")) {
    categories.push(containsArabicScript(fallbackSample) ? "ARABIC" : "ENGLISH");
  }

  return Array.from(new Set(categories));
}

function resolveFontLanguageGroup(font: CustomFontRecord): "arabic" | "english" {
  const categories = normalizeFontCategories(font?.categories, font?.family || "");
  return categories.includes("ARABIC") ? "arabic" : "english";
}

function guessFontFormat(mimeType: string) {
  const value = String(mimeType || "").toLowerCase();
  if (value.includes("woff2")) return "woff2";
  if (value.includes("woff")) return "woff";
  if (value.includes("otf")) return "opentype";
  if (value.includes("ttf")) return "truetype";
  if (value.includes("ms-fontobject")) return "embedded-opentype";
  return "";
}

const FONT_PAGE_SIZE = 20;

async function ensureCustomFontFaceInDocument(
  font: CustomFontRecord,
  options?: { load?: boolean }
) {
  if (typeof document === "undefined") return;
  if (!font?.id || !font?.family) return;
  const sourceUrl = String(font.fileUrl || font.dataUrl || "").trim();
  const sourceType = String(font.source || "").trim().toLowerCase();
  if (!sourceUrl && sourceType !== "google") return;
  const styleId = `editor-custom-font-face-${font.id}`;

  const existingStyle = document.getElementById(styleId);
  const style =
    existingStyle instanceof HTMLStyleElement
      ? existingStyle
      : (() => {
          const nextStyle = document.createElement("style");
          nextStyle.id = styleId;
          document.head.appendChild(nextStyle);
          return nextStyle;
        })();

  // Prefer a self-hosted, same-origin @font-face — it is LAZY: the browser only
  // fetches the file when the font is actually rendered. Imported Google fonts are
  // re-hosted and expose a fileUrl, so only fall back to Google's EAGER CSS
  // @import for legacy google records that have no self-hosted file.
  if (sourceType === "google" && !sourceUrl) {
    const familyParam = encodeURIComponent(String(font.family || "").trim()).replace(/%20/g, "+");
    style.textContent = `@import url("https://fonts.googleapis.com/css2?family=${familyParam}:wght@400&display=swap");`;
  } else {
    const formatHint = guessFontFormat(font.mimeType);
    const srcValue = formatHint
      ? `url("${sourceUrl}") format("${formatHint}")`
      : `url("${sourceUrl}")`;
    style.textContent = `
@font-face {
  font-family: "${escapeCssText(font.family)}";
  src: ${srcValue};
  font-display: swap;
}`;
  }

  // Bulk preloads pass { load: false } to only DECLARE the face (cheap + lazy) so
  // opening the editor with a large library doesn't eagerly fetch ~2k font files.
  // Callers that need the font ready now (apply-to-text, visible previews) load it.
  if (options?.load === false) return;

  const fontsApi = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fontsApi || typeof fontsApi.load !== "function") return;
  try {
    await Promise.race([
      fontsApi.load(`400 16px "${escapeCssText(font.family)}"`, containsArabicScript(font.family) ? "ص" : "A"),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    // Font loading failures should not block editor interactions.
  }
}

interface SidePanelProps {
  collapsed: boolean;
}

export default function SidePanel({ collapsed }: SidePanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = useEditorStore((state) => state.sidebarTab);
  const pages = useEditorStore((state) => state.pages);
  const designTimeline = useEditorStore((state) => state.designTimeline);
  const setTimelinePlaying = useEditorStore((state) => state.setTimelinePlaying);
  const setTimelinePlayheadMs = useEditorStore((state) => state.setTimelinePlayheadMs);
  const activePageId = useEditorStore((state) => state.activePageId);
  const importedElementsRefreshKey = useEditorStore((state) => state.importedElementsRefreshKey);
  const activeTemplateId = useEditorStore((state) => state.activeTemplateId);
  const activeTemplateName = useEditorStore((state) => state.activeTemplateName);
  const activeTemplateStatus = useEditorStore((state) => state.activeTemplateStatus);
  const activeTemplateCategory = useEditorStore((state) => state.activeTemplateCategory);
  const activeTemplateSubCategory = useEditorStore((state) => state.activeTemplateSubCategory);
  const activeTemplateTags = useEditorStore((state) => state.activeTemplateTags);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const publishCandidateIds = useEditorStore((state) => state.publishCandidateIds);
  const resizeUseMagic = useEditorStore((state) => state.resizeUseMagic);

  const setSidebarTab = useEditorStore((state) => state.setSidebarTab);
  const setShowLeftSidebar = useEditorStore((state) => state.setShowLeftSidebar);
  const setResizeUseMagic = useEditorStore((state) => state.setResizeUseMagic);
  const setTemplateMeta = useEditorStore((state) => state.setTemplateMeta);

  const addTextElement = useEditorStore((state) => state.addTextElement);
  const addImageElement = useEditorStore((state) => state.addImageElement);
  const addVideoElement = useEditorStore((state) => state.addVideoElement);
  const addFrameElement = useEditorStore((state) => state.addFrameElement);
  const setFrameContent = useEditorStore((state) => state.setFrameContent);
  const loadDesign = useEditorStore((state) => state.loadDesign);
  const registerFontFamilies = useEditorStore((state) => state.registerFontFamilies);
  const setBackground = useEditorStore((state) => state.setBackground);
  const setPublishCandidateIds = useEditorStore((state) => state.setPublishCandidateIds);
  const setSelectedIds = useEditorStore((state) => state.setSelectedIds);
  const togglePublishCandidate = useEditorStore((state) => state.togglePublishCandidate);
  const toggleVisibility = useEditorStore((state) => state.toggleVisibility);
  const toggleLock = useEditorStore((state) => state.toggleLock);
  const reorderLayer = useEditorStore((state) => state.reorderLayer);
  const deleteElement = useEditorStore((state) => state.deleteElement);
  const resizeActivePage = useEditorStore((state) => state.resizeActivePage);
  const updateElement = useEditorStore((state) => state.updateElement);
  const updateSelectedElements = useEditorStore((state) => state.updateSelectedElements);
  const recordHistory = useEditorStore((state) => state.recordHistory);

  const [templateSearch, setTemplateSearch] = useState("");
  const [shapeSearch, setShapeSearch] = useState("");
  const [frameSearch, setFrameSearch] = useState("");
  const [elementSearch, setElementSearch] = useState("");
  const [elementsPanelTab, setElementsPanelTab] = useState<"published" | "queue">("published");
  const [importedElements, setImportedElements] = useState<ImportedElementRecord[]>([]);
  const [importedElementsLoading, setImportedElementsLoading] = useState(false);
  const [importedElementsError, setImportedElementsError] = useState("");
  const [deletingImportedElementId, setDeletingImportedElementId] = useState("");
  const [openImportedElementInfoId, setOpenImportedElementInfoId] = useState("");
  const [copiedImportedTagKey, setCopiedImportedTagKey] = useState("");
  const [importedElementsTotal, setImportedElementsTotal] = useState(0);
  const [importedElementsPage, setImportedElementsPage] = useState(1);
  const [importedElementsHasNextPage, setImportedElementsHasNextPage] = useState(false);
  const [importedElementsKindTab, setImportedElementsKindTab] = useState<"all" | "icon">("all");
  const [backgroundAssets, setBackgroundAssets] = useState<ImportedElementRecord[]>([]);
  const [backgroundAssetsLoading, setBackgroundAssetsLoading] = useState(false);
  const [backgroundAssetsError, setBackgroundAssetsError] = useState("");
  const [backgroundCategories, setBackgroundCategories] = useState<BackgroundCategoryRecord[]>([]);
  const [sameSizeOnly, setSameSizeOnly] = useState(false);
  const [dragLayerId, setDragLayerId] = useState("");
  const [dragOver, setDragOver] = useState<{ id: string; position: "before" | "after" }>({
    id: "",
    position: "before",
  });
  const [resizeWidth, setResizeWidth] = useState("1080");
  const [resizeHeight, setResizeHeight] = useState("1080");
  const [resizeUnits, setResizeUnits] = useState("px");
  const [storedTemplates, setStoredTemplates] = useState<StoredTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [recentBuiltInShapeIds, setRecentBuiltInShapeIds] = useState<string[]>([]);
  const [customFonts, setCustomFonts] = useState<CustomFontRecord[]>([]);
  const [customFontsLoading, setCustomFontsLoading] = useState(false);
  const [fontSearchQuery, setFontSearchQuery] = useState("");
  const [customFontFamilyInput, setCustomFontFamilyInput] = useState("");
  const [fontLanguageTab, setFontLanguageTab] = useState<"arabic" | "english">("arabic");
  const [visibleFontCount, setVisibleFontCount] = useState(FONT_PAGE_SIZE);
  const fontListSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadedFontPreviewIdsRef = useRef<Set<string>>(new Set());
  const [uploadingCustomFont, setUploadingCustomFont] = useState(false);
  const [deletingCustomFontId, setDeletingCustomFontId] = useState("");
  const [taxonomySettings, setTaxonomySettings] = useState<TaxonomyCategorySetting[]>([]);
  const [taxonomyLoading, setTaxonomyLoading] = useState(false);
  const templateQueryKey = useMemo(() => searchParams.toString(), [searchParams]);
  const templateIdFromQuery = useMemo(
    () => String(new URLSearchParams(templateQueryKey).get("templateId") || "").trim(),
    [templateQueryKey]
  );
  const templateUpdatedAtFromQuery = useMemo(
    () => String(new URLSearchParams(templateQueryKey).get("updatedAt") || "").trim(),
    [templateQueryKey]
  );
  const loadedTemplateSignatureRef = useRef("");

  const updateTemplateQueryInUrl = useCallback(
    (templateId: string, updatedAt = "") => {
      const params = new URLSearchParams(templateQueryKey);
      if (templateId) {
        params.set("templateId", templateId);
      } else {
        params.delete("templateId");
      }

      const safeUpdatedAt = String(updatedAt || "").trim();
      if (safeUpdatedAt) {
        params.set("updatedAt", safeUpdatedAt);
      } else {
        params.delete("updatedAt");
      }

      const nextQuery = params.toString();
      router.replace(nextQuery ? `/editor-pro?${nextQuery}` : "/editor-pro");
    },
    [router, templateQueryKey]
  );

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const videoUploadInputRef = useRef<HTMLInputElement | null>(null);
  const customFontInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundColorInputRef = useRef<HTMLInputElement | null>(null);
  const pendingBackgroundUploadCategoryValueRef = useRef("");
  const importedElementsScrollLockRef = useRef(false);
  const importedTagFeedbackTimeoutRef = useRef<number | null>(null);

  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) || pages[0],
    [activePageId, pages]
  );
  const publishableElements = useMemo(() => getPublishablePageElements(activePage), [activePage]);
  const publishCandidatesSet = useMemo(() => new Set(publishCandidateIds), [publishCandidateIds]);
  const normalizedElementSearch = elementSearch.trim().toLowerCase();
  const filteredPublishableElements = useMemo(() => {
    if (!normalizedElementSearch) return publishableElements;
    return publishableElements.filter((element) => {
      const haystacks = [
        String(element.name || ""),
        String(element.type || ""),
        String(element.titleEn || ""),
        String(element.titleAr || ""),
      ];
      return haystacks.some((value) => value.toLowerCase().includes(normalizedElementSearch));
    });
  }, [normalizedElementSearch, publishableElements]);
  const allVisiblePublishableSelected =
    filteredPublishableElements.length > 0 &&
    filteredPublishableElements.every((element) => publishCandidatesSet.has(element.id));
  const visibleToolTabs = TOOL_TABS;
  const elementSearchPlaceholder =
    elementsPanelTab === "published"
      ? "Search published elements..."
      : "Search elements to publish...";

  useEffect(() => {
    if (!activePage) return;
    setResizeWidth(String(Math.max(1, Math.round(activePage.width))));
    setResizeHeight(String(Math.max(1, Math.round(activePage.height))));
  }, [activePage]);

  useEffect(() => {
    if (activeTab !== "elements" || elementsPanelTab !== "published") return;
    setImportedElementsPage(1);
    setImportedElementsHasNextPage(false);
    importedElementsScrollLockRef.current = false;
    setOpenImportedElementInfoId("");
    setCopiedImportedTagKey("");
  }, [activeTab, elementSearch, elementsPanelTab, importedElementsKindTab, importedElementsRefreshKey]);

  useEffect(() => {
    return () => {
      if (importedTagFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(importedTagFeedbackTimeoutRef.current);
      }
    };
  }, []);

  const layers = useMemo(() => {
    if (!activePage) return [];
    return [...activePage.elements].reverse();
  }, [activePage]);
  const selectedElements = useMemo(
    () => activePage.elements.filter((element) => selectedIds.includes(element.id)),
    [activePage.elements, selectedIds]
  );
  const selectedFrameElement = useMemo(
    () => selectedElements.find((element) => element.type === "frame") || null,
    [selectedElements]
  );
  // Which of the three slots the animation panel is editing. Entrance/Exit play once at the
  // layer's start/end; Loop runs continuously in between. Each is independent.
  const [animationSlot, setAnimationSlot] = useState<AnimationCategory>("ENTRANCE");
  const animationSlotKey = ANIMATION_SLOT_KEY[animationSlot];

  /** The slot's spec for each selected element, migrating legacy fields when needed. */
  const selectedSlotSpecs = useMemo(
    () => selectedElements.map((element) => resolveElementAnimations(element)[animationSlotKey]),
    [selectedElements, animationSlotKey]
  );
  /** A value shared by the whole selection, or null when the selection disagrees ("Mixed"). */
  const sharedSlotValue = useCallback(
    <T,>(read: (spec: AnimationSpecInput | null) => T): T | null => {
      if (selectedSlotSpecs.length === 0) return null;
      const values = new Set(selectedSlotSpecs.map(read));
      return values.size === 1 ? (Array.from(values)[0] as T) : null;
    },
    [selectedSlotSpecs]
  );

  const selectedAnimationType = useMemo(
    () => sharedSlotValue((spec) => spec?.type ?? "NONE"),
    [sharedSlotValue]
  );
  const selectedAnimationInfinite = useMemo(
    () => sharedSlotValue((spec) => spec?.infinite ?? false),
    [sharedSlotValue]
  );
  // Only the Loop slot runs infinite, and only for types the spec marks supportsInfinite.
  const selectedAnimationCanLoop = useMemo(() => {
    if (!selectedAnimationType || selectedAnimationType === "NONE") return false;
    return animationSlot === "LOOP" && supportsInfinite(selectedAnimationType);
  }, [selectedAnimationType, animationSlot]);
  const selectedAnimationDurationMs = useMemo(
    () => sharedSlotValue((spec) => spec?.durationMs ?? null),
    [sharedSlotValue]
  );
  const selectedAnimationDelayMs = useMemo(
    () => sharedSlotValue((spec) => spec?.delayMs ?? 0),
    [sharedSlotValue]
  );
  const selectedAnimationDirection = useMemo(
    () => sharedSlotValue((spec) => spec?.direction ?? "DEFAULT"),
    [sharedSlotValue]
  );
  const selectedAnimationEasing = useMemo(
    () => sharedSlotValue((spec) => spec?.easing ?? "DEFAULT"),
    [sharedSlotValue]
  );
  const selectedAnimationIntensity = useMemo(
    () => sharedSlotValue((spec) => spec?.intensity ?? 1),
    [sharedSlotValue]
  );

  /**
   * Writes a patch into the ACTIVE slot of every selected element, leaving the other two slots
   * untouched. Legacy fields are migrated in first (via resolveElementAnimations) so an element
   * that only ever had the old single animation keeps it when you edit a different slot.
   */
  const updateAnimationSlot = useCallback(
    (patch: Partial<AnimationSpecInput> & { type?: string }) => {
      // Whether the whole template already had any animation BEFORE this change — used to detect
      // when this is the FIRST animation on the template, so the timeline preview can auto-play.
      const wasAnimated = hasAnimatedTemplateContent(pages, designTimeline);
      let appliedAnimation = false;
      selectedElements.forEach((element) => {
        const slots = resolveElementAnimations(element);
        const current = slots[animationSlotKey];
        const nextType = patch.type ?? current?.type ?? "NONE";
        if (nextType === "NONE") {
          updateElement(element.id, {
            animations: { ...slots, [animationSlotKey]: null },
          });
          return;
        }
        // Picking a NEW type resets the slot to that type's own defaults; tweaking a control
        // keeps the rest of the spec as-is.
        const base = current && current.type === nextType ? current : { type: nextType };
        updateElement(element.id, {
          animations: {
            ...slots,
            [animationSlotKey]: makeAnimationSpec({ ...base, ...patch, type: nextType }, animationSlot),
          },
        });
        appliedAnimation = true;
      });
      // Adding the first animation reveals the timeline preview (see hasAnimatedElementContent) —
      // start it playing from the top so the user immediately sees the effect they just picked.
      // Only on the not-animated → animated transition, so later edits don't hijack playback.
      if (appliedAnimation && !wasAnimated) {
        setTimelinePlayheadMs(0);
        setTimelinePlaying(true);
      }
    },
    [
      selectedElements,
      animationSlotKey,
      animationSlot,
      updateElement,
      pages,
      designTimeline,
      setTimelinePlayheadMs,
      setTimelinePlaying,
    ]
  );
  const primarySelectedElement = selectedElements.length === 1 ? selectedElements[0] : null;
  const [animationDurationDraft, setAnimationDurationDraft] = useState("");
  const activeBackgroundColor = String(activePage?.background?.color || "#ffffff").trim();
  const activeBackgroundImageUri = String(activePage?.background?.imageUri || "").trim();

  useEffect(() => {
    setAnimationDurationDraft(selectedAnimationDurationMs === null ? "" : String(selectedAnimationDurationMs));
  }, [selectedAnimationDurationMs]);

  const applyBackgroundColorSelection = useCallback(
    (nextColor: string) => {
      const isTransparent = String(nextColor || "").trim().toLowerCase() === "transparent";
      const normalizedColor = isTransparent
        ? "transparent"
        : String(nextColor || "#ffffff").trim() || "#ffffff";
      // Transparent always clears any image background and drops to a transparent color fill.
      if (!isTransparent && activePage?.background?.type === "image" && activeBackgroundImageUri) {
        setBackground({
          type: "image",
          color: normalizedColor,
        });
        return;
      }

      setBackground({
        type: "color",
        color: normalizedColor,
        imageUri: "",
        imageThumbnailUri: "",
        sourceAssetId: "",
        categoryValue: "",
      });
    },
    [activeBackgroundImageUri, activePage?.background?.type, setBackground]
  );
  const builtInShapeLookup = useMemo(
    () => new Map(BUILTIN_SHAPE_ASSETS.map((shape) => [shape.id, shape])),
    []
  );
  const shapeSearchQuery = shapeSearch.trim().toLowerCase();
  const visibleBackgroundCategories = useMemo(() => {
    const published = backgroundCategories.filter((item) => item?.published !== false && item?.value);
    return published.length > 0 ? published : backgroundCategories.filter((item) => item?.value);
  }, [backgroundCategories]);
  const defaultBackgroundUploadCategoryValue = useMemo(
    () => visibleBackgroundCategories[0]?.value || DEFAULT_BACKGROUND_CATEGORY,
    [visibleBackgroundCategories]
  );

  const categorizedBackgroundAssets = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; label: string; thumbnailUrl: string; items: ImportedElementRecord[]; order: number }
    >();
    visibleBackgroundCategories.forEach((category, index) => {
      const categoryValue = String(category.value || "").trim().toLowerCase();
      if (!categoryValue) return;
      groups.set(categoryValue, {
        key: categoryValue,
        label:
          String(category.labelEn || category.labelAr || categoryValue || "Backgrounds").trim() ||
          "Backgrounds",
        thumbnailUrl: String(category.thumbnailUrl || "").trim(),
        items: [],
        order: index,
      });
    });

    backgroundAssets.forEach((item) => {
      const rawCategoryValue = String(item.categoryValue || "").trim().toLowerCase();
      const categoryValue = rawCategoryValue || DEFAULT_BACKGROUND_CATEGORY;
      const matchedCategory =
        visibleBackgroundCategories.find((category) => category.value === categoryValue) || null;
      const groupKey = matchedCategory?.value || categoryValue;
      const existing = groups.get(groupKey);
      if (existing) {
        existing.items.push(item);
        return;
      }
      groups.set(groupKey, {
        key: groupKey,
        label:
          String(matchedCategory?.labelEn || matchedCategory?.labelAr || groupKey || "Backgrounds").trim() ||
          "Backgrounds",
        thumbnailUrl: String(matchedCategory?.thumbnailUrl || "").trim(),
        items: [item],
        order: Number.MAX_SAFE_INTEGER,
      });
    });

    return Array.from(groups.values()).sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return left.label.localeCompare(right.label);
    });
  }, [backgroundAssets, visibleBackgroundCategories]);

  const openImageUploadPicker = useCallback(
    (backgroundCategoryValue = "") => {
      pendingBackgroundUploadCategoryValueRef.current =
        activeTab === "backgrounds"
          ? String(backgroundCategoryValue || defaultBackgroundUploadCategoryValue || DEFAULT_BACKGROUND_CATEGORY)
              .trim()
              .toLowerCase()
          : "";
      uploadInputRef.current?.click();
    },
    [activeTab, defaultBackgroundUploadCategoryValue]
  );

  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    return storedTemplates.filter((template) => {
      const passesSearch = !query || String(template.name || "").toLowerCase().includes(query);
      const passesSize =
        !sameSizeOnly ||
        (Math.round(toNumber(template.canvasSize?.width, activePage.width)) === activePage.width &&
          Math.round(toNumber(template.canvasSize?.height, activePage.height)) === activePage.height);
      return passesSearch && passesSize;
    });
  }, [activePage.height, activePage.width, sameSizeOnly, storedTemplates, templateSearch]);

  const templateCategorySettings = useMemo<TaxonomyCategorySetting[]>(() => {
    const fromApi = taxonomySettings.filter((item) => item && item.value);
    const publishedFromApi = fromApi
      .filter((item) => item.published !== false)
      .map((item) => ({
        ...item,
        subCategories: (Array.isArray(item.subCategories) ? item.subCategories : []).filter(
          (subCategory) => subCategory.published !== false
        ),
      }))
      .filter((item) => item.subCategories.length > 0);
    if (publishedFromApi.length > 0) return publishedFromApi;
    if (fromApi.length > 0) return fromApi;
    return TEMPLATE_CATEGORY_SETTINGS as TaxonomyCategorySetting[];
  }, [taxonomySettings]);

  const activeCategoryValue = useMemo(() => {
    const fallback = templateCategorySettings[0]?.value || "general";
    const normalized = String(activeTemplateCategory || "").trim().toLowerCase();
    return (
      templateCategorySettings.find((item) => item.value === normalized)?.value || fallback
    );
  }, [activeTemplateCategory, templateCategorySettings]);

  const activeCategoryConfig = useMemo(() => {
    return (
      templateCategorySettings.find((item) => item.value === activeCategoryValue) ||
      templateCategorySettings[0] ||
      null
    );
  }, [activeCategoryValue, templateCategorySettings]);

  const activeSubCategoryOptions = useMemo(
    () => (Array.isArray(activeCategoryConfig?.subCategories) ? activeCategoryConfig.subCategories : []),
    [activeCategoryConfig]
  );

  const activeSubCategoryValue = useMemo(() => {
    const fallback = activeSubCategoryOptions[0]?.value || "general";
    const normalized = String(activeTemplateSubCategory || "").trim().toLowerCase();
    return (
      activeSubCategoryOptions.find((item) => item.value === normalized)?.value || fallback
    );
  }, [activeSubCategoryOptions, activeTemplateSubCategory]);

  const customFontFamilies = useMemo(
    () => normalizeFontFamilyList(customFonts.map((font) => font.family)),
    [customFonts]
  );

  const customFontDisplayByFamily = useMemo(() => {
    const map = new Map<string, string>();
    customFonts.forEach((font) => {
      const key = normalizeFontFamilyName(font.family).toLowerCase();
      if (!key) return;
      map.set(key, deriveReadableFontLabel(font));
    });
    return map;
  }, [customFonts]);

  const groupedCustomFonts = useMemo(() => {
    const groups: { arabic: CustomFontRecord[]; english: CustomFontRecord[] } = {
      arabic: [],
      english: [],
    };

    customFonts.forEach((font) => {
      const target = resolveFontLanguageGroup(font);
      groups[target].push(font);
    });

    const sortByLabel = (left: CustomFontRecord, right: CustomFontRecord) =>
      deriveReadableFontLabel(left).localeCompare(deriveReadableFontLabel(right), undefined, {
        sensitivity: "base",
        numeric: true,
      });

    groups.arabic.sort(sortByLabel);
    groups.english.sort(sortByLabel);
    return groups;
  }, [customFonts]);

  const filteredGroupedCustomFonts = useMemo(() => {
    const query = fontSearchQuery.trim().toLowerCase();
    if (!query) return groupedCustomFonts;

    const matchesFont = (font: CustomFontRecord) => {
      const display = deriveReadableFontLabel(font);
      const source = String(font.source || "custom");
      const categories = Array.isArray(font.categories) ? font.categories.join(" ") : "";
      const haystack = [font.family, display, source, categories].join(" ").toLowerCase();
      return haystack.includes(query);
    };

    return {
      arabic: groupedCustomFonts.arabic.filter(matchesFont),
      english: groupedCustomFonts.english.filter(matchesFont),
    };
  }, [fontSearchQuery, groupedCustomFonts]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(RECENT_BUILTIN_SHAPES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      setRecentBuiltInShapeIds(
        parsed
          .map((value) => String(value || "").trim())
          .filter((value) => Boolean(value) && builtInShapeLookup.has(value))
          .slice(0, 12)
      );
    } catch {
      // Ignore corrupted recent-shape storage.
    }
  }, [builtInShapeLookup]);

  const rememberBuiltInShape = useCallback((shapeId: string) => {
    const normalized = String(shapeId || "").trim();
    if (!normalized) return;
    setRecentBuiltInShapeIds((current) => {
      const next = [normalized, ...current.filter((item) => item !== normalized)].slice(0, 12);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            RECENT_BUILTIN_SHAPES_STORAGE_KEY,
            JSON.stringify(next)
          );
        } catch {
          // Ignore storage write failures.
        }
      }
      return next;
    });
  }, []);

  const createBuiltInShapePayload = useCallback(
    (shape: BuiltInShapeAsset) => {
      const aspectRatio = Math.max(0.1, shape.width / Math.max(1, shape.height));
      const isLineLike = shape.category === "lines";
      const isPortraitFrame =
        aspectRatio <= 0.6 &&
        (shape.id.includes("frame") ||
          shape.keywords.some((keyword) => {
            const normalized = String(keyword || "").toLowerCase();
            return normalized === "frame" || normalized === "border" || normalized === "portrait";
          }));
      let width = isLineLike
        ? Math.min(activePage.width * 0.42, 320)
        : isPortraitFrame
          ? Math.min(activePage.width * 0.44, 420)
          : Math.min(activePage.width * 0.24, 220);
      let height = width / aspectRatio;
      const maxHeight = isLineLike
        ? Math.min(activePage.height * 0.12, 96)
        : isPortraitFrame
          ? Math.min(activePage.height * 0.68, 980)
          : Math.min(activePage.height * 0.24, 220);
      if (height > maxHeight) {
        height = maxHeight;
        width = height * aspectRatio;
      }
      return {
        type: "image" as const,
        src: shape.src,
        name: shape.name,
        width: Math.max(48, Math.round(width)),
        height: Math.max(24, Math.round(height)),
        sourceWidth: shape.width,
        sourceHeight: shape.height,
      };
    },
    [activePage.height, activePage.width]
  );

  const addBuiltInShapeToCanvas = useCallback(
    async (shape: BuiltInShapeAsset) => {
      let resolvedSrc = shape.src;
      let rasterScale = 1;
      try {
        resolvedSrc = await rasterizeSvgDataUrlToPngDataUrl(shape.src, {
          scale: SVG_SHAPE_RASTER_SCALE,
        });
        rasterScale = SVG_SHAPE_RASTER_SCALE;
      } catch {
        // Keep the original source (unscaled SVG) if rasterization fails.
      }

      const payload = {
        ...createBuiltInShapePayload(shape),
        src: resolvedSrc,
        rasterOriginalSrc: resolvedSrc,
        // Preserve the original vector so it can ship to mobile as a crisp SVG (see mapImageLayer /
        // assetKind:"vector"); `src` stays the rasterized PNG for sharp on-canvas display here.
        vectorSrc: shape.src,
        // Match the source pixel dimensions to the baked resolution so crop/alpha
        // math uses the real raster size (the placed width/height are unchanged).
        sourceWidth: shape.width * rasterScale,
        sourceHeight: shape.height * rasterScale,
      };
      const elementId = addImageElement(resolvedSrc, payload);
      rememberBuiltInShape(shape.id);
      if (!elementId) return;

      try {
        const state = useEditorStore.getState();
        const page =
          state.pages.find((item) => item.id === state.activePageId) || state.pages[0];
        const element = page?.elements.find((item) => item.id === elementId);
        if (!element || element.type !== "image") return;
        const trimmed = await computeTrimTransparentPaddingPatch(element as EditorElement & { type: "image" });
        if (!trimmed.supported || !trimmed.patch) return;
        // vectorSrc stays the raw shape SVG; the canvas derives a crisp, content-cropped,
        // high-resolution vector from it + the layer crop at render time (see CanvasImageNode).
        updateElement(elementId, trimmed.patch, { recordHistory: false });
      } catch {
        // Built-in shape insertion should still succeed even if trim fails.
      }
    },
    [
      addImageElement,
      createBuiltInShapePayload,
      rememberBuiltInShape,
      updateElement,
    ]
  );

  const builtInShapeSections = useMemo(() => {
    const matchesQuery = (shape: BuiltInShapeAsset) => {
      if (!shapeSearchQuery) return true;
      const haystack = [shape.name, shape.category, ...shape.keywords].join(" ").toLowerCase();
      return haystack.includes(shapeSearchQuery);
    };

    const sections: Array<{ id: string; label: string; items: BuiltInShapeAsset[] }> = [];
    if (!shapeSearchQuery) {
      const recentItems = recentBuiltInShapeIds
        .map((shapeId) => builtInShapeLookup.get(shapeId) || null)
        .filter((item): item is BuiltInShapeAsset => Boolean(item));
      if (recentItems.length > 0) {
        sections.push({
          id: "recent",
          label: "Recently used",
          items: recentItems,
        });
      }
    }

    BUILTIN_SHAPE_CATEGORIES.forEach((category) => {
      const items = BUILTIN_SHAPE_ASSETS.filter(
        (shape) => shape.category === category.id && matchesQuery(shape)
      );
      if (items.length === 0) return;
      sections.push({
        id: category.id,
        label: category.label,
        items,
      });
    });

    return sections;
  }, [builtInShapeLookup, recentBuiltInShapeIds, shapeSearchQuery]);

  const filteredFramePresets = useMemo(() => {
    const query = frameSearch.trim().toLowerCase();
    if (!query) return FRAME_PRESETS;
    return FRAME_PRESETS.filter((preset) =>
      [preset.name, preset.kind, ...preset.keywords].join(" ").toLowerCase().includes(query)
    );
  }, [frameSearch]);

  const addFramePresetToCanvas = useCallback(
    (preset: FramePreset) => {
      addFrameElement(preset.id);
    },
    [addFrameElement]
  );

  const customFontLanguageByFamily = useMemo(() => {
    const map = new Map<string, "arabic" | "english">();
    customFonts.forEach((font) => {
      const key = normalizeFontFamilyName(font.family).toLowerCase();
      if (!key) return;
      map.set(key, resolveFontLanguageGroup(font));
    });
    return map;
  }, [customFonts]);

  const selectedTextFontFamily = useMemo(() => {
    if (!activePage || selectedIds.length === 0) return "";
    const selectedTextElement = activePage.elements.find(
      (element) => selectedIds.includes(element.id) && element.type === "text"
    );
    return normalizeFontFamilyName(selectedTextElement?.fontFamily || "");
  }, [activePage, selectedIds]);

  const selectedTextLayerIds = useMemo(() => {
    if (!activePage || selectedIds.length === 0) return [];
    const selectedSet = new Set(selectedIds);
    return activePage.elements
      .filter((element) => selectedSet.has(element.id) && element.type === "text")
      .map((element) => element.id);
  }, [activePage, selectedIds]);

  const selectedTextFontDisplay = useMemo(() => {
    if (!selectedTextFontFamily) return "";
    return (
      customFontDisplayByFamily.get(selectedTextFontFamily.toLowerCase()) || selectedTextFontFamily
    );
  }, [customFontDisplayByFamily, selectedTextFontFamily]);

  useEffect(() => {
    if (!selectedTextFontFamily) return;
    const familyKey = selectedTextFontFamily.toLowerCase();
    const tab = customFontLanguageByFamily.get(familyKey);
    if (!tab) return;
    setFontLanguageTab(tab);
  }, [customFontLanguageByFamily, selectedTextFontFamily]);

  useEffect(() => {
    if (
      fontLanguageTab === "arabic" &&
      filteredGroupedCustomFonts.arabic.length === 0 &&
      filteredGroupedCustomFonts.english.length > 0
    ) {
      setFontLanguageTab("english");
      return;
    }
    if (
      fontLanguageTab === "english" &&
      filteredGroupedCustomFonts.english.length === 0 &&
      filteredGroupedCustomFonts.arabic.length > 0
    ) {
      setFontLanguageTab("arabic");
    }
  }, [
    filteredGroupedCustomFonts.arabic.length,
    filteredGroupedCustomFonts.english.length,
    fontLanguageTab,
  ]);

  const onUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      pendingBackgroundUploadCategoryValueRef.current = "";
      return;
    }

    const targetBackgroundCategoryValue =
      activeTab === "backgrounds"
        ? String(
            pendingBackgroundUploadCategoryValueRef.current ||
              defaultBackgroundUploadCategoryValue ||
              DEFAULT_BACKGROUND_CATEGORY
          )
            .trim()
            .toLowerCase()
        : "";

    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const uploaded = await uploadEditorMediaFile(file, "image");
        const imageDimensions = await readImageFileDimensions(file);
        const baseTitle = file.name.replace(/\.[^.]+$/, "") || "Image Upload";

        if (activeTab !== "backgrounds" && selectedFrameElement) {
          setFrameContent(
            selectedFrameElement.id,
            {
              kind: "image",
              src: uploaded.url,
              sourceWidth: imageDimensions.width || undefined,
              sourceHeight: imageDimensions.height || undefined,
            },
            { recordHistory: true }
          );
        } else if (activeTab !== "backgrounds") {
          addImageElement(uploaded.url, {
            name: baseTitle || "upload",
            width: Math.min(780, activePage.width * 0.65),
            height: Math.min(780, activePage.height * 0.48),
            rasterOriginalSrc: uploaded.url,
          });
        }

        const importedResponse = await fetch(
          activeTab === "backgrounds"
            ? "/api/editor/backgrounds/imported"
            : "/api/editor/elements/imported",
          {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            source: activeTab === "backgrounds" ? "background-upload" : "upload",
            sourceAssetId: uploaded.path || uploaded.url,
            kind: "image",
            title: baseTitle,
            titleEn: baseTitle,
            titleAr: baseTitle,
            categoryValue: activeTab === "backgrounds" ? targetBackgroundCategoryValue : "",
            assetUrl: uploaded.url,
            thumbnailUrl: uploaded.url,
            width: imageDimensions.width,
            height: imageDimensions.height,
            freeSvg: false,
            sourcePayload: {
              mimeType: uploaded.mimeType || file.type || "image/png",
              fileName: uploaded.fileName || file.name || "",
              uploadedPath: uploaded.path || "",
            },
          }),
          }
        ).catch(() => null);
        if ((activeTab === "elements" || activeTab === "backgrounds") && importedResponse?.ok) {
          const importedPayload = await importedResponse.json().catch(() => null);
          if (importedPayload?.id && importedPayload?.assetUrl) {
            const normalizedItem: ImportedElementRecord = {
              id: String(importedPayload.id || ""),
              source: String(importedPayload.source || (activeTab === "backgrounds" ? "background-upload" : "upload")).trim().toLowerCase(),
              sourceAssetId: String(importedPayload.sourceAssetId || uploaded.path || uploaded.url),
              categoryValue: String(importedPayload.categoryValue || targetBackgroundCategoryValue || "").trim().toLowerCase(),
              kind:
                importedPayload?.kind === "icon" ||
                importedPayload?.kind === "vector" ||
                importedPayload?.kind === "image"
                  ? importedPayload.kind
                  : "image",
              title: String(
                importedPayload.title ||
                  importedPayload.titleEn ||
                  importedPayload.titleAr ||
                  file.name.replace(/\.[^.]+$/, "") ||
                  "Image Upload"
              ),
              titleEn: String(importedPayload.titleEn || importedPayload.title || ""),
              titleAr: String(importedPayload.titleAr || importedPayload.title || ""),
              tags: Array.isArray(importedPayload.tags)
                ? importedPayload.tags.map((value: unknown) => String(value || "")).filter(Boolean)
                : [],
              tagsEn: Array.isArray(importedPayload.tagsEn)
                ? importedPayload.tagsEn.map((value: unknown) => String(value || "")).filter(Boolean)
                : [],
              tagsAr: Array.isArray(importedPayload.tagsAr)
                ? importedPayload.tagsAr.map((value: unknown) => String(value || "")).filter(Boolean)
                : [],
              labels: Array.isArray(importedPayload.labels)
                ? importedPayload.labels.map((value: unknown) => String(value || "")).filter(Boolean)
                : [],
              labelsEn: Array.isArray(importedPayload.labelsEn)
                ? importedPayload.labelsEn.map((value: unknown) => String(value || "")).filter(Boolean)
                : [],
              labelsAr: Array.isArray(importedPayload.labelsAr)
                ? importedPayload.labelsAr.map((value: unknown) => String(value || "")).filter(Boolean)
                : [],
              assetUrl: String(importedPayload.assetUrl || uploaded.url),
              thumbnailUrl: String(importedPayload.thumbnailUrl || importedPayload.assetUrl || uploaded.url),
              animatedVideoUrl: String(importedPayload.animatedVideoUrl || ""),
              width: Number.isFinite(Number(importedPayload.width))
                ? Number(importedPayload.width)
                : imageDimensions.width,
              height: Number.isFinite(Number(importedPayload.height))
                ? Number(importedPayload.height)
                : imageDimensions.height,
              freeSvg: Boolean(importedPayload.freeSvg ?? false),
              sourcePayload:
                importedPayload?.sourcePayload &&
                typeof importedPayload.sourcePayload === "object" &&
                !Array.isArray(importedPayload.sourcePayload)
                  ? importedPayload.sourcePayload
                  : {},
            };
            if (activeTab === "backgrounds") {
              setBackgroundAssets((current) => {
                const deduped = new Map<string, ImportedElementRecord>();
                deduped.set(normalizedItem.id, normalizedItem);
                current.forEach((item) => {
                  if (!deduped.has(item.id)) deduped.set(item.id, item);
                });
                return Array.from(deduped.values());
              });
            } else {
              setImportedElements((current) => {
                const deduped = new Map<string, ImportedElementRecord>();
                deduped.set(normalizedItem.id, normalizedItem);
                current.forEach((item) => {
                  if (!deduped.has(item.id)) deduped.set(item.id, item);
                });
                return Array.from(deduped.values());
              });
              setImportedElementsTotal((current) => current + 1);
            }
          }
        }
      } catch (_error) {
      }
    }

    pendingBackgroundUploadCategoryValueRef.current = "";
  };

  const onUploadVideos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith("video/")) continue;
      try {
        const uploaded = await uploadEditorMediaFile(file, "video");
        if (selectedFrameElement) {
          setFrameContent(
            selectedFrameElement.id,
            {
              kind: "video",
              src: uploaded.url,
            },
            { recordHistory: true }
          );
          continue;
        }
        addVideoElement(uploaded.url, {
          name: file.name.replace(/\.[^.]+$/, "") || "Video",
          width: Math.min(960, activePage.width * 0.7),
          height: Math.min(540, activePage.height * 0.5),
        });
      } catch (_error) {
      }
    }
  };

  const onUploadMediaFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      pendingBackgroundUploadCategoryValueRef.current = "";
      return;
    }

    await onUploadFiles(files);
    await onUploadVideos(files);
  };

  const handleLayerDrop = (targetId: string, position: "before" | "after") => {
    if (!dragLayerId || dragLayerId === targetId) {
      setDragLayerId("");
      setDragOver({ id: "", position: "before" });
      return;
    }
    const sourceLayer = layers.find((layer) => layer.id === dragLayerId);
    const targetLayer = layers.find((layer) => layer.id === targetId);
    if (!sourceLayer || !targetLayer) {
      setDragLayerId("");
      setDragOver({ id: "", position: "before" });
      return;
    }
    const mappedPosition = position === "before" ? "after" : "before";
    reorderLayer(dragLayerId, targetId, mappedPosition);
    setDragLayerId("");
    setDragOver({ id: "", position: "before" });
  };

  const handleLayerSelect = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, layerId: string) => {
      const additiveSelectionPressed = event.shiftKey || event.ctrlKey || event.metaKey;
      if (additiveSelectionPressed) {
        if (selectedIds.includes(layerId)) {
          setSelectedIds(selectedIds.filter((item) => item !== layerId));
        } else {
          setSelectedIds([...selectedIds, layerId]);
        }
        return;
      }
      if (selectedIds.length === 1 && selectedIds[0] === layerId) return;
      setSelectedIds([layerId]);
    },
    [selectedIds, setSelectedIds]
  );

  const handleImportedElementsScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      if (importedElementsLoading || !importedElementsHasNextPage) return;
      if (importedElementsScrollLockRef.current) return;
      const target = event.currentTarget;
      const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 40;
      if (!nearBottom) return;
      importedElementsScrollLockRef.current = true;
      setImportedElementsPage((current) => current + 1);
    },
    [importedElementsHasNextPage, importedElementsLoading]
  );

  const applyFontToSelectedTextLayers = (
    familyName: string,
    targetIdsOverride?: string[],
    options?: { recordHistory?: boolean }
  ) => {
    const normalizedFamily = normalizeFontFamilyName(familyName);
    if (!normalizedFamily) return;
    const shouldRecordHistory = options?.recordHistory !== false;
    const targetIds = Array.isArray(targetIdsOverride)
      ? targetIdsOverride.filter(Boolean)
      : selectedTextLayerIds;
    if (targetIds.length === 0) {
      const hasAnyTextLayer = layers.some((element) => element.type === "text");
      if (!hasAnyTextLayer) {
        addTextElement("Text", {
          name: "Text",
          fontFamily: normalizedFamily,
        });
        registerFontFamilies([normalizedFamily]);
      }
      return;
    }
    targetIds.forEach((id) => {
      updateElement(
        id,
        { fontFamily: normalizedFamily },
        { recordHistory: false }
      );
    });
    registerFontFamilies([normalizedFamily]);
    if (shouldRecordHistory) {
      recordHistory();
    }
  };

  useEffect(() => {
    if (activeTab !== "templates") return;

    let cancelled = false;
    const load = async () => {
      setTemplatesLoading(true);
      setTemplatesError("");

      try {
        const response = await fetch("/api/templates", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load templates.");
        }
        if (cancelled) return;
        const templates = Array.isArray(payload?.templates) ? (payload.templates as StoredTemplate[]) : [];
        setStoredTemplates(templates);
      } catch (error: unknown) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Failed to load templates.";
        setTemplatesError(message);
      } finally {
        if (cancelled) return;
        setTemplatesLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "elements" || elementsPanelTab !== "published") return;

    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setImportedElementsLoading(true);
      if (importedElementsPage <= 1) {
        setImportedElementsError("");
      }
      try {
        const params = new URLSearchParams({
          source: "all",
          kind: importedElementsKindTab,
          query: elementSearch.trim(),
          page: String(importedElementsPage),
          pageSize: "40",
        });
        const response = await fetch(`/api/editor/elements/imported?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load imported elements.");
        }
        if (cancelled) return;
        const items = Array.isArray(payload?.items) ? (payload.items as ImportedElementRecord[]) : [];
        const normalizedItems = items
          .map((item) => ({
            id: String(item?.id || ""),
            source: String(item?.source || "freepik").trim().toLowerCase(),
            sourceAssetId: String(item?.sourceAssetId || ""),
            kind:
              item?.kind === "icon" || item?.kind === "vector" || item?.kind === "image"
                ? item.kind
                : "icon",
            title: String(item?.title || item?.titleEn || item?.titleAr || ""),
            titleEn: String(item?.titleEn || ""),
            titleAr: String(item?.titleAr || ""),
            tags: Array.isArray(item?.tags) ? item.tags.map((value) => String(value || "")).filter(Boolean) : [],
            tagsEn: Array.isArray(item?.tagsEn) ? item.tagsEn.map((value) => String(value || "")).filter(Boolean) : [],
            tagsAr: Array.isArray(item?.tagsAr) ? item.tagsAr.map((value) => String(value || "")).filter(Boolean) : [],
            labels: Array.isArray(item?.labels) ? item.labels.map((value) => String(value || "")).filter(Boolean) : [],
            labelsEn: Array.isArray(item?.labelsEn)
              ? item.labelsEn.map((value) => String(value || "")).filter(Boolean)
              : [],
            labelsAr: Array.isArray(item?.labelsAr)
              ? item.labelsAr.map((value) => String(value || "")).filter(Boolean)
              : [],
            assetUrl: String(item?.assetUrl || ""),
            thumbnailUrl: String(item?.thumbnailUrl || item?.assetUrl || ""),
            animatedVideoUrl: String(item?.animatedVideoUrl || ""),
            width: Number.isFinite(Number(item?.width)) ? Number(item.width) : null,
            height: Number.isFinite(Number(item?.height)) ? Number(item.height) : null,
            freeSvg: Boolean(item?.freeSvg),
            sourcePayload:
              item?.sourcePayload && typeof item.sourcePayload === "object" && !Array.isArray(item.sourcePayload)
                ? item.sourcePayload
                : {},
          }))
          .filter((item) => item.id && item.assetUrl && !BACKGROUND_LIBRARY_SOURCES.has(item.source));
        setImportedElements((current) => {
          if (importedElementsPage <= 1) {
            return normalizedItems;
          }
          const deduped = new Map(current.map((item) => [item.id, item]));
          normalizedItems.forEach((item) => deduped.set(item.id, item));
          return Array.from(deduped.values());
        });
        setImportedElementsTotal(Math.max(0, Number(payload?.total || 0)));
        setImportedElementsHasNextPage(Boolean(payload?.hasNextPage));
      } catch (error: unknown) {
        if (cancelled) return;
        if (error instanceof Error && error.name === "AbortError") return;
        const message = error instanceof Error ? error.message : "Failed to load imported elements.";
        setImportedElementsError(message);
        if (importedElementsPage <= 1) {
          setImportedElements([]);
          setImportedElementsTotal(0);
          setImportedElementsHasNextPage(false);
        }
      } finally {
        if (!cancelled) {
          setImportedElementsLoading(false);
          importedElementsScrollLockRef.current = false;
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    activeTab,
    elementSearch,
    elementsPanelTab,
    importedElementsKindTab,
    importedElementsPage,
    importedElementsRefreshKey,
  ]);

  useEffect(() => {
    if (activeTab !== "backgrounds") return;

    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setBackgroundAssetsLoading(true);
      setBackgroundAssetsError("");

      try {
        const [categoriesResponse, backgroundsResponse] = await Promise.all([
          fetch("/api/settings/background-categories", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch(
            `/api/editor/backgrounds/imported?${new URLSearchParams({
              source: "all",
              page: "1",
              pageSize: "120",
              lang: "en",
            }).toString()}`,
            {
              cache: "no-store",
              signal: controller.signal,
            }
          ),
        ]);

        const categoriesPayload = await categoriesResponse.json().catch(() => ({}));
        if (!categoriesResponse.ok) {
          throw new Error(categoriesPayload?.error || "Failed to load background categories.");
        }

        const backgroundsPayload = await backgroundsResponse.json().catch(() => ({}));
        if (!backgroundsResponse.ok) {
          throw new Error(backgroundsPayload?.error || "Failed to load imported backgrounds.");
        }

        if (cancelled) return;

        const nextCategories = Array.isArray(categoriesPayload?.settings)
          ? (categoriesPayload.settings as BackgroundCategoryRecord[])
          : [];
        const items = Array.isArray(backgroundsPayload?.items)
          ? (backgroundsPayload.items as ImportedElementRecord[])
          : [];
        const normalizedItems = items
          .map((item) => ({
            id: String(item?.id || ""),
            source: String(item?.source || "freepik-background"),
            sourceAssetId: String(item?.sourceAssetId || ""),
            categoryValue: String(item?.categoryValue || "").trim().toLowerCase(),
            kind:
              item?.kind === "icon" || item?.kind === "vector" || item?.kind === "image"
                ? item.kind
                : "image",
            title: String(item?.title || item?.titleEn || item?.titleAr || ""),
            titleEn: String(item?.titleEn || ""),
            titleAr: String(item?.titleAr || ""),
            tags: Array.isArray(item?.tags) ? item.tags.map((value) => String(value || "")).filter(Boolean) : [],
            tagsEn: Array.isArray(item?.tagsEn) ? item.tagsEn.map((value) => String(value || "")).filter(Boolean) : [],
            tagsAr: Array.isArray(item?.tagsAr) ? item.tagsAr.map((value) => String(value || "")).filter(Boolean) : [],
            labels: Array.isArray(item?.labels) ? item.labels.map((value) => String(value || "")).filter(Boolean) : [],
            labelsEn: Array.isArray(item?.labelsEn)
              ? item.labelsEn.map((value) => String(value || "")).filter(Boolean)
              : [],
            labelsAr: Array.isArray(item?.labelsAr)
              ? item.labelsAr.map((value) => String(value || "")).filter(Boolean)
              : [],
            assetUrl: String(item?.assetUrl || ""),
            thumbnailUrl: String(item?.thumbnailUrl || item?.assetUrl || ""),
            animatedVideoUrl: String(item?.animatedVideoUrl || ""),
            width: Number.isFinite(Number(item?.width)) ? Number(item.width) : null,
            height: Number.isFinite(Number(item?.height)) ? Number(item.height) : null,
            freeSvg: Boolean(item?.freeSvg),
            sourcePayload:
              item?.sourcePayload && typeof item.sourcePayload === "object" && !Array.isArray(item.sourcePayload)
                ? item.sourcePayload
                : {},
          }))
          .filter((item) => item.id && item.assetUrl);

        setBackgroundCategories(nextCategories);
        setBackgroundAssets(normalizedItems);
      } catch (error: unknown) {
        if (cancelled) return;
        if (error instanceof Error && error.name === "AbortError") return;
        setBackgroundAssets([]);
        setBackgroundCategories([]);
        setBackgroundAssetsError(
          error instanceof Error ? error.message : "Failed to load background assets."
        );
      } finally {
        if (!cancelled) {
          setBackgroundAssetsLoading(false);
        }
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [activeTab, importedElementsRefreshKey]);

  const handleDeleteImportedElement = useCallback(
    async (elementId: string) => {
      const id = String(elementId || "").trim();
      if (!id || deletingImportedElementId === id) return;

      setDeletingImportedElementId(id);
      try {
        const response = await fetch("/api/editor/elements/imported", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to delete imported element.");
        }

        let removedFromElements = false;
        setImportedElements((current) => {
          removedFromElements = current.some((item) => item.id === id);
          return current.filter((item) => item.id !== id);
        });
        if (removedFromElements) {
          setImportedElementsTotal((current) => Math.max(0, current - 1));
        }
        setBackgroundAssets((current) => current.filter((item) => item.id !== id));
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Failed to delete imported element.";
        setImportedElementsError(message);
        setBackgroundAssetsError(message);
      } finally {
        setDeletingImportedElementId((current) => (current === id ? "" : current));
      }
    },
    [deletingImportedElementId]
  );

  const handleDeleteBackgroundAsset = useCallback(
    async (backgroundId: string) => {
      const id = String(backgroundId || "").trim();
      if (!id || deletingImportedElementId === id) return;

      setDeletingImportedElementId(id);
      try {
        const response = await fetch("/api/editor/backgrounds/imported", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to delete imported background.");
        }

        setBackgroundAssets((current) => current.filter((item) => item.id !== id));
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Failed to delete imported background.";
        setBackgroundAssetsError(message);
      } finally {
        setDeletingImportedElementId((current) => (current === id ? "" : current));
      }
    },
    [deletingImportedElementId]
  );

  const handleCopyImportedTag = useCallback(async (itemId: string, tag: string) => {
    const safeItemId = String(itemId || "").trim();
    const safeTag = String(tag || "").trim();
    if (!safeItemId || !safeTag) return;
    try {
      await navigator.clipboard.writeText(safeTag);
      const feedbackKey = `${safeItemId}:${safeTag}`;
      setCopiedImportedTagKey(feedbackKey);
      if (importedTagFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(importedTagFeedbackTimeoutRef.current);
      }
      importedTagFeedbackTimeoutRef.current = window.setTimeout(() => {
        setCopiedImportedTagKey((current) => (current === feedbackKey ? "" : current));
        importedTagFeedbackTimeoutRef.current = null;
      }, 1400);
    } catch (_error) {
      window.alert("Unable to copy the tag.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadTaxonomy = async () => {
      setTaxonomyLoading(true);
      try {
        const response = await fetch("/api/settings/template-taxonomy", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load categories.");
        }
        if (cancelled) return;
        const settings = Array.isArray(payload?.settings)
          ? (payload.settings as TaxonomyCategorySetting[])
          : [];
        setTaxonomySettings(settings);
      } catch {
        if (cancelled) return;
      } finally {
        if (cancelled) return;
        setTaxonomyLoading(false);
      }
    };

    void loadTaxonomy();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadCustomFonts = async () => {
      setCustomFontsLoading(true);
      try {
        const response = await fetch("/api/editor/fonts", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load custom fonts.");
        }
        if (cancelled) return;
        const fonts = Array.isArray(payload?.fonts) ? (payload.fonts as CustomFontRecord[]) : [];
        setCustomFonts(fonts);
        fonts.forEach((font) => void ensureCustomFontFaceInDocument(font, { load: false }));
        registerFontFamilies(fonts.map((font) => font.family));
      } catch {
        if (cancelled) return;
      } finally {
        if (cancelled) return;
        setCustomFontsLoading(false);
      }
    };

    void loadCustomFonts();
    return () => {
      cancelled = true;
    };
  }, [registerFontFamilies]);

  const handleTemplateSelect = useCallback((
    template: StoredTemplate,
    options?: { requestedTemplateId?: string; requestedUpdatedAt?: string }
  ) => {
    const design = toEditorDesignFromTemplate(template, activePage.width, activePage.height);
    if (!design) {
      window.alert("Template has unsupported data format.");
      return;
    }
    const usedFonts = extractImportUsedFonts(template.data);
    const designFonts = collectDesignTextFonts(design);
    registerFontFamilies([...usedFonts, ...designFonts]);
    const missingUsedFonts = usedFonts.filter(
      (family) =>
        !customFontFamilies.some((customFamily) => customFamily.toLowerCase() === family.toLowerCase())
    );
    if (missingUsedFonts.length > 0) {
      void (async () => {
        try {
          const response = await fetch("/api/editor/fonts", { cache: "no-store" });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) return;
          const fonts = Array.isArray(payload?.fonts) ? (payload.fonts as CustomFontRecord[]) : [];
          setCustomFonts(fonts);
          fonts.forEach((font) => void ensureCustomFontFaceInDocument(font, { load: false }));
          registerFontFamilies(fonts.map((font) => font.family));
        } catch (_error) {
          // Keep template import resilient; user can refresh fonts from My fonts.
        }
      })();
    }
    loadDesign(design);
    setTemplateMeta({
      id: String(template.id || ""),
      name: String(template.name || ""),
      status: template.status === "published" ? "published" : "draft",
      category: String(template.category || "general"),
      subCategory: String(template.subCategory || "general"),
      tags: Array.isArray(template.tags) ? template.tags : [],
    });
    loadedTemplateSignatureRef.current = buildTemplateLoadSignature(
      String(options?.requestedTemplateId || template.id || ""),
      String(options?.requestedUpdatedAt || template.updatedAt || "")
    );
  }, [
    activePage.height,
    activePage.width,
    customFontFamilies,
    loadDesign,
    registerFontFamilies,
    setTemplateMeta,
  ]);

  useEffect(() => {
    if (!activeTemplateCategory || activeTemplateCategory !== activeCategoryValue) {
      setTemplateMeta({ category: activeCategoryValue });
    }
  }, [activeCategoryValue, activeTemplateCategory, setTemplateMeta]);

  useEffect(() => {
    const normalizedActiveSubCategory = String(activeTemplateSubCategory || "")
      .trim()
      .toLowerCase();
    const isValidSubCategory = activeSubCategoryOptions.some(
      (item) => item.value === normalizedActiveSubCategory
    );
    if (!isValidSubCategory) {
      setTemplateMeta({
        subCategory: activeSubCategoryOptions[0]?.value || "general",
      });
    }
  }, [activeSubCategoryOptions, activeTemplateSubCategory, setTemplateMeta]);

  useEffect(() => {
    if (!templateIdFromQuery) return;
    const requestedSignature = buildTemplateLoadSignature(
      templateIdFromQuery,
      templateUpdatedAtFromQuery
    );
    if (loadedTemplateSignatureRef.current === requestedSignature) return;

    let cancelled = false;
    const controller = new AbortController();
    setTemplatesError("");
    const loadRequestedTemplate = async () => {
      try {
        const response = await fetch(`/api/templates/${encodeURIComponent(templateIdFromQuery)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load template.");
        }

        if (cancelled) return;
        const template = payload?.template as StoredTemplate | undefined;
        if (!template) {
          throw new Error("Template not found.");
        }

        const currentParams = new URLSearchParams(window.location.search || "");
        const currentSignature = buildTemplateLoadSignature(
          String(currentParams.get("templateId") || "").trim(),
          String(currentParams.get("updatedAt") || "").trim()
        );
        if (currentSignature !== requestedSignature) return;

        handleTemplateSelect(template, {
          requestedTemplateId: templateIdFromQuery,
          requestedUpdatedAt: templateUpdatedAtFromQuery,
        });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        const message =
          error instanceof Error ? error.message : "Failed to load template.";
        setTemplatesError(message);
      }
    };

    void loadRequestedTemplate();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [handleTemplateSelect, templateIdFromQuery, templateUpdatedAtFromQuery]);

  const handleCustomFontUpload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    setUploadingCustomFont(true);
    try {
      const preferredFamily = normalizeFontFamilyName(customFontFamilyInput);
      const fallbackFamily = sanitizeFontFamilyFromFileName(file.name);
      const family = preferredFamily || fallbackFamily;
      if (!family) {
        throw new Error("Enter a font family name that matches Canva.");
      }
      const uploaded = await uploadEditorMediaFile(file, "font");

      const response = await fetch("/api/editor/fonts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family,
          fileName: file.name,
          mimeType: uploaded.mimeType || file.type,
          fileUrl: uploaded.url,
          storageBucket: uploaded.bucket,
          storagePath: uploaded.path,
          sizeBytes: uploaded.size || file.size,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to upload custom font.");
      }

      const fonts = Array.isArray(payload?.fonts) ? (payload.fonts as CustomFontRecord[]) : [];
      const savedFont = payload?.font as CustomFontRecord | null;
      setCustomFonts(fonts);
      if (savedFont) {
        void ensureCustomFontFaceInDocument(savedFont);
      } else {
        fonts.forEach((font) => void ensureCustomFontFaceInDocument(font, { load: false }));
      }
      registerFontFamilies(fonts.map((font) => font.family));
      setCustomFontFamilyInput(family);
    } catch {
    } finally {
      setUploadingCustomFont(false);
      if (customFontInputRef.current) {
        customFontInputRef.current.value = "";
      }
    }
  };

  const handleDeleteCustomFont = async (font: CustomFontRecord) => {
    if (!font?.id) return;
    setDeletingCustomFontId(font.id);
    try {
      const response = await fetch("/api/editor/fonts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: font.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete custom font.");
      }
      const fonts = Array.isArray(payload?.fonts) ? (payload.fonts as CustomFontRecord[]) : [];
      setCustomFonts(fonts);
      if (typeof document !== "undefined") {
        const styleId = `editor-custom-font-face-${font.id}`;
        document.getElementById(styleId)?.remove();
      }
    } catch {
    } finally {
      setDeletingCustomFontId("");
    }
  };

  const activeFontList =
    fontLanguageTab === "arabic"
      ? filteredGroupedCustomFonts.arabic
      : filteredGroupedCustomFonts.english;

  // Reset the visible window when the tab or search changes.
  useEffect(() => {
    setVisibleFontCount(FONT_PAGE_SIZE);
  }, [fontLanguageTab, fontSearchQuery]);

  // Grow the window by one page when the sentinel scrolls into view (infinite
  // scroll). Re-running on visibleFontCount re-checks intersection, so it keeps
  // filling until the sentinel is pushed out of the viewport.
  useEffect(() => {
    const sentinel = fontListSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleFontCount((count) => count + FONT_PAGE_SIZE);
        }
      },
      { rootMargin: "240px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleFontCount, activeFontList]);

  // Load faces for the fonts currently visible in the panel (crisp previews),
  // once each — bulk preloading only declares faces lazily.
  useEffect(() => {
    activeFontList.slice(0, visibleFontCount).forEach((font) => {
      if (!font?.id || loadedFontPreviewIdsRef.current.has(font.id)) return;
      loadedFontPreviewIdsRef.current.add(font.id);
      void ensureCustomFontFaceInDocument(font);
    });
  }, [activeFontList, visibleFontCount]);

  const renderFontCard = (font: CustomFontRecord) => {
    const fontDisplay = deriveReadableFontLabel(font);
    const fontSource = String(font.source || "custom").trim().toLowerCase();
    const removable = font.removable !== false && fontSource === "custom";
    const isSelected =
      Boolean(selectedTextFontFamily) &&
      font.family.toLowerCase() === selectedTextFontFamily.toLowerCase();

    return (
      <div
        key={font.id}
        className={`w-full rounded-md border bg-white p-2 ${isSelected ? "border-[#2c68be]" : "border-[#d3d8e1]"}`}
      >
        <button
          type="button"
          className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-left text-sm font-medium text-[#0f172a]"
          style={{ fontFamily: resolveCssFontFamily(font.family) }}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            const targetTextIds = [...selectedTextLayerIds];
            applyFontToSelectedTextLayers(font.family, targetTextIds, {
              recordHistory: true,
            });
            void ensureCustomFontFaceInDocument(font).then(() => {
              applyFontToSelectedTextLayers(font.family, targetTextIds, {
                recordHistory: false,
              });
            });
          }}
          title={font.family}
        >
          {fontDisplay}
        </button>
        <div className="mt-2 flex min-w-0 items-center justify-end gap-2 text-[11px] text-[#64748b]">
          <div className="flex shrink-0 items-center gap-2">
            {fontSource !== "custom" ? (
              <span className="rounded-full bg-[#eef2f7] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#4b5563]">
                {fontSource}
              </span>
            ) : null}
            {isSelected ? (
              <span className="rounded-full bg-[#e7f0ff] px-2 py-0.5 text-[10px] font-semibold text-[#2c68be]">
                Selected
              </span>
            ) : null}
            {removable ? (
              <Button
                type="button"
                variant="destructive"
                className="!h-7 !px-2 !text-[11px]"
                onClick={() => void handleDeleteCustomFont(font)}
                disabled={deletingCustomFontId === font.id}
              >
                {deletingCustomFontId === font.id ? "Removing..." : "Remove"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <aside
      className={`relative flex min-h-0 shrink-0 border-r border-[#d7dbe1] bg-[#f3f4f6] transition-[width] duration-300 ease-out ${
        collapsed ? "w-[70px]" : "w-[376px]"
      }`}
    >
      <div className="flex w-[68px] shrink-0 flex-col items-center border-r border-[#d7dbe1] bg-white py-2">
        {visibleToolTabs.map((tab) => {
          const Icon = tab.icon;
          const active = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                if (active && !collapsed) {
                  setShowLeftSidebar(false);
                  return;
                }
                setSidebarTab(tab.key);
                if (collapsed) {
                  setShowLeftSidebar(true);
                }
              }}
              className={`mb-1 flex w-full flex-col items-center gap-1 py-2.5 text-[11px] transition ${
                active ? "bg-[#dce9fb] text-[#0f172a]" : "text-[#1f2937] hover:bg-[#eef3fa]"
              }`}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-label="Expand panel"
        title="Expand panel"
        onClick={() => setShowLeftSidebar(true)}
        className={`absolute left-[65px] top-1/2 z-10 flex h-8 w-6 -translate-y-1/2 items-center justify-center rounded-r-full border border-l-0 border-[#d7dbe1] bg-[#f5f6f8] text-[#8c95a3] shadow-sm transition-opacity duration-150 ${
          collapsed ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <ChevronRight size={14} />
      </button>

      <div
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-visible bg-[#f5f6f8] transition-[opacity,transform] duration-200 ${
          collapsed ? "pointer-events-none translate-x-2 opacity-0" : "translate-x-0 opacity-100"
        }`}
        aria-hidden={collapsed}
      >
        <button
          type="button"
          aria-label="Collapse panel"
          onClick={() => setShowLeftSidebar(false)}
          className={`absolute -right-3 top-1/2 z-10 flex h-8 w-6 -translate-y-1/2 items-center justify-center rounded-r-full border border-l-0 border-[#d7dbe1] bg-[#f5f6f8] text-[#8c95a3] transition-opacity duration-150 ${
            collapsed ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <ChevronLeft size={14} />
        </button>

        <div
          className={`flex-1 overflow-x-hidden overflow-y-auto p-2 transition-opacity duration-150 ${
            collapsed ? "opacity-0" : "opacity-100"
          }`}
        >
          <input
            ref={uploadInputRef}
            type="file"
            accept={activeTab === "upload" ? "image/*,video/*" : "image/*"}
            multiple
            className="hidden"
            onChange={(event) => {
              void (activeTab === "upload"
                ? onUploadMediaFiles(event.target.files)
                : onUploadFiles(event.target.files));
              event.currentTarget.value = "";
            }}
          />

          {activeTab === "templates" ? (
              <section className="space-y-3">
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-[#798293]" />
                  <Input className="!h-9 !rounded-full !bg-white !pl-9" placeholder="Search..." value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} />
                </div>

                <label className="flex items-center justify-between text-[14px] text-[#202a38]">
                  <span>Show templates with the same size</span>
                  <button
                    type="button"
                    onClick={() => setSameSizeOnly((value) => !value)}
                    className={`relative h-5 w-8 rounded-full transition ${sameSizeOnly ? "bg-[#2f6fca]" : "bg-[#c8ced8]"}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${sameSizeOnly ? "left-3.5" : "left-0.5"}`} />
                  </button>
                </label>

                {templatesLoading ? (
                  <div className="rounded-md border border-[#d3d8e1] bg-white p-3 text-xs text-[#5a6679]">
                    Loading templates...
                  </div>
                ) : null}

                {templatesError ? (
                  <div className="rounded-md border border-[#f1c7c7] bg-[#fff3f3] p-3 text-xs text-[#8b2f2f]">
                    {templatesError}
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  {filteredTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => {
                        setTemplatesError("");
                        updateTemplateQueryInUrl(template.id, String(template.updatedAt || ""));
                      }}
                      className="overflow-hidden rounded-md border border-[#d3d8e1] bg-white text-left shadow-sm hover:border-[#9fb4d6]"
                    >
                      <div className="relative h-24 bg-[#eef1f6]">
                        {template.thumbnailDataUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={template.thumbnailDataUrl} alt={template.name} className="h-full w-full object-cover" />
                        ) : null}
                        <div
                          className="absolute bottom-1 left-1 right-1 rounded bg-black/40 px-1 py-0.5 text-[10px] font-medium text-white"
                          title={template.name}
                        >
                          <span className="block truncate whitespace-nowrap">
                            {template.name}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {!templatesLoading && !templatesError && filteredTemplates.length === 0 ? (
                  <div className="rounded-md border border-[#d3d8e1] bg-white p-3 text-xs text-[#5a6679]">
                    No templates found.
                  </div>
                ) : null}
              </section>
            ) : null}

            {activeTab === "text" ? (
              <section className="min-w-0 w-full space-y-3">
                <div className="border-b border-[#d7dbe1] pb-2 text-sm font-semibold text-[#2c68be]">
                  My fonts
                </div>

                <div className="min-w-0 w-full space-y-3">
                  <input
                    ref={customFontInputRef}
                    type="file"
                    accept={FONT_UPLOAD_ACCEPT}
                    className="hidden"
                    onChange={(event) => void handleCustomFontUpload(event.target.files)}
                  />
                  <Input
                    placeholder="Search fonts..."
                    value={fontSearchQuery}
                    onChange={(event) => setFontSearchQuery(event.target.value)}
                  />
                  <Input
                    placeholder="Font family (match Canva name)"
                    value={customFontFamilyInput}
                    onChange={(event) => setCustomFontFamilyInput(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="!h-9 !w-full !justify-center !rounded-md"
                    onClick={() => customFontInputRef.current?.click()}
                    disabled={uploadingCustomFont}
                  >
                    {uploadingCustomFont ? "Uploading..." : "Upload font file"}
                  </Button>

                  <div className="rounded-md border border-[#d3d8e1] bg-white p-2 text-xs text-[#334155]">
                    {selectedTextFontFamily ? (
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="shrink-0 text-[#64748b]">Selected text font</span>
                        <span
                          className="min-w-0 truncate text-sm font-semibold text-[#0f172a]"
                          style={{ fontFamily: resolveCssFontFamily(selectedTextFontFamily) }}
                          title={selectedTextFontFamily}
                        >
                          {selectedTextFontDisplay}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[#64748b]">Select a text layer to view its current font.</span>
                    )}
                  </div>

                  {customFontsLoading ? (
                    <div className="rounded-md border border-[#d3d8e1] bg-white p-2 text-xs text-[#64748b]">
                      Loading custom fonts...
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-1 rounded-md border border-[#d3d8e1] bg-white p-1">
                      <button
                        type="button"
                        className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                          fontLanguageTab === "arabic"
                            ? "bg-[#dce9fb] text-[#0f172a]"
                            : "text-[#64748b] hover:bg-[#eef3fa]"
                        }`}
                        onClick={() => setFontLanguageTab("arabic")}
                      >
                        Arabic ({filteredGroupedCustomFonts.arabic.length})
                      </button>
                      <button
                        type="button"
                        className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                          fontLanguageTab === "english"
                            ? "bg-[#dce9fb] text-[#0f172a]"
                            : "text-[#64748b] hover:bg-[#eef3fa]"
                        }`}
                        onClick={() => setFontLanguageTab("english")}
                      >
                        English ({filteredGroupedCustomFonts.english.length})
                      </button>
                    </div>
                    <div className="space-y-2">
                      {activeFontList.slice(0, visibleFontCount).map(renderFontCard)}
                      {visibleFontCount < activeFontList.length ? (
                        <div ref={fontListSentinelRef} className="h-4 w-full" aria-hidden="true" />
                      ) : null}
                    </div>
                  </div>

                  {!customFontsLoading && customFonts.length === 0 ? (
                    <div className="rounded-md border border-[#d3d8e1] bg-white p-2 text-xs text-[#64748b]">
                      No fonts available.
                    </div>
                  ) : !customFontsLoading &&
                    (fontLanguageTab === "arabic"
                      ? filteredGroupedCustomFonts.arabic.length === 0
                      : filteredGroupedCustomFonts.english.length === 0) ? (
                    <div className="rounded-md border border-[#d3d8e1] bg-white p-2 text-xs text-[#64748b]">
                      {fontSearchQuery.trim()
                        ? `No matching ${fontLanguageTab} fonts for "${fontSearchQuery.trim()}".`
                        : `No ${fontLanguageTab} fonts available.`}
                    </div>
                  ) : null}

                </div>
              </section>
            ) : null}

            {activeTab === "videos" ? (
              <section className="space-y-3">
                <div className="text-base font-semibold text-[#1f2a39]">Upload videos</div>
                <input
                  ref={videoUploadInputRef}
                  type="file"
                  accept="video/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void onUploadVideos(event.target.files);
                    if (event.currentTarget) {
                      event.currentTarget.value = "";
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="!h-9 !w-full !justify-center !rounded-md"
                  onClick={() => videoUploadInputRef.current?.click()}
                >
                  + Upload video
                </Button>

                <div className="rounded-md border border-[#d3d8e1] bg-white p-2 text-xs text-[#64748b]">
                  Uploaded videos are added as editable video layers. External video libraries are disabled.
                </div>

                <div className="space-y-2">
                  {activePage.elements
                    .filter((element) => element.type === "video")
                    .slice()
                    .reverse()
                    .map((videoLayer) => (
                      <button
                        key={videoLayer.id}
                        type="button"
                        onClick={() => setSelectedIds([videoLayer.id])}
                        className={`w-full rounded-md border bg-white p-2 text-left text-sm ${
                          selectedIds.includes(videoLayer.id) ? "border-[#2c68be]" : "border-[#d3d8e1]"
                        }`}
                      >
                        <div className="truncate font-medium text-[#0f172a]">
                          {layerDisplayName(videoLayer, activePage)}
                        </div>
                        <div className="mt-1 text-xs text-[#64748b]">
                          {Math.max(1, Math.round(videoLayer.width))}x{Math.max(1, Math.round(videoLayer.height))} px
                        </div>
                      </button>
                    ))}
                </div>

                {activePage.elements.every((element) => element.type !== "video") ? (
                  <div className="rounded-md border border-[#d3d8e1] bg-white p-2 text-xs text-[#64748b]">
                    No video layers yet.
                  </div>
                ) : null}
              </section>
            ) : null}

            {activeTab === "shapes" ? (
              <section className="flex h-full min-h-0 flex-col gap-3">
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-[#798293]" />
                  <Input
                    className="!h-9 !rounded-full !bg-white !pl-9"
                    placeholder="Search built-in shapes..."
                    value={shapeSearch}
                    onChange={(event) => setShapeSearch(event.target.value)}
                  />
                </div>

                <div className="flex min-h-0 flex-1 flex-col rounded-md border border-[#d3d8e1] bg-white p-2">
                  <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                    {builtInShapeSections.length > 0 ? (
                      <div className="space-y-4">
                        {builtInShapeSections.map((section) => (
                          <div key={section.id} className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#64748b]">
                                {section.label}
                              </div>
                              <div className="text-[10px] text-[#94a3b8]">
                                {section.items.length} shape{section.items.length === 1 ? "" : "s"}
                              </div>
                            </div>

                            <div className="flex gap-2 overflow-x-auto pb-1">
                              {section.items.map((shape) => {
                                const payload = createBuiltInShapePayload(shape);
                                return (
                                  <button
                                    key={shape.id}
                                    type="button"
                                    draggable
                                    onDragStart={(event) => {
                                      event.dataTransfer.effectAllowed = "copy";
                                      event.dataTransfer.setData(
                                        "application/x-editor-asset",
                                        assetPayload({
                                          payload,
                                        })
                                      );
                                    }}
                                    onClick={() => void addBuiltInShapeToCanvas(shape)}
                                    className="flex w-[92px] shrink-0 flex-col gap-2 rounded-xl border border-[#d3d8e1] bg-[#f8fafc] p-2 text-left transition hover:border-[#9fb4d6] hover:bg-[#eef3fa]"
                                    title={shape.name}
                                  >
                                    <div className="flex h-16 items-center justify-center rounded-lg bg-white p-2">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={shape.src}
                                        alt={shape.name}
                                        className="h-full w-full object-contain"
                                      />
                                    </div>
                                    <div className="line-clamp-2 text-[11px] font-semibold leading-4 text-[#1f2a39]">
                                      {shape.name}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-[#d3d8e1] bg-[#f8fafc] p-3 text-xs text-[#64748b]">
                        No built-in shapes match this search.
                      </div>
                    )}
                  </div>
                </div>
              </section>
            ) : null}

            {activeTab === "elements" ? (
              <section className="flex h-full min-h-0 flex-col gap-3">
                <div className="grid grid-cols-2 gap-1 rounded-md border border-[#d3d8e1] bg-white p-1">
                  {[
                    { key: "published", label: `All published (${importedElementsTotal})` },
                    { key: "queue", label: `Need to publish (${publishableElements.length})` },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                        elementsPanelTab === item.key
                          ? "bg-[#dce9fb] text-[#0f172a]"
                          : "text-[#64748b] hover:bg-[#eef3fa]"
                      }`}
                      onClick={() => setElementsPanelTab(item.key as "published" | "queue")}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-[#798293]" />
                  <Input
                    className="!h-9 !rounded-full !bg-white !pl-9"
                    placeholder={elementSearchPlaceholder}
                    value={elementSearch}
                    onChange={(event) => setElementSearch(event.target.value)}
                  />
                </div>

                <div className="flex min-h-0 flex-1 flex-col rounded-md border border-[#d3d8e1] bg-white p-2">
                  <div
                    className="min-h-0 flex-1 overflow-y-auto pr-1"
                    onScroll={elementsPanelTab === "published" ? handleImportedElementsScroll : undefined}
                  >
                    {elementsPanelTab === "published" ? (
                      <>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-[#202a38]">
                            Imported ({importedElementsTotal})
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              aria-label="Upload image"
                              title="Upload image"
                              onClick={() => openImageUploadPicker()}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#d3d8e1] bg-white text-[#4b5565] transition hover:bg-[#eef3fa]"
                            >
                              <Upload size={14} />
                            </button>
                            <div className="inline-flex rounded-full border border-[#d3d8e1] bg-[#f2f4f7] p-0.5 text-[11px]">
                              {[
                                { key: "all", label: "All" },
                                { key: "icon", label: "Icons" },
                              ].map((item) => (
                                <button
                                  key={item.key}
                                  type="button"
                                  className={`rounded-full px-2 py-0.5 ${
                                    importedElementsKindTab === item.key
                                      ? "bg-white font-semibold text-[#1f2a39]"
                                      : "text-[#637087]"
                                  }`}
                                  onClick={() =>
                                    setImportedElementsKindTab(item.key as "all" | "icon")
                                  }
                                >
                                  {item.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {importedElements.length > 0 ? (
                          <div className="grid grid-cols-2 gap-2">
                            {importedElements.map((item) => {
                              const isGifAsset = isGifSource(item.assetUrl);
                              const videoSource = deriveFreepikAnimatedVideoUrl(item);
                              const addAsVideo = !isGifAsset && isVideoSource(videoSource);
                              const deletingImported = deletingImportedElementId === item.id;
                              const showingInfo = openImportedElementInfoId === item.id;
                              const searchableTagsEn = Array.from(
                                new Set(
                                  [
                                    ...(Array.isArray(item.tagsEn) ? item.tagsEn : []),
                                    ...(Array.isArray(item.labelsEn) ? item.labelsEn : []),
                                    ...(!Array.isArray(item.tagsEn) || item.tagsEn.length === 0 ? item.tags : []),
                                    ...(!Array.isArray(item.labelsEn) || item.labelsEn.length === 0 ? item.labels : []),
                                  ]
                                    .map((value) => String(value || "").trim())
                                    .filter(Boolean)
                                )
                              ).slice(0, 24);
                              const searchableTagsAr = Array.from(
                                new Set(
                                  [
                                    ...(Array.isArray(item.tagsAr) ? item.tagsAr : []),
                                    ...(Array.isArray(item.labelsAr) ? item.labelsAr : []),
                                  ]
                                    .map((value) => String(value || "").trim())
                                    .filter(Boolean)
                                )
                              ).slice(0, 24);
                              const importedSourcePayload =
                                item.sourcePayload && typeof item.sourcePayload === "object"
                                  ? item.sourcePayload
                                  : {};
                              const importedRasterOriginalSrc = String(
                                importedSourcePayload.rasterOriginalSrc || item.assetUrl || ""
                              ).trim();
                              const importedRasterPalette = Array.isArray(importedSourcePayload.rasterPalette)
                                ? importedSourcePayload.rasterPalette
                                    .map((value) => String(value || "").trim())
                                    .filter(Boolean)
                                : [];
                              const importedRasterPaletteVersion = Number.isFinite(
                                Number(importedSourcePayload.rasterPaletteVersion)
                              )
                                ? Number(importedSourcePayload.rasterPaletteVersion)
                                : 0;
                              const importedRasterColorMap =
                                importedSourcePayload.rasterColorMap &&
                                typeof importedSourcePayload.rasterColorMap === "object" &&
                                !Array.isArray(importedSourcePayload.rasterColorMap)
                                  ? importedSourcePayload.rasterColorMap
                                  : {};
                              const importedImagePayload = {
                                type: "image",
                                src: item.assetUrl,
                                name: item.title || "Imported Icon",
                                rasterOriginalSrc: importedRasterOriginalSrc || item.assetUrl,
                                rasterPalette: importedRasterPalette,
                                rasterPaletteVersion: importedRasterPaletteVersion,
                                rasterColorMap: importedRasterColorMap as Record<string, string>,
                              } as const;
                              const addImportedElementToCanvas = () => {
                                if (selectedFrameElement) {
                                  setFrameContent(
                                    selectedFrameElement.id,
                                    addAsVideo
                                      ? {
                                          kind: "video",
                                          src: videoSource,
                                        }
                                      : {
                                          kind: "image",
                                          src: item.assetUrl,
                                        },
                                    { recordHistory: true }
                                  );
                                  return;
                                }
                                if (addAsVideo) {
                                  addVideoElement(videoSource, {
                                    name: item.title || "Imported Icon",
                                  });
                                  return;
                                }
                                addImageElement(item.assetUrl, importedImagePayload);
                              };

                              return (
                                <div
                                  key={item.id}
                                  role="button"
                                  tabIndex={0}
                                  draggable
                                  onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = "copy";
                                    const payload = addAsVideo
                                      ? assetPayload({
                                          kind: "video",
                                          src: videoSource,
                                        })
                                      : assetPayload({
                                            payload: importedImagePayload,
                                          });
                                    event.dataTransfer.setData(
                                      "application/x-editor-asset",
                                      payload
                                    );
                                  }}
                                  onClick={addImportedElementToCanvas}
                                  onKeyDown={(event) => {
                                    if (event.key !== "Enter" && event.key !== " ") return;
                                    event.preventDefault();
                                    addImportedElementToCanvas();
                                  }}
                                  className="rounded-md border border-[#d3d8e1] bg-[#f3f4f6] p-2 text-left hover:bg-[#eef2f7] focus:outline-none focus:ring-2 focus:ring-[#2c68be]/40"
                                >
                                  <div className="relative rounded-md bg-[#eef1f5] p-1">
                                    <span
                                      title="Show search tags"
                                      aria-label="Show search tags"
                                      role="button"
                                      tabIndex={0}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setOpenImportedElementInfoId((current) =>
                                          current === item.id ? "" : item.id
                                        );
                                      }}
                                      onKeyDown={(event) => {
                                        if (event.key !== "Enter" && event.key !== " ") return;
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setOpenImportedElementInfoId((current) =>
                                          current === item.id ? "" : item.id
                                        );
                                      }}
                                      className="absolute left-1 bottom-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#cbd5e1] bg-white text-[#475569] hover:bg-[#f8fafc]"
                                    >
                                      <Info size={11} />
                                    </span>
                                    <span
                                      title="Delete imported element"
                                      aria-label="Delete imported element"
                                      role="button"
                                      tabIndex={deletingImported ? -1 : 0}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        if (deletingImported) return;
                                        void handleDeleteImportedElement(item.id);
                                      }}
                                      onKeyDown={(event) => {
                                        if (deletingImported) return;
                                        if (event.key !== "Enter" && event.key !== " ") return;
                                        event.preventDefault();
                                        event.stopPropagation();
                                        void handleDeleteImportedElement(item.id);
                                      }}
                                      className={`absolute bottom-1 right-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#fecaca] bg-white text-[#b91c1c] hover:bg-[#fee2e2] ${
                                        deletingImported ? "cursor-not-allowed opacity-60" : ""
                                      }`}
                                    >
                                      <Trash2 size={11} />
                                    </span>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={resolveImportedElementPreviewUrl(item)}
                                      alt={item.title || "Imported element"}
                                      className="h-20 w-full rounded object-contain"
                                    />
                                    {showingInfo ? (
                                      <div className="absolute inset-x-1 top-1 z-20 rounded-md border border-[#dbe3ee] bg-white/98 p-2 shadow-lg">
                                        <div className="mb-1 flex items-start justify-between gap-2">
                                          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#64748b]">
                                            Search Tags
                                          </div>
                                          <button
                                            type="button"
                                            onClick={(event) => {
                                              event.preventDefault();
                                              event.stopPropagation();
                                              setOpenImportedElementInfoId("");
                                            }}
                                            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#dbe3ee] bg-white text-[#64748b] hover:bg-[#f8fafc]"
                                            aria-label="Close search tags"
                                            title="Close"
                                          >
                                            <X size={11} />
                                          </button>
                                        </div>
                                        {searchableTagsEn.length > 0 || searchableTagsAr.length > 0 ? (
                                          <div className="space-y-2">
                                            <div>
                                              <div className="mb-1 text-[10px] font-semibold text-[#475569]">
                                                English
                                              </div>
                                              {searchableTagsEn.length > 0 ? (
                                                <div className="flex flex-wrap gap-1">
                                                  {searchableTagsEn.map((tag) => {
                                                    const tagKey = `${item.id}:${tag}`;
                                                    const isCopied = copiedImportedTagKey === tagKey;
                                                    return (
                                                      <button
                                                        key={`${item.id}-en-${tag}`}
                                                        type="button"
                                                        onClick={(event) => {
                                                          event.preventDefault();
                                                          event.stopPropagation();
                                                          void handleCopyImportedTag(item.id, tag);
                                                        }}
                                                        className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                                                          isCopied
                                                            ? "border-[#bfdbfe] bg-[#dbeafe] text-[#1d4ed8]"
                                                            : "border-[#dbe3ee] bg-[#f8fafc] text-[#475569]"
                                                        }`}
                                                        title={isCopied ? "Copied" : "Click to copy"}
                                                      >
                                                        {tag}
                                                      </button>
                                                    );
                                                  })}
                                                </div>
                                              ) : (
                                                <div className="text-[10px] text-[#94a3b8]">No English tags.</div>
                                              )}
                                            </div>
                                            <div>
                                              <div className="mb-1 text-[10px] font-semibold text-[#475569]">
                                                العربية
                                              </div>
                                              {searchableTagsAr.length > 0 ? (
                                                <div className="flex flex-wrap gap-1">
                                                  {searchableTagsAr.map((tag) => {
                                                    const tagKey = `${item.id}:${tag}`;
                                                    const isCopied = copiedImportedTagKey === tagKey;
                                                    return (
                                                      <button
                                                        key={`${item.id}-ar-${tag}`}
                                                        type="button"
                                                        onClick={(event) => {
                                                          event.preventDefault();
                                                          event.stopPropagation();
                                                          void handleCopyImportedTag(item.id, tag);
                                                        }}
                                                        className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                                                          isCopied
                                                            ? "border-[#bfdbfe] bg-[#dbeafe] text-[#1d4ed8]"
                                                            : "border-[#dbe3ee] bg-[#f8fafc] text-[#475569]"
                                                        }`}
                                                        title={isCopied ? "Copied" : "Click to copy"}
                                                      >
                                                        {tag}
                                                      </button>
                                                    );
                                                  })}
                                                </div>
                                              ) : (
                                                <div className="text-[10px] text-[#94a3b8]">لا توجد كلمات عربية.</div>
                                              )}
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="text-[10px] text-[#64748b]">
                                            No search tags available.
                                          </div>
                                        )}
                                      </div>
                                    ) : null}
                                    {isGifAsset ? (
                                      <span className="absolute right-1 top-1 rounded-full bg-[#1f2a39] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">
                                        GIF
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="mt-1 truncate text-[11px] font-semibold text-[#1f2a39]">
                                    {item.title || "Imported Icon"}
                                  </div>
                                  <div className="text-[10px] uppercase text-[#64748b]">
                                    {item.kind}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}

                        {importedElementsLoading && importedElements.length === 0 ? (
                          <div className="py-2 text-xs text-[#64748b]">Loading imported elements...</div>
                        ) : null}

                        {importedElementsError ? (
                          <div className="py-2 text-xs text-[#b45309]">{importedElementsError}</div>
                        ) : null}

                        {!importedElementsLoading && !importedElementsError && importedElements.length === 0 ? (
                          <div className="py-2 text-xs text-[#64748b]">
                            No imported elements found. Import from Freepik or upload an image to build a recolorable elements library.
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-[#202a38]">
                              Need to publish ({publishableElements.length})
                            </div>
                            <div className="text-[11px] text-[#637087]">
                              {publishCandidateIds.length} selected for publish
                            </div>
                          </div>
                          <button
                            type="button"
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d3d8e1] bg-white px-2 text-[12px] font-medium text-[#334155] hover:bg-[#f8fafc]"
                            onClick={() => {
                              if (allVisiblePublishableSelected) {
                                setPublishCandidateIds([]);
                              } else {
                                setPublishCandidateIds(filteredPublishableElements.map((element) => element.id));
                              }
                            }}
                            disabled={filteredPublishableElements.length === 0}
                          >
                            {allVisiblePublishableSelected ? <CheckSquare2 size={14} /> : <Square size={14} />}
                            {allVisiblePublishableSelected ? "Clear" : "Select all"}
                          </button>
                        </div>

                        {filteredPublishableElements.length > 0 ? (
                          <div className="grid grid-cols-2 gap-2">
                            {filteredPublishableElements.map((element) => {
                              const previewSrc = String(element.rasterOriginalSrc || element.src || "").trim();
                              const isSelected = publishCandidatesSet.has(element.id);
                              return (
                                <button
                                  key={element.id}
                                  type="button"
                                  onClick={() => togglePublishCandidate(element.id)}
                                  className={`rounded-md border p-2 text-left transition ${
                                    isSelected
                                      ? "border-[#2563eb] bg-[#eff6ff] shadow-[inset_0_0_0_1px_rgba(37,99,235,0.12)]"
                                      : "border-[#d3d8e1] bg-[#f3f4f6] hover:bg-[#eef2f7]"
                                  }`}
                                >
                                  <div className="relative rounded-md bg-[#eef1f5] p-1">
                                    {previewSrc ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={previewSrc}
                                        alt={element.name || "Canvas element"}
                                        className="h-20 w-full rounded object-contain"
                                      />
                                    ) : (
                                      <div className="flex h-20 w-full items-center justify-center rounded bg-white text-[#94a3b8]">
                                        <ImageIcon size={18} />
                                      </div>
                                    )}
                                    <span className="absolute right-1 top-1 rounded-full bg-white/90 p-[2px] text-[#1d4ed8] shadow-sm">
                                      {isSelected ? <CheckSquare2 size={11} /> : <Square size={11} />}
                                    </span>
                                  </div>
                                  <div className="mt-1 truncate text-[11px] font-semibold text-[#1f2a39]">
                                    {element.name || "Image layer"}
                                  </div>
                                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[#64748b]">
                                    <Sparkles size={10} />
                                    Canvas image layer
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-md border border-dashed border-[#d3d8e1] bg-[#f8fafc] p-3 text-xs text-[#64748b]">
                            {publishableElements.length === 0
                              ? "No reusable image elements on the current canvas."
                              : "No canvas elements match this search."}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {elementsPanelTab === "published" ? (
                    <div className="mt-2 flex items-center justify-between border-t border-[#e6e9ef] pt-2 text-[11px] text-[#637087]">
                      <span>
                        Showing {importedElements.length}/{importedElementsTotal}
                      </span>
                      <span>
                        {importedElementsLoading
                          ? "Loading..."
                          : importedElementsHasNextPage
                          ? "Scroll to load more"
                          : "All loaded"}
                      </span>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center justify-between border-t border-[#e6e9ef] pt-2 text-[11px] text-[#637087]">
                      <span>{publishCandidateIds.length} selected</span>
                      <span>Use Publish Elements to finish</span>
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {activeTab === "frames" ? (
              <section className="flex h-full min-h-0 flex-col gap-3">
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-[#798293]" />
                  <Input
                    className="!h-9 !rounded-full !bg-white !pl-9"
                    placeholder="Search frames..."
                    value={frameSearch}
                    onChange={(event) => setFrameSearch(event.target.value)}
                  />
                </div>

                <div className="rounded-xl border border-[#d3d8e1] bg-white p-3 text-xs leading-5 text-[#64748b]">
                  Add a frame, then drop an image or video onto it. Double-click a filled frame on the canvas to pan its content.
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-[#d3d8e1] bg-white p-2">
                  {filteredFramePresets.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      {filteredFramePresets.map((preset) => {
                        const clipPath = framePreviewClipPath(preset);
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            draggable
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "copy";
                              event.dataTransfer.setData(
                                "application/x-editor-asset",
                                assetPayload({
                                  kind: "frame",
                                  framePresetId: preset.id,
                                })
                              );
                            }}
                            onClick={() => addFramePresetToCanvas(preset)}
                            className="group rounded-xl border border-[#d3d8e1] bg-[#f8fafc] p-2 text-left transition hover:border-[#9fb4d6] hover:bg-[#eef3fa] focus:outline-none focus:ring-2 focus:ring-[#2c68be]/30"
                            title={preset.name}
                          >
                            <div className="flex h-24 items-center justify-center rounded-lg p-3">
                              <div
                                className="relative h-full w-full overflow-hidden bg-[#dff4ff] shadow-inner ring-1 ring-[#d8e2ef]"
                                style={{ clipPath }}
                              >
                                <div className="absolute inset-0 bg-gradient-to-b from-[#dff4ff] via-[#f8fdff] to-[#d6ecb6]" />
                                <div className="absolute -left-4 bottom-1 h-9 w-24 rotate-[-8deg] rounded-[50%] bg-[#8ab443]" />
                                <div className="absolute -right-5 bottom-3 h-8 w-28 rotate-[7deg] rounded-[50%] bg-[#a6c85a]" />
                                <div className="absolute left-1/2 top-1/3 h-7 w-12 -translate-x-1/2 rounded-full bg-white/85 shadow-sm before:absolute before:-left-2 before:top-2 before:h-4 before:w-4 before:rounded-full before:bg-white/90 after:absolute after:right-1 after:top-[-8px] after:h-7 after:w-7 after:rounded-full after:bg-white/90" />
                              </div>
                            </div>
                            <div className="mt-2 line-clamp-2 text-[12px] font-semibold leading-4 text-[#1f2a39]">
                              {preset.name}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-[#d3d8e1] bg-[#f8fafc] p-3 text-xs text-[#64748b]">
                      No frames match this search.
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {activeTab === "category" ? (
              <section className="space-y-3">
                <div className="text-base font-semibold text-[#202a38]">Template category</div>

                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-[#5b6472]">Template name</Label>
                  <Input
                    placeholder="Template name"
                    value={activeTemplateName}
                    onChange={(event) => setTemplateMeta({ name: event.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-[#5b6472]">Category</Label>
                  <Select
                    value={activeCategoryValue}
                    onChange={(event) => {
                      const nextCategory = String(event.target.value || "general").trim().toLowerCase();
                      const categoryOption =
                        templateCategorySettings.find((item) => item.value === nextCategory) || null;
                      setTemplateMeta({
                        category: nextCategory,
                        subCategory: categoryOption?.subCategories?.[0]?.value || "general",
                      });
                    }}
                    disabled={taxonomyLoading}
                  >
                    {templateCategorySettings.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.labelEn}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-[#5b6472]">Sub category</Label>
                  <Select
                    value={activeSubCategoryValue}
                    onChange={(event) =>
                      setTemplateMeta({
                        subCategory: String(event.target.value || "general").trim().toLowerCase(),
                      })
                    }
                    disabled={activeSubCategoryOptions.length === 0}
                  >
                    {activeSubCategoryOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.labelEn}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-[#5b6472]">Tags (comma separated)</Label>
                  <Input
                    placeholder="ramadan, promo"
                    value={activeTemplateTags.join(", ")}
                    onChange={(event) =>
                      setTemplateMeta({
                        tags: event.target.value
                          .split(",")
                          .map((item) => item.trim().toLowerCase())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>

                <div className="rounded-md border border-[#d3d8e1] bg-white p-2 text-xs text-[#4b5565]">
                  <div className="flex items-center justify-between">
                    <span>Status</span>
                    <span className="rounded-full bg-[#eef2f7] px-2 py-0.5 font-semibold text-[#334155]">
                      {activeTemplateStatus}
                    </span>
                  </div>
                  {activeTemplateId ? (
                    <div className="mt-1 truncate text-[11px] text-[#697182]" title={activeTemplateId}>
                      id: {activeTemplateId}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-[#697182]">
                      Save once to create a template id.
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {activeTab === "upload" ? (
              <section className="space-y-3">
                <div className="text-base font-semibold text-[#1f2a39]">Upload your assets</div>
                <Button
                  type="button"
                  variant="secondary"
                  className="!h-9 !w-full !justify-center !rounded-md"
                  onClick={() => openImageUploadPicker()}
                >
                  + Add file
                </Button>
              </section>
            ) : null}

            {activeTab === "backgrounds" ? (
              <section className="space-y-3">
                <div className="space-y-2">
                  <div className="text-base font-semibold text-[#202a38]">Background color</div>
                  <div className="overflow-x-auto pb-1">
                    <div className="flex min-w-max items-center gap-3">
                      <input
                        ref={backgroundColorInputRef}
                        type="color"
                        className="sr-only"
                        value={/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(activeBackgroundColor) ? activeBackgroundColor : "#ffffff"}
                        onChange={(event) => applyBackgroundColorSelection(event.target.value || "#ffffff")}
                      />
                      <button
                        type="button"
                        aria-label="Pick custom background color"
                        title="Pick custom color"
                        onClick={() => backgroundColorInputRef.current?.click()}
                        className="flex h-14 w-14 items-center justify-center rounded border border-[#d3d8e1] bg-white shadow-sm hover:bg-[#f8fafc]"
                      >
                        <Palette size={24} className="text-[#b8bec9]" />
                      </button>

                      {COLOR_SWATCHES.map((color) => {
                        const active = activeBackgroundColor.toLowerCase() === color.toLowerCase();
                        return (
                          <button
                            key={color}
                            type="button"
                            onClick={() => applyBackgroundColorSelection(color)}
                            className={`h-14 w-14 rounded border shadow-sm ${active ? "border-[#2f6fca] ring-2 ring-[#d9e8ff]" : "border-[#d3d8e1]"}`}
                            style={{ backgroundColor: color }}
                            title={color}
                          />
                        );
                      })}

                      <button
                        type="button"
                        aria-label="Transparent background"
                        title="Transparent"
                        onClick={() => applyBackgroundColorSelection("transparent")}
                        className={`h-14 w-14 rounded border bg-[conic-gradient(#eceef3_25%,#9ea8ba_0_50%,#eceef3_0_75%,#9ea8ba_0)] [background-size:14px_14px] shadow-sm ${
                          activeBackgroundColor.toLowerCase() === "transparent"
                            ? "border-[#2f6fca] ring-2 ring-[#d9e8ff]"
                            : "border-[#d3d8e1]"
                        }`}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3 rounded-md border border-[#d3d8e1] bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-base font-semibold text-[#202a38]">Background images</div>
                    {activePage?.background?.type === "image" && activeBackgroundImageUri ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="!h-8 !px-2 text-xs"
                        onClick={() =>
                          setBackground({
                            type: "color",
                            imageUri: "",
                            imageThumbnailUri: "",
                            sourceAssetId: "",
                            categoryValue: "",
                          })
                        }
                      >
                        Remove image
                      </Button>
                    ) : null}
                  </div>

                  {backgroundAssetsLoading ? (
                    <div className="py-2 text-xs text-[#637087]">Loading background images...</div>
                  ) : null}

                  {backgroundAssetsError ? (
                    <div className="py-2 text-xs text-[#b45309]">{backgroundAssetsError}</div>
                  ) : null}

                  {!backgroundAssetsLoading && !backgroundAssetsError && categorizedBackgroundAssets.length === 0 ? (
                    <div className="py-2 text-xs text-[#64748b]">
                      No imported backgrounds found. Import backgrounds from Freepik first.
                    </div>
                  ) : null}

                  {categorizedBackgroundAssets.length > 0 ? (
                    <div className="space-y-4">
                      {categorizedBackgroundAssets.map((group) => (
                        <div key={group.key} className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="relative aspect-square w-[88px] shrink-0 overflow-hidden rounded-xl border border-[#d3d8e1] bg-[#eef2f7]">
                              {group.thumbnailUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={group.thumbnailUrl}
                                  alt={`${group.label} category thumbnail`}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#eef2ff_0%,#f8fafc_55%,#e2e8f0_100%)]">
                                  <ImageIcon size={20} className="text-[#94a3b8]" />
                                </div>
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
                              <div className="absolute inset-x-0 bottom-0 p-2">
                                <div className="line-clamp-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
                                  {group.label}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-[10px] text-[#94a3b8]">
                                {group.items.length} background{group.items.length === 1 ? "" : "s"}
                              </div>
                              <button
                                type="button"
                                aria-label={`Upload background image to ${group.label}`}
                                title={`Upload background image to ${group.label}`}
                                onClick={() => openImageUploadPicker(group.key)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#d3d8e1] bg-white text-[#4b5565] transition hover:bg-[#eef3fa]"
                              >
                                <Upload size={13} />
                              </button>
                            </div>
                          </div>
                          {group.items.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-[#d3d8e1] bg-[#f8fafc] px-3 py-4 text-xs text-[#64748b]">
                              No backgrounds in this category yet.
                            </div>
                          ) : (
                            <div className="flex gap-2 overflow-x-auto pb-1">
                              {group.items.map((item) => {
                              const isActive =
                                activePage?.background?.type === "image" &&
                                activeBackgroundImageUri === item.assetUrl;
                              const previewImageSrc = item.thumbnailUrl || item.assetUrl;
                              const deletingImported = deletingImportedElementId === item.id;
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() =>
                                    setBackground({
                                      type: "image",
                                      color: activeBackgroundColor || "#ffffff",
                                      imageUri: item.assetUrl,
                                      imageThumbnailUri: item.thumbnailUrl || item.assetUrl,
                                      sourceAssetId: item.sourceAssetId || item.id,
                                      categoryValue: item.categoryValue || group.key,
                                    })
                                  }
                                  className={`w-[132px] shrink-0 overflow-hidden rounded-xl border bg-[#f8fafc] text-left transition ${
                                    isActive
                                      ? "border-[#2f6fca] ring-2 ring-[#d9e8ff]"
                                      : "border-[#d3d8e1] hover:border-[#9fb4d6] hover:bg-[#eef3fa]"
                                  }`}
                                >
                                  <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-white">
                                    <span
                                      title="Delete background image"
                                      aria-label="Delete background image"
                                      role="button"
                                      tabIndex={deletingImported ? -1 : 0}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        if (deletingImported) return;
                                        void handleDeleteBackgroundAsset(item.id);
                                      }}
                                      onKeyDown={(event) => {
                                        if (deletingImported) return;
                                        if (event.key !== "Enter" && event.key !== " ") return;
                                        event.preventDefault();
                                        event.stopPropagation();
                                        void handleDeleteBackgroundAsset(item.id);
                                      }}
                                      className={`absolute right-1 top-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#fecaca] bg-white text-[#b91c1c] hover:bg-[#fee2e2] ${
                                        deletingImported ? "cursor-not-allowed opacity-60" : ""
                                      }`}
                                    >
                                      <Trash2 size={11} />
                                    </span>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={previewImageSrc}
                                      alt={item.title || "Background image"}
                                      className="h-full w-full object-cover"
                                    />
                                  </div>
                                </button>
                              );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {activeTab === "layers" ? (
              <section className="space-y-3">
                <div className="text-sm font-medium text-[#202a38]">Elements on your active page:</div>

                {layers.length === 0 ? (
                  <div className="text-sm text-[#333f50]">No elements on the page...</div>
                ) : (
                  <div className="space-y-1">
                    {layers.map((layer) => {
                      const selected = selectedIds.includes(layer.id);
                      const dragOverLayer = dragOver.id === layer.id;
                      const displayName = layerDisplayName(layer, activePage);
                      const typeLabel = layerTypeLabel(layer);
                      const textColor =
                        layer.type === "text" && String(layer.color || "").trim()
                          ? String(layer.color || "")
                          : "#1f2a39";
                      return (
                        <div
                          key={layer.id}
                          draggable
                          onDragStart={() => {
                            setDragLayerId(layer.id);
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            const rect = event.currentTarget.getBoundingClientRect();
                            setDragOver({
                              id: layer.id,
                              position: event.clientY - rect.top > rect.height / 2 ? "after" : "before",
                            });
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const rect = event.currentTarget.getBoundingClientRect();
                            handleLayerDrop(layer.id, event.clientY - rect.top > rect.height / 2 ? "after" : "before");
                          }}
                          className={`rounded-xl border px-3 py-2 ${
                            selected ? "border-[#7c3aed] bg-[#d9dbe2]" : "border-[#d3d8e1] bg-[#d6d9e1]"
                          } ${
                            dragOverLayer
                              ? dragOver.position === "after"
                                ? "border-b-2 border-b-[#2f6fca]"
                                : "border-t-2 border-t-[#2f6fca]"
                              : ""
                          } cursor-grab`}
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex h-5 w-5 items-center justify-center text-[#73809a]">
                              <GripVertical size={14} />
                            </div>
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                              onClick={(event) => handleLayerSelect(event, layer.id)}
                            >
                              <LayerThumbnail layer={layer} />
                              <div className="flex min-w-0 flex-col">
                                <span className="truncate text-[13px] font-semibold" style={{ color: textColor }}>
                                  {displayName}
                                </span>
                                <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-[#8a93a6]">
                                  {typeLabel}
                                </span>
                              </div>
                            </button>

                            <button type="button" onClick={() => toggleVisibility(layer.id)} className="rounded p-1 text-[#4f5d72] hover:bg-[#e7edf6]">
                              {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleLock(layer.id)}
                              className="rounded p-1 text-[#4f5d72] hover:bg-[#e7edf6]"
                            >
                              {layer.locked ? <Lock size={14} /> : <Unlock size={14} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteElement(layer.id)}
                              className="rounded p-1 text-[#4f5d72] hover:bg-[#e7edf6]"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : null}

            {activeTab === "resize" ? (
              <section className="space-y-4">
                <label className="flex items-center justify-between text-[15px] text-[#202a38]">
                  <span>Use magic resize</span>
                  <button
                    type="button"
                    onClick={() => setResizeUseMagic(!resizeUseMagic)}
                    className={`relative h-5 w-8 rounded-full transition ${resizeUseMagic ? "bg-[#2f6fca]" : "bg-[#c8ced8]"}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${resizeUseMagic ? "left-3.5" : "left-0.5"}`} />
                  </button>
                </label>

                <div className="space-y-2">
                  <label className="block text-sm text-[#2d3748]">Width (px)</label>
                  <Input
                    className="!h-9 !rounded-md !bg-white"
                    value={resizeWidth}
                    onChange={(event) => setResizeWidth(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm text-[#2d3748]">Height (px)</label>
                  <Input
                    className="!h-9 !rounded-md !bg-white"
                    value={resizeHeight}
                    onChange={(event) => setResizeHeight(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm text-[#2d3748]">Units</label>
                  <select
                    className="select !h-9 !rounded-md !bg-white"
                    value={resizeUnits}
                    onChange={(event) => setResizeUnits(event.target.value)}
                  >
                    <option value="px">px</option>
                  </select>
                </div>

                <Button
                  type="button"
                  className="!h-9 !w-full !rounded-md"
                  onClick={() => {
                    const width = Number(resizeWidth) || activePage.width;
                    const height = Number(resizeHeight) || activePage.height;
                    resizeActivePage(width, height, { useMagic: resizeUseMagic });
                  }}
                >
                  Resize
                </Button>

                {RESIZE_PRESETS.map((group) => (
                  <div key={group.group} className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#222d3d]">
                      {group.icon ? <group.icon size={15} /> : null}
                      <span>{group.group}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {group.items.map((item) => (
                        <button
                          key={`${group.group}-${item.label}`}
                          type="button"
                          className="rounded-md border border-[#d3d8e1] bg-white p-2 text-center text-[11px] text-[#344255] hover:bg-[#f5f8fc]"
                          onClick={() => {
                            setResizeWidth(String(item.width));
                            setResizeHeight(String(item.height));
                            resizeActivePage(item.width, item.height, { useMagic: resizeUseMagic });
                          }}
                        >
                          <div className="font-semibold">{item.label}</div>
                          <div>{item.displaySize || `${item.width}x${item.height} px`}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

              </section>
            ) : null}

            {activeTab === "animation" ? (
              <section className="editor-animation-panel space-y-4">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-[#202a38]">Animation</div>
                  <div className="text-[11px] text-[#64748b]">
                    {selectedElements.length === 0
                      ? "Select one or more layers to edit animation."
                      : selectedElements.length === 1
                        ? `Editing ${primarySelectedElement?.name || "selected layer"}`
                        : `Apply to ${selectedElements.length} selected layers`}
                  </div>
                </div>

                {selectedElements.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#d6dce6] bg-white px-4 py-5 text-center text-[12px] text-[#64748b]">
                    Pick a layer from the canvas or Layers panel to adjust its animation.
                  </div>
                ) : (
                  <>
                    {/* Three independent slots — a layer can have an entrance, a loop AND an exit. */}
                    <div className="space-y-1.5">
                      <div className="flex gap-1 rounded-xl bg-[#eef1f6] p-1">
                        {ANIMATION_SLOT_TABS.map((tab) => {
                          const active = animationSlot === tab.key;
                          const slotSpec = selectedElements.length
                            ? resolveElementAnimations(selectedElements[0])[ANIMATION_SLOT_KEY[tab.key]]
                            : null;
                          const isSet = Boolean(slotSpec && slotSpec.type !== "NONE");
                          return (
                            <button
                              key={tab.key}
                              type="button"
                              onClick={() => setAnimationSlot(tab.key)}
                              className={`relative flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                                active
                                  ? "bg-white text-[#243041] shadow-sm"
                                  : "text-[#64748b] hover:text-[#243041]"
                              }`}
                            >
                              {tab.label}
                              {/* A dot marks a slot that already has an effect, so the other two
                                  tabs don't look empty when only one is configured. */}
                              {isSet ? (
                                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#fb7185]" />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                      <div className="text-[11px] text-[#94a3b8]">
                        {ANIMATION_SLOT_TABS.find((tab) => tab.key === animationSlot)?.hint}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-[#5b6472]">Animation time (ms)</Label>
                        <div className="relative">
                          <Input
                            className={`!h-10 !rounded-xl !pr-12 ${
                              selectedAnimationInfinite
                                ? "!cursor-not-allowed !border-[#e2e8f0] !bg-[#f8fafc] !text-[#94a3b8]"
                                : "!bg-white"
                            }`}
                            type="number"
                            min={200}
                            max={15000}
                            step={100}
                            value={animationDurationDraft}
                            placeholder={selectedElements.length > 1 ? "Mixed" : String(DEFAULT_ANIMATION_DURATION_MS)}
                            disabled={Boolean(selectedAnimationInfinite)}
                            onChange={(event) => setAnimationDurationDraft(String(event.target.value || "").trim())}
                            onKeyDown={(event) => {
                              if (selectedAnimationInfinite) return;
                              if (event.key !== "Enter") return;
                              const nextValue = String(animationDurationDraft || "").trim();
                              if (!nextValue) return;
                              updateAnimationSlot({
                                durationMs: normalizeAnimationDurationMs(nextValue),
                              });
                            }}
                          />
                          <button
                            type="button"
                            aria-label="Apply animation time"
                            title="Apply animation time"
                            disabled={Boolean(selectedAnimationInfinite)}
                            onClick={() => {
                              const nextValue = String(animationDurationDraft || "").trim();
                              if (!nextValue) return;
                              updateAnimationSlot({
                                durationMs: normalizeAnimationDurationMs(nextValue),
                              });
                            }}
                            className={`absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-white shadow-sm transition ${
                              selectedAnimationInfinite
                                ? "cursor-not-allowed bg-[#cbd5e1]"
                                : "bg-[#fb7185] hover:bg-[#f43f5e]"
                            }`}
                          >
                            <Check size={14} />
                          </button>
                        </div>
                        {selectedAnimationInfinite ? (
                          <div className="text-[11px] text-[#94a3b8]">Animation time is ignored while infinite is enabled.</div>
                        ) : null}
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-[#5b6472]">Infinite</Label>
                        <button
                          type="button"
                          disabled={!selectedAnimationCanLoop}
                          onClick={() =>
                            selectedAnimationCanLoop &&
                            updateAnimationSlot({
                              infinite: !(selectedAnimationInfinite ?? false),
                            })
                          }
                          className={`flex h-10 w-full items-center justify-between rounded-xl border px-3 text-sm font-semibold transition ${
                            !selectedAnimationCanLoop
                              ? "cursor-not-allowed border-[#e2e8f0] bg-[#f8fafc] text-[#94a3b8]"
                              : selectedAnimationInfinite
                              ? "border-[#fb7185] bg-[#fff1f4] text-[#be123c]"
                              : "border-[#d6dce6] bg-white text-[#334155] hover:border-[#c2cedd]"
                          }`}
                        >
                          <span>
                            {!selectedAnimationCanLoop
                              ? "Not available"
                              : selectedAnimationInfinite === null
                                ? "Mixed"
                                : selectedAnimationInfinite
                                  ? "Yes"
                                  : "No"}
                          </span>
                          <span
                            className={`relative h-5 w-9 rounded-full transition ${
                              selectedAnimationCanLoop && selectedAnimationInfinite ? "bg-[#fb7185]" : "bg-[#cbd5e1]"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition ${
                                selectedAnimationCanLoop && selectedAnimationInfinite ? "left-4.5" : "left-0.5"
                              }`}
                            />
                          </span>
                        </button>
                        {!selectedAnimationCanLoop ? (
                          <div className="text-[11px] text-[#94a3b8]">
                            Infinite is only available on the Loop slot, for effects that support it.
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {ANIMATION_CATALOG[animationSlot].map((type) => {
                        const active = selectedAnimationType === type;
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() => updateAnimationSlot({ type })}
                            className={`group rounded-2xl border p-2 text-center transition ${
                              active
                                ? "border-[#fb7185] bg-[#fff1f4] shadow-[inset_0_0_0_1px_rgba(251,113,133,0.12)]"
                                : "border-[#d6dce6] bg-white hover:border-[#c2cedd] hover:bg-[#f8fbff]"
                            }`}
                          >
                            <div className="flex justify-center">
                              <AnimationSampleTile type={type} />
                            </div>
                            <div className="mt-2 text-[11px] font-semibold leading-tight text-[#243041]">
                              {getAnimationLabel(type, "en", animationSlot)}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {String(primarySelectedElement?.sourceAnimationLabel || primarySelectedElement?.sourceAnimationName || "").trim() ? (
                      <div className="rounded-xl border border-[#d6dce6] bg-white px-3 py-2 text-[11px] text-[#64748b]">
                        Imported animation: {String(primarySelectedElement?.sourceAnimationLabel || primarySelectedElement?.sourceAnimationName || "").trim()}
                      </div>
                    ) : null}
                  </>
                )}
              </section>
            ) : null}
        </div>
      </div>
      <style jsx global>{`
        .editor-animation-panel .animation-sample-glyph {
          display: block;
          height: 40px;
          width: 40px;
          will-change: transform, opacity;
          animation-duration: 1.45s;
          animation-iteration-count: infinite;
          animation-timing-function: ease-in-out;
          animation-direction: alternate;
          animation-fill-mode: both;
          animation-play-state: running;
          transform-origin: center;
          overflow: visible;
        }

        .editor-animation-panel .animation-sample-rise {
          animation-name: sampleRise;
        }

        .editor-animation-panel .animation-sample-pan {
          animation-name: samplePan;
        }
        .editor-animation-panel .animation-sample-shift {
          animation-name: sampleShift;
        }
        .editor-animation-panel .animation-sample-skate {
          animation-name: sampleSkate;
        }
        .editor-animation-panel .animation-sample-ascend {
          animation-name: sampleAscend;
        }
        .editor-animation-panel .animation-sample-block {
          animation-name: sampleBlock;
        }

        .editor-animation-panel .animation-sample-fade {
          animation-name: sampleFade;
        }

        .editor-animation-panel .animation-sample-pop {
          animation-name: samplePop;
        }

        .editor-animation-panel .animation-sample-wipe {
          animation-name: sampleWipe;
        }

        .editor-animation-panel .animation-sample-blur {
          animation-name: sampleBlur;
        }

        .editor-animation-panel .animation-sample-succession {
          animation-name: sampleSuccession;
        }

        .editor-animation-panel .animation-sample-breathe {
          animation-name: sampleBreathe;
          animation-duration: 1.8s;
        }

        .editor-animation-panel .animation-sample-baseline {
          animation-name: sampleBaseline;
        }

        .editor-animation-panel .animation-sample-drift {
          animation-name: sampleDrift;
        }

        .editor-animation-panel .animation-sample-tectonic {
          animation-name: sampleTectonic;
        }

        .editor-animation-panel .animation-sample-tumble {
          animation-name: sampleTumble;
        }

        .editor-animation-panel .animation-sample-neon {
          animation-name: sampleNeon;
        }

        .editor-animation-panel .animation-sample-scrapbook {
          animation-name: sampleScrapbook;
        }

        .editor-animation-panel .animation-sample-stomp {
          animation-name: sampleStomp;
        }

        .editor-animation-panel .animation-sample-rotate {
          animation-name: sampleRotate;
          animation-duration: 1.7s;
          animation-direction: normal;
          animation-timing-function: linear;
        }

        .editor-animation-panel .animation-sample-flicker {
          animation-name: sampleFlicker;
          animation-duration: 0.9s;
          animation-direction: normal;
        }

        .editor-animation-panel .animation-sample-pulse {
          animation-name: samplePulse;
          animation-duration: 1.4s;
        }

        .editor-animation-panel .animation-sample-wiggle {
          animation-name: sampleWiggle;
          animation-duration: 1.15s;
        }

        @keyframes sampleFade {
          0%,
          100% {
            opacity: 0.28;
          }
          50% {
            opacity: 1;
          }
        }

        @keyframes sampleRise {
          0%,
          100% {
            transform: translateY(7px);
            opacity: 0.52;
          }
          50% {
            transform: translateY(-5px);
            opacity: 1;
          }
        }

        @keyframes samplePan {
          0%,
          100% {
            transform: translateX(-7px);
            opacity: 0.45;
          }
          50% {
            transform: translateX(7px);
            opacity: 1;
          }
        }
        @keyframes sampleShift {
          0%,
          100% {
            transform: translateY(-7px);
            opacity: 0.52;
          }
          50% {
            transform: translateY(5px);
            opacity: 1;
          }
        }
        @keyframes sampleSkate {
          0%,
          100% {
            transform: translateX(7px);
            opacity: 0.45;
          }
          50% {
            transform: translateX(-7px);
            opacity: 1;
          }
        }
        @keyframes sampleAscend {
          0%,
          100% {
            transform: translateY(6px);
            opacity: 0.4;
          }
          50% {
            transform: translateY(-3px);
            opacity: 1;
          }
        }
        @keyframes sampleBlock {
          0%,
          100% {
            transform: translateX(-9px);
            opacity: 0.85;
          }
          50% {
            transform: translateX(9px);
            opacity: 1;
          }
        }

        @keyframes samplePop {
          0%,
          100% {
            transform: scale(0.84);
            opacity: 0.74;
          }
          50% {
            transform: scale(1.08);
            opacity: 1;
          }
        }

        @keyframes sampleWipe {
          0%,
          100% {
            transform: scaleX(0.72);
            opacity: 0.65;
          }
          50% {
            transform: scaleX(1);
            opacity: 1;
          }
        }

        @keyframes sampleBlur {
          0%,
          100% {
            transform: scale(0.96);
            opacity: 0.45;
            filter: blur(1.8px);
          }
          50% {
            transform: scale(1);
            opacity: 1;
            filter: blur(0px);
          }
        }

        @keyframes sampleSuccession {
          0%,
          100% {
            transform: scale(0.8);
            opacity: 0.35;
          }
          50% {
            transform: scale(1.08);
            opacity: 1;
          }
        }

        @keyframes sampleBreathe {
          0%,
          100% {
            transform: scale(0.9);
            opacity: 0.85;
          }
          50% {
            transform: scale(1.04);
            opacity: 1;
          }
        }

        @keyframes sampleBaseline {
          0%,
          100% {
            transform: translateY(3px) scale(0.94);
          }
          45% {
            transform: translateY(-7px) scale(1.01);
          }
          65% {
            transform: translateY(-2px) scale(0.98);
          }
        }

        @keyframes sampleDrift {
          0%,
          100% {
            transform: translateX(-4px) translateY(1px);
            opacity: 0.62;
          }
          50% {
            transform: translateX(6px) translateY(-1px);
            opacity: 1;
          }
        }

        @keyframes sampleTectonic {
          0%,
          100% {
            transform: translateX(-8px) scaleX(0.88);
            opacity: 0.6;
          }
          50% {
            transform: translateX(5px) scaleX(1);
            opacity: 1;
          }
        }

        @keyframes sampleTumble {
          0%,
          100% {
            transform: rotate(-14deg) translateY(1px) scale(0.94);
            opacity: 0.7;
          }
          50% {
            transform: rotate(10deg) translateY(-3px) scale(1.03);
            opacity: 1;
          }
        }

        @keyframes sampleNeon {
          0%,
          100% {
            transform: scale(0.95);
            opacity: 0.84;
            filter: drop-shadow(0 0 0 rgba(251, 113, 133, 0));
          }
          50% {
            transform: scale(1.04);
            opacity: 1;
            filter: drop-shadow(0 0 5px rgba(251, 113, 133, 0.45));
          }
        }

        @keyframes sampleScrapbook {
          0%,
          100% {
            transform: rotate(-7deg) translateX(-2px);
          }
          50% {
            transform: rotate(5deg) translateX(3px);
          }
        }

        @keyframes sampleStomp {
          0%,
          100% {
            transform: scale(0.82);
            opacity: 0.7;
          }
          35% {
            transform: scale(1.08);
            opacity: 1;
          }
          55% {
            transform: scale(0.96);
          }
        }

        @keyframes sampleFlicker {
          0%,
          100% {
            opacity: 1;
          }
          20% {
            opacity: 0.4;
          }
          40% {
            opacity: 1;
          }
          60% {
            opacity: 0.25;
          }
          80% {
            opacity: 0.9;
          }
        }

        @keyframes sampleRotate {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }

        @keyframes samplePulse {
          0%,
          100% {
            transform: scale(0.92);
          }
          30% {
            transform: scale(1.05);
          }
          60% {
            transform: scale(0.96);
          }
        }

        @keyframes sampleWiggle {
          0%,
          100% {
            transform: rotate(-6deg);
          }
          50% {
            transform: rotate(6deg);
          }
        }

        @keyframes sampleHeartbeat {
          0%,
          100% {
            transform: scale(0.9);
          }
          20% {
            transform: scale(1.04);
          }
          40% {
            transform: scale(0.92);
          }
          60% {
            transform: scale(1.08);
          }
          80% {
            transform: scale(0.95);
          }
        }

        /* ── ported effects (spec catalog) ─────────────────────────────── */
        .editor-animation-panel .animation-sample-zoom {
          animation-name: sampleZoom;
        }
        .editor-animation-panel .animation-sample-slide {
          animation-name: sampleSlide;
        }
        .editor-animation-panel .animation-sample-drop {
          animation-name: sampleDrop;
        }
        .editor-animation-panel .animation-sample-diagonal {
          animation-name: sampleDiagonal;
        }
        .editor-animation-panel .animation-sample-dissolve {
          animation-name: sampleDissolve;
        }
        .editor-animation-panel .animation-sample-radial {
          animation-name: sampleRadial;
          animation-duration: 1.9s;
          animation-direction: normal;
          animation-timing-function: linear;
        }
        .editor-animation-panel .animation-sample-circle {
          animation-name: sampleCircle;
        }
        .editor-animation-panel .animation-sample-type {
          animation-name: sampleType;
          animation-duration: 1.7s;
        }
        .editor-animation-panel .animation-sample-wave {
          animation-name: sampleWave;
          animation-duration: 1.8s;
          animation-direction: normal;
          animation-timing-function: ease-in-out;
        }
        .editor-animation-panel .animation-sample-shake {
          animation-name: sampleShake;
          animation-duration: 0.8s;
          animation-direction: normal;
          animation-timing-function: linear;
        }
        .editor-animation-panel .animation-sample-bounce {
          animation-name: sampleBounce;
          animation-duration: 1.4s;
          animation-direction: normal;
          animation-timing-function: ease-in-out;
        }
        .editor-animation-panel .animation-sample-wobble {
          animation-name: sampleWobble;
          animation-duration: 1.5s;
        }
        .editor-animation-panel .animation-sample-random {
          animation-name: sampleRandom;
          animation-duration: 0.9s;
          animation-direction: normal;
          animation-timing-function: linear;
        }

        @keyframes sampleZoom {
          0%,
          100% {
            transform: scale(0.5);
            opacity: 0.45;
          }
          50% {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes sampleSlide {
          0%,
          100% {
            transform: translateX(-9px);
            opacity: 0.4;
          }
          50% {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes sampleDrop {
          0%,
          100% {
            transform: translateY(-9px);
            opacity: 0.35;
          }
          50% {
            transform: translateY(2px);
            opacity: 1;
          }
        }
        @keyframes sampleDiagonal {
          0%,
          100% {
            transform: translate(-6px, 6px);
            opacity: 0.4;
          }
          50% {
            transform: translate(0, 0);
            opacity: 1;
          }
        }
        @keyframes sampleDissolve {
          0%,
          100% {
            transform: translateY(4px) scale(0.97);
            opacity: 0.28;
          }
          50% {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }
        @keyframes sampleRadial {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
        @keyframes sampleCircle {
          0%,
          100% {
            transform: scale(0.3);
            opacity: 0.45;
          }
          50% {
            transform: scale(1);
            opacity: 1;
          }
        }
        /* Left→right "typing" reveal for the typewriter/one-word tiles. Never fully hides —
           the base class alternates it, so it reveals in then out and always stays legible. */
        @keyframes sampleType {
          0% {
            clip-path: inset(0 62% 0 0);
            opacity: 0.85;
          }
          100% {
            clip-path: inset(0 0 0 0);
            opacity: 1;
          }
        }
        @keyframes sampleWave {
          0%,
          100% {
            transform: translate(0, 0);
          }
          25% {
            transform: translate(-4px, -4px);
          }
          50% {
            transform: translate(0, 3px);
          }
          75% {
            transform: translate(4px, -2px);
          }
        }
        @keyframes sampleShake {
          0%,
          100% {
            transform: translateX(0);
          }
          20% {
            transform: translateX(-4px);
          }
          40% {
            transform: translateX(4px);
          }
          60% {
            transform: translateX(-3px);
          }
          80% {
            transform: translateX(3px);
          }
        }
        @keyframes sampleBounce {
          0%,
          100% {
            transform: translateY(-8px);
          }
          45% {
            transform: translateY(4px) scaleY(0.88) scaleX(1.08);
          }
          60% {
            transform: translateY(0) scaleY(1);
          }
        }
        @keyframes sampleWobble {
          0%,
          100% {
            transform: rotate(-13deg);
          }
          50% {
            transform: rotate(13deg);
          }
        }
        @keyframes sampleRandom {
          0%,
          100% {
            transform: translate(0, 0) rotate(0deg);
          }
          20% {
            transform: translate(-3px, 2px) rotate(-4deg);
          }
          40% {
            transform: translate(3px, -2px) rotate(3deg);
          }
          60% {
            transform: translate(-2px, -3px) rotate(-2deg);
          }
          80% {
            transform: translate(2px, 3px) rotate(4deg);
          }
        }

      `}</style>
    </aside>
  );
}
