# Master Design System (Arabic-first)

This is the entry point. Read it before any design job, then open only the files the job needs.

## Who this is for
Nayroz / web-dashboard templates. They are built in Canva, then imported into the dashboard with the Canva Importer extension. **Arabic is the primary language**: every template is designed Arabic-first and RTL. English is only a secondary accent when the brief asks for it.

## The 7-step workflow (every job)
1. **Brief:** category, audience, purpose, platform/size, language, style. Fill gaps with sensible defaults; never invent real event or business facts. Use placeholders (الاسم، التاريخ، المكان).
2. **References:** pull at least 5 references from `CANVA-REFERENCE-ANALYSIS.md` / `ANDALUSI-REFERENCE-ANALYSIS.md`, or browse new ones. Study the structure, not the surface.
3. **Art direction:** one paragraph covering concept, mood, palette (`COLOR-SYSTEMS.md`), type pair (`FONT-PAIRING-MATRIX.md`), layout pattern (`COMPOSITION-RULES.md`), hero element, background.
4. **Directions:** for a collection, use 3 genuinely different directions (different composition family plus a different style from `VISUAL-STYLE-LIBRARY.md`).
5. **Execute:**
   - Canva holds the layout, every text element and simple shapes.
   - Magnific makes raster art: backgrounds, objects, ornaments. Do not render text inside images (`MAGNIFIC-WORKFLOW.md`).
6. **Inspect:** export a thumbnail or PNG and look at it. Score it with `DESIGN-QUALITY-CHECKLIST.md`. It must reach ≥85 and have no auto-reject issue.
7. **Log:** add an entry to `DESIGN-REVIEW-LOG.md`. Move verified new learnings into the relevant file.

## Non-negotiables
- Arabic text is real, editable Canva text, correctly shaped, RTL, and never baked into an image.
- Hero calligraphy lockups (دعوة زفاف، عقد قران، رمضان كريم…) may be a calligraphy element or a calligraphic font. Body text is always a readable font.
- Keep it to a maximum of 2 font families, plus 1 calligraphic display if needed.
- One dominant element, one secondary, quiet tertiary.
- Use separate elements: background, objects, frames and text each get their own layer. Photo slots must be real Canva frames.
- Ali's standing rules (from prior batches):
  - No "Rise" (ارتقاء) animation on backgrounds.
  - No lanterns outside Ramadan.
  - Do not use the word «ملكة».
  - Animated elements must never look clipped.
  - Keep the original reference wording when recreating a reference.
  - Templates go in Canva first, then into the dashboard.
  - Animation: Canva built-in animations only for elements and text (2026-11-05). Backgrounds: vary between static images and Kling video loops.

## File map
| File | Use it for |
|---|---|
| ART-DIRECTION-GUIDELINES.md | How to form a concept and direction |
| ARABIC-TYPOGRAPHY-SYSTEM.md | Arabic fonts, verified shaping, rules |
| FONT-PAIRING-MATRIX.md | Pairs by category and style |
| COLOR-SYSTEMS.md | Palettes by occasion and industry |
| TEMPLATE-CATEGORY-TAXONOMY.md | Formats, sizes, conventions per category |
| VISUAL-STYLE-LIBRARY.md | 20 styles with their rules |
| COMPOSITION-RULES.md | Layout patterns, grids, RTL composition |
| DESIGN-ASSET-LIBRARY.md | Asset types, sources, licensing |
| CANVA-REFERENCE-ANALYSIS.md | What Canva does and where its Arabic gaps are |
| ANDALUSI-REFERENCE-ANALYSIS.md | What makes Andalusi templates sell |
| MAGNIFIC-WORKFLOW.md | Generating assets, costs, prompts |
| DESIGN-QUALITY-CHECKLIST.md | Scoring and auto-reject rules |
| DESIGN-REVIEW-LOG.md | Every reviewed design and lesson |
| RESEARCH-SOURCES.md | All sources actually accessed |
| ANIMATION-AND-ELEMENTS-SYSTEM.md | Per-element animation rules, element library media IDs, no-repeat rule |

## Tools (verified 2026-11-05)
- **Canva MCP:**
  - generate/create design
  - edit-design: text, fonts, fills, positions, insert_fill, layer
  - export
  - folders
  - read-design
  - Animations are set in the Canva editor UI.
- **Magnific MCP:** image generation (Nano Banana 2.1, Seedream, Z-Image…), remove background, upscale, video (Kling). It uses credits.
- **Claude in Chrome:** browsing Canva and Andalusi, plus Canva editor actions the API lacks.
- **Skills:**
  - pro-graphic-designer: research-led workflow.
  - canvas-art-poster: art-led PNG/PDF.
  - frontend-design: HTML/UI.
  - visual-design-foundations: tokens and UI scales.
  - invitation-video-templates: Ali's Canva/Magnific batch pipeline.

## Benchmark designs (2026-11-05, Canva)
| Design | Canva ID |
|---|---|
| BM01 wedding | DAHaEPWZYwc |
| BM02 IG ad | DAHaEICdkSQ |
| BM03 Ramadan | DAHaEIzvLM8 |
| BM04 business card | DAHaEAUp-qI |
| BM05 typography poster | DAHaEPyO2Qg |
| BM06 restaurant | DAHaEC5hUYc |
| BM07 graduation | DAHaELpDLsQ |
| BM08 infographic | DAHaEDNOReo |
| BM09 YouTube | DAHaENYHJ5w |
| BM10 product | DAHaED_I9Rg |

Scores and lessons are in DESIGN-REVIEW-LOG.md.

**Top priority:** build the font-carrier base so heroes stop using the thin default calligraphy.

## Motion (added 2026-11-05)
For any animated template use **Canva's built-in animations only** (no external animation, Ali's rule). Start at `motion/CANVA-ANIMATION-PLAYBOOK.md`; the principles are in `motion/MOTION-DESIGN-SYSTEM.md`. The runnable engine, the 41 presets, 13 rendered styles, and the Kotlin engine with parity tests are in `motion/lab/`.
