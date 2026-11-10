# Magnific Workflow

Verified via the Magnific MCP on 2026-11-05.
- **Balance:** 6,387 credits.
- **Plan:** Plus.
- **Unlimited mode:** it is NOT active through the MCP, so every generation costs credits.
- Do NOT automate the Magnific web app to reach Unlimited (Ali's rule).

## Models and costs (observed in prior batches)
| Use | Model | Cost (approx.) |
|---|---|---|
| Drafts, exploration | Z-Image | ~5 cr |
| High quality art, objects, letters | Nano Banana 2.1 (`imagen-nano-banana-2-1`) | 50–65 cr (65 observed 2026-11-05) |
| Finals, 2K | Seedream | ~35 cr |
| Background removal | images_remove_background | low |
| Video bg (if ever wanted) | Kling 2.5 5s 720p | ~140 cr |

Always run `simulate_cost` for a large batch and tell Ali the cost before spending.

## Rules
- **Never generate text inside images.** All Arabic text is added in Canva. In prompts write: "no text, no letters, no watermark". If the image has an empty area for text, describe it explicitly ("empty calm centre area for text").
- **Generate assets separately:**
  - the background (empty)
  - objects (on a plain background, then remove the background to get a transparent PNG)
  - ornaments/frames (centre transparent)
- **Aspect ratio** must match the canvas: 9:16 for 1080×1920, 4:5 for 1080×1350, 16:9 for thumbnails, 7:4 for business cards.
- **Style reference:** pass `references:[{type:"style", identifier}]` to keep a collection consistent.
- **Concurrency:** about 10 jobs at a time. TPM-quota failures are not charged, so retry them in groups of 4.
- **Organise:** one Magnific project per batch, named "قوالب الدعوات - الدفعة N" (or a category name).

## Prompt template
```
[subject/object], [material & lighting: soft warm key light, satin, gold leaf...],
[composition: object in lower third, empty calm centre for text],
[style: photoreal 3D render / watercolor / flat vector],
[palette hexes], high detail, clean edges,
no text, no letters, no calligraphy, no watermark, no people's faces
```

## Into Canva
Two ways to bring an image in:
- `upload-asset-from-url` with the image URL. This works for normal images; pikaso URLs are rejected.
- `create-upload-url` + a PUT.

Then place it with `edit-design` (`insert_fill`), and use `layer_element` to send it to the back. Agent-uploaded media cannot be moved into folders.
