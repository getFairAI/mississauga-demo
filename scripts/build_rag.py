"""
scripts/build_rag.py
--------------------
Builds (or rebuilds) the ChromaDB RAG index from all meeting content:

  • Transcripts  – ./transcriptions/<name>_named.txt (preferred) or .txt
                   Speaker labels resolved via <name>_speakers.json
  • PDFs         – agenda / minutes / attachments listed in data/raw/pdf_manifest.json
                   Meeting metadata joined from data/raw/council_index.json

Run from the project root:
    python scripts/build_rag.py
    python scripts/build_rag.py --reset    # drop and rebuild from scratch

Progress is printed per source file. Idempotent — existing chunks are
upserted (overwritten) so re-running is safe without --reset.
"""

import argparse
import json
import re
import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Project root (one level up from scripts/)
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from rag import MeetingRAG, RAG_DIR  # noqa: E402

TRANSCRIPTIONS = ROOT / "transcriptions"
PDF_MANIFEST = ROOT / "data" / "raw" / "pdf_manifest.json"
COUNCIL_INDEX = ROOT / "data" / "raw" / "council_index.json"

# Transcript chunking
MAX_LINES_PER_CHUNK = 15   # speaker-turn lines per chunk
MAX_WORDS_PER_CHUNK = 300  # hard cap — split long turns

# PDF chunking
MAX_WORDS_PDF_CHUNK = 350

# Line format: [start–end] Speaker: text
_LINE_RE = re.compile(
    r"^\[(?P<start>[\d.]+)\s*[–\-]\s*(?P<end>[\d.]+)\]\s*(?P<speaker>[^:]+):\s*(?P<text>.*)$"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _slug(text: str) -> str:
    text = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"\s+", "_", text).strip("_")[:60]


def _words(text: str) -> int:
    return len(text.split())


def _chunk_text(text: str, max_words: int = MAX_WORDS_PDF_CHUNK) -> list[str]:
    """Split plain text into chunks at paragraph boundaries."""
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    chunks, buf, buf_words = [], [], 0
    for para in paragraphs:
        pw = _words(para)
        if buf and buf_words + pw > max_words:
            chunks.append("\n\n".join(buf))
            buf, buf_words = [], 0
        buf.append(para)
        buf_words += pw
    if buf:
        chunks.append("\n\n".join(buf))
    return chunks or [text[:2000]]


def extract_pdf_text(pdf_path: Path, max_chars: int = 40_000) -> str:
    try:
        import pdfplumber
        with pdfplumber.open(pdf_path) as pdf:
            pages = [p.extract_text() or "" for p in pdf.pages]
        return "\n\n".join(pages)[:max_chars]
    except ImportError:
        pass
    try:
        from pypdf import PdfReader  # type: ignore[import-untyped]
        reader = PdfReader(str(pdf_path))
        return "\n\n".join(p.extract_text() or "" for p in reader.pages)[:max_chars]
    except ImportError:
        pass
    return ""


# ---------------------------------------------------------------------------
# Meeting lookup from council_index.json
# ---------------------------------------------------------------------------


def _load_meeting_index() -> dict[str, dict]:
    """Return {meeting_id: meeting_dict} from council_index.json."""
    if not COUNCIL_INDEX.exists():
        return {}
    data = json.loads(COUNCIL_INDEX.read_text())
    return {m["id"]: m for m in data.get("meetings", []) if m.get("id")}


def _find_meeting_for_mp4(mp4_name: str, meetings: dict[str, dict]) -> dict | None:
    """Find the meeting that has this MP4 filename in its mp4_files list."""
    for m in meetings.values():
        for mp4 in m.get("mp4_files", []):
            if Path(mp4).name == mp4_name:
                return m
    return None


# ---------------------------------------------------------------------------
# Transcript indexing
# ---------------------------------------------------------------------------


def _load_speaker_mapping(transcript_stem: str) -> dict[str, str]:
    """Load <stem>_speakers.json if it exists."""
    p = TRANSCRIPTIONS / f"{transcript_stem}_speakers.json"
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            pass
    return {}


def _apply_speakers(text: str, mapping: dict[str, str]) -> str:
    if not mapping:
        return text
    pattern = re.compile(r"SPEAKER_\d+")
    return pattern.sub(lambda m: mapping.get(m.group(0), m.group(0)), text)


def _parse_transcript_lines(text: str) -> list[dict]:
    """Parse each line into {start, end, speaker, text}."""
    rows = []
    for line in text.splitlines():
        m = _LINE_RE.match(line.strip())
        if m:
            rows.append({
                "start": float(m.group("start")),
                "end": float(m.group("end")),
                "speaker": m.group("speaker").strip(),
                "text": m.group("text").strip(),
                "raw": line.strip(),
            })
    return rows


def _chunk_transcript(rows: list[dict]) -> list[dict]:
    """
    Group rows into chunks of at most MAX_LINES_PER_CHUNK lines
    or MAX_WORDS_PER_CHUNK words, whichever comes first.
    Returns list of {text, start_time, end_time, speakers}.
    """
    chunks = []
    buf_rows: list[dict] = []
    buf_words = 0

    def flush():
        if not buf_rows:
            return
        text = "\n".join(r["raw"] for r in buf_rows)
        speakers = list(dict.fromkeys(r["speaker"] for r in buf_rows))  # ordered unique
        chunks.append({
            "text": text,
            "start_time": buf_rows[0]["start"],
            "end_time": buf_rows[-1]["end"],
            "speakers": ", ".join(speakers),
        })

    for row in rows:
        row_words = _words(row["text"])
        if buf_rows and (len(buf_rows) >= MAX_LINES_PER_CHUNK or
                         buf_words + row_words > MAX_WORDS_PER_CHUNK):
            flush()
            buf_rows, buf_words = [], 0
        buf_rows.append(row)
        buf_words += row_words

    flush()
    return chunks


def index_transcripts(rag: MeetingRAG, meetings: dict[str, dict]) -> int:
    total = 0
    txt_files = sorted(TRANSCRIPTIONS.glob("*.txt"))

    # For each job, prefer _named.txt over plain .txt; skip _speakers.json sidecar
    stems_seen: set[str] = set()
    candidates: dict[str, Path] = {}
    for f in txt_files:
        stem = f.stem
        if stem.endswith("_named"):
            base = stem[:-6]
            candidates[base] = f         # prefer _named
        elif not stem.endswith("_summary") and "_part" not in stem:
            if stem not in candidates:
                candidates[stem] = f

    for stem, path in sorted(candidates.items()):
        mp4_name = f"{stem}.mp4"
        meeting = _find_meeting_for_mp4(mp4_name, meetings)

        # Fallback: derive date + committee from the filename when the index
        # lookup fails (e.g. combat_discrimination is unlinked, or the mp4
        # file list in council_index.json doesn't exactly match the stem).
        fallback_date = ""
        fallback_committee = ""
        if not meeting:
            dm = re.search(r"(\d{4})[_-](\d{2})[_-](\d{2})", stem)
            if dm:
                fallback_date = f"{dm.group(1)}-{dm.group(2)}-{dm.group(3)}"
            s = stem.lower()
            if "budget" in s:
                fallback_committee = "Budget Committee"
            elif "road" in s:
                fallback_committee = "Road Safety Committee"
            elif "discrimination" in s:
                fallback_committee = "Anti-Discrimination Committee"

        speaker_map = _load_speaker_mapping(stem)
        # Also try base stem (when using _named file, stem is the base)
        if not speaker_map:
            base = stem[:-6] if stem.endswith("_named") else stem
            speaker_map = _load_speaker_mapping(base)

        raw_text = path.read_text(encoding="utf-8")
        # Apply speaker mapping to the full text before parsing
        resolved_text = _apply_speakers(raw_text, speaker_map)
        rows = _parse_transcript_lines(resolved_text)

        if not rows:
            print(f"  [skip] {path.name} — no parseable lines")
            continue

        chunks = _chunk_transcript(rows)
        base_meta = {
            "source_type": "transcript",
            "committee": meeting["committee"] if meeting else fallback_committee,
            "meeting_id": meeting["id"] if meeting else "",
            "meeting_title": meeting["title"] if meeting else stem,
            "date": meeting["date"] if meeting else fallback_date,
            "file": str(path.relative_to(ROOT)),
            "document_title": stem,
            "start_time": -1.0,
            "end_time": -1.0,
            "speakers": "",
            "chunk_index": 0,
        }

        chunk_docs = []
        for i, chunk in enumerate(chunks):
            meta = {
                **base_meta,
                "start_time": chunk["start_time"],
                "end_time": chunk["end_time"],
                "speakers": chunk["speakers"],
                "chunk_index": i,
            }
            chunk_docs.append({
                "id": f"transcript_{_slug(stem)}_{i:04d}",
                "text": chunk["text"],
                "meta": meta,
            })

        rag.upsert(chunk_docs)
        total += len(chunk_docs)
        committee_label = meeting["committee"] if meeting else fallback_committee
        date_label = meeting["date"] if meeting else fallback_date
        print(f"  transcript  {path.name:<55} {len(chunk_docs):>4} chunks"
              + (f"  [{committee_label}  {date_label}]" if committee_label else "  [no metadata]"))

    return total


# ---------------------------------------------------------------------------
# PDF indexing
# ---------------------------------------------------------------------------


def index_pdfs(rag: MeetingRAG, meetings: dict[str, dict]) -> int:
    if not PDF_MANIFEST.exists():
        print("  [warn] pdf_manifest.json not found — skipping PDF indexing")
        return 0

    manifest = json.loads(PDF_MANIFEST.read_text())
    # Build fast lookup: meeting_id → meeting
    meeting_by_id = meetings  # already keyed by id

    total = 0
    for entry in manifest:
        if entry.get("type") == "attachment":
            continue  # attachments are not indexed — transcripts are the evidence

        pdf_path = ROOT / entry["file"]
        if not pdf_path.exists():
            print(f"  [skip] missing: {entry['file']}")
            continue

        text = extract_pdf_text(pdf_path)
        if not text.strip():
            print(f"  [skip] no text: {pdf_path.name}")
            continue

        meeting_id = entry.get("meeting_id", "")
        meeting = meeting_by_id.get(meeting_id, {})

        base_meta = {
            "source_type": entry.get("type", "attachment"),
            "committee": entry.get("committee", meeting.get("committee", "")),
            "meeting_id": meeting_id,
            "meeting_title": entry.get("meeting_title", meeting.get("title", "")),
            "date": entry.get("date", meeting.get("date", "")),
            "file": entry["file"],
            "document_title": entry.get("document_title", pdf_path.stem),
            "speakers": "",
            "start_time": -1.0,
            "end_time": -1.0,
            "chunk_index": 0,
        }

        text_chunks = _chunk_text(text)
        doc_slug = _slug(entry.get("document_title", pdf_path.stem))
        date_prefix = entry.get("date", "")

        chunk_docs = []
        for i, chunk_text in enumerate(text_chunks):
            meta = {**base_meta, "chunk_index": i}
            chunk_docs.append({
                "id": f"pdf_{date_prefix}_{doc_slug}_{i:04d}",
                "text": chunk_text,
                "meta": meta,
            })

        rag.upsert(chunk_docs)
        total += len(chunk_docs)
        print(f"  {entry.get('type', 'pdf'):<12} {pdf_path.name:<55} {len(chunk_docs):>3} chunks")

    return total


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description="Build the meeting RAG index")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Drop the existing collection and rebuild from scratch",
    )
    parser.add_argument(
        "--transcripts-only",
        action="store_true",
        help="Only index transcripts (skip PDFs)",
    )
    parser.add_argument(
        "--pdfs-only",
        action="store_true",
        help="Only index PDFs (skip transcripts)",
    )
    args = parser.parse_args()

    rag = MeetingRAG(RAG_DIR)

    if args.reset:
        print("Resetting collection...")
        rag.reset()

    print(f"RAG directory: {RAG_DIR}")
    print(f"Chunks before: {rag.count()}")
    print()

    meetings = _load_meeting_index()
    print(f"Meetings loaded from index: {len(meetings)}")
    print()

    transcript_chunks = 0
    pdf_chunks = 0

    if not args.pdfs_only:
        print("── Transcripts ──────────────────────────────────────────────")
        transcript_chunks = index_transcripts(rag, meetings)
        print()

    if not args.transcripts_only:
        print("── PDFs (agenda / minutes / attachments) ────────────────────")
        pdf_chunks = index_pdfs(rag, meetings)
        print()

    total = rag.count()
    print("─" * 60)
    print(f"Transcript chunks indexed : {transcript_chunks}")
    print(f"PDF chunks indexed        : {pdf_chunks}")
    print(f"Total chunks in index     : {total}")
    print(f"Index path                : {RAG_DIR}")


if __name__ == "__main__":
    main()
