# Template Preview MP4 Generation Spec

## Objective

Generate and persist a silent MP4 preview for video and animated templates whenever the template is saved in the editor, and use that generated preview in place of the old static preview wherever template preview media is shown.

Target users:

- internal dashboard users editing animated and video templates
- mobile developers consuming published template previews
- dashboard/library users browsing template cards and opening the editor

Success metric:

- after saving an animated or video template, the system generates a fresh silent MP4 preview
- the latest successful preview replaces the older static preview pointer for animated/video preview surfaces
- reopening the template uses the new MP4 preview without requiring manual regeneration

Affected surfaces:

- `web`
- `api`
- `template persistence`
- `mobile read APIs`

Assumptions:

- audio remains out of scope
- static templates may continue to use image thumbnails unless product explicitly wants MP4 previews for all templates
- preview generation may be asynchronous and should not block template save completion

## Current behavior today

- Saving a template in the editor currently happens in [`src/components/editor/Toolbar.tsx`](/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/src/components/editor/Toolbar.tsx), which sends:
  - `data`
  - `canvasSize`
  - taxonomy fields
  - `thumbnailDataUrl`
- The save API in [`src/app/api/templates/route.ts`](/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/src/app/api/templates/route.ts) stores `thumbnailDataUrl` and updated template data, but there is no preview MP4 generation step.
- The editor timeline already has a preview pointer model under `design.timeline.preview` in [`src/store/editorStore.ts`](/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/src/store/editorStore.ts), with fields such as:
  - `url`
  - `posterUrl`
- The Prisma `Template` model in [`prisma/schema.prisma`](/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/prisma/schema.prisma) currently stores first-class preview-related fields only for static preview:
  - `thumbnailDataUrl`
  - there are no dedicated MP4 preview columns yet
- The timeline UI in [`src/components/editor/PagesTimeline.tsx`](/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/src/components/editor/PagesTimeline.tsx) can display a video preview when `timeline.preview.url` exists.
- Mobile template APIs and dashboard lists still primarily rely on `thumbnailDataUrl` for template preview display.
- There is no existing MP4 rendering dependency in the repo today:
  - no `ffmpeg`
  - no `remotion`
  - no dedicated render worker package

## Scope and non-goals

### In scope

- define when preview MP4 generation should run
- define where preview MP4 metadata should be stored
- define which surfaces should use the new preview MP4
- define save flow behavior and async job behavior
- define fallback behavior when preview generation is missing or failed
- define API contract deltas for dashboard and mobile consumers

### Non-goals

- adding audio to template previews
- implementing full export-grade rendering for end-user downloads
- introducing a public end-user preview editor outside current internal surfaces
- changing template thumbnail generation for non-animated static templates unless required as fallback

## User flows or system behavior

### 1. Save animated or video template

1. User edits a template in the editor.
2. User clicks `Save`.
3. Template JSON and thumbnail image are saved immediately.
4. Backend decides whether this template requires MP4 preview generation.
5. If required, backend enqueues a preview generation job.
6. Save returns successfully without waiting for full MP4 render completion.
7. UI marks preview as `queued` or `processing`.
8. When generation completes, the preview pointer is updated to the latest MP4.

### 2. Open existing animated or video template

1. User opens the template in the editor.
2. Editor loads template data as normal.
3. If a preview MP4 exists, the timeline preview row uses it.
4. If MP4 does not exist or failed, timeline falls back to live canvas preview behavior.

### 3. Browse template library

1. Dashboard template cards request template summary data.
2. If template has a preview MP4, the card can use:
   - MP4 preview for motion-capable surfaces, or
   - `posterUrl` as the static image fallback
3. If template has no MP4 preview, continue using `thumbnailDataUrl`.

### 4. Mobile template consumption

1. Mobile template detail/list routes return current thumbnail fields as before.
2. For templates with generated MP4 previews, API also returns preview metadata.
3. Mobile can decide whether to:
   - autoplay preview video in supported browsing surfaces
   - use poster image in list surfaces
   - ignore the MP4 initially and continue using poster only

## Functional requirements

### When MP4 preview generation is required

Preview generation must run after save when either condition is true:

- template contains at least one `video` layer
- template contains animation timeline data that makes the template motion-bearing

Recommended detection rules:

- any layer with `mediaAnimationType !== "NONE"`
- any layer whose `timelineStartMs` / `timelineEndMs` implies timeline-controlled visibility
- any frame containing video content
- any normal video layer

Static templates with no animation and no video may continue to use only `thumbnailDataUrl`.

### Save behavior

- Save must not block on MP4 render completion.
- Save response should return current preview status metadata.
- If a newer save occurs while an older preview render is queued or processing, the older job result must not overwrite the newer template version preview.

### Replacement behavior

For animated/video templates, the generated preview MP4 becomes the preferred preview asset.

Preferred usage order:

1. `preview.url` for motion-capable preview surfaces
2. `preview.posterUrl` for static fallback image
3. `thumbnailDataUrl` only when no preview metadata exists

This means the old static preview is not deleted immediately, but it is no longer the preferred preview source for animated/video templates.

### Preview content rules

- generated preview must be silent
- generated preview must reflect:
  - current layer order
  - current layer timing
  - current animation settings
  - current frame-contained media composition
  - current colors and text
- generated preview duration must equal the effective template duration
- generated preview should use the current canvas aspect ratio

### Failure and fallback

- If render job fails, the save itself still succeeds.
- Failed preview generation must not remove the previous successful preview.
- Editor timeline and template cards must fall back gracefully:
  - editor: live canvas preview
  - dashboard/mobile static surfaces: `thumbnailDataUrl` or `posterUrl`

## API and data contracts

### Persisted template data

Recommended persisted preview metadata location:

- store preview metadata in dedicated `Template` database columns
- optionally mirror those values into `data.timeline.preview` in editor responses only if the editor still benefits from a design-local preview object

Recommended Prisma/database delta on `Template`:

| Field | Type | Summary | Compatibility |
| --- | --- | --- | --- |
| `previewVideoUrl` | `String?` | Silent MP4 preview asset URL. | Additive, non-breaking. |
| `previewPosterUrl` | `String?` | Poster image URL for the MP4 preview. | Additive, non-breaking. |
| `previewStatus` | `String?` | `not_requested`, `queued`, `processing`, `ready`, or `failed`. | Additive, non-breaking. |
| `previewDurationMs` | `Int?` | Effective preview duration in milliseconds. | Additive, non-breaking. |
| `previewVersion` | `Int?` | Template version this preview corresponds to. | Additive, non-breaking. |
| `previewError` | `String?` | Last failure message if preview generation failed. | Additive, non-breaking. |
| `previewUpdatedAt` | `DateTime?` | Last preview metadata update time. | Additive, non-breaking. |

Recommended database representation:

```ts
model Template {
  // existing fields...
  thumbnailDataUrl  String?
  previewVideoUrl   String?
  previewPosterUrl  String?
  previewStatus     String?
  previewDurationMs Int?
  previewVersion    Int?
  previewError      String?
  previewUpdatedAt  DateTime?
}
```

If the editor still wants a local `timeline.preview` object, it should be derived from these DB fields when loading/saving templates rather than treated as the primary persistence source.

### Template save API

Endpoint:

- `POST /api/templates`

Change summary:

- save continues to persist template data and thumbnail
- response should also include current preview status metadata
- backend should enqueue preview generation for motion-bearing templates

Response delta example:

```json
{
  "template": {
    "id": "template-id",
    "version": 12,
    "thumbnailDataUrl": "https://...",
    "preview": {
      "status": "queued",
      "url": null,
      "posterUrl": "https://...",
      "durationMs": 8200,
      "version": 12,
      "updatedAt": 1775660000000,
      "error": null
    }
  }
}
```

Compatibility impact:

- non-breaking additive change

### Dashboard/mobile template reads

Endpoints affected:

- `GET /api/templates`
- `GET /api/mobile/templates`
- `GET /api/mobile/templates/:id`

Change summary:

- return preview metadata when available
- keep existing thumbnail fields

Recommended summary/detail additions:

```json
{
  "previewVideoUrl": "https://.../preview.mp4",
  "previewPosterUrl": "https://.../preview-poster.png",
  "preview": {
    "status": "ready",
    "url": "https://.../preview.mp4",
    "posterUrl": "https://.../preview-poster.png",
    "durationMs": 8200
  }
}
```

Compatibility impact:

- non-breaking additive change
- `previewVideoUrl` and `previewPosterUrl` are top-level aliases for mobile clients that prefer flat DTO fields

## Migration and compatibility

### Existing templates

- existing templates without preview metadata remain valid
- schema migration is required to add the new preview columns
- no content migration is required before rollout
- preview metadata can be lazily created on next save

### Version safety

Preview generation must be version-aware:

- preview job must carry `templateId` and `templateVersion`
- when a job finishes, it should only write preview metadata if the template still matches that version
- if template version changed while the job was running, discard the stale preview result

### Rollout compatibility

- dashboard editor can start reading `timeline.preview` immediately
- dashboard/mobile routes can add a top-level `preview` object without breaking current clients
- old clients may keep using `thumbnailDataUrl`
- if `data.timeline.preview` is still returned to the editor, it should be derived from DB preview fields to avoid dual sources of truth

## Technical considerations

### Rendering strategy

The repo does not currently include an MP4 renderer, so this spec must choose one explicitly.

Recommended phase 1 strategy:

- introduce a dedicated server-side preview render worker
- render template frames from persisted editor JSON
- encode silent MP4 output

Why:

- avoids relying on the open browser tab after save
- produces consistent results for mobile and dashboard consumers
- keeps preview generation available for retries and backfills

Alternative strategy not recommended as primary:

- generate the MP4 in-browser after save using the current editor canvas and upload it

Why not primary:

- tied to browser tab lifecycle
- harder to make retryable and version-safe
- weaker for future backfills and automation

### Render fidelity requirements

Renderer must support at minimum:

- text
- images
- videos
- frames
- layer transforms
- timeline visibility windows
- current animation set used by editor

If the renderer cannot support all animation types on day one, it must:

- support a defined subset
- mark unsupported animation types in logs/preview metadata
- still produce a preview instead of failing the whole save unless the render is fundamentally impossible

### Storage

Recommended storage outputs per generated preview:

- MP4 asset
- poster PNG asset

Both should live in the same asset storage system already used for editor/template media, while their pointers and status live in the `Template` database record.

### Background job model

Recommended job lifecycle:

1. save template
2. compute whether motion preview is required
3. write preview status = `queued`
4. enqueue background render job
5. job writes status = `processing`
6. on success write to `Template`:
   - `previewStatus = ready`
   - `previewVideoUrl`
   - `previewPosterUrl`
   - `previewDurationMs`
   - `previewVersion`
   - `previewUpdatedAt`
   - `previewError = null`
7. on failure write to `Template`:
   - `previewStatus = failed`
   - `previewError`
   - `previewUpdatedAt`

## Validation plan

### Unit coverage

- motion-bearing template detection
- preview metadata merge/update logic
- version-aware stale job rejection
- fallback preference order for preview selection

### Integration coverage

- save static template: no MP4 job required
- save animated image/text template: MP4 job queued
- save video template: MP4 job queued
- save template twice quickly: only latest version preview survives
- failed preview job preserves previous ready preview

### Manual QA scenarios

- save animated template and confirm preview status transitions from queued to ready
- reopen template and confirm timeline uses generated preview MP4
- update animation and save again, then confirm preview changes
- save video template and confirm preview duration matches actual video duration
- browse dashboard list and confirm preview fallback is correct

### Regression focus areas

- ordinary static template save flow
- publish/unpublish flow
- mobile template list/detail responses
- editor open/reopen for templates with no preview metadata

## Acceptance criteria

- Saving an animated or video template queues MP4 preview generation automatically
- Save succeeds even if preview generation is asynchronous
- Latest successful MP4 preview replaces the older preview pointer for motion-bearing templates
- Preview metadata is version-safe and stale jobs cannot overwrite newer saves
- Editor timeline uses generated MP4 preview when ready
- Dashboard/mobile APIs can expose preview metadata without breaking existing consumers
- Static templates without motion continue to work with thumbnail-only preview

## Open questions and risks

- What rendering engine should be used for MP4 generation in this stack:
  - custom canvas + encoder
  - browser-driven headless capture
  - another dedicated renderer
- Which surfaces should autoplay preview MP4 versus use poster image only
- Whether dashboard template grid should immediately switch from thumbnail to video preview for motion templates
- Whether unsupported animation types should downgrade gracefully or fail preview generation for that template

## Definition of Ready

- Rendering strategy selected and approved
- Storage location/pattern for preview MP4 and poster assets agreed
- Background job execution model agreed
- API response deltas approved for dashboard and mobile consumers
- Acceptance criteria are testable with:
  - animated non-video template
  - video template
  - mixed frame + animation template
  - static template fallback

## Delivery summary

This feature adds a proper generated MP4 preview lifecycle for motion-bearing templates. Save remains fast, preview generation happens asynchronously, preview metadata is stored in dedicated `Template` database fields, and all motion-capable surfaces prefer the new MP4 preview while keeping static fallbacks safe.
