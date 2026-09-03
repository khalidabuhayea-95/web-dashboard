"""Shared helpers: base64 <-> PIL, device selection, uniform result envelope.

The same code runs in three environments: the production CUDA container,
a rented dev pod, and a developer Mac (MPS/CPU). Every pipeline must load
its model lazily and pick the best available device at call time.
"""

from __future__ import annotations

import base64
import io
import time
from typing import Any

from PIL import Image, ImageOps

MAX_INPUT_PIXELS = 4096 * 4096


def pick_device() -> str:
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def decode_image(b64: str, *, mode: str = "RGB") -> Image.Image:
    if not b64 or not isinstance(b64, str):
        raise ValueError("missing image payload")
    raw = base64.b64decode(b64.split(",")[-1], validate=False)
    image = Image.open(io.BytesIO(raw))
    image = ImageOps.exif_transpose(image)
    if image.width * image.height > MAX_INPUT_PIXELS:
        raise ValueError(f"image too large ({image.width}x{image.height})")
    return image.convert(mode)


def encode_image(image: Image.Image, *, format: str = "PNG", quality: int = 92) -> dict[str, str]:
    buffer = io.BytesIO()
    if format.upper() == "JPEG":
        image = image.convert("RGB")
        image.save(buffer, format="JPEG", quality=quality)
        mime = "image/jpeg"
    else:
        image.save(buffer, format="PNG")
        mime = "image/png"
    return {
        "image_b64": base64.b64encode(buffer.getvalue()).decode("ascii"),
        "mime_type": mime,
    }


def ok(output: dict[str, Any], started_at: float, *, device: str, model: str) -> dict[str, Any]:
    return {
        **output,
        "model": model,
        "device": device,
        "duration_ms": int((time.time() - started_at) * 1000),
    }
