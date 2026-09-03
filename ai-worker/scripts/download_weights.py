"""Fetch model weights. --small grabs the CPU-class checkpoints (also what a
Mac needs); --diffusion pre-caches the CUDA models into HF_HOME at container
build time so serverless cold-starts skip the download.
"""

from __future__ import annotations

import argparse
import os
import sys
import urllib.request

WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "..", "weights")

SMALL = {
    "RealESRGAN_x4plus.pth": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
    "GFPGANv1.4.pth": "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth",
}

DIFFUSION_REPOS = [
    "Qwen/Qwen-Image-Edit-2511",
    "lightx2v/Qwen-Image-Edit-2511-Lightning",
    "black-forest-labs/FLUX.1-schnell",
    "QCRI/Fanar-2-Oryx-IG",
]


def fetch_small():
    os.makedirs(WEIGHTS_DIR, exist_ok=True)
    for name, url in SMALL.items():
        target = os.path.join(WEIGHTS_DIR, name)
        if os.path.exists(target) and os.path.getsize(target) > 1_000_000:
            print(f"skip {name} (exists)")
            continue
        print(f"downloading {name} ...")
        urllib.request.urlretrieve(url, target)
    # LaMa: simple-lama-inpainting caches big-lama.pt on first construction.
    try:
        import torch
        from simple_lama_inpainting import SimpleLama

        SimpleLama(device=torch.device("cpu"))
        print("big-lama cached")
    except Exception as error:
        print(f"warning: lama pre-cache failed: {error}", file=sys.stderr)


def fetch_diffusion():
    from huggingface_hub import snapshot_download

    for repo in DIFFUSION_REPOS:
        print(f"caching {repo} ...")
        snapshot_download(repo, token=os.environ.get("HF_TOKEN") or None)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--small", action="store_true")
    parser.add_argument("--diffusion", action="store_true")
    args = parser.parse_args()
    if args.small:
        fetch_small()
    if args.diffusion:
        fetch_diffusion()
    if not (args.small or args.diffusion):
        parser.print_help()
