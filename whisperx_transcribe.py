# whisperx_transcriber.py
import os
from pathlib import Path
from typing import Callable, Any
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
    result = model.transcribe(audio, **transcribe_kwargs)
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
        use_auth_token=hf_token,
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
