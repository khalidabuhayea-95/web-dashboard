# Image and Shape Animation

## Images
| Effect | Implementation | Status | Guidance |
|---|---|---|---|
| Ken Burns | loop `ken-burns`: triangle wave, scale 1.04→1.12, x 0→−20, period 16 s | ✅ product-kenburns | triangle = ping-pong, so it is seamless; keep the scale change ≤8% over ≥10 s |
| Parallax | `parallax-drift` with a different `amplitude` per depth layer (bg 0.5, mid −1.5, fg 1) | ✅ | opposite signs for fore/back layers give depth |
| Pan | `ken-burns` with scale fixed, x only, or a custom loop | ✅ engine | |
| Zoom | `zoom-in` (1.6→1, expoOut 900) | ✅ countdown, transitions | |
| Reveal | `iris-in` (4-side clip), `wipe-*`, `mask-reveal-up` | ✅ | clip is cheap |
| Mask | photo inside a frame/arch = Canva frame + clip path | 👁 Canva/Andalusi | animate the image inside the frame (Ken Burns), not the frame |
| Video background | pre-rendered loop | 👁 Canva real-estate and travel previews show constant full-frame energy (3–7) from video bgs | the cheapest way to get rich ambient motion on device |

## Shapes
| Effect | Implementation | Status |
|---|---|---|
| Draw (stroke) | `draw-stroke`: dashoffset (web) / PathMeasure.getSegment (Compose) | ✅ web; Compose code written, not compiled |
| Rotate | `spin-slow` (saw, 20–60 s) | ✅ islamic-ramadan |
| Scale | `pop`, `breathe` | ✅ |
| Morph | 👁 Jitter "View Cart Button: Split" (icons → pill) and "Morph: Inflating Text" | ⚠️ not implemented. Needs paths with the same command structure, or a library (Lottie shape layers, Rive). For KMP, use Lottie/Rive for morphs instead of a custom path morph. |
| Liquid | ⚠️ not implemented | Lottie/Rive or shader (Skia RuntimeEffect / AGSL). Out of scope for templates. |

## 3D
- `flip-in-y` uses rotateY −90→0 with backOutSoft and perspective 900 px (web). On Compose, use `cameraDistance = 12·density`. ✅ card-flip-3d.
- 👁 Jitter "Card Flip" uses a full 360° Y turn with the card's backside, about 3.6 s per cycle.
- Rule: 3D is for product/fintech/promo only. Keep it out of invitations.

## Advanced effects
| Effect | Status | Cost |
|---|---|---|
| Motion blur | ⚠️ not implemented (needs multi-sample or a directional blur shader) | high |
| Glitch / RGB split | ✅ `glitch-in`: stepped keyframes + RGB text-shadow | medium (text-shadow) |
| Distortion / displacement | 👁 Jitter recipes list displacement, glass and bulge effects (read, not built) | shader; high |
| Light sweep / leak | ✅ cinematic-glitch (gradient layer translate) | cheap (transform) |
| Particles | ✅ procedural canvas | **expensive**: 30 fps under 4× CPU throttle; 96 ms/frame in Skia CPU raster. Pre-render or limit to ≤30 small particles. |
| Gradient flow | ✅ 3 radial blobs | expensive when full-frame per frame; prefer a video loop |
