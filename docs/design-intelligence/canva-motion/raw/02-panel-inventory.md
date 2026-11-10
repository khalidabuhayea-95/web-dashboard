# Raw: Canva Animate panel inventory (observed 2026-11-05, Arabic UI, Pro account)

Lab design: DAHaE_FOv8g "LAB — Canva motion study (scratch)" (copy of INV-T1, 1080×1920).
Method: select element → toolbar «إضافة حركة» → read panel DOM (role=switch tiles, section headers), then enable each tile and read the settings block that appears under it.

## Panel structure (all selections)
- Header «إضافة حركة»; tabs: «صفحة» + selection tab («نص» for text, «صورة» for image, «العنصر» for shape/graphic).
- «إعدادات العرض التقديمي»: «الظهور عند النقر» (appear on click) toggle.
- Speed area shows «مخصص» (custom, Pro) next to speed presets.
- «إنشاء رسم متحرك» — "اسحب العناصر حول لوحات Canva لإنشاء رسومك المتحركة." (motion path).
- Footer: «إزالة رسم متحرك» (element) / «إزالة جميع الرسوم المتحركة» (page).

## Text («نص» tab)
- «مقترحة» (Suggested): Block
- «عام» (General): ارتقاء, تأرجح, تلاشي, انبثاق, المسح, تمويه, التتابع, ظهور بطيء, Baseline, انجراف, حركة تكتونية, دوران, نيون, سجل قصاصات, سقوط هوائي
- «التأثيرات الإضافية» (Add-on effects): تدوير, ومض, تقليص العنصر وتمديده, اهتزاز سريع بالاتجاهين

### Per-animation settings (text)
| Animation | Enter/Exit | Speed presets | Other controls |
|---|---|---|---|
| Block | كلاهما/عند الإدخال/عند الخروج | — (none shown) | اللون (colour, Pro), الاتجاه يمين/يسار/أعلى/أسفل |
| ارتقاء | yes | بطيء/متوسط/سريع | الاتجاه أعلى/أسفل |
| تأرجح | yes | yes | الاتجاه يمين/يسار |
| تلاشي | yes | yes | — |
| انبثاق | yes | yes | — |
| المسح | yes | yes | الاتجاه يمين/يسار/أعلى/أسفل |
| تمويه | yes | yes | — |
| التتابع | yes | yes | الكثافة slider 0..1 (default 0.5) |
| ظهور بطيء | **no** | **no** | المقياس للداخل/للخارج + slider 0.1..1 (0.5) |
| Baseline | yes | yes | الاتجاه |
| انجراف | **no** | **no** | الكثافة 0..1 (0.5), الاتجاه يمين/يسار/أعلى/أسفل |
| حركة تكتونية | **no** | **no** | الكثافة 0..1 (0.5) |
| دوران | yes | **no** | الكثافة 0..1, الاتجاه يمين/يسار + تلقائي |
| نيون | yes | **no** | الكثافة 0..1 |
| سجل قصاصات | yes | no | — |
| سقوط هوائي | yes | no | — |

### Add-on effects (stack: all four can be on together with one main animation; a main animation cannot be switched off without choosing another — only «إزالة»)
| Effect | Control | Extra |
|---|---|---|
| تدوير | السرعة slider −1..1 (0) | في اتجاه عقارب الساعة / عكس عقارب الساعة |
| ومض | السرعة −1..1 | — |
| تقليص العنصر وتمديده | الكثافة −1..1 | — |
| اهتزاز سريع بالاتجاهين | الكثافة −1..1 | — |
Each effect shows «مسح الرسوم المتحركة» (clear) link.

## Image («صورة» tab; image fill in a rect)
- «صورة إلى فيديو» — "حوِّل صورتك إلى فيديو قصير." (AI image-to-video entry)
- «متميز» (Featured, shader-type): تكبير اهتزازي, انزلاق سريع, التلفزيون القديم, موجة الانحراف اللوني, تموج, حركة بطيئة
- «إظهار» (Reveal): اسحب الفرشاة, بلا ألوان, رقمية, طلاء بالرش, رسم تخطيطي, التدرج
- «عام»: same 15 as text
- «مقترحة» (photo-specific): انسيابية الصورة, ارتقاء الصور, تكبير الصورة
- Add-on effects: same 4

### Per-animation settings (image-only)
| Animation | Enter/Exit | Controls |
|---|---|---|
| تكبير اهتزازي | yes | speed presets, الكثافة 0..1 |
| انزلاق سريع | yes | speed presets, الاتجاه يمين/يسار |
| التلفزيون القديم | yes | speed presets |
| موجة الانحراف اللوني | yes | speed presets |
| تموج | yes | السرعة slider 0.1..2 (0.5), الكثافة 0..1 |
| حركة بطيئة | yes | السرعة slider 0.1..2 (0.33), الكثافة 0..1, الاتجاه |
| اسحب الفرشاة | yes | النمط: انحناء / بري / غمس |
| بلا ألوان | yes | النمط: سيلان / التدفق / ازدهار / تلطيخ |
| رقمية | yes | النمط: في المنتصف / الخطي / مخطط مبعثر |
| طلاء بالرش | yes | النمط: فوضوي / خطابات |
| رسم تخطيطي | yes | النمط: ملء / تمرير / خدش / تمايل |
| التدرج | yes | النمط: دائري / كتل / خطوط |
| انسيابية الصورة | yes | الكثافة 0..1 |
| ارتقاء الصور | yes | الكثافة 0..1, الاتجاه |
| تكبير الصورة | yes | المقياس للداخل/للخارج, slider 0.1..1 |

Note: the official shader help page names "Shake Zoom, Whip Slide, Old TV, Chroma Wave" for **videos**; in this account they also appear for a still image under «متميز» together with two more (تموج, حركة بطيئة).

## Shape («العنصر» tab; SVG path shape) and graphic (recoloured image in rect, «العنصر»)
- «عام»: ارتقاء, تأرجح, تلاشي, انبثاق, المسح, تمويه, التتابع, ظهور بطيء, Baseline, انجراف, حركة تكتونية, دوران, نيون, سجل قصاصات, سقوط هوائي (15; no «مقترحة» section, no Block)
- Add-on effects: same 4

## Page («صفحة» tab)
- «إضافة حركة إلى التصميم بالكامل»
- «أداة Magic Animate» (جديد) — "أضف الحركة بالنمط الذي تختاره إلى كل الصفحات على الفور."
- «متميز» styles (Magic Animate): بسيط, ناعم, مضحكة, حفلة, مؤسسة, هادئ
- «عام» page animations: ارتقاء, تأرجح, تلاشي, انبثاق, المسح, ظهور بطيء, Baseline, انجراف, حركة تكتونية, دوران, نيون, سجل قصاصات, سقوط هوائي, Block (no تمويه, no التتابع)
- «مقترحة»: انسيابية الصورة, ارتقاء الصور, تكبير الصورة
- Footer «إزالة جميع الرسوم المتحركة» — observed on INV-T2: removed a page-level Baseline that had made every element read Baseline.

## Element timing (observed earlier in this session on INV-T1)
- floating toolbar «المزيد» → «عرض توقيت العنصر»; tracks under the canvas; sliders «اقتطاع حد البداية» / «اقتطاع حد النهاية» / «موضع الاقتطاع», values in microseconds; page 5 s = 5,000,000.
