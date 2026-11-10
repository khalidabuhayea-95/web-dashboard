# Arabic Typography System

## How this was verified
On 2026-11-05 I downloaded 18 Google Fonts (OFL) from github.com/google/fonts. Each was rendered with Pillow and libraqm (HarfBuzz shaping, RTL) on this test string:
`بِسْمِ اللّٰهِ — دعوة زفاف «لا إله إلا الله» ١٢٣ 2026 Wedding ؟ ٪`
I also checked each font's cmap for: hamza forms, tashkeel, Arabic-Indic digits, ، ؛ ؟ ٪, tatweel, Persian letters (پچژگ), and ﷺ.
The result image is `assets/arabic-font-specimen.png`.

Every font below shaped connected letters, lam-alef ligatures and the Allah ligature correctly, and mixed Arabic/English rendered in the right order.

## Font cards
| Font | Class | Personality | Weights (verified) | Missing glyphs | Best for | Avoid for |
|---|---|---|---|---|---|---|
| Amiri | Naskh (book) | classical, literary | 400 (+Bold file) | none | Quranic/Islamic quotes, formal invitations body, certificates | UI, tiny sizes |
| Noto Naskh Arabic | Naskh | neutral classical | 400–700 var | none | long body, menus, certificates | display |
| Scheherazade New | Naskh | traditional, generous vowels | 400 (+700 file) | none | text with full tashkeel, educational | tight layouts (tall) |
| Reem Kufi | Kufi geometric | modern-heritage, logo-like | 400–700 var | **٪**, ﷺ | titles, logos, Ramadan/heritage | percentages (tofu!), body |
| Noto Kufi Arabic | Kufi sans | clean, institutional | 100–900 var | none | corporate, infographics, sale numbers | romantic |
| Noto Sans Arabic | Sans | neutral | 100–900, width 62.5–100 | none | UI, captions, condensed headlines | — |
| IBM Plex Sans Arabic | Sans | technical, trustworthy | 100–700 (static files) | none | business, tech, Nayroz brand | wedding |
| Rakkas | Display (heavy naskh-ish) | bold, festive, poster | 400 | ﷺ | Eid/Ramadan headlines, food promos | body |
| Aref Ruqaa / Ruqaa Ink | Ruq'ah calligraphic | handwritten-traditional | 400/700 | ﷺ | short headlines, greetings, quotes | paragraphs |
| Lalezar | Display ultra-bold | loud, playful | 400 (one heavy) | none | sales, YouTube thumbnails, kids | elegant, body |
| Lemonada | Rounded display | friendly, soft | 300–700 var | ﷺ | kids, birthday, food, casual social | formal |
| Tajawal | Geometric sans | modern, light, very popular | 200–900 (static) | چژگ, ﷺ | body/info on invitations, social, UI | Persian text |
| Cairo | Sans | modern, compact, sturdy | 200–1000 var | ﷺ | social, ads, numbers, education | luxury hero |
| Alexandria | Geometric sans | contemporary, stylish | 100–900 var | ﷺ | modern brands, fashion, editorial | traditional |
| Readex Pro | Sans (expanded axis) | contemporary, wide | 160–700, HEXP | پچژگ, ﷺ | tech, modern posters | Persian/Urdu |
| El Messiri | Display sans w/ naskh flavor | elegant-modern | 400–700 var | ﷺ | elegant titles, menus, events | — |
| Marhey | Hand-drawn display | playful, warm | 300–700 var | ﷺ | kids, cafés, quotes | formal |

**Licensing:** all of the fonts above are SIL Open Font License, so commercial use and embedding are allowed. The OFL text is in each font's metadata.

**ﷺ (U+FDFA):** only Amiri, Noto Naskh/Kufi/Sans Arabic, IBM Plex, Lalezar and Scheherazade have it. Otherwise write «صلى الله عليه وسلم» in full.

## Canva-side fonts
Canva has its own Arabic catalog, separate from Google Fonts. Fonts already used successfully in production by our Canva pipeline:
- **Layla Thuluth:** hero calligraphy for names and titles.
- **Tajawal:** body text.

Before using any other font, set it on a test text element through the Canva API and read it back. Record each result here:

| Font in Canva | Verified via API | Notes |
|---|---|---|
| Layla Thuluth | yes (batches 30–34) | hero names/titles |
| Tajawal | yes | body |
| (add as verified) | | |

## Canva execution facts (verified in the 2026-11-05 benchmark)
- **Fonts through the API:** the Canva MCP cannot choose a font family. Text added through `add_text` gets the default font (fontRef `YACgEZ1cb1Q`). Fonts persist when you **reuse existing text elements** (replace_text / format_text keep fontRef) and through copy-design and resize-design.
- **Known fontRefs in our base layout:**
  - `YADK4JElWZc`: a thin calligraphic face, used as the hero.
  - `YAFdJg45t1g`: Tajawal.
- **Workflow:** keep a "font carrier" design with one element per approved font, and set new fonts once in the editor UI.
- **Alignment:** `text_align` follows the element's paragraph direction. Verify on the thumbnail.
- **Mixed runs:** wrap LTR runs (phones, emails with digits, prices with Latin) in U+2066 … U+2069.
- **Digits:** the Arabic-Indic zero ٠ looks like a dot. Use Western digits for phones, prices and folios.
- **Missing Arabic-Indic digits:** the calligraphic face lacks them and falls back to Latin digits, so write numbers in words in calligraphic lines.
- **Glyph seams:** very large calligraphy (>400px) can show glyph seams. Use a vector lockup for giant words.

## Calligraphic styles: when to use which
| Style | Feel | Use for | Rule |
|---|---|---|---|
| Thuluth | majestic, ceremonial | wedding / عقد قران hero, Islamic titles | 1–4 words only; give it 30–40% of the width |
| Diwani | romantic, flowing | engagement, love, Eid greetings | headline only; check legibility of names |
| Ruq'ah | handwritten, everyday | greetings, quotes, cafés | short phrases |
| Naskh | readable classical | Quran/hadith text, formal body | can be paragraphs |
| Kufic (geometric) | architectural, modern-heritage | logos, Ramadan, square compositions | prefer stylised geometric Kufi for marks |

## Rules (enforced by the checklist)
1. The shaping engine must handle the text. Never paste reversed or isolated forms, and never type letters "backwards" to fix a display bug.
2. Text direction is RTL and alignment is right or center. Mixed Arabic/English runs need a check on each line.
3. No letter-spacing on connected Arabic. Use tatweel (ـ) only for deliberate, sparing kashida in titles.
4. Never stretch or squash Arabic with scale X/Y. Change the font size or weight instead.
5. Decorative and calligraphic fonts: headlines of 1–6 words max. Body copy uses Naskh or Sans.
6. Body sizes on 1080×1920: at least 32 px for info lines and at least 26 px for fine print. Line height is 1.4–1.8. Arabic needs more line height than Latin.
7. Contrast must be ≥4.5:1 for body text and ≥3:1 for large display text. On photos, add a scrim or panel.
8. Choose digits per audience:
   - Gulf/Levant formal invitations: Arabic-Indic (١٢٣).
   - Ads, prices, retail: Western (123).
   - Never mix the two in one design.
9. Use Arabic punctuation: ، ؛ ؟ «» and the Arabic comma.
10. Tashkeel goes only where it disambiguates or decorates (Quran must be fully vocalised and copied from a trusted source, never typed from memory).
11. Before delivery, export and visually inspect for broken joins, tofu boxes, clipped diacritics or descenders at the box edge, and a wrong line order.
