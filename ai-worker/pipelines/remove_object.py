"""Object removal (healing) with LaMa — replaces Replicate allenhooo/lama.

Weights: big-lama TorchScript, auto-downloaded by simple-lama-inpainting on
first use (~205MB). The TorchScript graph has ops MPS can't run, so LaMa is
pinned to CPU off-CUDA — still 2-6s at 1440px on an M3.
"""

from __future__ import annotations

import time

import numpy as np
from PIL import Image, ImageFilter

from .common import decode_image, encode_image, ok, pick_device

_model = None
_model_device = ""


def _load():
    global _model, _model_device
    if _model is not None:
        return _model
    import torch
    from simple_lama_inpainting import SimpleLama

    _model_device = "cuda" if pick_device() == "cuda" else "cpu"
    _model = SimpleLama(device=torch.device(_model_device))
    return _model


def prepare_mask(mask: Image.Image, size: tuple[int, int], dilate: int = 0) -> Image.Image:
    """Binarized (optionally grown) removal mask at the image's size."""
    if mask.size != size:
        mask = mask.resize(size, Image.LANCZOS)
    mask_array = (np.array(mask) > 127).astype(np.uint8) * 255
    mask = Image.fromarray(mask_array, mode="L")
    if dilate > 0:
        mask = mask.filter(ImageFilter.MaxFilter(dilate * 2 + 1))
    return mask


def resolve_mask(image: Image.Image, payload: dict, *, dilate: int) -> tuple[Image.Image, dict]:
    """Brush mask from the payload, snapped to the object boundary by default.

    Snapping is what keeps the hole the size of the thing being removed rather
    than the size of the stroke; `snap: false` in the payload opts out, and an
    unsafe snap falls back to the raw brush on its own (see mask_snap).
    """
    mask = prepare_mask(
        decode_image(payload.get("mask_b64", ""), mode="L"), image.size, dilate=dilate
    )
    if not payload.get("snap", True):
        return mask, {"snap": "off"}
    try:
        from .mask_snap import snap_mask

        grow = payload.get("snap_grow")
        return snap_mask(image, mask, grow_px=None if grow is None else max(0, int(grow)))
    except Exception as error:  # never fail a removal because the snap failed
        return mask, {"snap": "error", "detail": str(error)[:200]}


def inpaint_lama(image: Image.Image, mask: Image.Image) -> Image.Image:
    """Full-frame LaMa fill. Also the init image for the diffusion refine op."""
    result = _load()(image, mask)
    if result.size != image.size:
        result = result.resize(image.size, Image.LANCZOS)
    return result


def merge_fill(image: Image.Image, fill: Image.Image, mask: Image.Image) -> Image.Image:
    """Put the fill back into the hole only, with a soft edge.

    LaMa reconstructs the WHOLE frame, so its output differs from the source by
    a hair everywhere — invisible on its own, but the app then composites our
    result against the untouched original along the brush outline, and that
    hairline difference showed up as a visible arc tracing the stroke. Blending
    here means every pixel outside the hole is byte-identical to the source, so
    there is no edge left for anything downstream to reveal.
    """
    ys, xs = np.where(np.asarray(mask) > 127)
    if len(xs) == 0:
        return image
    span = max(int(xs.max() - xs.min()), int(ys.max() - ys.min()))
    blur = float(np.clip(span * 0.02, 3.0, 24.0))
    feather = mask.filter(ImageFilter.GaussianBlur(blur))
    return Image.composite(fill, image, feather)


def run(payload: dict) -> dict:
    started = time.time()
    image = decode_image(payload.get("image_b64", ""))
    # Dilation is opt-in. The app and the dashboard already pad the brush, and
    # growing the hole a second time only takes context away from LaMa —
    # measured on a real photo, 0 extra px gave the cleanest fill.
    mask, snap_info = resolve_mask(
        image, payload, dilate=max(0, int(payload.get("mask_dilate", 0)))
    )

    import os

    if os.environ.get("DEBUG_DUMP"):
        image.save("/tmp/nayroz-or-image.png")
        mask.save("/tmp/nayroz-or-mask.png")

    result = merge_fill(image, inpaint_lama(image, mask), mask)
    return ok(
        {**encode_image(result), **snap_info}, started, device=_model_device, model="big-lama"
    )
