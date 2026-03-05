# openai_pipeline.py
from pathlib import Path
import mimetypes
from openai import OpenAI
from dotenv import load_dotenv
import asyncio
from openai import AsyncOpenAI
import subprocess
import tempfile
import shutil
from typing import List

load_dotenv()

# Client uses OPENAI_API_KEY from environment
client = OpenAI()
async_client = AsyncOpenAI()

def transcribe_with_openai(audio_path: Path) -> str:
    """
    Transcribe an audio file using OpenAI's diarization model.
    """
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    with open(audio_path, "rb") as audio_file:
        response = client.audio.transcriptions.create(
            model="gpt-4o-transcribe-diarize",
            file=audio_file,
            response_format="diarized_json",
            chunking_strategy="auto",
        )

    lines = []
    for seg in response.segments:
        speaker = getattr(seg, "speaker", "unknown")
        start = getattr(seg, "start", 0.0)
        end = getattr(seg, "end", 0.0)
        text = getattr(seg, "text", "").strip()
        lines.append(f"[{start:.2f}–{end:.2f}] {speaker}: {text}")

    return "\n".join(lines)

async def openai_stream_transcribe(
    audio_path: Path,
    audio_bytes: bytes | None = None,
    content_type: str | None = None,
) -> str:
    """
    Stream diarized transcription for a single file.

    We collect text deltas for immediate progress and also capture any
    segment/utterance payloads the streaming API emits so the final
    string preserves speaker labels.
    """
    if audio_bytes is None:
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")
        audio_bytes = await asyncio.to_thread(audio_path.read_bytes)

    if content_type is None:
        guessed, _ = mimetypes.guess_type(audio_path.name)
        content_type = guessed or "application/octet-stream"

    try:
        stream = await async_client.audio.transcriptions.create(
            model="gpt-4o-transcribe-diarize",
            response_format="diarized_json",
            chunking_strategy="auto",
            file=(
                audio_path.name or "audio.wav",
                audio_bytes,
                content_type,
            ),
            stream=True,
        )

        transcript_parts: list[str] = []
        diarized_segments: list[dict] = []
        segments_by_id: dict[str, dict] = {}

        async for event in stream:
            event_type = getattr(event, "type", None)

            # Collect incremental text if available.
            delta = getattr(event, "text", None) or getattr(event, "delta", None)
            if delta:
                transcript_parts.append(delta)
                segment_id = getattr(event, "segment_id", None)
                if segment_id:
                    rec = segments_by_id.setdefault(segment_id, {"text": ""})
                    rec["text"] += delta

            # Capture diarized segments emitted by the stream.
            if event_type == "transcript.text.segment":
                segment_id = getattr(event, "id", None)
                segment_record = {
                    "speaker": getattr(event, "speaker", None) or "unknown",
                    "start": getattr(event, "start", None),
                    "end": getattr(event, "end", None),
                    "text": getattr(event, "text", "").strip(),
                }
                if segment_id:
                    prior = segments_by_id.get(segment_id)
                    if prior and prior.get("text") and not segment_record["text"]:
                        segment_record["text"] = prior["text"]
                    segments_by_id[segment_id] = {**prior} if prior else {}
                    segments_by_id[segment_id].update(segment_record)
                diarized_segments.append(segment_record)

        # If diarized segments were provided, format them with speaker labels.
        if diarized_segments or segments_by_id:
            ordered = diarized_segments or list(segments_by_id.values())
            speaker_alias: dict[str, str] = {}
            lines = []
            next_idx = 1
            for seg in ordered:
                speaker = seg.get("speaker") or "unknown"
                # Give stable aliases for unknown speakers.
                if speaker == "unknown":
                    if speaker not in speaker_alias:
                        speaker_alias[speaker] = f"Speaker {next_idx}"
                        next_idx += 1
                    label = speaker_alias[speaker]
                else:
                    label = str(speaker)
                start = seg.get("start", 0.0) or 0.0
                end = seg.get("end", 0.0) or 0.0
                text = (seg.get("text") or "").strip()
                lines.append(f"[{start:.2f}–{end:.2f}] {label}: {text}")
            return "\n".join(lines)

        # Fallback: plain text concatenation.
        return "".join(transcript_parts).strip()
    except Exception as exc:
        print(exc)
        raise


async def transcribe_large_file_chunked(
    chunks_path: Path,
) -> str:
    """
    Split a large audio/video into chunks and transcribe each chunk with OpenAI,
    then concatenate transcripts in order.
    """
    
    if not chunks_path.exists():
        raise FileNotFoundError(f"Audio parts not found: {chunks_path}")

    transcripts_dir = Path("./transcriptions")
    transcripts_dir.mkdir(parents=True, exist_ok=True)
    final_path = transcripts_dir / f"{chunks_path.name}.txt"

    # If we already have the full transcript, skip work and return it.
    if final_path.exists():
        return final_path.read_text(encoding="utf-8")

    # temp_dir = Path(tempfile.mkdtemp(prefix="chunks_"))
    try:
        chunks = sorted(chunks_path.glob("part_*.mp3"))
        if not chunks:
            raise RuntimeError("No chunks were produced by ffmpeg.")

        combined: List[str] = []
        for idx, chunk in enumerate(chunks, start=1):
            print(f"Transcribing chunk {idx}/{len(chunks)}: {chunks_path}-{chunk.name}")
            chunk_output = transcripts_dir / f"{chunks_path.name}_{chunk.stem}.txt"

            # Skip transcription if this chunk was already processed.
            if chunk_output.exists():
                text = chunk_output.read_text(encoding="utf-8")
            else:
                text = await openai_stream_transcribe(chunk)
                chunk_output.write_text(text, encoding="utf-8")

            combined.append(text)

        result = "\n".join(combined)
        # Persist the full concatenated transcript for future fast paths.
        final_path.write_text(result, encoding="utf-8")
        return result
    finally:
        print("done")
        # if not keep_chunks:
            # shutil.rmtree(temp_dir, ignore_errors=True)
