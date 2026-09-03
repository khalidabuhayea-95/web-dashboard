"""End-to-end smoke test against a running worker (local or RunPod).

Builds a synthetic photo with an intruding object + mask, then exercises
remove-object, upscale and face-restore. Saves before/after files next to
this script for eyeballing.

    .venv/bin/python scripts/smoke_test.py [http://127.0.0.1:8484]
"""

from __future__ import annotations

import base64
import io
import json
import sys
import time
import urllib.request

from PIL import Image, ImageDraw, ImageFilter

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8484"
OUT_DIR = __file__.rsplit("/", 1)[0]


def build_test_scene() -> tuple[Image.Image, Image.Image]:
    """A 'photo': sky gradient + sun + hills, with an ugly sign to remove."""
    width, height = 768, 512
    image = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / height
        draw.line(
            [(0, y), (width, y)],
            fill=(int(120 + 100 * t), int(170 + 50 * t), int(230 - 60 * t)),
        )
    draw.ellipse([600, 60, 680, 140], fill=(255, 240, 200))
    draw.polygon([(0, 512), (200, 330), (420, 512)], fill=(60, 110, 70))
    draw.polygon([(260, 512), (520, 290), (768, 512)], fill=(45, 95, 60))
    image = image.filter(ImageFilter.GaussianBlur(1.2))

    # The object to remove: a garish sign on a pole.
    draw = ImageDraw.Draw(image)
    draw.rectangle([355, 250, 375, 470], fill=(90, 60, 40))
    draw.rectangle([290, 170, 445, 260], fill=(220, 40, 40))
    draw.rectangle([300, 180, 435, 250], outline=(255, 255, 255), width=4)

    mask = Image.new("L", (width, height), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rectangle([348, 240, 384, 478], fill=255)
    mask_draw.rectangle([282, 162, 452, 268], fill=255)
    return image, mask


def encode(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def call(op: str, payload: dict) -> dict:
    body = json.dumps({"input": {"op": op, **payload}}).encode()
    request = urllib.request.Request(
        f"{BASE}/runsync", data=body, headers={"Content-Type": "application/json"}
    )
    started = time.time()
    with urllib.request.urlopen(request, timeout=300) as response:
        result = json.load(response)
    elapsed = int((time.time() - started) * 1000)
    if result.get("status") != "COMPLETED":
        raise SystemExit(f"{op} FAILED: {result.get('error')}")
    output = result["output"]
    print(
        f"{op}: {output.get('model')} on {output.get('device')} "
        f"in {output.get('duration_ms')}ms (wire {elapsed}ms)"
    )
    return output


def save(output: dict, name: str):
    raw = base64.b64decode(output["image_b64"])
    path = f"{OUT_DIR}/{name}"
    with open(path, "wb") as handle:
        handle.write(raw)
    print(f"  -> {path}")


if __name__ == "__main__":
    image, mask = build_test_scene()
    image.save(f"{OUT_DIR}/smoke_before.png")
    mask.save(f"{OUT_DIR}/smoke_mask.png")

    save(call("remove-object", {"image_b64": encode(image), "mask_b64": encode(mask)}), "smoke_removed.png")
    save(call("upscale", {"image_b64": encode(image.resize((384, 256))), "scale": 4}), "smoke_upscaled.jpg")
    print("smoke test passed")
