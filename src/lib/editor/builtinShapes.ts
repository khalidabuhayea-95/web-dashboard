export type BuiltInShapeCategoryId =
  | "lines"
  | "basic"
  | "polygons"
  | "stars"
  | "arrows"
  | "flowchart"
  | "speech"
  | "clouds"
  | "hearts"
  | "banners"
  | "drops"
  | "gears"
  | "squareStars"
  | "organic"
  | "abstract";

export interface BuiltInShapeAsset {
  id: string;
  name: string;
  category: BuiltInShapeCategoryId;
  keywords: string[];
  src: string;
  width: number;
  height: number;
}

export interface BuiltInShapeCategory {
  id: BuiltInShapeCategoryId;
  label: string;
}

export const BUILTIN_SHAPE_CATEGORIES: BuiltInShapeCategory[] = [
  { id: "lines", label: "Lines" },
  { id: "basic", label: "Basic shapes" },
  { id: "polygons", label: "Polygons" },
  { id: "stars", label: "Stars" },
  { id: "arrows", label: "Arrows" },
  { id: "flowchart", label: "Flowchart shapes" },
  { id: "speech", label: "Speech bubbles" },
  { id: "clouds", label: "Clouds" },
  { id: "hearts", label: "Hearts" },
  { id: "banners", label: "Banners" },
  { id: "drops", label: "Drop shapes" },
  { id: "gears", label: "Gear shapes" },
  { id: "squareStars", label: "Square stars" },
  { id: "organic", label: "Organic shapes" },
  { id: "abstract", label: "Abstract shapes" },
];

function toSvgDataUrl(source: string) {
  const compact = source.replace(/\s+/g, " ").trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(compact)}`;
}

function buildSvg(width: number, height: number, content: string) {
  return toSvgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">${content}</svg>`
  );
}

function polygonPoints(
  sides: number,
  cx: number,
  cy: number,
  radius: number,
  rotationDegrees = -90
) {
  const points: string[] = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = ((rotationDegrees + (360 / sides) * index) * Math.PI) / 180;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(" ");
}

function starPoints(
  pointsCount: number,
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  rotationDegrees = -90
) {
  const points: string[] = [];
  const totalPoints = pointsCount * 2;
  for (let index = 0; index < totalPoints; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = ((rotationDegrees + (360 / totalPoints) * index) * Math.PI) / 180;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(" ");
}

function createShape(
  id: string,
  name: string,
  category: BuiltInShapeCategoryId,
  width: number,
  height: number,
  content: string,
  keywords: string[]
): BuiltInShapeAsset {
  return {
    id,
    name,
    category,
    keywords,
    src: buildSvg(width, height, content),
    width,
    height,
  };
}

const SHAPE_FILL = "#111827";
const SHAPE_MUTED = "#9ca3af";

function createLineShape(
  id: string,
  name: string,
  content: string,
  keywords: string[]
) {
  return createShape(id, name, "lines", 160, 32, content, keywords);
}

function createBasicShape(
  id: string,
  name: string,
  content: string,
  keywords: string[]
) {
  return createShape(id, name, "basic", 120, 120, content, keywords);
}

function createPolygonShape(
  id: string,
  name: string,
  sides: number,
  keywords: string[]
) {
  return createShape(
    id,
    name,
    "polygons",
    120,
    120,
    `<polygon points="${polygonPoints(sides, 60, 60, 48)}" fill="${SHAPE_FILL}" />`,
    keywords
  );
}

function createStarShape(
  id: string,
  name: string,
  pointsCount: number,
  outerRadius: number,
  innerRadius: number,
  keywords: string[],
  rotationDegrees = -90
) {
  return createShape(
    id,
    name,
    "stars",
    120,
    120,
    `<polygon points="${starPoints(
      pointsCount,
      60,
      60,
      outerRadius,
      innerRadius,
      rotationDegrees
    )}" fill="${SHAPE_FILL}" />`,
    keywords
  );
}

export const BUILTIN_SHAPE_ASSETS: BuiltInShapeAsset[] = [
  createLineShape(
    "line-solid",
    "Solid line",
    `<line x1="10" y1="16" x2="150" y2="16" stroke="${SHAPE_FILL}" stroke-width="6" stroke-linecap="round" />`,
    ["line", "divider", "separator", "solid"]
  ),
  createLineShape(
    "line-thick",
    "Bold line",
    `<line x1="10" y1="16" x2="150" y2="16" stroke="${SHAPE_FILL}" stroke-width="12" stroke-linecap="round" />`,
    ["line", "divider", "separator", "bold", "thick"]
  ),
  createLineShape(
    "line-dashed",
    "Dashed line",
    `<line x1="10" y1="16" x2="150" y2="16" stroke="${SHAPE_FILL}" stroke-width="6" stroke-linecap="round" stroke-dasharray="18 14" />`,
    ["line", "divider", "separator", "dash", "dashed"]
  ),
  createLineShape(
    "line-dotted",
    "Dotted line",
    `<line x1="10" y1="16" x2="150" y2="16" stroke="${SHAPE_FILL}" stroke-width="6" stroke-linecap="round" stroke-dasharray="1 12" />`,
    ["line", "divider", "separator", "dots", "dotted"]
  ),
  createLineShape(
    "line-double",
    "Double line",
    `<line x1="10" y1="11" x2="150" y2="11" stroke="${SHAPE_FILL}" stroke-width="4" stroke-linecap="round" />
     <line x1="10" y1="21" x2="150" y2="21" stroke="${SHAPE_FILL}" stroke-width="4" stroke-linecap="round" />`,
    ["line", "divider", "separator", "double"]
  ),
  createLineShape(
    "line-circle-endpoints",
    "Circle endpoints",
    `<line x1="18" y1="16" x2="142" y2="16" stroke="${SHAPE_FILL}" stroke-width="4" />
     <circle cx="18" cy="16" r="7" stroke="${SHAPE_FILL}" stroke-width="3" fill="white" />
     <circle cx="142" cy="16" r="7" stroke="${SHAPE_FILL}" stroke-width="3" fill="white" />`,
    ["line", "circle", "endpoints", "connector", "divider"]
  ),
  createLineShape(
    "line-square-endpoints",
    "Square endpoints",
    `<line x1="18" y1="16" x2="142" y2="16" stroke="${SHAPE_FILL}" stroke-width="4" />
     <rect x="10" y="8" width="16" height="16" stroke="${SHAPE_FILL}" stroke-width="3" fill="white" />
     <rect x="134" y="8" width="16" height="16" stroke="${SHAPE_FILL}" stroke-width="3" fill="white" />`,
    ["line", "square", "endpoints", "connector", "divider"]
  ),
  createLineShape(
    "line-diamond-endpoints",
    "Diamond endpoints",
    `<line x1="22" y1="16" x2="138" y2="16" stroke="${SHAPE_FILL}" stroke-width="4" />
     <polygon points="18,16 24,10 30,16 24,22" stroke="${SHAPE_FILL}" stroke-width="3" fill="white" />
     <polygon points="130,16 136,10 142,16 136,22" stroke="${SHAPE_FILL}" stroke-width="3" fill="white" />`,
    ["line", "diamond", "endpoints", "connector", "divider"]
  ),
  createLineShape(
    "line-square-dots",
    "Square divider",
    `<rect x="12" y="10" width="10" height="10" fill="${SHAPE_FILL}" />
     <rect x="38" y="10" width="10" height="10" fill="${SHAPE_FILL}" />
     <rect x="64" y="10" width="10" height="10" fill="${SHAPE_FILL}" />
     <rect x="90" y="10" width="10" height="10" fill="${SHAPE_FILL}" />
     <rect x="116" y="10" width="10" height="10" fill="${SHAPE_FILL}" />
     <rect x="142" y="10" width="10" height="10" fill="${SHAPE_FILL}" />`,
    ["line", "divider", "separator", "square", "dots"]
  ),
  createLineShape(
    "line-diamond-dots",
    "Diamond divider",
    `<polygon points="18,16 24,10 30,16 24,22" fill="${SHAPE_FILL}" />
     <polygon points="44,16 50,10 56,16 50,22" fill="${SHAPE_FILL}" />
     <polygon points="70,16 76,10 82,16 76,22" fill="${SHAPE_FILL}" />
     <polygon points="96,16 102,10 108,16 102,22" fill="${SHAPE_FILL}" />
     <polygon points="122,16 128,10 134,16 128,22" fill="${SHAPE_FILL}" />`,
    ["line", "divider", "separator", "diamond"]
  ),
  createLineShape(
    "line-arrow-right",
    "Line arrow",
    `<line x1="12" y1="16" x2="132" y2="16" stroke="${SHAPE_FILL}" stroke-width="5" stroke-linecap="round" />
     <path d="M114 6 L148 16 L114 26" stroke="${SHAPE_FILL}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />`,
    ["line", "arrow", "right", "divider", "direction"]
  ),
  createLineShape(
    "line-arrow-left",
    "Left line arrow",
    `<line x1="28" y1="16" x2="148" y2="16" stroke="${SHAPE_FILL}" stroke-width="5" stroke-linecap="round" />
     <path d="M46 6 L12 16 L46 26" stroke="${SHAPE_FILL}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />`,
    ["line", "arrow", "left", "divider", "direction"]
  ),
  createLineShape(
    "line-arrow-both",
    "Double line arrow",
    `<line x1="28" y1="16" x2="132" y2="16" stroke="${SHAPE_FILL}" stroke-width="5" stroke-linecap="round" />
     <path d="M46 6 L12 16 L46 26" stroke="${SHAPE_FILL}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
     <path d="M114 6 L148 16 L114 26" stroke="${SHAPE_FILL}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />`,
    ["line", "arrow", "double", "divider", "direction"]
  ),
  createLineShape(
    "line-triple",
    "Triple line",
    `<line x1="10" y1="8" x2="150" y2="8" stroke="${SHAPE_FILL}" stroke-width="3" stroke-linecap="round" />
     <line x1="10" y1="16" x2="150" y2="16" stroke="${SHAPE_FILL}" stroke-width="3" stroke-linecap="round" />
     <line x1="10" y1="24" x2="150" y2="24" stroke="${SHAPE_FILL}" stroke-width="3" stroke-linecap="round" />`,
    ["line", "divider", "separator", "triple"]
  ),
  createLineShape(
    "line-long-dash",
    "Long dashed line",
    `<line x1="10" y1="16" x2="150" y2="16" stroke="${SHAPE_FILL}" stroke-width="6" stroke-linecap="round" stroke-dasharray="28 12" />`,
    ["line", "divider", "separator", "long dash", "dashed"]
  ),
  createLineShape(
    "line-dash-dot",
    "Dash dot line",
    `<line x1="10" y1="16" x2="150" y2="16" stroke="${SHAPE_FILL}" stroke-width="5" stroke-linecap="round" stroke-dasharray="18 10 2 10" />`,
    ["line", "divider", "separator", "dash dot"]
  ),
  createLineShape(
    "line-centered-dot",
    "Centered dot line",
    `<line x1="10" y1="16" x2="64" y2="16" stroke="${SHAPE_FILL}" stroke-width="4" stroke-linecap="round" />
     <circle cx="80" cy="16" r="7" fill="${SHAPE_FILL}" />
     <line x1="96" y1="16" x2="150" y2="16" stroke="${SHAPE_FILL}" stroke-width="4" stroke-linecap="round" />`,
    ["line", "divider", "separator", "center dot"]
  ),
  createBasicShape(
    "shape-square",
    "Square",
    `<rect x="16" y="16" width="88" height="88" fill="${SHAPE_FILL}" />`,
    ["square", "basic", "box", "shape"]
  ),
  createBasicShape(
    "shape-rounded-square",
    "Rounded square",
    `<rect x="14" y="14" width="92" height="92" rx="24" fill="${SHAPE_FILL}" />`,
    ["rounded", "square", "basic", "box", "shape"]
  ),
  createBasicShape(
    "shape-blob-square",
    "Soft square",
    `<path d="M26 18 C42 12 78 12 94 20 C108 28 110 52 104 68 C98 86 84 108 64 108 C46 108 22 100 16 78 C10 56 10 24 26 18 Z" fill="${SHAPE_FILL}" />`,
    ["soft", "blob", "rounded", "square", "basic", "shape"]
  ),
  createBasicShape(
    "shape-circle",
    "Circle",
    `<circle cx="60" cy="60" r="46" fill="${SHAPE_FILL}" />`,
    ["circle", "round", "basic", "shape"]
  ),
  createBasicShape(
    "shape-semicircle",
    "Semicircle",
    `<path d="M14 92 A46 46 0 0 1 106 92 L106 106 L14 106 Z" fill="${SHAPE_FILL}" />`,
    ["semicircle", "half circle", "basic", "shape"]
  ),
  createBasicShape(
    "shape-quarter-circle",
    "Quarter circle",
    `<path d="M12 108 V12 H108 A96 96 0 0 0 12 108 Z" fill="${SHAPE_FILL}" />`,
    ["quarter circle", "curve", "basic", "shape"]
  ),
  createBasicShape(
    "shape-arch",
    "Arch",
    `<path d="M20 106 V62 A40 40 0 0 1 100 62 V106 Z" fill="${SHAPE_FILL}" />`,
    ["arch", "door", "rounded top", "basic", "shape"]
  ),
  createBasicShape(
    "shape-pill",
    "Pill",
    `<rect x="10" y="34" width="100" height="52" rx="26" fill="${SHAPE_FILL}" />`,
    ["pill", "capsule", "rounded", "basic", "shape"]
  ),
  createBasicShape(
    "shape-triangle",
    "Triangle",
    `<polygon points="60,14 108,106 12,106" fill="${SHAPE_FILL}" />`,
    ["triangle", "basic", "shape"]
  ),
  createBasicShape(
    "shape-inverted-triangle",
    "Inverted triangle",
    `<polygon points="12,14 108,14 60,106" fill="${SHAPE_FILL}" />`,
    ["triangle", "inverted", "basic", "shape"]
  ),
  createBasicShape(
    "shape-trapezoid",
    "Trapezoid",
    `<polygon points="30,18 90,18 108,102 12,102" fill="${SHAPE_FILL}" />`,
    ["trapezoid", "basic", "shape"]
  ),
  createBasicShape(
    "shape-parallelogram",
    "Parallelogram",
    `<polygon points="34,16 108,16 86,104 12,104" fill="${SHAPE_FILL}" />`,
    ["parallelogram", "slanted", "basic", "shape"]
  ),
  createBasicShape(
    "shape-diamond",
    "Diamond",
    `<polygon points="60,10 108,60 60,110 12,60" fill="${SHAPE_FILL}" />`,
    ["diamond", "rhombus", "basic", "shape"]
  ),
  createBasicShape(
    "shape-frame",
    "Picture frame",
    `<rect x="18" y="24" width="84" height="72" fill="white" stroke="${SHAPE_FILL}" stroke-width="10" />
     <rect x="30" y="36" width="60" height="48" fill="white" stroke="${SHAPE_MUTED}" stroke-width="2" stroke-dasharray="4 4" />`,
    ["frame", "picture", "border", "basic", "shape"]
  ),
  createShape(
    "shape-light-frame-9x19",
    "Light frame",
    "basic",
    180,
    380,
    `<rect x="6" y="6" width="168" height="368" fill="none" stroke="#cbd5e1" stroke-width="4" />`,
    ["frame", "light", "border", "portrait", "9:19", "story", "mobile", "basic", "shape"]
  ),
  createBasicShape(
    "shape-heart",
    "Heart",
    `<path d="M60 103 C20 78 10 50 10 34 C10 18 22 8 38 8 C50 8 58 15 60 23 C62 15 70 8 82 8 C98 8 110 18 110 34 C110 50 100 78 60 103 Z" fill="${SHAPE_FILL}" />`,
    ["heart", "basic", "shape"]
  ),
  createPolygonShape(
    "polygon-pentagon",
    "Pentagon",
    5,
    ["polygon", "pentagon", "five sides", "shape"]
  ),
  createPolygonShape(
    "polygon-hexagon",
    "Hexagon",
    6,
    ["polygon", "hexagon", "six sides", "shape"]
  ),
  createPolygonShape(
    "polygon-heptagon",
    "Heptagon",
    7,
    ["polygon", "heptagon", "seven sides", "shape"]
  ),
  createPolygonShape(
    "polygon-octagon",
    "Octagon",
    8,
    ["polygon", "octagon", "eight sides", "shape"]
  ),
  createPolygonShape(
    "polygon-nonagon",
    "Nonagon",
    9,
    ["polygon", "nonagon", "nine sides", "shape"]
  ),
  createPolygonShape(
    "polygon-decagon",
    "Decagon",
    10,
    ["polygon", "decagon", "ten sides", "shape"]
  ),
  createPolygonShape(
    "polygon-dodecagon",
    "Dodecagon",
    12,
    ["polygon", "dodecagon", "twelve sides", "shape"]
  ),
  createPolygonShape(
    "polygon-undecagon",
    "Undecagon",
    11,
    ["polygon", "undecagon", "eleven sides", "shape"]
  ),
  createPolygonShape(
    "polygon-tridecagon",
    "Tridecagon",
    13,
    ["polygon", "tridecagon", "thirteen sides", "shape"]
  ),
  createPolygonShape(
    "polygon-tetradecagon",
    "Tetradecagon",
    14,
    ["polygon", "tetradecagon", "fourteen sides", "shape"]
  ),
  createPolygonShape(
    "polygon-pentadecagon",
    "Pentadecagon",
    15,
    ["polygon", "pentadecagon", "fifteen sides", "shape"]
  ),
  createPolygonShape(
    "polygon-hexadecagon",
    "Hexadecagon",
    16,
    ["polygon", "hexadecagon", "sixteen sides", "shape"]
  ),
  createShape(
    "polygon-flat-hexagon",
    "Flat hexagon",
    "polygons",
    140,
    120,
    `<polygon points="24,60 44,22 96,22 116,60 96,98 44,98" fill="${SHAPE_FILL}" />`,
    ["polygon", "hexagon", "flat", "shape"]
  ),
  createStarShape(
    "star-four",
    "Four-point star",
    4,
    48,
    22,
    ["star", "four point", "shape"],
    -45
  ),
  createStarShape(
    "star-four-soft",
    "Soft four-point star",
    4,
    46,
    30,
    ["star", "four point", "soft", "shape"],
    -45
  ),
  createStarShape(
    "star-five",
    "Five-point star",
    5,
    48,
    20,
    ["star", "five point", "shape"]
  ),
  createStarShape(
    "star-six",
    "Six-point star",
    6,
    48,
    24,
    ["star", "six point", "shape"]
  ),
  createStarShape(
    "star-seven",
    "Seven-point star",
    7,
    48,
    26,
    ["star", "seven point", "shape"]
  ),
  createStarShape(
    "star-eight",
    "Eight-point star",
    8,
    48,
    28,
    ["star", "eight point", "shape"]
  ),
  createStarShape(
    "star-ten",
    "Ten-point star",
    10,
    48,
    30,
    ["star", "ten point", "shape"]
  ),
  createStarShape(
    "star-burst",
    "Burst star",
    12,
    48,
    30,
    ["star", "burst", "badge", "shape"]
  ),
  createStarShape(
    "star-sparkle",
    "Sparkle",
    8,
    48,
    18,
    ["star", "sparkle", "badge", "shape"]
  ),
  createStarShape(
    "star-nine",
    "Nine-point star",
    9,
    48,
    27,
    ["star", "nine point", "shape"]
  ),
  createStarShape(
    "star-eleven",
    "Eleven-point star",
    11,
    48,
    28,
    ["star", "eleven point", "shape"]
  ),
  createStarShape(
    "star-twelve",
    "Twelve-point star",
    12,
    48,
    26,
    ["star", "twelve point", "shape"]
  ),
  createStarShape(
    "star-sixteen",
    "Sixteen-point star",
    16,
    48,
    30,
    ["star", "sixteen point", "shape"]
  ),
  createShape(
    "star-diamond-sparkle",
    "Diamond sparkle",
    "stars",
    120,
    120,
    `<polygon points="${starPoints(4, 60, 60, 50, 16, -45)}" fill="${SHAPE_FILL}" />
     <polygon points="${starPoints(4, 60, 60, 30, 10, 0)}" fill="${SHAPE_FILL}" />`,
    ["star", "diamond", "sparkle", "shape"]
  ),
  createShape(
    "star-shuriken",
    "Shuriken star",
    "stars",
    120,
    120,
    `<polygon points="60,8 76,40 112,48 84,72 92,112 60,92 28,112 36,72 8,48 44,40" fill="${SHAPE_FILL}" />`,
    ["star", "shuriken", "shape"]
  ),
  createShape(
    "arrow-right-outline",
    "Right arrow",
    "arrows",
    160,
    120,
    `<path d="M18 60 H122" stroke="${SHAPE_FILL}" stroke-width="12" stroke-linecap="round" />
     <path d="M98 28 L142 60 L98 92" stroke="${SHAPE_FILL}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />`,
    ["arrow", "right", "outline", "direction"]
  ),
  createShape(
    "arrow-left-outline",
    "Left arrow",
    "arrows",
    160,
    120,
    `<path d="M38 60 H142" stroke="${SHAPE_FILL}" stroke-width="12" stroke-linecap="round" />
     <path d="M62 28 L18 60 L62 92" stroke="${SHAPE_FILL}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />`,
    ["arrow", "left", "outline", "direction"]
  ),
  createShape(
    "arrow-up-outline",
    "Up arrow",
    "arrows",
    120,
    160,
    `<path d="M60 142 V38" stroke="${SHAPE_FILL}" stroke-width="12" stroke-linecap="round" />
     <path d="M28 62 L60 18 L92 62" stroke="${SHAPE_FILL}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />`,
    ["arrow", "up", "outline", "direction"]
  ),
  createShape(
    "arrow-down-outline",
    "Down arrow",
    "arrows",
    120,
    160,
    `<path d="M60 18 V122" stroke="${SHAPE_FILL}" stroke-width="12" stroke-linecap="round" />
     <path d="M28 98 L60 142 L92 98" stroke="${SHAPE_FILL}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />`,
    ["arrow", "down", "outline", "direction"]
  ),
  createShape(
    "arrow-double",
    "Double arrow",
    "arrows",
    160,
    120,
    `<path d="M26 60 H134" stroke="${SHAPE_FILL}" stroke-width="10" stroke-linecap="round" />
     <path d="M52 32 L18 60 L52 88" stroke="${SHAPE_FILL}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
     <path d="M108 32 L142 60 L108 88" stroke="${SHAPE_FILL}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />`,
    ["arrow", "double", "two way", "direction"]
  ),
  createShape(
    "arrow-block-right",
    "Block arrow",
    "arrows",
    160,
    120,
    `<path d="M18 42 H88 V20 L142 60 L88 100 V78 H18 Z" fill="${SHAPE_FILL}" />`,
    ["arrow", "block", "filled", "right", "direction"]
  ),
  createShape(
    "arrow-block-left",
    "Block left arrow",
    "arrows",
    160,
    120,
    `<path d="M142 42 H72 V20 L18 60 L72 100 V78 H142 Z" fill="${SHAPE_FILL}" />`,
    ["arrow", "block", "filled", "left", "direction"]
  ),
  createShape(
    "arrow-chevron-right",
    "Chevron arrow",
    "arrows",
    160,
    120,
    `<path d="M48 22 L104 60 L48 98" stroke="${SHAPE_FILL}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" />`,
    ["arrow", "chevron", "right", "direction"]
  ),
  createShape(
    "arrow-bent-right",
    "Bent arrow",
    "arrows",
    160,
    120,
    `<path d="M32 92 V40 H116" stroke="${SHAPE_FILL}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
     <path d="M96 20 L142 40 L96 60" fill="${SHAPE_FILL}" />`,
    ["arrow", "bent", "corner", "right", "direction"]
  ),
  createShape(
    "arrow-curved-right",
    "Curved arrow",
    "arrows",
    160,
    120,
    `<path d="M36 86 C36 40 64 24 104 24 H118" stroke="${SHAPE_FILL}" stroke-width="10" stroke-linecap="round" />
     <path d="M98 8 L142 24 L98 42" fill="${SHAPE_FILL}" />`,
    ["arrow", "curved", "right", "direction"]
  ),
  createShape(
    "arrow-curved-left",
    "Curved left arrow",
    "arrows",
    160,
    120,
    `<path d="M124 86 C124 40 96 24 56 24 H42" stroke="${SHAPE_FILL}" stroke-width="10" stroke-linecap="round" />
     <path d="M62 8 L18 24 L62 42" fill="${SHAPE_FILL}" />`,
    ["arrow", "curved", "left", "direction"]
  ),
  createShape(
    "arrow-chevron-left",
    "Left chevron arrow",
    "arrows",
    160,
    120,
    `<path d="M112 22 L56 60 L112 98" stroke="${SHAPE_FILL}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" />`,
    ["arrow", "chevron", "left", "direction"]
  ),
  createShape(
    "arrow-chevron-up",
    "Up chevron arrow",
    "arrows",
    120,
    160,
    `<path d="M22 100 L60 44 L98 100" stroke="${SHAPE_FILL}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" />`,
    ["arrow", "chevron", "up", "direction"]
  ),
  createShape(
    "arrow-chevron-down",
    "Down chevron arrow",
    "arrows",
    120,
    160,
    `<path d="M22 60 L60 116 L98 60" stroke="${SHAPE_FILL}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" />`,
    ["arrow", "chevron", "down", "direction"]
  ),
  createShape(
    "arrow-block-up",
    "Block up arrow",
    "arrows",
    120,
    160,
    `<path d="M42 142 V72 H20 L60 18 L100 72 H78 V142 Z" fill="${SHAPE_FILL}" />`,
    ["arrow", "block", "filled", "up", "direction"]
  ),
  createShape(
    "arrow-block-down",
    "Block down arrow",
    "arrows",
    120,
    160,
    `<path d="M42 18 V88 H20 L60 142 L100 88 H78 V18 Z" fill="${SHAPE_FILL}" />`,
    ["arrow", "block", "filled", "down", "direction"]
  ),
  createShape(
    "arrow-bent-left",
    "Bent left arrow",
    "arrows",
    160,
    120,
    `<path d="M128 92 V40 H44" stroke="${SHAPE_FILL}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
     <path d="M64 20 L18 40 L64 60" fill="${SHAPE_FILL}" />`,
    ["arrow", "bent", "corner", "left", "direction"]
  ),
  createShape(
    "arrow-bent-up",
    "Bent up arrow",
    "arrows",
    120,
    160,
    `<path d="M24 128 H76 V44" stroke="${SHAPE_FILL}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
     <path d="M56 64 L76 18 L96 64" fill="${SHAPE_FILL}" />`,
    ["arrow", "bent", "up", "direction"]
  ),
  createShape(
    "arrow-bent-down",
    "Bent down arrow",
    "arrows",
    120,
    160,
    `<path d="M24 32 H76 V116" stroke="${SHAPE_FILL}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
     <path d="M56 96 L76 142 L96 96" fill="${SHAPE_FILL}" />`,
    ["arrow", "bent", "down", "direction"]
  ),
  createShape(
    "arrow-uturn-right",
    "U-turn arrow",
    "arrows",
    160,
    140,
    `<path d="M116 118 H54 C34 118 20 104 20 84 V36" stroke="${SHAPE_FILL}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
     <path d="M92 98 L142 118 L92 138" fill="${SHAPE_FILL}" />
     <path d="M0 56 L20 10 L40 56" fill="${SHAPE_FILL}" />`,
    ["arrow", "u turn", "right", "direction"]
  ),
  createShape(
    "flowchart-document",
    "Document",
    "flowchart",
    140,
    110,
    `<path d="M18 18 H122 V82 C110 74 96 74 84 82 C72 90 58 90 46 82 C34 74 26 74 18 80 Z" fill="${SHAPE_FILL}" />`,
    ["flowchart", "document", "process"]
  ),
  createShape(
    "flowchart-diamond",
    "Decision",
    "flowchart",
    120,
    120,
    `<polygon points="60,12 108,60 60,108 12,60" fill="${SHAPE_FILL}" />`,
    ["flowchart", "decision", "diamond"]
  ),
  createShape(
    "flowchart-process",
    "Process",
    "flowchart",
    140,
    110,
    `<rect x="14" y="20" width="112" height="70" rx="10" fill="${SHAPE_FILL}" />`,
    ["flowchart", "process", "rectangle"]
  ),
  createShape(
    "flowchart-terminator",
    "Terminator",
    "flowchart",
    140,
    110,
    `<rect x="12" y="28" width="116" height="54" rx="27" fill="${SHAPE_FILL}" />`,
    ["flowchart", "terminator", "pill"]
  ),
  createShape(
    "flowchart-hexagon",
    "Preparation",
    "flowchart",
    140,
    110,
    `<polygon points="34,20 106,20 128,55 106,90 34,90 12,55" fill="${SHAPE_FILL}" />`,
    ["flowchart", "preparation", "hexagon"]
  ),
  createShape(
    "speech-round-left",
    "Round bubble left",
    "speech",
    140,
    110,
    `<path d="M28 22 H96 C114 22 128 36 128 54 C128 72 114 86 96 86 H56 L30 100 L38 86 H28 C16 86 8 78 8 66 V42 C8 30 16 22 28 22 Z" fill="${SHAPE_FILL}" />`,
    ["speech", "bubble", "round", "left"]
  ),
  createShape(
    "speech-square-left",
    "Square bubble left",
    "speech",
    140,
    110,
    `<path d="M18 20 H122 V78 H66 L36 100 L42 78 H18 Z" fill="${SHAPE_FILL}" />`,
    ["speech", "bubble", "square", "left"]
  ),
  createShape(
    "speech-cloud",
    "Cloud bubble",
    "speech",
    140,
    110,
    `<path d="M38 80 C18 80 14 52 34 46 C34 28 56 20 68 34 C78 18 106 22 110 44 C130 46 132 76 112 80 H82 L62 98 L66 80 Z" fill="${SHAPE_FILL}" />`,
    ["speech", "bubble", "cloud"]
  ),
  createShape(
    "speech-round-right",
    "Round bubble right",
    "speech",
    140,
    110,
    `<path d="M44 22 H112 C124 22 132 30 132 42 V66 C132 78 124 86 112 86 H102 L110 100 L80 86 H44 C26 86 12 72 12 54 C12 36 26 22 44 22 Z" fill="${SHAPE_FILL}" />`,
    ["speech", "bubble", "round", "right"]
  ),
  createShape(
    "speech-square-right",
    "Square bubble right",
    "speech",
    140,
    110,
    `<path d="M18 20 H122 V78 H96 L102 100 L72 78 H18 Z" fill="${SHAPE_FILL}" />`,
    ["speech", "bubble", "square", "right"]
  ),
  createShape(
    "cloud-small",
    "Small cloud",
    "clouds",
    140,
    110,
    `<path d="M30 78 C14 78 12 56 28 52 C28 34 48 26 60 38 C70 18 100 24 102 48 C120 50 122 78 104 78 Z" fill="${SHAPE_FILL}" />`,
    ["cloud", "small", "weather"]
  ),
  createShape(
    "cloud-round",
    "Round cloud",
    "clouds",
    140,
    110,
    `<path d="M28 78 C12 78 10 54 28 50 C30 30 50 18 66 30 C80 14 108 18 112 46 C128 48 132 78 112 78 Z" fill="${SHAPE_FILL}" />`,
    ["cloud", "round", "weather"]
  ),
  createShape(
    "cloud-wide",
    "Wide cloud",
    "clouds",
    150,
    110,
    `<path d="M26 80 C10 80 6 58 24 52 C26 34 48 20 68 30 C84 14 110 18 120 38 C138 38 144 60 132 72 C126 78 118 80 108 80 Z" fill="${SHAPE_FILL}" />`,
    ["cloud", "wide", "weather"]
  ),
  createShape(
    "cloud-fluffy",
    "Fluffy cloud",
    "clouds",
    150,
    110,
    `<path d="M32 84 C14 84 10 58 30 54 C30 30 54 20 70 36 C82 18 108 18 118 38 C136 38 142 62 128 76 C122 82 114 84 102 84 Z" fill="${SHAPE_FILL}" />`,
    ["cloud", "fluffy", "weather"]
  ),
  createShape(
    "cloud-heavy",
    "Heavy cloud",
    "clouds",
    150,
    110,
    `<path d="M28 82 C8 82 6 54 24 48 C28 28 50 18 68 28 C82 10 112 16 122 40 C140 40 146 66 130 78 C122 82 114 82 102 82 Z" fill="${SHAPE_FILL}" />`,
    ["cloud", "heavy", "weather"]
  ),
  createShape(
    "heart-tall",
    "Tall heart",
    "hearts",
    120,
    120,
    `<path d="M60 108 C24 82 18 52 18 34 C18 18 30 8 42 8 C52 8 58 14 60 22 C62 14 68 8 78 8 C90 8 102 18 102 34 C102 52 96 82 60 108 Z" fill="${SHAPE_FILL}" />`,
    ["heart", "tall"]
  ),
  createShape(
    "heart-classic",
    "Classic heart",
    "hearts",
    120,
    120,
    `<path d="M60 103 C20 78 10 50 10 34 C10 18 22 8 38 8 C50 8 58 15 60 23 C62 15 70 8 82 8 C98 8 110 18 110 34 C110 50 100 78 60 103 Z" fill="${SHAPE_FILL}" />`,
    ["heart", "classic"]
  ),
  createShape(
    "heart-wide",
    "Wide heart",
    "hearts",
    140,
    110,
    `<path d="M70 96 C24 70 14 48 14 30 C14 16 28 8 42 8 C58 8 66 18 70 28 C74 18 82 8 98 8 C112 8 126 16 126 30 C126 48 116 70 70 96 Z" fill="${SHAPE_FILL}" />`,
    ["heart", "wide"]
  ),
  createShape(
    "heart-rounded",
    "Rounded heart",
    "hearts",
    120,
    120,
    `<path d="M60 100 C26 78 18 56 18 38 C18 22 30 14 42 14 C52 14 58 20 60 28 C62 20 68 14 78 14 C90 14 102 22 102 38 C102 56 94 78 60 100 Z" fill="${SHAPE_FILL}" />`,
    ["heart", "rounded"]
  ),
  createShape(
    "heart-soft",
    "Soft heart",
    "hearts",
    120,
    120,
    `<path d="M60 102 C30 82 20 62 20 42 C20 24 32 12 46 12 C56 12 60 20 60 28 C60 20 64 12 74 12 C88 12 100 24 100 42 C100 62 90 82 60 102 Z" fill="${SHAPE_FILL}" />`,
    ["heart", "soft"]
  ),
  createShape(
    "banner-bookmark",
    "Bookmark banner",
    "banners",
    120,
    120,
    `<path d="M28 14 H92 V104 L60 82 L28 104 Z" fill="${SHAPE_FILL}" />`,
    ["banner", "bookmark", "flag"]
  ),
  createShape(
    "banner-pointed",
    "Pointed banner",
    "banners",
    120,
    120,
    `<path d="M30 14 H90 V92 L60 108 L30 92 Z" fill="${SHAPE_FILL}" />`,
    ["banner", "pointed", "flag"]
  ),
  createShape(
    "banner-swallowtail",
    "Swallowtail banner",
    "banners",
    140,
    110,
    `<path d="M20 18 H120 V76 L92 92 L70 76 L48 92 L20 76 Z" fill="${SHAPE_FILL}" />`,
    ["banner", "swallowtail", "flag"]
  ),
  createShape(
    "banner-notch",
    "Notch banner",
    "banners",
    140,
    110,
    `<path d="M20 18 H120 V86 L70 72 L20 86 Z" fill="${SHAPE_FILL}" />`,
    ["banner", "notch", "flag"]
  ),
  createShape(
    "banner-ribbon",
    "Ribbon label",
    "banners",
    150,
    110,
    `<path d="M20 34 H112 L132 54 L112 74 H20 L30 54 Z" fill="${SHAPE_FILL}" />`,
    ["banner", "ribbon", "label"]
  ),
  createShape(
    "drop-thin",
    "Thin drop",
    "drops",
    120,
    120,
    `<path d="M60 12 C78 40 92 58 92 78 C92 96 78 110 60 110 C42 110 28 96 28 78 C28 58 42 40 60 12 Z" fill="${SHAPE_FILL}" />`,
    ["drop", "thin", "teardrop"]
  ),
  createShape(
    "drop-round",
    "Round drop",
    "drops",
    120,
    120,
    `<path d="M60 10 C82 38 96 58 96 78 C96 100 80 112 60 112 C40 112 24 100 24 78 C24 58 38 38 60 10 Z" fill="${SHAPE_FILL}" />`,
    ["drop", "round", "teardrop"]
  ),
  createShape(
    "drop-classic",
    "Classic drop",
    "drops",
    120,
    120,
    `<path d="M60 10 C76 32 98 56 98 80 C98 100 82 112 60 112 C38 112 22 100 22 80 C22 56 44 32 60 10 Z" fill="${SHAPE_FILL}" />`,
    ["drop", "classic", "teardrop"]
  ),
  createShape(
    "drop-pin",
    "Pin drop",
    "drops",
    120,
    120,
    `<path d="M60 12 C78 36 92 54 92 76 C92 96 78 108 60 112 C42 108 28 96 28 76 C28 54 42 36 60 12 Z" fill="${SHAPE_FILL}" />`,
    ["drop", "pin", "marker"]
  ),
  createShape(
    "drop-short",
    "Short drop",
    "drops",
    120,
    120,
    `<path d="M60 20 C78 42 90 58 90 78 C90 98 76 110 60 110 C44 110 30 98 30 78 C30 58 42 42 60 20 Z" fill="${SHAPE_FILL}" />`,
    ["drop", "short", "teardrop"]
  ),
  createShape(
    "gear-eight",
    "Gear eight",
    "gears",
    120,
    120,
    `<g fill="${SHAPE_FILL}">
       <rect x="54" y="4" width="12" height="24" />
       <rect x="54" y="92" width="12" height="24" />
       <rect x="4" y="54" width="24" height="12" />
       <rect x="92" y="54" width="24" height="12" />
       <rect x="18" y="18" width="18" height="18" transform="rotate(45 27 27)" />
       <rect x="84" y="18" width="18" height="18" transform="rotate(45 93 27)" />
       <rect x="18" y="84" width="18" height="18" transform="rotate(45 27 93)" />
       <rect x="84" y="84" width="18" height="18" transform="rotate(45 93 93)" />
       <circle cx="60" cy="60" r="34" />
     </g>
     <circle cx="60" cy="60" r="16" fill="white" />`,
    ["gear", "cog", "eight"]
  ),
  createShape(
    "gear-sun",
    "Sun gear",
    "gears",
    120,
    120,
    `<polygon points="${starPoints(12, 60, 60, 52, 40)}" fill="${SHAPE_FILL}" />
     <circle cx="60" cy="60" r="18" fill="white" />`,
    ["gear", "sun", "cog"]
  ),
  createShape(
    "gear-spike",
    "Spiky gear",
    "gears",
    120,
    120,
    `<polygon points="${starPoints(14, 60, 60, 52, 36)}" fill="${SHAPE_FILL}" />
     <circle cx="60" cy="60" r="18" fill="white" />`,
    ["gear", "spike", "cog"]
  ),
  createShape(
    "gear-thick",
    "Thick gear",
    "gears",
    120,
    120,
    `<polygon points="${starPoints(10, 60, 60, 52, 38)}" fill="${SHAPE_FILL}" />
     <circle cx="60" cy="60" r="20" fill="white" />`,
    ["gear", "thick", "cog"]
  ),
  createShape(
    "gear-round",
    "Round gear",
    "gears",
    120,
    120,
    `<polygon points="${starPoints(8, 60, 60, 50, 40)}" fill="${SHAPE_FILL}" />
     <circle cx="60" cy="60" r="22" fill="white" />`,
    ["gear", "round", "cog"]
  ),
  createShape(
    "square-star-cross",
    "Cross star",
    "squareStars",
    120,
    120,
    `<polygon points="48,8 72,8 72,48 112,48 112,72 72,72 72,112 48,112 48,72 8,72 8,48 48,48" fill="${SHAPE_FILL}" />`,
    ["square star", "cross", "star"]
  ),
  createShape(
    "square-star-eight",
    "Eight block star",
    "squareStars",
    120,
    120,
    `<polygon points="42,8 78,8 84,28 108,14 120,42 98,60 120,78 108,106 84,92 78,112 42,112 36,92 12,106 0,78 22,60 0,42 12,14 36,28" fill="${SHAPE_FILL}" />`,
    ["square star", "eight", "block"]
  ),
  createShape(
    "square-star-petal",
    "Petal block star",
    "squareStars",
    120,
    120,
    `<polygon points="48,6 72,6 80,28 104,16 116,40 94,56 112,76 96,102 74,94 64,116 40,116 30,94 8,102 -8,76 10,56 -12,40 0,16 24,28 32,6" fill="${SHAPE_FILL}" />`,
    ["square star", "petal", "block"]
  ),
  createShape(
    "square-star-burst",
    "Burst block star",
    "squareStars",
    120,
    120,
    `<polygon points="52,0 68,0 72,24 96,12 108,28 88,48 120,52 120,68 88,72 108,92 96,108 72,96 68,120 52,120 48,96 24,108 12,92 32,72 0,68 0,52 32,48 12,28 24,12 48,24" fill="${SHAPE_FILL}" />`,
    ["square star", "burst", "block"]
  ),
  createShape(
    "square-star-spoke",
    "Spoke star",
    "squareStars",
    120,
    120,
    `<polygon points="54,0 66,0 66,38 92,12 100,20 74,46 120,46 120,58 74,58 100,84 92,92 66,66 66,120 54,120 54,66 28,92 20,84 46,58 0,58 0,46 46,46 20,20 28,12 54,38" fill="${SHAPE_FILL}" />`,
    ["square star", "spoke"]
  ),
  createShape(
    "organic-clover",
    "Clover",
    "organic",
    120,
    120,
    `<path d="M60 54 C60 34 44 18 26 18 C8 18 0 34 4 48 C8 62 24 68 36 64 C32 76 36 92 50 100 C58 104 62 104 70 100 C84 92 88 76 84 64 C96 68 112 62 116 48 C120 34 112 18 94 18 C76 18 60 34 60 54 Z" fill="${SHAPE_FILL}" />`,
    ["organic", "clover", "flower"]
  ),
  createShape(
    "organic-flower-five",
    "Five-petal flower",
    "organic",
    120,
    120,
    `<path d="M60 18 C72 18 78 30 74 42 C84 34 98 36 104 48 C110 60 104 72 92 76 C102 82 104 96 94 104 C84 112 72 108 66 96 C62 108 48 112 38 104 C28 96 30 82 40 76 C28 72 22 60 28 48 C34 36 48 34 58 42 C54 30 48 18 60 18 Z" fill="${SHAPE_FILL}" />`,
    ["organic", "flower", "five petal"]
  ),
  createShape(
    "organic-daisy",
    "Daisy",
    "organic",
    120,
    120,
    `<polygon points="${starPoints(8, 60, 60, 50, 28)}" fill="${SHAPE_FILL}" />
     <circle cx="60" cy="60" r="14" fill="white" />`,
    ["organic", "daisy", "flower"]
  ),
  createShape(
    "organic-pinwheel",
    "Pinwheel flower",
    "organic",
    120,
    120,
    `<path d="M60 22 C74 22 82 34 78 48 C90 42 102 48 104 60 C106 72 96 82 84 82 C88 96 78 108 64 108 C50 108 40 96 44 82 C32 82 22 72 24 60 C26 48 38 42 50 48 C46 34 46 22 60 22 Z" fill="${SHAPE_FILL}" />`,
    ["organic", "pinwheel", "flower"]
  ),
  createShape(
    "organic-petal-star",
    "Petal star",
    "organic",
    120,
    120,
    `<path d="M60 14 C74 14 78 34 70 46 C84 38 100 48 100 62 C100 76 84 86 70 78 C78 90 74 110 60 110 C46 110 42 90 50 78 C36 86 20 76 20 62 C20 48 36 38 50 46 C42 34 46 14 60 14 Z" fill="${SHAPE_FILL}" />`,
    ["organic", "petal", "star"]
  ),
  createShape(
    "abstract-cutout",
    "Cutout ring",
    "abstract",
    140,
    120,
    `<path fill-rule="evenodd" clip-rule="evenodd" d="M16 20 H124 V100 H16 Z M48 44 H92 V76 H48 Z" fill="${SHAPE_FILL}" />
     <circle cx="20" cy="60" r="16" fill="white" />`,
    ["abstract", "cutout", "ring"]
  ),
  createShape(
    "abstract-double-diamond",
    "Double diamond",
    "abstract",
    140,
    120,
    `<polygon points="40,60 60,20 80,60 60,100" fill="${SHAPE_FILL}" />
     <polygon points="80,60 100,20 120,60 100,100" fill="${SHAPE_FILL}" />`,
    ["abstract", "double", "diamond"]
  ),
  createShape(
    "abstract-pinwheel",
    "Abstract pinwheel",
    "abstract",
    120,
    120,
    `<path d="M60 16 C80 20 94 30 98 48 C82 46 70 54 60 60 C54 46 46 34 28 22 C38 18 48 16 60 16 Z
             M104 60 C100 80 90 94 72 98 C74 82 66 70 60 60 C74 54 86 46 98 28 C102 38 104 48 104 60 Z
             M60 104 C40 100 26 90 22 72 C38 74 50 66 60 60 C66 74 74 86 92 98 C82 102 72 104 60 104 Z
             M16 60 C20 40 30 26 48 22 C46 38 54 50 60 60 C46 66 34 74 22 92 C18 82 16 72 16 60 Z" fill="${SHAPE_FILL}" />`,
    ["abstract", "pinwheel"]
  ),
  createShape(
    "abstract-chamfer",
    "Chamfer block",
    "abstract",
    140,
    120,
    `<polygon points="32,18 126,18 108,102 14,102" fill="${SHAPE_FILL}" />`,
    ["abstract", "chamfer", "block"]
  ),
  createShape(
    "abstract-half-pill",
    "Half pill",
    "abstract",
    140,
    120,
    `<path d="M18 20 H82 C112 20 126 38 126 60 C126 82 112 100 82 100 H18 Z" fill="${SHAPE_FILL}" />`,
    ["abstract", "half pill", "rounded"]
  ),
  createShape(
    "flowchart-input",
    "Input output",
    "flowchart",
    140,
    110,
    `<polygon points="30,20 126,20 110,90 14,90" fill="${SHAPE_FILL}" />`,
    ["flowchart", "input", "output", "parallelogram"]
  ),
  createShape(
    "flowchart-database",
    "Database",
    "flowchart",
    140,
    110,
    `<ellipse cx="70" cy="28" rx="48" ry="14" fill="${SHAPE_FILL}" />
     <rect x="22" y="28" width="96" height="50" fill="${SHAPE_FILL}" />
     <ellipse cx="70" cy="78" rx="48" ry="14" fill="${SHAPE_FILL}" />
     <ellipse cx="70" cy="28" rx="48" ry="14" fill="white" opacity="0.12" />`,
    ["flowchart", "database", "cylinder"]
  ),
  createShape(
    "flowchart-delay",
    "Delay",
    "flowchart",
    140,
    110,
    `<path d="M24 22 H86 C110 22 126 38 126 56 C126 74 110 90 86 90 H24 Z" fill="${SHAPE_FILL}" />`,
    ["flowchart", "delay", "d shape"]
  ),
  createShape(
    "flowchart-offpage",
    "Off-page connector",
    "flowchart",
    120,
    120,
    `<path d="M20 16 H100 V72 L60 104 L20 72 Z" fill="${SHAPE_FILL}" />`,
    ["flowchart", "off page", "connector", "pentagon"]
  ),
  createShape(
    "flowchart-card",
    "Card",
    "flowchart",
    140,
    110,
    `<path d="M34 18 H126 V92 H14 V40 Z" fill="${SHAPE_FILL}" />`,
    ["flowchart", "card", "manual input"]
  ),
  createShape(
    "speech-thought-double",
    "Thought bubble",
    "speech",
    150,
    120,
    `<path d="M40 82 C20 82 14 54 34 48 C34 26 60 16 76 34 C92 18 120 24 124 48 C142 50 146 82 124 82 H88 L68 98 L72 82 Z" fill="${SHAPE_FILL}" />
     <circle cx="46" cy="96" r="8" fill="${SHAPE_FILL}" />
     <circle cx="30" cy="108" r="5" fill="${SHAPE_FILL}" />`,
    ["speech", "thought", "bubble"]
  ),
  createShape(
    "speech-pill-bottom",
    "Pill bubble",
    "speech",
    150,
    110,
    `<path d="M22 24 H128 C138 24 146 32 146 42 V62 C146 72 138 80 128 80 H90 L76 98 L72 80 H22 C12 80 4 72 4 62 V42 C4 32 12 24 22 24 Z" fill="${SHAPE_FILL}" />`,
    ["speech", "bubble", "pill"]
  ),
  createShape(
    "speech-notch-bottom",
    "Bottom notch bubble",
    "speech",
    150,
    110,
    `<path d="M14 20 H136 V72 H92 L74 98 L68 72 H14 Z" fill="${SHAPE_FILL}" />`,
    ["speech", "bubble", "notch", "bottom"]
  ),
  createShape(
    "speech-notch-side",
    "Side notch bubble",
    "speech",
    150,
    110,
    `<path d="M20 18 H130 V82 H20 L20 60 L4 52 L20 44 Z" fill="${SHAPE_FILL}" />`,
    ["speech", "bubble", "notch", "side"]
  ),
  createShape(
    "speech-oval",
    "Oval bubble",
    "speech",
    150,
    110,
    `<ellipse cx="74" cy="50" rx="58" ry="34" fill="${SHAPE_FILL}" />
     <path d="M60 78 L74 100 L82 76 Z" fill="${SHAPE_FILL}" />`,
    ["speech", "bubble", "oval"]
  ),
  createShape(
    "cloud-compact",
    "Compact cloud",
    "clouds",
    150,
    110,
    `<path d="M36 82 C18 82 14 58 32 52 C34 34 54 24 68 34 C76 20 96 20 104 34 C120 34 130 48 126 64 C122 76 114 82 100 82 Z" fill="${SHAPE_FILL}" />`,
    ["cloud", "compact"]
  ),
  createShape(
    "cloud-layered",
    "Layered cloud",
    "clouds",
    150,
    110,
    `<path d="M30 80 C12 80 10 56 28 52 C30 32 48 22 62 30 C70 18 88 18 98 30 C116 28 130 40 130 58 C130 72 118 80 102 80 Z" fill="${SHAPE_FILL}" />`,
    ["cloud", "layered"]
  ),
  createShape(
    "cloud-flat",
    "Flat cloud",
    "clouds",
    150,
    110,
    `<path d="M26 80 C14 80 10 60 24 54 C26 38 44 28 56 34 C64 22 86 22 94 34 C110 34 122 44 122 58 C122 72 112 80 96 80 Z" fill="${SHAPE_FILL}" />`,
    ["cloud", "flat"]
  ),
  createShape(
    "cloud-blob",
    "Blob cloud",
    "clouds",
    150,
    110,
    `<path d="M28 80 C8 80 8 54 28 50 C32 28 54 20 70 34 C82 20 110 20 120 40 C138 42 142 72 122 78 C114 82 106 82 96 82 Z" fill="${SHAPE_FILL}" />`,
    ["cloud", "blob"]
  ),
  createShape(
    "heart-indent",
    "Indented heart",
    "hearts",
    120,
    120,
    `<path d="M60 106 C28 82 18 62 18 38 C18 20 32 10 46 10 C56 10 60 18 60 28 C60 18 64 10 74 10 C88 10 102 20 102 38 C102 62 92 82 60 106 Z" fill="${SHAPE_FILL}" />`,
    ["heart", "indented"]
  ),
  createShape(
    "heart-rounded-wide",
    "Rounded wide heart",
    "hearts",
    140,
    110,
    `<path d="M70 98 C30 72 18 52 18 32 C18 18 30 10 44 10 C58 10 66 20 70 30 C74 20 82 10 96 10 C110 10 122 18 122 32 C122 52 110 72 70 98 Z" fill="${SHAPE_FILL}" />`,
    ["heart", "rounded", "wide"]
  ),
  createShape(
    "heart-pointy",
    "Pointy heart",
    "hearts",
    120,
    120,
    `<path d="M60 108 C24 82 14 56 14 34 C14 20 26 10 40 10 C50 10 58 16 60 26 C62 16 70 10 80 10 C94 10 106 20 106 34 C106 56 96 82 60 108 Z" fill="${SHAPE_FILL}" />`,
    ["heart", "pointy"]
  ),
  createShape(
    "heart-petal",
    "Petal heart",
    "hearts",
    120,
    120,
    `<path d="M60 100 C30 82 20 62 20 40 C20 26 32 16 42 16 C52 16 58 24 60 32 C62 24 68 16 78 16 C88 16 100 26 100 40 C100 62 90 82 60 100 Z" fill="${SHAPE_FILL}" />`,
    ["heart", "petal"]
  ),
  createShape(
    "banner-cut-bookmark",
    "Cut bookmark",
    "banners",
    120,
    120,
    `<path d="M28 14 H92 V104 L60 88 L28 104 Z" fill="${SHAPE_FILL}" />
     <path d="M52 78 L60 86 L68 78" fill="white" opacity="0.12" />`,
    ["banner", "bookmark", "cut"]
  ),
  createShape(
    "banner-tag",
    "Tag banner",
    "banners",
    120,
    120,
    `<path d="M30 14 H90 V86 L60 106 L30 86 Z" fill="${SHAPE_FILL}" />`,
    ["banner", "tag"]
  ),
  createShape(
    "banner-wide-notch",
    "Wide notch banner",
    "banners",
    150,
    110,
    `<path d="M18 18 H132 V86 L75 70 L18 86 Z" fill="${SHAPE_FILL}" />`,
    ["banner", "wide", "notch"]
  ),
  createShape(
    "banner-ticket",
    "Ticket ribbon",
    "banners",
    150,
    110,
    `<path d="M18 34 H132 C124 42 124 68 132 76 H18 C26 68 26 42 18 34 Z" fill="${SHAPE_FILL}" />`,
    ["banner", "ticket", "ribbon"]
  ),
  createShape(
    "drop-pear",
    "Pear drop",
    "drops",
    120,
    120,
    `<path d="M60 18 C76 34 88 50 88 76 C88 98 76 112 60 112 C44 112 32 98 32 76 C32 50 44 34 60 18 Z" fill="${SHAPE_FILL}" />`,
    ["drop", "pear"]
  ),
  createShape(
    "drop-wide",
    "Wide drop",
    "drops",
    120,
    120,
    `<path d="M60 16 C80 40 94 56 94 78 C94 98 78 112 60 112 C42 112 26 98 26 78 C26 56 40 40 60 16 Z" fill="${SHAPE_FILL}" />`,
    ["drop", "wide"]
  ),
  createShape(
    "drop-long",
    "Long drop",
    "drops",
    120,
    120,
    `<path d="M60 8 C76 34 90 54 90 82 C90 102 76 114 60 114 C44 114 30 102 30 82 C30 54 44 34 60 8 Z" fill="${SHAPE_FILL}" />`,
    ["drop", "long"]
  ),
  createShape(
    "drop-bulb",
    "Bulb drop",
    "drops",
    120,
    120,
    `<path d="M60 18 C72 34 96 58 96 80 C96 100 82 112 60 112 C38 112 24 100 24 80 C24 58 48 34 60 18 Z" fill="${SHAPE_FILL}" />`,
    ["drop", "bulb"]
  ),
  createShape(
    "gear-twelve",
    "Gear twelve",
    "gears",
    120,
    120,
    `<polygon points="${starPoints(12, 60, 60, 52, 40)}" fill="${SHAPE_FILL}" />
     <circle cx="60" cy="60" r="18" fill="white" />`,
    ["gear", "twelve", "cog"]
  ),
  createShape(
    "gear-gearbox",
    "Gearbox",
    "gears",
    120,
    120,
    `<polygon points="${starPoints(10, 60, 60, 50, 36)}" fill="${SHAPE_FILL}" />
     <circle cx="60" cy="60" r="14" fill="white" />`,
    ["gear", "gearbox", "cog"]
  ),
  createShape(
    "gear-ring-thick",
    "Ring gear",
    "gears",
    120,
    120,
    `<polygon points="${starPoints(14, 60, 60, 54, 42)}" fill="${SHAPE_FILL}" />
     <circle cx="60" cy="60" r="24" fill="white" />`,
    ["gear", "ring", "cog"]
  ),
  createShape(
    "gear-rounded",
    "Rounded gear",
    "gears",
    120,
    120,
    `<polygon points="${starPoints(8, 60, 60, 50, 44)}" fill="${SHAPE_FILL}" />
     <circle cx="60" cy="60" r="18" fill="white" />`,
    ["gear", "rounded", "cog"]
  ),
  createShape(
    "square-star-asterisk",
    "Asterisk star",
    "squareStars",
    120,
    120,
    `<path d="M54 6 H66 V46 L98 18 L106 28 L74 56 H114 V68 H74 L106 96 L98 106 L66 78 V114 H54 V78 L22 106 L14 96 L46 68 H6 V56 H46 L14 28 L22 18 L54 46 Z" fill="${SHAPE_FILL}" />`,
    ["square star", "asterisk"]
  ),
  createShape(
    "square-star-lean",
    "Leaning star",
    "squareStars",
    120,
    120,
    `<polygon points="46,6 72,18 66,42 108,28 114,50 78,60 112,78 98,100 70,78 64,114 42,108 46,74 14,86 8,64 42,56 10,34 24,12 52,34" fill="${SHAPE_FILL}" />`,
    ["square star", "leaning"]
  ),
  createShape(
    "square-star-blocky",
    "Blocky star",
    "squareStars",
    120,
    120,
    `<polygon points="54,0 66,0 72,30 96,12 108,24 90,48 120,54 120,66 90,72 108,96 96,108 72,90 66,120 54,120 48,90 24,108 12,96 30,72 0,66 0,54 30,48 12,24 24,12 48,30" fill="${SHAPE_FILL}" />`,
    ["square star", "blocky"]
  ),
  createShape(
    "square-star-fan",
    "Fan star",
    "squareStars",
    120,
    120,
    `<path d="M54 0 H66 V44 L96 12 L104 20 L74 50 H120 V62 H74 L104 92 L96 100 L66 68 V120 H54 V68 L24 100 L16 92 L46 62 H0 V50 H46 L16 20 L24 12 L54 44 Z" fill="${SHAPE_FILL}" />`,
    ["square star", "fan"]
  ),
  createShape(
    "organic-six-petal",
    "Six-petal flower",
    "organic",
    120,
    120,
    `<polygon points="${starPoints(6, 60, 60, 48, 26)}" fill="${SHAPE_FILL}" />
     <circle cx="60" cy="60" r="10" fill="white" />`,
    ["organic", "six petal", "flower"]
  ),
  createShape(
    "organic-round-flower",
    "Round flower",
    "organic",
    120,
    120,
    `<path d="M60 18 C72 18 80 28 78 40 C88 34 100 38 104 48 C108 58 102 68 92 72 C100 80 100 94 90 100 C80 106 68 100 64 90 C56 100 40 106 30 100 C20 94 20 80 28 72 C18 68 12 58 16 48 C20 38 32 34 42 40 C40 28 48 18 60 18 Z" fill="${SHAPE_FILL}" />`,
    ["organic", "round flower"]
  ),
  createShape(
    "organic-lotus",
    "Lotus flower",
    "organic",
    120,
    120,
    `<path d="M60 18 C72 30 76 42 72 54 C84 46 96 48 102 58 C92 60 84 66 80 76 C72 72 66 68 60 62 C54 68 48 72 40 76 C36 66 28 60 18 58 C24 48 36 46 48 54 C44 42 48 30 60 18 Z" fill="${SHAPE_FILL}" />`,
    ["organic", "lotus", "flower"]
  ),
  createShape(
    "organic-sunflower",
    "Sunflower",
    "organic",
    120,
    120,
    `<polygon points="${starPoints(10, 60, 60, 48, 26)}" fill="${SHAPE_FILL}" />
     <circle cx="60" cy="60" r="12" fill="white" />`,
    ["organic", "sunflower", "flower"]
  ),
  createShape(
    "abstract-loop",
    "Loop cutout",
    "abstract",
    140,
    120,
    `<path fill-rule="evenodd" clip-rule="evenodd" d="M18 18 H122 V102 H18 Z M52 42 H88 V78 H52 Z" fill="${SHAPE_FILL}" />
     <rect x="8" y="42" width="26" height="36" fill="white" />`,
    ["abstract", "loop", "cutout"]
  ),
  createShape(
    "abstract-twin-star",
    "Twin sparkle",
    "abstract",
    140,
    120,
    `<polygon points="${starPoints(4, 44, 60, 28, 10, -45)}" fill="${SHAPE_FILL}" />
     <polygon points="${starPoints(4, 92, 60, 34, 12, -45)}" fill="${SHAPE_FILL}" />`,
    ["abstract", "twin", "sparkle"]
  ),
  createShape(
    "abstract-rotate-pinwheel",
    "Twist pinwheel",
    "abstract",
    120,
    120,
    `<path d="M60 18 C76 20 88 30 92 46 C76 46 66 52 60 60 C54 52 44 46 28 46 C32 30 44 20 60 18 Z
             M102 60 C100 76 90 88 74 92 C74 76 68 66 60 60 C68 54 74 44 74 28 C90 32 100 44 102 60 Z
             M60 102 C44 100 32 90 28 74 C44 74 54 68 60 60 C66 68 76 74 92 74 C88 90 76 100 60 102 Z
             M18 60 C20 44 30 32 46 28 C46 44 52 54 60 60 C52 66 46 76 46 92 C30 88 20 76 18 60 Z" fill="${SHAPE_FILL}" />`,
    ["abstract", "twist", "pinwheel"]
  ),
  createShape(
    "abstract-slashed-block",
    "Slashed block",
    "abstract",
    140,
    120,
    `<polygon points="30,18 126,18 110,102 14,102" fill="${SHAPE_FILL}" />
     <rect x="56" y="18" width="20" height="84" fill="white" transform="rotate(18 66 60)" />`,
    ["abstract", "slashed", "block"]
  ),
  createShape(
    "abstract-round-cut",
    "Round cut block",
    "abstract",
    140,
    120,
    `<path d="M20 18 H82 C114 18 126 36 126 60 C126 84 114 102 82 102 H20 Z" fill="${SHAPE_FILL}" />
     <rect x="16" y="42" width="34" height="36" fill="white" />`,
    ["abstract", "round cut", "block"]
  ),
];
