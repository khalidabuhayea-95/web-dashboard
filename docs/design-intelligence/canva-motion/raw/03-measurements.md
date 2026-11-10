# Raw measurements: Canva animation playback (2026-11-05)

## Method (verified working)
- Canva renders each animated element as nested DIVs with inline `style` (`transform: translate(..) scale(..)`, `opacity`, clip via counter-translated container). It does **not** use CSS/Web Animations (`document.getAnimations()` = 0) and the canvas is DOM, not WebGL, for these animations.
- Trigger: clicking an animation tile (or a speed / enter-exit button) in the Animate panel replays the preview from t=0 on the selected element. Preview builds **new** DOM nodes, so the recorder scans `div[style]` every rAF and keys nodes with a WeakMap.
- Recorder logs each style change with ms since the click; analysis parses translate / scale / rotate / opacity / blur / clip, finds start, end, overshoot, quartiles, and fits 20 candidate easings by RMS on normalised time.
- Units: CSS px at 29% zoom; 1 design px = 0.2865 CSS px. Test text box «أحمد» 300×134 design px (86×38 CSS).
- Timing noise: ±1 frame (~16 ms) at both ends; first sample lands 20–70 ms after the click.

## Text element results (enter unless stated)
### تلاشي (Fade)
| Variant | Prop | From→To | Duration | Quartiles (25/50/75%) | Best fit (RMS) |
|---|---|---|---|---|---|
| fast | opacity | 0→1 | 410 ms | .42/.73/.92 | quadOut .006 |
| medium | opacity | 0→1 | 996 ms | .43/.75/.94 | quadOut .001 |
| slow | opacity | 0→1 | 2919 ms | .44/.75/.94 | quadOut .000 |
| exit (after fast) | opacity | 1→0 | 495 ms | .06/.24/.56 | quadIn .001 |
| first click (state after previous tests) | opacity | 0→1 | 493 ms | .41/.73/.93 | quadOut .007 |

### انبثاق (Pop)
- scale 0→1 (uniform sx=sy), **spring with overshoot**: peak 1.27 (+27%), undershoot to 0.933, settles about ±0.2% by ~0.75 of the duration. No opacity change recorded.
- Durations: fast 411, medium 995, slow 2919 ms (the window ends when the value settles).
- Medium raw grid, 33 ms steps from t=43 ms: 0 .255 .623 .959 1.175 1.269 1.258 1.186 1.094 1.01 .956 .933 .935 .953 .976 .997 1.008 1.017 1.017 1.013 1.007 1.002 .998 .996 .996 .997 .998 1 1.001 …
- No closed-form ease fits well (best md3Emph .19), so it is a damped spring.

### ارتقاء (Rise)
- translateY +22.9 CSS px (= 80 design px ≈ 0.6 × the element height of 134) → 0, together with opacity 0→1, on the same curve.
- quadOut (RMS .001–.005). Durations: fast 410, medium 996, slow 2913 ms.

### تأرجح (Pan)
- translateX +22.9 CSS px → 0 (moves left into place, default direction) + opacity 0→1, quadOut.
- Duration ≈ 495 ms in every run, **including after clicking slow/medium/fast**. To recheck: the speed clicks may not have registered for this tile.

### المسح (Wipe), default direction
- Two nested nodes: an outer clip container (overflow hidden) translates X by −W (−85.9 CSS = the text width) while the inner content counter-translates by +W. The visible edge sweeps right→left (RTL reading start) with the content fixed on screen.
- Enter: cubicOut (RMS .001), ≈1.49 s in all four speed clicks (same issue as Pan, so recheck). Quartiles .57/.87/.98.
- Exit (after fast): the container keeps moving the same way (−W) and the content +W: cubicIn, 492 ms.

### تمويه (Blur)
- opacity 0→1 + filter blur 9.17 CSS px (32 design px ≈ 0.24 × element height) → 0, same curve. No transform.
- quadOut. fast 412, medium 994, slow 2918 ms.

### التتابع (Succession), single word
- scale 0.75→1 + opacity 0→1 + blur 6.88 CSS (24 design px) → 0, all on one quadOut curve.
- fast ~0.49 s, medium 993 ms, slow 2912 ms. Per-word stagger needs a multi-word box (test on the date text).

### Baseline
- The inner content translates Y from +1.0 × element height (+38.35 CSS) to 0 inside a clipping container, so text rises from its own baseline, masked. No opacity.
- Enter: **expoOut** (RMS .001). Quartiles .82/.97/1.0. fast 408, medium 998 ms.
- Exit (after fast): Y 0 → −1.0 × height, sineIn, 296 ms.

### ظهور بطيء (Breathe), Scale «للداخل» default (no enter/exit, no speed)
- Lasts the whole preview (3.41 s; in page playback it presumably spans the element's time on page, not verified).
- scale 0.90 → 1.03, **linear** (RMS .000), with opacity 0→1 over the first ≈0.45 s (ease-out: 0, .34, .62, .83, .96, 1 at ~100 ms steps).

### انجراف (Drift), default direction (no enter/exit, no speed)
- Continuous over 3.41 s. translateX starts at +0.18 W (+15.5 CSS), passes 0, overshoots to −0.09 W around 50% of the time, and eases back to 0 at the end (smooth S-curve and return). No opacity change recorded.
- Samples (≈100 ms): 127.19 127.03 126.61 125.84 124.76 123.36 121.66 119.62 117.25 114.62 112.20 110.23 108.38 106.88 105.69 104.80 104.24 104.00 104.01 104.13 104.36 104.69 105.13 105.67 106.33 107.08 107.94 108.72 109.47 110.10 110.64 111.06 111.38 111.60 111.70 (rest at 111.72)

### حركة تكتونية (Tectonic) (no enter/exit, no speed)
- Mirror of Drift with smaller amplitude: X from −0.12 W (−10.3 CSS), overshoots to +0.06 W at mid, returns to 0. Opacity 0→1 **linear over the first ≈0.5 s**.

### دوران (Tumble)
- Enter: translateX from −380 CSS (−1326 design px, off the left of the page) → 0, rotate +41.5° → 0, opacity ≈0.3→1, all on cubicOut, ≈430 ms (no speed buttons; intensity/direction/auto controls).
- Exit: +524 CSS X (off to the right), rotate 0 → −57°, opacity → 0, cubicIn, ≈490 ms.

### نيون (Neon), stepwise opacity flicker, ≈440 ms
- Enter, opacity at ~33 ms steps: 0 .37 .73 1 .32 0 1 0 0 0 0 .02 .32 .72 .92 → 1. That is a 100 ms ramp-up, a drop, a single-frame flash, ≈160 ms dark, then a ≈130 ms ramp to full.
- Exit: 1 (100 ms) → 0 (170 ms) → 0.5 (170 ms) → 0.

### سجل قصاصات (Scrapbook): stop-motion, no interpolation
- 3 held poses ≈165 ms apart, then rest at ≈500 ms:
  - pose 1: ty −273 CSS from rest (above the page), tx +14.3, rot +5°, opacity snaps 0→1 on frame 2
  - pose 2: ty −122, tx 0, rot −4.5°
  - pose 3: ty −68, tx +14.3, rot +3.5°
  - rest: ty 0, rot 0
- Exit: no style changes captured.

### سقوط هوائي (Stomp-like drop)
- scale 5.4 → ~1.2 accelerating (cubicIn-like; samples 5.4 5.4 5.399 5.394 5.381 5.353 5.30 5.21 5.07 4.87 4.60 4.20 3.70 3.06 2.22 1.21), then snaps to rest 1.0 at ≈500 ms.
- Opacity 0→1 over the first ≈200 ms (ease-in: 0 0 .009 .05 .17 .42 .89 1).
- Exit: opacity 1→0, quadOut, 492 ms (no scale).

### Speed presets: open issue (Wipe / Pan)
- For Wipe and Pan, clicking بطيء/سريع via JS left the selected speed at متوسط (class check). Preview stayed at 1.49 s (Wipe) and 0.49 s (Pan), and page playback was the same (Wipe onset at the element start, 1.58 s, then ≈1.5 s).
- For Fade, Rise, Pop, Blur, Succession and Baseline the same JS clicks did change the duration: slow ≈2.9 s, medium ≈1.0 s, fast ≈0.41 s.
- Switching to another tile resets speed to متوسط.
- **Retested with a real mouse click (2026-11-05, Wipe on «أحمد»):** clicking بطيء leaves متوسط selected (the crown icon is shown next to «السرعة»), and the preview is still 1.49 s. Conclusion: for Wipe (and Pan, by the same behaviour) the speed presets have no effect in this account. Wipe is fixed at ≈1.5 s cubicOut, and Pan at ≈0.5 s quadOut.
- Consequence: the T1–T5 dividers set to «المسح سريع» actually run at 1.49 s. That matches what was measured in playback (lines visually done at ~1 s, technically at ~1.5 s after onset).

### Lab preset → closest measured Canva animation (used on INV-T1…T5, 2026-11-05)
- mask-reveal-up (hero) → **Baseline** (expoOut, masked rise from 1× element height)
- blur-in → **تمويه** (opacity plus 32 px blur, quadOut)
- drift-in (names) → **تأرجح** (Pan) with opposite directions يسار/يمين (80 px slide plus fade, quadOut)
- fade-up → **ارتقاء** (80 px rise plus fade, quadOut)
- draw-stroke (dividers) → **المسح** (cubicOut)
- pop-spring → **انبثاق** (spring, +27% overshoot)
- twinkle → **ومض** add-on
- breathe → **تقليص العنصر وتمديده** add-on
- Ken Burns / float → **ظهور بطيء** (linear scale 0.90→1.03 over the whole duration)
- Stagger: element timing starts at lab offsets (bism 200 → hero 500–600 → intro 1300–1500 → names 1900–2000 → & 2050–2400 → divider 2300 → date 2500–2800 → details 2650–3000 → closing / seal 2900–3300).
- Workflow lesson: select elements through Position → Layers when they overlap. A canvas click on overlapping items picks the wrong one, and once dragged the bismillah in T3 (fixed via the X/Y fields).

### Block (text, «مقترحة»)
- A colour block node translates X from +W to −W (full sweep across the text), **cubicInOut**, ≈445 ms; same on exit. No speed control. The text toggles visible while the block covers it (single-frame switch, not interpolated).

## Add-on effects (text, main = تلاشي, default slider 0), measured 2026-11-05
Preview: the main fade starts at about 1.3 s (preview delay), and the add-on runs from the same moment.
- **تدوير (Rotate):** continuous linear rotation of the whole element at **≈17.7°/s** (one turn ≈ 20 s), clockwise by default. Samples every 100 ms: 0.12 1.90 3.67 5.44 7.22 8.99 10.76 12.54 14.31 16.09°.
- **ومض (Flicker):** modulates opacity on top of the fade. Over 0.9 s the opacity went 0.07 .35 .47 .47 .39 .35 .35 .45 .59 .74, i.e. dips of ~25% with a ~0.5 s rhythm (aperiodic look).
- **تقليص العنصر وتمديده (Pulse):** uniform scale oscillation, about **0.85–1.15 (±15%)**, period **≈0.9 s**. Samples every 100 ms: 1.00 1.10 1.10 1.02 .95 .90 .87 .85 .90 1.00 1.02.
- **اهتزاز سريع بالاتجاهين (Wiggle):** jitter, not a smooth loop. translateX ±4.4 CSS (≈±15 design px), translateY ±4.6, rotation −7.2…+10.8°, irregular.
- No canvas or WebGL in any of them; all are inline transform/opacity on the element wrapper.

## Photo animations (image fill in rect, 2026-11-05)
- **انسيابية الصورة (Photo flow):** the outer frame fades in (opacity 0→1, ≈0.5 s, quadOut), while the inner image drifts translateY by about ±3% of the frame height across the whole duration, sineInOut. The image moves inside a fixed crop.
- **ارتقاء الصور (Photo rise):** same mechanism as Photo flow, with the inner drift going the opposite way.
- **تكبير الصورة (Photo zoom):** the inner image scales 1.15→1.0 inside a fixed crop, sineInOut, over the whole duration (Ken Burns, zoom-out).
- Image ارتقاء (General): same +22.9 CSS (80 design px) offset as text, so the offset is a fixed distance, not a share of the element size.

## Featured (shader) and Reveal effects on a still image
- تكبير اهتزازي, التلفزيون القديم and اسحب الفرشاة: **no inline-style changes** on the image nodes, apart from a frame opacity 0→1 in ≈0.2 s (Old TV).
- During the Old TV preview a temporary `<canvas>` appears over the image (37×37 CSS at 809,285, the image thumbnail) for ≈1 s and is then removed. The effect is drawn on that canvas overlay (shader rendering), not with DOM transforms.
- So curves for Featured and Reveal effects cannot be measured with the DOM recorder. They are documented by name and controls only (see 02-panel-inventory.md).

## Page transitions (lab page 1 → 2, 2026-11-05)
Panel «الانتقالات», opened between page thumbnails. Every transition has «المدة (ثواني)», default **0.5 s** (official range 0.1–2.5 s).
| Transition (UI) | Controls | Measured (0.5 s) |
|---|---|---|
| لا يوجد (None) | — | — |
| تضاؤل (Dissolve) | duration | Incoming page opacity 0→1, **linear**. Starts 0.5 s before the end of page 1 (4.57→5.07 s); the outgoing page stays static underneath. |
| إزاحة (Slide) | duration, direction يسار/يمين/أعلى/أسفل | Outgoing page translateX 0→−100% and incoming +100%→0, **linear**, together (push). |
| المسح الدائري (Circle wipe) | duration, للداخل/للخارج | One page layer carries a hard-edged `mask: radial-gradient(circle, transparent r%, black r%)`; r goes 97.6%→1%, **linear**, 4.59→5.04 s. |
| مسح اللون (Colour wipe) | duration, 8 directions (يسار/يمين/أعلى/أسفل plus 4 diagonals) | not measured |
| المسح الخطي (Line wipe) | duration, 4 directions | not measured |
| المطابقة والنقل (Match & move) | duration | not measured |
| التدفق (Flow) | duration | not measured |
| تكديس (Stack) | duration | not measured |
| حركة قصيرة (Short motion / swing) | duration, clockwise / counter-clockwise | Incoming page `rotate(−90°→0)` around `transform-origin: 0% 100%` (bottom-left), strong ease-out (≈cubicOut: −12° left at 50%), 0.5 s. |
- Note: after a transition was added, page 1's duration label changed from 5.0 s to 4.7 s (the transition overlaps the end of the page).

## Magic Animate / featured page styles (lab page 1)
- Page tab → «أداة Magic Animate» card (AI, applies to every page), then «متميز» styles: بسيط, ناعم, مضحكة, حفلة, مؤسسة, هادئ.
- Applying **بسيط** shows the toast «تم استبدال الرسوم المتحركة للعنصر» (it replaces each element's own animation), adds «كلاهما/عند الإدخال/عند الخروج» and «التطبيق على جميع الصفحات».
- Measured playback with بسيط:
  - Every element fades in (opacity quadOut, about 0.74 at mid-time).
  - The hero also rises (≈−45 CSS ≈ 157 design px).
  - With «كلاهما» each element fades out again at the end of the page.
  - Element onsets kept the element timing already set (hero 0.46 s, ornament 1.47 s, name 1.73 s, text 2.35 s, icon 2.65 s), so the style changes the animation type but not the timing.
- The AI Magic Animate tool itself was not run (it rewrites all pages; the help page limits it to presentation, social and video design types).

## Motion path («إنشاء رسم متحرك»)
- Shown in the Animate panel for an element: "اسحب العناصر حول لوحات Canva لإنشاء رسومك المتحركة."
- Official flow: drag the element along a path → adjust the motion style, presentation settings and add-ons → Done / Delete path. Multi-select plus Create animation makes a sequence.
- Not recorded frame by frame in this pass.
