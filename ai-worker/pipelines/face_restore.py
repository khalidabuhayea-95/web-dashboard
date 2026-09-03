"""Face enhance with GFPGAN v1.4 via spandrel.

v0 restores the full frame through the 512px face model — acceptable for
portrait shots (the product use-case). The container phase adds facexlib
detection so only detected faces are restored and pasted back.
"""

from __future__ import annotations

import os
import time

import numpy as np
from PIL import Image

from .common import decode_image, encode_image, ok, pick_device

WEIGHTS = os.path.join(os.path.dirname(__file__), "..", "weights", "GFPGANv1.4.pth")

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


def run(payload: dict) -> dict:
    import torch

    started = time.time()
    image = decode_image(payload.get("image_b64", ""))
    original_size = image.size

    model = _load()
    square = image.resize((512, 512), Image.LANCZOS)
    tensor = (
        torch.from_numpy(np.array(square, dtype=np.float32) / 255.0)
        .permute(2, 0, 1)
        .unsqueeze(0)
        .to(_device)
    )
    with torch.no_grad():
        restored = model(tensor)[0].clamp(0, 1).permute(1, 2, 0).cpu().numpy()

    result = Image.fromarray((restored * 255.0).round().astype(np.uint8)).resize(
        original_size, Image.LANCZOS
    )
    return ok(encode_image(result, format="JPEG"), started, device=_device, model="gfpgan-v1.4")
