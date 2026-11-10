# Canva Text Animations: measured specs

Method: a rAF recorder on the editor preview (`raw/03-measurements.md`). Units are **design px** (1080-wide page), converted from 0.2865 CSS px per design px. The test box is «أحمد», 300×134 design px.
- **h** = element height, **W** = element width.
- Durations are for speed **medium** unless noted: fast ≈ 0.41 s, medium ≈ 1.0 s, slow ≈ 2.9 s (Fade, Rise, Pop, Blur, Succession, Baseline).
- Every enter curve below starts at t=0 of the element's start time.

| Animation | Properties (enter) | From → To | Easing (RMS fit) | Duration | Exit |
|---|---|---|---|---|---|
| تلاشي Fade | opacity | 0 → 1 | **quadOut** (.001) | 0.41 / 1.0 / 2.92 s | opacity 1→0, quadIn, ≈0.5 s |
| ارتقاء Rise | translateY + opacity | +80 px (≈0.6h) → 0; 0 → 1 | quadOut | as Fade | mirror (not needed) |
| تأرجح Pan | translateX + opacity | +80 px → 0; 0 → 1 | quadOut | **≈0.5 s fixed** (speed has no effect) | — |
| انبثاق Pop | scale (uniform) | 0 → 1, damped spring | spring: peak **1.27** at ~17%, undershoot 0.933 at ~37%, settles ±0.2% by ~75% | 0.41 / 1.0 / 2.92 s | — |
| المسح Wipe | clip container translateX −W, content +W (counter) | edge sweeps R→L | **cubicOut** (.001), quartiles .57/.87/.98 | **≈1.49 s fixed** | cubicIn ≈0.49 s |
| تمويه Blur | opacity + blur | 0→1; blur 32 px (≈0.24h) → 0 | quadOut | as Fade | — |
| التتابع Succession | scale + opacity + blur | 0.75→1; 0→1; 24 px→0 | quadOut, one curve | as Fade | — |
| Baseline | content translateY inside a clip | +1.0h → 0 (masked) | **expoOut** (.001), quartiles .82/.97/1.0 | 0.41 / 1.0 s | Y 0→−1.0h, sineIn, 0.3 s |
| ظهور بطيء Breathe | scale + opacity | 0.90→1.03 over the whole page; opacity 0→1 in the first 0.45 s | scale **linear**; fade ease-out | the whole page | none |
| انجراف Drift | translateX | +0.18W → −0.09W (≈50%) → 0 | S-curve with overshoot | the whole page | none |
| حركة تكتونية Tectonic | translateX + opacity | −0.12W → +0.06W → 0; opacity linear over 0.5 s | S-curve | the whole page | none |
| دوران Tumble | translateX + rotate + opacity | −1326 px (off page) → 0; +41.5°→0; 0.3→1 | cubicOut | ≈0.43 s | +1829 px, −57°, cubicIn 0.49 s |
| نيون Neon | opacity, stepped | 0 .37 .73 1 .32 0 1 0 0 0 0 .02 .32 .72 .92 1 (33 ms steps) | keyframed flicker | ≈0.44 s | 1→0→0.5→0 |
| سجل قصاصات Scrapbook | ty, tx, rotate (held poses) | 3 poses: (−953, +50, +5°) (−426, 0, −4.5°) (−237, +50, +3.5°) → rest | **steps**, ≈165 ms per pose | ≈0.5 s | no change seen |
| سقوط هوائي Stomp | scale + opacity | 5.4 → 1.2 accelerating, then snap to 1.0; opacity 0→1 in 0.2 s (ease-in) | cubicIn-like + snap | ≈0.5 s | opacity quadOut 0.49 s |
| Block (Suggested) | colour block translateX + text visibility | block +W → −W; text switches on mid-sweep | cubicInOut | ≈0.45 s | same |

## Pop spring grid (medium, 33 ms steps)
`0 .255 .623 .959 1.175 1.269 1.258 1.186 1.094 1.01 .956 .933 .935 .953 .976 .997 1.008 1.017 1.017 1.013 1.007 1.002 .998 .996 .996 .997 .998 1`
- Fit: damped spring ζ ≈ 0.39, ω_n ≈ 17 rad/s at medium (first peak ≈0.21 s, undershoot 0.927 predicted vs 0.933 measured) (see CANVA-MOTION-IMPLEMENTATION.md).

## Add-on effects (stack on the main animation)
| Effect | Measured |
|---|---|
| تدوير Rotate | linear rotation ≈17.7°/s (one turn ≈20 s), CW default |
| ومض Flicker | opacity modulation, dips of ~25%, ~0.5 s irregular rhythm |
| تقليص وتمديد Pulse | uniform scale 0.85↔1.15, period ≈0.9 s |
| اهتزاز Wiggle | jitter ±15 px X/Y, rotation −7…+11°, irregular |

## Findings that matter for design
1. **Rise and Pan use a fixed distance (80 design px)**, not a share of the element: the same offset was measured on a 130 px image. Large heroes therefore move relatively less.
2. **Wipe and Pan ignore the speed presets.** This was retested with a real mouse click: the selection stays on متوسط. Treat Wipe as a 1.5 s cubicOut and Pan as a 0.5 s quadOut.
3. **Three families cover almost everything:** quadOut (Fade, Rise, Pan, Blur, Succession), expoOut (Baseline) and cubicOut (Wipe, Tumble). The spring (Pop) and the stepped ones (Neon, Scrapbook) are the outliers.
4. Continuous animations (Breathe, Drift, Tectonic) have **no enter/exit and no speed**. They span the element's time on the page.
5. Not measured: Succession's per-word stagger (needs a multi-word box), and Scrapbook's exit (no change recorded).
