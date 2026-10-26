// CapCut web editor → fabric template objects.
//
// The CapCut web editor loads a template with one POST (`/lv/v1/draft/get_package_info`) whose
// `data.draft` is the plain draft_content JSON (the same schema as desktop CapCut/JianYing drafts)
// and whose `data.filer_asset_list` carries a signed download link per uploaded media file. The
// extension forwards that package untouched; everything below turns it into the fabric objects the
// Canva importer already produces (one page, layers placed on the timeline by
// timelineStartMs/timelineEndMs), so createImportedTemplate stores it the same way.
//
// Units, calibrated against the live CapCut render (1080×1920 template, 2026-10-22):
// - times are microseconds;
// - clip.transform is the layer CENTRE in half-canvas units from the canvas centre, y pointing UP;
// - media at clip.scale 1 is fitted INSIDE the canvas (contain), then multiplied by clip.scale;
// - text is sized by its font's LINE BOX: hhea (ascender − descender) of CapCut's own font file is
//   `style.size × clip.scale × 6.24 px` on a 1080-wide canvas, so em = that / lineBox. Checked on
//   three fonts of one template: Pinyon Script (box 1.248 → 5 px per unit), Gloock (CapCut's file:
//   0.98 → 1.27× bigger, measured 1.25×), Prata (1.355 → 0.92×, measured 0.90×). The px are taken
//   as relative to the shorter canvas side. The route reads the boxes (capcutFonts.server.js);
//   without one, Pinyon's box is assumed. Letter spacing is not calibrated yet.
// Audio tracks are not imported in this phase.

export const CAPCUT_TEXT_LINE_BOX_PX_PER_UNIT_AT_1080 = 6.24;
// Line box assumed when the font's own file could not be read (Pinyon Script's, the calibration font).
const DEFAULT_FONT_LINE_BOX = 1.248;
// CapCut stores letter spacing as a small float (−0.35 on a condensed label that still renders with
// normal gaps); fabric's charSpacing is 1/1000 em. ×100 keeps it mild until it is measured.
const CAPCUT_LETTER_SPACING_TO_CHAR_SPACING = 100;
// Stored line_spacing 0.02 is CapCut's "0" (lines one line box apart); the rest is a fraction of
// the line box (−0.5 on HarmonyOS Sans, box 1.213, drew a 0.61 em pitch).
const CAPCUT_DEFAULT_LINE_SPACING = 0.02;
// Rough average advance of a glyph, only used to size a text box before the editor snug-fits it.
const ESTIMATED_GLYPH_ADVANCE_EM = 0.55;

const US_PER_MS = 1000;
const US_PER_SECOND = 1_000_000;

const FONT_STYLE_WEIGHTS = [
  [/thin|hairline/i, 100],
  [/extra\s*light|ultra\s*light/i, 200],
  [/light/i, 300],
  [/medium/i, 500],
  [/semi\s*bold|demi\s*bold/i, 600],
  [/extra\s*bold|ultra\s*bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
];
// Style words and variable-font axis tags ("PlayfairDisplay-Italic-VariableFont_wght").
const FONT_STYLE_WORDS =
  /^(regular|normal|book|roman|italic|oblique|thin|hairline|extralight|ultralight|light|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|mdlt|md|rg|bd|lt|variablefont|variable|vf|wght|wdth|opsz|ital|slnt)$/i;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** The pieces of a get_package_info response the mapper reads (accepts `{ data }` or the data). */
export function readCapcutPackage(packageInfo) {
  const data = packageInfo?.data && typeof packageInfo.data === "object" ? packageInfo.data : packageInfo || {};
  const draft = parseJson(data.draft, null);
  const filerAssets = parseJson(data.filer_asset_list, []);
  const frameImage = data.frame_info?.image || {};
  const materialList = parseJson(data.material_list, []);
  return {
    draft,
    filerAssets: Array.isArray(filerAssets) ? filerAssets : [],
    materialList: Array.isArray(materialList) ? materialList : [],
    previewImageBase64: String(frameImage.preview_url_webp_480p_image_data || ""),
    previewImageUrl: String(frameImage.preview_url_480p || frameImage.preview_url_720p || ""),
  };
}

function colorToRgbString(color) {
  if (!Array.isArray(color) || color.length < 3) return null;
  const channel = (value) => Math.max(0, Math.min(255, Math.round(finite(value) * 255)));
  return `rgb(${channel(color[0])}, ${channel(color[1])}, ${channel(color[2])})`;
}

function hexToRgbString(hex) {
  const match = /^#?([0-9a-f]{6})/i.exec(String(hex || ""));
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

/**
 * Family, weight and style guessed from a CapCut font file name:
 * "PinyonScript-Regular.ttf" → "Pinyon Script" 400, "PlayfairDisplay-Italic" → italic,
 * "HarmonyOS_Sans_Condensed_Medium.ttf" → "HarmonyOS Sans Condensed" 500.
 */
export function capcutFontFromFileName(fileName) {
  const base = String(fileName || "")
    .split("/")
    .pop()
    .replace(/\.(ttf|otf|ttc|woff2?)$/i, "")
    .replace(/\[[^\]]*\]/g, " ")
    .trim();
  if (!base) return null;
  // A bare "font.ttf" (CapCut's Amiri package) names nothing; the family comes from the file.
  if (GENERIC_FONT_FILE_NAMES.test(base)) {
    return { fileName: base, family: "", fontWeight: 400, fontStyle: "normal" };
  }
  const words = base.split(/[-_\s]+/).filter(Boolean);
  const familyWords = [...words];
  const styleWords = [];
  while (familyWords.length > 1 && FONT_STYLE_WORDS.test(familyWords[familyWords.length - 1])) {
    styleWords.unshift(familyWords.pop());
  }
  // Split CamelCase ("PinyonScript") but keep runs of capitals ("HarmonyOS", "IBM").
  const family = familyWords
    .map((word) => word.replace(/([a-z])([A-Z][a-z])/g, "$1 $2"))
    .join(" ")
    .trim();
  const style = styleWords.join(" ");
  const weight = FONT_STYLE_WEIGHTS.find(([pattern]) => pattern.test(style))?.[1] || 400;
  return {
    fileName: base,
    family,
    fontWeight: weight,
    fontStyle: /italic|oblique/i.test(style) ? "italic" : "normal",
  };
}

const GENERIC_FONT_FILE_NAMES = /^(fonts?|regular|default|text|typeface|untitled|custom|main|\d+)$/i;

/** Lowercase letters and digits only — the FontFamily.normalizedFamily key. */
export function normalizeCapcutFontKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// Names are matched on the package's English title first (material_list, by resource id), then
// on the draft's own name, which follows the editor's UI language ("ظهور تدريجي" = Gradual Reveal).
const ANIMATION_RULES = [
  // [pattern, entrance type, exit type, direction]
  [/type|typewriter|typing|كتابة|كاتبة|mesin ketik|tipe 2|huruf acak/i, "TYPEWRITER_CHARS", "FADE", "DEFAULT"],
  // Slingshot / Jepretan (Transform.lua): each letter in turn scales up from 0 while it swings and
  // slides in — the per-letter grow is the closest.
  [/slingshot|jepretan/i, "CH_SCALE_FADE", "FADE", "DEFAULT"],
  // Blow In (TextWave.lua): every letter drifts and turns in on its own random path.
  [/blow in/i, "CH_POSITION_FADE", "FADE", "DEFAULT"],
  // Roll In / Rol Masuk: a reel that rolls the text up into view (shader yoffset + blur).
  [/roll|rol masuk/i, "RISE", "RISE", "UP"],
  // "Bouncing kiri" (Indonesian: bouncing from the left) — no package listed; a slide from its side.
  [/bouncing/i, "SLIDE", "SLIDE", null],
  [/gradual|تدريجي|تلاشي|ظهور/i, "FADE", "FADE", "DEFAULT"],
  // CapCut's Fold unfolds the text from squashed to full size (scrubbed on the live render).
  [/fold/i, "ZOOM_FADE", "ZOOM_FADE", "DEFAULT"],
  [/blur|ضباب|تمويه/i, "BLUR", "BLUR", "DEFAULT"],
  [/dilute|dissolve|ذوبان/i, "DISSOLVE", "DISSOLVE", "DEFAULT"],
  [/zoom|scale|grow|shrink|تكبير|تصغير|زووم/i, "ZOOM", "ZOOM", "DEFAULT"],
  [/wipe|showing|reveal|مسح|كشف/i, "WIPE", "WIPE", null],
  [/slide|move|fly|انزلاق|انزلق|تحريك/i, "SLIDE", "SLIDE", null],
  [/rise|up\b|صعود/i, "RISE", "RISE", "UP"],
  [/pop|bounce|ارتداد|قفز/i, "POP", "POP", "DEFAULT"],
  [/fade/i, "FADE", "FADE", "DEFAULT"],
];

// Loop ("Combo") animations → the editor's LOOP tab.
const LOOP_RULES = [
  [/bounce|jump|ارتداد|قفز/i, "BOUNCE"],
  [/pulse|heart|beat|نبض/i, "PULSE"],
  [/shake|vibrat|jitter|اهتزاز|هز/i, "SHAKE"],
  [/spin|rotat|دوران/i, "ROTATE"],
  [/swing|wobble|sway|تأرجح/i, "WOBBLE"],
  [/float|wave|موج|طفو/i, "WAVE"],
  [/breath|تنفس/i, "BREATHE"],
  [/flicker|blink|twinkle|flash|وميض/i, "FLICKER"],
  [/zoom|scale|تكبير/i, "ZOOM_LOOP"],
];

// Read from the animation packages themselves (2026-10-22, the Arabic template):
// - "Gradual Reveal" never touches opacity: one is a SoftGlow that holds 1.5 s and fades off by
//   3 s (studioAnim.lsanim exposure/glowIntensity keys), the other a 0.5 s colour fringe
//   (ChromaticAberration). The text stays fully visible → no layer animation, reported.
// - "Bounce In" (BounceIn.lua) scales the WHOLE layer 0 → 1.1 over 57% (bezier 0,0,.51,1) then
//   → 1 (bezier .2,0,.13,1), no fade; picked as a "loop" it still plays once (live render: the
//   names grow in at 3.96 s and then stay). The editor has no such entrance, so it rides on a
//   concurrent BREATHE scale ramp (the Zoom Lens one), exact on both runtimes.
const EFFECT_ONLY_ANIMATIONS = /gradual reveal|ظهور تدريجي/i;
// "Flash" loop (sticker anim 6724921437930394120, Spark.lua): alpha 0 → 1 over half the cycle
// (quadOut), 1 → 0 over the other half (quadIn), from the layer's start. The editor's Flicker
// starts visible and dips, so it rides a concurrent loop as a stacked flicker shifted half a cycle
// (dip at the start, full at mid-cycle, floor 0.1) — and can share that loop with a Bounce In.
const FLASH_LOOP_ANIMATIONS = /^flash$/i;

function flashSlot(durationMs) {
  return {
    type: "BREATHE",
    delayMs: 0,
    infinite: true,
    direction: "DEFAULT",
    intensity: 1,
    durationMs,
    params: {
      concurrent: 1,
      r1From: 1,
      r1To: 1,
      r1Start: 0,
      r1Dur: 0,
      r1Ease: CANVA_EASE_LINEAR,
      stackFlicker: durationMs,
      stackFlickerT: 1,
      stackPhaseMs: Math.round(durationMs / 2),
    },
  };
}
const BOUNCE_IN_ANIMATIONS = /bounce in|ارتداد للداخل|memantul ke dalam/i;

// Read from the 3rd template's animation scripts (2026-10-22): CapCut's entrances fade AND move
// on one quadOut tween — Slide Right/Left/Up/Down (LeftIn/TopIn.lua: from 2.66 × the text's size
// ÷ the screen's, in the scene's position units = half the screen HEIGHT on both axes: 2.36 text
// widths sideways on 9:16 — the live render measured ≈2.7 — and 1.33 text heights up/down), Zoom
// In (EnlargeIn.lua: scale 0.5 → 1), Fade In (Appear.lua). The editor's own Pan/Rise travel a
// fixed 80 px, so the motion rides a concurrent ramp in page px (exact) and the opacity a FADE
// entrance (ease-out).
const CAPCUT_SLIDE_UNITS = 2.66;
const SHOWING_UP_DELAY = 0.05;
const SHOWING_UP_STRETCH = 2.04;
const MOTION_ENTRANCES = [
  [/slide right|geser kanan/i, { x: -1 }],
  [/slide left|geser kiri/i, { x: 1 }],
  [/slide up|geser (ke )?atas/i, { y: 1 }],
  [/slide down|geser (ke )?bawah/i, { y: -1 }],
  [/^zoom in$|^perbesar$/i, { scale: 0.5 }],
  [/^fade in$|^muncul$/i, {}],
];

function easedFade(durationMs) {
  return { ...fadeSlot(durationMs), easing: "EASE_OUT" };
}

/** A one-off move/scale as a concurrent BREATHE ramp from the given offset back home. */
function motionRampSlot(durationMs, { scale = 1, x = 0, y = 0 }) {
  return {
    type: "BREATHE",
    delayMs: 0,
    infinite: true,
    direction: "DEFAULT",
    intensity: 1,
    durationMs: 2 * durationMs,
    params: {
      concurrent: 1,
      r1From: scale,
      r1To: 1,
      r1Start: 0,
      r1Dur: durationMs,
      r1Ease: CANVA_EASE_OUT_QUAD,
      ...(x ? { x1From: round(x, 2), x1To: 0 } : {}),
      ...(y ? { y1From: round(y, 2), y1To: 0 } : {}),
    },
  };
}

function bounceInSlot(durationMs) {
  const growMs = Math.round(durationMs * 0.57);
  return {
    type: "BREATHE",
    delayMs: 0,
    infinite: true,
    direction: "DEFAULT",
    intensity: 1,
    // Builds without ramp params ping-pong 2 × this (a mild breathe).
    durationMs: 2 * durationMs,
    params: {
      concurrent: 1,
      r1From: 0,
      r1To: 1.1,
      r1Start: 0,
      r1Dur: growMs,
      r1Ease: CANVA_EASE_OUT_QUAD,
      r2To: 1,
      r2Start: growMs,
      r2Dur: durationMs - growMs,
      r2Ease: CANVA_EASE_IN_OUT_CUBIC,
    },
  };
}

/** Resource ids the package ships (heycan / loki entries of material_list). */
export function capcutResourceIds(materialList) {
  const ids = new Set();
  for (const item of Array.isArray(materialList) ? materialList : []) {
    const id = /(\d{6,})/.exec(String(item?.schema || ""))?.[1];
    if (id) ids.add(id);
  }
  return ids;
}

/** English titles of the package's resources (heycan / loki), by resource id. */
export function capcutResourceTitles(materialList) {
  const titles = new Map();
  for (const item of Array.isArray(materialList) ? materialList : []) {
    const id = /(\d{6,})/.exec(String(item?.schema || ""))?.[1];
    const title = String(item?.heycan_item?.common_attr?.title || item?.loki_item?.Name || "").trim();
    if (id && title && !titles.has(id)) titles.set(id, title);
  }
  return titles;
}

// CapCut's typewriters pace their letters each in their own way (their TextAnim scripts); both
// runtimes play them from the slot's `typePacing` param: 1 = Type 2 (each letter fades in on a
// sin-in, later and slower along the line), 2 = Random Typewriter (the current letter steps in by
// thirds), 3 = Typewriter (its fixed typing rhythm). English titles first, then the draft's own
// Indonesian names.
const TYPEWRITER_PACINGS = [
  [/random typewriter|huruf acak/i, 2],
  [/type ?2|tipe 2/i, 1],
  [/typewriter|mesin ketik/i, 3],
];

function typewriterPacing(names) {
  for (const [pattern, pacing] of TYPEWRITER_PACINGS) {
    if (names.some((name) => pattern.test(name))) return pacing;
  }
  return 0;
}

function directionFromName(name) {
  // English, Indonesian (atas/bawah/kiri/kanan) — CapCut names follow the editor's UI language.
  if (/\b(up|atas)\b/i.test(name)) return "UP";
  if (/\b(down|bawah)\b/i.test(name)) return "DOWN";
  if (/\b(left|kiri)\b/i.test(name)) return "LEFT";
  if (/\b(right|kanan)\b/i.test(name)) return "RIGHT";
  return "DEFAULT";
}

/**
 * One CapCut animation → the editor's slot, or null when nothing close exists. `title` is the
 * resource's English title when the package lists it. `slot: null` = known, but it moves nothing
 * the editor can show (a glow on the text).
 */
export function mapCapcutAnimation(animation, title = "", size = null) {
  const category = String(animation?.type || "").toLowerCase();
  const names = [String(title || ""), String(animation?.name || "")].filter(Boolean);
  const durationMs = Math.max(1, Math.round(finite(animation?.duration) / US_PER_MS));
  if ((category === "in" || category === "out") && names.some((name) => EFFECT_ONLY_ANIMATIONS.test(name))) {
    return { slot: null, value: null };
  }
  if ((category === "in" || category === "loop") && names.some((name) => BOUNCE_IN_ANIMATIONS.test(name))) {
    return { slot: "loop", value: bounceInSlot(durationMs) };
  }
  if (category === "loop" && names.some((name) => FLASH_LOOP_ANIMATIONS.test(name.trim()))) {
    return { slot: "loop", value: flashSlot(durationMs) };
  }
  // Showing Up (TextAnim.lua + rt.frag): the text slides up from below inside its own box on a
  // bezier(0, 0, .5, 1) — the editor's Baseline (a masked rise), whose ease-out-expo is bent onto
  // that curve by its own delay and duration (5 % and 2.04×: within 9 %, 96 % risen when CapCut's
  // ends; untimed it ran 39 % ahead). Both runtimes honour delay and duration.
  if (category === "in" && names.some((name) => /showing up/i.test(name))) {
    return {
      slot: "entrance",
      value: {
        type: "BASELINE",
        delayMs: Math.round(durationMs * SHOWING_UP_DELAY),
        infinite: false,
        direction: "UP",
        intensity: 1,
        durationMs: Math.round(durationMs * SHOWING_UP_STRETCH),
      },
    };
  }
  if (category === "in") {
    const motion = MOTION_ENTRANCES.map(([pattern, move]) => (names.some((name) => pattern.test(name.trim())) ? move : null)).find(Boolean);
    if (motion) {
      const width = finite(size?.width);
      const height = finite(size?.height);
      const canvasWidth = finite(size?.canvasWidth, 1080) || 1080;
      const canvasHeight = finite(size?.canvasHeight, 1920) || 1920;
      const unit = canvasHeight / 2;
      const offset = {
        scale: motion.scale ?? 1,
        x: motion.x ? motion.x * CAPCUT_SLIDE_UNITS * (width / canvasWidth) * unit : 0,
        y: motion.y ? motion.y * CAPCUT_SLIDE_UNITS * (height / canvasHeight) * unit : 0,
      };
      const moves = offset.scale !== 1 || offset.x || offset.y;
      return { slot: "entrance", value: easedFade(durationMs), ...(moves ? { companion: motionRampSlot(durationMs, offset) } : {}) };
    }
  }
  if (category === "loop") {
    const type = names.map((name) => LOOP_RULES.find(([pattern]) => pattern.test(name))?.[1]).find(Boolean);
    if (!type) return null;
    return {
      slot: "loop",
      value: { type, delayMs: 0, infinite: true, direction: "DEFAULT", intensity: 1, durationMs },
    };
  }
  if (category !== "in" && category !== "out") return null;
  let name = "";
  let rule = null;
  for (const candidate of names) {
    rule = ANIMATION_RULES.find(([pattern]) => pattern.test(candidate));
    if (rule) {
      name = candidate;
      break;
    }
  }
  if (!rule) return null;
  const [, entranceType, exitType, fixedDirection] = rule;
  const type = category === "in" ? entranceType : exitType;
  const pacing = type === "TYPEWRITER_CHARS" ? typewriterPacing(names) : 0;
  return {
    slot: category === "in" ? "entrance" : "exit",
    value: {
      type,
      delayMs: 0,
      infinite: false,
      direction: fixedDirection || directionFromName(name),
      intensity: 1,
      durationMs,
      ...(pacing ? { params: { typePacing: pacing } } : {}),
    },
  };
}

function buildAnimationFields(animations, warnings, resourceTitles, size = null) {
  const slots = { entrance: null, exit: null, loop: null };
  const titleOf = (animation) => resourceTitles?.get?.(String(animation?.resource_id || "")) || "";
  // Concurrent loops (Bounce In's scale ramp, Flash's stacked flicker) merge into one loop slot;
  // a plain loop on the same layer keeps the slot and a Bounce In then becomes a Pop entrance.
  const concurrent = [];
  for (const animation of animations) {
    const mapped = mapCapcutAnimation(animation, titleOf(animation), size);
    if (mapped?.companion) concurrent.push(mapped.companion);
    if (mapped?.value?.params?.concurrent) {
      concurrent.push(mapped.value);
      continue;
    }
    if (mapped?.slot === null) {
      const title = titleOf(animation) || animation?.name || "?";
      warnings.add(`CapCut text effect "${title}" (a glow / colour fringe; the text stays visible) is not drawn.`);
      continue;
    }
    if (mapped) {
      if (!slots[mapped.slot]) slots[mapped.slot] = mapped.value;
      continue;
    }
    const category = String(animation?.type || "animation");
    const title = titleOf(animation);
    const label = title && title !== animation?.name ? `${title}" / "${animation?.name || "?"}` : animation?.name || title || "?";
    warnings.add(`CapCut ${category} animation "${label}" has no close match yet and was skipped.`);
  }
  const flash = concurrent.find((value) => value.params.stackFlicker);
  const ramp = concurrent.find((value) => value.params.r1To !== value.params.r1From);
  // CapCut starts a loop when the entrance ends (live render: an image's Flash is fully shown
  // through its 2.5 s Bounce In, then fades 0 → 1 → 0), while a concurrent loop runs from the
  // layer's start. So a layer with an entrance AND a Flash is cut in two: the entrance on the
  // first part, the Flash (dark at its own start) on the rest — exact on both runtimes.
  const entranceMs = ramp ? Math.round(ramp.durationMs / 2) : slots.entrance ? slots.entrance.durationMs + slots.entrance.delayMs : 0;
  if (flash && !slots.loop && entranceMs > 0) {
    const first = animationFieldsFromSlots({ entrance: slots.entrance, exit: null, loop: ramp || null });
    const after = animationFieldsFromSlots({ entrance: null, exit: slots.exit, loop: flash });
    return { ...first, capcutSplitAfter: { atMs: entranceMs, fields: after } };
  }
  if (concurrent.length > 0) {
    if (!slots.loop) {
      // The flash's identity ramp first, so a Bounce In's real ramp wins.
      const ordered = [...concurrent].sort((a, b) => Number(a.params.r1To !== a.params.r1From) - Number(b.params.r1To !== b.params.r1From));
      slots.loop = {
        ...ordered[ordered.length - 1],
        durationMs: Math.max(...ordered.map((value) => value.durationMs)),
        params: Object.assign({}, ...ordered.map((value) => value.params)),
      };
    } else if (ramp && !slots.entrance) {
      slots.entrance = { type: "POP", delayMs: 0, infinite: false, direction: "DEFAULT", intensity: 1, durationMs: Math.round(ramp.durationMs / 2) };
    }
  }
  return animationFieldsFromSlots(slots);
}

const LEGACY_ANIMATION_FIELDS = [
  "animations",
  "mediaAnimationInfinite",
  "mediaAnimationType",
  "mediaAnimationMode",
  "mediaAnimationDurationMs",
  "mediaAnimationOutDurationMs",
  "mediaAnimationDirection",
];

/** Explicit slots plus the legacy single-animation mirror — the shape the Canva importer writes. */
function animationFieldsFromSlots(slots) {
  const legacy = slots.entrance && slots.exit
    ? { slot: slots.entrance, mode: "IN_OUT" }
    : slots.entrance
      ? { slot: slots.entrance, mode: "IN" }
      : slots.exit
        ? { slot: slots.exit, mode: "OUT" }
        : slots.loop
          ? { slot: slots.loop, mode: "LOOP" }
          : null;
  if (!legacy) return {};
  return {
    animations: slots,
    mediaAnimationType: legacy.slot.type,
    mediaAnimationMode: legacy.mode,
    mediaAnimationDurationMs: legacy.slot.durationMs,
    ...(legacy.mode === "IN_OUT" ? { mediaAnimationOutDurationMs: slots.exit.durationMs } : {}),
    ...(legacy.slot.direction !== "DEFAULT" ? { mediaAnimationDirection: legacy.slot.direction } : {}),
    ...(legacy.mode === "LOOP" ? { mediaAnimationInfinite: true } : {}),
  };
}

/** The object with one animation slot set (or replaced) and its legacy mirror rebuilt. */
function withAnimationSlot(object, slot, value) {
  const slots = { entrance: null, exit: null, loop: null, ...(object.animations || {}), [slot]: value };
  const next = { ...object };
  LEGACY_ANIMATION_FIELDS.forEach((field) => delete next[field]);
  return { ...next, ...animationFieldsFromSlots(slots) };
}

function fadeSlot(durationMs) {
  return { type: "FADE", delayMs: 0, infinite: false, direction: "DEFAULT", intensity: 1, durationMs: Math.max(1, Math.round(durationMs)) };
}

/** A white full-canvas layer that fades up to [peak] at [peakMs] and back out by [endMs]. */
function whiteFlash({ id, name, canvasWidth, canvasHeight, peak, startMs, peakMs, endMs }) {
  let flash = {
    ...baseFields({ id }, name, "shape"),
    type: "rect",
    left: 0,
    top: 0,
    width: canvasWidth,
    height: canvasHeight,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    fill: "#ffffff",
    opacity: round(peak, 4),
    flipX: false,
    flipY: false,
    timelineStartMs: Math.round(startMs),
    timelineEndMs: Math.round(endMs),
  };
  flash = withAnimationSlot(flash, "entrance", fadeSlot(peakMs - startMs));
  flash = withAnimationSlot(flash, "exit", fadeSlot(endMs - peakMs));
  return flash;
}

// CapCut transitions sit on the OUTGOING clip of a track and play across the cut. The editor has
// no scene transitions, so each becomes layer animation (scrubbed on the live render):
// - light effects (Glowburst, Glare…) wash the WHOLE frame to white and back, half before the
//   cut and half after → a white full-canvas layer on top fading in and out (peak per strength);
// - mixes/dissolves cross-fade → the clips overlap by the duration, the incoming one fades in;
// - dips to black → the outgoing clip fades out, the incoming one fades in;
// - anything else → a cross-fade, reported.
const LIGHT_TRANSITIONS = [
  [/glow|burst|flash|white|bright|shine/i, 1],
  [/glare|light|leak|flare/i, 0.6],
];
const CROSSFADE_TRANSITION = /mix|dissolve|cross|blend|fade/i;
const DIP_TRANSITION = /black|dark|dip/i;

function transitionKind(name) {
  const light = LIGHT_TRANSITIONS.find(([pattern]) => pattern.test(name));
  if (light) return { kind: "light", peak: light[1] };
  if (DIP_TRANSITION.test(name)) return { kind: "dip" };
  return { kind: "crossfade", approximate: !CROSSFADE_TRANSITION.test(name) };
}

/**
 * Apply every track's transitions to the mapped objects (indexed by segment id) and return the
 * flash layers to put on top of everything.
 */
function applyCapcutTransitions({ draft, materials, objectsBySegment, canvasWidth, canvasHeight, warnings }) {
  const flashes = [];
  for (const track of draft.tracks) {
    const segments = (Array.isArray(track?.segments) ? track.segments : [])
      .slice()
      .sort((a, b) => finite(a?.target_timerange?.start) - finite(b?.target_timerange?.start));
    segments.forEach((segment, index) => {
      const transition = (Array.isArray(segment.extra_material_refs) ? segment.extra_material_refs : [])
        .map((id) => materials.get(id))
        .find((entry) => entry?.kind === "transitions")?.material;
      if (!transition) return;
      const outgoingId = String(segment.id || "");
      const incomingSegment = segments[index + 1];
      const durationMs = Math.round(finite(transition.duration) / US_PER_MS);
      if (!incomingSegment || durationMs <= 0) return;
      const half = Math.round(durationMs / 2);
      const cut = segmentTiming(segment).timelineEndMs;
      const name = String(transition.name || "transition");
      const { kind, peak, approximate } = transitionKind(name);
      const outgoing = objectsBySegment.get(outgoingId);
      const incoming = objectsBySegment.get(String(incomingSegment.id || ""));

      if (kind === "light") {
        flashes.push(
          whiteFlash({
            id: `${outgoingId}-transition`,
            name: `Transition: ${name}`,
            canvasWidth,
            canvasHeight,
            peak,
            startMs: Math.max(0, cut - half),
            peakMs: cut,
            endMs: cut + half,
          })
        );
        return;
      }
      if (!outgoing || !incoming) return;
      if (kind === "dip") {
        objectsBySegment.set(outgoingId, withAnimationSlot(outgoing, "exit", fadeSlot(half)));
        objectsBySegment.set(String(incomingSegment.id), withAnimationSlot(incoming, "entrance", fadeSlot(durationMs - half)));
        return;
      }
      // Cross-fade: the incoming clip (above the outgoing one in the stack) starts half early and
      // fades in while the outgoing clip runs half longer underneath.
      const extended = { ...outgoing, timelineEndMs: outgoing.timelineEndMs + (durationMs - half) };
      if (extended.type === "video") {
        extended.videoEnd = round(Math.min(finite(extended.videoDuration, Infinity), extended.videoEnd + (durationMs - half) / 1000), 3);
      }
      const early = { ...incoming, timelineStartMs: Math.max(0, incoming.timelineStartMs - half) };
      if (early.type === "video") early.videoStart = round(Math.max(0, early.videoStart - half / 1000), 3);
      objectsBySegment.set(outgoingId, extended);
      objectsBySegment.set(String(incomingSegment.id), withAnimationSlot(early, "entrance", fadeSlot(durationMs)));
      if (approximate) warnings.add(`CapCut transition "${name}" was imported as a cross-fade.`);
    });
  }
  return flashes;
}

// CapCut video effects are shader packages ("heycan" zips in material_list, AmazingFeature/Lumi
// scenes). The editor has no shaders, so the ones we know are rebuilt from what their package does,
// read from the package itself (2026-10-22, the Arabic wedding template):
// - overlay: a colour|alpha side-by-side video (LumiAnimSeqLoadAndCrop, enableVideoAlphaBlend,
//   "Fill" crop) blended Normal over the frame → the route bakes it into a lossless animated WebP
//   layer stretched over the effect's clock (capcutEffectOverlay);
// - glow pulses: LumiDeepGlow whose `exposure` is keyframed 0 → peak → 0 → a white flash layer per
//   pulse (a glow brightens the whole frame; half the exposure as white is close on light photos);
// - zoom lens: a shader scaling the clip by 1 + range·sin(…) (SeekModeScript.lua) → a concurrent
//   BREATHE ramp on the clip's layer.
// In CapCut the overlays cover every photo/video track (the veil washed the masked card on track 1
// as well), while the zoom moved only its own clip (the card stayed put), so overlays sit above the
// media stack and below text/stickers, and the zoom goes on the clip's own layer.
// Effect params come as sliders (adjust_params, 0–1); `speed` follows each package's own remap.
const CAPCUT_VIDEO_EFFECTS = new Map([
  // Gossamer Veil / حجاب رقيق: resource/video/xlz.mp4, 1280×640 = two 640² halves, 3 s at 24 fps.
  ["7654855039005035793", { kind: "overlay", speedRange: [0.5, 2] }],
  // Hazy Flash / وميض ضبابي: LumiExportData.lua keyframes (AE seconds, 2.8 s loop), exposure × 3·intensity.
  [
    "7626291676520418580",
    {
      kind: "glow",
      speedRange: [0.5, 3],
      loopSeconds: 2.8,
      peakExposure: 0.7,
      pulses: [
        [0.166667, 0.5, 0.833333],
        [1.166667, 1.5, 1.833333],
        [1.833333, 2.166667, 2.8],
      ],
    },
  ],
  // Image-sequence effects (3rd template): PNG frames, 24 fps, CenterCrop to the canvas, blended
  // SCREEN (CenterCrop.frag); SeekModeScript speed = 1.5 × slider + 0.5. The route bakes them
  // "unscreened" (alpha = brightest channel) so a plain layer looks the same over any background.
  // Kilauan Emas 2 (gold dust) and Hujan Bintang 1 (star rain) loop under the whole video.
  ["7209307530118304257", { kind: "overlay", speedRange: [0.5, 2], loop: true }],
  ["6839514681044898311", { kind: "overlay", speedRange: [0.5, 2], loop: true }],
  // Bocor 1 (light leak): one 65-frame flare per 2.55 s window.
  ["6815093106841489934", { kind: "overlay", speedRange: [0.5, 2] }],
  // Zoom Lens / عدسة تكبير: entity.material constants + SeekModeScript.lua.
  [
    "7399465441057328389",
    { kind: "zoom", scaleInSeconds: 2.4, scaleOutSeconds: 0.2, sleepSeconds: 0.1 },
  ],
]);
// White over the frame per unit of glow exposure.
const GLOW_EXPOSURE_TO_WHITE = 0.5;

function effectSlider(material, key, fallback) {
  const entry = (Array.isArray(material?.adjust_params) ? material.adjust_params : []).find((param) => param?.name === key);
  return finite(entry?.value, finite(entry?.default_value, fallback));
}

/** Lumi packages remap the 0–1 speed slider linearly onto their speedInfo [min, max]. */
function lumiSpeed(material, [min, max]) {
  const slider = Math.max(0, Math.min(1, effectSlider(material, "effects_adjust_speed", (1 - min) / (max - min))));
  return min + slider * (max - min);
}

/** Zoom Lens scale at effect seconds [seconds] (SeekModeScript.lua, first cycle without the bounce). */
function zoomLensScale(recipe, material, seconds) {
  const range = 3 * effectSlider(material, "effects_adjust_range", 0.3);
  const time = Math.max(0, seconds) * (1.5 * effectSlider(material, "effects_adjust_speed", 0.33) + 0.5);
  const { scaleInSeconds: scaleIn, scaleOutSeconds: scaleOut, sleepSeconds: sleep } = recipe;
  if (time < scaleIn) return 1 + range * Math.sin((Math.PI / 2) * (time / scaleIn));
  if (time < scaleIn + sleep) return 1 + range;
  if (time < scaleIn + sleep + scaleOut) {
    return 1 + range * Math.sin((Math.PI / 2) * ((time - (scaleIn - scaleOut) - sleep) / scaleOut));
  }
  return 1;
}

/** Real seconds into the effect at which the Zoom Lens reaches its peak. */
function zoomLensPeakSeconds(recipe, material) {
  return recipe.scaleInSeconds / (1.5 * effectSlider(material, "effects_adjust_speed", 0.33) + 0.5);
}

/** Effect packages by resource id (`heycan://<id>` or `loki://effects2/<id>` entries of material_list). */
export function capcutEffectPackages(materialList) {
  const packages = new Map();
  for (const item of Array.isArray(materialList) ? materialList : []) {
    const schema = String(item?.schema || "");
    const match = /^heycan:\/\/(\d+)/.exec(schema) || /^loki:\/\/effects2?\/(\d+)/.exec(schema);
    const urls = item?.heycan_item?.common_attr?.item_urls || item?.loki_item?.FileUrl?.UrlList;
    const url = String((Array.isArray(urls) ? urls : [])[0] || "");
    if (match && url) packages.set(match[1], url);
  }
  return packages;
}

/**
 * Every clip-level video effect as absolute windows: the effect's own clock (`time_range`, relative
 * to its clip, may start before it) cut to the clip. One effect continued across clips (same
 * resource and same absolute start, like a veil laid over two photos) becomes one window.
 */
function videoEffectWindows(videoEffects) {
  const windows = [];
  for (const { segment, material, global } of videoEffects) {
    const clip = segmentTiming(segment);
    // A clip's effect runs on its own clock (time_range, relative to the clip); an effect track's
    // segment IS the window.
    const clockStartMs = global ? clip.timelineStartMs : clip.timelineStartMs + Math.round(finite(material.time_range?.start) / US_PER_MS);
    const clockDurationMs = global
      ? clip.timelineEndMs - clip.timelineStartMs
      : Math.round(finite(material.time_range?.duration) / US_PER_MS);
    const startMs = Math.max(clip.timelineStartMs, clockStartMs);
    const endMs = Math.min(clip.timelineEndMs, clockStartMs + clockDurationMs);
    if (clockDurationMs <= 0 || endMs <= startMs) continue;
    // resource_id names the package; older effects carry a short effect_id ("18045191").
    const resourceId = String(material.resource_id || material.effect_id || "");
    const joined = windows.find(
      (entry) => entry.resourceId === resourceId && entry.clockStartMs === clockStartMs && entry.endMs >= startMs && entry.startMs <= endMs
    );
    if (joined) {
      joined.startMs = Math.min(joined.startMs, startMs);
      joined.endMs = Math.max(joined.endMs, endMs);
      continue;
    }
    const renderIndex = finite(global ? segment.render_index : material.render_index, 11000);
    windows.push({ resourceId, material, segment, global: Boolean(global), renderIndex, clockStartMs, clockDurationMs, startMs, endMs });
  }
  return windows;
}

/** The zoom as a concurrent BREATHE ramp in the layer's own ms (spec §8.2 params). */
function zoomLensSlot(recipe, window, layer) {
  const { material } = window;
  const layerStartMs = layer.timelineStartMs;
  const peakMs = window.clockStartMs + zoomLensPeakSeconds(recipe, material) * 1000;
  const rampEndMs = Math.min(window.endMs, peakMs);
  const scaleAt = (absoluteMs) => round(zoomLensScale(recipe, material, (absoluteMs - window.clockStartMs) / 1000), 4);
  const from = scaleAt(window.startMs);
  const to = scaleAt(rampEndMs);
  // Most of the sine's quarter is an ease-out; a short start of it is close to a straight line.
  const quarterShare = (rampEndMs - window.startMs) / Math.max(1, peakMs - window.clockStartMs);
  const params = {
    concurrent: 1,
    r1From: from,
    r1To: to,
    r1Start: Math.round(window.startMs - layerStartMs),
    r1Dur: Math.round(rampEndMs - window.startMs),
    r1Ease: quarterShare > 0.6 ? CANVA_EASE_OUT_QUAD : CANVA_EASE_LINEAR,
  };
  if (window.endMs > peakMs) {
    // Past the peak it eases back to 1 (the bounce after it is left out).
    Object.assign(params, { r2To: scaleAt(window.endMs), r2Start: Math.round(peakMs - layerStartMs), r2Dur: Math.round(window.endMs - peakMs), r2Ease: CANVA_EASE_LINEAR });
  } else if (window.endMs < layer.timelineEndMs) {
    // The effect stops before the clip does: CapCut snaps back to the unzoomed frame.
    Object.assign(params, { r2To: 1, r2Start: Math.round(window.endMs - layerStartMs), r2Dur: 0, r2Ease: CANVA_EASE_LINEAR });
  }
  const windowMs = Math.max(1, layer.timelineEndMs - layer.timelineStartMs);
  return {
    type: "BREATHE",
    infinite: true,
    // Builds without ramp params ping-pong 2 × the window (as Canva's importer writes it).
    durationMs: 2 * windowMs,
    delayMs: 0,
    direction: "DEFAULT",
    intensity: round(Math.max(0.1, Math.min(4, (to - 1) / 0.03)), 3),
    params,
  };
}
// animationCanvaTweens.ts CANVA_EASE ids (the ramp params carry Canva's easing table).
const CANVA_EASE_LINEAR = 1;
const CANVA_EASE_OUT_QUAD = 3;
const CANVA_EASE_IN_OUT_CUBIC = 15;

function glowFlashes(recipe, window, canvasWidth, canvasHeight) {
  const { material } = window;
  const speed = lumiSpeed(material, recipe.speedRange);
  const peak = Math.min(1, recipe.peakExposure * 3 * effectSlider(material, "effects_adjust_intensity", 1 / 3) * GLOW_EXPOSURE_TO_WHITE);
  const name = String(material.name || "Glow");
  const flashes = [];
  if (peak <= 0.005) return flashes;
  const loopMs = (recipe.loopSeconds * 1000) / speed;
  for (let cycleMs = 0; window.clockStartMs + cycleMs < window.endMs; cycleMs += loopMs) {
    recipe.pulses.forEach(([rise, top, fall], index) => {
      const at = (seconds) => window.clockStartMs + cycleMs + (seconds * 1000) / speed;
      const startMs = Math.max(window.startMs, at(rise));
      const peakMs = at(top);
      const endMs = Math.min(window.endMs, at(fall));
      if (endMs - startMs < 20 || peakMs <= startMs || peakMs >= endMs) return;
      flashes.push(
        whiteFlash({
          id: `${material.id || window.resourceId}-pulse-${Math.round(cycleMs)}-${index}`,
          name: `Effect: ${name}`,
          canvasWidth,
          canvasHeight,
          peak,
          startMs,
          peakMs,
          endMs,
        })
      );
    });
  }
  return flashes;
}

/**
 * Rebuild the clip-level video effects we know (CAPCUT_VIDEO_EFFECTS): the zoom is set on its
 * clip's layer in [objectsBySegment]; the overlays come back, in CapCut's render order, to be put
 * above the media layers.
 */
function applyCapcutVideoEffects({ videoEffects, objectsBySegment, effectPackages, canvasWidth, canvasHeight, warnings }) {
  const overlays = [];
  const windows = videoEffectWindows(videoEffects).sort((a, b) => a.renderIndex - b.renderIndex || a.startMs - b.startMs);
  for (const window of windows) {
    const { material, resourceId } = window;
    const name = String(material.name || "effect");
    const recipe = CAPCUT_VIDEO_EFFECTS.get(resourceId);
    if (!recipe) {
      warnings.add(`CapCut video effect "${name}" is not imported yet.`);
      continue;
    }
    const strength = Math.max(0, Math.min(1, finite(material.value, 1)));
    if (recipe.kind === "zoom") {
      const segmentId = String(window.segment.id || "");
      const layer = objectsBySegment.get(segmentId);
      if (!layer) continue;
      if (layer.animations?.loop) {
        warnings.add(`CapCut video effect "${name}" was skipped: its clip already loops an animation.`);
        continue;
      }
      objectsBySegment.set(segmentId, withAnimationSlot(layer, "loop", zoomLensSlot(recipe, window, layer)));
      continue;
    }
    if (recipe.kind === "glow") {
      overlays.push(
        ...glowFlashes(recipe, window, canvasWidth, canvasHeight).map((flash) => ({
          object: { ...flash, opacity: round(flash.opacity * strength, 4) },
          renderIndex: window.renderIndex,
        }))
      );
      continue;
    }
    const packageUrl = effectPackages.get(resourceId);
    if (!packageUrl) {
      warnings.add(`CapCut video effect "${name}" has no downloadable package and was skipped.`);
      continue;
    }
    // The route swaps in the baked WebP and its size (keeping the layer over the whole canvas).
    // Sequence effects' "background animation" slider is their opacity.
    const opacity = strength * Math.max(0, Math.min(1, effectSlider(material, "effects_adjust_background_animation", 1)));
    overlays.push({ renderIndex: window.renderIndex, object: {
      ...baseFields({ id: `${material.id || resourceId}-overlay-${window.startMs}` }, `Effect: ${name}`, "image"),
      type: "image",
      src: "",
      capcutEffectOverlay: {
        packageUrl,
        aspect: round(canvasWidth / canvasHeight, 6),
        // The package's clip plays from the effect's start at its speed; the layer may join late.
        speed: round(lumiSpeed(material, recipe.speedRange), 4),
        fromMs: window.startMs - window.clockStartMs,
        toMs: window.endMs - window.clockStartMs,
        // A looping background (gold dust, star rain) ships one cycle and the layer repeats it.
        loop: Boolean(recipe.loop),
      },
      left: 0,
      top: 0,
      width: canvasWidth,
      height: canvasHeight,
      sourceWidth: canvasWidth,
      sourceHeight: canvasHeight,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      opacity: round(opacity, 4),
      flipX: false,
      flipY: false,
      timelineStartMs: window.startMs,
      timelineEndMs: window.endMs,
    } });
  }
  return overlays;
}

/**
 * Top-left of a box whose CENTRE sits at (cx, cy) once turned by `angle` degrees — fabric/Konva
 * turn a layer around its top-left corner.
 */
function topLeftForCenter(cx, cy, width, height, angle) {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    left: cx - ((width / 2) * cos - (height / 2) * sin),
    top: cy - ((width / 2) * sin + (height / 2) * cos),
  };
}

function segmentGeometry(segment, canvasWidth, canvasHeight) {
  const clip = segment?.clip || {};
  return {
    cx: canvasWidth / 2 + finite(clip.transform?.x) * (canvasWidth / 2),
    cy: canvasHeight / 2 - finite(clip.transform?.y) * (canvasHeight / 2),
    scaleX: finite(clip.scale?.x, 1),
    scaleY: finite(clip.scale?.y, finite(clip.scale?.x, 1)),
    angle: finite(clip.rotation),
    opacity: Math.max(0, Math.min(1, finite(clip.alpha, 1))),
    flipX: Boolean(clip.flip?.horizontal),
    flipY: Boolean(clip.flip?.vertical),
  };
}

function segmentTiming(segment) {
  const start = finite(segment?.target_timerange?.start);
  const duration = finite(segment?.target_timerange?.duration);
  return {
    timelineStartMs: Math.round(start / US_PER_MS),
    timelineEndMs: Math.round((start + duration) / US_PER_MS),
  };
}

function baseFields(segment, layerName, layerType) {
  return {
    version: "7.0.0",
    originX: "left",
    originY: "top",
    layerName,
    layerType,
    importKind: layerType,
    importNodeId: String(segment?.id || ""),
    importSource: "capcut",
    importParentId: null,
    fallback: false,
    fallbackReason: "",
    layerHidden: segment?.visible === false,
    layerLocked: false,
  };
}

/**
 * CapCut's crop as a normalized rect of the source, or null when the whole frame shows. The draft
 * stores the four corners (upper_left_x … lower_right_y, 0–1); free crops are axis-aligned.
 */
export function capcutCropRect(crop) {
  if (!crop || typeof crop !== "object") return null;
  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const x0 = clamp01(Math.min(finite(crop.upper_left_x), finite(crop.lower_left_x)));
  const y0 = clamp01(Math.min(finite(crop.upper_left_y), finite(crop.upper_right_y)));
  const x1 = clamp01(Math.max(finite(crop.upper_right_x, 1), finite(crop.lower_right_x, 1)));
  const y1 = clamp01(Math.max(finite(crop.lower_left_y, 1), finite(crop.lower_right_y, 1)));
  if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3) return null;
  if (x0 < 1e-4 && y0 < 1e-4 && x1 > 1 - 1e-4 && y1 > 1 - 1e-4) return null;
  return { x0: round(x0, 6), y0: round(y0, 6), x1: round(x1, 6), y1: round(y1, 6) };
}

/**
 * A CapCut mask the import can bake, or null. `config` is relative to the (cropped) media:
 * width/height as fractions of it, centerX/centerY in half-size units with y up, feather and
 * roundCorner 0–1, rotation in degrees.
 */
export function capcutMaskShape(mask) {
  const type = String(mask?.resource_type || mask?.name || "").toLowerCase();
  const shape = type.includes("rect")
    ? "rectangle"
    : type.includes("circle") || type.includes("ellipse")
      ? "ellipse"
      : type.includes("mirror")
        ? "mirror"
        : null;
  const config = mask?.config || {};
  // A mirror mask is a band: only its `height` (half-thickness) counts.
  if (!shape || (shape !== "mirror" && finite(config.width) <= 0) || finite(config.height) <= 0) return null;
  return {
    shape,
    width: round(finite(config.width), 6),
    height: round(finite(config.height), 6),
    centerX: round(finite(config.centerX), 6),
    centerY: round(finite(config.centerY), 6),
    rotation: round(finite(config.rotation), 4),
    feather: round(Math.max(0, Math.min(1, finite(config.feather))), 6),
    roundCorner: round(Math.max(0, Math.min(1, finite(config.roundCorner))), 6),
    invert: Boolean(config.invert),
  };
}

function mapMediaSegment({ segment, material, asset, mask, resourceTitles, canvasWidth, canvasHeight, animations, warnings, stickerSized = false }) {
  const isVideo = String(material.type || "").toLowerCase() === "video";
  const fullWidth = finite(material.width) || finite(asset?.width);
  const fullHeight = finite(material.height) || finite(asset?.height);
  // A cropped photo is cut to its crop on import (the route does it, see capcutCrop), so the layer
  // is sized from the crop: CapCut fits the CROPPED frame inside the canvas, then applies
  // clip.scale and the material's crop_scale (measured on the live render: 0.438 on a rose
  // cut-out, 0.87 on wreath corners, 1 on the paper card). Video crops are not baked yet.
  const crop = capcutCropRect(material.crop);
  const bakeCrop = Boolean(crop) && !isVideo;
  const cropScale = bakeCrop ? Math.max(0.01, finite(material.crop_scale, 1) || 1) : 1;
  const sourceWidth = bakeCrop ? Math.max(1, Math.round(fullWidth * (crop.x1 - crop.x0))) : fullWidth;
  const sourceHeight = bakeCrop ? Math.max(1, Math.round(fullHeight * (crop.y1 - crop.y0))) : fullHeight;
  const src = String(asset?.origin_download_link || "");
  const name = String(material.material_name || String(material.path || "").split("/").pop() || (isVideo ? "Video" : "Photo"));
  if (!src) {
    warnings.add(`CapCut ${isVideo ? "video" : "photo"} "${name}" has no download link and was skipped.`);
    return null;
  }
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    warnings.add(`CapCut ${isVideo ? "video" : "photo"} "${name}" has no size and was skipped.`);
    return null;
  }
  const geometry = segmentGeometry(segment, canvasWidth, canvasHeight);
  // An "images" overlay on a sticker track is sized like a sticker — its pixels × canvas width / 720
  // × scale (3rd template: a 1080×1920 flower PNG at 0.70 fills the width with its flowers at the
  // very top, where contain-fit put them 15% down, over the calligraphy).
  const fit = stickerSized
    ? (canvasWidth / CAPCUT_STICKER_REFERENCE_PX) * cropScale
    : Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight) * cropScale;
  const scaleX = fit * geometry.scaleX;
  const scaleY = fit * geometry.scaleY;
  const { left, top } = topLeftForCenter(
    geometry.cx,
    geometry.cy,
    sourceWidth * scaleX,
    sourceHeight * scaleY,
    geometry.angle
  );
  if (crop && isVideo) warnings.add(`CapCut crop on video "${name}" is not applied yet; the full clip was imported.`);
  // Rectangle and ellipse masks on photos are baked into the image's alpha by the route.
  const bakeMask = mask && !isVideo ? capcutMaskShape(mask) : null;
  if (mask && !bakeMask) {
    warnings.add(`CapCut ${String(mask.name || mask.resource_type || "")} mask on "${name}" is not imported yet.`);
  }
  const object = {
    ...baseFields(segment, name, isVideo ? "video" : "image"),
    type: isVideo ? "video" : "image",
    src,
    capcutMimeType: String(asset?.mime || ""),
    ...(bakeCrop ? { capcutCrop: crop } : {}),
    ...(bakeMask ? { capcutMask: bakeMask } : {}),
    left: round(left),
    top: round(top),
    width: sourceWidth,
    height: sourceHeight,
    sourceWidth,
    sourceHeight,
    scaleX: round(scaleX, 6),
    scaleY: round(scaleY, 6),
    angle: geometry.angle,
    opacity: geometry.opacity,
    flipX: geometry.flipX,
    flipY: geometry.flipY,
    ...segmentTiming(segment),
    ...buildAnimationFields(animations, warnings, resourceTitles, { width: sourceWidth * Math.abs(scaleX), height: sourceHeight * Math.abs(scaleY), canvasWidth, canvasHeight }),
  };
  if (isVideo) {
    const sourceStart = finite(segment?.source_timerange?.start);
    const sourceDuration = finite(segment?.source_timerange?.duration);
    object.videoStart = round(sourceStart / US_PER_SECOND, 3);
    object.videoEnd = round((sourceStart + sourceDuration) / US_PER_SECOND, 3);
    object.videoDuration = round(finite(material.duration, sourceStart + sourceDuration) / US_PER_SECOND, 3);
  }
  return object;
}

// CapCut stickers ("heycan" packages in material_list) are frame animations drawn at their own
// pixel size against a 720 px-wide canvas, times clip.scale — the sticker's own Lua says
// `scale = viewer:getWidth() / 720` (measured ≈1.48× on 1080 wide). The route rebuilds the
// package's sprite sheet as an animated WebP (capcutStickerPackage), falling back to the GIF
// preview, as the editor's animated sticker (animatedImage + posterSrc, see capcutAnimated).
const CAPCUT_STICKER_REFERENCE_PX = 720;

/** Sticker GIFs by resource id, from the package's material_list (`heycan://<id>` entries). */
export function capcutStickerAssets(materialList) {
  const assets = new Map();
  for (const item of Array.isArray(materialList) ? materialList : []) {
    const match = /^heycan:\/\/(\d+)/.exec(String(item?.schema || ""));
    const heycan = item?.heycan_item;
    if (!match || !heycan) continue;
    const image = (Array.isArray(heycan.sticker?.large_images) ? heycan.sticker.large_images : []).find((entry) => entry?.image_url);
    const url = String(image?.image_url || heycan.common_attr?.download_info?.url || "");
    if (!url) continue;
    assets.set(match[1], {
      url,
      width: finite(image?.width),
      height: finite(image?.height),
      aspectRatio: finite(heycan.common_attr?.aspect_ratio),
      title: String(heycan.common_attr?.title || ""),
      packageUrl: String((Array.isArray(heycan.common_attr?.item_urls) ? heycan.common_attr.item_urls : [])[0] || ""),
    });
  }
  return assets;
}

function mapStickerSegment({ segment, material, stickerAssets, resourceTitles, canvasWidth, canvasHeight, animations, warnings }) {
  const resourceId = String(material.resource_id || material.sticker_id || "");
  const asset = stickerAssets?.get?.(resourceId);
  const name = String(material.name || asset?.title || "Sticker");
  if (!asset) {
    warnings.add(`CapCut sticker "${name}" has no downloadable image and was skipped.`);
    return null;
  }
  let width = asset.width;
  let height = asset.height;
  if (!(width > 0 && height > 0) && asset.aspectRatio > 0) {
    width = 240;
    height = Math.round(240 / asset.aspectRatio);
  }
  if (!(width > 0 && height > 0)) {
    warnings.add(`CapCut sticker "${name}" has no size and was skipped.`);
    return null;
  }
  const geometry = segmentGeometry(segment, canvasWidth, canvasHeight);
  const base = canvasWidth / CAPCUT_STICKER_REFERENCE_PX;
  const scaleX = base * geometry.scaleX;
  const scaleY = base * geometry.scaleY;
  const { left, top } = topLeftForCenter(geometry.cx, geometry.cy, width * scaleX, height * scaleY, geometry.angle);
  return {
    ...baseFields(segment, name, "image"),
    type: "image",
    src: asset.url,
    capcutMimeType: "image/gif",
    capcutAnimated: true,
    ...(asset.packageUrl ? { capcutStickerPackage: asset.packageUrl } : {}),
    left: round(left),
    top: round(top),
    width,
    height,
    sourceWidth: width,
    sourceHeight: height,
    scaleX: round(scaleX, 6),
    scaleY: round(scaleY, 6),
    angle: geometry.angle,
    opacity: geometry.opacity,
    flipX: geometry.flipX,
    flipY: geometry.flipY,
    ...segmentTiming(segment),
    ...buildAnimationFields(animations, warnings, resourceTitles, { width: width * Math.abs(scaleX), height: height * Math.abs(scaleY), canvasWidth, canvasHeight }),
  };
}

// CapCut picks each line's direction from its FIRST non-space character, a digit counting as
// left-to-right: " 25 مايو | 7 مساءً" is laid out LTR (live render: "25 مساءً 7 | مايو" left to
// right), where the editor — RTL whenever Arabic is present — and the Unicode rule read it RTL.
// Such a line is wrapped in a left-to-right isolate (LRI … PDI): invisible, and every runtime
// (canvas, Android, iOS) lays it out as CapCut does.
const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LEFT_TO_RIGHT_START = /^\s*[0-9A-Za-z\u00C0-\u024F]/;
const LRI = "\u2066";
const PDI = "\u2069";

export function capcutBidiText(text) {
  return String(text)
    .split("\n")
    .map((line) => (RTL_LETTER.test(line) && LEFT_TO_RIGHT_START.test(line) ? `${LRI}${line}${PDI}` : line))
    .join("\n");
}

// A text box a little wider than its longest measured line: kerning and Arabic joins make the real
// line slightly narrower than the summed advances, and a box even 1 px short wraps it.
const MEASURED_TEXT_WIDTH_SLACK = 1.03;
const MEASURED_TEXT_WIDTH_PAD_EM = 0.2;

function mapTextSegment({ segment, material, fontLineBoxes, fontMeasures, resourceTitles, canvasWidth, canvasHeight, animations, warnings }) {
  // CapCut's template editor draws `base_content` — the template's own words and styling — when
  // a text has one (3rd template, 2026-10-22: "The Wedding of" is olive in `content` but drawn
  // #8c1111 as in base_content, "2023" not "2024", sizes 15/12 not 12/10). Older templates have
  // no base_content.
  const baseContent = parseJson(material.base_content, null);
  const content = typeof baseContent?.text === "string" && baseContent.text.trim() ? baseContent : parseJson(material.content, null);
  const rawText = String(content?.text ?? material.content ?? "");
  if (!rawText.trim()) return null;
  // CapCut pushes a text down with leading blank lines ("\n    ۩ حفل زفاف ۩" under the line above);
  // the editor drops them, so they are trimmed here and the box moved by the lines they took.
  const rawLines = rawText.split("\n");
  let leadingBlank = 0;
  while (leadingBlank < rawLines.length - 1 && !rawLines[leadingBlank].trim()) leadingBlank += 1;
  let trailingBlank = 0;
  while (trailingBlank < rawLines.length - 1 - leadingBlank && !rawLines[rawLines.length - 1 - trailingBlank].trim()) trailingBlank += 1;
  const text = rawLines.slice(leadingBlank, rawLines.length - trailingBlank).join("\n");
  const styles = Array.isArray(content?.styles) ? content.styles : [];
  const style = styles[0] || {};
  if (styles.length > 1) {
    const distinct = new Set(
      styles.map((entry) => JSON.stringify([entry.size, entry.font?.path, entry.fill?.content?.solid?.color]))
    );
    if (distinct.size > 1) {
      warnings.add(`CapCut text "${text.slice(0, 24)}" mixes styles; only its first style was imported.`);
    }
  }
  const geometry = segmentGeometry(segment, canvasWidth, canvasHeight);
  const lineBox = fontLineBoxes?.get?.(String(style.font?.id || "")) || DEFAULT_FONT_LINE_BOX;
  const pxPerUnit = CAPCUT_TEXT_LINE_BOX_PX_PER_UNIT_AT_1080 * (Math.min(canvasWidth, canvasHeight) / 1080);
  const size = finite(style.size, finite(material.font_size, 8));
  // Text scales go into fontSize; fabric text scale stays sign-only (the mobile contract).
  const fontSize = Math.max(1, (size * Math.abs(geometry.scaleX) * pxPerUnit) / lineBox);
  const lineSpacing = finite(material.line_spacing, CAPCUT_DEFAULT_LINE_SPACING) - CAPCUT_DEFAULT_LINE_SPACING;
  const lineHeight = Math.max(0.5, Math.min(4, lineBox * (1 + lineSpacing)));
  const lines = text.split("\n");
  // Combining marks (Arabic harakat) take no width of their own.
  const charSpacing = Math.round(finite(material.letter_spacing) * CAPCUT_LETTER_SPACING_TO_CHAR_SPACING);
  // The box is the longest line measured in CapCut's own font file; without it, an estimate.
  const measure = fontMeasures?.get?.(String(style.font?.id || ""));
  const width = measure
    ? Math.max(
        fontSize,
        lines.reduce((max, line) => {
          const glyphs = [...line.replace(/[\p{M}\p{Cf}]/gu, "")].length;
          const em = measure(line) + (Math.max(0, glyphs - 1) * charSpacing) / 1000;
          return Math.max(max, em * fontSize);
        }, 0) * MEASURED_TEXT_WIDTH_SLACK + MEASURED_TEXT_WIDTH_PAD_EM * fontSize
      )
    : Math.max(
        fontSize,
        lines.reduce((max, line) => Math.max(max, [...line.replace(/\p{M}/gu, "")].length), 1) * ESTIMATED_GLYPH_ADVANCE_EM * fontSize
      );
  // The last line needs a full line box even when CapCut packs lines tighter than 1 em (−0.5
  // line spacing ≈ 0.6): Konva drops every line that does not fit the box height.
  const height = Math.max(fontSize, ((lines.length - 1) * lineHeight + Math.max(lineHeight, 1)) * fontSize);
  // The trimmed lines' centre within the original block, turned with the layer.
  const shift = ((leadingBlank - trailingBlank) / 2) * lineHeight * fontSize;
  const radians = (geometry.angle * Math.PI) / 180;
  const centerX = geometry.cx - shift * Math.sin(radians);
  const centerY = geometry.cy + shift * Math.cos(radians);
  const { left, top } = topLeftForCenter(centerX, centerY, width, height, geometry.angle);
  const font = capcutFontFromFileName(style.font?.path || material.font_path || "");
  const fill =
    colorToRgbString(style.fill?.content?.solid?.color) || hexToRgbString(material.text_color) || "rgb(0, 0, 0)";
  const alignment = finite(material.alignment, 1);
  const shadow = Array.isArray(style.shadows) ? style.shadows.find((entry) => finite(entry.alpha) > 0) : null;
  if (shadow || (Array.isArray(style.strokes) && style.strokes.length > 0) || material.background_color) {
    warnings.add("CapCut text shadows, outlines and backgrounds are not imported yet.");
  }
  return {
    ...baseFields(segment, (lines.find((line) => line.trim()) || "Text").trim().slice(0, 40), "text"),
    type: "textbox",
    text: capcutBidiText(text),
    left: round(left),
    top: round(top),
    width: round(width, 2),
    height: round(height, 2),
    scaleX: geometry.flipX ? -1 : 1,
    scaleY: geometry.flipY ? -1 : 1,
    angle: geometry.angle,
    opacity: round(geometry.opacity * Math.max(0, Math.min(1, finite(material.text_alpha, 1))), 4),
    flipX: false,
    flipY: false,
    fill,
    fontSize: round(fontSize, 3),
    fontFamily: font?.family || "Arial",
    fontWeight: style.bold ? 700 : font?.fontWeight || 400,
    fontStyle: style.italic ? "italic" : font?.fontStyle || "normal",
    capcutFontFile: font?.fileName || "",
    // Whether the family above came from a meaningful file name (an alias worth keeping).
    capcutFontGuessed: Boolean(font?.family),
    capcutFontId: String(style.font?.id || ""),
    textAlign: alignment === 0 ? "left" : alignment === 2 ? "right" : alignment === 3 ? "justify" : "center",
    lineHeight: round(lineHeight, 4),
    charSpacing,
    underline: Boolean(style.underline || material.underline),
    linethrough: false,
    ...segmentTiming(segment),
    ...buildAnimationFields(animations, warnings, resourceTitles, { width, height: fontSize, canvasWidth, canvasHeight }),
  };
}

/**
 * @param {{ draft: object, filerAssets?: object[], fontLineBoxes?: Map<string, number> }} input
 *   fontLineBoxes: font resource id → line box of CapCut's font file (capcutFonts.server.js).
 *   materialList: the package's material_list (sticker GIFs).
 * @returns {{ canvasWidth: number, canvasHeight: number, durationMs: number, name: string,
 *   objects: object[], usedFonts: string[], warnings: string[] }}
 */
export function mapCapcutDraftToFabric({ draft, filerAssets = [], fontLineBoxes = new Map(), fontMeasures = new Map(), materialList = [] }) {
  if (!draft || typeof draft !== "object" || !Array.isArray(draft.tracks)) {
    throw new Error("CapCut package has no draft tracks.");
  }
  const canvasWidth = Math.round(finite(draft.canvas_config?.width, 1080)) || 1080;
  const canvasHeight = Math.round(finite(draft.canvas_config?.height, 1920)) || 1920;
  const warnings = new Set();

  const materials = new Map();
  for (const [kind, list] of Object.entries(draft.materials || {})) {
    if (!Array.isArray(list)) continue;
    for (const material of list) {
      if (material?.id) materials.set(material.id, { kind, material });
    }
  }
  const stickerAssets = capcutStickerAssets(materialList);
  const resourceTitles = capcutResourceTitles(materialList);
  const resourceIds = capcutResourceIds(materialList);
  const assetsByPath = new Map(
    (Array.isArray(filerAssets) ? filerAssets : []).map((asset) => [String(asset?.source_path || ""), asset])
  );

  const entries = [];
  draft.tracks.forEach((track, trackIndex) => {
    const trackType = String(track?.type || "");
    (Array.isArray(track?.segments) ? track.segments : []).forEach((segment, segmentIndex) => {
      entries.push({ trackType, trackIndex, segmentIndex, segment });
    });
  });
  // CapCut layers by render_index (text sits at 14000+); track order breaks ties.
  entries.sort(
    (a, b) =>
      finite(a.segment.render_index, a.trackIndex) - finite(b.segment.render_index, b.trackIndex) ||
      a.trackIndex - b.trackIndex ||
      a.segmentIndex - b.segmentIndex
  );

  let skippedAudio = 0;
  const objects = [];
  const videoEffects = [];
  const renderIndexById = new Map();
  for (const { trackType, segment } of entries) {
    if (trackType === "audio") {
      skippedAudio += 1;
      continue;
    }
    const entry = materials.get(segment.material_id);
    if (!entry) {
      warnings.add(`CapCut ${trackType} segment without a known material was skipped.`);
      continue;
    }
    // An effect TRACK's segment is a video effect over the whole frame for its own window.
    if (entry.kind === "video_effects") {
      videoEffects.push({ segment, material: entry.material, global: true });
      continue;
    }
    const extras = (Array.isArray(segment.extra_material_refs) ? segment.extra_material_refs : [])
      .map((id) => materials.get(id))
      .filter(Boolean);
    // An animation whose resource the package does not ship is not played by CapCut's web editor
    // (3rd template: "Bouncing kiri" on "The Wedding of" / "Aziza" — absent from material_list —
    // the text just appears, still), so it is left out too.
    const animations = extras
      .filter((extra) => extra.kind === "material_animations")
      .flatMap((extra) => (Array.isArray(extra.material.animations) ? extra.material.animations : []))
      .filter((animation) => {
        const id = String(animation?.resource_id || "");
        return !id || resourceIds.size === 0 || resourceIds.has(id);
      });
    for (const extra of extras) {
      if (extra.kind === "video_effects") videoEffects.push({ segment, material: extra.material });
      if (extra.kind === "effects") warnings.add("CapCut video effects are not imported yet.");
      if (extra.kind === "speeds" && Math.abs(finite(extra.material.speed, 1) - 1) > 1e-3) {
        warnings.add("CapCut speed changes are not imported yet; clips play at normal speed.");
      }
    }
    if (Array.isArray(segment.common_keyframes) && segment.common_keyframes.length > 0) {
      warnings.add("CapCut keyframes are not imported yet; layers keep their resting pose.");
    }

    const mask = extras.find((extra) => extra.kind === "common_mask" || extra.kind === "masks")?.material || null;
    if (mask && entry.kind !== "videos" && entry.kind !== "images") warnings.add("CapCut masks on non-media layers are not imported yet.");
    const context = { segment, material: entry.material, fontLineBoxes, fontMeasures, resourceTitles, canvasWidth, canvasHeight, animations, warnings };
    let object = null;
    if (entry.kind === "texts") {
      object = mapTextSegment(context);
    } else if (entry.kind === "videos" || entry.kind === "images") {
      // "images" are PNG overlays on sticker tracks (corner flowers…): photos sized like stickers.
      object = mapMediaSegment({
        ...context,
        mask,
        asset: assetsByPath.get(String(entry.material.path || "")),
        stickerSized: entry.kind === "images",
      });
    } else if (entry.kind === "stickers") {
      object = mapStickerSegment({ ...context, stickerAssets });
    } else if (entry.kind !== "audios") {
      warnings.add(`CapCut ${entry.kind} layers are not imported yet.`);
    }
    if (object?.capcutSplitAfter) {
      const { capcutSplitAfter: split, ...first } = object;
      const cutMs = Math.min(first.timelineEndMs, first.timelineStartMs + split.atMs);
      const rest = { ...first };
      LEGACY_ANIMATION_FIELDS.forEach((field) => delete rest[field]);
      const second = { ...rest, ...split.fields, importNodeId: `${first.importNodeId}-loop`, timelineStartMs: cutMs };
      if (second.type === "video") second.videoStart = round(second.videoStart + split.atMs / 1000, 3);
      objects.push({ ...first, timelineEndMs: cutMs });
      renderIndexById.set(first.importNodeId, finite(segment.render_index));
      if (cutMs < first.timelineEndMs) {
        objects.push(second);
        renderIndexById.set(second.importNodeId, finite(segment.render_index));
      }
    } else if (object) {
      objects.push(object);
      renderIndexById.set(object.importNodeId, finite(segment.render_index));
    }
  }
  if (skippedAudio > 0) warnings.add("Audio is not imported in this phase.");

  const objectsBySegment = new Map(objects.map((object) => [object.importNodeId, object]));
  const flashes = applyCapcutTransitions({ draft, materials, objectsBySegment, canvasWidth, canvasHeight, warnings });
  const effectOverlays = applyCapcutVideoEffects({
    videoEffects,
    objectsBySegment,
    effectPackages: capcutEffectPackages(materialList),
    canvasWidth,
    canvasHeight,
    warnings,
  });
  for (let index = 0; index < objects.length; index += 1) {
    objects[index] = objectsBySegment.get(objects[index].importNodeId) || objects[index];
  }
  // Effect overlays take their place in CapCut's render order (effects sit at 11000+: above the
  // photo/video tracks, under text at 14000+ and the overlays on sticker tracks).
  for (const { object, renderIndex } of effectOverlays) {
    const at = objects.findIndex((other) => renderIndexById.has(other.importNodeId) && renderIndexById.get(other.importNodeId) > renderIndex);
    objects.splice(at < 0 ? objects.length : at, 0, object);
  }
  objects.push(...flashes);

  const usedFonts = [...new Set(objects.filter((object) => object.type === "textbox").map((object) => object.fontFamily))];
  return {
    canvasWidth,
    canvasHeight,
    durationMs: Math.round(finite(draft.duration) / US_PER_MS),
    name: String(draft.name || ""),
    objects,
    usedFonts,
    warnings: [...warnings],
  };
}
