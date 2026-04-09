"""
rag.py
------
Core RAG module for Mississauga civic meeting content.

Wraps ChromaDB with an embedding function that routes to:
  - OpenAI text-embedding-3-small  (when OPENAI_API_KEY is set)
  - sentence-transformers all-MiniLM-L6-v2  (local fallback)

Collections
-----------
  meetings  –  all chunks from transcripts + PDFs, with rich metadata.

Metadata schema (every chunk has all fields)
----------------------------------------------
  source_type    : "transcript" | "agenda" | "minutes" | "attachment"
  committee      : "Budget Committee" | "Road Safety Committee" | ...
  meeting_id     : GUID from Escribe
  meeting_title  : human-readable title
  date           : YYYY-MM-DD
  file           : relative path to source file
  document_title : PDF title or transcript stem
  speakers       : comma-separated resolved speaker names (transcripts only, else "")
  start_time     : float seconds (transcripts only, else -1)
  end_time       : float seconds (transcripts only, else -1)
  chunk_index    : int, position within the source document
"""

import os
import re
from pathlib import Path
from typing import Any

COLLECTION_NAME = "meetings"
RAG_DIR = Path(__file__).parent / "data" / "rag"


# ---------------------------------------------------------------------------
# Embedding function factory
# ---------------------------------------------------------------------------


def _make_embedding_fn():
    """Return a ChromaDB-compatible embedding function."""
    if os.getenv("OPENAI_API_KEY"):
        from chromadb.utils.embedding_functions import OpenAIEmbeddingFunction
        return OpenAIEmbeddingFunction(
            api_key=os.environ["OPENAI_API_KEY"],
            model_name="text-embedding-3-small",
        )
    else:
        from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction
        return SentenceTransformerEmbeddingFunction(
            model_name="all-MiniLM-L6-v2",
        )


# ---------------------------------------------------------------------------
# MeetingRAG
# ---------------------------------------------------------------------------


class MeetingRAG:
    """Thin wrapper around a ChromaDB collection for meeting content."""

    def __init__(self, persist_dir: Path = RAG_DIR):
        import chromadb
        persist_dir.mkdir(parents=True, exist_ok=True)
        self.client = chromadb.PersistentClient(path=str(persist_dir))
        self._ef = _make_embedding_fn()
        self.collection = self.client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=self._ef,
            metadata={"hnsw:space": "cosine"},
        )

    # ── Write ──────────────────────────────────────────────────────────────

    def upsert(self, chunks: list[dict]) -> None:
        """
        Upsert a list of chunk dicts.
        Each dict must have: id, text, and all metadata fields.
        """
        if not chunks:
            return
        self.collection.upsert(
            ids=[c["id"] for c in chunks],
            documents=[c["text"] for c in chunks],
            metadatas=[_clean_meta(c["meta"]) for c in chunks],
        )

    def count(self) -> int:
        return self.collection.count()

    def reset(self) -> None:
        """Drop and recreate the collection."""
        self.client.delete_collection(COLLECTION_NAME)
        self.collection = self.client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=self._ef,
            metadata={"hnsw:space": "cosine"},
        )

    # ── Read ───────────────────────────────────────────────────────────────

    def search(
        self,
        query: str,
        n_results: int = 12,
        where: dict | None = None,
    ) -> list[dict]:
        """
        Semantic search. Returns list of dicts with keys:
          text, meta, distance (lower = more similar for cosine).
        """
        kwargs: dict[str, Any] = {
            "query_texts": [query],
            "n_results": min(n_results, self.collection.count() or 1),
            "include": ["documents", "metadatas", "distances"],
        }
        if where:
            kwargs["where"] = where

        results = self.collection.query(**kwargs)
        out = []
        docs = results["documents"][0]
        metas = results["metadatas"][0]
        dists = results["distances"][0]
        for doc, meta, dist in zip(docs, metas, dists):
            out.append({"text": doc, "meta": meta, "distance": dist})
        return out

    def format_context(self, results: list[dict], max_chars: int = 12_000) -> str:
        """
        Format search results into a structured context block for the LLM.
        """
        parts = []
        total = 0
        for i, r in enumerate(results, 1):
            m = r["meta"]
            header_parts = [
                f"[SOURCE {i}]",
                m.get("committee", ""),
                m.get("date", ""),
                f"({m.get('source_type', '')})",
            ]
            header = "  ".join(p for p in header_parts if p)
            lines = [header]

            if m.get("meeting_title"):
                lines.append(f"Meeting: {m['meeting_title']}")
            if m.get("document_title"):
                lines.append(f"Document: {m['document_title']}")
            if m.get("speakers"):
                lines.append(f"Speakers: {m['speakers']}")
            if m.get("start_time", -1) >= 0:
                lines.append(
                    f"Timestamp: [{m['start_time']:.1f}–{m['end_time']:.1f}]"
                )
            lines.append("")
            lines.append(r["text"])

            block = "\n".join(lines)
            if total + len(block) > max_chars:
                break
            parts.append(block)
            total += len(block)

        return "\n\n---\n\n".join(parts)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _clean_meta(meta: dict) -> dict:
    """
    ChromaDB metadata values must be str | int | float | bool.
    Convert anything else to str.
    """
    out = {}
    for k, v in meta.items():
        if isinstance(v, (str, int, float, bool)):
            out[k] = v
        elif v is None:
            out[k] = ""
        else:
            out[k] = str(v)
    return out


# ---------------------------------------------------------------------------
# Singleton for use in main.py
# ---------------------------------------------------------------------------

_rag_instance: MeetingRAG | None = None


def get_rag() -> MeetingRAG:
    global _rag_instance
    if _rag_instance is None:
        _rag_instance = MeetingRAG()
    return _rag_instance
