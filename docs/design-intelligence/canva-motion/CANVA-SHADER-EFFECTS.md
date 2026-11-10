# Canva Shader / Featured and Reveal Effects

## Official (shader-animation help page)
- Video elements only, Pro, gradual rollout, MP4.
- Animate → Featured: **Shake Zoom** (intensity slider), **Whip Slide** (speed slider), **Old TV**, **Chroma Wave**.
- On enter / On exit / Both.

## Observed in this account (photo element, «متميز»)
The four official effects **also appear for a still image**, plus two more:
| Arabic | English (ours) | Controls |
|---|---|---|
| تكبير اهتزازي | Shake Zoom | speed presets, intensity 0..1 |
| انزلاق سريع | Whip Slide | speed presets, direction left/right |
| التلفزيون القديم | Old TV | speed presets |
| موجة الانحراف اللوني | Chroma Wave | speed presets |
| تموج | Ripple | speed 0.1..2 (0.5), intensity 0..1 |
| حركة بطيئة | Slow motion | speed 0.1..2 (0.33), intensity 0..1, direction |

Reveal group («إظهار»), photo only:
| Arabic | English (ours) | Styles |
|---|---|---|
| اسحب الفرشاة | Brush drag | curve / wild / dip |
| بلا ألوان | Watercolour | drip / flow / bloom / smear |
| رقمية | Digital | centre / linear / scattered |
| طلاء بالرش | Spray paint | chaotic / letters |
| رسم تخطيطي | Sketch | fill / pass / scratch / wobble |
| التدرج | Gradient | radial / blocks / lines |

## How they render (measured)
- **No inline transform, opacity or filter changes** on the image nodes during Shake Zoom, Old TV or Brush drag. The only change is a frame opacity 0→1 in ≈0.2 s.
- During the Old TV preview a **temporary `<canvas>` overlay** appears over the image for ≈1 s and is then removed. These effects are drawn per pixel (shader), which is why the DOM recorder cannot read their curves.

## Limitations
- No curves or durations are claimed for these effects.
- Measuring them would need video export plus frame analysis (MP4 → frames → pixel diff). Not done.

## For Nayroz
- They are not needed for invitations: they read as "social/promo" (glitch, TV, chroma).
- If ever wanted: Android 13+ `RuntimeShader` (AGSL) and iOS Metal / `CIFilter`. That is a cross-platform cost and a reduced-motion liability. **Do not implement in v1.**
- Reveal styles (brush, watercolour) could be approximated with an animated alpha mask texture, but that is post-v1.
