#!/usr/bin/env python3
import json
import sys


def fail(kind: str, message: str, exit_code: int) -> None:
    payload = {
        "ok": False,
        "kind": str(kind or "processing_failed"),
        "message": str(message or "Background removal failed."),
    }
    sys.stderr.write(json.dumps(payload))
    sys.stderr.flush()
    raise SystemExit(exit_code)


def ensure_supported_python() -> None:
    if sys.version_info < (3, 11):
        fail("provider_unavailable", "rembg requires Python 3.11 or newer.", 21)


def run_check() -> None:
    ensure_supported_python()
    try:
        import rembg  # type: ignore
    except Exception as exc:  # pragma: no cover - runtime dependency probe
        fail("provider_unavailable", f"rembg is not installed or failed to import: {exc}", 22)

    payload = {
        "ok": True,
        "python": sys.executable,
        "pythonVersion": sys.version.split()[0],
        "rembgVersion": getattr(rembg, "__version__", ""),
    }
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


def run_remove() -> None:
    ensure_supported_python()

    try:
        from rembg import remove  # type: ignore
    except Exception as exc:  # pragma: no cover - runtime dependency probe
        fail("provider_unavailable", f"rembg is not installed or failed to import: {exc}", 22)

    input_bytes = sys.stdin.buffer.read()
    if not input_bytes:
        fail("invalid_input", "Missing image bytes.", 23)

    try:
        output_bytes = remove(input_bytes, force_return_bytes=True)
    except Exception as exc:  # pragma: no cover - runtime processing path
        fail("processing_failed", f"rembg failed to remove the image background: {exc}", 24)

    if not output_bytes:
        fail("unprocessable_image", "rembg did not return an output image.", 25)

    sys.stdout.buffer.write(output_bytes)
    sys.stdout.buffer.flush()


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        run_check()
        return
    run_remove()


if __name__ == "__main__":
    main()
