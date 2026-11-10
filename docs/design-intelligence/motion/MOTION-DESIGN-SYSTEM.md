# Motion Design System (Nayroz templates)

> **Production rule (Ali, 2026-11-05): Canva's built-in animations only. No external animation of any kind.** Use `CANVA-ANIMATION-PLAYBOOK.md` for every template. The engine, presets and Kotlin code in this folder are **reference/archive**. The principles here (hierarchy, timing, stagger, variety, Arabic word-level, accessibility) still apply.

This is the entry point for any animated template or in-app animation. It is built on Arabic-first, RTL rules.

**Evidence labels used in every motion file:**
- ✅ **Verified:** built and measured in this study.
- 👁 **Observed:** frame-sampled from a real template.
- 📄 **Documented:** read from official docs.
- ⚠️ **Assumption / not tested.**

## 1. What was actually done (2026-11-05)

| Work | Result | Where |
|---|---|---|
| References read | Canva help (animate designs), GSAP docs (core, eases, timeline), Apple HIG Motion, Rive features, LottieFiles, Jitter help (editor, text, loops, exports) | RESEARCH notes in MOTION-BENCHMARK-REPORT |
| Templates analysed | 32 Canva preview videos measured numerically, 14 Jitter templates frame-sampled (one measured at 60 fps), 1 Wedvite preview MP4 | MOTION-BENCHMARK-REPORT |
| Engine built | `lab/engine/motion-engine.js`: easing (cubic-bezier, power, back, elastic, bounce, steps, analytic spring), GSAP-style timeline positions, stagger, loops, reduced motion | ✅ |
| Preset library | 41 presets, one JSON-compatible source → `presets.json` + generated Kotlin | ANIMATION-PRESET-LIBRARY |
| Styles recreated | 13 styles + 1 Arabic diagnostic, rendered frame by frame to MP4 and measured in real time at 1× and 4× CPU throttle | `lab/out/*.mp4`, `motion-benchmark-grid.mp4` |
| KMP | Pure-Kotlin engine (commonMain). Compiled for JVM **and** Kotlin/JS. 1,234 parity checks against JS with 0 failures (max error 5e-10). Skia raster cost benchmark. | KMP-ANIMATION-IMPLEMENTATION |

**Not done:**
- No Android device, emulator, or iOS simulator was available.
- Compose libraries could not be downloaded (Maven was blocked).

Everything about on-device performance is therefore marked ⚠️.

## 2. Five laws (apply to every template)

1. **Motion follows hierarchy.**
   - Order: hero → names/headline → supporting text → details → ambient.
   - Never animate everything at once. 👁 Canva templates stagger top-to-bottom bands in roughly 70–130 ms steps.
2. **One family of motion per design, varied per role.**
   - The style (luxury, energetic, editorial) sets the eases and durations.
   - Each role gets its own preset. This is Ali's rule: never the same animation on every element.
3. **Enter, then hold.**
   - 👁 Most Canva invitation/promo previews finish all entrances by 0.9–1.5 s, then hold still.
   - Ambient loops (sparkle, sway, shimmer) are the only motion during the hold.
4. **Loops must be periodic.**
   - Any loop is a function of `t mod period`, so the first and last frame are identical.
   - ✅ Pixel-identical seam test: diff 0.0 at t=0 vs t=period.
5. **Arabic is split by word, never by letter.**
   - ✅ Per-letter split breaks joining in Chromium (see `lab/out/frames/arabic-letter-split-test`). Without an explicit RTL paragraph direction, it also reversed the order in the first render.
   - Rule: Arabic units = word or line, container `direction: rtl`, stagger «start» = rightmost word.

## 3. Phases (independent per element)
| Phase | Purpose | Default | Notes |
|---|---|---|---|
| Entrance | bring element in | 500–900 ms (luxury 900–1600) | ease-out family |
| Emphasis | one-shot attention (CTA, price) | 400–700 ms | must return to rest state |
| Loop | ambient life | period 1.8–6 s (bg 10–20 s) | low amplitude, seamless |
| Exit | leave (multi-page / video end) | 300–600 ms | ease-in family. Templates for invitations: **no exit** (Canva «عند الإدخال» only) |

Compose rules (engine): opacity/scale multiply, x/y/rotate/blur add, draw/shimmer absolute. This lets an element have entrance + loop + emphasis simultaneously ✅.

## 4. Durations by distance/size (rule of thumb)
- Small (icon, badge, ≤150 px): 300–500 ms
- Medium (text line, card): 500–800 ms
- Large / full-screen / transitions: 700–1000 ms
- Luxury mode: ×1.5–2. Energetic mode: ×0.7 with overshoot.
- Stagger per unit: words 80–180 ms, list rows 120–350 ms, letters (Latin only) 30–70 ms.

## 5. Performance budget (from measurements)
- **Cheap:** transform (translate/scale/rotate), opacity, clip rect.
  - ✅ Skia raster: text scene 4 ms/frame at 1080×1920.
  - ✅ JS engine evaluation: ≤0.4 ms/frame.
- **Expensive:**
  - Blur on text costs 26 ms p50 / 70 ms p95 on CPU raster ✅. Use it only on short entrances of a few elements.
  - Full-screen blur costs 180 ms ✅. Never per frame.
  - Procedural full-frame gradients plus particles cost 96 ms CPU raster ✅. In Chromium at 4× throttle they dropped to 30 fps ✅. Pre-render them to a video loop or a smaller canvas.
- **Rule:** at most 1 expensive effect active at a time, and never during a full-screen transition.

## 6. Accessibility
Engine reduced-motion mode is ✅ implemented:
- Entrances and exits become 200 ms fades.
- Loops and emphasis are disabled.
- Transforms are removed.

Apple HIG (📄): motion must be optional, brief and precise, cancellable. Avoid sustained oscillation (~0.2 Hz). Never use motion as the only signal.

## 7. File map
| File | Use |
|---|---|
| **CANVA-ANIMATION-PLAYBOOK.md** | **production: role → Canva animation, timing, mapping** |
| ANIMATION-PRESET-LIBRARY.md | all 41 presets + combos |
| EASING-AND-TIMING-GUIDELINES.md | easing curves, durations, stagger, spring params |
| TEXT-ANIMATION-GUIDELINES.md | Arabic/Latin text motion |
| IMAGE-AND-SHAPE-ANIMATION.md | Ken Burns, parallax, draw, morph, 3D |
| TRANSITION-LIBRARY.md | page/scene transitions |
| CATEGORY-SPECIFIC-MOTION.md | per-category motion systems |
| KMP-ANIMATION-IMPLEMENTATION.md | engine, Compose binding, libraries, test status |
| MOTION-BENCHMARK-REPORT.md | 47 references analysed + 13 recreations measured |
| lab/ | runnable engine, presets.json, demos, render script, Kotlin, outputs |
