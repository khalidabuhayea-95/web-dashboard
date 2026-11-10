# Motion Art Direction: INV-T1…T5 (Canva only)

Applied 2026-11-05. **This file replaces the old rule "every element gets a different animation".** The rule now is **one motion identity per template**: one easing family, one direction, a clear order, and as little movement as the design needs.

## 1. Measured motion families (from Canva's own playback, see `canva-motion/raw/03-measurements.md`)

| Family | Canva animations | Measured curve | Use |
|---|---|---|---|
| **Soft arrival** (base family) | تلاشي (Fade), ارتقاء (Rise: 80 px + fade), تمويه (Blur), التتابع (Succession) | quadOut; 1.0 s at medium | All supporting content |
| **Masked reveal** | Baseline | expoOut; text rises from its own baseline | Calligraphic hero only |
| **Line draw** | المسح (Wipe) | cubicOut | Dividers / lines only |
| **Continuous** | ظهور بطيء (Breathe: linear 0.90→1.03 over the whole page), انجراف (Drift) | linear / S-curve | Max **one** element per design |
| **Ambient loop** | ومض (Flicker add-on) | stepped flicker | Max **one** sparkle element |
| **Spring (rejected for invitations)** | انبثاق (Pop: +27% overshoot), تقليص وتمديد (Pulse), اهتزاز (Wiggle) | overshoot / loop | Sale and playful only. Removed from all five invitations |

## 2. Shared rules (Heritage Luxury identity)
1. **Background never moves.**
2. **Hierarchy order:**
   - Phase 1, opening line (bismillah or praise): 0.2 s.
   - Phase 2, hero: 0.3–0.5 s, with the only distinctive reveal.
   - Phase 3, support in reading order: intro, then the names unit, then the divider, then details.
   - Phase 4: one ambient element at most.
   - Phase 5, hold: entrance done by ~3.8 s, then ≥1.2 s of stillness in a 5 s page.
3. **One direction:** everything that moves, moves **up** (ارتقاء), or simply appears (تلاشي). No sideways moves, no opposite directions, no spins.
4. **Units move together:**
   - names + & = one unit, same start;
   - icon + its text = one unit;
   - date pieces = one unit.
5. **Stagger:** 150–250 ms inside a unit sequence; 400–500 ms between phases. Each element starts when the previous one is ~60–70% done.
6. **One speed:** متوسط (1.0 s) for everything. Wipe is set to سريع, but Canva keeps Wipe fixed at ≈1.5 s (retested 2026-11-05; the speed preset has no effect).
7. Exits: none (enter only).

## 3. Storyboards (as implemented and measured in playback)
Start times in ms; measured onset ±40 ms.

**T1 — عقد قران أسود وذهبي** (direction: minimal-elegant + masked hero)
| t | Element | Animation |
|---|---|---|
| 300 | hero «عقد قران» | Baseline |
| 900 | praise line | تلاشي |
| 1050 | intro line | تلاشي |
| 1100 | sparkles | تلاشي + ومض (only ambient) |
| 1500 | two gold lines | المسح (outward) |
| 1600 | bouquet ornament | تلاشي |
| 1800 | أحمد + & + سارة | ارتقاء (one unit) |
| 2250 | date | ارتقاء |
| 2450 | clock, pin, time, venue | ارتقاء (one row) |
| 2850 | closing line | تلاشي |
| ≥3.9 s | hold | — |

**T2 — عقد قران عاجي** (direction: minimal, reverent verse)
| t | Element | Animation |
|---|---|---|
| 200 | bismillah | تلاشي |
| 500 | verse «وجعل بينكم مودة ورحمة» | ارتقاء |
| 1300 | intro | تلاشي |
| 1800 | names + & | ارتقاء |
| 2200 | divider | المسح |
| 2450 | date | ارتقاء |
| 2600 | venue + pin | ارتقاء |

**T3 — دعوة زفاف ساتان وورد** (direction: cinematic)
- 200: bismillah — تلاشي
- 400: hero — ظهور بطيء, a slow push-in for the whole page; the only continuous motion
- 1300: intro — تلاشي
- Names, stacked and read top to bottom, all ارتقاء:
  - 1800: حمزة
  - 1950: &
  - 2100: سوسن
- 2350: divider — المسح
- 2550: date — ارتقاء
- 2700: venue — ارتقاء
- 2950: wax seal — تلاشي (pop and pulse removed)

**T4 — عقد قران ستار عنابي** (direction: cinematic, soft focus)
| t | Element | Animation |
|---|---|---|
| 200 | bismillah | تلاشي |
| 500 | hero | تمويه |
| 1300 | intro | تلاشي |
| 1400 | star | تلاشي + ومض |
| 1800 | names + & | ارتقاء |
| 2200 | divider | المسح |
| 2450 | date | ارتقاء |
| 2600 | details | ارتقاء |

**T5 — دعوة خطوبة لافندر** (direction: soft romantic)
- 200: bismillah — تلاشي
- 500: hero text — التتابع (scale 0.75 + blur + fade, quadOut)
- 1200: lavender sprig — تلاشي (was انجراف; changed after review)
- 1300: intro — تلاشي
- 1800: ليث — ارتقاء
- 1950: rings — تلاشي (pop and pulse removed)
- 2100: ريم — ارتقاء
- 2350: divider — المسح
- 2550: ٢٥ + الخميس + يونيو — ارتقاء (one row)
- 2800: details — ارتقاء

Hero reveals stay different across the batch: Baseline / ارتقاء / ظهور بطيء / تمويه / التتابع.

## 4. Self-review (100-point rubric; reviewer = me, from measured playback + frames. Not a device test)
| Template | Coherence /25 | Timing /20 | Hierarchy /15 | Easing /15 | Style /15 | Polish /10 | Total |
|---|---|---|---|---|---|---|---|
| T1 | 23 | 18 | 14 | 14 | 14 | 8 | **91** |
| T2 | 24 | 18 | 14 | 15 | 14 | 8 | **93** |
| T3 | 23 | 18 | 14 | 13 | 14 | 8 | **90** |
| T4 | 23 | 18 | 14 | 14 | 14 | 8 | **91** |
| T5 | 22 | 18 | 13 | 14 | 13 | 8 | 88: below 90, revised ↓ |
| T5 (revised: sprig → تلاشي, no continuous motion) | 24 | 18 | 14 | 14 | 14 | 8 | **92** |

Deductions:
- Wipe has a long cubicOut tail: lines finish visually at ~1 s but technically at ~2.6 s (−1 easing/polish in each).
- T3's Breathe hero keeps scaling linearly while everything else eases (−2 easing).
- T5's التتابع hero is a different "feel" (scale + blur) from the rise family, and drifting sprig + Succession compete in the first 1.5 s (−2 coherence, −1 hierarchy, −2 style). Fixed: sprig → تلاشي (no continuous motion), re-scored 92.
- Not done: Android/iOS validation (no Nayroz repo or device access in this session) and the 20-template run (scope set to T1–T5 by Ali).

## 5. Rules for the Nayroz engine (when the repo is connected)
- Separate **direction** (identity: easing family, direction, speed, stagger, ambient budget) from **choreography** (roles → units → phases → start times) from **primitives** (the measured Canva curves).
- Choreographer input: element roles + reading order + units; output: start times using the stagger/phase rules above. Never pick an animation per element in isolation.
- Primitives to implement first (measured): Fade quadOut, Rise (0.6×h + fade) quadOut, Blur (0.24×h blur) quadOut, Succession (0.75 scale + 0.18×h blur) quadOut, Baseline (masked 1.0×h) expoOut, Wipe (counter-translated clip) cubicOut, Breathe (linear 0.90→1.03), Flicker loop.
