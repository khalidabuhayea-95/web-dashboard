"""Upscale with Real-ESRGAN x4plus via spandrel (no basicsr dependency).

Weights: weights/RealESRGAN_x4plus.pth (BSD-3). Tiled to bound memory on
any device; `scale` 2 downsamples the x4 output.
"""

from __future__ import annotations

import os
import time

import numpy as np
from PIL import Image

from .common import decode_image, encode_image, ok, pick_device

WEIGHTS = os.path.join(os.path.dirname(__file__), "..", "weights", "RealESRGAN_x4plus.pth")
TILE = 384
OVERLAP = 16
MAX_INPUT_EDGE = 2048

_model = None
_device = ""


def _load():
    global _model, _device
    if _model is not None:
        return _model
    import torch
    from spandrel import ModelLoader

    _device = pick_device()
    descriptor = ModelLoader().load_from_file(os.path.abspath(WEIGHTS))
    descriptor.to(torch.device(_device)).eval()
    _model = descriptor
    return _model


def _run_tensor(tensor):
    import torch

    with torch.no_grad():
        return _load()(tensor)


def _upscale_tiled(image: Image.Image) -> Image.Image:
    import torch

    model = _load()
    scale = model.scale
    array = np.array(image, dtype=np.float32) / 255.0
    height, width = array.shape[:2]
    output = np.zeros((height * scale, width * scale, 3), dtype=np.float32)

    for top in range(0, height, TILE):
        for left in range(0, width, TILE):
            bottom = min(top + TILE, height)
            right = min(left + TILE, width)
            pad_top = max(0, top - OVERLAP)
            pad_left = max(0, left - OVERLAP)
            pad_bottom = min(height, bottom + OVERLAP)
            pad_right = min(width, right + OVERLAP)

            tile = array[pad_top:pad_bottom, pad_left:pad_right]
            tensor = torch.from_numpy(tile).permute(2, 0, 1).unsqueeze(0).to(_device)
            upscaled = _run_tensor(tensor)[0].clamp(0, 1).permute(1, 2, 0).cpu().numpy()

            crop_top = (top - pad_top) * scale
            crop_left = (left - pad_left) * scale
            tile_height = (bottom - top) * scale
            tile_width = (right - left) * scale
            output[top * scale : bottom * scale, left * scale : right * scale] = upscaled[
                crop_top : crop_top + tile_height, crop_left : crop_left + tile_width
            ]

    return Image.fromarray((output * 255.0).round().astype(np.uint8))


def run(payload: dict) -> dict:
    started = time.time()
    image = decode_image(payload.get("image_b64", ""))
    if max(image.size) > MAX_INPUT_EDGE:
        ratio = MAX_INPUT_EDGE / max(image.size)
        image = image.resize(
            (round(image.width * ratio), round(image.height * ratio)), Image.LANCZOS
        )

    result = _upscale_tiled(image)

    requested_scale = int(payload.get("scale", 4))
    if requested_scale == 2:
        result = result.resize((image.width * 2, image.height * 2), Image.LANCZOS)

    return ok(
        encode_image(result, format="JPEG"), started, device=_device, model="real-esrgan-x4plus"
    )
