"""
Central configuration for the ML service.
All tunables are loaded from environment variables so nothing is hardcoded
into application logic (per project requirement: thresholds must be configurable).
"""
from __future__ import annotations

import os
from pathlib import Path
from functools import lru_cache

from dotenv import load_dotenv

# Load .env from project root if present
_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_ROOT / ".env")


def _get_float(name: str, default: float) -> float:
    val = os.getenv(name)
    return float(val) if val not in (None, "") else default


def _get_int(name: str, default: int) -> int:
    val = os.getenv(name)
    return int(val) if val not in (None, "") else default


class Settings:
    # --- Paths ---
    PROJECT_ROOT: Path = _ROOT
    MODEL_PATH: Path = Path(os.getenv("MODEL_PATH", str(_ROOT / "models" / "plant_disease_model.pt")))
    MODEL_CONFIG_PATH: Path = Path(os.getenv("MODEL_CONFIG_PATH", str(_ROOT / "models" / "model_config.json")))
    CLASS_NAMES_PATH: Path = Path(os.getenv("CLASS_NAMES_PATH", str(_ROOT / "models" / "class_names.json")))
    DATASET_PATH: Path = Path(os.getenv("DATASET_PATH", str(_ROOT / "data" / "plantvillage")))
    VECTOR_DB_PATH: Path = Path(os.getenv("VECTOR_DB_PATH", str(_ROOT / "data" / "vector_db")))
    KNOWLEDGE_BASE_PATH: Path = Path(os.getenv("KNOWLEDGE_BASE_PATH", str(_ROOT / "knowledge_base" / "documents")))
    PREDICTIONS_LOG_PATH: Path = Path(os.getenv("PREDICTIONS_LOG_PATH", str(_ROOT / "data" / "predictions_log.jsonl")))
    GRADCAM_OUTPUT_PATH: Path = Path(os.getenv("GRADCAM_OUTPUT_PATH", str(_ROOT / "data" / "gradcam_outputs")))

    # --- Confidence thresholds (USP 1) ---
    HIGH_CONFIDENCE_THRESHOLD: float = _get_float("HIGH_CONFIDENCE_THRESHOLD", 0.80)
    LOW_CONFIDENCE_THRESHOLD: float = _get_float("LOW_CONFIDENCE_THRESHOLD", 0.60)

    # --- Differential diagnosis ---
    MAX_DIFFERENTIAL_ALTERNATIVES: int = _get_int("MAX_DIFFERENTIAL_ALTERNATIVES", 2)
    DIFFERENTIAL_MIN_SHARE: float = _get_float("DIFFERENTIAL_MIN_SHARE", 0.10)  # min prob to be shown as alt

    # --- RAG ---
    RAG_TOP_K: int = _get_int("RAG_TOP_K", 5)
    RAG_MIN_RELEVANCE_SCORE: float = _get_float("RAG_MIN_RELEVANCE_SCORE", 0.35)
    EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    CHUNK_SIZE: int = _get_int("CHUNK_SIZE", 800)
    CHUNK_OVERLAP: int = _get_int("CHUNK_OVERLAP", 120)

    # --- LLM (Ollama) ---
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "ollama")
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "llama3.2")
    LLM_TIMEOUT_SECONDS: int = _get_int("LLM_TIMEOUT_SECONDS", 60)
    LLM_TEMPERATURE: float = _get_float("LLM_TEMPERATURE", 0.2)

    # --- Image validation ---
    MAX_IMAGE_SIZE_MB: float = _get_float("MAX_IMAGE_SIZE_MB", 8.0)
    MIN_IMAGE_DIMENSION: int = _get_int("MIN_IMAGE_DIMENSION", 64)
    ALLOWED_IMAGE_TYPES: tuple = ("image/jpeg", "image/png", "image/webp")
    BLUR_VARIANCE_THRESHOLD: float = _get_float("BLUR_VARIANCE_THRESHOLD", 25.0)

    # --- Training ---
    IMAGE_SIZE: int = _get_int("IMAGE_SIZE", 224)
    BATCH_SIZE: int = _get_int("BATCH_SIZE", 32)
    NUM_EPOCHS: int = _get_int("NUM_EPOCHS", 15)
    LEARNING_RATE: float = _get_float("LEARNING_RATE", 1e-3)
    EARLY_STOPPING_PATIENCE: int = _get_int("EARLY_STOPPING_PATIENCE", 4)
    VAL_SPLIT: float = _get_float("VAL_SPLIT", 0.15)
    TEST_SPLIT: float = _get_float("TEST_SPLIT", 0.15)
    BACKBONE: str = os.getenv("BACKBONE", "mobilenet_v2")
    MODEL_VERSION: str = os.getenv("MODEL_VERSION", "1.0.0")


@lru_cache
def get_settings() -> "Settings":
    return Settings()
