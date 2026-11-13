# Andalusi Reference Analysis

**Accessed:** 2026-11-05, logged in.

**Pages:**
- andalusi.app (home)
- andalusi.app/ai
- template categories: زواج, خصومات, تخرج, بطاقات-عمل, اقتباسات

Screenshots of each category are in `assets/andalusi-*.jpg`. Earlier batches (newborn ×100, weddings) were also modelled on design.andalusi.app references.

## Positioning (from their site)
- They describe themselves as "المصمم العربي للصور والفيديو".
- **Claimed reach:**
  - 6M+ downloads.
  - 10k+ curated templates.
  - 1M+ assets.
  - 28M exports in the last 12 months.
- **Library differentiators they cite:**
  - Arabic + English fonts.
  - "الخط العربي المقوس" (curved Arabic text).
  - المخطوطات, i.e. ready calligraphy lockups.
- **AI tools:**
  - AI calligraphy (مخطوطات) and automatic tashkeel.
  - Remove background/objects, enhance, restore.
  - Text-to-image/logo, photo-to-art.
- Their claim, translated: "most design tools treat Arabic as any other text; Andalusi is built for the Arabic letter".

## Template taxonomy (their nav)
| Group | Categories |
|---|---|
| أعمال | بطاقات عمل، منتجات، مطويات، خصومات، شعارات |
| شخصي | اقتباسات، صور مجمعة، سيرة ذاتية، خلفيات، ترحيب |
| دعوات | زواج، كروت دعوة فارغة، بطاقات فارغة، خطوبة، دعوات عشاء |
| مناسبات | مولود جديد، تخرج، عيد ميلاد، بطاقات شكر، صباح الخير |
| other | اقتباسات page |

## What makes it work (observed)
### Weddings (زواج)
- **Hero:** a calligraphic lockup (عقد قراني، دعوة زفاف، لقد قبلت), large, in gold or burgundy. It is the most recognisable trait.
- **Backgrounds:** photoreal 3D scenes. Satin and velvet in burgundy, black and gold tassels, envelope with wax seal, bride silhouette (faceless/veiled), roses arch, pearls.
- **Many templates are animated (متحركة).** Titles say e.g. «...بورود بيضاء متحركة».
- **Names:** «حمزة & سوسن», placed with a light Naskh/sans pair.
- **Dates:** future placeholder dates (2030).
- **Body text:** very small, centred, light weight, generous line height.
- **Colour sets:**
  - ivory/blush + rose red
  - burgundy + gold
  - black + gold
  - mauve monochrome
  - brown-gold

### Sales (خصومات)
- Arabic display headlines in heavy calligraphic-display style (الجمعة البيضاء، تخفيضات، عرض خاص، موسم التخفيضات).
- Saturated red, yellow or orange backgrounds.
- Product cut-outs in stamp frames.
- Price with the ﷼ sign.
- A CTA pill «تسوق الآن» plus a URL bar.
- A strong local calendar (White Friday).

### Graduation (تخرج)
- Formats beyond posts: door hangers (تعليقة باب), table cards (كروت طاولة), certificates.
- Ornate gold/floral frames, figure illustrations (graduate in thobe/abaya, faceless).
- «مبارك التخرج» in Thuluth/Diwani gold.

### Business cards
- Arabic name as the logo (calligraphic monogram), clean info side with icons.
- Patterns:
  - Islamic arabesque on beige
  - olive/gold
  - lilac botanicals
  - black minimal

### Quotes (اقتباسات)
- Typography-as-art: large Kufi/Ruq'ah/Naskh with kashida.
- Persian-carpet textures.
- Landscape photography with small quote.
- Pastel solids with giant bold quotes and quotation marks.

## Lessons to apply
1. Use a calligraphic hero for every occasion template.
2. Use rich, softly lit 3D material backgrounds, but keep the text zone calm.
3. Prefer faceless figures (cultural fit).
4. Cover formats beyond the post: door hanger, table card, envelope mock, certificate.
5. Follow the local commercial calendar: White Friday, national days, Ramadan/Eid, back-to-school, graduation season.
6. Use fixed occasion phrases (see ART-DIRECTION-GUIDELINES).

---

# Deep study: Invitations in the Andalusi web app (design.andalusi.app), 2026-11-05
Ali has made Andalusi the **only** visual source.

**What I looked at:**
- The Invitations tab, rows: Animated, Wedding, Luxury, Newspapers, Engagement, New Born, Door Sign, Birthday, Graduation Stories/Posts, Place Card.
- The full "Wedding" grid, about 80 templates, scrolled through.
- Large previews.
- Two free templates opened in their editor to inspect layers and fonts.
- Premium templates are paywalled, and I did not subscribe.

## How an Andalusi invitation is built (from the editor layer panel)
Each template is a stack of separate layers:
1. **Background:** one image holding the textured ground and the decorative frame (e.g. black velvet with a gold filigree border and diamonds, or ivory parchment with an embossed floral frame).
2. **Hero calligraphy:** an **image**, not a font. It comes from their "Calligraphy / المخطوطات" library: a pre-drawn 3D gold or burgundy lockup (عقد قراني، دعوة زفاف، لقد قبلت…) with tashkeel, often merged with a small ornamental divider underneath.
3. **Opening phrase:** «الحمد لله الذي بنعمته تتم الصالحات» or «بسم الله…», also a small calligraphy image.
4. **Body lines:** **one text layer per line or block**, never one big paragraph.
5. **Icons:** small calendar and clock line icons in the accent colour, each above its date/time text. Two columns: date on one side, time on the other.
6. **Figure or object cut-out:** a separate PNG layer, e.g. a faceless couple, bride, rings or flowers, sitting at the bottom over the frame.

**Fonts seen in their editor:**
- **AMoshref-Naskh:** the default body font. Classical calligraphic Naskh, thin, elegant, with high contrast.
- **The Year of The Camel (Medium):** dates and numbers.
- Font library tabs: Installed / Exclusive / English / Arabic. Arabic includes Rakan, Qahwa, Monaco-Kufi, Ebhaar, Olfah, Guesswhat, KO Rubbama, Lalezar, MT Lombardia Luxury, Dang Long, Lemon Brush, Thick Naskh Swash…

## Visual patterns across about 80 wedding templates
| Pattern | Share (approx.) | Notes |
|---|---|---|
| Calligraphy-image hero, top third | about 95% | عقد قراني / دعوة زفاف / لقد قبلت / دعوة زواج / عقد القلب بالقلب / وجعل بينكم مودة ورحمة |
| Central symmetric axis | about 90% | Everything centred; side margins 12–18% |
| Photoreal 3D scene or material background | about 85% | Satin, velvet, roses, pearls, lace, envelope + wax seal, palace/garden aisle, curtains, door |
| Faceless figures (couple, bride, groom in bisht) | about 35% | Bottom 40–50%, cultural fit, never faces |
| Ornate frame (gold filigree, floral, lace, arch) | about 50% | The content sits inside it |
| Names as a second calligraphy line | about 60% | «حمزة & سوسن», «تيم & قمر», with & or a heart or rings between |
| Date block | about 80% | Either a 3-cell strip (Friday / 13 / April), icons + two columns, or a single «2030/11/11» line |
| Palette families | n/a | Ivory+gold, blush+rose, burgundy+gold, black/navy+gold, mauve monochrome, brown/caramel+gold, sky blue+white |
| Body text | n/a | 3–6 short lines, thin Naskh, small (about 2–2.5% of height), lots of air |
| Closing line | about 60% | «نسعد بحضوركم ومشاركتكم», «وبحضوركم تكتمل فرحتنا», «وذلك بمشيئة الله تعالى» |

## Formats and categories beyond the story post
- **Door signs (تعليقة باب):** «في بيتنا عريس / عروس», «اسلام & رهف», graduation.
- **Place cards (كروت طاولة):** wedding and graduation.
- **Newspapers (جريدة):** an editorial newspaper layout with photos, «عروسة أغسطس», «أجمل حدث», calendar grids.
- **Animated invitations:** the same structure with elements animated.
- **Engagement (خطوبة):** softer blush and lavender tones, «خطوبة», rings.

## Rules derived for our Canva work
1. The hero must be a **calligraphy lockup**: a Canva calligraphy element, or a strong calligraphic font at large size with a metallic or deep colour. Never a thin face at medium size.
2. Body text uses a **Naskh** face (Canva equivalents: Amiri, Noto Naskh Arabic, Markazi Text), thin, one element per line or block.
3. Put date and time as **two icon columns** or a 3-cell strip.
4. Keep the background rich and textured; the frame can be in the background or a separate frame element.
5. Use cut-out figures or objects as a separate layer at the bottom, faceless.
6. Allow at most 6 body lines.
7. Use Andalusi's fixed wording, e.g. «يسرنا دعوتكم لتشريفنا وحضور», «بكل الحب والسرور ندعوكم لحضور», «وذلك مساء يوم…», «الموافق…», «نسعد بحضوركم ومشاركتكم».

---

# Deep study: Jordan / Independence Day in Andalusi (search «الأردن», about 55 templates), 2026-11-11
Ali rejected batch JO (JO01–JO20): "same designs as the other countries, no new identity". This study is the base for batch JO2.

## What Andalusi does that batch JO did not
1. **Hero is a Thuluth calligraphy lockup (image), never a font.** Recurring lockups: «عيد الاستقلال الأردني», «عيد الاستقلال», «الأردن أرض العزم», «يحيا الوطن», «المملكة الأردنية الهاشمية», and a calligram «أردني وأفتخر» shaped as a man's head in a shemagh. Colours: white, gold 3D, flag green, black.
2. **Micro-line under the lockup:** `✱ JORDAN INDEPENDENCE DAY ✱` + `25 MAY`, tiny, red stars.
3. **A real waving flag is in almost every design:** flag on a pole, a long ribbon flag wrapping around the person or the numeral, flag as a diagonal corner, flag inside the map of Jordan.
4. **One strong hero object per design:** gold 3D coat of arms, horseman carrying the flag, man in traditional dress with a falcon, dove whose wing is the flag, gold numeral of the anniversary wrapped in the flag, map of Jordan filled with shemagh or red, cave opening onto Petra.
5. **Collage style:** black-and-white cut-out landmark (Citadel columns, Petra) over a flat colour with a coloured sun disc, small birds, torn-paper edges.
6. **Heritage borders:** red cross-stitch embroidery (تطريز) panels and a shemagh triangle with tassels hanging from the top.
7. **Personal templates:** person cut-out with the ribbon flag across the chest, circle with a calligraphy ring around it, postage-stamp frame with big quote marks, name line under a quote.
8. **Grounds:** parchment beige, olive-to-yellow gradient, flat red, charcoal with gold, teal with faint pattern. Fireworks sparks as small accents.
9. **Body copy** (their wording): «كل عام والمملكة الهاشمية شامخة», «كل عام والأردن عزيزاً قوياً آمناً», «دام عزّك مملكتي الحبيبة», «وطنٌ نعتزّ به ونفخر، وأرضٌ طيبة تستحق الحب والوفاء», «في عيد استقلالك موطني، نُعلي الهامات علوّ السماء، ونشرف الرؤوس بلباسها تاج العزّ والفخار», «الاستقلال ليس ذكرى نحتفل بها، بل عهدٌ نجدّد فيه الوفاء لوطن زرع فينا العزة والكرامة», «في كل ذرة تراب من هذا الوطن قصة فخر لا تنتهي».

## Capability check (passed)
- Google Nano Banana 2.1 in Magnific's free generator writes correct Jali Thuluth lockups for short phrases (tested: عيد الاستقلال الأردني, الأردن أرض العزم, يحيا الوطن). Generate black on white, turn into alpha, recolour locally, upload as a separate Canva layer. Always read the result letter by letter before use.
- Canva's element library has waving Jordan flags, ribbon flags, flag on pole (not AI). Collect them once in an asset-carrier design (DAHam9fMlwk) through the editor, then copy per template.
