"""
Deterministic, network-free embedding function used only in tests, so the
RAG test suite doesn't depend on downloading a model from HuggingFace.
In production, VectorStore uses SentenceTransformerEmbeddingFunction (see
app/rag/vector_store.py), which requires normal internet access -- this is
a stand-in for test speed and CI reproducibility only.
"""
from __future__ import annotations

import hashlib

import numpy as np
from chromadb import Documents, EmbeddingFunction, Embeddings


class DeterministicHashEmbeddingFunction(EmbeddingFunction):
    def __init__(self, dim: int = 128):
        self.dim = dim

    def __call__(self, input: Documents) -> Embeddings:
        vectors = []
        for text in input:
            vec = np.zeros(self.dim)
            for word in text.lower().split():
                idx = int(hashlib.md5(word.encode()).hexdigest(), 16) % self.dim
                vec[idx] += 1
            norm = np.linalg.norm(vec)
            if norm > 0:
                vec = vec / norm
            vectors.append(vec.tolist())
        return vectors

    def name(self) -> str:
        return "deterministic-hash-embedding-for-tests"
