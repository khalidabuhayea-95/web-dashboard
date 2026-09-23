# Canva Importer Extension

This extension captures the active Canva design tab and sends it to your dashboard import endpoint.

## Load extension

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder:
   - `/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/extension/canva-importer`

## Setup

1. Open dashboard page `/canva-import`.
2. Click `Generate extension token`.
3. Copy token and paste it into extension popup.
4. Set dashboard URL to your running dev server (for example `http://localhost:3000`).
   - `http://127.0.0.1:<port>` is also supported.

## Import flow

1. Open Canva design tab in Chrome.
2. Click extension icon.
3. Click `Import current tab`.

The extension extracts Canva layer nodes (`[id^=\"LB\"]`) and posts a Fabric layer list to:

- `POST /api/tools/canva-import/extension-import`

If you update extension files, click `Reload` for the extension in `chrome://extensions` before testing again.
If you update `manifest.json`, reloading the extension is required for permission changes to take effect.

Notes:

- Text and image items are imported as separate layers.
- Page background videos (v1.22.9+): the poster frame is replaced by the real clip when it can be
  captured. The worker opens a CDP `Network` session on the Canva tab (the `debugger` permission
  already used for trusted page-switch clicks), forces the `<video>` to play for a few seconds to see
  the signed `media.canva.com` requests, then downloads the file itself (whole file → byte ranges →
  numbered segments → the player's own buffer, in that order). The clip travels as a multipart part
  (`canva-ext-binary://` placeholder in the manifest) and lands in the template as
  `{ type: "video", layerType: "video", src, thumbnailUri, videoStart, videoEnd, videoDuration }`.
  Keep the Canva tab in the foreground (Chrome throttles media in background tabs); Chrome shows its
  "is debugging this browser" banner while the capture runs. On any failure the import keeps the
  poster frame and the warning names the reason (`no-video-element`, `no-media-requests`,
  `download-failed`, `video-too-large:NMB`).
- Fidelity round (v1.25.0): imported text keeps Canva's measured font size verbatim
  (`IMPORT_TEXT_FONT_SCALE` is 1 — the old 0.95 re-flowed every text box), letter-spacing takes
  the same composite scale as the font size (charSpacing was under-read by the node's own
  `scale()`), a thin image whose DESIGN size is real (a 952×13 divider line, 4 px tall at 28%
  zoom) passes a design-space gate instead of being dropped by the screen-px one, and the
  "SKIPPED" warning now separates elements rendered-but-rejected from off-frame ones. Server
  side, the 1920-px canvas clamp finally rescales the layers with the canvas
  (`scaleFabricDataToCanvas` in `src/lib/tools/canvaImportTemplate.js`): a 1587×2245 poster
  used to be stored as page-sized geometry on a 1357×1920 canvas, off-centre and clipped.
- Animations (v1.24.0+, `docs/canva-animation-parity.md` §8.5 is the contract): Canva stores only
  WHICH animation an element has (`element.animation = {type, animation: <id>, Xw?}`, a repeating
  record in `element.Sz.ref`); its own scheduler decides WHEN at play time, from the whole page. The
  importer ports that scheduler.
  - Extraction (`canva-fiber-main.js`, MAIN world; the `canva-animation-extract` block is kept
    byte-identical in `background.js`'s fallback walk and `canva-scraper.js`'s — the test fails if
    they drift): per element the raw config under Canva's own names (`qg` / `Bf` legs with their raw
    µs, `reverse`, `direction`, `Vd`, `scale`, `ID`, `NV`, `color`; the config key is found
    structurally, it rotates `Sv` → `Tv` → `Xw`), the repeating record, the raw `startUs` /
    `durationUs` — left UNDEFINED when Canva left them unset (an untimed element; 0 is a real value) —
    `animationState` (no animation field, `type: "none"`, or present), `parentId` (group children),
    the largest font size, whether a photo fills it; per page the page animation (`page.animation`,
    the separate page enum, + its `Xw` config), length, size and the design's page count.
  - Scheduling (`background.js`, `applyCanvaPageAnimations` in the `canva-animation-mapping`
    block) runs over each page's model once its fabric objects exist and its length is final (a
    captured background video gives a video page its length). Ported from Canva: order and counts
    (top→left sort, group children after their group, N animated elements, XH = running index of
    sequenced ones), default windows (1500 ms intro / 1000 ms outro budgets on a 3 s+ page, 500 ms
    tweens, 200 ms stagger, all shrinking to fit), the per-unit intro window for text, custom
    windows for stored durations that are not one speed preset, each builder's own fit (a stored
    duration is clipped to its room; Wipe caps only its DEFAULT window at 750 / 1500 ms), the leg
    rules (a config keeps the legs it names; a config naming none plays both — except that an
    element running to the end of the LAST page gets no outro) and the page presets' own tables,
    sorts and window functions.
  - Output per animated fabric object: `timelineStartMs` / `timelineEndMs` (the element's window:
    its start, and the end of its outro or of the element / page), entrance `{durationMs, delayMs}`
    and exit `{durationMs}` ending at the window end, `intensity = 0.5 + Vd`, direction 2→UP 3→DOWN
    4→LEFT 5→RIGHT (a reversed outro flips the exit), and `params` (§8.1): Tumble
    `startRotation` / `travelX` / `travelY`, Stomp `startScale`, Scrapbook `poses` / `poseX` /
    `poseY`, `xh`, `seed`, Block `barColor`, per-unit `unit` / `fill`, Tectonic `fadeEase`.
    Breathe / Drift / Tectonic become a concurrent loop carrying Canva's ramp (`r1*` / `r2*` / `y*`,
    layer-local ms) next to the builder's own fades; repeating effects a concurrent loop on the page
    clock (`phaseMs`) with the others stacked (`stack*`); page Breathe / Drift also move the page's
    background photo / video (Drift's constant zoom baked into the object's scale).
  - Approximated, with an `Animation:` import warning: the Stomp page's hidden shake (element id 10,
    imported as Stomp), the photo page presets 17–19, the combo page styles 21–27 and element
    presets without a ported builder (18–27, 30, 32, 38–43), all on Canva's windows. A page id the
    page panel does not offer (a template leftover such as DAHOPR_iwyk's `page.animation = 31`)
    animates nothing.
  The legacy `mediaAnimation*` fields are still emitted as a mirror for pre-slot dashboard builds,
  plus the raw facts `canvaAnimationPreset` (element enum) or `canvaPageAnimationPreset` (page enum —
  the two id spaces collide: page 5 = Rise, element 5 = Neon), `canvaWritingStyle` and
  `canvaRepeating`. Run the tests with `node --test extension/canva-importer/test/animation-mapping.test.mjs`
  (every timing expectation is written from Canva's formulas; they also replay the records Canva
  really stores — `test/fixtures/canva-live-records-2026-09-22.json` — and run the three fiber-walk
  copies against one battery of elements). This round changes `background.js`, so the service
  worker must be refreshed with a full Remove + Load unpacked (the popup badge shows
  `1.25.0-canva-fidelity`).
- When a layer source is blocked/temporary, importer falls back to image-based handling for that item.
- Extension logger is enabled in both popup and background worker:
  - Structured logs are written to browser console.
  - Unhandled exceptions and unhandled promise rejections are captured automatically.
  - Recent logs are persisted in `chrome.storage.local` key `canva_importer_logs_v1`.
  - For debugging in popup DevTools console:
    - `await getCanvaImporterLogs()`
    - `await clearCanvaImporterLogs()`
