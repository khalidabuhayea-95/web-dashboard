import type { EditorElement, EditorTemplatePreset } from "@/store/editorStore";
import { DEFAULT_EDITOR_FONT_FAMILIES } from "@/lib/editor/fonts";

const baseBackground = {
  type: "color" as const,
  color: "#ffffff",
  gradientFrom: "#ffffff",
  gradientTo: "#f3f4f6",
};

function textElement(overrides: Partial<EditorElement>): EditorElement {
  return {
    id: `tpl-${Math.random().toString(36).slice(2, 8)}`,
    pageId: "template-page",
    type: "text",
    name: "Text",
    x: 140,
    y: 140,
    width: 800,
    height: 160,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    visible: true,
    locked: false,
    fill: "#111827",
    stroke: "#000000",
    strokeWidth: 0,
    blendMode: "source-over",
    shadowColor: "#000000",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    groupId: null,
    flipX: false,
    flipY: false,
    cornerRadius: 0,
    points: [],
    src: "",
    text: "Headline",
    fontFamily: "NotoKufiArabic",
    fontSize: 92,
    fontWeight: "700",
    fontStyle: "normal",
    textDecoration: "",
    align: "left",
    lineHeight: 1.1,
    letterSpacing: 0,
    color: "#111827",
    ...overrides,
  };
}

function shapeElement(overrides: Partial<EditorElement>): EditorElement {
  return {
    id: `tpl-${Math.random().toString(36).slice(2, 8)}`,
    pageId: "template-page",
    type: "rect",
    name: "Shape",
    x: 120,
    y: 120,
    width: 260,
    height: 180,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    visible: true,
    locked: false,
    fill: "#2563eb",
    stroke: "#1e293b",
    strokeWidth: 0,
    blendMode: "source-over",
    shadowColor: "#000000",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    groupId: null,
    flipX: false,
    flipY: false,
    cornerRadius: 0,
    points: [],
    src: "",
    text: "",
    fontFamily: "NotoKufiArabic",
    fontSize: 64,
    fontWeight: "700",
    fontStyle: "normal",
    textDecoration: "",
    align: "left",
    lineHeight: 1,
    letterSpacing: 0,
    color: "#111827",
    ...overrides,
  };
}

function imageElement(src: string, overrides: Partial<EditorElement> = {}): EditorElement {
  return {
    ...shapeElement({
      type: "image",
      name: "Photo",
      width: 760,
      height: 520,
      fill: "#e5e7eb",
      src,
      ...overrides,
    }),
    type: "image",
    src,
  };
}

export const FONT_FAMILIES = [...DEFAULT_EDITOR_FONT_FAMILIES];

export const PHOTO_LIBRARY = [
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1515165562835-c3b8c2f3b6e7?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1509099836639-18ba1795216d?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1487412912498-0447578fcca8?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1463453091185-61582044d556?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1469398715555-76331a6c7f38?auto=format&fit=crop&w=900&q=80",
];

export const ELEMENT_LIBRARY: Array<{ id: string; label: string; kind: "shape" | "text"; payload: Partial<EditorElement> }> = [
  {
    id: "star-sticker",
    label: "Star Sticker",
    kind: "shape",
    payload: { type: "star", fill: "#f59e0b", width: 140, height: 140, name: "Sticker Star" },
  },
  {
    id: "speech-bubble",
    label: "Bubble",
    kind: "shape",
    payload: { type: "rect", fill: "#e0e7ff", width: 320, height: 160, cornerRadius: 28, name: "Speech Bubble" },
  },
  {
    id: "badge-pill",
    label: "Pill",
    kind: "shape",
    payload: { type: "rect", fill: "#111827", width: 240, height: 78, cornerRadius: 999, name: "Badge" },
  },
  {
    id: "arrow-mark",
    label: "Arrow",
    kind: "shape",
    payload: { type: "arrow", fill: "#dc2626", stroke: "#dc2626", strokeWidth: 8, points: [0, 0, 220, 0], width: 220, height: 40, name: "Arrow" },
  },
  {
    id: "headline-text",
    label: "Promo Text",
    kind: "text",
    payload: { text: "LIMITED OFFER", fontSize: 72, fontWeight: "800", color: "#be123c", fill: "#be123c", width: 760, name: "Promo" },
  },
  {
    id: "subtitle-text",
    label: "Description",
    kind: "text",
    payload: { text: "Build your story with drag and drop", fontSize: 38, fontWeight: "500", color: "#334155", fill: "#334155", width: 760, name: "Description" },
  },
];

export const TEMPLATE_PRESETS: EditorTemplatePreset[] = [
  {
    id: "template-modern-sale",
    name: "Modern Sale Post",
    thumbnail: "#f59e0b",
    page: {
      id: "template-page",
      name: "Modern Sale",
      width: 1080,
      height: 1350,
      background: { ...baseBackground, type: "gradient", gradientFrom: "#fff7ed", gradientTo: "#ffedd5" },
      elements: [
        textElement({ text: "Weekend Sale", fontSize: 116, x: 120, y: 120, color: "#9a3412", fill: "#9a3412", fontWeight: "800" }),
        textElement({ text: "UP TO 60% OFF", fontSize: 72, x: 120, y: 300, color: "#7c2d12", fill: "#7c2d12", fontWeight: "700" }),
        shapeElement({ type: "rect", x: 120, y: 520, width: 840, height: 560, fill: "#fb923c", cornerRadius: 42, opacity: 0.2, name: "Backdrop" }),
      ],
    },
  },
  {
    id: "template-portrait-photo",
    name: "Portrait Story",
    thumbnail: "#14b8a6",
    page: {
      id: "template-page",
      name: "Portrait Story",
      width: 1080,
      height: 1920,
      background: { ...baseBackground, color: "#0f172a" },
      elements: [
        imageElement(PHOTO_LIBRARY[0], { x: 120, y: 320, width: 840, height: 1220, cornerRadius: 36, name: "Hero" }),
        textElement({ text: "Summer Vibes", fontSize: 138, x: 120, y: 100, color: "#ffffff", fill: "#ffffff", fontFamily: "MTLombardiaLuxury", fontWeight: "700" }),
      ],
    },
  },
  {
    id: "template-event",
    name: "Event Invitation",
    thumbnail: "#8b5cf6",
    page: {
      id: "template-page",
      name: "Event Invitation",
      width: 1080,
      height: 1350,
      background: { ...baseBackground, color: "#1e1b4b" },
      elements: [
        textElement({ text: "Live Music Night", fontSize: 122, x: 110, y: 170, width: 860, color: "#f8fafc", fill: "#f8fafc", fontFamily: "MTNitroDisplay", fontWeight: "700", align: "center" }),
        textElement({ text: "Friday 9:00 PM", fontSize: 64, x: 250, y: 840, width: 580, color: "#a5b4fc", fill: "#a5b4fc", fontWeight: "600", align: "center" }),
        shapeElement({ type: "circle", x: 860, y: 1100, width: 140, height: 140, fill: "#f59e0b", name: "Accent" }),
      ],
    },
  },
  {
    id: "template-fashion",
    name: "Fashion Grid",
    thumbnail: "#ec4899",
    page: {
      id: "template-page",
      name: "Fashion Grid",
      width: 1080,
      height: 1350,
      background: { ...baseBackground, color: "#f8fafc" },
      elements: [
        imageElement(PHOTO_LIBRARY[3], { x: 80, y: 200, width: 450, height: 520, cornerRadius: 30 }),
        imageElement(PHOTO_LIBRARY[7], { x: 550, y: 200, width: 450, height: 520, cornerRadius: 30 }),
        textElement({ text: "NEW DROP", x: 120, y: 790, fontSize: 146, fontWeight: "800", color: "#be185d", fill: "#be185d" }),
      ],
    },
  },
  {
    id: "template-minimal",
    name: "Minimal Notes",
    thumbnail: "#0ea5e9",
    page: {
      id: "template-page",
      name: "Minimal Notes",
      width: 1080,
      height: 1080,
      background: { ...baseBackground, color: "#f8fafc" },
      elements: [
        textElement({ text: "pssst...", x: 420, y: 140, width: 260, fontSize: 72, color: "#111827", fill: "#111827", fontWeight: "700", align: "center" }),
        shapeElement({ type: "rect", x: 230, y: 360, width: 620, height: 540, fill: "#d6d3d1", cornerRadius: 22, name: "Card" }),
        textElement({ text: "NEW PRODUCT", x: 250, y: 480, width: 580, fontSize: 132, fontWeight: "700", color: "#f8fafc", fill: "#f8fafc", align: "center" }),
      ],
    },
  },
  {
    id: "template-kids",
    name: "Kids Storytime",
    thumbnail: "#38bdf8",
    page: {
      id: "template-page",
      name: "Kids Storytime",
      width: 1080,
      height: 1920,
      background: { ...baseBackground, color: "#38bdf8" },
      elements: [
        textElement({ text: "Kids Storytime", x: 120, y: 240, width: 840, fontSize: 154, fontWeight: "800", color: "#ffffff", fill: "#ffffff", align: "center", fontFamily: "Saudi_Regular" }),
        textElement({ text: "JUNE 15, 2040 · 8:30 PM", x: 160, y: 620, width: 760, fontSize: 72, fontWeight: "700", color: "#f8fafc", fill: "#f8fafc", align: "center", fontFamily: "Saudi_Regular" }),
        shapeElement({ type: "rect", x: 120, y: 1300, width: 840, height: 420, fill: "#84cc16", cornerRadius: 120, opacity: 0.9, name: "Hill" }),
      ],
    },
  },
  {
    id: "template-coming-soon",
    name: "Coming Soon",
    thumbnail: "#22c55e",
    page: {
      id: "template-page",
      name: "Coming Soon",
      width: 1080,
      height: 1350,
      background: { ...baseBackground, color: "#fef9c3" },
      elements: [
        shapeElement({ type: "circle", x: 80, y: 160, width: 920, height: 920, fill: "#f8fafc", opacity: 0.65, name: "Orb" }),
        textElement({ text: "Coming Soon", x: 200, y: 520, width: 680, fontSize: 170, fontWeight: "800", color: "#ef4444", fill: "#ef4444", align: "center", fontFamily: "GraphicSchoolRegular" }),
        textElement({ text: "@reallygreatsite", x: 200, y: 920, width: 680, fontSize: 64, fontWeight: "700", color: "#16a34a", fill: "#16a34a", align: "center", fontFamily: "Saudi_Regular" }),
      ],
    },
  },
  {
    id: "template-podcast",
    name: "Podcast Cover",
    thumbnail: "#0f172a",
    page: {
      id: "template-page",
      name: "Podcast",
      width: 1080,
      height: 1080,
      background: { ...baseBackground, type: "gradient", gradientFrom: "#111827", gradientTo: "#1f2937" },
      elements: [
        textElement({ text: "THE LATE SHOW", x: 120, y: 180, width: 860, fontSize: 132, color: "#f8fafc", fill: "#f8fafc", fontFamily: "MTNitroDisplay", align: "center" }),
        textElement({ text: "with KHALID", x: 220, y: 360, width: 660, fontSize: 74, color: "#a5b4fc", fill: "#a5b4fc", align: "center", fontFamily: "GraphicSchoolRegular" }),
        shapeElement({ type: "star", x: 820, y: 820, width: 180, height: 180, fill: "#facc15", name: "Star" }),
      ],
    },
  },
];
