"""Arabic diacritization (التشكيل) — Fine-Tashkeel (ByT5, MIT).

Text in, the same text with diacritics restored. Byte-level, so it never
tokenizes Arabic into wrong pieces and it handles anything the user types.
Reported DER 0.95% / WER 2.49% on Classical Arabic, which is the register our
users actually diacritize: Quranic verses, poetry, du'a, formal greetings.

The one op in the worker that is text→text rather than image→image; it returns
`text` instead of `image_b64`.
"""

from __future__ import annotations

import os
import re
import time

from .common import ok, pick_device

MODEL_ID = os.environ.get("TASHKEEL_MODEL", "basharalrfooh/Fine-Tashkeel")
MAX_CHARS = 600  # a design's text, not a document
# Arabic diacritics (harakat, shadda, sukun, tanween) plus the dagger alif.
DIACRITICS = re.compile(r"[ً-ْٰٓ-ٕـ]")

_model = None
_tokenizer = None
_device = ""


def _load():
    global _model, _tokenizer, _device
    if _model is not None:
        return _model, _tokenizer
    import torch
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    _device = pick_device()
    _tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID)
    model.to(torch.device(_device)).eval()
    _model = model
    return _model, _tokenizer


def strip_diacritics(text: str) -> str:
    """The model expects bare text; re-diacritizing already-marked text drifts."""
    return DIACRITICS.sub("", text)


def run(payload: dict) -> dict:
    import torch

    started = time.time()
    text = str(payload.get("text", "")).strip()
    if not text:
        raise ValueError("missing text")
    if len(text) > MAX_CHARS:
        raise ValueError(f"text too long ({len(text)} chars, max {MAX_CHARS})")

    bare = strip_diacritics(text)
    model, tokenizer = _load()
    inputs = tokenizer(bare, return_tensors="pt", truncation=True, max_length=1024).to(_device)
    with torch.no_grad():
        generated = model.generate(
            **inputs,
            # Byte-level output is longer than the input; diacritics roughly
            # double the character count, so leave generous headroom.
            max_new_tokens=min(1024, len(bare.encode("utf-8")) * 3 + 32),
            num_beams=int(payload.get("beams", 1)),
        )
    result = tokenizer.decode(generated[0], skip_special_tokens=True)

    return ok(
        {
            "text": result,
            "input_text": bare,
            # A safety signal for the caller: if the letters changed, the model
            # rewrote the words instead of only adding marks.
            "letters_preserved": strip_diacritics(result).replace(" ", "")
            == bare.replace(" ", ""),
        },
        started,
        device=_device,
        model=MODEL_ID.rsplit("/", 1)[-1],
    )
