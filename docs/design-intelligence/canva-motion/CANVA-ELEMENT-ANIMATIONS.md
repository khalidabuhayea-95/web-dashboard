# Canva Element Animations (shapes, graphics, photos)

## Shapes and graphics («العنصر» tab)
- The same 15 General animations and 4 add-ons as text. No Suggested section, no Block.
- One check on an image element: **Rise uses the same 80 design px offset** as on text, i.e. the same engine and the same curves as CANVA-TEXT-ANIMATIONS.md.

## Photos («صورة» tab)
### Suggested (measured)
| Animation | Mechanism | Curve | Duration |
|---|---|---|---|
| انسيابية الصورة Photo flow | Frame fades in (opacity 0→1, ≈0.5 s, quadOut). The **inner image** drifts translateY by about ±3% of the frame height inside a fixed crop. | sineInOut | the whole element duration |
| ارتقاء الصور Photo rise | Same as Photo flow, drift in the opposite direction | sineInOut | the whole duration |
| تكبير الصورة Photo zoom | Inner image scale 1.15 → 1.0 inside a fixed crop (Ken Burns, zoom out) | sineInOut | the whole duration |

The key pattern: **move the content, not the frame.** The crop stays still and the picture breathes inside it.

### Featured (shader) and Reveal: observed, not measurable via DOM
- No inline-style changes on the image nodes; only a frame opacity 0→1 in ≈0.2 s.
- During the preview a temporary `<canvas>` overlay appears over the image (≈1 s) and is then removed. These effects are rendered by a shader or canvas, not by transforms.
- Names and controls are in CANVA-SHADER-EFFECTS.md.

### Image-to-video («صورة إلى فيديو»)
An AI generator entry point. It is not an animation preset and was not used.

## Add-ons
Same four as text (Rotate, Flicker, Pulse, Wiggle), same measured values.

## Element timing (used on T1–T5)
- Open it with More → «عرض توقيت العنصر». A track appears per element under the canvas.
- Sliders «اقتطاع حد البداية» / «اقتطاع حد النهاية», values in µs (page 5 s = 5,000,000).
- **Element start = animation start.** That is how the storyboard stagger was built (onset measured within ±40 ms).
- Pitfall: stale slider nodes stay in the DOM. Pick the slider aligned with the selected (purple) track.
