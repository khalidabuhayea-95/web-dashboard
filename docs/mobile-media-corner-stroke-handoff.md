# Mobile handoff — media corner radius + border (incl. per-corner)

Contract source of truth: `GET /api/mobile/openapi` → `components.schemas.MobileMediaLayerFilters`.
Live example payload: `GET /api/mobile/templates/{id}` (public for published templates).

## What the API sends

On every **IMAGE** and **VIDEO** layer, `filters` now carries:

| Field | Type | Meaning |
|---|---|---|
| `cornerRadius` | number `0–0.5` | Ratio of the layer's **shorter rendered side**: `radiusPx = cornerRadius × min(renderedWidth, renderedHeight)`. `0` = sharp, `0.5` = pill. |
| `cornerRadiusCorners` | object? | Per-corner enable mask `{topLeft, topRight, bottomRight, bottomLeft}`. **Omitted = round ALL corners** (the common case). When present, apply the radius only to corners set `true`; the rest stay sharp. |
| `strokeColorHex` | string | Border color `#RRGGBB`. |
| `strokeOpacity` | number `0–1` | Border alpha; `0` hides the border. |
| `strokeWidth` | number `0–24` | Border thickness in **project px**; `0` = no border. |

**SHAPE layers need none of this** — their corner rounding and border are pre-baked into the served raster (including per-corner).

## The one hard requirement: the border must take the corner shape

Build **one** outline path per layer — a rounded rect honoring the per-corner mask (rounded where enabled, sharp where disabled) — and use it for **both** operations:

1. **Clip** the media to the path.
2. **Draw** the media.
3. **Stroke** the *same* path, centered on the edge, with `strokeColorHex` @ `strokeOpacity`, width `strokeWidth`.

Never draw a straight rectangular border around media that has rounded corners — the border must curve around every rounded corner exactly like the clip does. (This mirrors the web editor: Konva strokes the identical rounded path it clips with.)

## KMP implementation notes (from reading the current code)

- `FilterConfig.cornerRadius` defaults to `0.1f` — **gotcha**: an absent value must render as `0`, not the default. Map "missing" explicitly.
- `toShape()` currently ignores `cornerRadius` for `RECTANGLE` and only rounds for `ROUNDED`. **Imported layers always come as `RECTANGLE`** — apply `cornerRadius` there too.
- Radius must be **proportional** (ratio × shorter side), not a fixed dp: replace the `ratio * 120.dp`-style mapping.
- Compose: `RoundedCornerShape(topStart, topEnd, bottomEnd, bottomStart)` supports per-corner sizes directly — derive each from the mask. Use the same shape for `Modifier.clip(...)` **and** `Modifier.border(width, color.copy(alpha = strokeOpacity), shape)`.
- Export renderers must match the on-screen result:
  - **Android** (`AndroidPlatform.kt` `drawImageLayer`): build a `Path` with `addRoundRect(RoundRectF(rect, radii = per-corner 8-float array))`, `canvas.clipPath` before `drawBitmap`, then `drawPath` with a stroke `Paint`.
  - **iOS** (`IosPlatformRendering.kt`): replace `CGContextClipToRect` with a `CGPath` built from per-corner arcs (`CGPathAddArcToPoint` × 4), clip to it, draw the image, then `CGContextAddPath` + `CGContextStrokePath`.
- `wrapWidth`/transform rules are unchanged; corner/stroke apply in the layer's local (unrotated) box — rotate/flip after.

## Quick verification

1. Import a Canva design with rounded, stroked photo frames on the dashboard, publish it.
2. `GET /api/mobile/templates/{id}` → the photo layers show `cornerRadius ≈ 0.07–0.09`, `strokeColorHex`, `strokeWidth: 2`.
3. On device: corners rounded, border hugging the rounded outline, and a per-corner test (e.g. only `topLeft: true`) rounds/strokes exactly one corner.
