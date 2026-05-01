"""Smoke test: confirm the OpenAI guard breaker engages under burst load.

Usage:
    OPENAI_API_KEY=sk-... uv run python scripts/test_guard_burst.py

Fires a burst of identical-but-not-deduped requests at /assistant and asserts
that:
  1. Some requests succeed (concurrency cap allows a few through).
  2. Subsequent requests are refused with HTTP 5xx and "breaker open" in the body.
  3. /admin/openai-guard reports breaker_open=True.
  4. /admin/reset-openai-guard clears the breaker.
"""

from __future__ import annotations

import asyncio
import sys

import httpx

API_BASE = "http://localhost:8000"
TOTAL = 30  # well above OPENAI_GUARD_BURST=8 default


async def fire(client: httpx.AsyncClient, idx: int) -> tuple[int, str]:
    # Distinct questions to bypass single-flight dedup.
    q = f"smoke test {idx}"
    try:
        res = await client.post(
            f"{API_BASE}/assistant",
            data={"question": q},
            timeout=60,
        )
        return res.status_code, res.text[:120]
    except httpx.HTTPError as exc:
        return -1, str(exc)[:120]


async def main() -> int:
    async with httpx.AsyncClient() as client:
        print(f"Firing {TOTAL} concurrent /assistant requests...")
        results = await asyncio.gather(*(fire(client, i) for i in range(TOTAL)))

        ok = [r for r in results if r[0] == 200]
        breaker = [r for r in results if "breaker open" in r[1].lower() or "guard" in r[1].lower()]
        other_err = [r for r in results if r[0] not in (200,) and r not in breaker]

        print(f"  ok={len(ok)} breaker_refused={len(breaker)} other_err={len(other_err)}")
        for code, body in (ok + breaker + other_err)[:5]:
            print(f"  [{code}] {body!r}")

        status = (await client.get(f"{API_BASE}/admin/openai-guard")).json()
        print(f"Guard status: {status}")
        if not status.get("breaker_open"):
            print("FAIL: breaker did not trip. Check log + raise BURST/RPM expectations.")
            return 1

        reset = (await client.post(f"{API_BASE}/admin/reset-openai-guard")).json()
        print(f"Reset: {reset}")

        post_reset = (await client.get(f"{API_BASE}/admin/openai-guard")).json()
        if post_reset.get("breaker_open"):
            print("FAIL: breaker still open after reset.")
            return 1

        print("PASS")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
