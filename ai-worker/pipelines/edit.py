"""Instruction image editing — Qwen-Image-Edit-2511 + Lightning 4-step (Apache-2.0).

CUDA-only: the 20B transformer does not fit Apple-silicon dev machines.
On a 24GB card set NUNCHAKU=1 (INT4, ~13GB, ~2-4s/edit); without nunchaku
the bf16 pipeline needs ~48GB unless ENABLE_CPU_OFFLOAD=1 (slow).
Replaces qwen/qwen-image-edit-plus and, per-preset, google/nano-banana.
"""

from __future__ import annotations

import os
import time

from .common import decode_image, encode_image, ok

MODEL_ID = os.environ.get("QWEN_EDIT_MODEL", "Qwen/Qwen-Image-Edit-2511")
LIGHTNING_REPO = "lightx2v/Qwen-Image-Edit-2511-Lightning"
LIGHTNING_WEIGHT = "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"

_pipeline = None


def _load():
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("op 'edit' needs a CUDA GPU — run it on the dev pod or serverless")

    if os.environ.get("NUNCHAKU") == "1":
        from nunchaku import NunchakuQwenImageTransformer2DModel
        from diffusers import QwenImageEditPlusPipeline

        transformer = NunchakuQwenImageTransformer2DModel.from_pretrained(
            os.environ.get(
                "NUNCHAKU_QWEN_PATH",
                "nunchaku-tech/nunchaku-qwen-image-edit-2511/svdq-int4_r32.safetensors",
            )
        )
        pipeline = QwenImageEditPlusPipeline.from_pretrained(
            MODEL_ID, transformer=transformer, torch_dtype=torch.bfloat16
        )
    else:
        from diffusers import QwenImageEditPlusPipeline

        pipeline = QwenImageEditPlusPipeline.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16)
        pipeline.load_lora_weights(LIGHTNING_REPO, weight_name=LIGHTNING_WEIGHT)

    if os.environ.get("ENABLE_CPU_OFFLOAD") == "1":
        pipeline.enable_model_cpu_offload()
    else:
        pipeline.to("cuda")
    _pipeline = pipeline
    return pipeline


def run(payload: dict) -> dict:
    started = time.time()
    prompt = str(payload.get("prompt", "")).strip()
    if not prompt:
        raise ValueError("missing prompt")
    image = decode_image(payload.get("image_b64", ""))

    pipeline = _load()
    result = pipeline(
        image=[image],
        prompt=prompt,
        negative_prompt=str(payload.get("negative_prompt", "")) or " ",
        num_inference_steps=int(payload.get("steps", 4)),
        true_cfg_scale=float(payload.get("cfg", 1.0)),
    ).images[0]

    return ok(encode_image(result), started, device="cuda", model="qwen-image-edit-2511")
