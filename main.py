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
from pathlib import Path
from typing import Any, Callable, Dict, List, Set, AsyncGenerator

from fastapi import File, Form, FastAPI, HTTPException, UploadFile, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI, OpenAI
from pydantic import BaseModel
from dotenv import load_dotenv
import openai
from fastapi import Form
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

        aggregated_summary: str | None = None
        for idx, chunk in enumerate(chunks or [transcript_text], start=1):
            aggregated_summary = await asyncio.to_thread(
                generate_summary,
                chunk,
                idx,
                total_chunks,
                aggregated_summary,
            )
            await _broadcast(
                "chunk_complete",
                {
                    "chunk": idx,
                    "total_chunks": total_chunks,
                    "summary": aggregated_summary,
                    "transcript_id": transcript_id,
                },
            )

        final_summary = (aggregated_summary or "").strip()
        response: dict[str, Any] = {
            "transcript_id": transcript_id,
            "summary": final_summary,
        }

        if save_summary and transcript_id:
            transcript_path = _resolve_transcript_path(transcript_id)
            target_path = transcript_path.with_name(f"{transcript_path.stem}_summary.txt")
            await asyncio.to_thread(target_path.write_text, final_summary, "utf-8")
            response["summary_file"] = target_path.name

        await _broadcast("finished")
        await _broadcast("result", {"summary": response})
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

    completion = sync_client.chat.completions.create(
        model="gpt-4.1",
        response_format={"type": "json_object"},
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
    )

    raw = completion.choices[0].message.content
    try:
        payload = json.loads(raw)
    except Exception:
        # Fallback: best-effort extraction by simple heuristics if JSON parsing fails.
        payload = {"highlights": [textwrap.shorten(transcript_text, width=180, placeholder="…")], "actionable_topics": []}

    return _normalize_actionable_payload(payload)


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
    """Legacy non-streaming OpenAI Whisper-1 (kept for fallback)."""
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

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
            if path.stem.endswith("_summary") or path.stem.find("_part") != -1:
                continue
            lines, topic = parse_transcript_file(path)
            duration = lines[-1].end if lines else None
            items.append(
                {
                    "id": path.name,
                    "title": path.stem,
                    "topic": topic,
                    "line_count": len(lines),
                    "duration": duration,
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


@app.get("/transcriptions/{transcript_id}/summary")
async def get_transcription_summary(transcript_id: str) -> dict:
    """Return a previously saved summary for a transcript.

    Summaries are expected alongside the transcript files with the pattern
    `<transcript_stem>_summary.txt`. If no summary file exists, a 404 is
    returned to keep error semantics predictable for clients.
    """

    transcript_path = _resolve_transcript_path(transcript_id)
    summary_path = transcript_path.with_name(f"{transcript_path.stem}_summary.txt")

    if not summary_path.exists():
        raise HTTPException(status_code=404, detail="Summary not found for this transcript.")

    try:
        summary_text = summary_path.read_text(encoding="utf-8")
    except Exception as exc:  # pragma: no cover - defensive path
        raise HTTPException(status_code=500, detail=f"Failed to read summary: {exc}") from exc

    return {
        "transcript_id": transcript_path.name,
        "summary_file": summary_path.name,
        "summary": summary_text,
    }


@app.post("/openai_transcribe")
async def transcribe_with_openai(
    file: UploadFile = File(...),
    room_id: str | None = Form(None),
    diarize: bool = Form(False),
) -> dict:
    room_id = room_id or await manager.create_room()
    await manager.ensure_room(room_id)
    try:
        # Read bytes directly; the OpenAI client accepts raw bytes.
        audio_bytes = await file.read()
        tmp_path = Path(file.filename or "audio.wav")
        # openai_stream_transcribe expects a path; provide a pseudo path for metadata.
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


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str) -> None:
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

        completion = openai.chat.completions.create(
            model="gpt-5.2",
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.3,
        )

        raw = completion.choices[0].message.content.strip()

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
