# Canva Page Animations

Path: Animate → «صفحة» tab (open with the page selected, not an element).

## Contents
- **Magic Animate** (AI, new): "adds motion in your chosen style to every page at once". The official help page limits it to presentation, social and video designs. The AI tool itself was not run.
- **Featured styles:** بسيط Simple, ناعم Soft, مضحكة Playful, حفلة Party, مؤسسة Business, هادئ Calm.
- **General page animations:** ارتقاء, تأرجح, تلاشي, انبثاق, المسح, ظهور بطيء, Baseline, انجراف, حركة تكتونية, دوران, نيون, سجل قصاصات, سقوط هوائي, Block. Blur and Succession are not offered here.
- **Suggested (photo):** انسيابية الصورة, ارتقاء الصور, تكبير الصورة.
- Footer: «إزالة جميع الرسوم المتحركة» and «التطبيق على جميع الصفحات».

## Behaviour (measured)
1. **A page animation replaces every element's animation.** The toast reads «تم استبدال الرسوم المتحركة للعنصر».
   - On INV-T2 a page-level Baseline made every element Baseline.
   - Removing it («إزالة جميع الرسوم المتحركة») restores nothing; the element animations have to be set again.
2. **Featured style «بسيط»** on the lab page:
   - Every text element fades in (opacity quadOut, ≈0.75 at mid-time).
   - The hero also rises (≈157 design px).
   - It defaults to «كلاهما» (enter and exit), so everything fades out at the end of the page.
   - **Element timing is kept:** onsets followed the element start times already set (0.46 / 1.47 / 1.73 / 2.35 / 2.65 s). So the page style picks the animation type, and element timing still decides the order.
3. Other featured styles (Soft, Playful, Party, Business, Calm) were listed but not measured.

## Use for Nayroz invitations
- **Do not use page-level animations** on invitation templates. They erase the per-role choreography (hero vs support vs ambient), and their default «كلاهما» adds exits, which breaks the enter-only rule.
- A "page style" in Nayroz should be a **direction preset** that feeds the choreographer (family, direction, stagger), not a blanket animation. See CANVA-MAGIC-ANIMATE-ANALYSIS.md.
