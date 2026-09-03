"""Text-to-image — FLUX.1-schnell (Apache-2.0), optionally with the
QCRI Fanar-2-Oryx-IG LoRA (Apache-2.0) for Arab-culture presets.

CUDA-only. `style: "arabic"` in the payload loads the Oryx LoRA.
"""

from __future__ import annotations

import os
import time

from .common import encode_image, ok

MODEL_ID = os.environ.get("T2I_MODEL", "black-forest-labs/FLUX.1-schnell")
ORYX_LORA = "QCRI/Fanar-2-Oryx-IG"

_pipeline = None
_oryx_loaded = False


def _load():
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("op 'generate' needs a CUDA GPU — run it on the dev pod or serverless")

    from diffusers import FluxPipeline

    pipeline = FluxPipeline.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16)
    if os.environ.get("ENABLE_CPU_OFFLOAD") == "1":
        pipeline.enable_model_cpu_offload()
    else:
        pipeline.to("cuda")
    _pipeline = pipeline
    return pipeline


def _set_style(pipeline, style: str):
    global _oryx_loaded
    if style == "arabic" and not _oryx_loaded:
        pipeline.load_lora_weights(ORYX_LORA)
        _oryx_loaded = True
    if _oryx_loaded:
        pipeline.set_adapters(
            ["default_0"], adapter_weights=[1.0 if style == "arabic" else 0.0]
        )


def run(payload: dict) -> dict:
    started = time.time()
    prompt = str(payload.get("prompt", "")).strip()
    if not prompt:
        raise ValueError("missing prompt")

    pipeline = _load()
    _set_style(pipeline, str(payload.get("style", "")).strip().lower())

    width = min(1536, max(512, int(payload.get("width", 1024)) // 16 * 16))
    height = min(1536, max(512, int(payload.get("height", 1024)) // 16 * 16))
    result = pipeline(
        prompt=prompt,
        width=width,
        height=height,
        num_inference_steps=int(payload.get("steps", 4)),
        guidance_scale=0.0,
    ).images[0]

    model = "flux-schnell+oryx" if payload.get("style") == "arabic" else "flux-schnell"
    return ok(encode_image(result), started, device="cuda", model=model)
