"""
rag.py
------
Core RAG module for Mississauga civic meeting content.

Wraps ChromaDB with OpenAI text-embedding-3-small embeddings.

Retrieval strategy
------------------
  Transcripts are the primary evidence — search_transcripts() does semantic
  search restricted to source_type="transcript".
  Agenda/minutes are supporting context — get_meeting_documents() fetches
  them by meeting_id after the transcript search, not by semantic ranking.
  Attachments are never indexed.

Collections
-----------
  meetings  –  transcript chunks + agenda/minutes chunks, with rich metadata.

Metadata schema (every chunk has all fields)
----------------------------------------------
  source_type    : "transcript" | "agenda" | "minutes"
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
    """Return a ChromaDB-compatible embedding function (always OpenAI)."""
    from chromadb.utils.embedding_functions import OpenAIEmbeddingFunction
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set — required for RAG embeddings.")
    return OpenAIEmbeddingFunction(
        api_key=api_key,
        model_name="text-embedding-3-small",
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
        Semantic search across all indexed content.
        Returns list of dicts: text, meta, distance.
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
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            out.append({"text": doc, "meta": meta, "distance": dist})
        return out

    def search_transcripts(
        self,
        query: str,
        n_results: int = 12,
        where: dict | None = None,
    ) -> list[dict]:
        """
        Primary retrieval — semantic search restricted to transcript chunks only.
        Transcripts are the ground-truth evidence; agenda/minutes are supporting.
        Additional `where` filters are ANDed with the transcript filter.
        """
        transcript_filter: dict = {"source_type": "transcript"}
        combined = (
            {"$and": [transcript_filter, where]} if where else transcript_filter
        )
        return self.search(query, n_results, where=combined)

    def get_meeting_documents(self, meeting_ids: list[str]) -> list[dict]:
        """
        Fetch all agenda + minutes chunks for the given meeting IDs by metadata
        filter (no semantic ranking). Used as supporting context alongside
        transcript evidence — not as primary search results.
        """
        ids = [mid for mid in meeting_ids if mid]
        if not ids:
            return []
        try:
            raw = self.collection.get(
                where={
                    "$and": [
                        {"source_type": {"$in": ["agenda", "minutes"]}},
                        {"meeting_id": {"$in": ids}},
                    ]
                },
                include=["documents", "metadatas"],
            )
        except Exception:
            return []
        return [
            {"text": doc, "meta": meta}
            for doc, meta in zip(raw["documents"], raw["metadatas"])
        ]

    def format_context(
        self,
        transcript_results: list[dict],
        doc_results: list[dict] | None = None,
        max_chars: int = 12_000,
    ) -> str:
        """
        Build the LLM context block.

        Transcripts are labelled [SOURCE N] and are the primary evidence.
        Agenda/minutes are appended as a separate MEETING DOCUMENTS section
        labelled [DOC N] — the LLM is told these are supporting context only.
        """
        parts: list[str] = []
        total = 0

        # ── Primary: transcript evidence ───────────────────────────────────
        for i, r in enumerate(transcript_results, 1):
            m = r["meta"]
            header = "  ".join(p for p in [
                f"[SOURCE {i}]",
                m.get("committee", ""),
                m.get("date", ""),
                "(transcript)",
            ] if p)
            lines = [header]
            if m.get("meeting_title"):
                lines.append(f"Meeting: {m['meeting_title']}")
            if m.get("speakers"):
                lines.append(f"Speakers: {m['speakers']}")
            if m.get("start_time", -1) >= 0:
                lines.append(f"Timestamp: [{m['start_time']:.1f}–{m['end_time']:.1f}s]")
            lines += ["", r["text"]]
            block = "\n".join(lines)
            if total + len(block) > max_chars:
                break
            parts.append(block)
            total += len(block)

        # ── Supporting: agenda / minutes ───────────────────────────────────
        if doc_results:
            doc_parts: list[str] = []
            budget = max(0, max_chars - total - 200)
            used = 0
            for j, r in enumerate(doc_results, 1):
                m = r["meta"]
                header = "  ".join(p for p in [
                    f"[DOC {j}]",
                    m.get("committee", ""),
                    m.get("date", ""),
                    f"({m.get('source_type', 'document')})",
                ] if p)
                lines = [header]
                if m.get("document_title"):
                    lines.append(f"Document: {m['document_title']}")
                lines += ["", r["text"]]
                block = "\n".join(lines)
                if used + len(block) > budget:
                    break
                doc_parts.append(block)
                used += len(block)

            if doc_parts:
                parts.append(
                    "MEETING DOCUMENTS (agenda/minutes — supporting context, not primary evidence)\n\n"
                    + "\n\n---\n\n".join(doc_parts)
                )

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
