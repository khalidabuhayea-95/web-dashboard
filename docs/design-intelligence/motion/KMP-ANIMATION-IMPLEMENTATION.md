# KMP Animation Implementation (Android + iOS)

## 1. Recommendation
Use a **custom data-driven engine in `commonMain`** (built here) and render it with **Compose Multiplatform** (`graphicsLayer` + `drawWithContent`):
- Text stays real Compose `Text`, so Arabic shaping goes through HarfBuzz. Lottie/Rive text would need fonts and their own shaping.
- Every property is editable per element, and timelines are shared with web (the editor/dashboard) through `presets.json`.
- One evaluation per frame for the whole scene.

Add **Lottie (Compottie)** only for **pre-made decorative assets** (sparkles, confetti, morphing icons). Consider **Rive** only if interactive state machines are needed later.

## 2. What was verified ✅ vs not ⚠️
| Item | Status | Evidence |
|---|---|---|
| Engine in pure Kotlin (`lab/kmp/src/commonMain/.../MotionEngine.kt`, `PresetLibrary.kt` generated) | ✅ compiles with **Kotlin 2.2.21 JVM** and **Kotlin/JS (IR klib)**. A non-JVM target proves no JVM-only APIs. | `lab/kmp/build/js` |
| Portability bug found by the JS compile | ✅ fixed: `class Spring : (Double)->Double` is illegal on Kotlin/JS ("implementing a function interface is prohibited") | — |
| Parity with the web engine | ✅ 1,234 checks (25 eases × 21 samples + 6 full scenes × up to 9 timestamps × every property), **0 failures, max error 5e-10** | `lab/out/parity.txt`, `ParityTest.kt` |
| Engine cost | ✅ 12–15 µs per frame on JVM for a 17-track scene (luxury invitation). It is negligible next to the 16.7 ms budget. | ParityTest |
| Kotlin/Native (iOS) compile | ⚠️ not run: K/N toolchain download (download.jetbrains.com) was blocked. The code uses only `kotlin.math`, `Regex` and collections from the common stdlib, so it is expected to compile; verify in the project. | — |
| Compose binding `MotionCompose.kt` (clock via `withFrameMillis`, `graphicsLayer`, `BlurEffect`, clip, PathMeasure draw) | ⚠️ **written, not compiled**: Maven Central and Google Maven were blocked from both sandboxes | `lab/kmp/src/composeUi/...` |
| Device frame pacing on Android/iOS | ⚠️ **not measured**: no device, emulator or simulator available | — |
| Raster cost proxy (Skia = the engine under Skiko on iOS/desktop; Android hwui is Skia-based) | ✅ measured on CPU raster at 1080×1920. GPU on device will be much faster; use the numbers for **ranking** effects, not as absolute device times. | `lab/out/skia-bench.json` |

### Skia raster cost (ms/frame, CPU, 1080×1920)
| Scene | p50 | p95 | Verdict |
|---|---:|---:|---|
| 12 text lines + hero: transform + alpha | 4.2 | 4.7 | cheap |
| clip reveal on hero | 3.4 | 4.4 | cheap |
| shimmer gradient pass | 10.3 | 11.8 | medium |
| blur on 4 text lines (animating radius) | 25.8 | 70.3 | expensive |
| 3 full-frame radial gradients + 90 particles | 96.1 | 106 | very expensive: pre-render |
| full-screen blur | 180 | 197 | forbidden per frame |

### Web reference playback (headless Chromium, software raster)
- 13 styles at 60 fps with 0% jank at 1× CPU.
- At **4× CPU throttle**, all are still 60 fps except the procedural gradient + particles scene: 30 fps, 57% janky frames.
- JS evaluate + apply cost p95 is ≤1.6 ms at 4×.
- Caveat: rAF intervals exclude compositor/raster time in headless mode.

## 3. Library landscape (as checked 2026-11-05)
| Option | Platforms | Fit | Status |
|---|---|---|---|
| Compose animation APIs (`Animatable`, `updateTransition`, `rememberInfiniteTransition`, `spring`, `tween`, `keyframes`, `CubicBezierEasing`) | Android + iOS via Compose Multiplatform | the foundation of the binding | 📄 Android docs |
| **Compottie** `io.github.alexzhirkevich:compottie` (+ `-lite`, `-dot`, `-resources`) | Android, iOS, JVM, macOS, web; own multiplatform renderer since v2 | Lottie playback in CMP | 📄 README. Supported: shapes, trim paths, masks (add/subtract/intersect), alpha mattes, blur, text, expressions, dotLottie. **Not** supported: luma mattes, feather masks, stroke/tint effects, text-on-path. ⚠️ not run here. |
| Airbnb lottie-android / lottie-ios | native each | needs expect/actual wrappers | 📄 |
| Rive | official runtimes: Android, Apple, web, Flutter, React/RN, C++. **No official KMP.** | | 📄 rive.app/features |
| Rive-CMP (muazkadan) | community CMP wrapper (Android, iOS, web, desktop) | risky dependency | 📄 listing; ⚠️ not run |

## 4. Architecture
```
presets.json  (shared with web editor / dashboard)
   │ codegen (lab/kmp/codegen.js)  or runtime JSON (kotlinx.serialization)
commonMain:  Easings · Preset · Track · Scene · MotionEngine.layout/evaluate   ← pure, testable
composeMain: rememberSceneClock (withFrameMillis) → derivedStateOf{evaluate} → Modifier.motion(key)
             drawProgressPath (PathMeasure) · loops are just t%period
platform:    expect fun isReduceMotionEnabled()  (Android animator scale / iOS UIAccessibility)
export:      deterministic: evaluate(t) per frame → offscreen render → encoder (same code path = preview/export parity)
```
- **Independent phases:** entrance, emphasis, loop and exit are separate tracks on the same element. The engine composes them (opacity/scale ×, offsets +).
- **Timeline:** GSAP-style positions; labels for pages.
- **Preview = export:** the engine is a pure function of t. The ✅ web renderer already exports MP4 by seeking frame by frame. The KMP export should use the same evaluate(t) with an offscreen canvas.
- **Performance rules for the binding:**
  1. Read animated values only inside `graphicsLayer {}` / `drawWithContent {}`, so there is no recomposition per frame.
  2. One `evaluate()` per frame per scene, not per element.
  3. Blur only via `renderEffect`. On Android it is API 31+, so fall back to opacity below 31 (📄 general knowledge; verify).
  4. Cache static layers.
  5. Particles/gradients are pre-rendered video or Lottie, not per-frame procedural, on low-end devices.

## 5. To finish on a real machine (checklist)
1. Add `commonMain` files to the Nayroz KMP module. Run `ParityTest` as a common test on Android (JVM) and iOS (K/N).
2. Compile `MotionCompose.kt`. Render the luxury scene on a mid-range Android (e.g. API 30 and 34) and an iPhone.
3. Measure with Android Macrobenchmark `FrameTimingMetric` and Xcode Instruments (Core Animation FPS / hitches) for all 13 styles at 1×.
4. Test Compottie with one sparkle Lottie on both platforms.
5. Check that reduced-motion settings on both OSes switch the engine flag.
