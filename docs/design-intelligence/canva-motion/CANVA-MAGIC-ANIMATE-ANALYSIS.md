# Magic Animate and Page Styles: analysis

## What was observed
- Page tab → «أداة Magic Animate» (labelled new): "add motion in your chosen style to every page at once".
- Featured styles: بسيط Simple, ناعم Soft, مضحكة Playful, حفلة Party, مؤسسة Business, هادئ Calm.
- Official: AI picks animations for the whole design and offers a "Recommended style" plus alternatives, with "Remove Magic Animate". It is limited to presentation, social and video design types. The features/magic-animate page returns 404.

## What was measured («بسيط» on the lab page)
| Role | Assigned motion |
|---|---|
| Hero title | rise ≈157 design px + fade, quadOut |
| Ornament / icon | fade, quadOut |
| Name / body text | fade, quadOut |
| All | enter **and** exit («كلاهما» default) |
| Timing | kept the existing element start times; no new stagger was invented |

## Reading
1. Canva's style system is **role-light**: one animation family for the page, with a stronger move for the biggest text.
2. It **does not choreograph**. Order and stagger come from element timing, which the user or template must set.
3. Defaulting to enter+exit suits slides and stories, not invitations.

## What Nayroz should copy and what to improve
- **Copy:** a single style choice drives every element (one easing family), and the hero gets the strongest move.
- **Improve:**
  - Generate the stagger from roles and reading order (the choreographer in CANVA-MOTION-IMPLEMENTATION.md).
  - Default to enter-only.
  - Hold an ambient budget (at most one loop).
  - Keep the background static.
- The style names map onto our direction presets:
  - Simple / Calm → "Soft arrival" (quadOut, rise 80 px, stagger 150–250 ms)
  - Soft → "Soft focus" (Blur family)
  - Business → no-rise fade
  - Playful / Party → spring family (Pop). **Not for invitations.**
- Not verified: what the AI "Recommended style" picks for an invitation, and the exact assignments of the other five styles.
