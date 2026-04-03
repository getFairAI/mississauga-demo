# whisperx_transcriber.py
import asyncio
import os
from pathlib import Path
from typing import Callable, Any, List
import inspect

import whisperx
from whisperx.diarize import DiarizationPipeline


def transcribe_with_whisperx(
    audio_path: Path,
    device: str = "cuda",
    emit: Callable[[str, Any | None], None] | None = None,
) -> str:
    """
    Transcribe an audio file using WhisperX with alignment + diarization.

    Emits optional progress events via `emit(stage, detail)`.
    Returns the full diarized transcript as text.
    """

    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    send = emit or (lambda stage, detail=None: None)

    send("load_model", {"percent": 5, "device": device})
    model_name = "large-v3"
    model = whisperx.load_model(model_name, device)

    send("load_audio", {"percent": 10})
    audio = whisperx.load_audio(str(audio_path))

    def supports_param(fn, param: str) -> bool:
        try:
            sig = inspect.signature(fn)
            return param in sig.parameters
        except (TypeError, ValueError):
            return False

    def progress_callback(p: float):
        send("transcribe", {"percent": max(10, min(60, p))})

    transcribe_kwargs = {}
    if supports_param(model.transcribe, "progress_callback"):
        transcribe_kwargs["progress_callback"] = progress_callback

    send("transcribe", {"percent": 15})
    result = model.transcribe(audio, language="en", **transcribe_kwargs)
    send("transcribe", {"percent": 60})

    send("load_align_model", {"percent": 70})
    align_model, metadata = whisperx.load_align_model(
        language_code=result["language"],
        device=device,
    )

    align_kwargs = {}
    if supports_param(whisperx.align, "progress_callback"):
        align_kwargs["progress_callback"] = lambda p: send("align", {"percent": 70 + 0.2 * p})

    send("align", {"percent": 75})
    result_aligned = whisperx.align(
        result["segments"],
        align_model,
        metadata,
        audio,
        device,
        **align_kwargs,
    )
    send("align", {"percent": 80})

    send("diarize", {"percent": 90})
    hf_token = os.getenv("HF_TOKEN")
    if not hf_token:
        raise RuntimeError("HF_TOKEN is missing from environment variables!")

    diarize_model = DiarizationPipeline(
        token=hf_token,
        device=device,
    )
    diarize_kwargs = {}
    if supports_param(diarize_model.__call__, "hook"):
        diarize_kwargs["hook"] = lambda info: send("diarize", {"percent": 85 + 0.1 * float(info.get("progress", 0))})

    diarization = diarize_model(str(audio_path), **diarize_kwargs)

    send("assign_speakers", {"percent": 95})
    result_with_speakers = whisperx.assign_word_speakers(
        diarization,
        result_aligned,
    )

    send("build_output", {"percent": 99})
    lines = []
    for seg in result_with_speakers["segments"]:
        speaker = seg.get("speaker", "UNKNOWN")
        text = seg.get("text", "").strip()
        start = seg.get("start", 0.0)
        end = seg.get("end", 0.0)
        lines.append(f"[{start:.2f}–{end:.2f}] {speaker}: {text}")

    output = "\n".join(lines)
    send("done", {"percent": 100})
    return output

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
                text = await asyncio.to_thread(transcribe_with_whisperx, chunk)
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