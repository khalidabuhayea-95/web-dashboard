# Easing and Timing Guidelines

All easings below exist in `lab/engine/motion-engine.js` and in Kotlin `Easings.named`. They are ✅ parity-tested: 25 easings × 21 samples, max error 5e-10.

## 1. Easing catalogue
| Name | Definition | Feel | Use |
|---|---|---|---|
| linear | t | mechanical | loops (rotation, saw shimmer), typewriter |
| ease | cubic-bezier(.25,.1,.25,1) | CSS default | generic |
| sineInOut | cubic-bezier(.37,0,.63,1) | gentle | draw-on strokes, crossfades, ambient |
| cubicOut / cubicIn / cubicInOut | power 3 | standard | fades, small moves, exits (In) |
| quartOut / quartInOut | power 4 | confident | slides, pushes, panels |
| quintOut | power 5 | sharp stop | |
| expoOut | 1−2^(−10t) | fast start, long soft landing | **titles, mask reveals, zoom**. 👁 This matches the exponential energy decay measured in Jitter "The Stack: Sale" after each cut. |
| expoInOut | | dramatic | cinematic transitions |
| circOut | | | |
| backOut (1.70) / backOutSoft (1.1) / backOutStrong (2.4) | overshoot | playful / subtle / bouncy | pop, badges (backOut), 3D flip (Soft) |
| elasticOut (1, .35) | oscillating | cartoon | kids only |
| bounceOut | Penner bounce | | stickers dropping in |
| standard | cubic-bezier(.2,0,0,1) | Material 3 standard | UI |
| emphasizedDecelerate | (.05,.7,.1,1) | M3 entering | UI entrances |
| emphasizedAccelerate | (.3,0,.8,.15) | M3 exiting | exits |
| **silk** | cubic-bezier(.22,.61,.36,1) | very soft landing | **luxury invitations**: names, hero, drift |
| springGentle (ζ=1, k=120) | critically damped | no overshoot | luxury scale-ins |
| springSoft (ζ=.75, k=200) | slight overshoot | | cards |
| springBouncy (ζ=.5, k=300) | visible overshoot | | sale badges |
| springSnappy (ζ=.85, k=600) | quick | | UI toggles |
| steps(n) | stepped | glitch, counters | |
| cubicBezier(a,b,c,d) / spring(ζ,k) | custom | | per-track override |

**Equivalences** (📄 GSAP docs; analytic forms verified by implementation):
- GSAP power1 = quad, power2 = cubic, power3 = quart, power4 = quint.
- GSAP's default ease is `power1.out`.

**Springs:**
- Analytic damped oscillator with mass 1.
- `dampingRatio` and `stiffness` mean the same as Compose `spring()`.
- The duration is derived from the time to settle to 0.1%. It is not chosen.

## 2. Picking an ease
- **Entering → ease-out.** The element arrives and decelerates.
- **Leaving → ease-in.** It accelerates away.
- **Moving between on-screen positions → ease-in-out.**
- **Loops:**
  - sine for float and sway.
  - linear for rotation and shimmer bands.
  - triangle for Ken Burns ping-pong.
  - pulse (0.5−0.5cos) for breathe and twinkle, so the loop starts and ends at rest.
- **Overshoot (back/spring):** only on small elements in playful or sale categories. Never on Arabic calligraphy heroes, where it looks cheap.

## 3. Durations
| Element | Normal | Luxury | Energetic |
|---|---|---|---|
| icon / badge | 300–500 | 600–900 | 250–450 + overshoot |
| text line | 500–800 | 900–1400 | 400–600 |
| hero title | 700–1000 | 1200–1600 | 500–700 |
| image / card | 600–900 | 1000–1400 | 500–700 |
| full-screen transition | 600–900 | 900–1200 | 400–600 |
| stroke draw-on | 1200–1800 | 1600–2600 | 800 |

👁 **Canva measured:**
- Entire entrance choreography finished at 0.93–1.53 s in the burst-then-hold previews (wedding, coffee, business, coming soon, headphones).
- Multi-page templates switch pages about every 4–5 s.

## 4. Stagger
- Words (Arabic): 100–180 ms. Lines: 150–250 ms. List rows: 120–350 ms. Letters (Latin only): 30–70 ms.
- **Overlap rule:** start the next role when the previous is ~60–70% complete (`at: ">-300"` for a 900 ms entrance).
- **Direction:** `from: start` follows reading order. RTL start = right.
  - `center` is for symmetric lockups.
  - `edges` is for closing frames.
- **Total entrance budget:** ≤ 2.5 s for social, ≤ 4 s for invitations (calm), ≤ 1.5 s for ads.

## 5. Timeline position syntax (GSAP subset, ✅ JS + Kotlin)
| Position | Meaning |
|---|---|
| `1200` | absolute ms |
| `">"` (default) | at end of previous track |
| `"<"` | with previous track |
| `"<300"` | 300 ms after previous started |
| `">-300"` | 300 ms before previous ends |
| `"+=200"` / `"-=200"` | relative to timeline end |
| `label` / `label+=n` | label positions |

Loop tracks are ambient: they never move the `<`/`>` pointers. A bug was found and fixed for this in the study.

## 6. Loops
- Period: sparkle 1.5–2.3 s (desync each sparkle), breathe 3 s, float 4 s, sway 5–5.6 s, shimmer 3.5 s, gradient 6 s, Ken Burns 16 s, slow spin 20–60 s.
- **Desync:** give siblings different periods (1500/1800/2300) so they never pulse together.
- **Amplitude:**
  - float ≤ 12 px @1080.
  - sway ≤ 3°.
  - breathe ≤ 4%.
  - Apple HIG: avoid sustained ~0.2 Hz oscillation at large amplitude (a 5 s sway is 0.2 Hz, so keep it at ≤3°).
- **Seamless proof:** ✅ `gradient-particles-loop` frame(0) vs frame(6000) has pixel diff 0.0, while frame(0) vs frame(3000) has 49.1 (control).
