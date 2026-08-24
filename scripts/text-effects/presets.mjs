// Starter effect library. Hand-authored: these are the materials Andalusi ships
// (gold, glitter, diamond, emerald, turquoise, ruby) plus a few of our own.
//
// All units are FRACTIONS of the font size, never pixels — the same effect has
// to hold up at 40px on a phone and 400px on a poster.
//
// Metal needs narrow alternating light/dark bands. A two-stop gradient reads as
// coloured plastic no matter which colours you pick, which is why every metal
// preset below carries 7–9 stops.

const shadow = (o = {}) => ({
  enabled: true,
  color: "rgba(0,0,0,0.5)",
  blur: 0.05,
  offsetX: 0.025,
  offsetY: 0.06,
  ...o,
});
const sheen = (o = {}) => ({
  enabled: true,
  color: "rgba(255,255,255,0.55)",
  width: 0.016,
  offsetY: -0.016,
  ...o,
});

export const PRESETS = [
  {
    slug: "gold",
    titleEn: "Gold",
    titleAr: "ذهبي",
    spec: {
      fill: {
        kind: "gradient",
        angle: 90,
        stops: [
          [0, "#5c3d0c"], [0.12, "#c99a34"], [0.26, "#fdf3c9"], [0.34, "#f0cb62"],
          [0.46, "#8a6118"], [0.54, "#e6bb52"], [0.7, "#fff8dc"], [0.82, "#b8862a"], [1, "#4a3009"],
        ],
      },
      stroke: { width: 0.05, color: "#2a1c05" },
      shadow: shadow(),
      sheen: sheen(),
    },
  },
  {
    slug: "diamond",
    titleEn: "Diamond",
    titleAr: "ألماس",
    spec: {
      fill: {
        kind: "gradient",
        angle: 105,
        stops: [
          [0, "#6d7f95"], [0.14, "#ffffff"], [0.24, "#b9c9db"], [0.36, "#ffffff"],
          [0.5, "#8fa3ba"], [0.62, "#ffffff"], [0.78, "#c6d4e3"], [1, "#7a8da0"],
        ],
      },
      stroke: { width: 0.05, color: "#182231" },
      shadow: shadow(),
      sheen: sheen({ color: "rgba(255,255,255,0.8)" }),
    },
  },
  {
    slug: "emerald",
    titleEn: "Emerald",
    titleAr: "زمرد",
    spec: {
      fill: {
        kind: "gradient",
        angle: 90,
        stops: [
          [0, "#04291d"], [0.14, "#128f63"], [0.28, "#7ff0c0"], [0.4, "#0e6e4a"],
          [0.56, "#35c98d"], [0.72, "#d9fff0"], [0.86, "#0b5638"], [1, "#032116"],
        ],
      },
      stroke: { width: 0.05, color: "#03170f" },
      shadow: shadow(),
      sheen: sheen(),
    },
  },
  {
    slug: "ruby",
    titleEn: "Ruby",
    titleAr: "ياقوت",
    spec: {
      fill: {
        kind: "gradient",
        angle: 90,
        stops: [
          [0, "#3a0410"], [0.14, "#a5122c"], [0.28, "#ff92a8"], [0.4, "#7d0a1f"],
          [0.56, "#d61f42"], [0.72, "#ffd2da"], [0.86, "#8c0d22"], [1, "#2c030c"],
        ],
      },
      stroke: { width: 0.05, color: "#1f0308" },
      shadow: shadow(),
      sheen: sheen(),
    },
  },
  {
    slug: "turquoise",
    titleEn: "Turquoise",
    titleAr: "فيروز",
    spec: {
      fill: {
        kind: "gradient",
        angle: 90,
        stops: [
          [0, "#043b43"], [0.14, "#0f9aab"], [0.28, "#9ff5fb"], [0.4, "#076f7d"],
          [0.56, "#2fc3d3"], [0.72, "#e6ffff"], [0.86, "#08707e"], [1, "#032b31"],
        ],
      },
      stroke: { width: 0.05, color: "#022229" },
      shadow: shadow(),
      sheen: sheen(),
    },
  },
  {
    slug: "glitter",
    titleEn: "Glitter",
    titleAr: "بريق",
    spec: {
      fill: {
        kind: "gradient",
        angle: 35,
        stops: [
          [0, "#c33d9a"], [0.16, "#ffd36e"], [0.3, "#fff6b8"], [0.44, "#63e6c0"],
          [0.58, "#8fb6ff"], [0.72, "#ffa3f0"], [0.86, "#fff1a8"], [1, "#a83c86"],
        ],
      },
      stroke: { width: 0.045, color: "#41143a" },
      shadow: shadow(),
      sheen: sheen(),
    },
  },
  {
    slug: "silver",
    titleEn: "Silver",
    titleAr: "فضي",
    spec: {
      fill: {
        kind: "gradient",
        angle: 90,
        stops: [
          [0, "#4b5563"], [0.15, "#cbd5e1"], [0.3, "#ffffff"], [0.45, "#94a3b8"],
          [0.6, "#e2e8f0"], [0.78, "#64748b"], [1, "#334155"],
        ],
      },
      stroke: { width: 0.05, color: "#1f2937" },
      shadow: shadow(),
      sheen: sheen(),
    },
  },
  {
    slug: "rose-gold",
    titleEn: "Rose Gold",
    titleAr: "ذهبي وردي",
    spec: {
      fill: {
        kind: "gradient",
        angle: 90,
        stops: [
          [0, "#6b3327"], [0.14, "#d59182"], [0.28, "#ffe3d8"], [0.42, "#c07866"],
          [0.58, "#f2b7a4"], [0.74, "#fff0e8"], [0.88, "#a85f4d"], [1, "#5a2a20"],
        ],
      },
      stroke: { width: 0.05, color: "#3a1a13"},
      shadow: shadow(),
      sheen: sheen(),
    },
  },
  {
    slug: "midnight",
    titleEn: "Midnight",
    titleAr: "ليلي",
    spec: {
      fill: {
        kind: "gradient",
        angle: 90,
        stops: [
          [0, "#0b1020"], [0.2, "#243b6b"], [0.42, "#6d8cd6"], [0.58, "#1b2a52"],
          [0.78, "#41609f"], [1, "#080d1a"],
        ],
      },
      stroke: { width: 0.045, color: "#c9a227" },
      shadow: shadow({ color: "rgba(0,0,0,0.6)" }),
      sheen: sheen({ color: "rgba(201,162,39,0.6)" }),
    },
  },
  {
    slug: "clean-white",
    titleEn: "Clean White",
    titleAr: "أبيض نظيف",
    spec: {
      // Deliberately plain: every effects strip needs a neutral that just makes
      // text readable over a busy photo.
      fill: { kind: "solid", color: "#ffffff" },
      stroke: { width: 0, color: "#000000" },
      shadow: shadow({ color: "rgba(0,0,0,0.35)", blur: 0.04, offsetX: 0, offsetY: 0.03 }),
      sheen: { enabled: false },
    },
  },
];

export function getPreset(slug) {
  return PRESETS.find((preset) => preset.slug === slug) || null;
}
