"""RunPod serverless entrypoint (production).

The dashboard talks to https://api.runpod.ai/v2/<endpoint>/runsync with
{"input": {"op": ..., ...}} and gets {"output": {...}} back — the exact
contract local_server.py mimics for development.
"""

import runpod

from pipelines.registry import run_op


def handler(job):
    return run_op(job.get("input") or {})


runpod.serverless.start({"handler": handler})
