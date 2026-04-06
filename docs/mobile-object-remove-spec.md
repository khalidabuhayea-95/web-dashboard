# Mobile Object Removal Spec

Last updated: 2026-04-06

## Objective

Add a synchronous mobile object-removal capability that accepts an image plus a user-painted mask, runs Replicate `allenhooo/lama`, and returns the processed image directly in the response.

## Backend Contract

### Remove object

- Route: `POST /api/mobile/media/object-remove`
- Content type: `multipart/form-data`
- Fields:
  - `image` required, `image/png` or `image/jpeg`
  - `mask` required, `image/png`
- Auth:
  - mobile signing headers when `MOBILE_API_KEY_ID` and `MOBILE_API_SIGNING_SECRET` are configured
- Response:
  - `200` with the edited image bytes

Validation and normalization:
- reject empty uploads
- reject unsupported mime types
- decode both uploads safely
- normalize JPEG EXIF orientation before checking mask dimensions
- require identical image and mask dimensions
- require the mask to contain at least one selected pixel
- resize both image and mask together so the long edge is at most `2048`

Storage flow:
- store normalized image and mask in a private input bucket
- create short-lived signed URLs for Replicate
- never expose the Replicate API token to clients
- best-effort delete staged inputs after completion

## Provider Behavior

- Provider: Replicate
- Model: `allenhooo/lama`
- Version: `cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72`
- Inputs:
  - signed image URL
  - signed mask URL
- Runtime rules:
  - retry one transient provider failure (`429`, `5xx`, or network error)
  - wait inline for provider status until terminal state
  - immediately download final output because Replicate URLs expire
  - stream the final output back to mobile

## Mobile Integration Contract

The mobile app should:

1. Export the visible image bitmap.
2. Export a same-size PNG mask where the removal region is painted white.
3. Call `POST /api/mobile/media/object-remove`.
4. Wait for the binary image response.
5. Replace the current image source with the returned bytes on success.
6. Keep the original image locally for undo.

## Environment Variables

- `REPLICATE_API_TOKEN`
- `OBJECT_REMOVE_REPLICATE_MODEL`
- `OBJECT_REMOVE_REPLICATE_VERSION`
- `OBJECT_REMOVE_INPUT_BUCKET`
