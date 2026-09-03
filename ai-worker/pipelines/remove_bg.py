"""Background removal with BiRefNet (MIT) — higher quality than u2net.

Needs `timm` and `einops` (in the container requirements; install them
locally only if you want to test this op on the Mac).
"""

from __future__ import annotations

import time

import numpy as np
from PIL import Image

from .common import decode_image, encode_image, ok, pick_device

_model = None
_device = ""


def _load():
    global _model, _device
    if _model is not None:
        return _model
    import torch
    from transformers import AutoModelForImageSegmentation

    _device = pick_device()
    model = AutoModelForImageSegmentation.from_pretrained(
        "ZhengPeng7/BiRefNet", trust_remote_code=True
    )
    model.to(torch.device(_device)).eval()
    _model = model
    return _model


def run(payload: dict) -> dict:
    import torch
    from torchvision import transforms

    started = time.time()
    image = decode_image(payload.get("image_b64", ""))

    model = _load()
    transform = transforms.Compose(
        [
            transforms.Resize((1024, 1024)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )
    tensor = transform(image).unsqueeze(0).to(_device)
    with torch.no_grad():
        prediction = model(tensor)[-1].sigmoid().cpu()
    mask_array = (prediction[0].squeeze().numpy() * 255).astype(np.uint8)
    mask = Image.fromarray(mask_array).resize(image.size, Image.LANCZOS)

    result = image.convert("RGBA")
    result.putalpha(mask)
    return ok(encode_image(result), started, device=_device, model="birefnet")
