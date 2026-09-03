# Nayroz AI Worker

Self-hosted inference worker replacing per-image Replicate spend. One
codebase, three environments — the laptop runs the CPU/MPS ops, the CUDA
container runs everything:

| op | model | license | runs on Mac? |
| --- | --- | --- | --- |
| `remove-object` | big-LaMa | Apache-2.0 | ✅ (~2-6s) |
| `upscale` | Real-ESRGAN x4plus | BSD-3 | ✅ |
| `face-restore` | GFPGAN v1.4 | Apache-2.0 | ✅ |
| `remove-bg` | BiRefNet | MIT | ✅ (needs `timm einops`) |
| `edit` | Qwen-Image-Edit-2511 + Lightning | Apache-2.0 | ❌ CUDA only |
| `generate` | FLUX.1-schnell (+ Fanar Oryx-IG LoRA for `style:"arabic"`) | Apache-2.0 | ❌ CUDA only |

## Local dev (Mac)

```bash
cd ai-worker
/opt/homebrew/bin/python3.11 -m venv .venv
./.venv/bin/pip install -r requirements-local.txt
./.venv/bin/python scripts/download_weights.py --small
./.venv/bin/python local_server.py                  # -> http://127.0.0.1:8484
./.venv/bin/python scripts/smoke_test.py            # before/after files in scripts/
```

Point the dashboard at it in `.env.local`:

```
SELFHOST_AI_URL=http://127.0.0.1:8484
# SELFHOST_AI_TOKEN=...   # optional shared secret (required in production)
```

## Dev pod (rented GPU, by the hour)

Rent any CUDA pod (RunPod 4090 community ≈ $0.34/hr), clone the repo,
`pip install -r requirements.txt`, run `local_server.py --host 0.0.0.0`,
and point `SELFHOST_AI_URL` at the pod. Same contract, now `edit` and
`generate` work. Stop the pod when done.

## Production (RunPod serverless)

```bash
docker build --platform linux/amd64 -t <registry>/nayroz-ai-worker .
docker push <registry>/nayroz-ai-worker
```

Create a serverless endpoint from the image (24GB+ GPU; enable FlashBoot),
then set:

```
SELFHOST_AI_URL=https://api.runpod.ai/v2/<endpoint-id>
SELFHOST_AI_TOKEN=<runpod api key>
```

The dashboard's `selfhost` providers call `POST {SELFHOST_AI_URL}/runsync`
with `{"input": {"op": ..., "image_b64": ...}}` — identical against the
local server, a dev pod, or serverless. On 24GB cards set `NUNCHAKU=1`
(install the wheel in the Dockerfile) for INT4 Qwen at ~2-4s/edit.

## Contract

Request: `{"input": {"op": "remove-object", "image_b64": "...", "mask_b64": "..."}}`
Response: `{"status": "COMPLETED", "output": {"image_b64": "...", "mime_type": "image/png", "model": "...", "device": "...", "duration_ms": 1234}}`
Failures: `{"status": "FAILED", "error": "..."}` (RunPod-compatible).
