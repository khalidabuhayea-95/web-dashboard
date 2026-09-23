# Canva animation parity — the exact element-animation definitions

Reverse-engineered on 2026-09-22 from Canva's own editor bundle (`static.canva.com/web/1a485276c25e0a5d.js`,
the tween builders that Canva's browser preview and paused-frame renderer evaluate; easings from
`203b76165b83ab5d.js`). Design used for the read: `DAHOPR_iwyk`. This document is the single source
of truth for reproducing Canva's "إضافة حركة" effects in the dashboard editor AND the mobile app.
Everything below is what Canva's code does, not what it looks like it does.

Read this whole file before touching `animationVisual.ts`, `LayerAnimationVisualRuntime.kt`,
`animationSpec.json`, the picker icons, or the Canva importer's animation mapping.

---

## 1. Canva's model

An element carries `element.animation = { type: "sequenced"|"independent", animation: <presetId>, Xw: <config> }`
(`Xw` is a minified key and rotates between deploys — find the config STRUCTURALLY: the object-valued prop
of `element.animation` that holds the track container). The config holds:

| key | meaning |
|---|---|
| `qg` | intro (entrance) track `{durationUs}` — absent/`undefined` durationUs = "use Canva's default timing" |
| `Bf` | outro (exit) track `{durationUs, reverse?: boolean}` |
| `direction` | 1 = auto (تلقائي, Tumble only), 2 = up (أعلى), 3 = down (أسفل), 4 = left (يسار), 5 = right (يمين). The number is the direction the element MOVES. |
| `Vd` | intensity slider (الكثافة) 0..1, default **0.5** |
| `scale` | Breathe/Photo-zoom scale slider: magnitude 0.1..1, sign = in/out, default **0.5** |
| `ID` | text "writing style" (نمط الكتابة): 1 = character (حرف), 2 = word (كلمة), 3 = line (خط), 5 = whole element (العنصر). Default 5 for every general preset. Only text elements use it. |
| `NV` | 1 = custom-duration mode, 2 = "sync with captions" toggle |
| `color` | Block bar colour |

Repeating effects ("التأثيرات الإضافية") are NOT presets: they live on the element as
`element.Sz.ref = { rotate?: {direction, Vd}, R2a?: {Vd, Ezp} (flicker), BJa?: {Vd, direction} (pulse), N5a?: {Vd} (wiggle) }`
(`Sz`, `R2a`, `BJa`, `N5a` are minified and may rotate; the records are tiny objects whose only numeric
field is `Vd`, and `rotate` also has `direction` 1 = clockwise, 2 = counter-clockwise). Their `Vd` is
**-1..1, default 0**, and every formula uses `t = (Vd + 1) / 2`. They stack on top of a preset.

**Verified live on DAHOPR_iwyk (2026-09-22), applying every tile to the Arabic paragraph and reading
the model back:**
* a freshly clicked preset stores just `{type:"sequenced", animation:<id>}` — NO config at all (so no
  durations: Canva then uses its page-derived 500 ms/200 ms-stagger defaults);
* on RTL (Arabic) text Canva stores an explicit `Xw.direction: 4` (left) for Pan, Wipe, Drift and Block —
  the RTL default is LEFT, not RIGHT — so always read the stored direction first;
* "كلاهما" (both) writes `Xw.qg = {}` and `Xw.Bf = {}` (present but empty = default timing); "عند الخروج"
  removes `qg`; the speed preset بطيء (c = 0.1) writes `qg.durationUs = 5000000` and
  `Bf.durationUs = 2000000` (= 500 ms / 0.1 and 200 ms / 0.1 exactly); the reverse toggle writes
  `Bf.reverse: true`;
* toggling a repeating effect writes `rotate: {Vd:0, direction:1}`, `R2a: {Vd:0, Ezp:false}`,
  `BJa: {Vd:0, direction:1}`, `N5a: {Vd:0}` (defaults are Vd 0 = speed/intensity mid-point);
* "مسح الرسوم المتحركة" (clear) leaves `animation: {type:"none"}` and no repeating record — `type:"none"`
  means NO animation, never a preset.
The raw records are kept as a fixture: `extension/canva-importer/test/fixtures/canva-live-records-2026-09-22.json`.

### Panel tiles (Arabic UI, in Canva's order)

| id | Canva name | Arabic tile | our type | Canva offers as |
|---|---|---|---|---|
| 8 | Rise | ارتقاء | RISE | enter / exit / both |
| 6 | Pan | تأرجح | PAN | enter / exit / both |
| 4 | Fade | تلاشي | FADE | enter / exit / both |
| 7 | Pop | انبثاق | POP | enter / exit / both |
| 26 | Wipe | المسح | WIPE | enter / exit / both |
| 29 | Blur | تمويه | BLUR | enter / exit / both |
| 31 | Succession | التتابع | SUCCESSION | enter / exit / both |
| 2 | Breathe | ظهور بطيء | BREATHE | **continuous** (no enter/exit choice, `LX:false`) |
| 1 | Baseline | Baseline (untranslated) | BASELINE | enter / exit / both |
| 3 | Drift | انجراف | DRIFT | **continuous** |
| 12 | Tectonic | حركة تكتونية | TECTONIC | **continuous** |
| 13 | Tumble | دوران | TUMBLE | enter / exit / both |
| 5 | Neon | نيون | NEON | enter / exit / both |
| 9 | Scrapbook | سجل قصاصات | SCRAPBOOK | enter / exit / both |
| 11 | Stomp | سقوط هوائي | STOMP | enter / exit / both |
| 17 | Block | Block (text only) | BLOCK | enter / exit / both |
| "rotate" | rotate | تدوير | ROTATE | repeating (loop) |
| "flicker" | flicker | ومض | FLICKER | repeating (loop) |
| "pulse" | pulse | تقليص العنصر وتمديده | PULSE | repeating (loop) |
| "wiggle" | wiggle | اهتزاز سريع بالاتجاهين | WIGGLE | repeating (loop) |

Other element ids (for the importer only): 14 Photo Flow → DRIFT, 15 Photo Zoom → BREATHE, 16 Photo Rise
→ RISE, 24 Typewriter, 25 Ascend, 18 Bounce, 19 Burst, 27 Roll, 21 Shift, 22 Skate, 23 Spread, 20 Merge,
32 Clarify, 28 custom motion path, 30 mask reveal, 38 Shake Zoom, 39 Whip Slide, 40 Pulse(photo), 41 Chroma
Wave, 42 Old TV, 43 S-Movement. Page-animation ids are a SEPARATE enum (see §7).

### Timing

* Intro tween duration = `qg.durationUs / 1000` when set. Speed presets write it as `base / c` with
  `base = 500 ms` (3200 ms for per-unit text styles) and `c` = 0.1 (بطيء), 0.5 (متوسط), 1.2 (سريع);
  the custom slider is any c in 0.1..2. So medium = **1000 ms** in.
* Outro tween duration = `Bf.durationUs / 1000` when set; speed presets write `200 ms / c` → medium
  = **400 ms** out.
* When a tile was clicked and the speed never touched, durationUs is **absent** and Canva derives
  timing from the page: for pages ≥ 3 s the intro span is 1500 ms, each element's own tween is
  **500 ms**, staggered **200 ms** per element (elements sorted top→left); the outro span is 1000 ms
  with the same 500 ms tweens scaled to fit. For shorter pages everything scales by `page/3000`.
  Importer default when durationUs is missing: **in 500 ms, out 500 ms, delay 200 ms × element order**.
* Every tween: `value(t) = start + (end − start) · ease(t / duration)`, `t` = ms since the tween's delay.

### Coordinates and channels

`Kk` = translateX px, `Xk` = translateY px (design px, +y down), `scale` uniform, `rotate` degrees
(+ = clockwise on screen), `opacity`, `blur` = Gaussian blur radius in design px, `jSa`/`hfc` = inner
content translation (Y/X). Rendering: the outer node is translated by (Kk, Xk) and, whenever the tween
also carries `hfc`/`jSa`, the outer is clipped with `inset(max(Xk,0) max(−Kk,0) max(−Xk,0) max(Kk,0))`
— i.e. the visible region is always the element's HOME box ∩ the translated outer — and the inner
content is translated by (hfc, jSa) on top. Direction vector `urf(dir, rot, c)`: dir 4 → (+c, 0),
5 → (−c, 0), 2 → (0, +c), 3 → (0, −c), then rotated by the element's own rotation. Note the sign: the
vector is where the element STARTS, so dir 2 (up) starts +c below and rises.

### Easings (exact)

| Canva id | name | formula on u ∈ [0,1] |
|---|---|---|
| LINEAR (1) | linear | u |
| KHb (2) | easeInQuad | u² |
| k1a (3) | easeOutQuad | u(2 − u) |
| SAc (4) | easeInOutQuad | u<.5 ? 2u² : (4 − 2u)u − 1 |
| uig (5) | easeInCubic | u³ |
| qQe (6) | easeOutCubic | (u − 1)³ + 1 |
| Frh (7) | easeInQuart | u⁴ |
| tJk (8) | easeOutQuart | 1 − (1 − u)⁴ |
| $Hi (9) | easeOutExpo | 1 − 2^(−10u), and u=1→1 (the bare formula ends at 1 − 2⁻¹⁰; a tween that has ENDED returns its END value — §2 rule — so the runtimes pin it like the elastic pair, else Baseline holds 1/1024 short of home forever) |
| MJk (10) | easeInSine | 1 − cos(uπ/2) |
| C$a (15) | easeInOutCubic | u<.5 ? 4u³ : 1 − (−2u + 2)³/2 |
| CGk (11) | elasticIn(amp 1) | u=0→0, u=1→1, else −2^(10(u−1)/amp) · sin((u − 1.1)·5π) |
| DGk (12) | elasticOut(amp 1) | u=0→0, u=1→1, else 2^(−10u/amp) · sin((u − 0.1)·5π) + 1 |
| KEq (13) | elasticIn(amp .7) | as CGk with amp = 0.7 |
| NJk (14) | elasticOut(amp .7) | as DGk with amp = 0.7 |

None of these are in our `LayerAnimationEasing` enum (ours are cubic/quartic). Compute them from the
RAW cycle progress inside each type's branch, exactly like the existing one-shot RISE/SUCCESSION do.
Do not add enum members.

---

## 2. Whole-layer presets (non-text, or text with writing style = element)

`p` = raw entrance progress 0→1 over the intro duration; `u` = raw exit progress 0→1 over the outro
duration (our exit slot passes `cycleProgress = 1 − u`; convert). `w`,`h` = layer width/height (design
px). `dir` = the slot's direction; `rev` = Canva's reverse-exit flag.

### RISE (8) — default dir UP
* in: `e = easeOutQuad(p)`; opacity = e; translate = dirVector(80) · (1 − e) (dir up → start 80 px BELOW).
* out: `e = easeInQuad(u)`; opacity = 1 − e; translate = −dirVector(80) · e (keeps moving up and out);
  `rev` → +dirVector(80) · e.

### PAN (6) — default dir RIGHT
Identical to RISE with the horizontal 80 px vector (dir right → starts 80 px to the LEFT).

### FADE (4)
* in: opacity = easeOutQuad(p). out: opacity = 1 − easeInQuad(u). Nothing else.

### POP (7)
* in: scale = elasticOut(1)(p) (overshoots to ~1.28). No opacity change, no rotation.
* out: scale = 1 − elasticIn(1)(u)… precisely scale = start 1 → end 0 with elasticIn(1): `1 + (0 − 1)·elasticIn(u)`.

### WIPE (26) — default dir RIGHT
A pure clip reveal; the content never moves.
* in: intro duration is capped at `min(intro, 750)` (text: 1500). `e = easeOutCubic(p)`. Visible region =
  band of the HOME box growing from the edge the motion starts at: dir right → `[0, w·e]` from the
  left edge; dir left → from the right edge; dir up → from the bottom edge (`[h(1−e), h]`); dir down →
  from the top edge. Hard edge, opacity 1 throughout.
* out: `e = easeInCubic(u)`; the band keeps sweeping in the SAME direction: dir right → visible `[w·e, w]`
  (the left part disappears first); `rev` → `[0, w(1−e)]`. Opacity drops to 0 only at the very end.

### BLUR (29)
* in: `e = easeOutQuad(p)`; opacity = e; blurRadiusPx = 32 · (1 − e).
* out: `e = easeInQuad(u)`; opacity = 1 − e; blurRadiusPx = 32 · e.

### SUCCESSION (31)
* `s0 = 0.9 − 0.3 · Vd` (Vd default .5 → 0.75).
* in: `e = easeOutQuad(p)`; opacity = e; blurRadiusPx = 24 · (1 − e); scale = s0 + (1 − s0) · e.
* out: `e = easeInQuad(u)`; opacity = 1 − e; blurRadiusPx = 24 · e; scale = 1 − (1 − s0) · e.

### BASELINE (1) — default dir UP
Content slides into its own box while the box clips it (the "rising from the baseline" look).
VERIFIED live on 2026-09-22: mid-animation the paragraph's last line is cut at the box's bottom
edge; Rise, by contrast, is never clipped.
* in: opacity jumps to 1 at t=0; `e = easeOutExpo(p)`; content translate = dirVector(size) · (1 − e)
  where size = h for up/down, w for left/right; the layer is clipped to its HOME box during the
  whole entrance.
* out: only the first 60 % of the outro duration animates: `e = easeInSine(min(1, u / 0.6))`;
  content translate = −dirVector(size) · e (continues up and out of the box; `rev` → +); opacity → 0
  at the end of that 60 % (hold 0 after).
* How to express it with our visual state: the reveal band in HOME space is `[h(1−e), h]` (dir up).
  Because our matte travels WITH the layer's pose, express the same thing in CONTENT space: reveal the
  part of the content that is inside the home box, i.e. for dir up a WIPE band `[0, h·e]` measured from
  the content's TOP edge (the leading edge), for dir down from the bottom edge, dir right from the
  content's right edge, dir left from its left edge — plus the translation above. If the platform's
  Wipe mask cannot pick the edge independently of the slot direction, add a `clipToBounds` boolean to
  the visual state that the renderer applies as a clip at the HOME box with the animation translation
  applied inside it. Whichever route, do the SAME on web and mobile.

### TUMBLE (13) — default dir AUTO
* `k = (idx even ? lerp(−90, −270, Vd) : lerp(−270, −90, Vd)) + pseudoRandom(0..360)` where
  pseudoRandom = `|cos(idx) · w · h · top| mod 360` (idx = element index on the page). Treat as "start
  rotated k°, k ≈ −180° ± element hash".
* Travel: from `D = max(pageW, pageH)` px away, from the LEFT when dir = 5/auto-even, from the RIGHT
  when dir = 4/auto-odd (vector = (cos(rot)·D·sgn, sin(rot)·D·sgn), sgn = −1 for "from left").
* in: `e = easeOutCubic(p)`; opacity = e; rotate = k·(1 − e); translate = travel·(1 − e).
* out: `e = easeInCubic(u)`; opacity = 1 − e; rotate = −k·e; translate = −travel·e (`rev` → +k, +travel).
* Our runtime has no page size: use the standard story height, **D = 1920 px**, and the layer's
  z-index as idx (the hash term uses `|cos(idx) · w · h| mod 360` so both platforms agree). The layer
  is nearly transparent for the first part anyway.

### STOMP (11)
* in: `s0 = max(pageW / w · 1.5, 4)`; scale = s0 + (1 − s0) · easeInQuart(p); opacity =
  easeInQuart(min(1, p / 0.4)) (fades in over the first 40 % of the duration). Runtime without page
  size: assume the standard story width, `s0 = max(4, 1620 / w)`.
* out: opacity = 1 − easeOutQuad(u); no scale change.

### Tween-list evaluation rule (needed by Scrapbook and Neon)
Canva evaluates a property at time t by taking the LAST tween (sorted by delay) whose delay ≤ t and
that touches the property: before that tween's delay → its start value, after its end → its end
value, between → eased. So **between tweens the previous tween's END value holds**, and before the
very first tween its START value shows.

### SCRAPBOOK (9)
Discrete "stamps": opacity jumps to 1 at t=0, then the layer HOLDS a series of poses (no tweening
between them, each pose is a 1 ms step) at equal intervals `step = intro / g`, ending at rest.
* `g = 3` when the element's centre is within half the page half-extent of the page centre, else 2.
  Runtime (no page): **g = 3**.
* Canva's pose offsets depend on the element's position relative to the page centre (`b`); for a
  centred element `b = (0, 0)`, which is what the runtime reproduces exactly:
  pose 0 = (+50 px, 0, +5°·sgn), pose 1 = (0, +50 px, −4.5°·sgn), pose 2 = (+50 px, 0, +3.5°·sgn),
  then rest (0, 0, 0°). sgn = +1 for an even element index (layer z-index), −1 for odd.
  Timeline: p ∈ [0, ⅓) pose 0, [⅓, ⅔) pose 1, [⅔, 1) pose 2, p = 1 rest (with g = 2: pose 0 for
  [0, ½), pose 1 for [½, 1), then rest).
* out: opacity jumps to 0 at outro start (nothing else).

### NEON (5)
A neon sign flickering on; every tween is LINEAR on opacity and the hold rule above applies.
Intro (`c = intro / lerp(10, 26, Vd)`, `n = floor(lerp(1, 4, Vd))`, `par` = element index parity;
Vd .5 → c = intro / 18, n = 2). Build from f = 0:
* i even: push (0→1, delay f, dur 3c); push (par even ? 1→0 : 0→0, delay f + 4c, dur c); f += 5c.
* i odd: push (par even ? hold 1 : hold .75, delay f + c, dur c); push (hold 0, delay f + 3c, dur c); f += 4c.
* after the loop: par odd → push (0→1, delay f + 5c, dur 4c); par even → push (0→1, delay f + 4c, dur 3c).
At the default (n = 2, par even) that is: ramp 0→1 over [0,3c], on until 4c, fade to 0 over [4c,5c],
off until 6c, on [6c,8c], off [8c,13c], ramp 0→1 over [13c,16c], on. par odd: ramp [0,3c], on until
4c, off (hard) [4c,6c], 0.75 [6c,8c], off [8c,14c], ramp [14c,18c].
Outro (`d = outro / lerp(4, 8, Vd)`, default outro/6):
* par even: on until 1.1d, off [1.1d, 3d), 0.5 [3d, 5d), off from 5d.
* par odd: on until d, 1→0.5 over [d, 3d], 0.5 until 4d, 0.5→0 over [4d, 4.1d], off.
Runtime parity: derive `par` from the layer's z-index on BOTH platforms (same rule).

### BLOCK (17, text only) — default dir RIGHT
A solid bar (colour = config.color or the text colour) sweeps across in `2d` where
`d = floor(min(330, page·0.066, intro/2))`: bar enters from the far side over d (easeInQuart) to cover
the box, the text switches ON at t=d, bar leaves over d (easeOutQuart). Outro mirrors: bar in (d),
text OFF at t=d, bar out (d). We already implement BLOCK; keep it, only align the easings and the
`d` rule if cheap.

---

## 3. Continuous presets (Breathe, Drift, Tectonic)

These have NO enter/exit choice in Canva. They run for the element's whole visible window, plus a
fade in over the intro window and a fade out over the outro window.

### BREATHE (2)
* scale slider `s` (default .5, sign = in/out): `A = s>0 ? lerp(.95, .85, |s|) : lerp(1, 1.06, |s|)`,
  `B = s>0 ? lerp(1, 1.06, |s|) : lerp(.95, .85, |s|)` → default **0.90 → 1.03**.
* untimed element on a page < 10 s: scale = lerp(A, B, t/pageDuration), LINEAR, over the whole page.
  Timed element: over its own duration. Pages ≥ 10 s: A→B over the first half, B→1 over the second.
* Also a tiny vertical drift ±`5·g` px where g = (elementCenterY − pageCenterY)/pageCenterY — ignore
  (0 for centred layers).
* fade: in = easeOutQuad over the intro window, out = easeInQuad over the outro window.

### DRIFT (3) — default dir RIGHT
* amplitude `m = min(pageW, pageH) / 4 / N · (idx + 1) · lerp(.5, 1.5, Vd)` (N = animated element
  count on the page, idx = element index → parallax). Vector: dir 4 → −m, 5 → +m (x); 2 → −m, 3 → +m (y).
* untimed, page < 10 s: translate = lerp(−vec, +vec, t/page) LINEAR (ends at +vec, NOT at home).
  Timed element: −vec → vec/2 over the first half, vec/2 → 0 over the second, easeInOutQuad each.
* fade: opacity jumps (1 ms) for untimed elements on a non-video page; LINEAR fades on video pages.

### TECTONIC (12)
* `d = pageW / 6 / N · (idx + 1) · lerp(.7, 1.3, Vd)`, sign: elements right of the page centre move
  the opposite way (d = −d), centred elements alternate.
* untimed, page < 10 s (`2·lerp(7000, 3000, Vd) > page`): translateX = lerp(−d, +d/2, t/page) LINEAR.
  Timed: −d → d/2 → 0 with easeInOutQuad halves.
* fade: LINEAR in over the intro window, LINEAR out over the outro window.

**Our model for the three:** LOOP slot, formula = ping-pong of the untimed ramp
(`A → B → A` over one cycle, cycleProgress 0→½→1, LINEAR), so a picked loop cycles seamlessly, and the
IMPORTER sets `durationMs = 2 × visibleWindowMs` so that exactly the A→B ramp plays across the layer's
window. Entrance/exit slots get FADE with Canva's intro/outro durations. Amplitude cannot see the
page at runtime, so it rides on `intensity`: **DRIFT/TECTONIC amplitude_px = 120 · intensity**, and
the importer stores `intensity = m / 120` (clamp 0.1..4 — widen the mobile clamp from 0.4..2.4 to
0.1..4.0 on BOTH platforms; every other effect is unaffected because the picker writes 1). BREATHE
ignores intensity (scale range comes from the slider → store `A`/`B` via intensity: `B − A = 0.13 ·
intensity`, A = 1 − 0.10·intensity, B = 1 + 0.03·intensity; default 1 reproduces 0.90→1.03).

---

## 4. Repeating effects (loop slot) — `t = (Vd + 1)/2`, default Vd 0 → t = 0.5

### ROTATE
rotate 0 → ±360° per cycle, LINEAR, `duration = lerp(40000, 600, t)` clamped → **20 300 ms** per turn
at default. direction 1 = clockwise (+360). Our ROTATE already does `cycleProgress · 360 · spin`; only
the DEFAULT duration and the label/icon change (default durationMs 20300 when imported; picker
default may stay 5600).

### FLICKER
`a = lerp(600, 300, t)` ms, `b = lerp(.6, .1, t)`: opacity 1 → b over a (LINEAR), hold b for 200 ms,
b → 1 over a (LINEAR), then repeat. Cycle = 2a + 200 → **1100 ms** at default (a = 450, b = 0.35).

### PULSE
`a = lerp(1000, 200, t)`, `q = a / 4`: scale 1 → 1.15 over q (LINEAR), 1.15 → .85 over a
(easeOutQuad), .85 → 1 over q (LINEAR). Cycle = a + 2q = 1.5a → **900 ms** at default.

### WIGGLE
A deterministic random walk: step `g = lerp(600, 50, t)` ms, `n = floor(lerp(10, 100, t))` steps,
amplitudes `h = k = lerp(.5, 1.8, t)`. Step i: translate → (lerp(−20, 20, r₂)·k, lerp(−20, 20, r₃)·k)
over g (easeInOutQuad) starting at g·i, and rotate → lerp(−10, 15, r₁)·h over g starting at g·i + g/2;
after n steps everything returns to 0 over g. `r` = per-element hash (Canva: `|cos(seed)·w·h·top·left| mod 1`
with seed = i+1, i+2, i+3). Cycle = (n + 1) · g → **18.2 s** at default (55 steps × 325 ms). Reproduce
with our own deterministic hash of (step index, layer size); exact Canva pixels are impossible
without their element geometry, so match the statistics: ±23 px, −11.5..17°, 325 ms per step.

---

## 5. Text writing styles (ID 1/2/3) — NOT in scope of the first pass

With ID = char/word/line, Fade/Blur/Succession/Neon animate per unit with per-unit tweens (Fade 500 ms
per unit staggered 125 ms; Blur/Succession 400 ms staggered 100 ms with blur 0.2 "em"; Neon 500 ms per
line staggered by a hash). The importer must keep the value on the object as `canvaWritingStyle` so a
later pass can map it; for now the whole-layer formula plays.

---

## 6. Import mapping (extension → editor slots)

For an element preset (ids above) emit THREE slots, not the legacy single field:
* entrance: `{type, durationMs: qg ? qg.durationUs/1000 : 500, delayMs: element stagger, direction,
  intensity: 0.5 + Vd}`; absent `qg` → no entrance slot (Canva "عند الخروج" only).
* exit: `{type, durationMs: Bf ? Bf.durationUs/1000 : 500, direction: rev ? opposite(dir) : dir,
  intensity}`; absent `Bf` → no exit.
* continuous presets (2/3/12/14/15): loop slot `{type, durationMs: 2 × windowMs, infinite: true,
  intensity: amplitude/120}` + entrance/exit FADE with the intro/outro durations.
* repeating effects: loop slot `{ROTATE|FLICKER|PULSE|WIGGLE, durationMs: cycle from Vd, direction}`;
  when the element ALSO has a preset, the preset fills entrance/exit and the repeating effect the loop.
  (A continuous preset plus a repeating effect cannot both hold the loop slot — the repeating effect
  wins, log a warning.)
* `Vd` → intensity = 0.5 + Vd for presets (Canva default .5 ↔ our 1.0); repeating effects use their
  own cycle rule above.
* Direction: 2 → UP, 3 → DOWN, 4 → LEFT, 5 → RIGHT, 1/absent → DEFAULT (each type's preset default).
* Page animations use the same builders per element (page id → element preset: 7→1 Baseline, 1→17
  Block(text only), 2→2 Breathe, 3→4 Fade, 4→6 Pan, 5→8 Rise, 6→13 Tumble, 8→5 Neon, 9→3 Drift,
  10→12 Tectonic, 11→7 Pop, 12→9 Scrapbook, 13→11 Stomp, 20→26 Wipe), staggered 200 ms per element.
  So the page table maps by name to the SAME types, and the ambient/continuous set is exactly
  {BREATHE, DRIFT, TECTONIC} (NOT Neon/Baseline/Scrapbook — those are enter/exit effects).

## 7. Tab membership we need (both platforms, same order)

ENTRANCE gains PAN, BLUR, BASELINE, TUMBLE, NEON, SCRAPBOOK, STOMP (appended, in that order).
EXIT gains POP, BASELINE, NEON, SCRAPBOOK (appended). LOOP already offers BREATHE, DRIFT, TECTONIC,
ROTATE, FLICKER, PULSE, WIGGLE. Labels (ar / en) for the Canva family become Canva's tile labels
(table in §1); ROTATE = تدوير / Rotate, TUMBLE = دوران / Tumble.

---

## 8. Round 2 — exact import parity (2026-09-23). Supersedes any conflicting line above.

Reference for implementers: Canva's beautified bundle and a function index live in this session's
scratchpad (`…/scratchpad/canva-js/1a48.pretty.js`, `INDEX.md`, `canva-easings.js`). Where this
section says "port", port the named Canva function literally (same arithmetic, same floors, same
order), because a rewrite is how drift gets in. Never commit Canva's code itself.

### 8.0 Corrections to §1–§7
* **WIPE has no runtime cap.** Canva's `luf` caps only its DEFAULT window (`X6a`: text 1500 ms, other
  750 ms) and only when no explicit duration is stored (`srf`). Explicit durations run in full. The
  runtime plays `durationMs` as is; the importer computes the window (§8.5).
* **Speed bases:** `puf` = 3200 ms when `ouf` is true (Wipe always; Fade/Blur/Succession/Neon with a
  writing style ≠ element), else 500 ms. Speed presets store `base / c` (c = .1/.5/1.2) for the intro and
  `200 / c` for the outro. Only Rise, Pan, Fade, Pop, Wipe, Blur, Succession, Baseline offer speed; the
  other tiles never store durations and always use the scheduler's window.
* **Page animation outro:** a page animation's default config has an outro ONLY when a next page exists
  (`Kyf`), unless `page.Xw` is present (then its `qg`/`Bf` keys decide; an empty `Xw` means both).
* **Element config legs:** `Xw` absent, or present without `qg`/`Bf` → both legs. `qg` only → entrance
  only. `Bf` only → exit only.
* **Repeating effects and continuous presets run CONCURRENTLY** with the entrance/exit (§8.2), from the
  page clock / the element's start respectively. They are not "after the entrance".
* **Timed vs sequenced:** an element is timed only when its raw `startUs` or `durationUs` is defined
  (Canva leaves both `undefined` on untimed elements — verified live on DAHOPR_iwyk).
* **Easing end values:** every tween returns its exact END value once its time is ≥ its duration
  (`aqf`), so `easeOutExpo(1)` is 1 in effect.
* Per-letter/word/line writing styles are now in scope (§8.4).

### 8.1 Model: `params` on every animation spec
`LayerAnimationSpec.params: Map<String, Double>` (Kotlin, default `emptyMap()`, JSON `"params"`, omitted
when empty) and `params?: Record<string, number>` (web). It must round-trip through: web
`makeAnimationSpec`/`normalizeAnimationSlots`, the editor store, template save/load,
`mobileProject.js` (`mapAnimationSlotSpec` emits finite values as-is), `openapi.js` (documented), and the
app's model, API parsing and project persistence. Picking a NEW effect builds a fresh spec with no
params; editing duration/direction of the current spec keeps them. Unknown keys are ignored. Absent key
= the behaviour already implemented (picker-made animations never carry params).

| key | types | meaning |
|---|---|---|
| `concurrent` | loop slot | 1 = runs alongside entrance/exit for the whole visible window and COMBINES (§8.2) |
| `phaseMs` | loop slot | added to the layer-local clock of a concurrent loop |
| `stackRotate` / `stackFlicker` / `stackPulse` / `stackWiggle` | loop slot | extra repeating effects on the same layer: value = cycle ms; `stackRotate` negative = counter-clockwise |
| `stackFlickerT` / `stackWiggleT` | loop slot | t = (Vd+1)/2 of the stacked flicker / wiggle |
| `stackPhaseMs` | loop slot | clock offset for the stacked effects |
| `r1From` `r1To` `r1Start` `r1Dur` `r1Ease` `r2To` `r2Start` `r2Dur` `r2Ease` | BREATHE, DRIFT, TECTONIC (concurrent) | time-based ramp, ms are layer-local, ease ids per §1 (1 linear, 4 easeInOutQuad) |
| `y1From` `y1To` `y2To` | BREATHE | vertical drift (px) on the same ramp timing |
| `fadeEase` | FADE | 1 = LINEAR in and out (Canva Tectonic fades, Drift on video pages) |
| `unit` | FADE, BLUR, SUCCESSION, NEON | writing style: 1 character, 2 word, 3 line |
| `fill` | same | 1 = stretch the unit schedule to fill the duration (explicit Canva duration) |
| `xh` | NEON, SCRAPBOOK, TUMBLE | Canva's sequence index XH (parity, hashes); replaces `layerIndex` |
| `seed` | WIGGLE, NEON units, stacked wiggle | Canva hash product P = w·h·max(top,1)·max(left,1); r(s) = abs(cos(s)·P) mod 1, in Double |
| `startRotation` `travelX` `travelY` | TUMBLE | entrance: start offset (deg, px, px) animated to 0; exit: end offset animated from 0 |
| `startScale` | STOMP | s0 |
| `poses` `poseX` `poseY` | SCRAPBOOK | g (2 or 3) and the b vector (px) |
| `barColor` | BLOCK | ARGB 0xAARRGGBB as a number; absent = the text colour |

### 8.2 Concurrent loop, ramps, stack, composition
When `loop.params.concurrent == 1`:
* The primary state is resolved as today with the loop treated as absent (entrance → hold → exit).
* Loop clock τ = localMs + `phaseMs` (localMs = ms since the layer's window start; the loop is active
  whenever the layer is visible).
* Loop visual: with ramp params → value(τ) = τ < r1Start ? r1From : (r2Dur present and τ ≥ r2Start) ?
  r1To + (r2To − r1To)·ease(r2)(min(1,(τ−r2Start)/r2Dur)) : r1From + (r1To − r1From)·ease(r1)(min(1,(τ−r1Start)/r1Dur))
  (a duration ≤ 0 jumps to its end value). Channel: BREATHE → scale (plus translationY from the y ramp),
  DRIFT → translationX for LEFT/RIGHT/DEFAULT, translationY for UP/DOWN, TECTONIC → translationX.
  Without ramp params → the type's LOOP formula at cycleProgress = (τ mod durationMs)/durationMs.
* Stack: each `stack*` key evaluates that repeating effect at τs = localMs + `stackPhaseMs` with its own
  cycle (§8.3 items 4–7) and is composed too.
* Composition = Canva `$pf`: alpha, scale, scaleX, scaleY multiply; translationX/Y, rotation, blur add;
  revealMask, overlayBar, glyphMotion, textReveal come from the primary only.
* Without `concurrent`, slots stay mutually exclusive exactly as today.
Implement it inside the existing pure layer: the timeline resolver attaches the concurrent loop (and the
clocks) to its playback state, and the visual resolver composes, so renderer call sites do not change.

### 8.3 Formula changes (identical on both runtimes)
1. **WIPE**: no cap; band = easeOutCubic(p) over the whole duration (exit unchanged). Mask anchored.
2. **Anchored masks**: `LayerRevealMaskSpec.Wipe` / web WIPE mask gain `anchored` (default false).
   WIPE, BASELINE and BLOCK masks set it. Text renderers mirror LEFT/RIGHT for RTL text ONLY when
   `anchored` is false (legacy typewriter/word/line reveals keep their RTL mirroring). Golden rows carry it.
3. **BLOCK** (`esf`): entrance p over durationMs, exit u = 1 − cycleProgress:
   s = x < .5 ? −1 + easeInQuart(2x) : easeOutQuart(2x − 1) with x = p (entrance) or u (exit).
   Entrance: content hidden while p < .5, shown after; exit: shown while u < .5, hidden after. Hide via an
   anchored Wipe mask at progress 0/1 so the bar is unaffected; alpha stays 1; no generic exit fade.
   Bar = the FULL layer box offset along the motion axis: RIGHT/DEFAULT (s·w, 0), LEFT (−s·w, 0),
   DOWN (0, s·h), UP (0, −s·h); visible while x < 1; clipped to the layer box.
   `OverlayBarSpec` = {leftFraction, topFraction, widthFraction = 1, heightFraction = 1}. Colour =
   `barColor` or the text colour. Default durationMs 500. A loop BLOCK plays the same on each cycle.
4. **ROTATE**: unchanged (cycle = durationMs, spin by direction).
5. **FLICKER**: t = clamp(intensity − .5, 0, 1); b = lerp(.6, .1, t); a = max(0, (durationMs − 200)/2):
   1→b LINEAR over [0,a], hold b over [a, a+200], b→1 LINEAR over [a+200, 2a+200].
6. **PULSE**: unchanged (a = durationMs/1.5, q = a/4).
7. **WIGGLE**: t as above; n = floor(lerp(10,100,t)); amp = lerp(.5,1.8,t); g = durationMs/(n+1);
   r(s) = `seed` ? abs(cos(s)·seed) mod 1 : the existing hash; steps exactly as Canva `rwf`
   (translation lerp(−20,20,r)·amp, rotation lerp(−10,15,r)·amp, easeInOutQuad, rotation half a step late,
   final return over the last step). No other intensity factor.
8. **TUMBLE**: with `startRotation`/`travelX`/`travelY` → entrance e = easeOutCubic(p): alpha e,
   rotation startRotation·(1−e), translation (travelX, travelY)·(1−e); exit e = easeInCubic(u): alpha 1−e,
   rotation startRotation·e, translation (travelX, travelY)·e. Without them: current behaviour, with
   parity/hash taken from `xh` when present.
9. **STOMP**: s0 = `startScale` ?? max(4, 1620/w).
10. **SCRAPBOOK** (`jtf`): g = `poses` ?? 3; b = (`poseX` ?? 0, `poseY` ?? 0); sign = parity(`xh` ??
    layerIndex); pose c: (b.x/2^c + (c even ? 50 : 0), b.y/2^c + (c even ? 0 : 50), (5+c)(1−.25c)·(c even ? 1 : −1)·sign),
    c = g is rest; h = floor(D/g); pose c shows from max(0, floor(h·c) − 1) ms; the pose at τ = p·D is the
    last one whose start ≤ τ.
11. **NEON** element: parity from `xh` ?? layerIndex.
12. **FADE**: `fadeEase == 1` → p and 1−u instead of the quad curves.
13. BREATHE/DRIFT/TECTONIC without params (picker): unchanged ping-pong.

### 8.4 Writing styles (FADE, BLUR, SUCCESSION, NEON with `unit`)
The resolver returns the whole-element state (Canva's own fallback for non-text layers, and for
Succession when the text has < 2 characters) PLUS `glyphMotion` = {type, unit, fill, rawProgress,
isExiting, durationMs, intensity, seed?}. A text renderer that honours it ignores the whole-element
alpha/blur/scale and draws per unit.
* **Units** — shared pure function, port of `crf`: paragraphs = (text + "\n").split("\n") minus the last
  piece; items = for each paragraph a pseudo newline item (whitespace, the paragraph's first line) then its
  graphemes (base code point plus following combining marks Mn/Me/Mc, ZWJ joins the next code point,
  variation selectors attach — the SAME rule on both platforms). Word index w_0 = 0,
  w_j = w_{j−1} + (item_{j−1} whitespace or CJK or cjk(j−1) ≠ cjk(j) ? 1 : 0) with whitespace = Unicode
  White_Space and CJK = Canva's `$ri` ranges. Unit index: character u_j = j; word u_j = w_j; line u_0 = 0,
  u_j = u_{j−1} + (line_{j−1} < line_j ? 1 : 0). Line numbers come from the renderer's own layout.
  Unit count N = last u + 1. Whitespace and pseudo items occupy units but draw nothing (the first real
  unit therefore starts one stagger step late — Canva does the same).
* **Tween lists** — port the per-unit branches literally: FADE `Crf` (125 ms stagger, 500 ms, opacity,
  easeOutQuad in / easeInQuad out), BLUR `gsf` (100, 400, opacity + blur 0.2), SUCCESSION `ttf` (`ptf`/`qtf`
  per unit: opacity, blur .2, scale .8 − .4·Vd; plus the element scale `rtf`/`stf` .9 − .3·Vd over the units'
  span), NEON `Gsf` (per-unit offset e starting at 100, += lerp(−100, 300, r(u)) at every unit change, each
  unit running `Esf`/`Fsf` with duration 500 and parity from its unit index). Then `$qf`/`Zqf`/`Yqf`
  (fit = shrink only, fill = stretch; floors as Canva) against the slot window (0..durationMs), and `Gqf`
  for NEON. Evaluate with the `Xpf` hold rule at τ = rawProgress·durationMs. Vd = clamp(intensity − .5, 0, 1).
* **Rendering**: glyph alpha × layer alpha; blur radius px = blur × the glyph's font size (the 0.2 is read
  as em — inferred from Canva's 32 px whole-element blur, NOT measured); scale about the glyph's own centre;
  Succession's element scale multiplies the layer scale about the layer centre.

### 8.5 Importer: Canva's scheduler, ported
Everything below runs in the extension on Canva's own model values (design px, page size, raw
`startUs`/`durationUs`, config, text) and writes explicit slots, windows and params.
1. **Order and counts** (`wwf`, `Mqf`, `Nqf`, `uwf`): sort with the page preset's `jq` (element animations
   and most page presets: `uqf` = round(top) then round(left); Pop page: area descending; Neon page: none;
   Scrapbook page: distance from the page centre). N = elements whose animation is not static or that
   carry repeating effects (group children count). XH = running count of sequenced animated elements in
   that order (timed ones consume an index but use XH 0 themselves). Element-level Drift/Tectonic `wN` is
   the page's full element count (`O1.wN = elements.length`).
2. **Default windows**: `Kwf`, `dsi`, `esi`, `Yrf`, `ksf`, `vrf` with the preset's timing table (`csi`
   default; Pan page `oyf`, Pop page `tyf`, Rise page `wyf`, Scrapbook page `zyf`/`Ayf`), then the window
   function (`swf`; Neon page `myf`; Scrapbook page and Stomp page their own). Text elements whose `ouf` is
   true (Wipe; per-unit styles) take the `mnb` window for the intro. Timed elements: `ksf(A, 1)`, XH 0,
   intro at startUs, outro ending at the element's end (`Dwf`).
3. **Custom windows**: `Gwf` when `uuf` is false (`tuf`/`suf`/`puf`/`ouf`/`vuf`/`wuf` ported).
4. **Builder durations**: `xrf`/`srf`/`trf`/`wrf` for Rise, Fade, Pan, Pop, Blur, Succession, Baseline;
   Wipe's own `luf` variant (default window capped at 1500 text / 750 other); raw windows for Neon,
   Tumble, Stomp, Scrapbook, Block, Breathe, Drift, Tectonic. Block: d = floor(min(330, page·.066,
   intro/2)), k likewise from the outro → entrance durationMs = 2d, exit durationMs = 2k.
5. **Emit per layer**: window = [0 or startUs, outro end or page/element end]; entrance {durationMs,
   delayMs = intro start − window start}; exit {durationMs} ending at the window end; direction mapping as
   §6 (reverse flips the exit); intensity = 0.5 + Vd; params per §8.1 (xh, seed, Tumble start
   rotation/travel from `juf` incl. its degrees-as-radians travel quirk and D = max(page w, h), Stomp s0 from
   `mtf`, Scrapbook g/b from `jtf`, Block colour, unit/fill, Tectonic/Drift fades).
6. **Continuous presets** (`lsf`, `Csf`, `xtf` ported incl. timed / untimed / ≥ 10 s variants): loop slot
   {type, concurrent, ramp params in layer-local ms} + the builder's own intro/outro fades as FADE
   entrance/exit (`fadeEase` 1 where Canva fades linearly; none where Canva only jumps).
7. **Repeating effects**: the loop slot holds one (concurrent, phaseMs = window start in page ms);
   the rest go into `stack*` params; cycle ms and t per §4; `seed` for wiggle.
8. **Page animations**: port `Kyf` for ids 1–13 and 20 (per-preset element type, timing table, sort,
   window function, text-only Block); page Breathe/Drift also animate the page background photo
   (`Lwf`/`Mwf`) as a concurrent ramp on the background layer. The Stomp page (13) stomps only its
   headline (`Fyf`); every other element gets Canva's hidden "shake" (element id 10, `ntf`), which has no
   counterpart here. That shake, the photo presets 14–19 and the combo styles 21–27 keep the current
   approximation and are logged as such in the import warnings.
9. **Extraction**: all three fiber-walk copies read the page animation (not only canva-fiber-main.js),
   keep raw `startUs`/`durationUs` undefined vs 0, and read element geometry + text for the seeds and units.

### 8.6 Parity artefacts
* `mobileAnimationGolden.json` regenerated from the Kotlin (BLOCK, WIPE, anchored).
* New `mobileAnimationParamsGolden.json` from a throwaway Kotlin test: TUMBLE/STOMP/SCRAPBOOK/NEON with
  params, FLICKER/WIGGLE at t ∈ {0, .25, .5, 1} with and without seed, FADE fadeEase, ramps sampled in ms,
  concurrent composition (timeline + visual, incl. stack), per-unit visuals for Latin, Arabic with
  tashkeel, multi-paragraph and CJK texts at unit 1/2/3 (lines given explicitly), fit and fill.
  `animationParamsParity.test.ts` replays it on the web.

### 8.7 Corrections found while implementing (verified against Canva's code; these win over §8.0–§8.6)
* **Last-page outro, element animations too.** `Dwf` removes the outro when there is no next page and
  the element runs to the page end (`: d != null && f.yDb && z && (d = Buf(d))`, `yDb: a.nextPage == null`),
  unless the config explicitly holds `Bf`. So on a single-page design a freshly clicked tile (no `Xw`, or
  `Xw` without `qg`/`Bf`) plays its ENTRANCE ONLY, and an empty `page.Xw` behaves like an absent one.
  Choosing "كلاهما" writes `qg: {}`/`Bf: {}` and keeps the outro.
* **XH counting** (`uwf`: `t.animation && t.animation.type !== "sequenced" || ++q`, for every scheduled
  element): "independent" elements and cleared elements that only carry repeating effects consume no
  index; timed elements with no animation do. Drift/Tectonic's N (`O1.wN = a.length`) counts top-level
  elements only.
* **Page background motion** comes from each preset's own `ARi` (`iyf`, `kyf`); `Lwf`/`Mwf` animate a
  background fill that carries its own animation. Same numbers for the page presets; Drift's constant
  zoom is baked into the background object's scale.
* **Drift fades**: the linear fades are gated by `oZd` (Canva's indefinite-page mode), not by video
  pages; untimed Drift has no opacity jumps at all.
* **Succession per unit** falls back to whole-element only for EMPTY text (`stream.lb.length < 2`, and the
  stream always ends in "\n").
* **NEON per unit ignores `fill`**: `Gsf` calls `$qf` without a fit/fill mode, so it always fits.
* **Pose/tween ties**: `Xpf` sorts by delay DESCENDING and returns the first started tween, so among
  tweens with the same start the LOWEST index wins (Scrapbook poses when the duration is under 2g).
* **WIGGLE**: a rotation tween is pushed only while `l < n − 1`, so the last step holds tilt n−2 and the
  final return starts from it.
* **Empty paragraphs**: the pseudo item of an empty paragraph takes the previous item's line (Canva's
  `qrf` never starts a line on a newline).
* **Whitespace** is Canva's `asi = /\s/` — JavaScript's set, written out on both platforms: it includes
  U+FEFF and excludes U+0085 (the opposite of Unicode White_Space, which §8.4 wrongly named).
* **ROTATE carries intensity 1** on import: Canva's `qwf` always turns ±360° per cycle and its slider
  only sets the cycle length, while both runtimes multiply the turn by intensity.
* **Not ported, by design** (import warnings say so): Canva's "animations are overlapping" error path
  (Canva leaves such an element static; we animate it), NEON below intensity 0.5 running past its window
  (the tail is cut at the window), and captions sync (`NV` 2). Canva's indefinite-page mode is treated as off.
