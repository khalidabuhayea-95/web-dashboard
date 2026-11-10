# Text Animation Guidelines (Arabic-first)

## 1. Verified Arabic facts ✅
| Test | Result | Evidence |
|---|---|---|
| Split Arabic per **letter** (each letter its own inline-block for transforms) | Letters lose their joining (isolated forms: «محمد» → م ح م د). This holds with and without `direction:rtl`. | `lab/out/frames/arabic-letter-split-test/*.png` |
| Same split with **no paragraph direction** | Order reversed as well (first render) | first render of the same scene |
| Split per **word**, container `direction: rtl` | Shaping intact; units animate in reading order, right → left | `arabic-word-stagger.mp4` |
| Auto rule now in the stage | Any element containing U+0600–06FF gets `direction: rtl` | `lab/demos/stage.html` |
| Skia text without a full shaper (`skia-python` primitive shaper) | Calligraphic font (Aref Ruqaa) rendered unjoined and reversed | `lab/kmp/skia_bench.py` run. On native, Arabic **must** go through the HarfBuzz paragraph pipeline: Compose `Text`/`Paragraph`, never raw glyph drawing. |

**Rules:**
1. Arabic split units are **word** or **line** only.
   - Letter effects (typewriter, per-letter wave) are **Latin only**.
   - For an Arabic "typewriter" feel, use a word stagger of 90–140 ms, or a `wipe-start` clip on the whole line. A clip reveals right→left and keeps every letter connected.
2. Never letter-space connected Arabic. Tracking animations are Latin only. For Arabic, use kashida only as a static, designed choice.
3. Calligraphy heroes (Thuluth, Diwani, Ruqaa):
   - Animate the whole lockup with mask-reveal, settle-in, blur-in or shimmer.
   - Never split them, never overshoot them, never rotate them more than 2°.
4. Stagger direction:
   - `start` = right in RTL.
   - Names in a pair animate **toward each other**: groom from the right edge moving left (+x → 0), bride from the left (−x → 0).
5. Digits: counters (count-up) use Western digits or a full Arabic-Indic string. Don't mix them mid-animation.

## 2. Text animation catalogue
| Effect | Preset | Arabic? | Notes |
|---|---|---|---|
| Reveal (mask) | mask-reveal-up, wipe-start, wipe-center | ✅ whole line or word | best title effect; cheap (clip) |
| Typewriter | typewriter (unit letter) | Latin only; Arabic → word stagger or wipe-start | ✅ caret blink 530 ms in demo |
| Tracking | (not shipped for Arabic) | ❌ | Latin: letterSpacing 0.3em→0, 900 ms expoOut |
| Split (word/line stagger) | any entrance + `stagger` | ✅ words/lines | |
| Blur | blur-in, settle-in | ✅ | expensive: ≤4 elements, ≤900 ms |
| Pop | pop, pop-spring | ✅ short words/numbers | not for calligraphy |
| Mask (inside shape) | clip + mask image | ✅ | |
| Wave | loop with per-unit phase offset (float + stagger) | Latin letters / Arabic words | keep amplitude ≤6 px |
| Stretch | stretch-snap | Latin bold sans; Arabic display (Lalezar) ✅ works on whole words | |
| Glitch | glitch-in (steps + rgbSplit) | ✅ whole line | cinematic/tech only |
| Shimmer | shimmer-sweep / shimmer-loop | ✅ gold text | one band, ≤ 20% width, ≤ .75 alpha |
| Count-up | count-up | numbers | expoOut 1400 |

## 3. Reading-time rule
- A text element must be fully visible and still for at least **(words × 250 ms) + 500 ms** before any exit.
- Invitations have no exit. Their hold time is the rest of the loop.

## 4. Hierarchy timing template (invitation)
| Order | Role | Entrance |
|---|---|---|
| 1 | bismillah / verse | fade-in 900 |
| 2 | hero lockup | mask-reveal-up 1400 silk |
| 3 | intro sentence | blur-in by word, 110 ms stagger |
| 4 | names (pair) | drift-in toward each other, together |
| 5 | divider | draw-stroke |
| 6 | date → time → venue | fade-up 16 px, 150 ms apart |
| 7 | ambient | twinkle/shimmer loops |

The total is ~4.2 s, then hold.
