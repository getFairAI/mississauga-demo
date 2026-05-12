# syntax=docker/dockerfile:1.7

FROM python:3.12-slim AS backend

ARG INSTALL_WHISPERX=0

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN if [ "$INSTALL_WHISPERX" = "1" ]; then \
        pip install -r requirements.txt ; \
    else \
        grep -viE '^[[:space:]]*whisperx([[:space:]=<>!~].*)?$' requirements.txt > /tmp/req.txt && \
        pip install -r /tmp/req.txt ; \
    fi \
 && pip install chromadb

COPY ai_utils.py main.py openai_guard.py openai_transcribe.py rag.py summarize_call.py ./
COPY scripts ./scripts

RUN mkdir -p data transcriptions chunks parts

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8001/docs > /dev/null || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
