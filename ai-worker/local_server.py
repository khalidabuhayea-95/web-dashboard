"""Local dev server exposing the SAME contract as RunPod serverless /runsync,
so the dashboard switches between laptop and cloud with one env var:

    SELFHOST_AI_URL=http://127.0.0.1:8484            (this server)
    SELFHOST_AI_URL=https://api.runpod.ai/v2/<id>    (production)

Run:  .venv/bin/python local_server.py
"""

from __future__ import annotations

import os
import traceback
import uuid

import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request

from pipelines.registry import run_op

app = FastAPI(title="nayroz-ai-worker (local)")
TOKEN = os.environ.get("SELFHOST_AI_TOKEN", "")


def _check_auth(authorization: str | None):
    if not TOKEN:
        return
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="bad token")


@app.get("/health")
def health():
    from pipelines.common import pick_device

    return {"ok": True, "device": pick_device()}


@app.post("/runsync")
async def runsync(request: Request, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    body = await request.json()
    job_id = f"local-{uuid.uuid4().hex[:12]}"
    try:
        output = run_op(body.get("input") or {})
        return {"id": job_id, "status": "COMPLETED", "output": output}
    except Exception as error:  # mirror RunPod's failure envelope
        traceback.print_exc()
        return {"id": job_id, "status": "FAILED", "error": str(error)}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8484")))
