"""Op router. Every op takes {input} and returns the uniform envelope from
common.ok(). Pipelines import their frameworks lazily so a worker that only
serves cheap CPU ops never pays for the heavy ones.
"""

from __future__ import annotations

import importlib

OPS = {
    "remove-object": "pipelines.remove_object",
    "upscale": "pipelines.upscale",
    "face-restore": "pipelines.face_restore",
    "remove-bg": "pipelines.remove_bg",
    "edit": "pipelines.edit",
    "generate": "pipelines.generate",
    "tashkeel": "pipelines.tashkeel",
}


def run_op(payload: dict) -> dict:
    op = str(payload.get("op", "")).strip().lower()
    module_path = OPS.get(op)
    if not module_path:
        raise ValueError(f"unknown op '{op}' — supported: {sorted(OPS)}")
    module = importlib.import_module(module_path)
    return module.run(payload)
