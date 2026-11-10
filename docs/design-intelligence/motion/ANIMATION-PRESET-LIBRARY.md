# Animation Preset Library

**Source of truth:** `lab/engine/presets.js`. The same data is exported to `lab/engine/presets.json` and generated into Kotlin as `PresetLibrary.kt`, using `lab/kmp/codegen.js`. Edit the JS only, then regenerate.

**Status:**
- ✅ Every preset below is executed by the JS engine and the Kotlin engine (parity 0 failures).
- ✅ 30+ of them are used in the 13 rendered styles.

## Preset schema
```json
{
  "id": "mask-reveal-up", "phase": "entrance|emphasis|loop|exit", "cat": "mask",
  "targets": ["text","image"],
  "duration": 900, "ease": "expoOut",
  "params": { "distance": { "default": 30, "min": 0, "max": 120 } },
  "from": { "clipT": 100, "y": "$distance" }, "to": { "clipT": 0, "y": 0 },
  "keyframes": [ { "t": 0.55, "props": { "scaleY": 1.35 }, "ease": "expoOut" } ],
  "loop": { "period": 3000, "wave": "sine|saw|tri|pulse", "props": { "scale": [1, 0.04] } }
}
```
- **Properties:**
  - opacity
  - x, y: px @1080w. The renderer scales them to the canvas.
  - scale, scaleX, scaleY
  - rotate, rotateX, rotateY (deg)
  - skewX
  - blur (px)
  - clipT/R/B/L (% inset)
  - draw (0–1 stroke)
  - shimmer (band position)
  - brightness
  - rgbSplit (px)
  - value (0–1 for counters)
- **Track overrides:** `params` on a track can override any declared param and also the generic ones: `duration`, `ease`, `period`, `amplitude`.
- **Units and stagger:** `units` (split count) + `stagger {each, from: start|end|center|edges}`.
- **Performance class per property:**
  - transform/opacity/clip = **cheap**.
  - draw = cheap (path segment).
  - shimmer = medium (gradient pass).
  - blur/rgbSplit = **expensive** (see benchmark).

## All presets (generated from code)
| id | phase | category | targets | duration ms | ease | from → to / keyframes / loop | params | notes |
|---|---|---|---|---:|---|---|---|---|
| fade-in | entrance | fade | any | 600 | cubicOut | {opacity:0} → {opacity:1} |  |  |
| fade-up | entrance | slide | any | 700 | expoOut | {opacity:0, y:$distance} → {opacity:1, y:0} | distance=40 [0..200] |  |
| fade-down | entrance | slide | any | 700 | expoOut | {opacity:0, y:-$distance} → {opacity:1, y:0} | distance=40 [0..200] |  |
| slide-in-start | entrance | slide | any | 800 | quartOut | {opacity:0, x:$distance} → {opacity:1, x:0} | distance=120 [0..1080] | RTL start = from the right (+x). Mirror for LTR. |
| slide-in-end | entrance | slide | any | 800 | quartOut | {opacity:0, x:-$distance} → {opacity:1, x:0} | distance=120 [0..1080] |  |
| drift-in | entrance | slide | text, image | 1400 | silk | {opacity:0, x:$distance} → {opacity:1, x:0} | distance=24 [0..80] | Long, low-distance: luxury. |
| scale-in | entrance | scale | any | 600 | cubicOut | {opacity:0, scale:$fromScale} → {opacity:1, scale:1} | fromScale=0.85 [0..1] |  |
| settle-in | entrance | scale | text, image | 1600 | silk | {opacity:0, scale:1.06, blur:6} → {opacity:1, scale:1, blur:0} |  | Large -> 1 with blur clearing. Elegant hero. |
| zoom-in | entrance | scale | image, shape | 900 | expoOut | {opacity:0, scale:1.6} → {opacity:1, scale:1} |  |  |
| pop | entrance | scale | icon, badge, shape, text | 550 | backOut | {opacity:0, scale:0.4} → {opacity:1, scale:1} |  |  |
| pop-spring | entrance | scale | icon, badge | 900 | springBouncy | {opacity:0, scale:0.3} → {opacity:1, scale:1} |  |  |
| rise | entrance | slide | any | 900 | expoOut | {opacity:0, y:$distance} → {opacity:1, y:0} | distance=80 [0..400] | Ali: never on backgrounds. |
| bounce-in | entrance | bounce | icon, badge, sticker | 900 | bounceOut | {opacity:1, y:-300} → {y:0} |  |  |
| blur-in | entrance | blur | text, image | 900 | cubicOut | {opacity:0, blur:$radius} → {opacity:1, blur:0} | radius=16 [0..40] |  |
| mask-reveal-up | entrance | mask | text, image | 900 | expoOut | {clipT:100, y:$distance} → {clipT:0, y:0} | distance=30 [0..120] | Clip from top edge + slight rise: classic title reveal. |
| wipe-start | entrance | mask | any | 1000 | quartInOut | {clipL:100} → {clipL:0} |  | RTL: reveals right->left (clipL shrinks). |
| wipe-center | entrance | mask | line, divider, image | 900 | expoOut | {clipL:50, clipR:50} → {clipL:0, clipR:0} |  |  |
| iris-in | entrance | mask | image, frame | 1100 | expoOut | {clipT:50, clipB:50, clipL:50, clipR:50, scale:1.1} → {clipT:0, clipB:0, clipL:0, clipR:0, scale:1} |  |  |
| draw-stroke | entrance | draw | path, ornament, divider | 1600 | sineInOut | {draw:0} → {draw:1} |  |  |
| flip-in-y | entrance | 3d | card, image | 1000 | backOutSoft | {opacity:0, rotateY:-90} → {opacity:1, rotateY:0} |  |  |
| stretch-snap | entrance | stretch | text | 700 | per-kf | kf: 0{scaleY:0, opacity:1} → 0.55{scaleY:1.35}/expoOut → 1{scaleY:1}/backOut |  | Jitter "Snappy Text Stretch" style. |
| typewriter | entrance | text | text | 1 | linear | {opacity:0} → {opacity:1} |  | Per-unit instant-on; stagger.each = typing speed. Latin only. Arabic: unit=word. |
| glitch-in | entrance | advanced | text, image | 700 | per-kf | kf: 0{opacity:0, rgbSplit:0, x:0} → 0.15{opacity:1, rgbSplit:14, x:-12}/steps(2) → 0.3{rgbSplit:-10, x:10}/steps(2) → 0.45{rgbSplit:6, x:-4}/steps(2) → 0.7{rgbSplit:0, x:0}/cubicOut → 1{rgbSplit:0, x:0} |  |  |
| count-up | entrance | text | number | 1400 | expoOut | {value:0} → {value:1} |  | Renderer maps value 0..1 to the target number. |
| pulse-once | emphasis | scale | badge, cta | 600 | per-kf | kf: 0{scale:1} → 0.4{scale:1.12}/cubicOut → 1{scale:1}/cubicInOut |  |  |
| wiggle | emphasis | rotate | icon, cta | 700 | per-kf | kf: 0{rotate:0} → 0.2{rotate:-8} → 0.4{rotate:7} → 0.6{rotate:-4} → 0.8{rotate:2} → 1{rotate:0} |  |  |
| shimmer-sweep | emphasis | light | text, gold | 1600 | sineInOut | {shimmer:-0.3} → {shimmer:1.3} |  | Light band crossing gold text once. |
| float | loop | loop | object, icon | ∞ | — | loop period 4000 sine: y=0±-12 | amplitude=1 [0..3] |  |
| breathe | loop | loop | object, seal, badge | ∞ | — | loop period 3000 pulse: scale=1±0.04 | amplitude=1 [0..3] |  |
| sway | loop | loop | sprig, lantern, flower | ∞ | — | loop period 5000 sine: rotate=0±3 | amplitude=1 [0..3] | Pivot at top for lanterns, bottom for sprigs. |
| twinkle | loop | loop | sparkle, star | ∞ | — | loop period 1800 pulse: opacity=1±-0.75, scale=1±-0.25 | amplitude=1 [0..1] |  |
| spin-slow | loop | loop | ornament, star | ∞ | — | loop period 20000 saw: rotate=0±360 |  |  |
| shimmer-loop | loop | loop | gold text | ∞ | — | loop period 3500 saw: shimmer=-0.3±1.6 |  | Band exits frame before wrapping => seamless. |
| ken-burns | loop | image | image, background | ∞ | — | loop period 16000 tri: scale=1.04±0.08, x=0±-20 |  | Triangle wave = ping-pong; seamless. |
| parallax-drift | loop | image | layer | ∞ | — | loop period 10000 sine: x=0±16 | amplitude=1 [-3..3] | Different amplitude per depth layer. |
| push-in-start | entrance | transition | page, panel | 800 | quartInOut | {x:$distance} → {x:0} | distance=1080 |  |
| push-out-end | exit | transition | page, panel | 800 | quartInOut | {x:0} → {x:-$distance} | distance=1080 |  |
| fade-out | exit | fade | any | 500 | cubicIn | {opacity:1} → {opacity:0} |  |  |
| slide-out-end | exit | slide | any | 600 | emphasizedAccelerate | {opacity:1, x:0} → {opacity:0, x:-$distance} | distance=120 |  |
| shrink-out | exit | scale | any | 450 | cubicIn | {opacity:1, scale:1} → {opacity:0, scale:0.6} |  |  |
| dissolve-out | exit | blur | text, image | 700 | cubicIn | {opacity:1, blur:0} → {opacity:0, blur:14} |  |  |

## Professional combinations (recipes)
A recipe is a list of tracks. Every recipe below was **built and rendered** ✅. The scene IDs refer to `lab/demos/scenes.js`, and the videos are in `lab/out/`.

| Recipe | Tracks (role: preset @ position) | Scene |
|---|---|---|
| **Luxury Arabic invitation** | frame: draw-stroke 1800 @0 → bismillah: fade-in 900 @300 → hero: mask-reveal-up 1400 silk @600 → hero shimmer-loop 3.5 s @2200 → intro words: blur-in r10, stagger 110 @>-500 → groom drift-in +40 / bride drift-in −40 (toward each other) @>-200 → «&» fade-in @<400 → divider draw-stroke 1200 → date/venue fade-up 16 px stagger 150 → sparkles fade-in then twinkle (periods 1.5/1.8/2.3 s, desynced) | luxury-wedding-ar |
| **Arabic verse reveal** | words fade-up 24 px, stagger 180 from start (= right) → reference blur-in r8 stagger 120 | arabic-word-stagger |
| **Islamic geometric** | star pattern draw-stroke 2600 → spin-slow (60 s period) · lanterns fade-down then sway (5.0/5.6 s periods) · title settle-in (1.06→1, blur 6→0) + shimmer-loop · subtitle words fade-up | islamic-ramadan |
| **Sale burst** | headline stretch-snap → badge pop-spring @<250 → badge breathe (amp .8) → price count-up + fade-up → CTA pop → CTA pulse-once → CTA wiggle | sale-pop |
| **Product hero** | bg ken-burns (16 s tri) + glow parallax-drift (−1.5) → product fade-up 120 px quartOut 1400 → product float → title mask-reveal-up → subtitle fade-in | product-kenburns |
| **Festival title (Jitter-style)** | each word stretch-snap (scaleY 0→1.35→1), stagger 70, lines @<210/<250 → exit shrink-out stagger 40 | snappy-stretch |
| **Countdown** | each number zoom-in 450 → dissolve-out 350, 1.2 s per number | countdown |
| **Cinematic opener** | letterbox fade-in → title glitch-in (steps + RGB split) → subtitle wipe-start → light-leak sweep → dissolve-out | cinematic-glitch |
| **Education list** | heading fade-down → rows slide-in-start (60 px, stagger 350) → progress bar wipe-start | education-steps |
| **3D card** | flip-in-y backOutSoft 1200 → float | card-flip-3d |
| **Title (generic professional)** | mask-reveal-up (expoOut, 30 px) + word stagger 80 + blur-in r6 on the subtitle at >-400 | (component of several) |
| **Seamless background** | 3 radial blobs on circular paths + 90 particles with `y = (base − speed·t/T) mod 1`, T = 6 s | gradient-particles-loop |

## Configuration guidance
- **Configurable per element in the editor:** preset, duration (±50%), delay/position, ease (from 6 curated choices per category), distance/amplitude, direction (start/end/up/down), stagger each/from, loop on/off.
- **Locked by the category system:** the ease family and duration ranges. This keeps the motion consistent.
- **Performance:**
  - Avoid blur presets on more than 4 simultaneous elements.
  - Never use blur on full-screen layers.
  - Prefer `clip` reveals over `blur` for big titles.
