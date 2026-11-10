# Animation and Elements System (invitations)

Written 2026-11-05 after Ali's feedback: «نفس الانميشن للكل… ونفس المشكلة بالعناصر، ما في تنويع ولا استخدام مثالي».

## Root cause
- **Same animation everywhere:** every template was copied from the font-carrier / base layout, and every element in that base had **«ارتقاء» (Rise/Ascend)**. Copies inherit it, so every element of every template rose the same way.
- **Same elements everywhere:** the carrier's three graphics were reused in all five tests:
  - the «عقد قران» lockup
  - the hand-with-ring line art
  - the brown divider

## References studied
- **Wedvite (wedvite.net/ar/wedding-invitation-design):**
  - 14 Gulf designs, each a full scene: palace, mosque arch, gazebo, curtains, a couple from behind.
  - Layout:
    - families on two columns at the top
    - names as the largest line, with «و» stacked between them
    - a 6-line front face
  - Motion, frame-sampled from their preview MP4: the text is **static** and the life comes from the background.
    - a slow diagonal light sweep
    - twinkling sparkles
    - an envelope opening as the entry moment
- **Canva «دعوات» (Arabic filter):**
  - Varied elements:
    - wax seals
    - envelopes
    - line icons (calendar / clock / pin)
    - circle or arch photo frames
    - gazebo and floral illustrations
    - calligraphy lockups
    - a 3-column date block (day | number | month)
  - Animated templates, frame-sampled: elements enter **staggered**, each with its own style.
    - the title fades in first
    - the names come one after the other
    - the floral border wipes in last

## Animation rules (Canva built-in only; see motion/CANVA-ANIMATION-PLAYBOOK.md)
1. **Never one animation for the whole design.** Every element role gets its own entrance. Max 2 elements may share a style, and only if they are a pair (two names, two icons).
2. **Enter only («عند الإدخال»).** Never «كلاهما», because exit animations make elements look clipped at loop end.
3. **No «ارتقاء» on anything by default.** It is the inherited base style, and Ali has banned it on backgrounds.
4. **Pairs move toward each other.** Groom drifts ← and bride drifts →, or both use the same soft reveal.
5. **Ambient life:** sparkles and stars get Fade plus the extra effect «ومض». Seals get Pop plus «تقليص العنصر وتمديده». Sprigs get «تأرجح». The background stays static.
6. **Choreography by role:**

| Role | Good choices (pick one per design, vary across designs) |
|---|---|
| Hero lockup | المسح (Wipe), تمويه (Blur), ظهور بطيء, التتابع (text) |
| Bismillah / verse line | تلاشي, التتابع |
| Intro line | تمويه, Baseline, ظهور بطيء, تلاشي |
| Names | ظهور بطيء, انجراف (opposite directions), تمويه, Baseline |
| & / و | تلاشي, انبثاق |
| Divider / lines | المسح |
| Date / time / venue | Baseline, انجراف, تلاشي |
| Icons | انبثاق |
| Accent objects | seal: انبثاق + تقليص؛ sparkle: تلاشي + ومض؛ sprig: تأرجح |

**How to apply (automation):**
1. Open the design in Chrome.
2. Select an element, then click the toolbar button «إضافة حركة».
3. Run the JS helper `__anim(name)`. It clicks `[role=switch]` with that Arabic label, then «عند الإدخال».
4. Keep the panel open and click the next element on the canvas.

Speed and direction controls carry a crown (Pro), but the direction arrows still worked.

## Element library (Canva design DAHaEdNgW90 "ELEMENT LIBRARY")
| Media ID | What | API recolor? |
|---|---|---|
| MAGKE796-t0 | «دعوة زفاف» calligraphy lockup (navy+gold) | ✓ (both colours map) |
| MAGSIo5ulnI | «عقد قراني» lockup | ✗ via API, ✓ via editor colour panel |
| MAGOk_woCiw | «عقد قران» lockup | ✓ |
| MAGOkw8fLEE | «وجعل بينكم مودة ورحمة» | ✓ |
| MAGfvTablOs | gold double-line frame with ornaments | raster |
| MAHRmN0eyAM | 3D gold rings | raster |
| MAHJtt4CFJw | line-art rings | ✗ |
| MAG50ZlnwPw | location pin (line) | ✓ |
| MAFbBCiYee8 / MAFM6AdwBLo | clock / calendar (black line) | ✗; draw them with insert_shape instead |
| MAG0cIYwKJE | burgundy floral wax seal | raster |
| MAHVimZOrQ8 | gold ornate divider (square canvas) | raster |
| MAHWvsS2VfA | gold swirl divider | raster |
| MAHLk6slRUY | lavender sprig divider | raster |
| MAHUnaRNdLE | lavender sprig (tall) | raster |
| MAFclc2_CqY | gold sparkle cluster | raster |
| MAEmS5p39mA | gold 4-point star | raster |
| MAGONSW1aj0 | hand with ring line art | ✓ |
| MAEv2rCWURg | brown divider | — |

**Usage rule:** within a batch, each design gets its **own** hero lockup and its own accent objects. Only line icons may repeat across designs.

## Current assignment (INV-T1…T5)
| Design | Hero | Accent elements | Animation highlights |
|---|---|---|---|
| T1 black/gold | عقد قران lockup | sparkle cluster, gold lines + ornament, drawn clock/pin icons | Wipe hero, blur intro, slow-appear names, sparkle flash |
| T2 ivory couple | «وجعل بينكم مودة ورحمة» as hero | brown divider, pin icon | Blur hero, sequence bismillah, names drift toward each other |
| T3 satin roses | «دعوة زفاف» lockup in burgundy | gold ornate divider, wax seal | Slow-appear hero, blur names, seal pop + pulse |
| T4 burgundy oval | «عقد قراني» lockup in gold | swirl divider, twinkling star | Blur hero, Baseline names, drift date, star flash |
| T5 lavender | «دعوة خطوبة» text | lavender sprig + divider, ring line art | Sequence hero, sprig swing, names drift opposite, day-number pop |
