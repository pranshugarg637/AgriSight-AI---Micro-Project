#!/usr/bin/env python3
"""
Turn audio_scripts/<lang>/*.json into playable clips:
    audio_clips/<lang>/<slug>/<field>.mp3   (+ audio_clips/<lang>/manifest.json)

Usage:
    python scripts/generate_audio.py --lang en hi                      # espeak-ng (default)
    python scripts/generate_audio.py --lang hi --backend coqui --coqui-model <model>
    python scripts/generate_audio.py --lang hi --backend prerecorded --source-dir recordings/hi
    python scripts/generate_audio.py --lang hi --only-changed          # regenerate edited texts only

Backends
  espeak-ng   : open-source, offline, available on Windows/Linux/macOS. Robotic
                voice -- fine for development, NOT for farmers. Replace with a
                native-speaker recording or an Indic TTS model before a pilot.
  coqui       : any Coqui-TTS compatible model (`pip install TTS`), e.g. an
                AI4Bharat Indic-TTS checkpoint -- pass --coqui-model.
  prerecorded : copy human recordings laid out as <source-dir>/<slug>/<field>.(mp3|wav|ogg).

The manifest stores a hash of each clip's text so stale clips (text edited
after generation) are detected; the app only plays what exists.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "audio_scripts"
CLIPS = ROOT / "audio_clips"
ESPEAK_VOICES = {"en": "en-gb", "hi": "hi"}


QUESTIONS = ROOT / "knowledge_base" / "questions"


def iter_clips(lang: str):
    # symptom questions (knowledge_base/questions/*.json) -> slug "q_<a>_vs_<b>"
    for f in sorted(QUESTIONS.glob("*.json")):
        doc = json.loads(f.read_text(encoding="utf-8"))
        qslug = "q_" + f.stem.replace("__vs__", "_vs_")
        for q in doc.get("questions", []):
            text = (q.get("text") or {}).get(lang)
            if text:
                yield qslug, q["id"], text.strip(), bool(doc.get("reviewed_by_native_speaker"))
    for f in sorted((SCRIPTS / lang).glob("*.json")):
        doc = json.loads(f.read_text(encoding="utf-8"))
        slug = "prompt" if doc.get("kind") == "prompts" else doc["slug"]
        for field, text in (doc.get("clips") or {}).items():
            if isinstance(text, str) and text.strip():
                yield slug, field, text.strip(), bool(doc.get("reviewed_by_native_speaker"))


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def to_mp3(wav: Path, out: Path) -> Path:
    if shutil.which("ffmpeg"):
        mp3 = out.with_suffix(".mp3")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-ac", "1", "-b:a", "48k", str(mp3)], check=True)
        return mp3
    dst = out.with_suffix(".wav")
    shutil.copyfile(wav, dst)
    return dst


def synth_espeak(text: str, lang: str, out: Path) -> Path:
    exe = shutil.which("espeak-ng") or shutil.which("espeak")
    if not exe:
        raise SystemExit("espeak-ng not found. Install it (apt install espeak-ng / https://github.com/espeak-ng/espeak-ng/releases).")
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "clip.wav"
        subprocess.run([exe, "-v", ESPEAK_VOICES.get(lang, lang), "-s", "140", "-w", str(wav), text], check=True)
        return to_mp3(wav, out)


_coqui = None


def synth_coqui(text: str, lang: str, out: Path, model: str) -> Path:
    global _coqui
    if _coqui is None:
        try:
            from TTS.api import TTS  # type: ignore
        except ImportError:
            raise SystemExit("Coqui TTS not installed: pip install TTS")
        _coqui = TTS(model_name=model)
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "clip.wav"
        _coqui.tts_to_file(text=text, file_path=str(wav))
        return to_mp3(wav, out)


def copy_prerecorded(slug: str, field: str, source_dir: Path, out: Path) -> Path | None:
    for ext in (".mp3", ".ogg", ".wav"):
        src = source_dir / slug / f"{field}{ext}"
        if src.exists():
            dst = out.with_suffix(ext)
            shutil.copyfile(src, dst)
            return dst
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lang", nargs="+", default=["en", "hi"])
    ap.add_argument("--backend", choices=["espeak-ng", "coqui", "prerecorded"], default="espeak-ng")
    ap.add_argument("--coqui-model")
    ap.add_argument("--source-dir", type=Path)
    ap.add_argument("--only-changed", action="store_true", help="skip clips whose text hash is unchanged")
    args = ap.parse_args(argv)

    for lang in args.lang:
        manifest_path = CLIPS / lang / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
        made = skipped = missing = 0
        for slug, field, text, reviewed in iter_clips(lang):
            key = f"{lang}.{slug}.{field}"
            h = text_hash(text)
            if args.only_changed and manifest.get(key, {}).get("text_sha") == h:
                skipped += 1
                continue
            out = CLIPS / lang / slug / field
            out.parent.mkdir(parents=True, exist_ok=True)
            for old in out.parent.glob(f"{field}.*"):
                old.unlink()
            if args.backend == "espeak-ng":
                f = synth_espeak(text, lang, out)
            elif args.backend == "coqui":
                if not args.coqui_model:
                    raise SystemExit("--coqui-model is required for the coqui backend")
                f = synth_coqui(text, lang, out, args.coqui_model)
            else:
                if not args.source_dir:
                    raise SystemExit("--source-dir is required for the prerecorded backend")
                f = copy_prerecorded(slug, field, args.source_dir, out)
                if f is None:
                    missing += 1
                    continue
            manifest[key] = {"file": str(f.relative_to(CLIPS / lang)).replace("\\", "/"), "text_sha": h,
                             "backend": args.backend, "script_reviewed_by_native_speaker": reviewed}
            made += 1
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
        print(f"[{lang}] generated {made}, unchanged {skipped}, missing recordings {missing}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
