"""Simple FastAPI server with room-based WebSocket broadcasting.

Run with:
    uvicorn main:app --reload --port 8000
"""

import os
import asyncio
import json
import uuid
import re
import random
import math
import tempfile
import shutil
from pathlib import Path
from typing import Any, Callable, Dict, List, Set, AsyncGenerator

from fastapi import (
    BackgroundTasks,
    File,
    Form,
    FastAPI,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI, OpenAI
from pydantic import BaseModel
from dotenv import load_dotenv
import openai
from ai_utils import ai_call
from typing import Optional
import textwrap

load_dotenv()


class RoomNotFound(Exception):
    """Raised when operations target a non-existent room."""


class RoomManager:
    """In-memory room registry and WebSocket broadcaster."""

    def __init__(self) -> None:
        self.rooms: Dict[str, Set[WebSocket]] = {}
        self.lock = asyncio.Lock()

    async def create_room(self) -> str:
        room_id = uuid.uuid4().hex
        async with self.lock:
            self.rooms[room_id] = set()
        return room_id

    async def list_rooms(self) -> List[str]:
        async with self.lock:
            return list(self.rooms.keys())

    async def ensure_room(self, room_id: str) -> None:
        async with self.lock:
            self.rooms.setdefault(room_id, set())

    async def connect(self, room_id: str, websocket: WebSocket) -> None:
        async with self.lock:
            if room_id not in self.rooms:
                raise RoomNotFound
            self.rooms[room_id].add(websocket)

    async def disconnect(self, room_id: str, websocket: WebSocket) -> None:
        async with self.lock:
            room = self.rooms.get(room_id)
            if room is None:
                return
            room.discard(websocket)
            if not room:
                self.rooms.pop(room_id, None)

    async def broadcast(self, room_id: str, message: str, sender: WebSocket | None = None) -> int:
        async with self.lock:
            room = self.rooms.get(room_id)
            if room is None:
                raise RoomNotFound
            targets = list(room)

        delivered = 0
        stale: list[WebSocket] = []
        for socket in targets:
            if sender is not None and socket is sender:
                continue
            try:
                await socket.send_text(message)
                delivered += 1
            except Exception:
                stale.append(socket)

        if stale:
            async with self.lock:
                room = self.rooms.get(room_id)
                if room is not None:
                    for socket in stale:
                        room.discard(socket)
                    if not room:
                        self.rooms.pop(room_id, None)
        return delivered


class RoomResponse(BaseModel):
    id: str


class RoomsResponse(BaseModel):
    rooms: List[str]


class BroadcastRequest(BaseModel):
    message: str


class TranscriptLine(BaseModel):
    index: int
    start: float
    end: float
    speaker: str
    text: str


class TranscriptResponse(BaseModel):
    id: str
    title: str
    total_lines: int
    duration: float | None
    lines: List[TranscriptLine]


class AnalyzeTranscriptRequest(BaseModel):
    transcript_id: str | None = None
    transcript_text: str | None = None
    include_quotes: bool = True


class SummarizeTranscriptRequest(BaseModel):
    transcript_id: str | None = None
    transcript_text: str | None = None
    save_summary: bool = False


class ArgumentMapRequest(BaseModel):
    transcript_id: str | None = None
    transcript_text: str | None = None


app = FastAPI(title="WebSocket Room Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

manager = RoomManager()
sync_client = OpenAI()
async_client = AsyncOpenAI()
TRANSCRIPTS_DIR = Path("./transcriptions")
SUPPORTED_AUDIO_FORMATS = {"mp3", "wav"}
SUPPORTED_MEDIA_EXTS = (".mp3", ".wav", ".m4a", ".mp4", ".mov")
TIME_RANGE_RE = re.compile(
    r"\[(?P<start>\d+(?:\.\d+)?)\s*[–-]\s*(?P<end>\d+(?:\.\d+)?)\]\s*(?P<speaker>[^:]+):\s*(?P<text>.*)$"
)
ACTIONABLE_SYSTEM_PROMPT = """
You are a meticulous meeting analyst working on a SINGLE CHUNK of a larger transcript.

Output strictly in compact JSON:
{
  "highlights": ["short bullet", ...],
  "actionable_topics": [
    {
      "title": "crisp name of the action topic",
      "action": "what needs to happen next (one sentence)",
      "owner": "who is responsible (person/role) or null if not stated",
      "due": "deadline or timeframe if mentioned, otherwise null",
      "impact": "why this matters (short)",
      "evidence": "direct quote(s) or timestamp reference from the chunk; keep under 30 words"
    }
  ]
}

Rules for highlights:
- Produce at most 3 and at least 0 highlights for this chunk.
- A highlight must be a major decision, conflict, or concrete outcome; ignore mere status updates or chit-chat.
- Be conservative: if unsure it is noteworthy, do NOT include it.

Rules for actionable_topics:
- Produce at most 3 and at least 0 items for this chunk.
- Only include if the chunk states a clear next step or request. If vague or implied, omit it.
- Do NOT speculate owners, dates, or impact; leave them null/empty if not stated.

Cross-chunk guidance:
- You will be told the chunk number and total chunks (e.g., chunk 2/5). Avoid repeating items already likely captured in earlier chunks unless new detail is added.
- Never reference other chunks explicitly; analyze only the provided chunk text.
"""

ARGUMENT_MAP_EXTRACTION_PROMPT = """
You are extracting raw evidence from ONE SECTION of a meeting transcript.
Do NOT build an argument map. Do NOT synthesize or draw conclusions.
Only extract what is explicitly present in this section.

Return ONLY valid JSON matching this schema:
{
  "agenda_items": [{"item": "string", "presenter": "string or null"}],
  "topics": ["short description of topic discussed"],
  "positions": [
    {"speaker": "string", "timestamp": "start-end", "claim": "one-sentence paraphrase", "quote": "exact words from transcript"}
  ],
  "questions": [
    {"text": "string", "raised_by": "speaker name or null", "timestamp": "start-end or null", "answered": false}
  ],
  "decisions": [
    {"text": "string", "timestamp": "start-end or null"}
  ]
}

Rules:
- Quotes must be the speaker's exact words from the transcript.
- Include timestamps in start-end format wherever available.
- If nothing was found for a field, use an empty list [].
- Do not invent, infer, or carry in knowledge from outside this section.
"""

ARGUMENT_MAP_SYNTHESIS_PROMPT = """
You are building a structured argument map from evidence extracted across all sections of a meeting transcript.
The input is a JSON array where each element is the extraction from one transcript section.

Your task:
1. Review ALL sections as a complete meeting record.
2. Identify every agenda item (deduplicate across sections).
3. Identify the core questions being debated or decided across the full meeting.
   - Group related positions, claims, and questions from different sections into unified core questions.
   - Do NOT create separate questions for the same underlying issue just because it appeared in different sections.
   - Every named agenda item and presenter should contribute to at least one core question.
4. For each core question:
   - type "open"  → multiple competing options exist → label options O1, O2, O3…
   - type "closed" → yes/no or proceed/reject → label the claim S (support), N (negate), or M (modify)
   - Mark unresolved = true if the meeting ended without a clear answer or decision.
   - Collect the strongest supporting evidence (quotes + timestamps + speakers) from across all sections.
5. Strip procedural chatter, pleasantries, and off-topic content.

Return ONLY valid JSON:
{
  "word_count": {
    "raw": <integer — sum of all section word counts>,
    "critical_words": ["key substantive words or short phrases from across the meeting"],
    "compression_ratio": <float>
  },
  "argument_map": {
    "agenda": [{"item": "string", "presenter": "string or null"}],
    "core_questions": [
      {
        "question": "string",
        "type": "open|closed",
        "unresolved": true,
        "options_or_claims": [{"label": "O1|S|N|M", "claim": "string", "support": ["quote [timestamp]"]}],
        "evidence": [{"speaker": "string", "timestamp": "string", "quote": "string"}]
      }
    ]
  }
}

Use only data from the provided extractions. If a field has no data, use null or [].
"""


def _find_summary_versions(transcript_path: Path) -> list[dict]:
    """Return all summary versions sorted ascending. Legacy _summary.txt is treated as v1."""
    stem = transcript_path.stem
    d = transcript_path.parent
    versions: list[dict] = []
    legacy = d / f"{stem}_summary.txt"
    if legacy.exists():
        versions.append({"version": 1, "file": legacy})
    for p in d.glob(f"{stem}_summary_v*.txt"):
        m = re.search(r"_summary_v(\d+)\.txt$", p.name)
        if m:
            versions.append({"version": int(m.group(1)), "file": p})
    return sorted(versions, key=lambda x: x["version"])


def _next_summary_version(transcript_path: Path) -> int:
    vs = _find_summary_versions(transcript_path)
    return max((v["version"] for v in vs), default=0) + 1


def _find_argument_map_versions(transcript_path: Path) -> list[dict]:
    """Return all argument map versions sorted ascending. Legacy _argument_map.json is treated as v1."""
    stem = transcript_path.stem
    d = transcript_path.parent
    versions: list[dict] = []
    legacy = d / f"{stem}_argument_map.json"
    if legacy.exists():
        versions.append({"version": 1, "file": legacy})
    for p in d.glob(f"{stem}_argument_map_v*.json"):
        m = re.search(r"_argument_map_v(\d+)\.json$", p.name)
        if m:
            versions.append({"version": int(m.group(1)), "file": p})
    return sorted(versions, key=lambda x: x["version"])


def _next_argument_map_version(transcript_path: Path) -> int:
    vs = _find_argument_map_versions(transcript_path)
    return max((v["version"] for v in vs), default=0) + 1


def _resolve_transcript_path(transcript_id: str) -> Path:
    """Return the path for a given transcript id or raise 404."""
    candidate = TRANSCRIPTS_DIR / transcript_id
    if candidate.suffix != ".txt":
        candidate_with_ext = TRANSCRIPTS_DIR / f"{transcript_id}.txt"
        if candidate_with_ext.exists():
            return candidate_with_ext
    if candidate.exists():
        return candidate
    raise HTTPException(status_code=404, detail="Transcript not found.")


def parse_transcript_file(path: Path) -> List[TranscriptLine]:
    """Parse a transcript file into structured lines."""
    if not path.exists():
        raise HTTPException(status_code=404, detail="Transcript file missing.")

    raw_lines = path.read_text(encoding="utf-8").splitlines()
    parsed: List[TranscriptLine] = []

    for idx, raw in enumerate(raw_lines):
        line = raw.strip()
        if not line:
            continue
        match = TIME_RANGE_RE.match(line)
        if not match:
            raise HTTPException(
                status_code=422,
                detail=f"Line {idx + 1} is not in the expected '[start–end] Speaker: text' format.",
            )
        start = float(match.group("start"))
        end = float(match.group("end"))
        speaker = match.group("speaker").strip()
        text = match.group("text").strip()
        parsed.append(
            TranscriptLine(
                index=len(parsed),
                start=start,
                end=end,
                speaker=speaker,
                text=text,
            )
        )
        
    
    if path.stem.startswith("budget_"):
        topic = "Budget Comittee"
    elif path.stem.startswith("combat_"):
        topic = "Combating Racis, Discrimination and Hatred Advisory Com"
    elif path.stem.startswith("road_safety"):
        topic = "Road Safety Comittee"
    else:
        topic = "General"
        
    return parsed, topic


def _chunk_lines(lines: List[TranscriptLine], page_size: int) -> List[List[TranscriptLine]]:
    """Split transcript lines into evenly sized pages."""
    if page_size <= 0:
        raise HTTPException(status_code=400, detail="page_size must be greater than zero.")
    return [lines[i : i + page_size] for i in range(0, len(lines), page_size)] or [[]]


def _normalize_actionable_payload(payload: dict) -> dict:
    """Ensure predictable shapes for highlights/actionables coming from the model."""
    highlights = payload.get("highlights") or []
    if not isinstance(highlights, list):
        highlights = [str(highlights)]

    actionables = payload.get("actionable_topics") or []
    if not isinstance(actionables, list):
        actionables = [actionables]

    normalized = []
    for item in actionables:
        if not isinstance(item, dict):
            item = {"title": str(item)}
        normalized.append(
            {
                "title": item.get("title") or item.get("topic") or "",
                "action": item.get("action") or item.get("next_step") or "",
                "owner": item.get("owner") or item.get("responsible") or None,
                "due": item.get("due") or item.get("deadline") or None,
                "impact": item.get("impact") or item.get("why") or item.get("reason") or "",
                "evidence": item.get("evidence") or item.get("quote") or "",
            }
        )

    return {"highlights": [str(h).strip() for h in highlights if str(h).strip()], "actionable_topics": normalized}


def _extract_json(raw: str) -> dict:
    """Robustly parse JSON from LLM output that may be wrapped in markdown fences or prose."""
    # Strip markdown code fences (```json ... ``` or ``` ... ```)
    stripped = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.IGNORECASE)
    stripped = re.sub(r"\s*```$", "", stripped.strip())
    stripped = stripped.strip()

    # Try direct parse first
    try:
        return json.loads(stripped)
    except Exception:
        pass

    # Find first { ... } or [ ... ] block
    for start_char, end_char in [('{', '}'), ('[', ']')]:
        start = stripped.find(start_char)
        if start == -1:
            continue
        depth = 0
        for i, ch in enumerate(stripped[start:], start=start):
            if ch == start_char:
                depth += 1
            elif ch == end_char:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(stripped[start:i + 1])
                    except Exception:
                        break

    raise ValueError(f"No valid JSON found in LLM output: {raw[:200]!r}")


def _chunk_transcript_text(transcript_text: str, max_chars: int = 12000) -> List[str]:
    """Split a transcript into reasonably sized chunks without dropping content."""
    lines = [line for line in transcript_text.splitlines() if line.strip()]
    if not lines:
        return []

    chunks: list[list[str]] = []
    current: list[str] = []
    current_len = 0

    for line in lines:
        line_len = len(line) + 1  # include newline spacing
        if current and current_len + line_len > max_chars:
            chunks.append(current)
            current = [line]
            current_len = line_len
        else:
            current.append(line)
            current_len += line_len

    if current:
        chunks.append(current)

    return ["\n".join(chunk).strip() for chunk in chunks]


def _dedupe_actionables(items: List[dict]) -> List[dict]:
    """Deduplicate actionable topics by their main descriptive fields."""
    seen: set[tuple] = set()
    unique: list[dict] = []
    for item in items:
        key = (
            (item.get("title") or "").strip().lower(),
            (item.get("action") or "").strip().lower(),
            (item.get("owner") or "").strip().lower(),
            (item.get("due") or "").strip().lower(),
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


async def analyze_transcript_job(
    transcript_text: str,
    include_quotes: bool,
    room_id: str,
    transcript_id: str | None = None,
    chunk_char_limit: int = 12000,
) -> None:
    """Process a transcript in chunks and stream progress/results over websockets."""

    await manager.ensure_room(room_id)

    async def _broadcast(stage: str, detail: dict | None = None) -> None:
        payload: dict[str, Any] = {"job": "analyze_transcript", "stage": stage, "room_id": room_id}
        if transcript_id:
            payload["transcript_id"] = transcript_id
        if detail:
            payload.update(detail)
        await broadcast_json(room_id, payload)

    try:
        await _broadcast("queued")
        await _broadcast("running")

        chunks = _chunk_transcript_text(transcript_text, max_chars=chunk_char_limit)
        total_chunks = max(1, len(chunks))
        await _broadcast("chunking", {"total_chunks": total_chunks})

        all_highlights: list[str] = []
        all_actionables: list[dict] = []

        for idx, chunk in enumerate(chunks or [transcript_text], start=1):
            chunk_result = await asyncio.to_thread(
                generate_actionable_topics,
                chunk,
                include_quotes,
                idx,
                total_chunks,
            )
            all_highlights.extend(chunk_result.get("highlights", []))
            all_actionables.extend(chunk_result.get("actionable_topics", []))

            await _broadcast(
                "chunk_complete",
                {
                    "chunk": idx,
                    "total_chunks": total_chunks,
                    "analysis": chunk_result,
                },
            )

        # Final aggregation without truncation.
        deduped_highlights = list(dict.fromkeys([h.strip() for h in all_highlights if h.strip()]))
        deduped_actionables = _dedupe_actionables(all_actionables)

        final_payload = {
            "transcript_id": transcript_id,
            "highlights": deduped_highlights,
            "actionable_topics": deduped_actionables,
        }

        await _broadcast("finished")
        await _broadcast("result", {"analysis": final_payload})
    except Exception as exc:  # pragma: no cover - fast feedback path
        await _broadcast("error", {"message": str(exc)})
        raise


async def summarize_transcript_job(
    transcript_text: str,
    room_id: str,
    transcript_id: str | None = None,
    chunk_char_limit: int = 12000,
    save_summary: bool = False,
) -> None:
    """Summarize a transcript in chunks and stream progress/results over websockets."""

    await manager.ensure_room(room_id)

    async def _broadcast(stage: str, detail: dict | None = None) -> None:
        payload: dict[str, Any] = {"job": "summarize_transcript", "stage": stage, "room_id": room_id}
        if transcript_id:
            payload["transcript_id"] = transcript_id
        if detail:
            payload.update(detail)
        await broadcast_json(room_id, payload)

    try:
        await _broadcast("queued")
        await _broadcast("running")

        # Lazy import to reuse existing summarizer logic.
        from summarize_call import generate_summary

        chunks = _chunk_transcript_text(transcript_text, max_chars=chunk_char_limit)
        total_chunks = max(1, len(chunks))
        await _broadcast("chunking", {"total_chunks": total_chunks})

        # Collect independent per-chunk summaries, then consolidate.
        chunk_summaries: list[str] = []
        for idx, chunk in enumerate(chunks or [transcript_text], start=1):
            chunk_sum = await asyncio.to_thread(
                generate_summary,
                chunk,
                idx,
                total_chunks,
                None,  # no prior context — each chunk is summarized independently
            )
            chunk_summaries.append(chunk_sum)
            await _broadcast(
                "chunk_complete",
                {
                    "chunk": idx,
                    "total_chunks": total_chunks,
                    "summary": chunk_sum,
                    "transcript_id": transcript_id,
                },
            )

        if len(chunk_summaries) > 1:
            from summarize_call import consolidate_summaries
            final_summary = (await asyncio.to_thread(consolidate_summaries, chunk_summaries)).strip()
        else:
            final_summary = (chunk_summaries[0] if chunk_summaries else "").strip()
        response: dict[str, Any] = {
            "transcript_id": transcript_id,
            "summary": final_summary,
        }

        if save_summary and transcript_id:
            transcript_path = _resolve_transcript_path(transcript_id)
            next_v = _next_summary_version(transcript_path)
            target_path = transcript_path.with_name(f"{transcript_path.stem}_summary_v{next_v}.txt")
            await asyncio.to_thread(target_path.write_text, final_summary, "utf-8")
            response["summary_file"] = target_path.name

        await _broadcast("finished")
        await _broadcast("result", {"summary": response})
    except Exception as exc:  # pragma: no cover - fast feedback path
        await _broadcast("error", {"message": str(exc)})
        raise


async def argument_map_job(
    transcript_text: str,
    room_id: str,
    transcript_id: str | None = None,
    save_path: Path | None = None,
    chunk_char_limit: int = 10000,
) -> None:
    """Generate an argument map and stream progress/results."""
    await manager.ensure_room(room_id)

    async def _broadcast(stage: str, detail: dict | None = None) -> None:
        payload: dict[str, Any] = {"job": "argument_map", "stage": stage, "room_id": room_id}
        if transcript_id:
            payload["transcript_id"] = transcript_id
        if detail:
            payload.update(detail)
        await broadcast_json(room_id, payload)

    try:
        await _broadcast("queued")
        await _broadcast("running")

        chunks = _chunk_transcript_text(transcript_text, max_chars=chunk_char_limit) or [transcript_text]
        total_chunks = len(chunks)
        await _broadcast("chunking", {"total_chunks": total_chunks})

        # Phase 1: extract raw evidence from each chunk independently.
        extractions: list[dict] = []
        for idx, chunk in enumerate(chunks, start=1):
            extraction = await asyncio.to_thread(extract_argument_evidence_chunk, chunk, idx, total_chunks)
            extractions.append(extraction)
            await _broadcast("chunk_complete", {"chunk": idx, "total_chunks": total_chunks, "phase": "extraction"})

        # Phase 2: synthesize the full argument map from all extractions.
        await _broadcast("synthesizing", {"phase": "synthesis", "total_chunks": total_chunks})
        full_word_count = len(transcript_text.split())
        result = await asyncio.to_thread(synthesize_argument_map, extractions, full_word_count)

        if save_path is not None:
            # Persist pretty JSON for downstream consumption.
            await asyncio.to_thread(save_path.write_text, json.dumps(result, indent=2), "utf-8")

        await _broadcast("finished")
        await _broadcast(
            "result",
            {
                "argument_map": result,
                "argument_map_file": save_path.name if save_path else None,
            },
        )
    except Exception as exc:  # pragma: no cover - fast feedback path
        await _broadcast("error", {"message": str(exc)})
        raise


def generate_actionable_topics(
    transcript_text: str,
    include_quotes: bool = True,
    chunk_index: int | None = None,
    total_chunks: int | None = None,
) -> dict:
    """Use the LLM to extract highlights and actionable topics from a transcript or chunk."""
    transcript_text = transcript_text.strip()
    if not transcript_text:
        return {"highlights": [], "actionable_topics": []}

    chunk_note = (
        f"Chunk info: index={chunk_index}, total={total_chunks}."
        if chunk_index is not None and total_chunks is not None
        else "Chunk info: single chunk or unknown position."
    )

    raw = ai_call(
        messages=[
            {"role": "system", "content": ACTIONABLE_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"{chunk_note}\nTranscript:\n{transcript_text}\n\n"
                    "Only include an 'evidence' quote if include_quotes is true.\n"
                    f"include_quotes={include_quotes}"
                ),
            },
        ],
        temperature=0.2,
        json_mode=True,
    )
    try:
        payload = _extract_json(raw)
    except Exception:
        payload = {"highlights": [textwrap.shorten(transcript_text, width=180, placeholder="…")], "actionable_topics": []}

    return _normalize_actionable_payload(payload)


def extract_argument_evidence_chunk(transcript_text: str, chunk_index: int, total_chunks: int) -> dict:
    """Phase 1: extract raw evidence (topics, positions, questions) from one chunk.

    Deliberately does NOT attempt to build an argument map — only collects facts
    so that the synthesis step has a complete cross-chunk picture.
    """
    transcript_text = (transcript_text or "").strip()
    if not transcript_text:
        return {"agenda_items": [], "topics": [], "positions": [], "questions": [], "decisions": []}

    raw = ai_call(
        messages=[
            {"role": "system", "content": ARGUMENT_MAP_EXTRACTION_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Section {chunk_index} of {total_chunks}.\n\n"
                    f"Transcript section:\n{transcript_text}"
                ),
            },
        ],
        temperature=0.1,
        json_mode=True,
    )
    try:
        return _extract_json(raw)
    except Exception:
        return {"agenda_items": [], "topics": [], "positions": [], "questions": [], "decisions": []}


def synthesize_argument_map(extractions: list[dict], full_word_count: int) -> dict:
    """Phase 2: synthesize a full argument map from all per-chunk extractions.

    Receives the complete evidence picture and produces the final structured map.
    """
    if not extractions:
        return {"word_count": {"raw": full_word_count}, "argument_map": {"agenda": [], "core_questions": []}}

    raw = ai_call(
        messages=[
            {"role": "system", "content": ARGUMENT_MAP_SYNTHESIS_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Total transcript word count: {full_word_count}\n\n"
                    f"Per-section extractions ({len(extractions)} sections):\n"
                    f"{json.dumps(extractions, indent=2)}"
                ),
            },
        ],
        temperature=0.2,
        json_mode=True,
    )
    try:
        return _extract_json(raw)
    except Exception:
        return {"word_count": {"raw": full_word_count}, "argument_map": {"agenda": [], "core_questions": []}}


async def broadcast_json(room_id: str, payload: dict, sender: WebSocket | None = None) -> int:
    await manager.ensure_room(room_id)
    return await manager.broadcast(room_id, json.dumps(payload), sender=sender)


def make_progress_emitter(loop: asyncio.AbstractEventLoop, room_id: str, job_name: str) -> Callable[[str, Any | None], None]:
    """Create a thread-safe emitter that forwards progress stages to the room."""

    def emit(stage: str, detail: Any | None = None) -> None:
        payload = {"job": job_name, "stage": stage}
        if detail is not None:
            payload["detail"] = detail
        fut = asyncio.run_coroutine_threadsafe(broadcast_json(room_id, payload), loop)
        try:
            fut.result()
        except Exception:
            # Do not block the worker if the broadcast fails.
            pass

    return emit


async def run_transcription(job_name: str, room_id: str, work: Callable[[Callable[[str, Any | None], None]], str]) -> str:
    loop = asyncio.get_running_loop()
    emit = make_progress_emitter(loop, room_id, job_name)

    await broadcast_json(room_id, {"job": job_name, "stage": "queued"})
    try:
        await broadcast_json(room_id, {"job": job_name, "stage": "running"})
        transcript = await asyncio.to_thread(work, emit)
        await broadcast_json(room_id, {"job": job_name, "stage": "finished"})
        await broadcast_json(room_id, {"job": job_name, "stage": "result", "transcript": transcript})
        return transcript
    except Exception as exc:  # pragma: no cover - fast feedback path
        await broadcast_json(room_id, {"job": job_name, "stage": "error", "message": str(exc)})
        raise


def openai_transcribe(audio_path: Path, emit: Callable[[str, str | None], None]) -> str:
    """Transcribe via OpenAI Whisper-1, or WhisperX if no OPENAI_API_KEY is set."""
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    if not os.getenv("OPENAI_API_KEY"):
        device = os.getenv("WHISPERX_DEVICE", "cuda")
        return whisperx_traanscribe(audio_path, emit, device=device)

    emit("reading_file")
    with audio_path.open("rb") as audio_file:
        emit("uploading")
        response = sync_client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            response_format="text",
        )
    emit("done")
    return str(response)


async def openai_stream_transcribe(
    audio_path: Path,
    room_id: str,
    audio_bytes: bytes | None = None,
    content_type: str | None = None,
) -> str:
    """
    Stream transcription deltas from gpt-4o-mini-transcribe and broadcast them.

    audio_bytes: if provided, use in-memory bytes; otherwise read from audio_path on disk.
    """
    if audio_bytes is None:
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")
        audio_bytes = await asyncio.to_thread(audio_path.read_bytes)

    await broadcast_json(room_id, {"job": "openai_transcribe", "stage": "queued"})
    await broadcast_json(room_id, {"job": "openai_transcribe", "stage": "running"})

    transcript_parts: list[str] = []
    try:
        stream = await async_client.audio.transcriptions.create(
            model="gpt-4o-mini-transcribe",
            file=(
                audio_path.name or "audio.wav",
                audio_bytes,
                content_type or "audio/wav",
            ),
            response_format="json",
            stream=True,
        )

        async for event in stream:
            # Streaming events for audio.transcriptions are simple text deltas.
            delta = getattr(event, "text", None) or getattr(event, "delta", None)
            if delta:
                transcript_parts.append(delta)
                await broadcast_json(
                    room_id,
                    {"job": "openai_transcribe", "stage": "delta", "delta": delta},
                )
        transcript = "".join(transcript_parts).strip()
        await broadcast_json(room_id, {"job": "openai_transcribe", "stage": "finished"})
        await broadcast_json(
            room_id,
            {"job": "openai_transcribe", "stage": "result", "transcript": transcript},
        )
        return transcript
    except Exception as exc:
        await broadcast_json(
            room_id,
            {"job": "openai_transcribe", "stage": "error", "message": str(exc)},
        )
        raise


async def openai_diarize_transcribe(
    audio_path: Path,
    room_id: str,
    audio_bytes: bytes | None = None,
    content_type: str | None = None,
) -> dict:
    """Non-streaming transcription with speaker diarization."""
    if audio_bytes is None:
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")
        audio_bytes = await asyncio.to_thread(audio_path.read_bytes)

    await broadcast_json(room_id, {"job": "openai_transcribe", "stage": "queued"})
    await broadcast_json(room_id, {"job": "openai_transcribe", "stage": "running"})

    try:
        response = await async_client.audio.transcriptions.create(
            model="gpt-4o-transcribe-diarize",
            file=(
                audio_path.name or "audio.wav",
                audio_bytes,
                content_type or "audio/wav",
            ),
            response_format="diarized_json",
        )

        # Convert the SDK object into a serializable dict.
        if hasattr(response, "model_dump"):
            response_dict: dict = response.model_dump()
        elif hasattr(response, "to_dict"):
            response_dict = response.to_dict()  # type: ignore[attr-defined]
        else:
            response_dict = dict(response)

        segments = (
            response_dict.get("utterances")
            or response_dict.get("segments")
            or response_dict.get("diarization", {}).get("entries")
        )

        def _format_segment(idx: int, segment: dict) -> str:
            speaker_label = segment.get("speaker", idx + 1)
            text = (segment.get("text") or "").strip()
            return f"Speaker {speaker_label}: {text}" if text else f"Speaker {speaker_label}:"

        if segments:
            formatted = "\n".join(_format_segment(idx, seg) for idx, seg in enumerate(segments)).strip()
        else:
            formatted = (response_dict.get("text") or "").strip()

        await broadcast_json(room_id, {"job": "openai_transcribe", "stage": "finished"})
        await broadcast_json(
            room_id,
            {
                "job": "openai_transcribe",
                "stage": "result",
                "transcript": formatted,
                "segments": segments,
                "raw": response_dict,
            },
        )

        return {"transcript": formatted, "segments": segments, "raw": response_dict}
    except Exception as exc:
        await broadcast_json(
            room_id,
            {"job": "openai_transcribe", "stage": "error", "message": str(exc)},
        )
        raise


def whisperx_traanscribe(audio_path: Path, emit: Callable[[str, Any | None], None], device: str = "cuda") -> str:
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")
    from whisperx_transcribe import transcribe_with_whisperx

    return transcribe_with_whisperx(audio_path, device=device, emit=emit)


async def save_upload_to_temp(upload: UploadFile) -> Path:
    """
    Obtain a filesystem path for an UploadFile with minimal copying.

    - If the underlying SpooledTemporaryFile has a real file path, reuse it.
    - Otherwise, write once to a NamedTemporaryFile.
    """
    file_obj = upload.file
    # If already spooled to disk, we can reuse its path.
    if hasattr(file_obj, "name"):
        try:
            file_obj.flush()
            return Path(file_obj.name)
        except Exception:
            pass

    suffix = Path(upload.filename or "upload").suffix
    import tempfile
    import shutil

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp_path = Path(tmp.name)

    def _copy() -> None:
        with tmp, file_obj as src:
            shutil.copyfileobj(src, tmp)

    await asyncio.to_thread(_copy)
    return tmp_path


def _cleanup_files(paths: List[Path]) -> None:
    """Best-effort deletion of temporary files."""
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            # Keep cleanup non-blocking and tolerant to races.
            pass


def _find_media_for_transcript(transcript_id: str) -> Path:
    """Locate a media file that matches the transcript stem."""
    stem = Path(transcript_id).stem
    candidates: list[Path] = []

    # Search in current working directory and common subfolders.
    search_roots = [Path("."), Path("./data"), Path("./parts"), Path("./chunks")]
    for root in search_roots:
        for ext in SUPPORTED_MEDIA_EXTS:
            candidate = root / f"{stem}{ext}"
            if candidate.exists():
                candidates.append(candidate)
    if candidates:
        # Prefer shortest path / first found.
        return candidates[0]
    raise HTTPException(status_code=404, detail=f"No media file found for transcript '{transcript_id}'.")


@app.post("/rooms", response_model=RoomResponse)
async def create_room() -> RoomResponse:
    room_id = await manager.create_room()
    return RoomResponse(id=room_id)


@app.get("/rooms", response_model=RoomsResponse)
async def list_rooms() -> RoomsResponse:
    rooms = await manager.list_rooms()
    return RoomsResponse(rooms=rooms)


@app.post("/rooms/{room_id}/broadcast")
async def broadcast(room_id: str, payload: BroadcastRequest) -> dict:
    try:
        delivered = await manager.broadcast(room_id, payload.message)
    except RoomNotFound:
        raise HTTPException(status_code=404, detail="Room not found") from None
    return {"delivered_to": delivered}


@app.get("/transcriptions")
async def list_transcriptions() -> dict:
    """Return available transcript files with basic metadata."""
    items = []
    if TRANSCRIPTS_DIR.exists():
        for path in sorted(TRANSCRIPTS_DIR.glob("*.txt")):
            # Skip generated summary files (e.g., foo_summary.txt) to avoid double-counting.
            if re.search(r"_summary(_v\d+)?$", path.stem) or path.stem.find("_part") != -1:
                continue
            lines, topic = parse_transcript_file(path)
            duration = lines[-1].end if lines else None
            argument_map_path = path.with_name(f"{path.stem}_argument_map.json")
            items.append(
                {
                    "id": path.name,
                    "title": path.stem,
                    "topic": topic,
                    "line_count": len(lines),
                    "duration": duration,
                    "argument_map_file": argument_map_path.name if argument_map_path.exists() else None,
                    "has_argument_map": argument_map_path.exists(),
                }
            )
    return {"items": items}


@app.get("/transcriptions/{transcript_id}", response_model=None)
async def get_transcription(
    transcript_id: str,
    stream: bool = False,
    page_size: int = 50,
) -> Any:
    """
    Return a parsed transcript.
\n
    - `stream=false` (default): return the whole file as structured JSON.\n
    - `stream=true`: return newline-delimited JSON pages (good for incremental rendering).\n
    - `page_size`: number of rows per streamed page.
    """
    path = _resolve_transcript_path(transcript_id)
    lines, _ = parse_transcript_file(path)
    duration = lines[-1].end if lines else None
    title = path.stem

    if not stream:
        return TranscriptResponse(
            id=path.name,
            title=title,
            total_lines=len(lines),
            duration=duration,
            lines=lines,
        )

    total_pages = max(1, math.ceil(len(lines) / page_size))

    async def _stream_pages() -> AsyncGenerator[str, None]:
        for page_number, chunk in enumerate(_chunk_lines(lines, page_size), start=1):
            payload = {
                "id": path.name,
                "title": title,
                "page": page_number,
                "total_pages": total_pages,
                "page_size": page_size,
                "total_lines": len(lines),
                "duration": duration,
                "lines": [item.model_dump() for item in chunk],
            }
            yield json.dumps(payload) + "\n"
            await asyncio.sleep(0)

    return StreamingResponse(_stream_pages(), media_type="application/jsonl")


@app.post("/transcriptions/analyze")
async def analyze_transcription(payload: AnalyzeTranscriptRequest) -> dict:
    """Kick off transcript analysis; return room id for streaming progress/results."""
    if not (payload.transcript_id or (payload.transcript_text and payload.transcript_text.strip())):
        raise HTTPException(status_code=400, detail="Provide either transcript_id or transcript_text.")

    transcript_text: str
    chosen_id: str | None = None

    if payload.transcript_id:
        path = _resolve_transcript_path(payload.transcript_id)
        lines, _ = parse_transcript_file(path)
        transcript_text = "\n".join(f"[{line.start:.2f}-{line.end:.2f}] {line.speaker}: {line.text}" for line in lines)
        chosen_id = path.name
    else:
        transcript_text = payload.transcript_text or ""

    if not transcript_text.strip():
        raise HTTPException(status_code=400, detail="Transcript is empty.")

    room_id = await manager.create_room()
    await manager.ensure_room(room_id)

    # Run analysis asynchronously and stream updates via websocket.
    asyncio.create_task(
        analyze_transcript_job(
            transcript_text=transcript_text,
            include_quotes=payload.include_quotes,
            room_id=room_id,
            transcript_id=chosen_id,
        )
    )

    return {"room_id": room_id, "status": "started", "transcript_id": chosen_id}


@app.post("/transcriptions/summarize")
async def summarize_transcription(payload: SummarizeTranscriptRequest) -> dict:
    """Start a background summary job; results stream via websocket."""
    if not (payload.transcript_id or (payload.transcript_text and payload.transcript_text.strip())):
        raise HTTPException(status_code=400, detail="Provide either transcript_id or transcript_text.")

    if payload.save_summary and not payload.transcript_id:
        raise HTTPException(
            status_code=400,
            detail="save_summary is only supported when using transcript_id.",
        )

    transcript_text: str
    chosen_id: str | None = None

    if payload.transcript_id:
        transcript_path = _resolve_transcript_path(payload.transcript_id)
        transcript_text = transcript_path.read_text(encoding="utf-8")
        chosen_id = transcript_path.name
    else:
        transcript_text = payload.transcript_text or ""

    if not transcript_text.strip():
        raise HTTPException(status_code=400, detail="Transcript is empty.")

    room_id = await manager.create_room()
    await manager.ensure_room(room_id)

    asyncio.create_task(
        summarize_transcript_job(
            transcript_text=transcript_text,
            room_id=room_id,
            transcript_id=chosen_id,
            save_summary=payload.save_summary,
        )
    )

    return {"room_id": room_id, "status": "started", "transcript_id": chosen_id, "save_summary": payload.save_summary}


@app.post("/transcriptions/argument-map")
async def build_argument_map(payload: ArgumentMapRequest) -> dict:
    """Start an argument-map job using the dedicated prompt and persist the result to JSON."""
    if not (payload.transcript_id or (payload.transcript_text and payload.transcript_text.strip())):
        raise HTTPException(status_code=400, detail="Provide either transcript_id or transcript_text.")

    transcript_text: str
    chosen_id: str | None = None

    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)

    if payload.transcript_id:
        transcript_path = _resolve_transcript_path(payload.transcript_id)
        transcript_text = transcript_path.read_text(encoding="utf-8")
        chosen_id = transcript_path.name
        next_v = _next_argument_map_version(transcript_path)
        save_path = transcript_path.with_name(f"{transcript_path.stem}_argument_map_v{next_v}.json")
    else:
        transcript_text = payload.transcript_text or ""
        save_path = TRANSCRIPTS_DIR / f"argument_map_{uuid.uuid4().hex}.json"

    if not transcript_text.strip():
        raise HTTPException(status_code=400, detail="Transcript is empty.")

    room_id = await manager.create_room()
    await manager.ensure_room(room_id)

    asyncio.create_task(
        argument_map_job(
            transcript_text=transcript_text,
            room_id=room_id,
            transcript_id=chosen_id,
            save_path=save_path,
        )
    )

    return {
        "room_id": room_id,
        "status": "started",
        "transcript_id": chosen_id,
        "argument_map_file": save_path.name,
    }


@app.get("/transcriptions/{transcript_id}/argument-map")
async def get_argument_map(transcript_id: str) -> dict:
    """Return all saved argument map versions for a transcript."""
    transcript_path = _resolve_transcript_path(transcript_id)
    entries = _find_argument_map_versions(transcript_path)
    if not entries:
        raise HTTPException(status_code=404, detail="No argument maps found for this transcript.")
    versions = []
    for entry in entries:
        try:
            data = json.loads(entry["file"].read_text(encoding="utf-8"))
            versions.append({"version": entry["version"], "argument_map": data, "argument_map_file": entry["file"].name})
        except Exception:
            pass
    if not versions:
        raise HTTPException(status_code=404, detail="No argument maps found for this transcript.")
    return {"transcript_id": transcript_path.name, "versions": versions}


@app.get("/transcriptions/{transcript_id}/summary")
async def get_transcription_summary(transcript_id: str) -> dict:
    """Return all saved summary versions for a transcript."""
    transcript_path = _resolve_transcript_path(transcript_id)
    entries = _find_summary_versions(transcript_path)
    if not entries:
        raise HTTPException(status_code=404, detail="No summaries found for this transcript.")
    versions = []
    for entry in entries:
        try:
            text = entry["file"].read_text(encoding="utf-8")
            versions.append({"version": entry["version"], "summary": text, "summary_file": entry["file"].name})
        except Exception:
            pass
    if not versions:
        raise HTTPException(status_code=404, detail="No summaries found for this transcript.")
    return {"transcript_id": transcript_path.name, "versions": versions}


@app.post("/openai_transcribe")
async def transcribe_with_openai(
    file: UploadFile = File(...),
    room_id: str | None = Form(None),
    diarize: bool = Form(False),
) -> dict:
    room_id = room_id or await manager.create_room()
    await manager.ensure_room(room_id)
    tmp_path: Path | None = None
    try:
        if not os.getenv("OPENAI_API_KEY"):
            # No OpenAI key — fall back to local WhisperX (always diarizes).
            chosen_device = os.getenv("WHISPERX_DEVICE", "cuda")
            tmp_path = await save_upload_to_temp(file)
            transcript = await run_transcription(
                "openai_transcribe",
                room_id,
                lambda emit: whisperx_traanscribe(tmp_path, emit, device=chosen_device),
            )
            return {"room_id": room_id, "transcript": transcript, "diarize": diarize}

        # OpenAI path — read bytes directly; the client accepts raw bytes.
        audio_bytes = await file.read()
        tmp_path = Path(file.filename or "audio.wav")
        if diarize:
            result = await openai_diarize_transcribe(
                tmp_path,
                room_id,
                audio_bytes=audio_bytes,
                content_type=file.content_type,
            )
            return {"room_id": room_id, **result, "diarize": True}
        transcript = await openai_stream_transcribe(
            tmp_path,
            room_id,
            audio_bytes=audio_bytes,
            content_type=file.content_type,
        )
        return {"room_id": room_id, "transcript": transcript, "diarize": False}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if tmp_path and tmp_path.exists() and not os.getenv("OPENAI_API_KEY"):
            tmp_path.unlink(missing_ok=True)


@app.post("/whisperx_traanscribe")
async def transcribe_with_whisperx_endpoint(
    file: UploadFile = File(...),
    room_id: str | None = Form(None),
    device: str | None = Form(None),
) -> dict:
    room_id = room_id or await manager.create_room()
    await manager.ensure_room(room_id)
    chosen_device = device or "cuda"
    tmp_path: Path | None = None
    try:
        tmp_path = await save_upload_to_temp(file)
        transcript = await run_transcription(
            "whisperx_traanscribe",
            room_id,
            lambda emit: whisperx_traanscribe(tmp_path, emit, device=chosen_device),
        )
        return {"room_id": room_id, "transcript": transcript, "device": chosen_device}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


@app.post("/audio/slice")
async def slice_audio_segment(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    start: float = Form(..., description="Start time in seconds (>= 0)."),
    end: float = Form(..., description="End time in seconds (> start)."),
    output_format: str = Form("mp3", description="Output format. Supported: mp3, wav."),
) -> StreamingResponse:
    """Slice an uploaded audio/video file and return the trimmed audio."""
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        raise HTTPException(
            status_code=500,
            detail="ffmpeg is required on the server to slice audio.",
        )

    fmt = str(output_format).lower().lstrip(".")
    if fmt not in SUPPORTED_AUDIO_FORMATS:
        allowed = ", ".join(sorted(SUPPORTED_AUDIO_FORMATS))
        raise HTTPException(status_code=400, detail=f"Unsupported output_format '{fmt}'. Use one of: {allowed}.")

    if start < 0:
        raise HTTPException(status_code=400, detail="start must be greater than or equal to 0.")
    if end <= start:
        raise HTTPException(status_code=400, detail="end must be greater than start.")

    input_path = await save_upload_to_temp(file)
    tmp_out = tempfile.NamedTemporaryFile(delete=False, suffix=f".{fmt}")
    output_path = Path(tmp_out.name)
    tmp_out.close()

    codec_args = ["-c:a", "libmp3lame", "-b:a", "192k"] if fmt == "mp3" else ["-c:a", "pcm_s16le"]
    cmd = [
        ffmpeg_path,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{start}",
        "-to",
        f"{end}",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "2",
        "-ar",
        "44100",
        *codec_args,
        str(output_path),
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()

    if proc.returncode != 0:
        _cleanup_files([input_path, output_path])
        detail = stderr.decode().strip() or "ffmpeg failed."
        raise HTTPException(status_code=500, detail=detail)

    # Ensure temporary files are removed after the response is sent.
    background_tasks.add_task(_cleanup_files, [input_path, output_path])

    media_type = "audio/mpeg" if fmt == "mp3" else "audio/wav"
    base_name = Path(file.filename or "audio").stem
    suggested_name = f"{base_name}_{start:.2f}-{end:.2f}.{fmt}"

    return StreamingResponse(
        output_path.open("rb"),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename=\"{suggested_name}\"'},
        background=background_tasks,
    )


class SliceByIdRequest(BaseModel):
    transcript_id: str
    start: float
    end: float
    output_format: str | None = "mp3"


@app.post("/audio/slice-by-id")
async def slice_audio_by_id(payload: SliceByIdRequest, background_tasks: BackgroundTasks) -> StreamingResponse:
    """Slice a stored media file that matches the transcript id and return trimmed audio."""
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        raise HTTPException(
            status_code=500,
            detail="ffmpeg is required on the server to slice audio.",
        )

    fmt = (payload.output_format or "mp3").lower().lstrip(".")
    if fmt not in SUPPORTED_AUDIO_FORMATS:
        allowed = ", ".join(sorted(SUPPORTED_AUDIO_FORMATS))
        raise HTTPException(status_code=400, detail=f"Unsupported output_format '{fmt}'. Use one of: {allowed}.")

    if payload.start < 0:
        raise HTTPException(status_code=400, detail="start must be greater than or equal to 0.")
    if payload.end <= payload.start:
        raise HTTPException(status_code=400, detail="end must be greater than start.")

    media_path = _find_media_for_transcript(payload.transcript_id)

    tmp_out = tempfile.NamedTemporaryFile(delete=False, suffix=f".{fmt}")
    output_path = Path(tmp_out.name)
    tmp_out.close()

    codec_args = ["-c:a", "libmp3lame", "-b:a", "192k"] if fmt == "mp3" else ["-c:a", "pcm_s16le"]
    cmd = [
        ffmpeg_path,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{payload.start}",
        "-to",
        f"{payload.end}",
        "-i",
        str(media_path),
        "-vn",
        "-ac",
        "2",
        "-ar",
        "44100",
        *codec_args,
        str(output_path),
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()

    if proc.returncode != 0:
        _cleanup_files([output_path])
        detail = stderr.decode().strip() or "ffmpeg failed."
        raise HTTPException(status_code=500, detail=detail)

    background_tasks.add_task(_cleanup_files, [output_path])

    media_type = "audio/mpeg" if fmt == "mp3" else "audio/wav"
    suggested_name = f"{Path(payload.transcript_id).stem}_{payload.start:.2f}-{payload.end:.2f}.{fmt}"

    return StreamingResponse(
        output_path.open("rb"),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename=\"{suggested_name}\"'},
        background=background_tasks,
    )


async def _room_socket_handler(websocket: WebSocket, room_id: str) -> None:
    """Shared websocket handler so we can expose multiple paths."""

    # Accept early to allow close codes/reasons on failure paths.
    await websocket.accept()
    try:
        await manager.connect(room_id, websocket)
        await websocket.send_text(f"joined:{room_id}")

        while True:
            message = await websocket.receive_text()
            await manager.broadcast(room_id, message, sender=websocket)
    except RoomNotFound:
        await websocket.close(code=1008, reason="Room not found")
    except WebSocketDisconnect:
        await manager.disconnect(room_id, websocket)
    except Exception:
        await manager.disconnect(room_id, websocket)
        raise


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str) -> None:
    await _room_socket_handler(websocket, room_id)


@app.websocket("/api/ws/{room_id}")
async def websocket_endpoint_with_prefix(websocket: WebSocket, room_id: str) -> None:
    # Some deployments keep an /api prefix for websocket routes; expose an alias for compatibility.
    await _room_socket_handler(websocket, room_id)


@app.post("/assistant")
async def assistant(
    request: Request,
    question: Optional[str] = Form(None),
):
    try:
        if not question or not str(question).strip():
            raise HTTPException(
                status_code=400,
                detail="No question received.",
            )

        question = question.strip()

        transcripts_dir = Path("./transcriptions/")  # point this to your folder

        transcript_blocks = []
        for f in sorted(transcripts_dir.rglob("*.txt")):
            if f.stem.endswith("_summary") or f.stem.find("_part") != -1:
                print("Skipping non-transcript files")
                continue
            
            full_text = f.read_text(encoding="utf-8")
           
            if not full_text.strip():
                continue
            transcript_blocks.append({
                "transcriptID": f.name,              # keep field name; value is filename
                "title": f.stem,                 # keep field; use stem as a friendly title
                "text": full_text,
            })

        if not transcript_blocks:
            return {
                "type": "text",
                "answer": "There are no reports with content yet.",
                "sources": [],
            }

        blocks_txt = ""
        for i, rb in enumerate(transcript_blocks, start=1):
            blocks_txt += (
                f"\n[TRANSCRIPT {i}]\n"
                f"ID: {rb['transcriptID']}\n"
                f"TITLE: {rb['title']}\n"
                f"TEXTO:\n{rb['text']}\n"
            )

        system_msg = (
            "You are a technical assistant in a live demonstration.\n"
            "The goal is to always help the user.\n"
            "ALWAYS return valid JSON.\n\n"
            "Rules:\n"
            "- Use the provided transcripts as context whenever it makes sense.\n"
            "- Each transcript file contains multiple lines like '[start–end] Speaker X: ...'.\n"
            "- If the question asks for comparison, ranking, top, percentages, or trends, generate a chart.\n"
            "- Charts are mostly for demonstration purposes (show off).\n"
            "- When generating a chart:\n"
            "  • use plausible and coherent values (integers > 0)\n"
            "  • use fictitious company names\n"
            "  • include 'sources' **only if** the chart is clearly based on real data from the transcripts\n"
            "- If the chart is purely demonstrative, DO NOT include 'sources'.\n"
            "- For text-only answers, you may include 'sources' when it makes sense.\n"
            "- Never include sources without a clear relation to the answer.\n\n"
            "For demonstrative charts, use only these fictitious company names (vary as needed):\n"
            "MG Solutions, LS Market, Ferreira LDA, Fraga Norte, InTeck\n\n"
            "Possible formats:\n"
            "Text:\n"
            "{\"type\":\"text\",\"answer\":\"...markdown...\",\"sources\":[{\"reportId\":\"...\",\"title\":\"...\"}]}\n\n"
            "Chart:\n"
            "{\"type\":\"chart\",\"answer\":\"optional intro text\","
            "\"chart\":{\"type\":\"bar|line|pie\",\"data\":[{\"name\":\"Company\",\"value\":10}]}"
            "[, \"sources\":[{\"reportId\":\"...\",\"title\":\"...\"}]]}"
        )


        user_msg = f"REPORTS:\n{blocks_txt}\n\nQUESTION:\n{question}"

        raw = ai_call(
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.3,
            json_mode=True,
        ).strip()

        try:
            payload = json.loads(raw)
        except Exception:
            m = re.search(r"\{[\s\S]*\}$", raw)
            payload = json.loads(m.group(0)) if m else {
                "type": "text",
                "answer": raw,
                "sources": [],
            }

        if payload.get("type") == "chart":
            chart = payload.get("chart") or {}
            data = chart.get("data") or []
            norm = []
            for d in data:
                try:
                    val = int(d.get("value"))
                except Exception:
                    val = random.randint(1, 10)
                norm.append({"name": str(d.get("name")), "value": val})
            payload["chart"] = {
                "type": chart.get("type") or "bar",
                "data": norm,
            }

        seen = set()
        clean_sources = []
        for s in payload.get("sources", []):
            rid = s.get("reportId")
            if rid and rid not in seen:
                seen.add(rid)
                clean_sources.append(s)

        payload["sources"] = clean_sources
        return payload

    except HTTPException:
        raise
    except Exception as e:
        print("❌ ERRO /assistant:", e)
        raise HTTPException(
            status_code=500,
            detail="Assistant error.",
        )



if __name__ == "__main__":
    import uvicorn


    PORT = os.getenv("PORT", 8000)
    uvicorn.run("main:app", host="0.0.0.0", port=int(PORT), reload=True)
