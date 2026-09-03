"""Snap a rough brush mask onto the real object boundary with SAM.

Why: fill quality is governed by hole SIZE. A user drags a fat brush over a
person and paints the person PLUS a wide halo of good background; the eraser
then has to invent all of it, which is exactly when LaMa goes hazy and the
diffusion refine starts hallucinating. Segment Anything turns those strokes
into the object's actual silhouette, so the hole is the object and nothing
more — the same trick the commercial erasers use before they inpaint. On the
reference crowd photo this cut the hole from 49k to 12k pixels (-76%) while
covering the two removed people exactly.

Prompting: one BOX per painted blob. Measured against the alternative — a
grid of point prompts — boxes won outright: points landed on the pavement and
shadows between the subjects and SAM dutifully returned "the pavement", while
the box asks the question the user actually means ("the thing I painted over")
and came back at precision 1.00.

Model: facebook/sam-vit-base (Apache-2.0, ~375MB) via transformers.

Safety: a snap is accepted only when it agrees with what the user painted —
most of it inside the strokes, not wildly larger, not most of the frame, not
shrunk to nothing. Otherwise the raw brush is returned unchanged, so the
feature can only tighten a hole it understands, never redirect a removal.
"""

from __future__ import annotations

import os
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

from .common import pick_device

MODEL_ID = os.environ.get("SAM_MODEL", "facebook/sam-vit-base")

# Per-candidate filters.
MAX_CANDIDATE_SHARE = 0.5  # reject "the whole background" candidates
MIN_CANDIDATE_PRECISION = 0.5  # most of it must sit inside the strokes

# Guardrails on the accepted result.
MIN_UNION_PRECISION = 0.6  # what we remove is what the user painted over
MIN_SHRINK_KEEP = 0.02  # never collapse the hole to a speck
MAX_GROWTH = 3.0  # never balloon past 3x the painted area
MAX_IMAGE_SHARE = 0.55  # nor swallow more than half the frame

_model = None
_processor = None
_device = ""


def _load():
    global _model, _processor, _device
    if _model is not None:
        return _model, _processor
    import torch
    from transformers import SamModel, SamProcessor

    _device = pick_device()
    _processor = SamProcessor.from_pretrained(MODEL_ID)
    model = SamModel.from_pretrained(MODEL_ID)
    model.to(torch.device(_device)).eval()
    _model = model
    return _model, _processor


def _blob_boxes(brush: np.ndarray, max_boxes: int = 4, min_share: float = 0.04) -> list[list[int]]:
    """One box per painted blob, so two separate strokes stay two objects.

    Labelled on a downscaled copy — the boxes only need to be roughly right
    since SAM refines from there — which keeps the flood fill cheap.
    """
    height, width = brush.shape
    scale = 256 / max(height, width)
    if scale < 1.0:
        small = (
            np.asarray(
                Image.fromarray((brush * 255).astype(np.uint8)).resize(
                    (max(1, round(width * scale)), max(1, round(height * scale))), Image.NEAREST
                )
            )
            > 127
        )
    else:
        scale, small = 1.0, brush

    seen = np.zeros_like(small, dtype=bool)
    blobs: list[tuple[int, list[int]]] = []
    rows, cols = small.shape
    for start_y in range(rows):
        for start_x in range(cols):
            if not small[start_y, start_x] or seen[start_y, start_x]:
                continue
            queue = deque([(start_y, start_x)])
            seen[start_y, start_x] = True
            x0 = x1 = start_x
            y0 = y1 = start_y
            area = 0
            while queue:
                y, x = queue.popleft()
                area += 1
                x0, x1 = min(x0, x), max(x1, x)
                y0, y1 = min(y0, y), max(y1, y)
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < rows and 0 <= nx < cols and small[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        queue.append((ny, nx))
            blobs.append((area, [x0, y0, x1, y1]))

    total = sum(area for area, _ in blobs) or 1
    kept = [box for area, box in sorted(blobs, reverse=True) if area / total >= min_share][:max_boxes]
    inverse = 1.0 / scale
    return [
        [
            int(max(0, box[0] * inverse)),
            int(max(0, box[1] * inverse)),
            int(min(width - 1, (box[2] + 1) * inverse)),
            int(min(height - 1, (box[3] + 1) * inverse)),
        ]
        for box in kept
    ]


def snap_mask(image: Image.Image, mask: Image.Image, *, grow_px: int | None = None) -> tuple[Image.Image, dict]:
    """Return (mask, info). `info` records what happened, for the op's response."""
    import torch

    brush = np.asarray(mask.convert("L")) > 127
    brush_area = int(brush.sum())
    info: dict[str, object] = {"snap": "skipped", "brush_px": brush_area}
    if brush_area == 0:
        return mask, info

    boxes = _blob_boxes(brush)
    if not boxes:
        return mask, info

    model, processor = _load()
    inputs = processor(image, input_boxes=[boxes], return_tensors="pt")
    # The processor hands back float64 tensors; MPS has no float64, so cast
    # every float input down before it reaches the device.
    inputs = {
        key: (value.to(torch.float32) if value.is_floating_point() else value).to(_device)
        for key, value in inputs.items()
    }
    with torch.no_grad():
        outputs = model(**inputs, multimask_output=True)
    masks = processor.image_processor.post_process_masks(
        outputs.pred_masks.cpu(),
        inputs["original_sizes"].cpu(),
        inputs["reshaped_input_sizes"].cpu(),
    )[0].numpy()  # (prompts, candidates, H, W)
    scores = outputs.iou_scores.cpu().numpy()[0]  # (prompts, candidates)

    frame = brush.size
    union = np.zeros_like(brush)
    for prompt_index in range(masks.shape[0]):
        best = None
        best_rank = -1.0
        for candidate_index in range(masks.shape[1]):
            candidate = masks[prompt_index, candidate_index]
            area = float(candidate.sum())
            if area == 0 or area / frame > MAX_CANDIDATE_SHARE:
                continue
            precision = float((candidate & brush).sum()) / area
            if precision < MIN_CANDIDATE_PRECISION:
                continue  # some other object the stroke merely touched
            # Prefer the candidate SAM likes that also sits inside the strokes:
            # its own score alone happily picks the bigger surrounding region.
            rank = precision * float(scores[prompt_index, candidate_index])
            if rank > best_rank:
                best, best_rank = candidate, rank
        if best is not None:
            union |= best

    snapped_area = int(union.sum())
    if snapped_area == 0:
        info["snap"] = "no-candidate"
        return mask, info

    precision = float((union & brush).sum()) / snapped_area
    growth = snapped_area / brush_area
    info.update(
        {
            "snapped_px": snapped_area,
            "precision": round(precision, 3),
            "growth": round(growth, 2),
            "boxes": len(boxes),
        }
    )
    if (
        precision < MIN_UNION_PRECISION
        or growth > MAX_GROWTH
        or growth < MIN_SHRINK_KEEP
        or snapped_area / frame > MAX_IMAGE_SHARE
    ):
        info["snap"] = "rejected"
        return mask, info

    snapped = Image.fromarray((union * 255).astype(np.uint8), mode="L")
    # Objects carry a soft rim — out-of-focus edges, motion blur, hair, the
    # contact shadow. Measured on the reference photo: a pixel-tight silhouette
    # (6px margin) left pale GHOSTS of the removed people, ~16px was clean, and
    # an over-generous margin only grows the hole for the inpainter to invent
    # into. So the margin scales with the object and stays inside that band.
    if grow_px is None:
        grow_px = int(np.clip(0.14 * np.sqrt(snapped_area), 10, 28))
    if grow_px > 0:
        snapped = snapped.filter(ImageFilter.MaxFilter(grow_px * 2 + 1))
    info["grow_px"] = grow_px
    info["snap"] = "applied"
    info["final_px"] = int((np.asarray(snapped) > 127).sum())
    return snapped, info
