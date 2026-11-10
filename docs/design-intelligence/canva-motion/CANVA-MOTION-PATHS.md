# Canva Motion Paths («إنشاء رسم متحرك»)

Status: **observed in the UI, plus official docs. Not measured frame by frame.**

## UI (observed)
- In the Animate panel for any element: the «إنشاء رسم متحرك» card, with the text "اسحب العناصر حول لوحات Canva لإنشاء رسومك المتحركة" (drag elements around the canvas to make your animation).

## Flow (official help page)
1. Select an element, open Animate, then Create an animation.
2. Drag the element along the path you want; the drag is recorded as the path.
3. Adjust the motion style, the presentation settings and add-on effects.
4. Done, or Delete path.
5. Multi-select several elements, then Create animation, to record a sequence.

## Implications
- The path is **freehand, recorded from the pointer**. The easing and smoothing Canva applies to it were not measured.
- Not appropriate for invitation templates: the paths are hand-made, hard to keep consistent across templates and sizes, and break the "one direction (up)" rule.
- For Nayroz: if needed later, implement as a polyline/Bezier path with arc-length parameterisation and the same easing families (quadOut default). It is **out of scope** for the first engine version.

## Limitations
- Path curve, timing and rotation-along-path were not recorded. Do not claim specific values.
