"""Runaway protection for OpenAI API calls.

Every OpenAI call site in the codebase routes through ``guarded_call`` (sync) or
``guarded_acall`` (async). The guard enforces:

- Concurrency cap (semaphore)
- Sliding-window rate cap
- Hard circuit breaker on burst / window violations
- Single-flight dedup keyed by hash of (model, args)

Once the breaker trips, every subsequent call raises :class:`OpenAIGuardTripped`
until ``reset_breaker()`` is invoked (admin endpoint or process restart).

Defaults are deliberately tight for a demo. Override via env vars:

    OPENAI_GUARD_CONCURRENCY  (default 2)
    OPENAI_GUARD_WINDOW_SEC   (default 60)
    OPENAI_GUARD_RPM          (default 20)
    OPENAI_GUARD_BURST        (default 8 calls per 10s)
"""

from __future__ import annotations

import asyncio
import collections
import hashlib
import json
import logging
import os
import threading
import time
from concurrent.futures import Future
from typing import Any, Awaitable, Callable, TypeVar

log = logging.getLogger("openai_guard")

T = TypeVar("T")


# ── Configuration ─────────────────────────────────────────────────────────────

MAX_CONCURRENT = int(os.getenv("OPENAI_GUARD_CONCURRENCY", "2"))
WINDOW_SEC = int(os.getenv("OPENAI_GUARD_WINDOW_SEC", "60"))
WINDOW_MAX = int(os.getenv("OPENAI_GUARD_RPM", "20"))
BREAKER_BURST = int(os.getenv("OPENAI_GUARD_BURST", "8"))
BURST_SEC = 10


# ── State ─────────────────────────────────────────────────────────────────────

_thread_sem = threading.BoundedSemaphore(MAX_CONCURRENT)
_async_sem: asyncio.Semaphore | None = None  # lazily bound to the running loop

_state_lock = threading.Lock()
_window: collections.deque[float] = collections.deque()
_total_calls = 0
_breaker_open = False
_breaker_reason: str | None = None
_breaker_tripped_at: float | None = None

_inflight_lock = threading.Lock()
_inflight_sync: dict[str, Future] = {}
_inflight_async: dict[str, asyncio.Future] = {}


class OpenAIGuardTripped(RuntimeError):
    """Raised when the breaker is open or a request is denied."""


# ── Internal helpers ──────────────────────────────────────────────────────────


def _get_async_sem() -> asyncio.Semaphore:
    global _async_sem
    if _async_sem is None:
        _async_sem = asyncio.Semaphore(MAX_CONCURRENT)
    return _async_sem


def _record_and_check(call_site: str) -> tuple[int, int]:
    """Append ``now`` to the window, trip breaker if limits exceeded.

    Returns (window_count, burst_count) for logging.
    Raises :class:`OpenAIGuardTripped` if the breaker is already open or just tripped.
    """
    global _breaker_open, _breaker_reason, _breaker_tripped_at, _total_calls
    now = time.monotonic()
    with _state_lock:
        if _breaker_open:
            raise OpenAIGuardTripped(
                f"breaker open: {_breaker_reason} (call_site={call_site})"
            )
        while _window and now - _window[0] > WINDOW_SEC:
            _window.popleft()
        burst = sum(1 for t in _window if now - t <= BURST_SEC)
        if burst + 1 > BREAKER_BURST:
            _breaker_open = True
            _breaker_reason = f"burst {burst + 1}>{BREAKER_BURST} in {BURST_SEC}s"
            _breaker_tripped_at = time.time()
            log.error("OPENAI BREAKER TRIPPED at %s: %s", call_site, _breaker_reason)
            raise OpenAIGuardTripped(_breaker_reason)
        if len(_window) + 1 > WINDOW_MAX:
            _breaker_open = True
            _breaker_reason = f"rate {len(_window) + 1}>{WINDOW_MAX} in {WINDOW_SEC}s"
            _breaker_tripped_at = time.time()
            log.error("OPENAI BREAKER TRIPPED at %s: %s", call_site, _breaker_reason)
            raise OpenAIGuardTripped(_breaker_reason)
        _window.append(now)
        _total_calls += 1
        return len(_window), burst + 1


# ── Sync entry point ──────────────────────────────────────────────────────────


def guarded_call(call_site: str, key: str | None, fn: Callable[[], T]) -> T:
    """Run ``fn`` under the guard. ``key=None`` skips single-flight dedup."""
    fut: Future | None = None
    if key is not None:
        with _inflight_lock:
            existing = _inflight_sync.get(key)
            if existing is None:
                fut = Future()
                _inflight_sync[key] = fut
        # Wait for the leader OUTSIDE the lock to avoid blocking other waiters.
        if existing is not None:
            log.info("openai_guard: dedup hit call_site=%s key=%s", call_site, key[:16])
            return existing.result()  # waits, propagates exceptions

    acquired = _thread_sem.acquire(timeout=120)
    if not acquired:
        timeout_err = OpenAIGuardTripped(
            f"concurrency timeout after 120s (call_site={call_site})"
        )
        if fut is not None:
            with _inflight_lock:
                _inflight_sync.pop(key, None)
            if not fut.done():
                fut.set_exception(timeout_err)
        raise timeout_err
    try:
        window_count, burst_count = _record_and_check(call_site)
        log.info(
            "openai_guard call_site=%s key=%s inflight=%d window=%d burst=%d",
            call_site,
            (key or "stream")[:16],
            len(_inflight_sync) + len(_inflight_async),
            window_count,
            burst_count,
        )
        result = fn()
        if fut is not None:
            fut.set_result(result)
        return result
    except BaseException as exc:
        if fut is not None and not fut.done():
            fut.set_exception(exc)
        raise
    finally:
        _thread_sem.release()
        if fut is not None:
            with _inflight_lock:
                _inflight_sync.pop(key, None)


# ── Async entry point ─────────────────────────────────────────────────────────


async def guarded_acall(
    call_site: str,
    key: str | None,
    fn: Callable[[], Awaitable[T]],
) -> T:
    """Async variant of :func:`guarded_call`."""
    loop = asyncio.get_running_loop()
    afut: asyncio.Future | None = None
    if key is not None:
        with _inflight_lock:
            existing = _inflight_async.get(key)
            if existing is None:
                afut = loop.create_future()
                _inflight_async[key] = afut
        # Wait for the leader OUTSIDE the lock so the event loop isn't pinned.
        if existing is not None:
            log.info("openai_guard: dedup hit call_site=%s key=%s", call_site, key[:16])
            return await existing

    sem = _get_async_sem()
    try:
        await asyncio.wait_for(sem.acquire(), timeout=120)
    except asyncio.TimeoutError as exc:
        timeout_err = OpenAIGuardTripped(
            f"concurrency timeout after 120s (call_site={call_site})"
        )
        if afut is not None:
            with _inflight_lock:
                _inflight_async.pop(key, None)
            if not afut.done():
                afut.set_exception(timeout_err)
                _ = afut.exception()  # mark as retrieved
        raise timeout_err from exc

    try:
        window_count, burst_count = _record_and_check(call_site)
        log.info(
            "openai_guard call_site=%s key=%s inflight=%d window=%d burst=%d",
            call_site,
            (key or "stream")[:16],
            len(_inflight_sync) + len(_inflight_async),
            window_count,
            burst_count,
        )
        result = await fn()
        if afut is not None and not afut.done():
            afut.set_result(result)
        return result
    except BaseException as exc:
        if afut is not None and not afut.done():
            afut.set_exception(exc)
        raise
    finally:
        sem.release()
        if afut is not None:
            with _inflight_lock:
                _inflight_async.pop(key, None)
            # If no follower awaited the future, retrieve any exception so
            # asyncio doesn't log "Future exception was never retrieved".
            if afut.done() and not afut.cancelled():
                _ = afut.exception()


# ── Key builders ──────────────────────────────────────────────────────────────


def _sha1(blob: bytes) -> str:
    return hashlib.sha1(blob).hexdigest()


def key_chat(
    model: str,
    messages: list[dict],
    *,
    temperature: float,
    json_mode: bool,
) -> str:
    payload = json.dumps(
        {"model": model, "messages": messages, "temperature": temperature, "json_mode": json_mode},
        sort_keys=True,
        default=str,
    ).encode()
    return f"chat:{_sha1(payload)}"


def key_audio(
    model: str,
    file_ref: Any,
    *,
    response_format: str,
    chunking: str = "",
) -> str:
    """Build a key for audio.transcriptions calls.

    ``file_ref`` may be ``bytes``, a ``pathlib.Path``, or a string path.
    """
    if isinstance(file_ref, (bytes, bytearray)):
        digest = _sha1(bytes(file_ref))
    else:
        try:
            from pathlib import Path

            p = Path(str(file_ref))
            stat = p.stat()
            digest = _sha1(f"{p}|{stat.st_size}|{stat.st_mtime_ns}".encode())
        except Exception:
            digest = _sha1(str(file_ref).encode())
    return f"audio:{model}|{response_format}|{chunking}|{digest}"


def key_embed(model: str, inputs: list[str]) -> str:
    joined = ("\x00".join(inputs)).encode()
    return f"embed:{model}|{_sha1(joined)}"


# ── Admin / introspection ─────────────────────────────────────────────────────


def reset_breaker() -> dict:
    """Clear the breaker and the rate window. Returns prior state."""
    global _breaker_open, _breaker_reason, _breaker_tripped_at
    with _state_lock:
        prev = {
            "was_open": _breaker_open,
            "reason": _breaker_reason,
            "tripped_at": _breaker_tripped_at,
            "window_count": len(_window),
        }
        _breaker_open = False
        _breaker_reason = None
        _breaker_tripped_at = None
        _window.clear()
    return {"prev": prev, "now": "closed"}


def guard_status() -> dict:
    with _state_lock:
        return {
            "breaker_open": _breaker_open,
            "breaker_reason": _breaker_reason,
            "breaker_tripped_at": _breaker_tripped_at,
            "window_sec": WINDOW_SEC,
            "window_max": WINDOW_MAX,
            "burst_max": BREAKER_BURST,
            "burst_sec": BURST_SEC,
            "concurrency": MAX_CONCURRENT,
            "window_count": len(_window),
            "total_calls": _total_calls,
            "inflight_sync": len(_inflight_sync),
            "inflight_async": len(_inflight_async),
        }
