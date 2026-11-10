# Transition Library

A transition is a pair of tracks: an exit on page A and an entrance on page B, placed with `at: "<"` or an overlap.

✅ All rows marked built are in `lab/out/transitions.mp4` (scene `transitions`).

| Transition | A (out) | B (in) | Duration / ease | Status | Use |
|---|---|---|---|---|---|
| Crossfade | (none, B covers) | fade-in | 700 sineInOut | ✅ | calm, luxury, slideshow |
| Push (RTL) | push-out-end (x 0→−W) | push-in-start (x W→0) | 800 quartInOut | ✅ fixed: the first version used slide presets with opacity, which exposed the panel underneath mid-push. Push halves must stay opaque. | stories, carousels |
| Wipe | — | wipe-start (clip 100→0, RTL from right) | 900 quartInOut | ✅ | editorial, Arabic reading direction |
| Zoom | shrink-out 500 | zoom-in 800 @<200 | expoOut | ✅ | energetic, reels |
| Iris | — | iris-in (4-side clip + 1.1→1) | 1100 expoOut | ✅ | reveal a photo/frame |
| Split strips | B in N vertical strips, each wipe-center, stagger 60 | | 900 | 👁 Jitter "The Edit: Split Reveal" | fashion/product |
| Spin | A rotate 0→90 + fade, B −90→0 | | 700 | ⚠️ not built (presets support rotate) | playful only |
| Match cut | the same element keeps position/scale across pages; only the surroundings change | | 0–300 | 👁 Jitter "The Stack: Sale" (hard cuts with an energy spike, then a 2 s ease-out settle of the new content) | promos |
| Morph | shared element interpolates bounds/shape | | 600–900 | ⚠️ not built. Compose has SharedTransitionLayout (📄 general knowledge, not tested here). Canva calls it "Match & Move". | app UI, carousels |
| Hard cut | none | content entrance | 0 | 👁 Jitter, Canva multi-page | rhythm edits |

## Rules
- Duration: 600–900 ms (luxury up to 1200). Never above 1.2 s, because people wait.
- RTL: «next» comes from the **right** (push-in-start). Back/previous comes from the left.
- Only one expensive effect at a time. No blur on full-screen transitions: 180 ms/frame CPU raster ✅ measured.
- Reduced motion: every transition becomes a 200 ms crossfade ✅ engine behaviour.
- Page rhythm: 👁 Canva multi-page previews switch every ~4–5 s.
