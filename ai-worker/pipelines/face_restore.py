"""Face enhance with GFPGAN v1.4 via spandrel.

Detect each face, warp it onto GFPGAN's canonical 512x512 template, restore it,
warp it back. The rest of the frame is never touched.

★This replaced a v0 that squashed the WHOLE frame to 512x512, ran it through the
face model, and stretched the result back. Two things were wrong with that, both
visible on the first real card render (2026-09-03):

  * A 1024x1280 portrait became 1:1 on the way in, so the model was shown a
    horizontally compressed face and "restored" it as if those proportions were
    real. Stretching back left a subtly different, wider face.
  * A face model asked to reconstruct an entire scene invents the scene. The
    potted plant behind the subject came back as different flowers.

Cropping per face fixes both: the model only ever sees a square face at its
native proportions, and every pixel outside the blend mask is the original.

Detection is OpenCV's YuNet (a 230 KB ONNX from the OpenCV model zoo) rather
than facexlib, which would drag in basicsr and a much larger install. The
bundled Haar cascade was tried first and is not usable: on the hijab portrait
this tool's own card is rendered from, it missed the real face at every setting
and returned boxes on the potted plant and the cardigan instead.

ALIGNMENT is not optional. A first pass cropped a padded square around each box
and fed that straight in; hazel eyes came back bright blue, with a blue cast on
the eyebrows, on an UNDEGRADED source — so it was not the model hallucinating
through damage, it was being shown a face that did not sit where it expects one.
GFPGAN is trained on FFHQ-aligned crops: eyes, nose and mouth land on fixed
pixels. YuNet already returns those five landmarks, so a similarity transform
onto the template costs nothing and is what makes the output faithful.

A photo with no detectable face raises instead of returning the input unchanged,
so the route fails and the user is not charged for a no-op.
"""

from __future__ import annotations

import os
import time

import numpy as np
from PIL import Image

from .common import decode_image, encode_image, ok, pick_device

WEIGHTS = os.path.join(os.path.dirname(__file__), "..", "weights", "GFPGANv1.4.pth")
DETECTOR = os.path.join(
    os.path.dirname(__file__), "..", "weights", "face_detection_yunet_2023mar.onnx"
)

# The model's native input. Every crop is resized to this and back.
FACE_SIZE = 512
# GFPGAN's canonical landmark positions inside a 512x512 crop, in YuNet's order:
# right eye, left eye, nose tip, right mouth corner, left mouth corner. These are
# facexlib's FFHQ template — change them and the model sees a face out of place.
FFHQ_TEMPLATE = np.array(
    [
        [192.98138, 239.94708],
        [318.90277, 240.19366],
        [256.63416, 314.01935],
        [201.26117, 371.41043],
        [313.08905, 371.15118],
    ],
    dtype=np.float32,
)
# How far the blend mask is pulled in from the edge of the aligned crop, and how
# softly it fades, both as a fraction of FACE_SIZE. Keeps the restored face from
# ending on a hard rectangle over the hair or collar.
MASK_INSET = 0.06
MASK_FEATHER = 0.08
MAX_FACES = 8
# How much of the restored face to keep, 0..1 — the same knob GFPGAN's own
# reference implementation calls `weight`. Full strength repaints the iris, and
# GFPGAN's FFHQ bias turns hazel and green eyes blue even on an undamaged
# source. Mixing the restoration back over the original keeps the eye colour the
# photo actually has while still buying the sharpness people came for.
# Swept 0.35/0.55/0.80/1.00 against the same portrait on 2026-09-03: hazel stayed
# hazel to about 0.4 and was unmistakably blue by 0.8. 0.4 is the last value that
# never changes who the person is.
DEFAULT_STRENGTH = 0.4
# YuNet's own confidence gate. 0.6 is its documented default; lower invites the
# background boxes that made Haar useless here.
MIN_SCORE = 0.6

_model = None
_device = ""
_detector = None


def _load():
    global _model, _device
    if _model is not None:
        return _model
    import torch
    from spandrel import ModelLoader

    _device = pick_device()
    descriptor = ModelLoader().load_from_file(os.path.abspath(WEIGHTS))
    descriptor.to(torch.device(_device)).eval()
    _model = descriptor
    return _model


def _load_detector(size: tuple[int, int]):
    global _detector
    import cv2

    if _detector is None:
        _detector = cv2.FaceDetectorYN.create(
            os.path.abspath(DETECTOR), "", size, MIN_SCORE, 0.3, 5000
        )
    # YuNet needs the frame size up front and it changes per request.
    _detector.setInputSize(size)
    return _detector


def _detect_faces(image: Image.Image) -> list[np.ndarray]:
    """The five landmarks of every face found, biggest face first."""
    import cv2

    frame = cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2BGR)
    _, detections = _load_detector((image.width, image.height)).detect(frame)
    rows = [] if detections is None else sorted(
        detections, key=lambda r: float(r[2]) * float(r[3]), reverse=True
    )
    # Columns 4..13 are the landmark pairs, in the order FFHQ_TEMPLATE expects.
    return [np.asarray(row[4:14], dtype=np.float32).reshape(5, 2) for row in rows[:MAX_FACES]]


def _restore_aligned(aligned: np.ndarray) -> np.ndarray:
    """One FFHQ-aligned 512x512 RGB face in, the restored one out."""
    import torch

    model = _load()
    tensor = (
        torch.from_numpy(aligned.astype(np.float32) / 255.0)
        .permute(2, 0, 1)
        .unsqueeze(0)
        .to(_device)
    )
    with torch.no_grad():
        restored = model(tensor)[0].clamp(0, 1).permute(1, 2, 0).cpu().numpy()
    return (restored * 255.0).round().astype(np.uint8)


def _blend_mask() -> np.ndarray:
    """Soft-edged oval-ish mask over the aligned crop, in 0..1."""
    import cv2

    inset = max(1, int(FACE_SIZE * MASK_INSET))
    mask = np.zeros((FACE_SIZE, FACE_SIZE), dtype=np.float32)
    mask[inset : FACE_SIZE - inset, inset : FACE_SIZE - inset] = 1.0
    blur = max(3, int(FACE_SIZE * MASK_FEATHER) | 1)
    return cv2.GaussianBlur(mask, (blur, blur), 0)


def run(payload: dict) -> dict:
    import cv2

    started = time.time()
    image = decode_image(payload.get("image_b64", "")).convert("RGB")

    faces = _detect_faces(image)
    if not faces:
        # Better a clean failure than a charge for an image we did not improve.
        raise ValueError("no face detected")

    strength = float(payload.get("strength", DEFAULT_STRENGTH))
    strength = min(max(strength, 0.0), 1.0)
    canvas = np.array(image, dtype=np.float32)
    mask = _blend_mask() * strength
    restored_count = 0

    for landmarks in faces:
        affine, _ = cv2.estimateAffinePartial2D(
            landmarks, FFHQ_TEMPLATE, method=cv2.LMEDS
        )
        if affine is None:
            continue
        aligned = cv2.warpAffine(
            np.array(image), affine, (FACE_SIZE, FACE_SIZE), flags=cv2.INTER_LINEAR
        )
        restored = _restore_aligned(aligned)

        inverse = cv2.invertAffineTransform(affine)
        size = (image.width, image.height)
        back = cv2.warpAffine(restored, inverse, size, flags=cv2.INTER_LINEAR).astype(
            np.float32
        )
        back_mask = cv2.warpAffine(mask, inverse, size, flags=cv2.INTER_LINEAR)[..., None]
        canvas = back * back_mask + canvas * (1.0 - back_mask)
        restored_count += 1

    if not restored_count:
        raise ValueError("no face could be aligned")

    result = Image.fromarray(canvas.clip(0, 255).round().astype(np.uint8))
    return ok(
        encode_image(result, format="PNG"),
        started,
        device=_device,
        model="gfpgan-v1.4",
        faces=restored_count,
        strength=strength,
    )
