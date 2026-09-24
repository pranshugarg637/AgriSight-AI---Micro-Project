"""Translation service: English stays the source of truth; backends are swappable and mocked here."""
import httpx
import pytest

from app.translation.service import TranslationService
from app.translation.backends import (
    BhashiniBackend, NoTranslationBackend, TranslationFailed, TranslationUnavailable, IndicTrans2Backend,
)


class UpperBackend:
    name = "fake-upper"

    def __init__(self):
        self.calls = []

    def translate(self, texts, source, target):
        self.calls.append((list(texts), source, target))
        return [f"[{target}] {t.upper()}" for t in texts]


def test_markdown_structure_is_preserved_and_only_prose_translated():
    backend = UpperBackend()
    svc = TranslationService(backend)
    src = "## What is happening?\nLeaves have spots.\n\n- Remove debris\n## Important caution\nAsk an expert."
    res = svc.translate_markdown(src, target="hi")
    assert res.status == "translated"
    assert res.backend == "fake-upper"
    lines = res.text.split("\n")
    assert lines[0] == "## [hi] WHAT IS HAPPENING?"
    assert lines[1] == "[hi] LEAVES HAVE SPOTS."
    assert lines[2] == ""
    assert lines[3] == "- [hi] REMOVE DEBRIS"
    assert backend.calls[0][1:] == ("en", "hi")


def test_same_language_is_not_translated():
    svc = TranslationService(UpperBackend())
    assert svc.translate_markdown("hello", target="en").status == "not_requested"


def test_disabled_backend_reports_unavailable_without_text():
    res = TranslationService(NoTranslationBackend()).translate_markdown("hello", target="hi")
    assert res.status == "unavailable"
    assert res.text is None


def test_backend_failure_reports_failed():
    class Broken:
        name = "broken"

        def translate(self, texts, source, target):
            raise TranslationFailed("boom")

    res = TranslationService(Broken()).translate_markdown("hello", target="hi")
    assert res.status == "failed" and res.text is None


def test_segment_count_mismatch_is_a_failure():
    class Short:
        name = "short"

        def translate(self, texts, source, target):
            return texts[:-1]

    res = TranslationService(Short()).translate_markdown("a\nb", target="hi")
    assert res.status == "failed"


def test_indictrans2_rejects_unsupported_language_pair():
    with pytest.raises(TranslationUnavailable):
        IndicTrans2Backend("x", "y").translate(["hi"], "en", "xx")


def test_bhashini_without_keys_is_unavailable():
    with pytest.raises(TranslationUnavailable):
        BhashiniBackend("", "", "pid").translate(["hello"], "en", "hi")


def test_bhashini_two_step_flow_with_mocked_http():
    def handler(request: httpx.Request):
        if "getModelsPipeline" in str(request.url):
            assert request.headers["userID"] == "u" and request.headers["ulcaApiKey"] == "k"
            return httpx.Response(200, json={
                "pipelineInferenceAPIEndPoint": {"callbackUrl": "https://infer.example/compute",
                                                 "inferenceApiKey": {"name": "Authorization", "value": "secret"}},
                "pipelineResponseConfig": [{"config": [{"serviceId": "svc-1"}]}],
            })
        assert request.headers["Authorization"] == "secret"
        body = request.read().decode()
        assert "svc-1" in body
        return httpx.Response(200, json={"pipelineResponse": [{"output": [{"target": "नमस्ते"}]}]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    out = BhashiniBackend("u", "k", "pid", client=client).translate(["hello"], "en", "hi")
    assert out == ["नमस्ते"]


def test_drift_check_scores_identity_round_trip_high_and_garbage_low():
    from app.translation.drift_check import chrf, run

    assert chrf("Please visit the office", "Please visit the office") == pytest.approx(1.0)
    assert chrf("Please visit the office", "zzz qqq") < 0.2

    class RoundTrip:
        name = "rt"

        def translate(self, texts, source, target):
            return [t[::-1] for t in texts]  # reversible "translation"

    report = run("hi", ["hello farmer friend"], service=TranslationService(RoundTrip()))
    assert report["n"] == 1 and report["mean_chrf"] == pytest.approx(1.0)
    assert "not evidence" in report["note"]
