"""
Translation service used by the prediction pipeline.

Translates the *English, evidence-grounded* explanation into the user's
language, line by line, keeping the "## Heading" structure. The original
English text and the citations are always returned unchanged next to the
translation so a reviewer can compare them.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from functools import lru_cache

from app.config import get_settings
from app.translation.backends import (
    BhashiniBackend,
    IndicTrans2Backend,
    NoTranslationBackend,
    TranslationBackend,
    TranslationFailed,
    TranslationUnavailable,
)

logger = logging.getLogger(__name__)

_HEADING = re.compile(r"^(\s*#{1,6}\s+)(.*)$")
_BULLET = re.compile(r"^(\s*(?:[-*•]|\d+[.)])\s+)(.*)$")


@dataclass
class TranslationResult:
    text: str | None
    backend: str
    status: str  # "not_requested" | "translated" | "unavailable" | "failed"
    detail: str | None = None


class TranslationService:
    def __init__(self, backend: TranslationBackend):
        self.backend = backend

    def translate_texts(self, texts: list[str], source: str, target: str) -> list[str]:
        return self.backend.translate(texts, source, target)

    def translate_markdown(self, text: str, target: str, source: str = "en") -> TranslationResult:
        if not text or target == source:
            return TranslationResult(text=None, backend=self.backend.name, status="not_requested")

        # Split into lines, keep markdown prefixes, translate only the prose.
        lines = text.split("\n")
        prefixes: list[str] = []
        segments: list[str] = []
        index: list[int] = []
        for i, line in enumerate(lines):
            m = _HEADING.match(line) or _BULLET.match(line)
            prefix, body = (m.group(1), m.group(2)) if m else ("", line)
            prefixes.append(prefix)
            if body.strip():
                index.append(i)
                segments.append(body.strip())
        try:
            translated = self.backend.translate(segments, source, target) if segments else []
            if len(translated) != len(segments):
                raise TranslationFailed("backend returned a different number of segments")
        except TranslationUnavailable as e:
            logger.warning("Translation unavailable: %s", e)
            return TranslationResult(text=None, backend=self.backend.name, status="unavailable", detail=str(e))
        except TranslationFailed as e:
            logger.warning("Translation failed: %s", e)
            return TranslationResult(text=None, backend=self.backend.name, status="failed", detail=str(e))

        out = list(lines)
        for i, t in zip(index, translated):
            out[i] = prefixes[i] + t
        return TranslationResult(text="\n".join(out), backend=self.backend.name, status="translated")


def build_backend(name: str | None = None) -> TranslationBackend:
    s = get_settings()
    name = (name or s.TRANSLATION_BACKEND or "none").lower()
    if name == "indictrans2":
        return IndicTrans2Backend(s.INDICTRANS2_EN_INDIC_MODEL, s.INDICTRANS2_INDIC_EN_MODEL, device=s.TRANSLATION_DEVICE)
    if name == "bhashini":
        return BhashiniBackend(s.BHASHINI_USER_ID, s.BHASHINI_API_KEY, s.BHASHINI_PIPELINE_ID)
    if name != "none":
        logger.warning("Unknown TRANSLATION_BACKEND '%s'; translation disabled.", name)
    return NoTranslationBackend()


@lru_cache
def get_translation_service() -> TranslationService:
    return TranslationService(build_backend())


def reset_translation_service_for_tests() -> None:
    get_translation_service.cache_clear()
