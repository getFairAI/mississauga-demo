import asyncio
from pathlib import Path
from openai_transcribe import transcribe_large_file_chunked

async def run():
    text = await transcribe_large_file_chunked(Path("./chunks/budget_2026_01_12_09_30"))
    Path("./transcriptions/budget_2026_01_12_09_30.txt").write_text(text, encoding="utf-8")
    
    text = await transcribe_large_file_chunked(Path("./chunks/budget_2026_01_13_06_00"))
    Path("./transcriptions/budget_2026_01_13_06.txt").write_text(text, encoding="utf-8")
    
    text = await transcribe_large_file_chunked(Path("./chunks/budget_2026_01_13_09_30"))
    Path("./transcriptions/budget_2026_01_13_09_30.txt").write_text(text, encoding="utf-8")
    
    text = await transcribe_large_file_chunked(Path("./chunks/budget_2026_01_20_09_30"))
    Path("./transcriptions/budget_2026_01_20_09_30.txt").write_text(text, encoding="utf-8")
    
    text = await transcribe_large_file_chunked(Path("./chunks/combat_discrimination_2026_02_11_06_47"))
    Path("./transcriptions/combat_discrimination_2026_02_11_06_47.txt").write_text(text, encoding="utf-8")
    
    text = await transcribe_large_file_chunked(Path("./chunks/road_safety_comittee_01_27_09_30"))
    Path("./transcriptions/road_safety_comittee_01_27_09_30.txt").write_text(text, encoding="utf-8")

asyncio.run(run())
