# Canva Animation Playbook (the ONLY animation source)

**Ali's decision (2026-11-05):** we use Canva's built-in animations only. No external animation: no custom engine, Lottie, Rive, After Effects or video-rendered motion.

**Exception (Ali, same day):** a **video background** (Kling via Magnific, per the invitation-video-templates pipeline) is allowed as an option. Vary across a batch: some templates get a static image bg, some a video bg. Element and text motion is always Canva built-in.

**Status of the rest of `motion/`:**
- The other files and `lab/` are **reference only** (principles, timing, benchmark).
- The JS/Kotlin engine is archived and not used in production.
- Wherever another file names an engine preset, use the Canva equivalent below.

## 1. What Canva gives us
✅ = seen in our Canva editor panel. 📄 = Canva help.

- **Element animations (Arabic UI name / English):**
  - ارتقاء Ascend/Rise
  - تأرجح Swing
  - تلاشي Fade
  - انبثاق Pop
  - المسح Wipe
  - تمويه Blur
  - التتابع Sequence (text)
  - ظهور بطيء Slow Appear
  - Baseline (text)
  - انجراف Drift
  - حركة تكتونية Tectonic
  - دوران Spin
  - نيون Neon
  - سجل قصاصات Scrapbook
  - سقوط هوائي Aerial Fall
  - Block (text) ✅
- **Extra effects (combine with one of the above):**
  - تدوير Rotate
  - ومض Flash
  - تقليص العنصر وتمديده (Pulse)
  - اهتزاز سريع بالاتجاهين (Wiggle) ✅
- **Settings:**
  - عند الإدخال / عند الخروج / كلاهما
  - Speed: بطيء / متوسط / سريع, or an exact duration (Pro)
  - Direction arrows on Wipe/Drift etc.
  - Intensity on some effects ✅
- **Timing:** «إظهار توقيت العنصر» (show element timing) lets you drag the order of elements and drag each element's duration. 📄 This is how we stagger.
- **Create an animation:** drag a motion path. 📄
- **Page animations** and **page transitions**. 📄
- **Magic Animate:** one click. 📄 Never use it for final templates, because it gives everything the same family.
- **Limits:** one animation is at most 10 s; a design has at most 50 animations. Reduced-motion devices remove transitions, background animations, masks and overlays. 📄
- **Automation:** we apply animations through the Chrome editor (the JS helper `__anim(name)` clicks the switch with that Arabic label, then «عند الإدخال»). The Canva API cannot set animations.

## 2. Role → Canva animation (pick per design; never the same for every role)
| Role | Luxury / invitation | Islamic / Ramadan | Sale / promo | Social / modern | Education |
|---|---|---|---|---|---|
| Hero calligraphy / title | المسح (slow) · تمويه · ظهور بطيء | ظهور بطيء · تمويه | انبثاق · Block | Baseline · المسح | تلاشي |
| Bismillah / verse | تلاشي · التتابع | التتابع · تلاشي | — | — | — |
| Intro sentence | تمويه · Baseline · التتابع | التتابع | Baseline | Baseline · انجراف | انجراف |
| Names (pair) | ظهور بطيء (both) · انجراف opposite directions | — | — | — | — |
| & / و | تلاشي | — | — | — | — |
| Divider / lines / frame | المسح (center-out where offered) | المسح | المسح | المسح | المسح (progress bars) |
| Date / time / venue | Baseline · انجراف · تلاشي | تلاشي | Baseline | تلاشي | انجراف |
| Icons | انبثاق | انبثاق | انبثاق | انبثاق | انبثاق |
| Price / % badge | — | — | انبثاق + تقليص وتمديد | انبثاق | — |
| CTA | — | — | انبثاق + اهتزاز | انبثاق | — |
| Sparkles / stars | تلاشي + ومض | تلاشي + ومض | ومض | — | — |
| Wax seal / badge | انبثاق + تقليص وتمديد | — | — | — | — |
| Sprig / lantern | تأرجح (lanterns: Ramadan only) | تأرجح | — | — | — |
| Ornament / star pattern | دوران (slow) | دوران (slow) | — | — | — |
| Photo inside frame | ظهور بطيء | — | انبثاق · تكبير الصورة | انسيابية الصورة / ارتقاء الصور (photo-only suggestions) | — |
| Background | **none** (no ارتقاء, Ali's rule); animate overlays only | none | page animation allowed | page animation allowed | none |

**Avoid:**
- In luxury/Islamic: نيون، سجل قصاصات، سقوط هوائي، حركة تكتونية (too playful/heavy).
- Exits on invitations: always «عند الإدخال» only, so nothing looks clipped.

## 3. Timing rules (in Canva's element timing view)
1. **Order = hierarchy.** Hero → names → details → ambient. Start the next role before the previous ends (~0.3 s overlap).
2. **Stagger 0.1–0.2 s** between lines/words of the same role. Pairs (two names, two icons) start together.
3. **Speed by category:**
   - Luxury/Islamic: بطيء for heroes and names, متوسط for details.
   - Sale: سريع/متوسط.
   - Education: متوسط.
4. **Entrance total:** ≤ 4 s for invitations, ≤ 2.5 s for social, ≤ 1.5 s for ads. After that, only ومض / تقليص وتمديد / تأرجح / دوران keep the design alive.
5. **Variety rule:**
   - Each role uses a different animation.
   - At most 2 elements share one, and only as a pair.
   - Across a batch, the hero animation must vary between designs.
6. **Before saving, verify:** play the preview once and check:
   - nothing clipped at the end
   - no element moving over the text area
   - Arabic still readable mid-animation (Blur should not linger)

## 4. Mapping from the reference library (engine preset → Canva)
| Engine preset (reference) | Canva |
|---|---|
| fade-in / fade-out | تلاشي |
| fade-up / fade-down / rise | ارتقاء (not on backgrounds) or Baseline (text) |
| drift-in / slide-in | انجراف + direction |
| mask-reveal-up / wipe-* / iris | المسح + direction |
| blur-in / settle-in | تمويه |
| pop / pop-spring / scale-in / zoom-in | انبثاق |
| stretch-snap | Block / تأرجح (closest; no exact equivalent) |
| typewriter / word stagger | التتابع (Canva splits text itself) |
| draw-stroke | المسح on the line, or Create an animation (no true stroke draw in Canva) |
| twinkle | تلاشي + ومض |
| breathe / pulse-once | تقليص العنصر وتمديده |
| wiggle | اهتزاز سريع بالاتجاهين |
| sway | تأرجح |
| spin-slow | دوران / تدوير |
| flip-in-y (3D) | — (none; avoid) |
| shimmer-loop / ken-burns / particles / glitch | — not in Canva: **drop them** (or use a page animation where it fits) |

The timing, hierarchy and variety principles in the other motion files still apply. Only the tool changes.
