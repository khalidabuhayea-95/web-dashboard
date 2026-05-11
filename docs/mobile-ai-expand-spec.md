# Mobile AI Expand Spec

Last updated: 2026-05-06

## Objective

Add a synchronous mobile AI Expand capability that accepts one image plus target output dimensions, expands the image to fill the requested canvas, and returns the processed image directly in the response.

## Backend Contract

### Expand image

- Route: `POST /api/mobile/media/ai-expand`
- Content type: `multipart/form-data`
- Fields:
  - `image` required, `image/png` or `image/jpeg`
  - `targetWidth` required, integer
  - `targetHeight` required, integer
- Auth:
  - mobile signing headers when `MOBILE_API_KEY_ID` and `MOBILE_API_SIGNING_SECRET` are configured
- Response:
  - `200` with the expanded image bytes

Validation and normalization:
- reject empty uploads
- reject unsupported mime types
- decode the image safely
- normalize JPEG EXIF orientation
- require `targetWidth` and `targetHeight`
- require each target dimension to be at least `64`
- require each target dimension to be at most `1440`
- place the image into the requested target canvas automatically
- generate the expansion mask automatically on the server

Storage flow:
- store normalized inputs in a private input bucket
- create short-lived signed URLs for Replicate
- never expose the Replicate API token to clients
- best-effort delete staged inputs after completion

## Provider Behavior

- Provider: Replicate
- Model: resolved from one shared mobile setting used by both Android and iOS
- Supported models:
  - `allenhooo/lama`
  - `luma/reframe-image`
  - `bria/expand-image`
- Runtime rules:
  - mobile does not send a mask
  - mobile does not send a prompt
  - the server automatically creates the padded canvas and any model-specific mask inputs
  - Luma uses the original image plus the nearest supported aspect ratio derived from `targetWidth` and `targetHeight`
  - wait inline for provider status until terminal state
  - immediately download final output because Replicate URLs expire
  - resize the returned output back to the exact requested target dimensions if needed
  - stream the final output back to mobile

## Mobile Integration Contract

The mobile app should:

1. Keep the original selected image bytes.
2. Choose the target output size, for example `1080 x 1080`.
3. Call `POST /api/mobile/media/ai-expand`.
4. Send the original image plus `targetWidth` and `targetHeight`.
5. Wait for the binary image response.
6. Replace the preview/editor image with the returned bytes on success.
7. Keep the original image locally for undo.

## Environment Variables

- `REPLICATE_API_TOKEN`
- `AI_EXPAND_REPLICATE_MODEL`
- `AI_EXPAND_REPLICATE_VERSION`
