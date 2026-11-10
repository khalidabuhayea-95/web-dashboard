# Motion Benchmark Report (2026-11-05)

## 1. Sources actually accessed
| Source | Access | What was taken |
|---|---|---|
| canva.com/help/animate-designs | WebFetch failed. Read the full Arabic page in Chrome. | Animate panel tabs Page/Element/Text; speed presets slow/medium/fast or exact durations; general + suggested animations + extra effects combinable; options vary by element type; Pro-only extras; "Create an animation" = drag a motion path; element timing view (reorder, drag durations); click order; **max 10 s per animation and 50 animations per design**; reduced-motion device setting removes transitions, background animations, masks and overlays; Magic Animate. Canva editor (verified in the earlier session): Ascend/Rise, Swing, Fade, Pop, Wipe, Blur, Sequence, Slow Appear, Baseline, Drift, Tectonic, Spin, Neon, Scrapbook, Aerial Fall; extra effects Rotate, Flash, Pulse (scale), Wiggle; enter/exit/both; direction arrows. |
| gsap.com/docs/v3, /Eases, /GSAP/Timeline | read | ease list, default `power1.out`, position parameter syntax, defaults inheritance, repeat/yoyo, nesting |
| developer.apple.com HIG Motion (.md) | read | purposeful, optional, brief, cancellable, avoid frequent-UI motion, 30–60 fps consistency, avoid ~0.2 Hz sustained oscillation, fades for relocation |
| rive.app/features | read | state machines, data binding, bones, meshes, runtimes list (no KMP) |
| lottiefiles.com | read | Lottie JSON / dotLottie, web + iOS + Android players |
| github.com/alexzhirkevich/compottie (+ supported_features.md) | read | CMP Lottie engine and its feature matrix |
| jitter.video/templates + 14 template pages | **frame-sampled in Chrome** (canvas capture) | see §2 |
| help.jitter.video (editor, animate text, operations vs keyframes, looping, exports) | read | text split by letter/word/line + delay + "Acceleration/Smoothing"; operations not keyframes; loop rule "last frame = first frame"; exports (PNG sequence, transparent video; 4K/GIF/Lottie mentioned on the site header) |
| wedvite.net/ar/wedding-invitation-design + Rawda preview MP4 | page text + video frames | Gulf front layout (6 lines), static text with animated bg, envelope intro |

**Not accessed:**
- Jitter Academy videos (not opened).
- LottieFiles individual animations (not inspected frame by frame).
- Rive community files.
- Paid Canva/Andalusi internals.

## 2. Templates analysed (47)
**Method (Canva):**
1. Fetch each template's preview MP4 in the page.
2. Decode it at 15 fps to 72 px wide.
3. Compute three measures:
   - per-frame motion energy (mean abs RGB diff)
   - 8 horizontal-band **onset** times (first visible change)
   - band **settle** times
4. Record `lastBig` = last frame with energy > 1.5.

Raw outputs are logged in this study.

| # | Canva template (ID) | Type | Dur s | Energy per second | lastBig s | Reading |
|---|---|---|---|---|---|---|
| 1 | EAGHdo_HX5k brown/gold floral wedding | invitation | 5 | 1.9, .2, .1, 0, 0 | 0.93 | top→bottom stagger 0.13→1.0 s, then hold |
| 2 | EAGxldWJL88 green watercolor wedding | invitation | 5 | 2.1, .7, .3… | 1.27 | arch frame + text in ~1.3 s, light ambient |
| 3 | EAF0nd1dKVg mehndi | invitation | 8 | 4.3, 1.1, .1, 0… | 1.33 | fast entrance, long hold |
| 4 | EAHPdm6Fd2g beige wedding reel | invitation | 8.7 | 3.4→1.1→2.7 | 8.4 | continuous ambient |
| 5 | EAGfXxkAX_Q red/yellow wedding | invitation | 12 | bursts at 0, 3–4, 7 s | 8.5 | three scenes |
| 6 | EAGmLV3ZuYI blue/white floral (illustrated couple) | invitation | 13.8 | 2, .7, .5, 2.1, 4.3… | 10 | 3 pages, illustrated couple |
| 7 | EAGjme7dqIQ cream/yellow decorative | invitation | 18 | 3.4 then spike 5.2 @6 s | 9.9 | page change @6 s |
| 8 | EAHZkBqZ738 cream/maroon elegant | invitation | 15 | 3.9, 0,0,0, 12.9, 11.1, 0,0,0, 11.6 | 10 | page transitions every ~4.5 s |
| 9 | EAHRrrqbIWU baby announcement watercolor | announcement | 14.9 | low, spike 3.2 @7 s | 8.1 | slow staged reveal (bands start 0.3→7.8 s) |
| 10 | EAGexaZxLYc brown Ramadan kareem | Ramadan | 10 | 4,3 alternating all through | 10 | swaying lanterns, text settled 0.6–0.7 s |
| 11 | EAF-6ooNhFc black/gold Ramadan | Ramadan | 8 | 2.3, 4.3, then ~1 | 7.9 | continuous ambient, photo frame |
| 12 | EAF9_DxvfFc retro sale fashion | sale | 5 | 2.9, 10.1, 10.3… | 5 | constant high (video) |
| 13 | EAE6Nefzyx8 summer sale | sale | 5.7 | 0.2 | — | near-static preview |
| 14 | EAGVtuazxiI Black Friday | sale | 8.3 | 0.5–2.6 bursts | 7.8 | repeated pop/slide hits |
| 15 | EAGZ1PWVCFo minimal fashion sale | sale | 10 | 18.5, 13.8, 17.2, 12.6, then .4 | 4.1 | big full-frame motion 4 s, then hold |
| 16 | EAGV83OFaWE Christmas collage | sale | 4 | ~9 constant | 4 | collage slideshow |
| 17 | EAFaSl2sfPA real estate story | promo | 12 | 3–7 constant | 10 | video bg |
| 18 | EAGKns6CheE memphis agency | business | 8 | 26.3 then ~1, 19.1 at end | 7.9 | big in/out transitions |
| 19 | EAGLABLMgI0 blue business (30 s) | business | 30 | ~9 for 6 s | 10 | continuous |
| 20 | EAGsgIUylsQ corporate webinar | business | 8 | 4.3, 1.8, .4 | 1.33 | staged bands 0.2→1.3 s |
| 21 | EAGNiwWAxNQ coffee promo | promo | 5 | 5.1, 1.9, 0 | 1.2 | quick entrance + hold |
| 22 | EAE5b9l3SeM electronic promo | promo | 10 | 0.1 | — | static |
| 23 | EAE866f3FYk travel reel | promo | 12 | 3–4 constant | 10 | video bg |
| 24 | EAE9jcIvmO0 tech gradient | promo | 15.9 | 0.9 → 13 peaks | 10 | multi-scene |
| 25 | EAGfwRpxuGc product showcase reel | product | 2.2 | 0.2 | — | static |
| 26 | EAGp-JJ6Fp4 headphones | product | 7 | 10.1, .8, .1 | 1.2 | one strong entrance burst |
| 27 | EAF22R1T3r8 doodle beauty ad | product | 6 | 1–2 constant | 5.7 | doodle loops |
| 28 | EAGZkJM7BDg gradient infographic reel | education | 5 | .8, .7, .4 | 0.5 | soft staggered rows (0.33→2.2 s) |
| 29 | EAGLGenXb28 skincare infographic | education | 4 | .5, .2 | — | minimal |
| 30 | EAHLkQ4Uc6E announcement | event | 6 | 7.1 → .9 decaying | 6 | long ease-out |
| 31 | EAGt78dtsYI coming soon | event | 5 | 17.1, .8, 0 | 1.33 | one big hit + hold |
| 32 | EAHEEfby2Sg store opening | event | 6 | 5–11 | 5.9 | continuous energetic |

**No video preview, so not analysed:** EAGf6u1roWY, EAGgtZN14nM, EAGgGy_nSxM, EAE32NCIRIw, EAHRoG7BE1c (static templates).

**Note:** for previews longer than 10 s, energy is 0 after 10 s. This is consistent with the 10 s per-animation limit in Canva help, but it may also be how the preview was captured.

| # | Jitter template (frame-sampled) | Observation |
|---|---|---|
| 33 | Snappy Text Stretch | words appear one at a time with vertical stretch; lines staggered; full exit then loop (~3.6 s) |
| 34 | Morph: Inflating Text | scale overshoot pulses (inflate/deflate), shape morph of letters |
| 35 | Blurry Text Spin | blur + rotate transition between states |
| 36 | The Stack: Sale | **measured at 60 fps**: hard cuts at 2.4 s and 5.6 s (energy spike 58), then ~2 s exponential settle = expo/quart-out |
| 37 | The Edit: Split Reveal | strip/split transitions between product photos |
| 38 | Countdown: Bold | every number uses a different transition (stripes, scatter, bars, scale) |
| 39 | Card Flip | full 3D Y-rotation with backside, perspective |
| 40 | The Track: Product Reveal | hard cut to a white page with a line layout |
| 41 | Image Stretch Transition | stretch/slide transition between photos |
| 42 | Gradient Background | slow continuous blob drift (loop) |
| 43 | The Stack: Testimonial | glass card blurs in over a photo mid-loop |
| 44 | Orbit: Cards | continuous orbital rotation |
| 45 | Blur: Swirl | items orbit in a radial pattern |
| 46 | View Cart Button: Split | icons morph into a pill button (shape morph) |
| 47 | Wedvite Rawda (MP4, 6.5 s, 560×1212) | static text, animated scenic background |

**Earlier sessions also covered** 2 Canva Arabic animated invitations (staggered: title fade, names sequential, floral border wipe) and Andalusi invitations.

## 3. Findings
1. **Three patterns in Canva:**
   - (a) Entrance burst (≤1.5 s, or 4 s for big full-frame moves), then a static hold. This applies to 8 of the 32 measured videos; 4 more are near-static.
   - (b) Continuous ambient motion from a video/animated background, while the text settles early. This applies to 10 of 32.
   - (c) Multi-page or multi-burst templates (9 of 32). They switch pages about every 4–5 s.
2. **Staggered by vertical band:** onsets step 70–130 ms from top to bottom in invitations and business templates.
3. **Jitter's quality markers:**
   - one bold idea per template (stretch, flip, orbit, split)
   - exponential ease-outs after cuts
   - each beat with a different transition (countdown)
   - loops where the last frame = the first.
4. **Wedvite / Andalusi luxury:** text static or minimal, the richness is in the background. This confirms our luxury system: slow reveals, then ambient only.

## 4. Recreations (13 styles + 1 diagnostic) ✅
**Method:**
- Each style is rendered deterministically: `__seek(t)` → screenshot at 30 fps → H.264 MP4.
- It is then played in real time in headless Chromium for 6 s at 1× and 4× CPU throttle.

Files:
- Videos: `lab/out/<id>.mp4`
- Contact sheets: `lab/out/<id>-sheet.png`
- All 12 together: `motion-benchmark-grid.mp4`

| Style | Dur / frames | 1× frame Δt p50/p95 ms | 1× jank | 4× Δt p50/p95 | 4× jank | JS cost p95 1×/4× ms |
|---|---|---|---|---|---|---|
| luxury-wedding-ar | 8s / 241 | 16.7 / 16.7 | 0% | 16.7 / 16.8 | 0% | 1.5 / 1.8 |
| arabic-word-stagger | 5s / 151 | 16.7 / 16.7 | 0% | 16.7 / 16.7 | 0% | 0.2 / 0.9 |
| arabic-letter-split-test | 1s / 31 | 16.7 / 16.7 | 0% | 16.7 / 16.7 | 0% | 0.1 / 0.4 |
| typewriter-latin | 5s / 151 | 16.7 / 16.7 | 0% | 16.7 / 16.7 | 0% | 0.3 / 1.1 |
| snappy-stretch | 4s / 121 | 16.7 / 16.7 | 0% | 16.7 / 16.8 | 0% | 0.3 / 0.8 |
| sale-pop | 6s / 181 | 16.7 / 16.8 | 0% | 16.7 / 16.7 | 0% | 0.3 / 1.2 |
| product-kenburns | 8s / 241 | 16.7 / 16.7 | 0% | 16.7 / 16.7 | 0% | 0.2 / 0.8 |
| transitions | 10s / 301 | 16.7 / 16.8 | 0.3% | 16.7 / 16.8 | 0% | 0.2 / 0.8 |
| card-flip-3d | 5s / 151 | 16.7 / 16.7 | 0% | 16.7 / 16.8 | 0% | 0.1 / 0.7 |
| gradient-particles-loop | 6s / 181 | 16.7 / 16.7 | 0% | 33.3 / 33.4 | 53.2% | 0.4 / 2.4 |
| countdown | 4s / 121 | 16.7 / 16.8 | 0% | 16.7 / 16.8 | 0% | 0.2 / 0.8 |
| islamic-ramadan | 8s / 241 | 16.7 / 16.8 | 0% | 16.7 / 16.7 | 0% | 1.6 / 1.6 |
| cinematic-glitch | 5s / 151 | 16.7 / 16.7 | 0% | 16.7 / 16.8 | 0% | 0.2 / 1 |
| education-steps | 6s / 181 | 16.7 / 16.7 | 0% | 16.7 / 16.7 | 0% | 0.2 / 0.7 |
**Jank** = frames with Δt > 25 ms.

**Caveat:** headless rAF timing excludes GPU/raster time. Raster cost was measured separately with Skia (see KMP doc).

### Comparison per recreated style
Visual scores (out of 5) are self-assessed from the rendered frames, not user-tested.

| Style | Reference | Visual | Timing/smoothness | Consistency | Editability | Performance | Notes |
|---|---|---|---|---|---|---|---|
| luxury-wedding-ar | Andalusi/Wedvite, Canva wedding | 4 | 5 | 5 | 5 (all params) | 5 | the closest to the target; needs real Canva/Magnific backgrounds |
| arabic-word-stagger | Canva Arabic | 4 | 5 | 5 | 5 | 5 | RTL order bug found and fixed |
| islamic-ramadan | Canva Ramadan | 4 | 5 | 5 | 5 | 5 | lanterns swing on a top pivot |
| sale-pop | Canva sale | 4 | 5 | 4 | 5 | 5 | spring overshoot reads well |
| product-kenburns | Canva/Jitter product | 3 | 5 | 5 | 5 | 5 | CSS bottle placeholder; needs a real product image |
| snappy-stretch | Jitter Snappy Text Stretch | 4 | 5 | 5 | 5 | 5 | close match |
| transitions | Jitter/Canva | 4 | 5 | 5 | 5 | 5 | push initially wrong (opacity), fixed |
| card-flip-3d | Jitter Card Flip | 3 | 5 | 5 | 5 | 5 | flips in only (no backside) |
| gradient-particles-loop | Jitter Gradient Background | 4 | 5 | 5 | 4 | **2** | seamless verified; 30 fps at 4× throttle |
| countdown | Jitter Countdown | 3 | 5 | 4 | 5 | 5 | the Jitter one varies per beat; ours is uniform (intentional, simpler) |
| cinematic-glitch | — | 3 | 5 | 4 | 5 | 4 | rgb split via text-shadow |
| education-steps | Canva infographic | 4 | 5 | 5 | 5 | 5 | |
| typewriter-latin | generic | 4 | 5 | 5 | 5 | 5 | Latin only by rule |

## 5. Bugs found by testing (and fixed)
1. **Loop tracks moved the timeline pointers.** Elements placed with `>` waited until after the loop ended (luxury content appeared only at 7 s). Fixed: loops are ambient.
2. **JS ignored generic track overrides** (`duration`, `ease`). This was caught by Kotlin parity (85 mismatches → 0).
3. **Arabic split units without RTL** rendered in reversed order. Fixed: auto `direction: rtl`.
4. **Push transition** used opacity presets, which exposed the panel underneath. New `push-in-start` / `push-out-end` presets fix it.
5. **Kotlin/JS** rejects classes implementing function types. Spring was refactored.
