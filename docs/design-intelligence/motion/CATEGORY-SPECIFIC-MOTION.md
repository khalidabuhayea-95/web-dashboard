# Category-Specific Motion Systems

Each system locks an ease family, a duration multiplier and the allowed presets. Everything else follows MOTION-DESIGN-SYSTEM.

| Category | Character | Eases | Durations | Allowed entrances | Loops | Forbidden | Built ✅ |
|---|---|---|---|---|---|---|---|
| **Luxury wedding invitation** | elegant, controlled, slow, nothing bounces | silk, expoOut, sineInOut, springGentle | ×1.5–2 (names 1.4 s, hero 1.4 s) | mask-reveal-up, settle-in, drift-in, blur-in (words), fade-up ≤16 px, draw-stroke | twinkle (desynced), shimmer-loop, float ≤8 px | pop, bounce, elastic, glitch, rise on bg (Ali), exits, lanterns | luxury-wedding-ar |
| **Arabic / Islamic** | calm, geometric, reverent | sineInOut, silk, linear (spin) | ×1.5 | draw-stroke (patterns), settle-in, word fade-up | spin-slow (≥60 s), sway ≤3° (lanterns: **Ramadan only**), shimmer | per-letter split, overshoot on verses, fast motion on Quranic text; verse text never blurs past legibility | islamic-ramadan, arabic-word-stagger |
| **Modern social post** | crisp, rhythmic | expoOut, quartOut, backOut (small) | ×1 | mask reveals, word stagger, slide, pop | float, breathe | >2.5 s total entrance | — (uses the sale-pop and snappy-stretch patterns) |
| **Product ad** | premium focus on the product | quartOut, expoOut, springSoft | ×1–1.2 | product fade-up 100+ px, zoom-in, mask title | ken-burns bg, float product, parallax | text over the product, heavy blur | product-kenburns |
| **Business promo / sale** | energetic, overshoot ok | backOut, springBouncy, expoOut, steps | ×0.7 | stretch-snap, pop-spring, count-up, slide | breathe badge, pulse CTA | slow fades (feel sleepy) | sale-pop |
| **Educational** | clear, sequential, low amplitude | cubicOut, standard | ×1 | slide-in-start rows (stagger 300–350), fade-down heading, wipe progress | none or minimal | decorative loops that distract | education-steps |
| **Event announcement** | bold, countdown, rhythm | expoOut, backOut, steps | ×0.8 | zoom-in, stretch-snap, wipe | twinkle, light sweep | | countdown, snappy-stretch |
| **Cinematic promo video** | dramatic, letterboxed | expoInOut, cubicIn exits | ×1.2 | glitch-in (tech), dissolve, wipe, light leak | slow push-in (scale 1→1.05 over the shot) | bouncy eases | cinematic-glitch |

## Observed reference patterns (👁)
- **Wedding (Canva, 9 previews):** entrance 0.9–1.5 s, then hold or soft ambient. Band onsets run top→bottom at 0.07–0.13 s steps. Two had continuous ambient (floral/particles), one a page switch at 4–5 s.
- **Ramadan (Canva EAGexaZxLYc, EAF-6ooNhFc):** continuous low ambient for the full 8–10 s (swaying lanterns). Text settles by ~0.7 s.
- **Sale (Canva):** high constant energy (EAF9_DxvfFc ≈10, EAGZ1PWVCFo 13–18 for 4 s), or many pop/slide hits up to 8 s (Black Friday).
- **Jitter social (Stack: Sale):** hard cut, then a ~2 s exponential settle of the new layout. Testimonial: a glass card blurs in mid-loop. Orbit: continuous rotation.
- **Wedvite (Rawda):** the front text is static; life comes from the background (light sweep, sparkles, envelope opening).

## Invitation-specific rules (Ali's standing rules)
- Enter only (no exits). Nothing may look clipped at loop end.
- No «ارتقاء»/rise on backgrounds. Lanterns only for Ramadan. Never the word «ملكة».
- Every element role gets a different preset; max two elements share one, and only as a pair.
