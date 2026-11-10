# Canva Motion: implementation proposal for the Nayroz engine (KMP)

Status: **proposal only.** The Nayroz repository was not connected in this session, so no code was written or run in the engine. Values come from `raw/03-measurements.md`.

## 1. Architecture: three layers
1. **Direction** (identity per template): easing family, direction, speed, stagger, ambient budget, enter-only flag.
2. **Choreography**: element roles + reading order + units → start times (phases).
3. **Primitives**: the measured Canva curves below. They are pure functions of normalised time `t ∈ [0,1]` and element size.

Never pick an animation per element in isolation. The choreographer assigns from the direction.

## 2. Easing functions (shared `commonMain`)
```kotlin
object Ease {
    fun linear(t: Float) = t
    fun quadOut(t: Float) = 1f - (1f - t) * (1f - t)
    fun quadIn(t: Float) = t * t
    fun cubicOut(t: Float) = 1f - (1f - t).pow(3)
    fun cubicIn(t: Float) = t * t * t
    fun cubicInOut(t: Float) = if (t < .5f) 4f * t * t * t else 1f - (-2f * t + 2f).pow(3) / 2f
    fun expoOut(t: Float) = if (t >= 1f) 1f else 1f - 2f.pow(-10f * t)
    fun sineIn(t: Float) = 1f - cos(t * PI.toFloat() / 2f)
    fun sineInOut(t: Float) = -(cos(PI.toFloat() * t) - 1f) / 2f
    // Pop: damped spring fitted to Canva grid (ζ≈0.39, ωn≈17 rad/s at 1.0 s; RMS .019 vs measured)
    fun canvaPop(t: Float, durationSec: Float): Float {
        val z = 0.39f; val wn = 17f * (1.0f / durationSec)   // scale with speed preset
        val wd = wn * sqrt(1 - z * z); val s = t * durationSec
        return 1f - exp(-z * wn * s) * (cos(wd * s) + (z / sqrt(1 - z * z)) * sin(wd * s))
    }
}
```

## 3. Primitives (enter; sizes in design px, h = element height, W = element width)
| Id | Canva | Transform over eased p = E(t) | Easing | Medium duration |
|---|---|---|---|---|
| `fade` | تلاشي | alpha = p | quadOut | 1.0 s |
| `rise` | ارتقاء | ty = 80·(1−p), alpha = p | quadOut | 1.0 s |
| `pan` | تأرجح | tx = ±80·(1−p), alpha = p | quadOut | 0.5 s |
| `blur` | تمويه | blur = 32·(1−p), alpha = p | quadOut | 1.0 s |
| `succession` | التتابع | scale = .75+.25p, blur = 24·(1−p), alpha = p | quadOut | 1.0 s |
| `baseline` | Baseline | clip to bounds; content ty = h·(1−p) | expoOut | 1.0 s |
| `wipe` | المسح | clip rect grows from the reading-start edge: visibleW = W·p | cubicOut | 1.5 s |
| `pop` | انبثاق | scale = canvaPop(t) | spring | 1.0 s |
| `breathe` | ظهور بطيء | scale = .90+.13t (linear, whole page); alpha = quadOut(min(1, t·page/0.45 s)) | linear | page |
| `flicker` (add-on) | ومض | alpha·(1 − 0.25·noise(t, ~2 Hz)) | loop | page |

Speed presets: fast = 0.41×, medium = 1.0×, slow = 2.92× (except wipe/pan, which are fixed in Canva).

## 4. Choreographer (rules from MOTION-ART-DIRECTION.md)
```
input: elements[role, readingIndex, unitId], direction
phase 1  opening line        start 200 ms
phase 2  hero                start 300–500 ms   (the only distinctive primitive)
phase 3  support             reading order; units share one start;
                              stagger 150–250 ms inside a sequence, 400–500 ms between phases
phase 4  ambient             max 1 element (flicker / breathe)
phase 5  hold                entrance ends ≤ 3.9 s on a 5 s page
background: never animated; exits: none
```

## 5. Platform mapping
| Need | Android (Compose) | iOS (SwiftUI / Compose MP) |
|---|---|---|
| transform / alpha | `graphicsLayer { translationY; alpha; scaleX }` | Compose MP same API; native: `.offset/.opacity/.scaleEffect` |
| blur | `Modifier.blur()` (API 31+); below that, fall back to fade only | Compose MP `blur` (Skia), native `.blur(radius:)` |
| masked baseline / wipe | `clipToBounds()` + inner offset; `drawWithContent { clipRect }` | same in Compose MP |
| timing | one `Animatable` per element driven by a page clock (`withFrameNanos`) | same |
| reduced motion | Android `Settings.Global.ANIMATOR_DURATION_SCALE == 0`, or the app setting → fade only, max 200 ms, no ambient | iOS `UIAccessibility.isReduceMotionEnabled` → same |

## 6. Editability (template JSON)
```json
{ "motion": { "direction": "soft-arrival", "enterOnly": true,
  "elements": [ { "id": "hero", "role": "hero", "primitive": "baseline", "startMs": 300 },
                { "id": "names", "role": "names", "unit": "names", "primitive": "rise", "startMs": 1800 } ] } }
```
- The designer can override `primitive` and `startMs`; the choreographer fills in the rest.
- Values are design px, so they scale with the page.

## 7. Next steps (need Ali)
1. Connect the Nayroz KMP folder, then add `motion/` in `commonMain`.
2. Port the 10 primitives and the choreographer.
3. Golden test: render T1–T5 at 30 fps and compare the onsets and curves against `raw/03-measurements.md` (tolerance ±1 frame).
4. Run on an Android and an iOS device.
