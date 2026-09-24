"""
Translation backends behind one small interface.

The English grounded explanation is always the source of truth; a backend
only ever *translates* it. We never ask the LLM (llama3.2) to write Hindi or
any other language directly.

Backends:
  - "none"        : translation disabled (explanation shown in English)
  - "indictrans2" : AI4Bharat IndicTrans2 (open model, runs locally; needs
                    `pip install transformers sentencepiece` and, ideally,
                    `IndicTransToolkit`; model downloaded from Hugging Face)
  - "bhashini"    : Government of India Bhashini / ULCA pipeline API (needs
                    BHASHINI_USER_ID + BHASHINI_API_KEY)
"""
from __future__ import annotations

import logging
import threading
from typing import Protocol

import httpx

logger = logging.getLogger(__name__)


class TranslationUnavailable(Exception):
    """Backend cannot be used (not installed, no keys, model not downloaded)."""


class TranslationFailed(Exception):
    """Backend is available but this request failed."""


# ISO-639-1 app codes -> FLORES-200 codes used by IndicTrans2.
FLORES_CODES = {
    "en": "eng_Latn", "hi": "hin_Deva", "bn": "ben_Beng", "mr": "mar_Deva", "te": "tel_Telu",
    "ta": "tam_Taml", "gu": "guj_Gujr", "kn": "kan_Knda", "ml": "mal_Mlym", "pa": "pan_Guru",
    "or": "ory_Orya", "as": "asm_Beng", "ur": "urd_Arab", "ne": "npi_Deva", "sa": "san_Deva",
}


class TranslationBackend(Protocol):
    name: str

    def translate(self, texts: list[str], source: str, target: str) -> list[str]:
        ...


class NoTranslationBackend:
    name = "none"

    def translate(self, texts, source, target):
        raise TranslationUnavailable("Translation is disabled (TRANSLATION_BACKEND=none).")


class IndicTrans2Backend:
    """Lazy-loads IndicTrans2 on first use (en->indic and indic->en models)."""

    name = "indictrans2"

    def __init__(self, en_indic_model: str, indic_en_model: str, device: str = "cpu", max_length: int = 256):
        self.model_names = {"en_indic": en_indic_model, "indic_en": indic_en_model}
        self.device = device
        self.max_length = max_length
        self._loaded: dict[str, tuple] = {}
        self._processor = None
        self._lock = threading.Lock()
        self._load_error: str | None = None

    def _load(self, direction: str):
        with self._lock:
            if direction in self._loaded:
                return self._loaded[direction]
            try:
                from transformers import AutoModelForSeq2SeqLM, AutoTokenizer  # type: ignore
            except ImportError as e:
                raise TranslationUnavailable(
                    "IndicTrans2 needs `pip install transformers sentencepiece` (see docs/setup.md)."
                ) from e
            if self._processor is None:
                try:
                    from IndicTransToolkit.processor import IndicProcessor  # type: ignore

                    self._processor = IndicProcessor(inference=True)
                except ImportError:
                    logger.warning("IndicTransToolkit not installed; using minimal pre/post-processing.")
                    self._processor = _MinimalIndicProcessor()
            name = self.model_names[direction]
            try:
                tokenizer = AutoTokenizer.from_pretrained(name, trust_remote_code=True)
                model = AutoModelForSeq2SeqLM.from_pretrained(name, trust_remote_code=True).to(self.device)
                model.eval()
            except Exception as e:  # network / disk / auth errors
                raise TranslationUnavailable(f"Could not load IndicTrans2 model '{name}': {e}") from e
            self._loaded[direction] = (tokenizer, model)
            logger.info("Loaded IndicTrans2 model %s", name)
            return self._loaded[direction]

    def translate(self, texts, source, target):
        if source not in FLORES_CODES or target not in FLORES_CODES:
            raise TranslationUnavailable(f"Language pair {source}->{target} not supported by IndicTrans2.")
        direction = "en_indic" if source == "en" else "indic_en"
        tokenizer, model = self._load(direction)
        src, tgt = FLORES_CODES[source], FLORES_CODES[target]
        try:
            import torch

            batch = self._processor.preprocess_batch(texts, src_lang=src, tgt_lang=tgt)
            inputs = tokenizer(batch, truncation=True, padding="longest", return_tensors="pt").to(self.device)
            with torch.no_grad():
                generated = model.generate(**inputs, max_length=self.max_length, num_beams=4, num_return_sequences=1)
            decoded = tokenizer.batch_decode(generated, skip_special_tokens=True, clean_up_tokenization_spaces=True)
            return self._processor.postprocess_batch(decoded, lang=tgt)
        except TranslationUnavailable:
            raise
        except Exception as e:
            raise TranslationFailed(f"IndicTrans2 translation failed: {e}") from e


class _MinimalIndicProcessor:
    """Fallback when IndicTransToolkit is absent: IndicTrans2 expects
    '<src_lang> <tgt_lang> <sentence>' tags on the input."""

    def preprocess_batch(self, texts, src_lang, tgt_lang):
        return [f"{src_lang} {tgt_lang} {t.strip()}" for t in texts]

    def postprocess_batch(self, texts, lang):
        return [t.strip() for t in texts]


class BhashiniBackend:
    """
    Bhashini (ULCA) pipeline: 1) ask the config endpoint for a translation
    service + inference key, 2) call the inference endpoint. Requires keys
    from https://bhashini.gov.in/ulca. NOT exercised against the live API in
    this repository's tests (mocked) -- verify with your keys.
    """

    name = "bhashini"
    CONFIG_URL = "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline"

    def __init__(self, user_id: str, api_key: str, pipeline_id: str, timeout: float = 30.0, client: httpx.Client | None = None):
        self.user_id = user_id
        self.api_key = api_key
        self.pipeline_id = pipeline_id
        self.timeout = timeout
        self._client = client
        self._cache: dict[tuple[str, str], dict] = {}

    def _http(self) -> httpx.Client:
        return self._client or httpx.Client(timeout=self.timeout)

    def _config(self, source: str, target: str) -> dict:
        key = (source, target)
        if key in self._cache:
            return self._cache[key]
        if not self.user_id or not self.api_key:
            raise TranslationUnavailable("Set BHASHINI_USER_ID and BHASHINI_API_KEY to use the Bhashini backend.")
        body = {
            "pipelineTasks": [{"taskType": "translation", "config": {"language": {"sourceLanguage": source, "targetLanguage": target}}}],
            "pipelineRequestConfig": {"pipelineId": self.pipeline_id},
        }
        try:
            r = self._http().post(self.CONFIG_URL, json=body, headers={"userID": self.user_id, "ulcaApiKey": self.api_key})
            r.raise_for_status()
            data = r.json()
            endpoint = data["pipelineInferenceAPIEndPoint"]
            cfg = {
                "url": endpoint["callbackUrl"],
                "auth_name": endpoint["inferenceApiKey"]["name"],
                "auth_value": endpoint["inferenceApiKey"]["value"],
                "service_id": data["pipelineResponseConfig"][0]["config"][0]["serviceId"],
            }
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as e:
            raise TranslationUnavailable(f"Bhashini pipeline config failed: {e}") from e
        self._cache[key] = cfg
        return cfg

    def translate(self, texts, source, target):
        cfg = self._config(source, target)
        body = {
            "pipelineTasks": [
                {"taskType": "translation", "config": {"language": {"sourceLanguage": source, "targetLanguage": target}, "serviceId": cfg["service_id"]}}
            ],
            "inputData": {"input": [{"source": t} for t in texts]},
        }
        try:
            r = self._http().post(cfg["url"], json=body, headers={cfg["auth_name"]: cfg["auth_value"]})
            r.raise_for_status()
            outputs = r.json()["pipelineResponse"][0]["output"]
            return [o["target"] for o in outputs]
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as e:
            raise TranslationFailed(f"Bhashini translation failed: {e}") from e
