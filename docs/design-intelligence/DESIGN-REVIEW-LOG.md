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

---

## 2026-11-11 · Batch JO (عيد الاستقلال الأردني, 20 templates JO01–JO20): built in Canva, waiting for Ali's import and review
**Category:** `occasions-holidays/jordan-independence-day` (new). Canva folder: magnific / عيد الاستقلال الأردني (FAHammKoSvk). Import list: `~/Desktop/canva-batch-jordan.txt`.

**Mix (same as Kuwait):** 8 stories, 4 greeting posts, 4 offers (mansaf, shemagh, electronics, kunafa), 4 personal-photo templates.

**Identity:** flag palette (black, white, green #0B5A36, red #B3121F) + gold #E9C46A + cream. Hero face Afeesh Bold for greetings, Lalezar for offers; body Alexandria and Tajawal. Motifs: 7-point star, shemagh zigzag and diamonds, the flag drawn with shapes, black iris, dove, Madaba mosaic.

**Art:** 19 images from Magnific's free generator (Nano Banana 2.1, 1K): 0 credits. No text inside images, no AI flags.

**Frames (real Canva frames, each different):** JO17 fat 7-point star, JO18 flag-notch rectangle, JO19 rounded square with shemagh diamonds, JO20 scalloped medal with ribbon tails.

**Animation:** 15 animated (entrance only, hero animation varies), 5 static (JO03, JO07, JO09, JO11, JO16). Preview played for every animated design.

**Known gap:** JO06's three flag ribbons share one bounding box, so only the top one could be selected for animation.

**Technical lessons:**
- In the Canva editor every element is a DOM node whose `id` is the API element id. Select by id with synthetic pointer events, then click the animation switch. No coordinate guessing. Helpers are kept in localStorage key `__jo_src` on canva.com.
- After an animation is applied Canva replays the page for about 5 s and the elements cannot be hit. Start the job without awaiting it and poll a log.
- A shape's DOM box swallows clicks for shapes with the same box underneath. Give stacked shapes different boxes if they need their own animation.
- Resized carrier copies scale the text boxes, so always set the text width again in post sizes.
- «انجراف» and «ظهور بطيء» are continuous, not entrance-only. Drift leaves centred text off-centre in the last frame: do not use it on centred text.
- Lalezar and Afeesh glyphs are small for their font size. A giant numeral needs 800px.
- `25%` inside an Arabic line reorders: wrap it in U+2066 … U+2069.

---

## 2026-11-11 · Batch JO01–JO20 REJECTED by Ali, replaced by batch JO2 (JO21–JO40)
**Ali's verdict on JO01–JO20:** «طبقنا نفس تصاميم الدول الثانية عالأردن، ما في إبداع ولا هوية جديدة». Root causes: font headline instead of a calligraphy lockup, flags drawn from flat shapes, no hero objects, no heritage material. Do NOT import JO01–JO20 (old list kept as `~/Desktop/canva-batch-jordan-OLD-rejected.txt`).

**JO2 (JO21–JO40), same folder FAHammKoSvk, import list `~/Desktop/canva-batch-jordan.txt`:** 8 stories (21–28), 4 posts (29–32), 4 offers (33–36), 4 personal (37–40).

**What changed (Andalusi study applied):**
- Hero is always a Thuluth/Diwani calligraphy lockup (15 phrases generated as black-on-white, keyed to transparent PNG, recoloured white/green/black/brown/gold). Ali approved calligraphy as an image.
- Real Canva-library flags (ribbon, waving, on pole) kept in an asset carrier `DAHam9fMlwk` (+ 1350 `DAHam-EzjTs`, 1080 `DAHam3XJ-0I`) and resized per design. No AI flags.
- One hero object per design: cave view of Petra, falconer, gold «81», B&W Citadel/Petra cut-outs over a sun disc, shemagh triangle with tassels, horseman, man from behind over Amman, tatreez strip.
- Micro line `JORDAN INDEPENDENCE DAY ✱ 25 MAY` in Tajawal.
- Frames: stamp (JO37), 7-lobe rosette (JO33, JO38), wave panel (JO39), shield (JO40).

**Ali's corrections during the build:**
1. A repeated strip (tatreez) must be ONE element, never tiles side by side. Build a wide image and place it once.
2. A backing shape behind a tilted frame must have the SAME rotation as the frame (even border), never the opposite tilt. Give backing, frame and product the same entrance animation so they move as one piece.

**Technical lessons:**
- `crop_media` on a frame always covers the frame, so a cut-out product cannot be "contained" in a frame: place the product as its own replaceable image over a backing shape.
- `position_element` on a rotated element takes the top-left of the rotated bounding box; the reported top/left is the unrotated box. Offset = (w·cosθ + h·sinθ − w)/2 and (h·cosθ + w·sinθ − h)/2.
- `edit-design` returns the thumbnail inline; thumbnail URLs are not downloadable from the sandbox.
- Animation planner stored in localStorage `__jo_plan` / `__jo_go2` on canva.com: lists DOM ids top-to-bottom, assigns entrance animations from rotating text/image palettes seeded by design number. All 20 animated (entrance only) and previewed. Covered backing shapes (JO33) cannot be selected and stay static.
- Art: 13 new images + 15 lockups from Magnific's free generator, 0 credits.

---

## 2026-11-11 · Batch JO3 (JO41–JO80), 40 designs, same folder FAHammKoSvk
Import list `~/Desktop/canva-batch-jordan-3.txt` (40 links, JO41 → JO80 in order). Ali approved JO2's direction («في فرق ملحوظ») and asked for 30 more (15 personal + 15 mixed), then 10 extra ornamental-frame designs.

**Contents:** JO41–51 personal photo, shaped Canva frames (hexagon, khatam star, ticket, hanging banner, parallelogram, tilted card, octagon, arrow, leaf-corner square, stamp, shemagh fringe). JO52–55 square embroidered/ornament rings with a calligraphy plate and «٨١» badge. JO56–58 rings (mosaic, navy-gold, olive wreath) over a calligraphy band. JO59–64 shemagh frames (twisted ring, flat circle, octagon, story rounded-rect, hexagon, full scarf + agal). JO65 Petra carved-stone frame. JO66–75 greetings without a person (gold 25, Dead Sea, oryx, Jerash, dallah, black iris, olive branches, flag pole, Roman theatre). JO76–80 offers with a replaceable product image (coffee, gifts, thobes, phones, breakfast; prices and percentages are placeholders).

**Ali's corrections during the build (apply to every future batch):**
1. No arch, dome, ogee, horseshoe, leaf or diamond frames for portraits: anything that narrows over the head looks bad. Use rings, rounded rectangles, octagons, hexagons, cards.
2. Ornamental portrait frames like Andalusi's are generated in Magnific and laid over a real Canva frame (see technique below).
3. The photo window must be about 60% of the page width; a thick ring makes the photo look small.
4. A ring must sit complete inside the page. Never scale a ring up so the page edge cuts it; generate a thin-band ring instead.
5. Calligraphy lockups go together with the ring designs (plate under the ring, or a band with name + lockup).
6. Shemagh frames: the flat, spread cloth reads better than the twisted rope. The frame does not have to be a circle.

**Overlay-frame technique:** generate the frame with its window filled with flat magenta #FF00FF (no text, no people, complete shape with margins), key the magenta to transparency (tolerant mask around the strict core, needed for photoreal frames whose window is shaded), upload the PNG, then: real Canva frame with the portrait underneath (circle or rounded rect about 12 px larger than the window, sent to back), frame PNG on top, plates, bands and lockups above it, text layered to front last.

**Animation lessons (Claude browser, all 40 animated entrance-only and previewed):**
- The editor needs a wide viewport (1500 px) while the animation panel is open, otherwise the canvas shrinks and elements end up under the floating toolbar. Reset the viewport afterwards.
- When the browser pane is hidden, DOM hit-testing returns nothing until a screenshot is taken: take a small screenshot after each navigation.
- Covered elements (portrait under a ring, a backing fully behind its frame) are selected with Cmd+click cycling.
- Planner rules added (`__jo_go3`): a backing with the same centre as the frame, a border shape and its inner shape, and a product or lockup sitting on a backing shape all take the same entrance, so they move as one piece. A half-page colour block must not get «ارتقاء» (changed to fade on JO69).
- A product cut-out can be semi-transparent (the gift on JO77): check it on its backing colour before choosing that colour.
- Art: all frames, portraits and products from Magnific's free generator, 0 credits.

---

## 2026-11-11 · Batch EG1 (EG01–EG20), new general category «مصر», 20 designs, Canva folder FAHapEz9IlQ (inside `magnific`)
Import list `~/Desktop/canva-batch-egypt.txt` (20 links, EG01 → EG20 in order). Ali asked for a new Egypt category: visual research first, then a first mixed batch of 20 (general patriotic identity, no single date). Awaiting his review.

**Research:** Andalusi has almost nothing national for Egypt. Canva templates supplied the motifs: pyramids at sunset, Nile feluccas, Islamic Cairo minarets, the flag, pharaonic gold and lapis, and the phrases «تحيا مصر», «مصر أم الدنيا», «المحروسة», «أرض الكنانة».

**Identity (kept apart from Jordan's red/green/tatreez):** sand and gold, lapis blue, faience turquoise, flag red as the accent; materials papyrus, khayamiya appliqué, mashrabiya wood, lotus frieze. No black backgrounds.

**Contents:** EG01–06 stories (pyramids, Nile, Cairo, gold mask on papyrus, winged scarab on lapis, khayamiya strip with lotus). EG07–09 posts (sphinx on a sun disc, pyramids model with lotus frieze, felucca on faience). EG10–11 squares (flag pole, mosque on a turquoise star). EG12–15 offers with a replaceable product (koshary, travel, cotton, sweets; prices and percentages are placeholders). EG16–20 personal photo: wesekh collar ring, khayamiya cloth frame, mashrabiya octagon, papyrus scroll, lotus wreath; each has a calligraphy lockup and a real Canva frame under the overlay PNG.

**Technique notes:**
- Egypt portraits are 832×1024; the crop maths uses that aspect, not Jordan's 928×1152.
- Flags are Canva library elements (ribbon, rounded flat, waving, pole) carried in the carrier design; `resize-design` to 1350 and 1080 keeps the element ids.
- The mashrabiya frame came with a small window (44% of the page). Because the wood is full-bleed, the PNG was scaled 1.36 and shifted so the window is about 60% wide.
- A keyed frame can keep magenta crumbs on the window edge (khayamiya): clean them with a second, tolerant mask restricted to the window radius before upload.
- A lockup colour has to be chosen against the real background: white on a pale gold sky and white on turquoise were too weak, so brown and lapis variants were made.

**Animation (entrance only, all 20 previewed):** the planner gave full-width strips a swing or rise on EG06, EG08 and EG14, and the portrait behind the mashrabiya a swing; these were changed to fade, wipe and blur so nothing shows a gap. On EG13 the sun disc was given the same entrance as the suitcase. Single-element fixes need an awaited `__run` call after a fresh page load; the first attempt often reports "not selected" and the retry succeeds.

**Magnific:** free generator only, 0 credits used (342 available).

## Batch EG2 — Egypt, rebuilt (EG21–EG40) — 2026-11-12
Status: built + animated in Canva, awaiting Ali's review. Folder FAHasN1nHNc. Links: ~/Desktop/canva-batch-egypt-2.txt. EG1 (EG01–EG20) left untouched.
Why rebuilt: Ali rejected EG1's visual direction ("calligraphy on flat texture + one cut-out", sand/lapis palette). See EGYPT-VISUAL-RESEARCH.md.
What changed:
- One idea/scene per design, generated as a full scene with the title zone left empty (flag as flowing cloth inside the scene — approved by Ali for Egypt only).
- Palette moved to flag red/white/black + gold on warm sunset or clean white; black/red thuluth lockups instead of gold-on-sand.
- Families covered: cinematic scene (21, 22, 32), ceremonial decree (23), stamp diorama (24), city scrapbook (25), marble relief (26), clean white business greeting (27), emotional portrait scene (28), yellow street-pop (29, 40), modern museum (30, 31), offers (33 retro sunburst, 34 old newspaper ad, 35 papyrus luxury, 36 travel), personal photo (37 stamp, 38 polaroid, 39 ribbon wreath, 40 pop).
Technique notes:
- A shape whose inner sub-path runs in the opposite direction renders as a hole (frame border / polaroid / ring) — lets the Canva photo frame stay at the back with a border on top.
- Footer text placed over busy scene areas was unreadable twice (28, 33) → move it into the calm zone or put it on a pill.
- Animation: planner gave «تأرجح»/«Baseline» to large photo blocks (36, 38) → changed to «تلاشي»; personal frames kept distinct across 37–40.
Magnific: free web generator only (Nano Banana 2.1, 1K), 0 credits used.

## Batch EG3 — Egypt, Pinterest-matched (round 1: EG41–EG48) — 2026-11-12
- Trigger: Ali rejected EG2 ("still far from Pinterest quality; same as earlier work with only the calligraphy changed"). He picked 26 pins and asked for a close match.
- Method: one pin = one design. Scene generated to mirror the pin's composition and lighting; the title is bespoke word-art or a 3D/cut-out hero made per design (separate image layer), minimal editable text placed where the pin places it. Own imagery and wording; no real personalities.
- Root cause of earlier sameness: one skeleton reused (scene + stock lockup + centred Tajawal lines). Rule from now on: the title treatment must be designed per piece and integrated in the scene.
- Technical: `position_element` on an already-rotated element takes the visual bounding-box top/left. Text over halftone/busy texture needs a solid panel (EG48).
- All Egypt designs now live in one Canva folder «مصر» (FAHasaR9yuk).
- Status: round 1 delivered for Ali's review; 18 picks remaining.
- Round 2 (EG49–EG66) built the same way for the remaining 18 picks; all 26 picks done. Fixes during build: EG58/EG61 footer moved inside the stone plaque (was on the frame moulding); EG64 footer given a dark pill over the busy foreground. A generated logotype for EG55 came out garbled and was replaced by editable Lalezar text. Pill + its text always share one entrance animation.

## Batch EG4 — Egypt (EG67–EG82), 2026-11-12
- 16 designs from Ali's picks (1,3,7,10,11,12,13,14,15,16,17,19,20,21,31,32 of 41 Pinterest options). One pin = one design; own imagery (Magnific free web generator, Nano Banana 2.1) and own Arabic wording. All in Canva folder «مصر».
- Lessons: (1) LRI/PDI isolate characters around a Latin-only text element shift its baseline ~50px down in Canva — use isolates only for LTR runs inside Arabic lines (EG67 «MADE IN EGYPT»). (2) Always check generated flag stripe order: first EG82 background came out white-red-black; regenerated with explicit red/white+eagle/black order on a light paper base (also removed the large black area). (3) `update_fill` on an image element whose box is then resized keeps a scaled crop — follow with `crop_media` 0,0,w,h. (4) Backing shape + title image need the same entrance animation (EG79 fixed to «انبثاق»).
- Quran verse on EG81 set as editable text, not AI lettering.
- Animations: entrance only, varied per design, previews played for all 16.
- Magnific credits: 0 used (342 available).

## Batch EG5 — Egypt (EG83–EG93), 2026-11-12
- 11 designs mirroring 11 Canva templates Ali shared (October victory x3, Sinai Liberation Day, 23 July National Day, Egyptian civilisation x4, Explore Egypt, immortal Egypt). Same method: one reference = one design, own imagery (Magnific free web generator) and own Arabic wording, placeholders instead of real names/handles.
- Reference K used an arch photo window; replaced with a cartouche (capsule) window to respect the no-arch rule.
- Lessons: (1) check each text against busy photo areas — EG89 quote moved from the tents to the calm red haze; EG87 org name moved off a collage photo. (2) Giant cropped titles (EG92 «مصر») get a fade entrance, never a slide. (3) Avoid three identical text animations in one design (EG90 fixed).
- Animations: entrance only, previews played for all 11. Magnific credits: 0 used.

## Batch SY1 — Syria (20 designs, 2026-11-12)
- Source: Pinterest visual research → Ali picked 20 refs (2,4,6,8,9,10,12,15,18,21,27,28,38,51,61,63,64,73,74,128) → SY01–SY20, one ref = one design, own imagery + placeholders.
- Canva folder «سوريا» FAHatcq1Oc8; links: Desktop/canva-batch-syria-1.txt. Sizes: 10 story, 6 post 4:5, 4 square.
- Flag: current green/white/black with 3 red stars, checked on every generation. BY18 regenerated (first output showed the old-regime eagle coat of arms) → rule: prompt "no emblem, no coat of arms" when a flag/eagle appears near state symbols.
- Plain paper backgrounds for 04/07/19 made locally (Magnific free queue failures).
- RTL dates: Latin date with spaced dots reverses → use Arabic-Indic «٨ . ١٢ . ٢٠٢٤» or slashes.
- Cut-out forearm (SY19) showed a hard cut edge → fade the bottom of the cutout alpha instead of cropping.
- Animations: built-in only, varied per design; duplicate sets caught and changed on SY10, SY14, SY20. All 20 previews played.
- Magnific credits: 0 used (free web generator, Nano Banana 2.1).

## Batch SY2 — Syria (7 designs, 2026-11-12)
- Refs 132,142,148,151,161,174,185 (picker v3: 71 new refs 132–206 from unreviewed Pinterest pins) → SY21–SY27, folder «سوريا» FAHatcq1Oc8.
- SY21 night tower lit with the flag; SY22 flag under full moon (square); SY23 Eid gold crescent + glitter map + «سورية» calligraphy on espresso-brown frame (no lantern); SY24 flag on hilltop in fiery sky; SY25 illustrated child (from behind) with flag in ruined street; SY26 Homs clock tower in Starry-Night style + «حمص» calligraphy; SY27 vintage Damascus poster with blank banner/cartouche filled by editable text.
- Calligraphy prompts: the phrasing 'Arabic calligraphy of the exact single word "X" (letters…), correct spelling, no extra strokes' gave correct حمص / عيد مبارك; the older short CAL suffix produced extra strokes (حمص).
- Duplicate animation sets caught and changed on SY22, SY23, SY25, SY26, SY27. All 7 previews played.
- Magnific credits: 0 used (free web generator).

## Batch PS1 — Palestine (PS01–PS48), 2026-11-12
- Source: Andalusi visual research → Ali picked all 48 refs → PS01–PS48, one ref = one design, own imagery (Magnific free web generator, Nano Banana 2.1) + own Arabic wording + placeholders. Canva folder «فلسطين» FAHat_keVvU; links: Desktop/canva-batch-palestine-1.txt. Sizes: 33 story, 15 square.
- Flag checked on every generation (black/white/green + red hoist triangle). PS01 inverted triangle rebuilt as the real hoist triangle with black/green bands.
- Calligraphy: square Kufic and "heart-shaped" compositions misspelled (WP10/11/24/27) → regenerate in Thuluth / Diwani Jali / Maghribi / Ruqaa with "each letter written exactly once". Use ZWJ for «الله» in editable text.
- Phone placeholder: LRI/PDI around digits rendered badly → plain «000 000 000».
- Canva upload URLs rate-limit after ~20 calls → fetch in batches of ~7.
- Thin outline art (PS47 map) disappears at story size → dilate alpha before upload, then crop_media to fit.
- PS14 background seam fixed by per-row gain correction before upload.
- Animations: only ~70% animated per Ali (34 of 48; 14 static). Built-in entrances only, varied per design. Hidden browser pane stalls the animation script → take a screenshot after navigate and while polling. Fixes: PS25 ارتقاء on circle/ring blocks → انبثاق; PS45 four flag shapes unified to one animation; PS39/40/47 repeated تمويه sets varied; PS43 title had no animation → المسح. All 34 previews played.
- Magnific credits: 0 used.

## Batch PS2 — Palestine (PS49–PS118), 2026-11-12
- 70 picks from the big Andalusi + Canva reference board → PS49–PS118, one ref = one design, own imagery + own Arabic wording + placeholders. Canva folder «فلسطين» FAHat_keVvU; links: Desktop/canva-batch-palestine-2.txt.
- Imagery: Magnific free web queue (slow, ~1 image / 3–4 min) for calligraphy and part of the art; Z-Image (5 credits) for most Dome of the Rock scenes, which it renders accurately. Paper/solid backgrounds and the PS101 photo slices made locally.
- Flag checked on every generation (black/white/green + red hoist triangle). PB92 regenerated (first output showed two stacked domes in the crack).
- Calligraphy (فلسطين Diwani/Thuluth, المسجد الأقصى Thuluth) correct on first try with the "exact phrase … each letter written exactly once" prompt.
- Magenta keying: Z-Image sometimes returns pinkish magenta (PB/CP93) → lower the key thresholds per image instead of the default.
- Layout fixes caught on thumbnails: text over busy art got a plate/pill (PS85 dark plate, PS97 cream panel, PS115 navy pill); text moved off focal paths (PS105 river, PS92/PS117 crack, PS111 brush re-centred and rotated −4° to match the stroke, PS118 title moved inside the arch).
- Animations: 49 of 70 animated (~70%), built-in entrances only, varied. Fixes: plates/bands share one animation with their text (PS85, PS106, PS111, PS115); PS101 five slices unified to المسح; single-element designs (PS105, PS117) set via fixnow. All previews played.
- Magnific credits: Z-Image ≈ 250 used this batch; 92 left.

## Batch PS3 — PS119–PS142 (24, from Ali's picks: Canva ref 16 + PS1 refs 1,3,5,10,12,15,19,20,23,26,27,28,37,38,39,40,41,42,43,44,46,47,48)
- Each pick rebuilt as a NEW concept (different layout, imagery, wording) — no copy of the PS1 version.
- Assets: 8 Z-Image (PB122/124/137/138/139/141/142, CP120) + 1 Z-Image redo (CP132 key) = 45 credits; 15 free-queue images; 12 locally generated paper/gradient backgrounds.
- 17 animated / 7 static (122, 125, 126, 134, 135, 138, 142). Plates/bands/cards share one animation with their text.
- Lessons:
  - Z-Image renders a "TAG." prompt prefix as visible text (PB137, PB138); free-queue also baked tags onto objects (CP121 signature, CP123 lid engraving, CP130 wrist, CP132 key). Never put tags in prompts; always zoom-check cutouts for baked labels.
  - In RTL Canva text, `text_align: start` = right, `end` = left.
  - Thin flag stripes (≤30px) can't be clicked for animation at editor zoom → group them via API first, then animate the group.
  - A timed-out animation run can leave stray duplicate elements (PS137 had 6 copies of a text) → keep __run chunks ≤4 elements and re-check thumbnails after animating.
  - Elements inserted after a frame cover it → layer the frame to front (PS126, PS131).

## Batch RM — تهنئة رمضان (RM01–RM50), 2026-11-13
- 50 designs from the Andalusi Ramadan reference board (R1–R50 → RM01–RM50), one ref = one design with its own imagery and the reference wording. 48 stories + 2 squares (RM47, RM48). Canva folder FAHav6Jpr7o (inside «magnific»); links: Desktop/canva-batch-ramadan-1.txt.
- Assets: backgrounds from Canva generate-image (only ~2 jobs at a time before quota_cooldown), the Magnific free queue and a few local solids/papers; all calligraphy (رمضان كريم، رمضان مبارك، مبارك عليكم الشهر، أهلاً رمضان، مرحباً رمضان، فضائل رمضان، اللهم بلغنا رمضان) from the Magnific free web queue, recoloured per design (w/au/cr/nv/gn/teal/br/pk). Lanterns used freely (Ramadan only).
- Free-queue failures: RW25 and RW36 failed once; re-queued (RW36 reworded "playful" → "smooth modern hand lettering") and both came back correct. A reworded prompt no longer matches the PL entry, so dl.py skips it → download that one by URL.
- Layout fixes caught on thumbnails: calligraphy vs body text overlaps (RM02/05/09/12/15/16/19/24/32/35/38/39/45) → generator now places t1 at cal-bottom + 40; RM37 calligraphy nudged below the arch window; RM40 calligraphy shrunk off the crescent tip; RM46 hadith re-wrapped to 4 lines to fit between hanging lanterns; RM50 calligraphy + line fitted inside the green medallion.
- Lalezar text must not contain U+2066/2069 isolates (RM42 broke) → plain text + text anchoring.
- Animations: 35 animated / 15 static (06,12,16,21,22,27,28,32,37,40,43,46,47,48,50). Built-in entrances, varied (تلاشي، تمويه، المسح، انبثاق، تأرجح، ارتقاء — never on backgrounds/blocks). Circle+frame pairs grouped before animating (RM15, RM23). All previews played.
- Magnific credits: 0 used (free web generator only).

## Batch TD (يوم المعلم T01–T30, Canva folder FAHaQL2J0Tg) — pre-import review 2026-11-13
- Found: same 3D teacher cut-out in 6 designs; cap/books/pencil-cup/globe reused 3–7×; chalkboard & notebook backgrounds reused; frame photos reused (T09/T17/T29, T10/T27); dome arches in T04; typo «درور» in T28.
- Fixed with Magnific free generator (0 credits): 6 new 3D teachers, 17 unique school objects (bell, abacus, microscope, crayons, apple, trophy, bulb, diploma, quill, notebook, hourglass, sprout-book, palette, telescope, magnifier, backpack, geometry set, hanging pencils), 5 new backgrounds, 3 new real photos for frames. T04 arches → rounded cards. T28 typo fixed.
- Lesson: check media-ID reuse across the whole batch before handing links; T26 cards must match their words (العلم/الصبر/العطاء → notebook/hourglass/sprout).
- Links: Desktop/canva-batch-teacher-day-1.txt (12 clean) + canva-batch-teacher-day-2.txt (18 fixed).
