import asyncio
from pathlib import Path
from dotenv import load_dotenv
from ai_utils import transcribe_chunks

load_dotenv()

CHUNKS = Path("./chunks")
TRANSCRIPTIONS = Path("./transcriptions")


async def run():
    jobs = [
        ("budget_2026_01_12_09_30",                  "budget_2026_01_12_09_30"),
        ("budget_2026_01_13_06_00",                  "budget_2026_01_13_06"),
        ("budget_2026_01_13_09_30",                  "budget_2026_01_13_09_30"),
        ("budget_2026_01_20_09_30",                  "budget_2026_01_20_09_30"),
        ("combat_discrimination_2026_02_11_06_47",   "combat_discrimination_2026_02_11_06_47"),
        ("road_safety_comittee_2026_01_27_09_30",         "road_safety_comittee_2026_01_27_09_30"),
        ("road_safety_comittee_2026_03_24",          "road_safety_comittee_2026_03_24"),
    ]

    TRANSCRIPTIONS.mkdir(parents=True, exist_ok=True)

    for chunks_name, output_name in jobs:
        chunks_path = CHUNKS / chunks_name
        output_path = TRANSCRIPTIONS / f"{output_name}.txt"

        if output_path.exists():
            print(f"[skip] {output_name} already transcribed")
            continue

        print(f"[start] {chunks_name}")
        text = await transcribe_chunks(chunks_path)
        output_path.write_text(text, encoding="utf-8")
        print(f"[done]  {output_name}.txt ({len(text)} chars)")


asyncio.run(run())
