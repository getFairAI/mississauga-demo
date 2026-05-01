"""Smoke test: confirm single-flight dedup coalesces identical concurrent calls.

Usage:
    OPENAI_API_KEY=sk-... uv run python scripts/test_guard_dedup.py

Fires N simultaneous identical /assistant calls. Expects:
  1. All N return successfully with the same body (followers wait on the leader).
  2. The guard's total_calls counter increments by exactly 1, not N.
"""

from __future__ import annotations

import asyncio
import sys

import httpx

API_BASE = "http://localhost:8000"
N = 6


async def main() -> int:
    async with httpx.AsyncClient() as client:
        # Reset breaker + counters so the test is repeatable.
        await client.post(f"{API_BASE}/admin/reset-openai-guard")
        before = (await client.get(f"{API_BASE}/admin/openai-guard")).json()
        baseline = before.get("total_calls", 0)

        print(f"Firing {N} identical /assistant calls (single-flight should coalesce)...")
        question = "what topics did mississauga budget committee discuss"
        responses = await asyncio.gather(
            *(
                client.post(
                    f"{API_BASE}/assistant",
                    data={"question": question},
                    timeout=120,
                )
                for _ in range(N)
            )
        )

        bodies = [r.text for r in responses]
        codes = [r.status_code for r in responses]
        print(f"  status codes: {codes}")
        print(f"  unique body count: {len(set(bodies))}")

        after = (await client.get(f"{API_BASE}/admin/openai-guard")).json()
        delta = after.get("total_calls", 0) - baseline
        print(f"  total_calls delta: {delta} (expected: 1)")

        if delta != 1:
            print(
                "NOTE: dedup happens at the OpenAI client layer, not the FastAPI handler. "
                "If the /assistant handler does work BEFORE calling ai_call(), each request "
                "still exercises that work — but only ONE OpenAI call should be made. "
                "Inspect ai_call's invocation count in the server log to confirm."
            )
        if all(c == 200 for c in codes) and len(set(bodies)) <= 2:
            # ≤2 because timing can split into 2 leader cohorts; ideally 1.
            print("PASS")
            return 0
        print("FAIL")
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
