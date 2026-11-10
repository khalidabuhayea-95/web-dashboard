# Canva Motion: benchmark

## A. Measurement coverage
| Area | Items | Measured | Observed only | Docs only |
|---|---|---|---|---|
| General (text) | 15 + Block | 16 | — | — |
| Add-ons | 4 | 4 | — | — |
| Photo suggested | 3 | 3 | — | — |
| Photo featured / reveal | 12 | 0 (canvas-rendered) | 12 | — |
| Page styles | 6 + Magic Animate | 1 (بسيط) | 5 + AI | — |
| Transitions | 9 | 4 | 5 | — |
| Motion path | 1 | 0 | 1 | ✓ |
| Video shaders | 4 | 0 | (seen on photo) | ✓ |

## B. Curve-fit quality (RMS on normalised value, lower is better)
| Animation | Best fit | RMS |
|---|---|---|
| Fade (slow / medium / fast) | quadOut | .000 / .001 / .006 |
| Fade exit | quadIn | .001 |
| Rise | quadOut | .001–.005 |
| Wipe | cubicOut | .001 |
| Baseline | expoOut | .001 |
| Breathe scale | linear | .000 |
| Pop | spring ζ .39, ωn 17 | .019 (20 ms phase offset) |
| Dissolve / Slide / Circle wipe | linear | visually exact (constant step) |

## C. Duration accuracy (presets)
- fast 0.408–0.412 s, medium 0.993–0.998 s, slow 2.912–2.919 s; ±1 frame noise.
- Wipe ≈1.49 s and Pan ≈0.49 s **regardless of preset** (rechecked with a real click).

## D. Applied to INV-T1…T5 (from MOTION-ART-DIRECTION.md)
| Template | Hero primitive | Elements animated | Entrance ends | Self-score /100 |
|---|---|---|---|---|
| T1 | Baseline | 10 groups | ≈3.9 s | 91 |
| T2 | Rise | 7 | ≈3.6 s | 93 |
| T3 | Breathe | 9 | ≈3.9 s | 90 |
| T4 | Blur | 8 | ≈3.6 s | 91 |
| T5 | Succession | 10 | ≈3.8 s | 92 (after revision) |

Correction from this pass: the dividers set to «المسح سريع» actually run at Canva's fixed 1.49 s (the speed has no effect), as already reflected in the "long Wipe tail" deduction. The scores are unchanged.

## E. Not done
- Device validation (Android / iOS).
- The 20-template run (Ali set the scope to T1–T5).
- Curves for shader / reveal effects (need video-frame analysis).
- Motion-path curves and the Magic Animate AI output.
