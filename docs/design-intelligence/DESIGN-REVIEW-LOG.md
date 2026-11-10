# Design Review Log

Newest first. Every entry includes the score, evidence, fixes, and a lesson, with the lesson also moved into the relevant system file.

---

## 2026-11-05 · INV-T1…T5 revision after Ali's feedback (animation and elements)
**Ali's feedback:** the same animation was used for everything, and the same elements too; no variety and no optimal use.

**Root cause:** the font-carrier base had «ارتقاء» on every element, so all copies inherited it. Three carrier graphics were also reused in every test.

**Fix:**
- Every element of T1–T5 now has its own entrance, enter-only, with staggered styles.
- Each design got its own hero lockup and its own accents.
- Details are in ANIMATION-AND-ELEMENTS-SYSTEM.md.

**Lesson:**
- Clear inherited animations whenever a template is cloned from a base.
- Plan the animation per role before applying it.
- Never reuse an accent element across designs in one batch.

---

## 2026-11-05 · Invitation tests INV-T1…T5 (Canva only, no Magnific): self-review, NOT yet reviewed by Ali
- **Reference:** Andalusi web-app invitations only (see the Deep study section in ANDALUSI-REFERENCE-ANALYSIS).
- **Build:** each one is a copy of the font carrier (Amiri body, Layla Thuluth names/hero, Canva calligraphy graphics). Backgrounds were made with Canva AI. All text is editable.

| # | Design | Direction | Score | Pass? | Evidence / main issue |
|---|---|---|---:|---|---|
| T1 | عقد قران أسود وذهبي (DAHaEUhro8w) | dark + gold frame, central axis | 86 | ✓ | - Gold عقد قران lockup, verse header, line icons for date and time.<br>- Closest to Andalusi 9515. Body is slightly dense. |
| T2 | عقد قران عاجي (DAHaESq0BsM) | ivory arch + faceless couple, text in top half | 88 | ✓ | - Verse graphic in brown, airy hierarchy, the couple carries the bottom.<br>- The «عقد قران» hero is Layla Thuluth and still a little thin. |
| T3 | دعوة زفاف ساتان وورد (DAHaEWPq-3o) | ivory satin + burgundy roses, stacked names | 86 | ✓ | - Elegant burgundy-on-ivory, good contrast.<br>- The text block sits a bit high, with empty satin under it. |
| T4 | عقد قران ستار عنابي (DAHaEZsA7x4) | burgundy curtain, all text inside the gold oval | 87 | ✓ | - Strong frame-led composition with white names on deep red.<br>- The ring line art is small at phone size. |
| T5 | دعوة خطوبة لافندر (DAHaEf8tKrg) | lavender watercolour arch, name / ring / name stack, 3-part date | 84 | ✗ (borderline) | - Soft and on-trend.<br>- The hero is thin, and the weekday sits close to the right-side leaves. |

**Result:** 4/5 pass at ≥85.

**Lessons:**
- Canva-only works when the background already contains the frame (arch, oval, satin) and the text stays inside that frame.
- Canva calligraphy graphics (عقد قران، وجعل بينكم مودة ورحمة) beat Layla Thuluth text as heroes: heavier and more "lockup".
- A calligraphy graphic for «دعوة زفاف» and «خطوبة» is still missing. Search Canva Elements next.
- The export-download.canva.com host is blocked from both shells. Review uses the edit thumbnails.

---

## 2026-11-05 · Benchmark (10 designs): self-review, NOT yet reviewed by Ali
- **Canva designs:** BM01–BM10, titled "BM0x — …".
- **Contact sheet:** `assets/benchmark-sheet.jpg`
- **Backgrounds:** 8 Magnific backgrounds (Nano Banana 2.1, 65 cr each = 520 cr).
- **Text:** all text is editable Canva text.

| # | Design | Style / layout | Score | Pass? | Evidence / main issue |
|---|---|---|---:|---|---|
| 01 | دعوة زفاف (DAHaEPWZYwc) | Dark Cinematic Luxury / A | 80 | ✗ | - Rich satin+roses scene, correct phrases, good hierarchy.<br>- Hero calligraphy face is too thin and light for a "premium" hero.<br>- The info block is small and cramped above the rose bed. |
| 02 | إعلان سيروم (DAHaEICdkSQ) | Minimalist / D | 87 | ✓ | - Clean RTL right column, strong headline, CTA pill.<br>- Price and CTA could sit closer. |
| 03 | رمضان كريم (DAHaEIzvLM8) | Islamic Heritage / B | 84 | ✗ (borderline) | - Excellent arch composition and verified verse.<br>- Thin hero; the verse at 38px is weak on navy. |
| 04 | بطاقة عمل (DAHaEAUp-qI) | Luxury / F | 86 | ✓ | - Balanced, the gold mark bleeds nicely.<br>- The phone needed an LRI/PDI bidi fix (done). |
| 05 | ملصق «صبر» (DAHaEPyO2Qg) | Contemporary Arabic / G | 72 | ✗ | - The calligraphy face shows hairline seams between glyphs at 620px.<br>- The composition is too empty; the folio digit looks like a dot. |
| 06 | عرض مندي (DAHaEC5hUYc) | Dark food / D | 86 | ✓ | - Appetising, strong headline, price badge and CTA.<br>- I caught the typo «نص» → «نصف» in review. |
| 07 | مبارك التخرج (DAHaELpDLsQ) | Elegant Feminine / A | 83 | ✗ (borderline) | - Lovely scene.<br>- Body text is too small and grey-purple on lilac (low contrast); the hero is thin. |
| 08 | إنفوغرافيك النوم (DAHaEDNOReo) | Flat education / H | 76 | ✗ | - Clear steps.<br>- Mixed fonts (step 5 fell back to the default font, digits fell back to Latin).<br>- Plain, with no illustration or icons. |
| 09 | يوتيوب القهوة (DAHaENYHJ5w) | Dark Cinematic / F | 90 | ✓ | - Readable at small size, strong contrast, a clear subject on the left. |
| 10 | عرض العطر (DAHaED_I9Rg) | Bold Graphic / D+E | 85 | ✓ | - Punchy and on-trend for the Arab retail market.<br>- The product-name calligraphy is thin; the % sign in Latin style. |

**Result:** 5/10 pass at ≥85.

**Root cause shared by every fail:** typography. The Canva MCP **cannot set a font family**; `add_text` and `format_text` have no font field. So every design reused the only two fonts already present in the base layout (fontRef `YADK4JElWZc`, a thin calligraphic face, and `YAFdJg45t1g` = Tajawal). Any new text gets the Canva default font (`YACgEZ1cb1Q`).

**Fixes required before production:**
1. Build a **font-carrier base design**: one Canva page holding a text element per approved font. Fonts are set once by hand or through the Chrome editor UI. Copy or resize it per job, then reuse those elements.
2. Swap the thin hero font for a bold Thuluth/Diwani with weight, or use calligraphy lockup elements (the planned مخطوطات library).
3. Body text minimum is 32px on 1080-wide designs, with contrast ≥4.5:1 checked on the real background.

**Technical lessons (now in ARABIC-TYPOGRAPHY-SYSTEM):**
- `text_align` start/end follows each element's paragraph direction. An element that once held only digits behaves as LTR, so "end" = right; in RTL elements, "start" = right. Always check the thumbnail.
- Wrap phone numbers and other LTR runs inside Arabic in U+2066 … U+2069, otherwise they reorder (079 555 1234 rendered as 1234 555 079).
- The Arabic-Indic zero (٠) reads as a dot in Tajawal, so use Western digits for phones, prices and folios.
- Calligraphic fonts can show glyph seams at very large sizes (>400px). For giant words use a vector lockup.

---

## 2026-11-05 · Batch 34 (عقد قران, 13 templates T01–T13 + 1 earlier draft): REJECTED by Ali
**Ali's verdict:** all rejected.

**Reasons he picked:**
- looks unprofessional
- fonts and typography
- too far from the reference
- backgrounds

**What went wrong (self-audit):**
1. **Backgrounds:** these were pre-rendered static video frames (sparkle and door overlays) instead of rich, softly lit 3D material scenes like Andalusi's (satin, roses, envelope, pearls). That made them look flat or cheap.
2. **Typography:** the hero did not have a true calligraphic lockup quality. Size contrast and line spacing were weak, and the body blocks were too dense and heavy.
3. **Reference fidelity:** wording was reworded and the layouts drifted from the originals. Ali's standing rule is to keep the reference text and stay close to the layout.
4. **Polish:** I relied on API positioning without a final visual pass at phone size.

**Lessons, now rules:**
- Andalusi-grade means:
  - a calligraphic hero lockup
  - a photoreal material background with a calm text zone
  - tiny, airy, light-weight body text
  - one warm light source
  (ART-DIRECTION-GUIDELINES "premium" list)
- Never ship without an exported image review against the checklist and side-by-side with the reference.
- Do not reword reference text.

**Status:** Ali said to leave them for now. Do not rework them until he asks.
