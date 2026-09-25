"""
Hybrid retrieval: BM25 (keywords) + embeddings (meaning).

Ranking uses  hybrid = alpha * emb_norm + (1 - alpha) * bm25_norm.
The SAFETY GATE is unchanged: a chunk is only used if its *embedding*
relevance (1 / (1 + squared L2 distance), exactly as in v1) is at least
RAG_MIN_RELEVANCE_SCORE. BM25 can re-order or surface candidates; it can
never let an irrelevant chunk through the gate.
"""
from __future__ import annotations

import re

import numpy as np

_TOKEN = re.compile(r"[a-z0-9]+")
_bm25_cache: dict = {}


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


def _minmax(x: np.ndarray) -> np.ndarray:
    if x.size == 0:
        return x
    lo, hi = float(x.min()), float(x.max())
    return np.zeros_like(x) if hi - lo < 1e-12 else (x - lo) / (hi - lo)


def hybrid_search(store, query: str, top_k: int, alpha: float = 0.6) -> list[dict]:
    """Returns up to top_k dicts {text, metadata, relevance, bm25, hybrid}, best first."""
    from rank_bm25 import BM25Okapi

    data = store.collection.get(include=["documents", "metadatas", "embeddings"])
    docs = data.get("documents") or []
    if not docs:
        return []
    metas = data.get("metadatas") or [{}] * len(docs)
    embs = np.asarray(data.get("embeddings"), dtype=np.float64)

    key = (id(store.collection), len(docs), tuple(data.get("ids") or [])[:5])
    bm25 = _bm25_cache.get(key)
    if bm25 is None:
        bm25 = BM25Okapi([tokenize(d) or ["_"] for d in docs])
        _bm25_cache.clear()
        _bm25_cache[key] = bm25
    bm25_scores = np.asarray(bm25.get_scores(tokenize(query)), dtype=np.float64)

    q = np.asarray(store.embedding_fn([query])[0], dtype=np.float64)
    sq_l2 = ((embs - q) ** 2).sum(axis=1)
    relevance = 1.0 / (1.0 + sq_l2)

    hybrid = alpha * _minmax(relevance) + (1 - alpha) * _minmax(bm25_scores)
    order = np.argsort(-hybrid)[:top_k]
    return [
        {"text": docs[i], "metadata": metas[i] or {}, "relevance": float(relevance[i]),
         "bm25": float(bm25_scores[i]), "hybrid": float(hybrid[i])}
        for i in order
    ]


class CrossEncoderReranker:
    """Optional re-ranker (RAG_RERANKER=cross-encoder). Only re-orders chunks
    that already passed the relevance gate."""

    def __init__(self, model_name: str):
        from sentence_transformers import CrossEncoder

        self.model = CrossEncoder(model_name)

    def rerank(self, query: str, chunks: list) -> list:
        if len(chunks) < 2:
            return chunks
        scores = self.model.predict([(query, c.text) for c in chunks])
        return [c for _, c in sorted(zip(scores, chunks), key=lambda t: -float(t[0]))]
