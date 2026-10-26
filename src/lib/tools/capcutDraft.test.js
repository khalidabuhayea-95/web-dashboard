// CapCut draft → fabric objects. Numbers are from a real 1080×1920 CapCut template (wedding
// invitation, read 2026-10-22) and the positions/sizes it rendered at in CapCut's own preview.
//
//   node --test src/lib/tools/capcutDraft.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  capcutBidiText,
  capcutCropRect,
  capcutResourceTitles,
  capcutStickerAssets,
  capcutMaskShape,
  capcutFontFromFileName,
  mapCapcutAnimation,
  mapCapcutDraftToFabric,
  readCapcutPackage,
} from "./capcutDraft.js";

const W = 1080;
const H = 1920;

function clip({ scale = 1, x = 0, y = 0, rotation = 0, alpha = 1 } = {}) {
  return {
    rotation,
    alpha,
    scale: { x: scale, y: scale },
    transform: { x, y },
    flip: { vertical: false, horizontal: false },
  };
}

function segment(id, materialId, { start = 0, duration = 3_935_000, renderIndex = 0, refs = [], sourceStart = 0, ...clipOptions } = {}) {
  return {
    id,
    material_id: materialId,
    target_timerange: { start, duration },
    source_timerange: { start: sourceStart, duration },
    clip: clip(clipOptions),
    render_index: renderIndex,
    extra_material_refs: refs,
    visible: true,
  };
}

function textContent(text, size, fontFile, color = [0.0157, 0.2157, 0.0392]) {
  return JSON.stringify({
    text,
    styles: [{ fill: { content: { solid: { color } } }, range: [0, text.length], size, font: { path: `/__opfs/x/${fontFile}` } }],
  });
}

function draft() {
  return {
    name: "202610220949",
    duration: 16_659_570,
    canvas_config: { width: W, height: H },
    tracks: [
      {
        type: "video",
        segments: [
          segment("bg", "m-bg", { renderIndex: 0 }),
          segment("clip", "m-clip", { start: 3_928_000, duration: 5_013_000, sourceStart: 2_000_000, renderIndex: 0 }),
        ],
      },
      {
        type: "text",
        segments: [segment("joy", "m-joy", { renderIndex: 14002, scale: 10.206, y: 0.689, refs: ["anim-joy"] })],
      },
      {
        // Lower render_index than the text track before it: must land below the text.
        type: "video",
        segments: [segment("garland", "m-garland", { renderIndex: 9, scale: 0.599, y: 0.632, refs: ["anim-fade"] })],
      },
      { type: "video", segments: [segment("corner", "m-corner", { renderIndex: 6, scale: 0.599, x: -0.819, y: 0.834, rotation: 90 })] },
      { type: "audio", segments: [segment("music", "m-music")] },
    ],
    materials: {
      videos: [
        { id: "m-bg", type: "photo", path: "/videos/bg.png", width: 1080, height: 1920, material_name: "bg.png" },
        { id: "m-clip", type: "video", path: "/videos/clip.mp4", width: 1072, height: 1920, duration: 10_000_000 },
        { id: "m-garland", type: "photo", path: "/videos/garland.png", width: 500, height: 500 },
        { id: "m-corner", type: "photo", path: "/videos/corner.png", width: 500, height: 500 },
      ],
      texts: [
        {
          id: "m-joy",
          type: "text",
          content: textContent("With great joy,\nwe invite you to celebrate the union of", 1, "PinyonScript-Regular.ttf"),
          alignment: 1,
          line_spacing: 0.02,
          letter_spacing: 0.02,
        },
      ],
      audios: [{ id: "m-music", type: "extract_music" }],
      material_animations: [
        { id: "anim-joy", animations: [{ type: "in", name: "Fade In", duration: 800_000 }, { type: "out", name: "Fade Out", duration: 798_000 }] },
        { id: "anim-fade", animations: [{ type: "in", name: "Showing Down", duration: 800_000 }, { type: "out", name: "Ripple", duration: 500_000 }] },
      ],
    },
  };
}

const filerAssets = ["bg.png", "clip.mp4", "garland.png", "corner.png"].map((file) => ({
  source_path: `/videos/${file}`,
  mime: file.endsWith(".mp4") ? "video/mp4" : "image/png",
  origin_download_link: `https://media.example/${file}?X-Everphoto-Token=t`,
}));

function center(object) {
  const width = object.width * Math.abs(object.scaleX ?? 1);
  const height = object.height * Math.abs(object.scaleY ?? 1);
  const radians = ((object.angle || 0) * Math.PI) / 180;
  return {
    x: object.left + (width / 2) * Math.cos(radians) - (height / 2) * Math.sin(radians),
    y: object.top + (width / 2) * Math.sin(radians) + (height / 2) * Math.cos(radians),
  };
}

test("canvas, duration and layer order follow render_index; audio is left out", () => {
  const result = mapCapcutDraftToFabric({ draft: draft(), filerAssets });
  assert.equal(result.canvasWidth, W);
  assert.equal(result.canvasHeight, H);
  assert.equal(result.durationMs, 16_660);
  assert.deepEqual(
    result.objects.map((object) => object.importNodeId),
    ["bg", "clip", "corner", "garland", "joy"]
  );
  assert.ok(result.warnings.includes("Audio is not imported in this phase."));
});

test("a full-canvas photo at scale 1 fills the page", () => {
  const bg = mapCapcutDraftToFabric({ draft: draft(), filerAssets }).objects[0];
  assert.equal(bg.type, "image");
  assert.equal(bg.left, 0);
  assert.equal(bg.top, 0);
  assert.equal(bg.scaleX, 1);
  assert.equal(bg.src, filerAssets[0].origin_download_link);
  assert.deepEqual([bg.timelineStartMs, bg.timelineEndMs], [0, 3935]);
});

test("media is fitted inside the canvas, scaled, and centred on the CapCut transform (y up)", () => {
  const garland = mapCapcutDraftToFabric({ draft: draft(), filerAssets }).objects.find((o) => o.importNodeId === "garland");
  // 500×500 contained in 1080 wide = 1080 px, × 0.599 = 646.9 px; CapCut drew it centred at y ≈ 353.
  assert.ok(Math.abs(garland.width * garland.scaleX - 646.92) < 0.01);
  const c = center(garland);
  assert.ok(Math.abs(c.x - 540) < 0.01);
  assert.ok(Math.abs(c.y - (960 - 0.632 * 960)) < 0.01);
});

test("a turned layer keeps its CapCut centre (fabric turns around the top-left corner)", () => {
  const corner = mapCapcutDraftToFabric({ draft: draft(), filerAssets }).objects.find((o) => o.importNodeId === "corner");
  assert.equal(corner.angle, 90);
  const c = center(corner);
  assert.ok(Math.abs(c.x - (540 - 0.819 * 540)) < 0.01);
  assert.ok(Math.abs(c.y - (960 - 0.834 * 960)) < 0.01);
});

test("video keeps its source window and timeline slot", () => {
  const video = mapCapcutDraftToFabric({ draft: draft(), filerAssets }).objects.find((o) => o.importNodeId === "clip");
  assert.equal(video.type, "video");
  assert.equal(video.capcutMimeType, "video/mp4");
  assert.deepEqual([video.videoStart, video.videoEnd, video.videoDuration], [2, 7.013, 10]);
  assert.deepEqual([video.timelineStartMs, video.timelineEndMs], [3928, 8941]);
});

test("text: size × scale × 5 px, centred, font from the file name, colour and fade in/out", () => {
  const joy = mapCapcutDraftToFabric({ draft: draft(), filerAssets }).objects.find((o) => o.importNodeId === "joy");
  assert.equal(joy.type, "textbox");
  // Measured in CapCut's preview: an em of 50–54 px for this line.
  assert.ok(Math.abs(joy.fontSize - 51.03) < 0.01);
  assert.equal(joy.fontFamily, "Pinyon Script");
  assert.equal(joy.fill, "rgb(4, 55, 10)");
  assert.equal(joy.textAlign, "center");
  assert.equal(joy.scaleX, 1);
  const c = center(joy);
  assert.ok(Math.abs(c.x - 540) < 0.01);
  assert.ok(Math.abs(c.y - (960 - 0.689 * 960)) < 0.01);
  assert.equal(joy.mediaAnimationMode, "IN_OUT");
  assert.equal(joy.animations.entrance.type, "FADE");
  assert.equal(joy.animations.exit.durationMs, 798);
});

test("tight CapCut line spacing still leaves room for the last line (Konva drops lines past the box)", () => {
  const d = draft();
  d.materials.texts[0] = {
    ...d.materials.texts[0],
    content: textContent("Reception begins at 11:00 AM\n\nEnds at 4:00PM", 2, "HarmonyOS_Sans_Condensed_Medium_Italic.ttf"),
    line_spacing: -0.5,
  };
  d.tracks[1].segments[0].clip.scale = { x: 3.6, y: 3.6 };
  const text = mapCapcutDraftToFabric({ draft: d, filerAssets }).objects.find((o) => o.importNodeId === "joy");
  // Default line box 1.248 × (1 − 0.52) = 0.599 em per step.
  assert.equal(text.lineHeight, 0.599);
  // Two 0.599 em steps plus one full line: (2 × 0.599 + 1) × 36 px.
  assert.ok(Math.abs(text.height - 79.13) < 0.01);
  assert.ok(text.height >= 3 * text.lineHeight * text.fontSize);
});

test("unmatched CapCut animations are reported, matched ones keep direction", () => {
  const result = mapCapcutDraftToFabric({ draft: draft(), filerAssets });
  const garland = result.objects.find((o) => o.importNodeId === "garland");
  assert.equal(garland.animations.entrance.type, "WIPE");
  assert.equal(garland.animations.entrance.direction, "DOWN");
  assert.equal(garland.animations.exit, null);
  assert.equal(garland.mediaAnimationMode, "IN");
  assert.ok(result.warnings.some((warning) => warning.includes('"Ripple"')));
});

test("animation names map onto the editor's slots", () => {
  assert.deepEqual(
    [
      ["in", "Type 2"],
      ["out", "Dilute"],
      ["in", "Slide Up"],
      ["out", "Zoom Out"],
      ["in", "Fold"],
    ].map(([type, name]) => {
      const mapped = mapCapcutAnimation({ type, name, duration: 500_000 });
      return [mapped.slot, mapped.value.type, mapped.value.direction];
    }),
    [
      ["entrance", "TYPEWRITER_CHARS", "DEFAULT"],
      ["exit", "DISSOLVE", "DEFAULT"],
      // Slide Up = a fade with a ramp from below (see the motion entrance test).
      ["entrance", "FADE", "DEFAULT"],
      ["exit", "ZOOM", "DEFAULT"],
      ["entrance", "ZOOM_FADE", "DEFAULT"],
    ]
  );
  assert.equal(mapCapcutAnimation({ type: "loop", name: "Swing" }).value.type, "WOBBLE");
  assert.equal(mapCapcutAnimation({ type: "loop", name: "Glitch" }), null);
});

test("CapCut's typewriters carry their own letter pacing", () => {
  const pacing = (name, title = "") => mapCapcutAnimation({ type: "in", name, duration: 3_000_000 }, title).value;
  assert.deepEqual(pacing("Tipe 2", "Type 2").params, { typePacing: 1 });
  assert.deepEqual(pacing("Huruf Acak", "Random Typewriter").params, { typePacing: 2 });
  assert.deepEqual(pacing("Huruf Acak").params, { typePacing: 2 });
  assert.deepEqual(pacing("Mesin Ketik", "Typewriter").params, { typePacing: 3 });
  assert.equal(pacing("Mesin Ketik").type, "TYPEWRITER_CHARS");
  // A typing effect CapCut paces some other way keeps the editor's own cadence.
  assert.equal(pacing("Typing").params, undefined);
  // An exit is a fade, never paced.
  assert.equal(mapCapcutAnimation({ type: "out", name: "Type 2", duration: 500_000 }).value.params, undefined);
});

test("a photo without a download link is skipped with a warning", () => {
  const result = mapCapcutDraftToFabric({ draft: draft(), filerAssets: filerAssets.slice(1) });
  assert.ok(!result.objects.some((o) => o.importNodeId === "bg"));
  assert.ok(result.warnings.some((warning) => warning.includes("bg.png")));
});

test("font file names become family, weight and style", () => {
  assert.deepEqual(capcutFontFromFileName("PinyonScript-Regular.ttf"), {
    fileName: "PinyonScript-Regular",
    family: "Pinyon Script",
    fontWeight: 400,
    fontStyle: "normal",
  });
  assert.equal(capcutFontFromFileName("PlayfairDisplay-Italic.ttf").fontStyle, "italic");
  assert.equal(capcutFontFromFileName("Gloock-Regular.ttf").family, "Gloock");
  const harmony = capcutFontFromFileName("HarmonyOS_Sans_Condensed_Medium.ttf");
  assert.equal(harmony.family, "HarmonyOS Sans Condensed");
  assert.equal(harmony.fontWeight, 500);
  assert.equal(capcutFontFromFileName("Analogue.otf").family, "Analogue");
  const playfair = capcutFontFromFileName("PlayfairDisplay-Italic-VariableFont_wght.ttf");
  assert.equal(playfair.family, "Playfair Display");
  assert.equal(playfair.fontStyle, "italic");
  assert.equal(playfair.fontWeight, 400);
  assert.equal(capcutFontFromFileName("Inter[wght].ttf").family, "Inter");
  const harmonyItalic = capcutFontFromFileName("HarmonyOS_Sans_Condensed_Medium_Italic.ttf");
  assert.deepEqual([harmonyItalic.family, harmonyItalic.fontWeight, harmonyItalic.fontStyle], ["HarmonyOS Sans Condensed", 500, "italic"]);
});

test("readCapcutPackage parses the string fields of a get_package_info answer", () => {
  const parsed = readCapcutPackage({
    ret: "0",
    data: {
      draft: JSON.stringify(draft()),
      filer_asset_list: JSON.stringify(filerAssets),
      frame_info: { image: { preview_url_webp_480p_image_data: "UklGRg==" } },
    },
  });
  assert.equal(parsed.draft.tracks.length, 5);
  assert.equal(parsed.filerAssets.length, 4);
  assert.equal(parsed.previewImageBase64, "UklGRg==");
});

test("a cropped photo is sized from its crop and carries the rect for the route to cut", () => {
  // The paper card of the real template: 1080×1920 photo, crop x .2308–.7497, y .3031–.6944, scale 0.793.
  const card = {
    upper_left_x: 0.230804860591888, upper_left_y: 0.303122371435165,
    upper_right_x: 0.749745786190033, upper_right_y: 0.303122371435165,
    lower_left_x: 0.230804860591888, lower_left_y: 0.694387376308441,
    lower_right_x: 0.749745786190033, lower_right_y: 0.694387376308441,
  };
  const d = draft();
  d.materials.videos[0] = { ...d.materials.videos[0], crop: card };
  d.tracks[0].segments[0].clip.scale = { x: 0.793, y: 0.793 };
  const bg = mapCapcutDraftToFabric({ draft: d, filerAssets }).objects.find((o) => o.importNodeId === "bg");
  assert.deepEqual([bg.width, bg.height, bg.sourceWidth, bg.sourceHeight], [560, 751, 560, 751]);
  assert.deepEqual(bg.capcutCrop, { x0: 0.230805, y0: 0.303122, x1: 0.749746, y1: 0.694387 });
  // The cropped frame is fitted inside the canvas (width-bound here), then scaled, and stays centred.
  assert.ok(Math.abs(bg.width * bg.scaleX - (1080 * 0.793)) < 0.01);
  const c = center(bg);
  assert.ok(Math.abs(c.x - 540) < 0.01 && Math.abs(c.y - 960) < 0.01);
});

test("crop_scale shrinks a cropped photo (the rose cut-out: 612×408, right 43.8%, crop_scale 0.438)", () => {
  const d = draft();
  d.materials.videos[2] = {
    ...d.materials.videos[2],
    width: 612,
    height: 408,
    crop_scale: 0.438202261924744,
    crop: {
      upper_left_x: 0.561797738075256, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0,
      lower_left_x: 0.561797738075256, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1,
    },
  };
  d.tracks[2].segments[0].clip.scale = { x: 1.244, y: 1.244 };
  const rose = mapCapcutDraftToFabric({ draft: d, filerAssets }).objects.find((o) => o.importNodeId === "garland");
  assert.deepEqual([rose.width, rose.height], [268, 408]);
  // CapCut drew it ≈ 527×870 of visible petals; the box is 588×896.
  assert.ok(Math.abs(rose.width * rose.scaleX - 588.4) < 1);
  assert.ok(Math.abs(rose.height * rose.scaleY - 895.8) < 1);
});

test("a video crop is reported, not baked", () => {
  const d = draft();
  d.materials.videos[1] = { ...d.materials.videos[1], crop: { upper_left_x: 0.1, lower_left_x: 0.1, upper_right_x: 1, lower_right_x: 1, lower_left_y: 1, lower_right_y: 1 } };
  const result = mapCapcutDraftToFabric({ draft: d, filerAssets });
  const clip = result.objects.find((o) => o.importNodeId === "clip");
  assert.equal(clip.capcutCrop, undefined);
  assert.equal(clip.width, 1072);
  assert.ok(result.warnings.some((w) => w.includes("crop on video")));
});

test("crop rect: full frame and degenerate crops mean no crop", () => {
  assert.equal(capcutCropRect({ upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1, lower_left_x: 0, upper_right_y: 0 }), null);
  assert.equal(capcutCropRect(null), null);
  assert.equal(capcutCropRect({ upper_left_x: 0.5, lower_left_x: 0.5, upper_right_x: 0.5, lower_right_x: 0.5 }), null);
});

test("text is sized by its CapCut font's line box (Gloock 0.98, Prata 1.355)", () => {
  const d = draft();
  d.materials.texts[0] = { ...d.materials.texts[0], content: textContent("A", 15, "Gloock-Regular.ttf"), line_spacing: 0.02 };
  const content = JSON.parse(d.materials.texts[0].content);
  content.styles[0].font.id = "7267841353415922233";
  d.materials.texts[0].content = JSON.stringify(content);
  d.tracks[1].segments[0].clip.scale = { x: 4.859, y: 4.859 };
  const fontLineBoxes = new Map([["7267841353415922233", 0.98]]);
  const a = mapCapcutDraftToFabric({ draft: d, filerAssets, fontLineBoxes }).objects.find((o) => o.importNodeId === "joy");
  // 15 × 4.859 × 6.24 / 0.98 = 464 px em; CapCut drew the "A" at ≈ 460.
  assert.ok(Math.abs(a.fontSize - 464.08) < 0.1);
  // The route adds this font's own file to the library, keyed by the style's font id.
  assert.equal(a.capcutFontId, "7267841353415922233");
  assert.equal(a.lineHeight, 0.98);
  // Without the font file, Pinyon's box: the old 5 px per unit.
  const fallback = mapCapcutDraftToFabric({ draft: d, filerAssets }).objects.find((o) => o.importNodeId === "joy");
  assert.ok(Math.abs(fallback.fontSize - 15 * 4.859 * 5) < 0.01);
});

test("a rectangle mask on a photo is passed on to be baked; other masks are reported", () => {
  const cardMask = {
    id: "mask-1",
    type: "mask",
    name: "Rectangle",
    resource_type: "rectangle",
    config: { width: 0.824226558208466, height: 0.970426499843597, centerX: 0, centerY: 0, rotation: 0, feather: 0.15861842311176216, roundCorner: 0.38486909866333, invert: false },
  };
  const d = draft();
  d.materials.common_mask = [cardMask];
  d.tracks[0].segments[0].extra_material_refs = ["mask-1"];
  let result = mapCapcutDraftToFabric({ draft: d, filerAssets });
  const bg = result.objects.find((o) => o.importNodeId === "bg");
  assert.deepEqual(bg.capcutMask, capcutMaskShape(cardMask));
  assert.equal(bg.capcutMask.shape, "rectangle");
  assert.ok(!result.warnings.some((w) => /mask/i.test(w)));

  d.materials.common_mask = [{ ...cardMask, name: "Heart", resource_type: "heart" }];
  result = mapCapcutDraftToFabric({ draft: d, filerAssets });
  assert.equal(result.objects.find((o) => o.importNodeId === "bg").capcutMask, undefined);
  assert.ok(result.warnings.some((w) => w.includes("Heart mask")));
});

function withTransition(name, durationUs, overlap = true) {
  const d = draft();
  d.materials.transitions = [{ id: "tr-1", type: "transition", name, duration: durationUs, is_overlap: overlap }];
  d.tracks[0].segments[0].extra_material_refs = ["tr-1"];
  return d;
}

test("a light transition (Glowburst) becomes a white flash on top, centred on the cut", () => {
  const result = mapCapcutDraftToFabric({ draft: withTransition("Glowburst", 1_200_000, false), filerAssets });
  const flash = result.objects[result.objects.length - 1];
  assert.equal(flash.type, "rect");
  assert.equal(flash.layerName, "Transition: Glowburst");
  assert.deepEqual([flash.left, flash.top, flash.width, flash.height, flash.fill, flash.opacity], [0, 0, 1080, 1920, "#ffffff", 1]);
  // bg ends at 3935 ms: the flash spans 3335–4535, fading in 600 ms and out 600 ms.
  assert.deepEqual([flash.timelineStartMs, flash.timelineEndMs], [3335, 4535]);
  assert.equal(flash.animations.entrance.type, "FADE");
  assert.equal(flash.animations.entrance.durationMs, 600);
  assert.equal(flash.animations.exit.durationMs, 600);
  assert.equal(flash.mediaAnimationMode, "IN_OUT");
  assert.ok(!result.warnings.some((w) => /transition/i.test(w)));
  // Glare is the milder light leak.
  const glare = mapCapcutDraftToFabric({ draft: withTransition("Glare", 600_000), filerAssets }).objects.at(-1);
  assert.equal(glare.opacity, 0.6);
});

test("Mix cross-fades: the clips overlap by its length and the incoming clip fades in", () => {
  const result = mapCapcutDraftToFabric({ draft: withTransition("Mix", 500_000), filerAssets });
  const bg = result.objects.find((o) => o.importNodeId === "bg");
  const clip = result.objects.find((o) => o.importNodeId === "clip");
  // Cut at 3935 / 3928: the outgoing photo runs 250 ms longer, the clip starts 250 ms early.
  assert.equal(bg.timelineEndMs, 3935 + 250);
  assert.equal(clip.timelineStartMs, 3928 - 250);
  assert.equal(clip.animations.entrance.type, "FADE");
  assert.equal(clip.animations.entrance.durationMs, 500);
  assert.equal(clip.videoStart, 1.75);
  // The incoming clip stays above the outgoing one.
  assert.ok(result.objects.indexOf(clip) > result.objects.indexOf(bg));
  assert.ok(!result.objects.some((o) => o.type === "rect"));
});

test("dip to black fades out then in; an unknown transition is a reported cross-fade", () => {
  const dip = mapCapcutDraftToFabric({ draft: withTransition("Dip to Black", 800_000), filerAssets });
  assert.equal(dip.objects.find((o) => o.importNodeId === "bg").animations.exit.durationMs, 400);
  assert.equal(dip.objects.find((o) => o.importNodeId === "clip").animations.entrance.durationMs, 400);
  const odd = mapCapcutDraftToFabric({ draft: withTransition("Pull In", 600_000), filerAssets });
  assert.equal(odd.objects.find((o) => o.importNodeId === "clip").animations.entrance.type, "FADE");
  assert.ok(odd.warnings.some((w) => w.includes('"Pull In" was imported as a cross-fade')));
});

// The real template's butterfly sticker: a 232×280 GIF in a heycan package, scale 1.565, 14°.
const butterflyList = [
  {
    schema: "heycan://7233769854417784070",
    heycan_item: {
      common_attr: {
        title: "qingrenjie-hudie",
        aspect_ratio: 0.8285714285714286,
        item_urls: ["https://cdn.example/b.zip"],
        download_info: { url: "https://cdn.example/b.image", format: "gif" },
      },
      sticker: { large_images: [{ image_url: "https://cdn.example/b.gif", width: 232, height: 280 }] },
    },
  },
];

function stickerDraft() {
  const d = draft();
  d.materials.stickers = [{ id: "m-sticker", type: "sticker", resource_id: "7233769854417784070", name: "qingrenjie-hudie" }];
  d.tracks.push({ type: "sticker", segments: [segment("butterflies", "m-sticker", { start: 14_000, duration: 3_920_000, renderIndex: 14001, scale: 1.565, y: 0.095, rotation: 14, refs: ["anim-joy"] })] });
  return d;
}

test("sticker packages are indexed by resource id with their GIF", () => {
  const assets = capcutStickerAssets(butterflyList);
  assert.deepEqual(assets.get("7233769854417784070"), {
    url: "https://cdn.example/b.gif",
    width: 232,
    height: 280,
    aspectRatio: 0.8285714285714286,
    title: "qingrenjie-hudie",
    packageUrl: "https://cdn.example/b.zip",
  });
});

test("a sticker becomes an animated image at its pixel size × (canvas / 720) × scale", () => {
  const result = mapCapcutDraftToFabric({ draft: stickerDraft(), filerAssets, materialList: butterflyList });
  const sticker = result.objects.find((o) => o.importNodeId === "butterflies");
  assert.equal(sticker.type, "image");
  assert.equal(sticker.src, "https://cdn.example/b.gif");
  assert.equal(sticker.capcutAnimated, true);
  assert.equal(sticker.capcutMimeType, "image/gif");
  assert.equal(sticker.capcutStickerPackage, "https://cdn.example/b.zip");
  assert.deepEqual([sticker.width, sticker.height], [232, 280]);
  // canvas width / 720 × 1.565 = 2.3475 (the sticker's Lua: viewer width / 720); drawn ≈ 2.32×.
  assert.ok(Math.abs(sticker.scaleX - 2.3475) < 1e-6);
  assert.equal(sticker.angle, 14);
  const c = center(sticker);
  assert.ok(Math.abs(c.x - 540) < 0.01 && Math.abs(c.y - (960 - 0.095 * 960)) < 0.01);
  assert.equal(sticker.animations.entrance.type, "FADE");
  assert.ok(!result.warnings.some((w) => /sticker/i.test(w)));
});

test("a sticker without a package is reported and skipped", () => {
  const result = mapCapcutDraftToFabric({ draft: stickerDraft(), filerAssets });
  assert.ok(!result.objects.some((o) => o.importNodeId === "butterflies"));
  assert.ok(result.warnings.some((w) => w.includes('sticker "qingrenjie-hudie" has no downloadable image')));
});

// The Arabic invitation template: names follow the editor's UI language, the package lists the
// resources under English titles (heycan://<resource_id>).
const arabicList = [
  { schema: "heycan://7646372988182383893", heycan_item: { common_attr: { title: "Gradual Reveal" } } },
  { schema: "heycan://6887766069587481090", heycan_item: { common_attr: { title: "Bounce In" } } },
  { schema: "heycan://7481210295273262342", heycan_item: { common_attr: { title: "أميري", item_urls: ["https://cdn.example/amiri.zip"] } } },
];

test("animations match by the package's English title, then by their Arabic name; loops map too", () => {
  const titles = capcutResourceTitles(arabicList);
  assert.equal(titles.get("7646372988182383893"), "Gradual Reveal");
  // Gradual Reveal is a glow on fully visible text (its package keys exposure, not opacity).
  const reveal = mapCapcutAnimation({ type: "in", name: "ظهور تدريجي", resource_id: "7646372988182383893", duration: 3_919_000 }, titles.get("7646372988182383893"));
  assert.deepEqual(reveal, { slot: null, value: null });
  // Without the package title, the Arabic name alone still matches.
  assert.equal(mapCapcutAnimation({ type: "in", name: "ظهور تدريجي", duration: 500_000 }).slot, null);
  assert.equal(mapCapcutAnimation({ type: "in", name: "Fade In", duration: 500_000 }).value.type, "FADE");
  // Bounce In: the layer scales 0 → 1.1 (57%) → 1, no fade — a concurrent BREATHE ramp.
  const bounce = mapCapcutAnimation({ type: "in", name: "ارتداد للداخل", duration: 500_000 }, "Bounce In");
  assert.equal(bounce.slot, "loop");
  assert.equal(bounce.value.type, "BREATHE");
  assert.deepEqual(bounce.value.params, {
    concurrent: 1,
    r1From: 0,
    r1To: 1.1,
    r1Start: 0,
    r1Dur: 285,
    r1Ease: 3,
    r2To: 1,
    r2Start: 285,
    r2Dur: 215,
    r2Ease: 15,
  });
  // As a "loop" it still plays once (CapCut's live render); other loops keep their loop.
  const loop = mapCapcutAnimation({ type: "loop", name: "ارتداد للداخل", duration: 800_000 }, "Bounce In");
  assert.deepEqual([loop.slot, loop.value.type, loop.value.params.r1Dur, loop.value.params.r2Dur], ["loop", "BREATHE", 456, 344]);
  const hop = mapCapcutAnimation({ type: "loop", name: "Bounce", duration: 800_000 });
  assert.deepEqual([hop.slot, hop.value.type, hop.value.infinite, hop.value.durationMs], ["loop", "BOUNCE", true, 800]);
});

test("a loop-only layer keeps its loop with the LOOP legacy mirror; a glow-only entrance is reported", () => {
  const d = draft();
  d.materials.material_animations = [
    {
      id: "anim-joy",
      animations: [
        { type: "loop", name: "ارتداد للداخل", resource_id: "6887766069587481090", duration: 800_000 },
        { type: "in", name: "ظهور تدريجي", resource_id: "7646372988182383893", duration: 3_919_000 },
      ],
    },
  ];
  const result = mapCapcutDraftToFabric({ draft: d, filerAssets, materialList: arabicList });
  const joy = result.objects.find((o) => o.importNodeId === "joy");
  assert.equal(joy.animations.loop.type, "BREATHE");
  assert.equal(joy.animations.entrance, null);
  assert.equal(joy.mediaAnimationMode, "LOOP");
  assert.equal(joy.mediaAnimationInfinite, true);
  assert.ok(result.warnings.includes('CapCut text effect "Gradual Reveal" (a glow / colour fringe; the text stays visible) is not drawn.'));
});

test("leading blank lines are trimmed and the box moved down by the lines they took", () => {
  const d = draft();
  d.materials.texts[0] = { ...d.materials.texts[0], content: textContent("\n    ۩ حَفْلِ زِفَافِ ۩", 15, "font.ttf"), line_spacing: 0.02 };
  d.tracks[1].segments[0].clip = clip({ scale: 3, y: 0.1 });
  const text = mapCapcutDraftToFabric({ draft: d, filerAssets }).objects.find((o) => o.importNodeId === "joy");
  assert.equal(text.text, "    ۩ حَفْلِ زِفَافِ ۩");
  assert.equal(text.layerName, "۩ حَفْلِ زِفَافِ ۩");
  // One blank line above: the remaining line sits half a line pitch below the CapCut centre.
  const c = center(text);
  const pitch = text.lineHeight * text.fontSize;
  assert.ok(Math.abs(c.y - (960 - 0.1 * 960 + pitch / 2)) < 0.01);
  // A generic font file name ("font.ttf") names no family and is not kept as an alias.
  assert.equal(text.capcutFontGuessed, false);
  assert.equal(text.fontFamily, "Arial");
});

test("Arabic harakat do not widen the estimated text box", () => {
  const d = draft();
  d.materials.texts[0] = { ...d.materials.texts[0], content: textContent("مُحَمَّد & سَارَة", 2, "font.ttf") };
  const bare = mapCapcutDraftToFabric({ draft: d, filerAssets }).objects.find((o) => o.importNodeId === "joy");
  d.materials.texts[0] = { ...d.materials.texts[0], content: textContent("محمد & سارة", 2, "font.ttf") };
  const plain = mapCapcutDraftToFabric({ draft: d, filerAssets }).objects.find((o) => o.importNodeId === "joy");
  assert.equal(bare.width, plain.width);
});

// The Arabic wedding template's clip effects (2026-10-22), slider values as stored in its draft.
const VEIL = "7654855039005035793";
const HAZY = "7626291676520418580";
const ZOOM = "7399465441057328389";
const effectList = [
  { schema: `heycan://${VEIL}`, heycan_item: { common_attr: { title: "Gossamer Veil", item_urls: ["https://cdn.example/veil.zip"] } } },
  { schema: `heycan://${HAZY}`, heycan_item: { common_attr: { title: "Hazy Flash", item_urls: ["https://cdn.example/hazy.zip"] } } },
];

function effect(id, resourceId, name, start, duration, adjust, renderIndex) {
  return {
    id,
    name,
    effect_id: resourceId,
    resource_id: resourceId,
    type: "video_effect",
    apply_target_type: 0,
    value: 1,
    render_index: renderIndex,
    adjust_params: Object.entries(adjust).map(([key, value]) => ({ name: `effects_adjust_${key}`, value })),
    time_range: { start, duration },
  };
}

function effectsDraft() {
  const d = draft();
  d.materials.video_effects = [
    effect("fx-hazy", HAZY, "وميض ضبابي", 0, 1_978_571, { speed: 0.14, luminance: 0.13, intensity: 0.16 }, 11000),
    effect("fx-zoom", ZOOM, "عدسة تكبير", 0, 1_950_000, { range: 0.04, speed: 0.05 }, 11001),
    // One veil laid over both clips: the second entry is the same clock seen from the next clip.
    effect("fx-veil", VEIL, "حجاب رقيق", 0, 6_000_000, { speed: 0.333333 }, 11002),
    effect("fx-veil-2", VEIL, "حجاب رقيق", -3_928_000, 6_000_000, { speed: 0.333333 }, 11002),
    effect("fx-other", "1234", "Snowfall", 0, 1_000_000, {}, 11003),
  ];
  d.tracks[0].segments[0].extra_material_refs = ["fx-hazy", "fx-zoom", "fx-veil", "fx-other"];
  d.tracks[0].segments[1].extra_material_refs = ["fx-veil-2"];
  return d;
}

test("Zoom Lens ramps its own clip up to the package's scale, then snaps back when it stops", () => {
  const result = mapCapcutDraftToFabric({ draft: effectsDraft(), filerAssets, materialList: effectList });
  const bg = result.objects.find((o) => o.importNodeId === "bg");
  const loop = bg.animations.loop;
  assert.equal(loop.type, "BREATHE");
  assert.equal(loop.params.concurrent, 1);
  // range 3 × 0.04, speed 1.5 × 0.05 + 0.5: 1 + 0.12 · sin(π/2 · 1.95 · 0.575 / 2.4) = 1.0804.
  assert.deepEqual(
    [loop.params.r1From, loop.params.r1To, loop.params.r1Start, loop.params.r1Dur],
    [1, 1.0804, 0, 1950]
  );
  assert.deepEqual([loop.params.r2To, loop.params.r2Start, loop.params.r2Dur], [1, 1950, 0]);
  assert.equal(bg.mediaAnimationMode, "LOOP");
  // The other clip is untouched.
  assert.equal(result.objects.find((o) => o.importNodeId === "clip").animations, undefined);
});

test("Hazy Flash pulses become soft white flashes over its window", () => {
  const result = mapCapcutDraftToFabric({ draft: effectsDraft(), filerAssets, materialList: effectList });
  const pulses = result.objects.filter((o) => o.layerName === "Effect: وميض ضبابي");
  // speed 0.5 + 0.14 × 2.5 = 0.85; exposure 0.7 × 3 × 0.16, half of it as white.
  assert.deepEqual(
    pulses.map((o) => [o.type, o.timelineStartMs, o.timelineEndMs, o.opacity]),
    [
      ["rect", 196, 980, 0.168],
      ["rect", 1373, 1979, 0.168],
    ]
  );
  // The second pulse is cut by the effect's end after its peak (1765 ms).
  assert.deepEqual([pulses[1].animations.entrance.durationMs, pulses[1].animations.exit.durationMs], [392, 214]);
});

test("Gossamer Veil is one overlay over both clips, above the media and under the text", () => {
  const result = mapCapcutDraftToFabric({ draft: effectsDraft(), filerAssets, materialList: effectList });
  const names = result.objects.map((o) => o.importNodeId);
  const veils = result.objects.filter((o) => o.capcutEffectOverlay);
  assert.equal(veils.length, 1);
  const [veil] = veils;
  assert.deepEqual(veil.capcutEffectOverlay, { packageUrl: "https://cdn.example/veil.zip", aspect: 0.5625, speed: 1, fromMs: 0, toMs: 6000, loop: false });
  assert.deepEqual([veil.type, veil.left, veil.top, veil.width, veil.height, veil.timelineStartMs, veil.timelineEndMs], ["image", 0, 0, 1080, 1920, 0, 6000]);
  // Render order: haze (11000) under the veil (11002), both after the last photo, before the text.
  const veilIndex = result.objects.indexOf(veil);
  assert.ok(veilIndex > names.indexOf("garland") && veilIndex < names.indexOf("joy"));
  assert.ok(result.objects.findIndex((o) => o.layerName === "Effect: وميض ضبابي") < veilIndex);
  assert.ok(result.warnings.includes('CapCut video effect "Snowfall" is not imported yet.'));
  assert.ok(!result.warnings.some((w) => /حجاب|وميض|عدسة/.test(w)));
});

test("an overlay effect without a package is reported and skipped", () => {
  const result = mapCapcutDraftToFabric({ draft: effectsDraft(), filerAssets, materialList: [] });
  assert.equal(result.objects.filter((o) => o.capcutEffectOverlay).length, 0);
  assert.ok(result.warnings.includes('CapCut video effect "حجاب رقيق" has no downloadable package and was skipped.'));
});

test("a line CapCut lays out left-to-right (it starts with a digit or Latin letter) is isolated LTR", () => {
  const LRI = "\u2066";
  const PDI = "\u2069";
  // The Arabic template's date: CapCut draws "25 مساءً 7 | مايو" left to right.
  assert.equal(capcutBidiText(" 25 مايو | 7 مساءً"), `${LRI} 25 مايو | 7 مساءً${PDI}`);
  // Lines starting with Arabic (or a neutral sign) and lines with no Arabic stay as they are.
  assert.equal(capcutBidiText(" مُحَمَّد  &  سَارَة "), " مُحَمَّد  &  سَارَة ");
  assert.equal(capcutBidiText("۩ حَفْلِ زِفَافِ ۩"), "۩ حَفْلِ زِفَافِ ۩");
  assert.equal(capcutBidiText("Save the date"), "Save the date");
  // Per line.
  assert.equal(capcutBidiText("يوم الجمعة\n7 مساءً"), `يوم الجمعة\n${LRI}7 مساءً${PDI}`);
});

// The 3rd template (Indonesian wedding, 2026-10-22): base_content, image overlays, effect tracks.
test("a text with base_content is drawn from it (words, colour, size), as CapCut's template editor does", () => {
  const d = draft();
  const text = d.materials.texts[0];
  text.content = textContent("The Wedding of", 12, "Oranienbaum.ttf", [0.439, 0.471, 0.322]);
  text.base_content = textContent("The Wedding of", 15, "Oranienbaum.ttf", [0.549, 0.067, 0.067]);
  const joy = mapCapcutDraftToFabric({ draft: d, filerAssets }).objects.find((o) => o.importNodeId === "joy");
  assert.equal(joy.fill, "rgb(140, 17, 17)");
  const plain = draft();
  plain.materials.texts[0].content = textContent("The Wedding of", 12, "Oranienbaum.ttf");
  const small = mapCapcutDraftToFabric({ draft: plain, filerAssets }).objects.find((o) => o.importNodeId === "joy");
  assert.ok(Math.abs(joy.fontSize / small.fontSize - 15 / 12) < 1e-6);
});

test("a text box is as wide as its longest line measured in CapCut's font file", () => {
  const d = draft();
  d.materials.texts[0].content = JSON.stringify({
    text: "DESEMBER",
    styles: [{ fill: { content: { solid: { color: [0, 0, 0] } } }, range: [0, 8], size: 15, font: { id: "font-1", path: "/x/OldStandard.ttf" } }],
  });
  const fontMeasures = new Map([["font-1", (line) => line.length * 0.8]]);
  const joy = mapCapcutDraftToFabric({ draft: d, filerAssets, fontMeasures }).objects.find((o) => o.importNodeId === "joy");
  // 8 letters × 0.8 em, plus letter spacing (0.02 × 100 = 2 / 1000 em × 7 gaps), × 1.03 + 0.2 em.
  const expected = (8 * 0.8 + (7 * 2) / 1000) * joy.fontSize * 1.03 + 0.2 * joy.fontSize;
  assert.ok(Math.abs(joy.width - expected) < 0.01, `${joy.width} vs ${expected}`);
});

function overlayDraft() {
  const d = draft();
  d.tracks.push(
    { type: "sticker", segments: [segment("leaves", "m-leaves", { renderIndex: 14015, scale: 0.3, x: 0.7, y: -0.76, refs: ["anim-leaves"] })] },
    { type: "effect", segments: [segment("gold", "fx-gold", { renderIndex: 11000, duration: 33_450_000 })] }
  );
  d.materials.images = [{ id: "m-leaves", type: "image", path: "/images/leaves.png", width: 1080, height: 1920 }];
  d.materials.video_effects = [
    {
      id: "fx-gold",
      name: "Kilauan Emas 2",
      effect_id: "18045191",
      resource_id: "7209307530118304257",
      apply_target_type: 2,
      value: 1,
      adjust_params: [
        { name: "effects_adjust_speed", value: 0.09 },
        { name: "effects_adjust_background_animation", value: 1 },
      ],
    },
  ];
  d.materials.material_animations.push({
    id: "anim-leaves",
    animations: [
      { type: "loop", name: "Flash", duration: 2_505_000 },
      { type: "in", name: "Memantul ke Dalam", duration: 2_529_000 },
    ],
  });
  return d;
}
const goldList = [
  {
    schema: "loki://effects2/7209307530118304257",
    loki_item: { Name: "Kilauan Emas 2", FileUrl: { UrlList: ["https://effects.example/gold.zip"] } },
  },
];
const imageAssets = [
  ...filerAssets,
  { source_path: "/images/leaves.png", mime: "image/png", origin_download_link: "https://media.example/leaves.png" },
];

test("an image overlay on a sticker track is sized like a sticker; its Flash starts when its Bounce In ends", () => {
  const result = mapCapcutDraftToFabric({ draft: overlayDraft(), filerAssets: imageAssets, materialList: goldList });
  const leaves = result.objects.find((o) => o.importNodeId === "leaves");
  assert.equal(leaves.type, "image");
  assert.equal(leaves.layerName, "leaves.png");
  assert.equal(leaves.src, "https://media.example/leaves.png");
  // Sized like a sticker: pixels × (1080 / 720) × clip.scale 0.3 = 0.45.
  assert.deepEqual([leaves.scaleX, leaves.scaleY], [0.45, 0.45]);
  // CapCut starts the Flash loop when the Bounce In ends: the layer is cut there — the Bounce In
  // (scale ramp) on the first part, the Flash (0 → 1 → 0 every 2.5 s, a half-shifted stacked
  // flicker, dark at its start) on the rest.
  assert.deepEqual([leaves.timelineStartMs, leaves.timelineEndMs], [0, 2529]);
  const ramp = leaves.animations.loop;
  assert.deepEqual([ramp.type, ramp.params.r1From, ramp.params.r1To, ramp.params.r1Dur, ramp.params.stackFlicker], ["BREATHE", 0, 1.1, 1442, undefined]);
  const flashing = result.objects.find((o) => o.importNodeId === "leaves-loop");
  assert.deepEqual([flashing.timelineStartMs, flashing.timelineEndMs, flashing.left, flashing.scaleX], [2529, 3935, leaves.left, 0.45]);
  const flash = flashing.animations.loop.params;
  assert.deepEqual([flash.r1From, flash.r1To, flash.stackFlicker, flash.stackFlickerT, flash.stackPhaseMs], [1, 1, 2505, 1, 1253]);
  assert.equal(flashing.animations.entrance, null);
  assert.ok(!result.warnings.some((w) => /images layers/.test(w)));
});

test("an effect track's segment becomes a looping overlay in CapCut's render order", () => {
  const result = mapCapcutDraftToFabric({ draft: overlayDraft(), filerAssets: imageAssets, materialList: goldList });
  const gold = result.objects.find((o) => o.capcutEffectOverlay);
  assert.deepEqual(gold.capcutEffectOverlay, {
    packageUrl: "https://effects.example/gold.zip",
    aspect: 0.5625,
    speed: 0.635,
    fromMs: 0,
    toMs: 33450,
    loop: true,
  });
  assert.deepEqual([gold.timelineStartMs, gold.timelineEndMs, gold.opacity], [0, 33450, 1]);
  // 11000: above the photos (≤ 9), under the text (14002) and the sticker-track overlay (14015).
  const order = result.objects.map((o) => o.importNodeId);
  const at = result.objects.indexOf(gold);
  assert.ok(at > order.indexOf("garland") && at < order.indexOf("joy") && at < order.indexOf("leaves"));
});

test("Slingshot, Roll In and an Indonesian 'Bouncing kiri' map onto editor entrances", () => {
  assert.equal(mapCapcutAnimation({ type: "in", name: "Jepretan", duration: 2_041_000 }, "Slingshot").value.type, "CH_SCALE_FADE");
  const roll = mapCapcutAnimation({ type: "in", name: "Rol Masuk", duration: 3_509_000 }, "Roll In").value;
  assert.deepEqual([roll.type, roll.direction], ["RISE", "UP"]);
  const kiri = mapCapcutAnimation({ type: "in", name: "Bouncing kiri", duration: 2_521_000 }).value;
  assert.deepEqual([kiri.type, kiri.direction], ["SLIDE", "LEFT"]);
});

test("a mirror mask is a band of its height", () => {
  const mirror = capcutMaskShape({
    name: "Cermin",
    resource_type: "mirror",
    config: { width: 0.165637, height: 0.093171, centerX: 0, centerY: 0, rotation: -1, feather: 0, roundCorner: 0, invert: false },
  });
  assert.deepEqual([mirror.shape, mirror.height, mirror.rotation], ["mirror", 0.093171, -1]);
});

test("an animation whose resource the package does not ship is left out (CapCut's web editor plays none)", () => {
  const d = draft();
  d.materials.material_animations = [
    { id: "anim-joy", animations: [{ type: "in", name: "Bouncing kiri", resource_id: "7314651687149376001", duration: 3_008_000 }] },
  ];
  const listed = [{ schema: "loki://text/6862897343176380942", loki_item: { Name: "Slingshot" } }];
  const joy = mapCapcutDraftToFabric({ draft: d, filerAssets, materialList: listed }).objects.find((o) => o.importNodeId === "joy");
  assert.equal(joy.animations, undefined);
  // Without a material list nothing can be checked, and the name still maps.
  const unchecked = mapCapcutDraftToFabric({ draft: d, filerAssets }).objects.find((o) => o.importNodeId === "joy");
  assert.equal(unchecked.animations.entrance.type, "SLIDE");
});

test("CapCut's slide / zoom / fade entrances: an ease-out fade plus the exact move as a page-px ramp", () => {
  const size = { width: 487, height: 80, canvasWidth: 1080, canvasHeight: 1920 };
  const slide = mapCapcutAnimation({ type: "in", name: "Slide Right", duration: 3_506_000 }, "", size);
  assert.deepEqual([slide.slot, slide.value.type, slide.value.easing, slide.value.durationMs], ["entrance", "FADE", "EASE_OUT", 3506]);
  // Starts 2.66 × 487 / 1080 half-heights (960 px) to the left — 2.36 widths — quadOut home.
  assert.deepEqual(slide.companion.params, { concurrent: 1, r1From: 1, r1To: 1, r1Start: 0, r1Dur: 3506, r1Ease: 3, x1From: -1151.48, x1To: 0 });
  const down = mapCapcutAnimation({ type: "in", name: "Slide Down", duration: 3_493_000 }, "", size).companion.params;
  // 2.66 × 80 / 1920 half-heights = 1.33 text heights above.
  assert.deepEqual([down.y1From, down.y1To, down.x1From], [-106.4, 0, undefined]);
  const zoom = mapCapcutAnimation({ type: "in", name: "Zoom In", duration: 3_014_000 }, "", size);
  assert.deepEqual([zoom.value.type, zoom.companion.params.r1From, zoom.companion.params.r1Dur], ["FADE", 0.5, 3014]);
  const fade = mapCapcutAnimation({ type: "in", name: "Fade In", duration: 2_500_000 }, "", size);
  assert.deepEqual([fade.value.type, fade.value.easing, fade.companion], ["FADE", "EASE_OUT", undefined]);
  const showing = mapCapcutAnimation({ type: "in", name: "Showing Up", duration: 2_003_000 }).value;
  // Baseline timed onto CapCut's bezier(0, 0, .5, 1): 5 % late, 2.04× long.
  assert.deepEqual([showing.type, showing.direction, showing.delayMs, showing.durationMs], ["BASELINE", "UP", 100, 4086]);
  assert.equal(mapCapcutAnimation({ type: "in", name: "Blow In", duration: 3_492_000 }).value.type, "CH_POSITION_FADE");
});

test("a text's slide entrance lands on the layer as a fade plus a concurrent ramp", () => {
  const d = draft();
  d.materials.material_animations = [{ id: "anim-joy", animations: [{ type: "in", name: "Slide Right", duration: 3_506_000 }] }];
  const joy = mapCapcutDraftToFabric({ draft: d, filerAssets }).objects.find((o) => o.importNodeId === "joy");
  assert.equal(joy.animations.entrance.type, "FADE");
  assert.equal(joy.animations.loop.type, "BREATHE");
  assert.ok(Math.abs(joy.animations.loop.params.x1From + 2.66 * (joy.width / 1080) * 960) < 0.05);
});
