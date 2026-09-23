# Canva Template Importer (Web Scraping)

This tool scrapes the visible Canva design canvas and imports it into local templates.

## What it does

- Opens a Canva design URL in Playwright Chromium.
- Captures the largest design canvas as PNG.
- Imports it as a new template in the local database.
- Creates one image layer (`Imported Canva Snapshot`) that fills the canvas.

## Requirements

- Local app database configured (`DATABASE_URL` in `.env`/`.env.local`).
- Playwright installed (already added in this repo).
- First run may require login in the opened browser profile.

## Usage

```bash
npm run import:canva -- --url "https://www.canva.com/design/.../edit"
```

Optional flags:

```bash
--name "Template Name"           # override imported name
--slug "template-slug"           # override slug
--owner-id "<uuid>"              # explicit owner (default: latest template owner)
--profile-dir ".tmp/canva-profile" # persistent browser profile dir
--headless                        # run without opening browser UI
--timeout-ms 180000               # wait timeout
--max-dimension 1920              # max width/height; keeps aspect ratio
--snapshot-path ".tmp/canva.png" # save captured image locally
```

## Result

The script prints:

- created template id
- name/slug
- imported canvas size
- source URL
- direct editor URL (`/editor-pro?templateId=...`)

## Dashboard tab

- Open `/canva-import` from the left sidebar (`Canva Import`).
- Paste Canva URL and click `Import from Canva`.
- The dashboard tool calls `/api/tools/canva-import`.
- Import flow:
  - Primary: Playwright canvas scrape in headless/background mode (no new login tab/window).
  - Fallback: HTML preview scrape (`og:image`) if Playwright fails.
- If import fails, the UI now shows backend details (`Playwright import ... | Preview scrape ...`) so you can see the exact block reason.

## Chrome extension mode

- Extension path:
  - `/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/extension/canva-importer`
- Generate token from dashboard `/canva-import` (`Generate extension token`).
- Paste token in extension popup.
- Open Canva tab and click `Import current tab`.
- Extension endpoint:
  - `POST /api/tools/canva-import/extension-import`
- Capture strategy:
  - Primary: extract layer nodes (`[id^="LB"].DF_utQ`) from Canva page and convert to Fabric objects.
  - Secondary: crop visible Canva page frame (`[data-page-id]`) for thumbnail/fallback.
  - Fallback: one flattened image layer if layer extraction is unavailable.
  - Background video: a page video clip is captured through a CDP Network session on the Canva tab
    and uploaded with the design as a `layerType: "video"` object (poster frame kept as
    `thumbnailUri`; falls back to the poster-only layer with a warning). See the extension README.

## Animations (extension v1.24.0+)

The contract is `docs/canva-animation-parity.md` (§8.5 is the importer; §8.1 the `params` keys). Canva
never stores WHEN an element animates — a tile click stores `{type, animation: <id>}`, sometimes a
config — and its own scheduler derives every window at play time from the page. The importer ports
that scheduler and writes the result as explicit slots.

- Extraction happens in the MAIN world off Canva's React model (`extension/canva-importer/canva-fiber-main.js`;
  the `canva-animation-extract` block is kept byte-identical in `background.js`'s fallback walk and
  `canva-scraper.js`'s, and a test fails if they drift). Per element: the raw config (`qg` / `Bf`
  legs with their raw µs + `reverse`, `direction`, `Vd`, `scale`, `ID`, `NV`, `color` — found
  structurally, its key rotates `Sv` → `Tv` → `Xw`), the repeating record (`Sz.ref`), the raw
  `startUs` / `durationUs` (UNDEFINED when Canva left them unset — that is what "untimed" means; 0
  is a real value), `animationState` (no animation field / `type: "none"` / present), its group
  (`parentId`), geometry, largest font size and whether a photo fills it. Per page: the page
  animation (`page.animation` from the separate page enum + its `Xw` config), the page length, size,
  fill and the page count.
- `background.js` (`applyCanvaPageAnimations`, in the `canva-animation-mapping` block) runs once the
  page's fabric objects exist and its length is final (a captured background video states a video
  page's length): Canva's order and counts (sort top→left, group children after their group, N =
  animated elements, XH = running index of sequenced ones), its default windows (Kwf / Yrf / ksf:
  1500 ms intro and 1000 ms outro budgets on a 3 s+ page, 500 ms tweens staggered 200 ms, both
  shrinking to fit), the per-unit intro window for text, custom windows for stored durations that
  are not one speed preset, each builder's own fit (a stored duration clipped to its room; Wipe's
  750 / 1500 ms cap only on the default window), the leg rules (a config names its legs; none named
  = both, except no outro for an element running to the end of the LAST page), and the page
  presets' own timing tables, sorts and window functions (Kyf). Each animated object gets:
  - `timelineStartMs` / `timelineEndMs` = the element's window ([0 or its start, the end of its
    outro, else its / the page's end]);
  - entrance `{ type, durationMs, delayMs: intro start − window start, direction, intensity: 0.5 + Vd }`
    and exit `{ type, durationMs }` ending at the window end (a reversed outro flips the direction);
  - `params` for what the runtime cannot see: Tumble's start rotation / travel, Stomp's start scale,
    Scrapbook's poses and offset, Neon's / Scrapbook's / Tumble's sequence index `xh`, the element
    hash `seed`, Block's `barColor`, per-unit `unit` / `fill`, Tectonic's linear `fadeEase`;
  - Breathe / Drift / Tectonic as a CONCURRENT loop carrying Canva's ramp (`r1*` / `r2*` / `y*` in
    layer-local ms) plus the builder's own fades (Drift has none on a normal page); repeating effects
    as a concurrent loop on the page clock (`phaseMs`), the others stacked (`stack*`);
  - page Breathe / Drift also move the page background photo / video (a concurrent ramp; Drift's
    constant zoom is baked into the object's scale about its centre).
  Approximations (logged under `Animation:` in the import warnings): the Stomp page's hidden
  "shake" (element id 10) imports as Stomp, the photo page presets 17–19 and the combo styles 21–27
  keep their by-name types on Canva's windows, and element presets without a ported builder (18–27,
  30, 32, 38–43) likewise.
- The legacy `mediaAnimation*` fields are still written as a mirror for old dashboard builds; the raw
  Canva facts ride along as `canvaAnimationPreset` (element enum) or `canvaPageAnimationPreset` (page
  enum — the two id spaces collide: page 5 = Rise, element 5 = Neon), `canvaWritingStyle` and
  `canvaRepeating`.
- Server side, `createImportedTemplate` runs `fitImportedAnimationsToCategories` over the slots
  (types only; windows, durations, intensity and `params` untouched), `resolveElementAnimations`
  prefers explicit slots over the legacy mirror, and the mobile API (`toMobileProject`) serialises
  `animations` (params included) with intensity clamped to 0..4.
- Tests: `node --test extension/canva-importer/test/animation-mapping.test.mjs` (raw Canva model →
  Canva's scheduler → fabric fields, every expectation written from Canva's formulas, plus a replay
  of the records Canva really stores — `extension/canva-importer/test/fixtures/canva-live-records-2026-09-22.json`)
  and `node --import tsx --test src/lib/tools/canvaImportAnimations.server.test.js` (server passthrough).

## Notes

- Import is flattened to one image layer (not native Canva editable layers).
- If the canvas is not detected, the script pauses so you can complete login/open the design and continue.

## Page size clamp (server, 2026-09-23)

`normalizeCanvasInput` clamps the canvas to `maxDimension` (the extension sends 1920). The
extension lays every layer out in the Canva page's own pixels, so when the clamp bites the route
now rescales the fabric payload with `scaleFabricDataToCanvas` (positions and box sizes by the
axis factors; fontSize, radii, stroke, shadow, blur and the pixel-valued animation params by the
uniform factor; text through fontSize/width/height, never scaleX/scaleY; images and paths through
scaleX/scaleY so crop rects and path commands stay in source pixels). Before this a 1587×2245
poster was stored as a 1357×1920 canvas holding 1587×2245 geometry — off-centre in the editor and
clipped at the bottom in the app. `src/lib/tools/canvaImportScale.server.test.js` pins the rules.
To keep Canva's native pixel size instead, raise `maxDimension` in the extension request (the
server accepts up to 4096).

## Text fidelity (extension v1.25.0)

- Font sizes are Canva's measured sizes verbatim (`IMPORT_TEXT_FONT_SCALE = 1`). The earlier 0.95
  re-flowed paragraphs and shortened multi-line titles even though the re-hosted font files measure
  identically to Canva's.
- Letter-spacing is scaled by the same composite scale as the font size before it becomes an
  em-based `charSpacing`.
- Known remaining difference: Canva breaks lines with its own layout engine and wraps a paragraph
  at roughly 90% of the text box width (measured: the box minus about one em), while the editor
  and the app wrap greedily at the full box width — a long paragraph can break one word earlier
  or later than in Canva.
- Known remaining difference: vertical placement of the first line. Canva shifts each text block
  by a per-font offset (a `translate(0, ±N px)` on the block, +7.7 unscaled px on the poster's
  title font, −1.8 on its paragraph font) so the first baseline lands where its own typographic
  metrics put it; the editor centres every line's em box in the line box (Konva `middle`
  baseline, hhea metrics). Measured on the re-imported 1920-px poster: title ink 10 px higher
  than Canva, paragraph ink 5 px lower. Closing it means a baseline-anchored text contract on web
  AND mobile (the scraper can read Canva's first-baseline offset from the DOM: Range rect of the
  first glyph + `measureText().fontBoundingBoxAscent`).
