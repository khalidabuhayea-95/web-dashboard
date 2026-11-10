# Canva Motion: cross-platform compatibility

Status: **analysis, not device-tested.** No Android or iOS device and no Nayroz repo were available in this session.

## Per-primitive risk
| Primitive | Android | iOS | Risk | Fallback |
|---|---|---|---|---|
| fade / rise / pan | graphicsLayer, all APIs | ✓ | none | — |
| baseline (masked) | clipToBounds + offset | ✓ | Arabic glyph ascenders/descenders clipped by a tight bounding box | clip to a box padded by 0.25h |
| wipe | clipRect | ✓ | the reading-start edge must follow RTL (right → left) | read the layout direction |
| blur / succession | `Modifier.blur` on **API 31+ only** | ✓ (Skia / native) | on API < 31 the blur silently does nothing; must not break the look | fade + 8 px rise instead of blur |
| pop (spring) | ✓ | ✓ | the overshoot can clip at the page edge | not used in invitations |
| breathe (continuous) | ✓ | ✓ | battery use; continuous redraw | stop after the page time; static in reduced motion |
| flicker (ambient) | ✓ | ✓ | photosensitivity at high frequency | keep ≤ 2 Hz, depth ≤ 25% |
| shader / reveal | AGSL needs API 33+ | Metal | high | out of scope |
| transitions | ✓ | ✓ | n/a for single-page invitations | — |
| motion path | ✓ | ✓ | design consistency | out of scope |

## Timing consistency
- Drive every element from **one page clock** (frame time), never per-element timers. This keeps Android and iOS in step and matches Canva's element-timing model.
- The golden test is a 30 fps capture per platform, compared with the Canva onsets (±33 ms) and the curves (RMS ≤ 0.02).
- Respect the system animation scale. On Android, `ANIMATOR_DURATION_SCALE` = 0 means reduced motion.

## Reduced motion (matches Canva's documented behaviour)
- Canva removes transitions, background animations, masks and overlays, and reduces the rest.
- Nayroz should mirror that:
  - fade only, ≤ 200 ms, same order
  - no ambient
  - no masks (baseline → fade)
  - no continuous scale

## Export
- Canva exports MP4 / GIF. Nayroz video export should render with the same clock offline (deterministic frames), not a screen recording.

## Arabic-specific
- RTL: "start" means the right edge for wipe and pan directions.
- Calligraphic fonts (Layla Thuluth) overflow their line box. Give masked effects a padded clip.
- Kashida / ligatures: never animate per character (Canva doesn't either for these tiles). Per-word stagger only, if Succession is ever extended.
