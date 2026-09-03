# Nayroz AI worker — RunPod serverless image.
# Weights are BAKED into the image (network volumes cold-start too slowly).
# Build on x86_64: docker build --platform linux/amd64 -t nayroz-ai-worker .

FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Nunchaku INT4 kernels for Qwen-Image-Edit on 24GB cards (see NUNCHAKU=1 in
# pipelines/edit.py). Match the wheel to the torch/cuda of the base image:
# https://github.com/nunchaku-ai/nunchaku/releases
# RUN pip install --no-cache-dir https://github.com/nunchaku-ai/nunchaku/releases/download/<ver>/nunchaku-<ver>+torch2.4-cp311-linux_x86_64.whl

COPY scripts/download_weights.py scripts/download_weights.py
RUN python scripts/download_weights.py --small

# Heavy diffusion weights (~40GB with Qwen bf16; pass --no-qwen to skip and
# rely on NUNCHAKU checkpoints only). Uses HF_TOKEN build secret if the repo
# needs auth (none of ours do today).
ARG BAKE_DIFFUSION=1
ENV HF_HOME=/app/hf-cache
RUN if [ "$BAKE_DIFFUSION" = "1" ]; then python scripts/download_weights.py --diffusion; fi

COPY pipelines pipelines
COPY handler.py .

ENV NUNCHAKU=0
CMD ["python", "-u", "handler.py"]
