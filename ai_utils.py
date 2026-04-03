"""Shared AI routing: OpenAI when OPENAI_API_KEY is set, Ollama otherwise."""

import os
from typing import Any

# ---------------------------------------------------------------------------
# Ollama defaults — tuned for 24GB VRAM + 64GB RAM
#
# Model: qwen2.5:14b
#   ~8.5 GB VRAM at Q4_K_M, leaving ~15 GB for KV cache.
#   KV cache per token = 2 × 48 layers × 8 kv_heads × 128 head_dim × 2 bytes
#                      = 192 KB/token → ~32 K tokens fit comfortably in 15 GB.
#   Supports 128 K native context; 32 K is the safe default without KV quantisation.
#
#   To double effective context at the same VRAM cost, set:
#       OLLAMA_KV_CACHE_TYPE=q8_0   (halves KV cache memory → ~64 K safe context)
#   in the environment before starting `ollama serve`.
#
# Alternatives:
#   qwen2.5:32b  — better reasoning but only ~12 K safe context on 24 GB
#   mistral-nemo — ~7 GB model, ~40 K safe context, slightly weaker reasoning
#
# Context: override with OLLAMA_NUM_CTX (tokens). Default 32768.
#
# If extra_body options are ignored by your Ollama version, bake the params
# into a Modelfile instead:
#
#   FROM qwen2.5:14b
#   PARAMETER num_ctx 32768
#   PARAMETER num_gpu 999
#   PARAMETER num_batch 512
#
#   ollama create civic-memory -f Modelfile
#   OLLAMA_MODEL=civic-memory uvicorn main:app ...
# ---------------------------------------------------------------------------

_OLLAMA_DEFAULT_MODEL = "qwen3:30b"
_OLLAMA_DEFAULT_NUM_CTX = 32768   # safe for 14B on 24 GB; raise to 65536 with q8_0 KV cache

_openai_client = None
_ollama_client = None


def _get_openai_client():
    global _openai_client
    if _openai_client is None:
        from openai import OpenAI
        _openai_client = OpenAI()
    return _openai_client


def _get_ollama_client():
    global _ollama_client
    if _ollama_client is None:
        from openai import OpenAI
        _ollama_client = OpenAI(
            base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
            api_key="ollama",
        )
    return _ollama_client


def ai_call(
    messages: list[dict],
    *,
    temperature: float = 0.2,
    json_mode: bool = False,
) -> str:
    """Route a chat completion to OpenAI or local Ollama.

    Routing logic:
    - OPENAI_API_KEY present → OpenAI, model from OPENAI_MODEL (default: gpt-4.1)
    - OPENAI_API_KEY absent  → Ollama, model from OLLAMA_MODEL (default: qwen2.5:14b)
                               Context from OLLAMA_NUM_CTX (default: 32768)
                               Base URL from OLLAMA_BASE_URL (default: http://localhost:11434/v1)
    """
    if os.getenv("OPENAI_API_KEY"):
        client = _get_openai_client()
        model = os.getenv("OPENAI_MODEL", "gpt-4.1")
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
    else:
        client = _get_ollama_client()
        model = os.getenv("OLLAMA_MODEL", _OLLAMA_DEFAULT_MODEL)
        num_ctx = int(os.getenv("OLLAMA_NUM_CTX", _OLLAMA_DEFAULT_NUM_CTX))
        kwargs = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            # Pass Ollama-specific options via extra_body (supported in Ollama ≥ 0.3).
            # If ignored by older versions, bake them into a Modelfile instead.
            "extra_body": {
                "options": {
                    "num_ctx": num_ctx,
                    "num_gpu": 999,      # offload all layers to GPU
                    "num_batch": 512,    # prompt eval batch size
                },
            },
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

    completion = client.chat.completions.create(**kwargs)
    return completion.choices[0].message.content


async def transcribe_chunks(chunks_path) -> str:
    """Route chunked audio transcription to OpenAI or local WhisperX.

    Routing logic:
    - OPENAI_API_KEY present → openai_transcribe.transcribe_large_file_chunked
    - OPENAI_API_KEY absent  → whisperx_transcribe.transcribe_large_file_chunked
                               Device from WHISPERX_DEVICE (default: cuda)
    """
    if os.getenv("OPENAI_API_KEY"):
        from openai_transcribe import transcribe_large_file_chunked
        return await transcribe_large_file_chunked(chunks_path)
    else:
        from whisperx_transcribe import transcribe_large_file_chunked
        return await transcribe_large_file_chunked(chunks_path)
