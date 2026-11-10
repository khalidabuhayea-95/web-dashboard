# Canva Animation Inventory

Observed 2026-11-05 in the Canva editor (Arabic UI, Pro account) on the scratch design «LAB — Canva motion study» (DAHaE_FOv8g, 1080×1920). Raw evidence lives in `raw/`.

**Status key**
- **M** = measured frame by frame (curve and duration)
- **O** = observed in the UI (name and controls), not measured
- **D** = from official docs only

## Where animations live
| Area | Entry | Contents | Status |
|---|---|---|---|
| Text | Animate → «نص» tab | Suggested: Block. General: 15. Add-ons: 4 | M |
| Shape / graphic | Animate → «العنصر» | General: 15 (no Block). Add-ons: 4 | O (same engine as text) |
| Photo | Animate → «صورة» | Image-to-video, Featured (6), Reveal (6), General (15), Suggested (3), Add-ons (4) | M (partly) |
| Page | Animate → «صفحة» | Magic Animate, Featured styles (6), General page animations (14), photo suggestions | M (بسيط) |
| Transitions | Between page thumbnails → «إضافة انتقال» | 9 + None | M (4 of 9) |
| Motion path | «إنشاء رسم متحرك» | Drag path, style, presentation | O / D |
| Presentation | «الظهور عند النقر» | Click order | O / D |
| Element timing | More → «عرض توقيت العنصر» | Start / end trim per element (µs) | M (used on T1–T5) |
| Video shader | Video → Featured | Shake Zoom, Whip Slide, Old TV, Chroma Wave | D (on video); O (also on still images) |

## Full list (Arabic UI name → English)
### General (text / element / photo)
| # | Arabic | English (our name) | Enter/Exit | Speed presets | Extra controls | Status |
|---|---|---|---|---|---|---|
| 1 | ارتقاء | Rise | yes | yes | direction up/down | M |
| 2 | تأرجح | Pan | yes | shown, no effect | direction left/right | M |
| 3 | تلاشي | Fade | yes | yes | — | M |
| 4 | انبثاق | Pop | yes | yes | — | M |
| 5 | المسح | Wipe | yes | shown, no effect | 4 directions | M |
| 6 | تمويه | Blur | yes | yes | — | M |
| 7 | التتابع | Succession | yes | yes | intensity 0..1 | M |
| 8 | ظهور بطيء | Breathe | no | no | scale in/out + 0.1..1 | M |
| 9 | Baseline | Baseline | yes | yes | direction | M |
| 10 | انجراف | Drift | no | no | intensity, 4 directions | M |
| 11 | حركة تكتونية | Tectonic | no | no | intensity | M |
| 12 | دوران | Tumble | yes | no | intensity, left/right/auto | M |
| 13 | نيون | Neon | yes | no | intensity | M |
| 14 | سجل قصاصات | Scrapbook | yes | no | — | M (enter) |
| 15 | سقوط هوائي | Stomp (air drop) | yes | no | — | M |
| — | Block | Block (text "Suggested") | both/enter/exit | no | colour (Pro), 4 directions | M |

### Add-on effects (stack on top of one main animation)
| Arabic | English | Control | Status |
|---|---|---|---|
| تدوير | Rotate | speed −1..1, CW/CCW | M |
| ومض | Flicker | speed −1..1 | M |
| تقليص العنصر وتمديده | Pulse | intensity −1..1 | M |
| اهتزاز سريع بالاتجاهين | Wiggle | intensity −1..1 | M |

### Photo-only
| Group | Arabic | English (ours) | Controls | Status |
|---|---|---|---|---|
| Featured (shader) | تكبير اهتزازي | Shake Zoom | speed, intensity | O (canvas render) |
| | انزلاق سريع | Whip Slide | speed, direction | O |
| | التلفزيون القديم | Old TV | speed | O (canvas overlay seen) |
| | موجة الانحراف اللوني | Chroma Wave | speed | O |
| | تموج | Ripple | speed 0.1..2, intensity | O |
| | حركة بطيئة | Slow motion | speed 0.1..2, intensity, direction | O |
| Reveal | اسحب الفرشاة | Brush drag | style: curve / wild / dip | O (canvas) |
| | بلا ألوان | Watercolour | style: drip / flow / bloom / smear | O |
| | رقمية | Digital | style: centre / linear / scattered | O |
| | طلاء بالرش | Spray paint | style: chaotic / letters | O |
| | رسم تخطيطي | Sketch | style: fill / pass / scratch / wobble | O |
| | التدرج | Gradient | style: radial / blocks / lines | O |
| Suggested | انسيابية الصورة | Photo flow | intensity | M |
| | ارتقاء الصور | Photo rise | intensity, direction | M |
| | تكبير الصورة | Photo zoom | scale in/out, 0.1..1 | M |
| Other | صورة إلى فيديو | Image-to-video (AI) | — | O (not used) |

### Page
- Magic Animate (AI, all pages).
- Featured styles: بسيط (Simple), ناعم (Soft), مضحكة (Playful), حفلة (Party), مؤسسة (Business), هادئ (Calm).
- General page animations: ارتقاء, تأرجح, تلاشي, انبثاق, المسح, ظهور بطيء, Baseline, انجراف, حركة تكتونية, دوران, نيون, سجل قصاصات, سقوط هوائي, Block. Blur and Succession are missing at page level.
- A page animation **overrides every element's animation**. On INV-T2 a page Baseline made everything Baseline; «إزالة جميع الرسوم المتحركة» fixes that.

### Transitions
None, تضاؤل Dissolve, إزاحة Slide, المسح الدائري Circle wipe, مسح اللون Colour wipe, المسح الخطي Line wipe, المطابقة والنقل Match & move, التدفق Flow, تكديس Stack, حركة قصيرة Short swing. See CANVA-TRANSITIONS.md.

## Platform limits (official)
- One animation is at most 10 s; a design holds at most 50 animations.
- Reduced motion on the viewer's device removes transitions, background animations, masks and overlays, and reduces the rest.
- Export: MP4 / GIF.

## Not observed / not claimed
- "Typewriter" and per-character Pop bounce are mentioned on marketing pages but are **not tiles in this account's panel**. Not claimed.
- The Magic Animate AI result, motion-path curves and video-element shader curves were not recorded.
