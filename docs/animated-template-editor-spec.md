# Animated Template Import And Timeline Editor Spec

## Objective

Enable dashboard users to import animated Canva mobile templates, edit layer timing and animation inside the web editor, and preview the result as a silent MP4 without adding audio in this phase.

Target user: internal dashboard users creating and maintaining mobile video templates.

Affected surfaces: `web`, `api`, `canva extension import`, `mobile export compatibility`.

Success metric:

- An imported animated Canva phone template opens in the editor with duration metadata.
- The editor shows a bottom timeline with a playhead, time ruler, selected-layer trim row, and whole-template preview row.
- Users can change animation type per layer and trim when the selected layer appears.
- Saving and reopening preserves timing and animation data.
- Mobile export receives the expected animation fields without breaking existing static templates.

Assumptions:

- Audio import, audio playback, and audio editing are explicitly out of scope for phase 1.
- Animated templates will primarily target portrait mobile formats.
- Canva animation import is best-effort because Canva does not expose all animation metadata consistently in the currently captured payloads.

## Current Behavior Today

- The bottom editor rail in [`src/components/editor/PagesTimeline.tsx`](/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/src/components/editor/PagesTimeline.tsx) only shows `ElementPublishStrip` and zoom controls.
- The editor state in [`src/store/editorStore.ts`](/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/src/store/editorStore.ts) has no generic animation or layer timeline fields. It only has `videoStart`, `videoEnd`, and `videoDuration` for video trimming.
- The canvas/editor UI already supports trimming a selected video element, but not scheduling generic layer visibility over time.
- Templates are saved through [`src/app/api/templates/route.ts`](/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/src/app/api/templates/route.ts) as `data + thumbnailDataUrl`. There is no preview MP4 contract today.
- The Canva extension import route in [`src/app/api/tools/canva-import/extension-import/route.js`](/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/src/app/api/tools/canva-import/extension-import/route.js) imports static layer payloads and snapshots, not animation metadata.
- Mobile export in [`src/lib/templates/mobileProject.js`](/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/src/lib/templates/mobileProject.js) already understands `mediaAnimationType`, `mediaAnimationMode`, `mediaAnimationStrength`, and `mediaAnimationSpeed`, but phase 1 only needs the editor to author `mediaAnimationType` and `mediaAnimationMode`.

## Scope And Non-Goals

In scope:

- Add animated-template metadata to editor JSON and editor state.
- Add a bottom timeline UI with the four requested rows.
- Let users trim the selected layer's visible time window.
- Add an animation section for per-layer animation settings.
- Preserve animation metadata through save, reload, and mobile export.
- Import Canva duration, scene timing, and animation metadata when available.
- Generate and display a silent MP4 template preview for animated templates.

Non-goals for phase 1:

- Audio tracks, audio import, waveform UI, or audio export.
- Full non-linear editing with one visible track per layer.
- Custom keyframe authoring or curve editors.
- Animation speed and animation strength controls.
- Transition authoring between pages/scenes beyond preserving imported timing/order.
- Requiring perfect 1:1 Canva animation parity when Canva metadata is hidden or unsupported.

## User Flows Or System Behavior

### 1. Import animated Canva template

1. User imports an animated Canva mobile template through the extension flow.
2. The extension sends the current static payload plus optional timeline and animation metadata when available.
3. The import API saves the template with animation-aware JSON fields.
4. The editor opens the template in animation mode with playhead at `0`.
5. A silent preview MP4 generation job is queued automatically.
6. If Canva animation names are detectable and supported, the mapped animation is applied to matching layers.
7. If Canva animation names are missing or unsupported, the layer imports with `mediaAnimationType = "NONE"` and a raw source token may be preserved for diagnostics.

### 2. Play and scrub timeline

1. User presses play in the editor timeline.
2. A vertical playhead line moves across the timeline and updates the canvas preview.
3. The first row shows the current playback time.
4. The second row shows second-based time slots across the full animated duration.
5. The fourth row shows the whole-template preview using the latest preview MP4 when available.
6. Scrubbing the playhead updates both the canvas and the preview row.

### 3. Trim selected layer visibility

1. User selects a layer.
2. The third row shows one editable bar for the selected layer only.
3. The left and right trim handles control when that layer appears and disappears.
4. Trimming is constrained to the owning page/scene duration.
5. If no layer is selected, the third row shows an empty instructional state and is not editable.

### 4. Change animation per layer

1. User selects a layer.
2. The inspector shows an `Animation` section.
3. User chooses animation type and mode.
4. Changes update the live canvas preview and are persisted on save.
5. If the selected layer is unsupported for animation, the section stays read-only and explains why.

### 5. Multi-page behavior

1. Each editor page is treated as one animated scene with its own `durationMs`.
2. The whole-template timeline represents all pages concatenated in page order.
3. The selected-layer trim row only edits layers on the active page.
4. During playback, the canvas switches active page automatically when the playhead enters the next page segment.

## Functional Requirements

### Timeline UI

- The bottom timeline must contain four horizontal rows in this order:
  1. current-time row with the active playhead marker
  2. seconds ruler row
  3. selected-layer trim row
  4. whole-template preview row
- The playhead must scrub both by drag and by click-to-seek.
- Time labels must display in `mm:ss` on the ruler and `mm:ss.cs` for the active playhead label.
- Timeline controls must include play, pause, and jump-to-start.
- Zoom controls already present in the rail must remain available.

### Selected-layer trim row

- Only the currently selected layer is editable in the third row.
- The selected-layer bar must expose left and right trim handles.
- Minimum visible duration per layer is `100ms`.
- Trimming cannot move outside the selected layer's owning page duration.
- A trimmed layer must be hidden on canvas before `timelineStartMs` and after `timelineEndMs`.

### Animation settings

- Add a new `Animation` section for selectable layers in the editor inspector or toolbar.
- The editor-facing picker should use the animation naming style shown in the provided screenshots.
- Phase 1 should expose these user-facing options in the editor:
  - `None`
  - `Fade`
  - `Wipe`
  - `Wipe Gradient`
  - `Slide`
  - `Zoom`
  - `Zoom Fade`
  - `Circular`
  - `Circular Fade`
  - `Radial`
- Phase 1 should treat these screenshot labels as aliases, not separate renderer effects:
  - `Dissolve` -> `FADE`
  - `Radial gradient` -> `RADIAL`
- The following screenshot animations should be tracked as future candidates, not phase 1 commitments, unless the mobile renderer is extended first:
  - `Shake`
  - `Flicker`
  - `Rotation`
  - `Bounce`
  - `Wiggle`
  - `Heart Beat`
  - `Random`
- The normalized internal animation enum stored in template data for phase 1 should be:
  - `NONE`
  - `FADE`
  - `WIPE`
  - `WIPE_GRADIENT`
  - `SLIDE`
  - `ZOOM`
  - `ZOOM_FADE`
  - `CIRCULAR`
  - `CIRCULAR_FADE`
  - `RADIAL`
- The supported animation mode enum must reuse:
  - `IN`
  - `OUT`
  - `LOOP`
- Default values for missing animation fields must preserve current export behavior:
  - `mediaAnimationType = "NONE"`
  - `mediaAnimationMode = "IN"`
- Users must be able to change animation type per layer without requiring a Canva import.

### Preview MP4

- Animated templates must have a silent MP4 preview asset.
- Preview generation must start automatically after animated import and after save when animated data changed.
- The preview row must use the most recent successful MP4 preview if available.
- If preview generation is pending or failed, the timeline must still work using live canvas playback and show a preview status badge.

### Canva import

- The extension import must continue to support current static payloads.
- If animation metadata is available, the extension should send:
  - total duration
  - per-page or per-scene duration
  - per-layer visible window if available
  - raw Canva animation token if available
  - mapped internal animation token if available
  - preview video URL or poster metadata if Canva exposes it
- If Canva does not expose animation metadata for a layer, import must still succeed with default timing and `NONE` animation.
- Import warnings must include a note when animation metadata was dropped, unsupported, or unmapped.

### Save, reload, and export

- Saving a template must persist timing and animation metadata in `template.data`.
- Reloading the editor must restore the same duration, trim windows, and animation settings.
- Mobile export must continue to emit current animation fields from `mediaFilters(item)`.
- Static templates without animation metadata must continue to load unchanged.

## API And Data Contracts

### 1. Persisted editor JSON in `Template.data`

Recommended persisted shape delta:

| Model | Field | Type | Summary | Compatibility |
| --- | --- | --- | --- | --- |
| `EditorDesign` | `version` | `number` | Bump to `2` when animated metadata is present. | Non-breaking. Old templates may stay on `1`. |
| `EditorDesign` | `timeline` | `object?` | Template-level animation metadata. | Optional. |
| `EditorPage` | `durationMs` | `number?` | Duration of this page/scene. | Optional for static templates. |
| `EditorElement` | `timelineStartMs` | `number?` | Visible start time within page. | Optional. |
| `EditorElement` | `timelineEndMs` | `number?` | Visible end time within page. | Optional. |
| `EditorElement` | `mediaAnimationType` | `string?` | Internal animation enum. | Optional; already understood by mobile export. |
| `EditorElement` | `mediaAnimationMode` | `string?` | `IN`, `OUT`, or `LOOP`. | Optional; already understood by mobile export. |
| `EditorElement` | `sourceAnimationLabel` | `string?` | Original Canva or UI-facing label such as `Dissolve` or `Radial gradient`. | Optional. |
| `EditorElement` | `sourceAnimationName` | `string?` | Raw imported Canva animation token for diagnostics. | Optional. |

Recommended `EditorDesign.timeline` shape:

```ts
type PreviewStatus = "not_requested" | "queued" | "processing" | "ready" | "failed";

interface EditorDesignTimeline {
  enabled: boolean;
  fps: number;
  totalDurationMs: number;
  preview: {
    status: PreviewStatus;
    url?: string | null;
    posterUrl?: string | null;
    generatedAt?: string | null;
    error?: string | null;
  };
  source?: {
    origin: "manual" | "canva";
    animatedImport: boolean;
  };
}
```

Compatibility rules:

- If `timeline` is absent, the template behaves as static.
- If `durationMs` is absent on a page, it defaults to `5000` only when the user enables animation for that page.
- If `timelineEndMs` is absent on an element, it resolves to the owning page duration.
- If `sourceAnimationLabel` is present but the normalized `mediaAnimationType` is unsupported, the editor must fall back to `NONE` and keep the source label for diagnostics.

### 2. `POST /api/templates`

Current route: [`src/app/api/templates/route.ts`](/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/src/app/api/templates/route.ts)

Change summary:

- Keep the route shape unchanged.
- Expand accepted `data` validation to allow animated template fields.
- Preserve backward compatibility for existing static templates.

Request delta:

```json
{
  "id": "template-id-optional",
  "name": "Animated template",
  "thumbnailDataUrl": "data:image/png;base64,...",
  "data": {
    "version": 2,
    "activePageId": "page-1",
    "timeline": {
      "enabled": true,
      "fps": 30,
      "totalDurationMs": 15000,
      "preview": {
        "status": "queued",
        "url": null
      }
    },
    "pages": [
      {
        "id": "page-1",
        "durationMs": 15000,
        "elements": [
          {
            "id": "layer-1",
            "timelineStartMs": 0,
            "timelineEndMs": 4500,
            "mediaAnimationType": "FADE",
            "mediaAnimationMode": "IN"
          }
        ]
      }
    ]
  }
}
```

Compatibility impact:

- Non-breaking.
- Older clients can continue posting templates without any animation fields.

### 3. `POST /api/tools/canva-import/extension-import`

Current route: [`src/app/api/tools/canva-import/extension-import/route.js`](/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/src/app/api/tools/canva-import/extension-import/route.js)

Change summary:

- Keep the current import payload valid.
- Accept optional timeline and animation metadata from the extension.
- Persist mapped animation fields into `template.data`.

Recommended request delta:

```json
{
  "imageDataUrl": "data:image/png;base64,...",
  "thumbnailDataUrl": "data:image/png;base64,...",
  "fabricData": {},
  "editorData": {},
  "timelineData": {
    "totalDurationMs": 15000,
    "fps": 30,
    "pages": [
      {
        "sourceSceneId": "scene-1",
        "durationMs": 15000,
        "elements": [
          {
            "importNodeId": "node-123",
            "startMs": 0,
            "endMs": 4500,
            "rawAnimationName": "rise",
            "animationType": "SLIDE",
            "animationMode": "IN"
          }
        ]
      }
    ],
    "previewVideoUrl": "https://..."
  }
}
```

Recommended response delta:

```json
{
  "message": "Canva template imported from Chrome extension.",
  "template": {},
  "warnings": [],
  "animationImported": true,
  "previewStatus": "queued"
}
```

Compatibility impact:

- Non-breaking. Existing extension builds can continue sending static payloads.
- Unknown `timelineData` fields must be ignored, not rejected.

### 4. Preview render endpoints

New routes:

| Endpoint | Method | Purpose | Compatibility |
| --- | --- | --- | --- |
| `/api/templates/[id]/preview-video` | `POST` | Queue or regenerate a silent MP4 preview for the current saved template. | New endpoint. |
| `/api/templates/[id]/preview-video` | `GET` | Return preview render status and latest asset URL. | New endpoint. |

Proposed `POST` response:

```json
{
  "status": "queued"
}
```

Proposed `GET` response:

```json
{
  "status": "ready",
  "url": "https://...",
  "posterUrl": "https://...",
  "durationMs": 15000,
  "generatedAt": "2026-04-07T10:00:00.000Z",
  "error": null
}
```

Storage contract:

- Preview MP4 and poster assets should be stored in the same owner-scoped media storage used for editor-managed assets.
- The persisted pointer should live inside `template.data.timeline.preview` for phase 1 to avoid a Prisma schema change.

## Migration And Compatibility

- No Prisma migration is required if preview metadata remains inside `Template.data`.
- Validation schemas must be updated to allow animated JSON fields.
- Existing templates without `timeline` remain static and continue to save/load unchanged.
- Old Canva extension versions continue importing static templates because `timelineData` is optional.
- Mobile export remains backward compatible because it already tolerates missing `mediaAnimation*` fields. Phase 1 only requires `mediaAnimationType` and `mediaAnimationMode` to be authored.
- When a user enables animation on an existing static template, the editor initializes:
  - `timeline.enabled = true`
  - `timeline.fps = 30`
  - each animated page `durationMs = 5000` unless a different page duration is chosen
  - each existing element `timelineStartMs = 0`
  - each existing element `timelineEndMs = page.durationMs`

## Technical Considerations

- Timeline playback state such as `playheadMs`, `isPlaying`, and drag state should live in editor store UI state and should not be persisted.
- Page switching during playback should be derived from the accumulated `durationMs` values across pages.
- Canvas rendering should use time-based visibility so layers outside their trim window are not drawn.
- The current single-video trim code can be reused for timeline interaction patterns, but it is not sufficient as-is for generic element timing.
- Preview MP4 generation is a new system dependency. The implementation needs a render worker capable of producing a silent MP4 from saved template JSON.
- Recommended render strategy:
  - preferred: dedicated preview render worker using a deterministic template renderer
  - acceptable fallback: headless browser capture if deterministic rendering can match the editor reliably
- The preview row should derive filmstrip thumbnails from the generated MP4 on the client or via lightweight poster extraction. Separate stored thumbnail strips are not required in phase 1.
- Canva animation import should maintain a mapping layer such as `CANVA_TO_EDITOR_ANIMATION_MAP` and fall back to `NONE` when no mapping exists.
- Imported raw Canva animation names should be preserved for debugging when mapping fails.
- The editor should maintain a label-to-enum mapping table so the picker can show screenshot-style labels while storing normalized values.
- Recommended phase 1 label mapping:
  - `None` -> `NONE`
  - `Fade` -> `FADE`
  - `Dissolve` -> `FADE`
  - `Wipe` -> `WIPE`
  - `Wipe Gradient` -> `WIPE_GRADIENT`
  - `Slide` -> `SLIDE`
  - `Zoom` -> `ZOOM`
  - `Zoom Fade` -> `ZOOM_FADE`
  - `Circular` -> `CIRCULAR`
  - `Circular Fade` -> `CIRCULAR_FADE`
  - `Radial` -> `RADIAL`
  - `Radial gradient` -> `RADIAL`
- Silent preview MP4 generation should be debounced or queued after save to avoid unnecessary rerenders during rapid edits.

## Validation Plan

Unit coverage:

- Timeline duration math across one-page and multi-page templates.
- Element visibility resolution from `timelineStartMs` and `timelineEndMs`.
- Animation field defaulting and schema normalization.
- Canva animation token mapping to internal enum.

Integration coverage:

- Save and reload animated template JSON through `POST /api/templates`.
- Import animated Canva payload through `POST /api/tools/canva-import/extension-import`.
- Preview video queue and status lifecycle through the new preview endpoints.
- Mobile export serialization of `mediaAnimationType`, `mediaAnimationMode`, and page duration metadata.

Manual QA scenarios:

- Import a Canva animated mobile template with at least one mapped animation.
- Import a Canva animated template where animation metadata is unavailable and confirm the fallback behavior.
- Select a layer, trim its visible window, play the timeline, save, and reload.
- Change animation type for text, image, shape, and video layers where supported.
- Confirm the preview MP4 updates after save and remains silent.
- Confirm static templates still open and save without timeline UI regressions.

Regression focus:

- Existing static Canva import behavior.
- Existing video element trimming behavior.
- Template save/list thumbnail behavior.
- Mobile template export for templates with no animation metadata.

## Acceptance Criteria

- Animated templates show the requested four-row timeline in the editor.
- The playhead scrubs the canvas and the preview row.
- The selected-layer row allows trimming when the selected layer appears.
- Per-layer animation type can be changed in the editor without Canva import.
- Animated save/reload preserves timing and animation values.
- Canva import stores duration and mapped animation data when available.
- The animation picker uses the screenshot-style labels while persisting normalized internal enum values.
- Canva import still succeeds when animation data is missing, with a warning rather than a hard failure.
- Animated templates generate and display a silent MP4 preview.
- Existing static templates and static Canva imports remain functional without migration errors.
- Mobile export receives the same phase 1 animation fields the editor stores.

## Open Questions And Risks

- Preview render implementation is not chosen yet. A render worker strategy must be approved before build starts.
- Canva may expose scene timing but not per-layer animation metadata consistently. Some imports will necessarily fall back to `NONE`.
- Whole-template MP4 regeneration cost may become expensive if every save triggers a full rerender. Queueing and deduplication strategy must be defined.
- Multi-page playback introduces cross-page canvas synchronization work that does not exist today.
- If preview MP4 rendering differs visually from live editor playback, users may distrust the preview row. Rendering parity needs an explicit quality bar.

## Definition Of Ready

- The render strategy for silent MP4 preview generation is chosen and staffed.
- The editor JSON contract for `timeline`, `durationMs`, `mediaAnimationType`, and `mediaAnimationMode` is approved.
- The Canva extension payload additions for `timelineData` are approved.
- The list of supported internal animation enums is approved.
- At least two real Canva animated template samples are available for QA.
- Validation schema changes and fallback behavior for legacy templates are agreed.
- Preview storage location and cleanup policy are defined.
- Rollback behavior is clear if preview rendering fails or the extension sends no animation data.

## Delivery Summary

This phase adds animated-template foundations without introducing audio. The recommended delivery path is:

1. Extend editor JSON and store state for page duration, layer visibility windows, and per-layer animation fields.
2. Replace the current bottom rail with the requested four-row animated timeline while preserving existing zoom controls.
3. Add the `Animation` section to the editor inspector and wire it to phase 1 animation type/mode using the existing mobile export vocabulary.
4. Extend Canva extension import with optional `timelineData` and best-effort animation mapping.
5. Add silent MP4 preview generation and show the resulting preview in the timeline row.

This plan is intentionally backward compatible with current static templates and current template save APIs, while making room for richer animation import once Canva metadata becomes more available.
