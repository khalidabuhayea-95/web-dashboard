# Editor Frame System Spec

## Objective

Build a Canva-like frame system for the web editor so users can place images or videos inside reusable shape masks, then independently move, resize, rotate the frame and pan/zoom the media inside it.

Target user: dashboard editors building invitation, story, and mobile templates.

Affected surfaces: `web editor`, `template data`, `mobile/export compatibility`, `canva import compatibility`.

Success metric:

- Users can add a frame shape from the left panel.
- Users can drag an image or video onto a frame and see it clipped to the frame shape.
- Users can double-click a filled frame and pan/zoom its content without moving the frame.
- Saving and reopening preserves the frame shape, frame transform, content source, and content transform.
- Existing static templates and normal image/video drops remain unchanged.

Assumptions:

- Phase 1 focuses on editor-side frame creation and manual media drops, not automatic Canva frame import.
- Phase 1 uses one media item per frame, and that media item must support both images and videos.
- Phase 1 supports hard-edge clipping first. Feathered/soft edges are a later enhancement unless the chosen renderer implementation makes it cheap.
- The editor currently does not support multiple pages as a product behavior, so frame timing should follow the existing single active template/page behavior.

## Current Behavior Today

- The editor element model in `src/store/editorStore.ts` supports `text`, `image`, `video`, and basic shapes (`rect`, `circle`, `line`, `arrow`, `star`). It does not have a first-class `frame` element type.
- Images already support crop metadata (`sourceWidth`, `sourceHeight`, `cropX`, `cropY`, `cropWidth`, `cropHeight`) and render through `CanvasImageNode` in `src/components/editor/CanvasEditor.tsx`.
- Videos render through `CanvasVideoNode`, but do not currently share image crop metadata or frame-mask semantics.
- Built-in shapes live in `src/lib/editor/builtinShapes.ts` and are currently inserted as image elements from SVG data URLs. A “Picture frame” and “Light frame” exist visually, but they are decorative images, not drop targets or clipping containers.
- Drag/drop into the canvas is handled in `CanvasEditor.tsx` through `onDropAsset`. A dropped photo/video always becomes a new canvas element at the drop point.
- The left side menu already contains editor tabs such as `Elements`, `Category`, `Upload`, `Background`, `Layers`, `Resize`, and `Animation` in `src/components/editor/SidePanel.tsx`. Frames should be added as a new first-class side-menu tab directly below `Elements`.

## Scope And Non-Goals

In scope for phase 1:

- Add a first-class `frame` element type.
- Add a frame shape registry with the screenshot-style shapes: circle, rounded rectangle, square, diamond, triangle/inverted triangle, trapezoid, pentagon, hexagon, star, burst/seal, scalloped circle, arrow/tag-like frames, and basic geometric variants.
- Add a new `Frames` side-menu item directly below `Elements`, with frame cards visually matching Canva’s image-placeholder style from the screenshot.
- Render frames in Konva with shape-based clipping.
- Support one image or video child per frame as a mandatory phase 1 requirement.
- Support drop-to-frame from imported elements, uploads, photos, and videos.
- Support frame highlight while dragging media over a frame.
- Support content edit mode with pan and zoom.
- Persist frames in `EditorDesign` JSON.
- Preserve existing image/video insertion outside frames.

Non-goals for phase 1:

- Multiple media layers inside a frame.
- Text or arbitrary shape children inside a frame.
- Feathered/soft mask edges.
- Automatic detection/import of Canva frames.
- Server-side rendering/export changes beyond preserving data.
- Advanced snapping/alignment guides specific to frame content.
- Animated media replacement transitions.

## User Flows Or System Behavior

### 1. Add an empty frame

1. User opens the `Frames` side-menu item below `Elements`.
2. User sees the phase 1 frame preset grid.
3. User clicks a frame card.
4. Editor adds an empty frame element to the canvas.
5. Empty frames show a placeholder landscape thumbnail clipped to the selected shape, similar to Canva’s frame previews.

### 2. Drop media into a frame

1. User drags an image or video over the canvas.
2. Editor detects the pointer is inside a frame’s rendered bounds.
3. The frame highlights as the active drop target.
4. User drops the media.
5. The media is inserted into the frame instead of creating a normal top-level image/video element.
6. The media uses `cover` fit by default, centered inside the frame.

### 3. Drop media outside a frame

1. User drags an image or video over an empty canvas area.
2. No frame is highlighted.
3. On drop, the existing behavior remains: create a normal image/video element at the drop point.

### 4. Edit framed content

1. User double-clicks a filled frame or chooses `Edit content`.
2. Editor enters `frame-content-edit` mode for that frame.
3. Frame position/size/rotation are locked temporarily.
4. Dragging pans the media inside the frame.
5. Wheel/pinch or an inspector slider zooms the media inside the frame.
6. Clicking outside, pressing `Esc`, or confirming exits content edit mode.

### 5. Replace frame media

1. User drags a new image/video onto a filled frame or chooses `Replace`.
2. The frame keeps its shape and frame transform.
3. The new media replaces `frameContent.src`.
4. Existing `contentTransform` is preserved where possible.
5. If the old transform would leave empty regions for the new media, normalize to the closest valid cover transform.

## Functional Requirements

### Frame model

- A frame must be selectable, movable, resizable, rotatable, layerable, lockable, hideable, duplicatable, and deletable like other elements.
- A frame must expose:
  - frame transform: `x`, `y`, `width`, `height`, `rotation`, `scaleX`, `scaleY`
  - shape: frame preset id plus optional SVG path data
  - content: one image/video source or empty state
  - content transform: scale, offset X, offset Y, fit mode
- Empty frames must remain visible and selectable.
- Filled frames must render only the media visible through the frame mask.
- Image and video content must use the same frame placement rules: fill by default, preserve aspect ratio, support pan/zoom, support replacement, and save/reload correctly.

### Frame shape presets

- Phase 1 must include a reusable preset list in a new frame registry file, for example `src/lib/editor/framePresets.ts`.
- Each preset must include:
  - `id`
  - `name`
  - `width`
  - `height`
  - `viewBox`
  - `kind`: `rect`, `circle`, or `svgPath`
  - `pathData?`
  - `cornerRadius?`
  - `keywords`
- The first preset group should match the screenshot’s visual direction:
  - circle
  - rounded square
  - square
  - diamond
  - inverted triangle
  - trapezoid
  - pentagon
  - hexagon
  - star
  - angled star/diamond
  - octagon/tag
  - burst seal
  - scalloped circle
  - scalloped badge
  - banner/tag variants

### Content fitting

- Default media fit is `cover`.
- `cover` must fill the frame without distortion and may crop overflow.
- `contain` must fit the full media inside the frame and may show empty frame area.
- `manual` must keep the current content transform and allow direct pan/zoom.
- Replacing media must keep `contentTransform` but clamp it so the content does not expose empty areas in `cover` mode.

### Drag/drop

- Drag-over target detection must check topmost visible unlocked frames first.
- Highlight must appear only when the dragged payload is image/video media.
- Text, shape, and non-media payloads must keep their current drop behavior.
- Dropping media on an empty or filled frame must call a store action to set/replace frame content.
- Dropping media outside frames must keep the existing `addImageElement` / `addVideoElement` behavior.
- Drag/drop acceptance must include uploaded images, uploaded videos, imported image elements, imported animated/video elements, and existing editor asset payloads with `kind: "photo"` or `kind: "video"`.

### Content edit mode

- Double-clicking a filled frame enters content edit mode.
- In content edit mode:
  - selecting/draggable behavior applies to frame content, not the frame container
  - frame transform handles are hidden or disabled
  - cursor and visual outline communicate “editing content”
  - `Esc` exits without deleting the frame
- Pan updates `contentTransform.offsetX` and `contentTransform.offsetY`.
- Zoom updates `contentTransform.scale`.
- Content updates should record history at the end of a drag/zoom interaction, not every pointer move.

### Rendering

- Rendering should use Konva primitives where possible:
  - `Group` for frame transform
  - `clipFunc` or equivalent shape clipping for SVG path masks
  - `Konva.Image` for image/video content
  - placeholder image/landscape drawing for empty frames
- Use GPU-friendly media transform math where possible.
- Avoid converting the clipped content to a raster on every move.
- Keep frame and content transforms independent in code and data.

## API And Data Contracts

### `EditorElement` data delta

Change summary: add a new optional frame data structure to persisted editor JSON. This is non-breaking because existing templates do not contain `type: "frame"`.

Recommended TypeScript shape:

```ts
type ElementType = "text" | "image" | "video" | ShapeType | "frame";

type FrameShapeKind = "rect" | "circle" | "svgPath";
type FrameFitMode = "cover" | "contain" | "manual";
type FrameContentKind = "image" | "video";

interface FrameShape {
  presetId: string;
  kind: FrameShapeKind;
  viewBox: string;
  pathData?: string;
  cornerRadius?: number;
  featherPx?: number;
}

interface FrameContent {
  kind: FrameContentKind;
  src: string;
  sourceWidth?: number;
  sourceHeight?: number;
  posterSrc?: string;
  videoStart?: number;
  videoEnd?: number;
  videoDuration?: number;
}

interface FrameContentTransform {
  fit: FrameFitMode;
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface EditorElement {
  type: ElementType;
  frameShape?: FrameShape;
  frameContent?: FrameContent | null;
  frameContentTransform?: FrameContentTransform;
}
```

### Store contract delta

Add store actions in `src/store/editorStore.ts`:

```ts
addFrameElement(presetId: string, partial?: Partial<EditorElement>): string;
setFrameContent(frameId: string, content: FrameContent, options?: UpdateOptions): void;
updateFrameContentTransform(
  frameId: string,
  patch: Partial<FrameContentTransform>,
  options?: UpdateOptions
): void;
clearFrameContent(frameId: string, options?: UpdateOptions): void;
```

Compatibility impact: non-breaking. Old templates load unchanged. New templates with `type: "frame"` need older clients to ignore unknown element types or render a fallback snapshot.

### Save/load contract

- Template save should preserve `frameShape`, `frameContent`, and `frameContentTransform` in `Template.data`.
- `toEditorDesignFromTemplate` in `SidePanel.tsx` must map incoming frame objects to `EditorElement` safely.
- Exported editor JSON should remain versioned. If necessary, bump `EditorDesign.version` when frames are present.

### Mobile/export compatibility

- Phase 1 mobile compatibility requirement: do not break mobile project generation.
- If mobile renderer does not support frames yet, server/mobile export must either:
  - flatten frame elements into raster images during export, or
  - ignore unknown frame elements only for unsupported client versions.
- Decision required before implementation: whether mobile frame rendering is in phase 1 or frames are editor-only until a flattening pass exists.

## Migration And Compatibility

- No database migration is required if frame data remains inside `Template.data`.
- Existing templates remain valid because `frameShape` and `frameContent` are optional.
- Clipboard copy/paste must preserve frame content data.
- Duplicate must clone frame content transform and source refs.
- Undo/redo must include frame content changes.
- Imported Canva templates are unaffected in phase 1 unless users manually add frames after import.

## Technical Considerations

- Prefer a dedicated `CanvasFrameNode` component in `CanvasEditor.tsx` instead of overloading `CanvasImageNode`.
- Add pure helpers in `src/lib/editor/frames.ts`:
  - `resolveFramePreset(presetId)`
  - `computeFrameCoverTransform(frame, content)`
  - `clampFrameContentTransform(frame, content, transform)`
  - `pointIntersectsFrame(element, point)`
  - `renderFrameClipPath(context, shape, width, height)`
- Use refs and pointer state for content-edit drag to avoid rerendering on every move; commit to Zustand at interaction end or throttled intervals.
- Frame hit testing should account for frame rotation. Phase 1 may use bounding-box detection for drag-over highlight if exact path hit testing is too expensive, but drop should prefer topmost frame and avoid surprising targets.
- Video inside frames can reuse the existing hidden HTML video + `Konva.Image` rendering pattern from `CanvasVideoNode`.
- Framed videos must remain muted in editor preview, respect `videoStart`/`videoEnd` when present, and render through the same clipping path as framed images.
- Existing image crop controls in `src/lib/editor/imageCrop.ts` may inform transform math, but the frame system should store frame content transforms separately so frame movement and internal crop movement do not conflict.

## Validation Plan

Unit coverage:

- `computeFrameCoverTransform` for wide/tall/square media in wide/tall/square frames.
- `clampFrameContentTransform` prevents blank areas in `cover`.
- `pointIntersectsFrame` handles unrotated and rotated frame bounds.
- frame preset registry validates every phase 1 preset has a stable id, size, and mask data.

Integration coverage:

- Add empty frame to canvas and save/reload.
- Drop image into empty frame and verify `frameContent.kind = "image"`.
- Drop video into empty frame and verify `frameContent.kind = "video"`.
- Replace an image frame with a video and verify the frame remains a frame with `frameContent.kind = "video"`.
- Replace a video frame with an image and verify the frame remains a frame with `frameContent.kind = "image"`.
- Drop image outside frame and verify it remains a normal image element.
- Replace frame media and verify frame transform remains unchanged.
- Duplicate a filled frame and verify cloned content transform is independent.

Manual QA:

- Add every phase 1 frame shape from the side panel.
- Drag media over overlapping frames and confirm the topmost frame highlights.
- Double-click filled frame, pan content, zoom content, exit edit mode, then move the frame.
- Resize/rotate a filled frame and confirm content remains clipped.
- Save, refresh, reopen, and confirm frame content placement is preserved.
- Test with large photos, transparent PNGs, SVG-derived images, GIFs, and videos.
- Test low-end/mobile browser interaction for drag and zoom responsiveness.

Regression focus:

- Existing image/video drag-drop outside frames.
- Existing shape insertion from `builtinShapes.ts`.
- Existing image crop tools.
- Template save/load.
- Undo/redo, duplicate, delete, layer ordering.
- Publish Elements side panel should not accidentally list internal frame content as a separate publishable element unless product wants that later.

## Acceptance Criteria

- A new `Frames` side-menu item is visible directly below `Elements`, with phase 1 shapes matching the provided screenshot style.
- Clicking a frame preset adds an empty selectable frame to the canvas.
- Empty frames display a clipped placeholder and can be moved/resized/rotated.
- Dropping an image/video over a frame fills that frame instead of creating a top-level layer.
- Dropping an image/video outside frames preserves existing behavior.
- Both image and video frame content can be panned/zoomed in content edit mode.
- Double-clicking a filled frame enters content edit mode.
- In content edit mode, drag pans the content and zoom changes content scale without moving/resizing the frame.
- Exiting content edit mode returns normal frame transform behavior.
- Replacing media keeps frame geometry and preserves/clamps the existing internal transform.
- Saving and reopening preserves frame shape, content source, fit mode, scale, and offsets.
- Lint and type checks for touched files pass, excluding known pre-existing unrelated repo errors if any.

## Open Questions And Risks

- Frames placement is decided for phase 1: add a new dedicated `Frames` side-menu item directly below `Elements`.
- Should mobile export render frames in phase 1? Recommendation: define a flattening fallback before release if mobile templates need to consume frame output immediately.
- Should video frames play in the editor timeline or only show a poster while editing content? Recommendation: reuse existing video render behavior and keep audio muted.
- Exact path hit testing for complex burst/scallop frames may be more expensive than bounding-box hit testing. Recommendation: bounding-box target detection for drag-over in phase 1, exact clip for rendering.
- Feathered mask edges may require raster masks or filters that are more complex in Konva. Recommendation: hard-edge masks only in phase 1.

## Definition Of Ready

- Phase 1 frame preset list is approved from the screenshot.
- Product confirms the side-menu ordering: `Elements` followed immediately by `Frames`.
- Engineering confirms whether mobile/export must support frames immediately or can use an editor-only flag until flattening is implemented.
- Data contract above is accepted as non-breaking.
- QA agrees on the manual test matrix for add, drop, edit, replace, save, and reload.
- Any known typecheck failures unrelated to this feature are documented before implementation begins.

## Delivery Summary

Recommended delivery phases:

- Phase 1A: data model, frame preset registry, empty frame insertion, and canvas rendering.
- Phase 1B: drop-to-frame detection, frame highlight, and image/video fill behavior.
- Phase 1C: content edit mode with pan/zoom, replace media, and fit-mode controls.
- Phase 1D: save/reload compatibility, copy/duplicate/delete behavior, and QA hardening.
- Phase 2: feathered masks, exact path hit testing, Canva frame import, mobile flatten/render support, and advanced multi-layer frame content.
