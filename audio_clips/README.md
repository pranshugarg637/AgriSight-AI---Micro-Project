# audio_clips/

Generated from `audio_scripts/` by `python scripts/generate_audio.py`.

**The committed clips were produced with `espeak-ng` (robotic, open-source,
offline) purely so the Farmer-Mode demo path plays sound end to end.** They
are not suitable for farmers. Before any pilot, replace them with
native-speaker recordings (`--backend prerecorded`) or a proper Indic TTS
model (`--backend coqui --coqui-model ...`), after the scripts themselves
have been reviewed (see `docs/HUMAN_TODO.md`).

Layout: `<lang>/<slug>/<field>.mp3`, plus `<lang>/manifest.json` recording
the text hash each clip was made from (so edited scripts can be regenerated
with `--only-changed`).
