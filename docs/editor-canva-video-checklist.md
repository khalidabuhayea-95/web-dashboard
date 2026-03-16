# Canva Reference Video Checklist (2026-02-28)

Source video: `/Users/khalidabuhayea/AndroidStudioProjects/web-dashboard/.tmp/reference-videos/canva-reference-2026-02-28-034130.mov`

## Observed behavior to match

- [ ] Global top gradient bar with project title and primary actions (share, undo/redo, save/publish area).
- [ ] Contextual toolbar directly under top bar that changes by selection type (text vs media).
- [ ] Canvas remains fixed/centered while panels open or close (no canvas reflow).
- [ ] Right vertical tool rail contains tool categories only.
- [ ] Object selection shows inline mini action pill near selected layer.
- [ ] Text selection shows typography-focused contextual controls in top toolbar.
- [ ] Detail-heavy actions open in side panel on the right (font browser, image edit sections, crop settings).
- [ ] Right side details panel has close affordance and does not resize canvas.
- [ ] Crop mode uses dimmed overlay with visible crop area + confirm/cancel controls.
- [ ] Bottom utility row keeps page control and zoom control visible.

## High-priority implementation order

1. Toolbar architecture (global + contextual split)
2. Right tool rail and right details panel behavior
3. Crop mode overlay interaction parity
4. Visual polish pass (spacing, border radius, typography weight, hover/focus states)
