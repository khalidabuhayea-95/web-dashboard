# Mobile Animation And Timeline Handoff

## Objective

Give the mobile team a concrete implementation reference for:

- the animation set currently used by the web editor
- how layer timing and visibility work on the editor timeline
- how video templates interact with the same timeline
- what the mobile API exposes today
- how mobile should consume the new layer-level animation payload

The goal is to let mobile start implementation now with minimal guesswork.

## Current behavior today

### Editor animation set

The current editor animation picker uses these Canva-style animation names:

- `NONE`
- `RISE`
- `PAN`
- `FADE`
- `POP`
- `WIPE`
- `BLUR`
- `SUCCESSION`
- `BREATHE`
- `BASELINE`
- `DRIFT`
- `TECTONIC`
- `TUMBLE`
- `NEON`
- `SCRAPBOOK`
- `STOMP`
- `ROTATE`
- `FLICKER`
- `PULSE`
- `WIGGLE`

There are still legacy aliases inside the web codebase, but this list is the current product-facing set and should be treated as the source of truth for mobile.

### Layer timing model

Each editor layer can carry:

- `timelineStartMs`
- `timelineEndMs`
- `mediaAnimationType`
- `mediaAnimationInfinite`
- `mediaAnimationDurationMs`

The editor also stores optional advanced fields:

- `mediaAnimationDelayMs`
- `mediaAnimationDirection`
- `mediaAnimationEasing`
- `mediaAnimationIntensity`

These advanced fields are now exposed through the new layer-level mobile `animation` payload.

### Timeline behavior

The editor uses a single active playhead for the current template/page.

Core behavior:

- the playhead is fixed visually in the center area
- the timeline content moves underneath it
- clicking anywhere on the timeline pauses playback
- scrubbing is inverted:
  - dragging left moves forward in time
  - dragging right moves backward in time
- the top strip is the selected-layer strip
- the bottom strip is the full-template preview strip

### Selected-layer strip

The top strip changes based on the selected layer:

- text layer: white centered text-chip style preview
- image layer: repeated image thumbnails with internal spacing
- video layer: repeated video frames
- frame with image/video content: follows the same image/video behavior

The top strip is hidden when no selected layer requires timeline visualization.

### Template strip

The bottom strip shows the full-template preview:

- non-video templates: live stage preview frames
- video templates: video frame filmstrip

Live stage capture is intentionally disabled for video templates because it interfered with video behavior.

### Video behavior

If the template contains video:

- the timeline is always shown
- template duration follows the actual video duration
- the bottom strip uses video filmstrip frames
- videos inside frames should be treated as videos for duration and preview purposes

On the web editor canvas, videos currently play and loop normally. The timeline is still the main source of truth for:

- duration
- visibility windows
- scrubbing
- filmstrip previews

For mobile, deterministic playback should come from the mobile playhead rather than relying on free-running video playback.

## Scope and non-goals

### In scope

- Describe the current animation names and timing model
- Describe how mobile should render layer visibility from the playhead
- Describe how mobile should handle one-shot vs looping animation behavior
- Describe timeline behavior for templates with video
- Describe the new mobile API contract and the legacy fallback path

### Non-goals

- Redesign the mobile animation UX
- Define final mobile-specific easing curves beyond current editor defaults
- Implement backend changes in this document
- Cover audio
- Cover multi-page templates

## User flows or system behavior

### 1. Layer visibility from playhead

For any layer:

1. Read `timelineStartMs`
2. Read `timelineEndMs`
3. Compare against the active template playhead
4. Render the layer only while the playhead is inside that range

Behavior rule:

- visible when `playheadMs >= timelineStartMs && playheadMs <= timelineEndMs`

### 2. One-shot animation

For transition-style animation:

1. Layer becomes visible at `timelineStartMs`
2. Animation progress begins from `0`
3. Progress advances to `1` over `mediaAnimationDurationMs`
4. After completion, layer remains in its resting visible state until `timelineEndMs`

This is the expected behavior when:

- `mediaAnimationType !== NONE`
- `mediaAnimationInfinite = false`

### 3. Looping animation

For looping-style animation:

1. Layer becomes visible at `timelineStartMs`
2. Animation progress loops continuously while visible
3. Loop cycle length is `mediaAnimationDurationMs`
4. Loop stops when playhead exits the layer window

This is the expected behavior when:

- `mediaAnimationType !== NONE`
- `mediaAnimationInfinite = true`

### 4. Video template playback

For templates with video:

1. Timeline is always visible
2. Total timeline duration equals the actual video duration
3. Bottom preview strip uses video frames
4. Video layer visibility still obeys the normal layer timing window
5. Other animated layers should still animate against the same template playhead

## Functional requirements

### Animation identity

Mobile should support these animation names exactly:

- `NONE`
- `RISE`
- `PAN`
- `FADE`
- `POP`
- `WIPE`
- `BLUR`
- `SUCCESSION`
- `BREATHE`
- `BASELINE`
- `DRIFT`
- `TECTONIC`
- `TUMBLE`
- `NEON`
- `SCRAPBOOK`
- `STOMP`
- `ROTATE`
- `FLICKER`
- `PULSE`
- `WIGGLE`

### Animation classification

The following behavior split should be used:

Transition-style:

- `RISE`
- `PAN`
- `FADE`
- `POP`
- `WIPE`
- `BLUR`
- `SUCCESSION`
- `DRIFT`
- `TECTONIC`
- `TUMBLE`
- `STOMP`

Loop-style:

- `BREATHE`
- `BASELINE`
- `NEON`
- `SCRAPBOOK`
- `ROTATE`
- `FLICKER`
- `PULSE`
- `WIGGLE`

Instant:

- `NONE`

### Playhead-driven rendering

Mobile should derive all animation state from a template playhead in milliseconds.

For each layer:

- determine visibility from `timelineStartMs` and `timelineEndMs`
- derive local animation time from `playheadMs - timelineStartMs`
- use `mediaAnimationDurationMs` as the cycle or transition duration

### Infinite flag

Use `mediaAnimationInfinite` as follows:

- `false`: one-shot animation from layer start
- `true`: repeat animation while visible

### Video templates

If any layer is a video, or a frame contains video:

- always show the timeline
- set total duration to the longest video duration
- generate bottom filmstrip from video frames
- keep using the same playhead for all other layers and animations

## API and data contracts

### What the editor model already contains

The web editor layer model already stores:

```json
{
  "timelineStartMs": 0,
  "timelineEndMs": 4200,
  "mediaAnimationType": "RISE",
  "mediaAnimationInfinite": false,
  "mediaAnimationDurationMs": 900,
  "mediaAnimationDelayMs": 0,
  "mediaAnimationDirection": "UP",
  "mediaAnimationEasing": "SOFT_OUT",
  "mediaAnimationIntensity": 1
}
```

### What the current mobile payload exposes today

The mobile API now exposes timeline-aware animation fields directly at layer level:

```json
{
  "timelineStartMs": 0,
  "timelineEndMs": 4200,
  "animation": {
    "type": "RISE",
    "infinite": false,
    "durationMs": 900,
    "delayMs": 0,
    "direction": "UP",
    "easing": "SOFT_OUT",
    "intensity": 1
  }
}
```

This is the new preferred mobile contract.

The payload includes:

- `timelineStartMs`
- `timelineEndMs`
- `animation.type`
- `animation.infinite`
- `animation.durationMs`
- `animation.delayMs`
- `animation.direction`
- `animation.easing`
- `animation.intensity`

### Compatibility impact

This is implemented as a backward-compatible additive change.

Version behavior:

- existing mobile clients can keep using current legacy filter fields
- new mobile clients should prefer the new layer-level animation contract when present
- backend can continue emitting both during transition

## Migration and compatibility

### Backend

Current backend behavior:

1. legacy `filters.animationType` / `animationMode` / `animationStrength` / `animationSpeed` still exist
2. new layer-level `timelineStartMs`, `timelineEndMs`, and `animation` are now returned
3. new mobile clients should prefer the layer-level fields
4. legacy filter animation fields can be deprecated later after mobile migration

### Mobile

Recommended mobile fallback order:

1. if new layer-level `animation` object exists, use it
2. otherwise fall back to current legacy animation mapping
3. if no animation fields exist, treat as `NONE`

## Technical considerations

### Playhead model

Mobile should treat the template playhead as the single source of truth.

Pseudo logic:

```text
isVisible = playheadMs >= timelineStartMs && playheadMs <= timelineEndMs
```

For one-shot animation:

```text
localMs = max(0, playheadMs - timelineStartMs)
progress = clamp(localMs / animation.durationMs, 0, 1)
```

For looping animation:

```text
localMs = max(0, playheadMs - timelineStartMs)
loopMs = localMs % animation.durationMs
progress = loopMs / animation.durationMs
```

### Video duration

Template duration should be:

- the longest video duration if any video exists
- otherwise the page/template duration from the editor

### Frames with video

Frames that contain video should behave like video layers for:

- duration calculation
- bottom-strip preview logic
- playhead-based rendering

### Rendering strategy recommendation

For mobile, use deterministic playhead rendering instead of relying on uncontrolled media autoplay. That will keep:

- layer visibility
- video timing
- animation timing

in sync with the same playhead.

## Validation plan

### Unit coverage

- visible window calculation from `timelineStartMs` / `timelineEndMs`
- one-shot animation progress calculation
- looping animation progress calculation
- longest-video duration resolution
- fallback from layer-level animation payload to legacy filter payload

### Integration coverage

- template with only text/image layers and animations
- template with one video layer and animated text/image overlays
- template with video inside frame and animated overlays
- template with mixed one-shot and infinite loop animations

### Manual QA scenarios

- scrub from start to end and confirm visibility windows match editor
- confirm a non-infinite transition runs once and then rests
- confirm an infinite animation keeps looping while the layer remains visible
- confirm timeline duration equals actual video duration on video templates
- confirm bottom preview uses video frames for video templates

### Regression focus

- legacy templates still render when only old animation payload exists
- templates without animation still render correctly
- frame-contained videos stay synchronized with the template playhead

## Acceptance criteria

- Mobile supports the current Canva-style animation set listed in this document
- Mobile renders layer visibility from `timelineStartMs` and `timelineEndMs`
- Non-infinite animations behave like one-shot entry animations
- Infinite animations loop while the layer remains visible
- Video templates use actual video duration as total timeline duration
- Frame-contained videos are treated as videos for timing and preview logic
- Mobile can fall back safely if only legacy animation fields are present

## Open questions and risks

- Some advanced editor fields like easing, direction, and intensity are not yet product-validated on mobile
- Desktop editor currently allows normal looping video playback on canvas, but mobile should still prefer deterministic playhead-based rendering

## Definition of Ready

- Mobile agrees to target the new animation names in this document
- Mobile has a fallback plan for legacy templates
- QA has sample templates for:
  - image-only animation
  - text animation
  - video template with overlays
  - frame-contained video
- Acceptance criteria are testable against real templates

## Delivery summary

Mobile can start implementation now using:

- the animation list in this spec
- playhead-driven visibility from `timelineStartMs` and `timelineEndMs`
- one-shot vs infinite behavior from `animation.infinite`
- animation duration from `animation.durationMs`

The mobile API now exposes the new layer-level animation contract. Mobile should implement against that payload first and use legacy filter animation fields only as fallback.
