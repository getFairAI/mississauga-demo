# summarize_call.py
import sys
from pathlib import Path
from ai_utils import ai_call


def generate_summary(
    transcript_text: str,
    chunk_index: int | None = None,
    total_chunks: int | None = None,
    prior_summary: str | None = None,
) -> str:
    """Generate a structured summary from a transcript chunk."""
    position_note = (
        f"You are summarizing chunk {chunk_index} of {total_chunks} from a longer transcript."
        if chunk_index is not None and total_chunks is not None
        else "You are summarizing a single chunk or the full transcript."
    )

    system_msg = (
        "You are an assistant specialized in analyzing and summarizing call transcripts.\n"
        "Goal: produce a clear, structured, comprehensive summary while avoiding repetition across chunks.\n\n"
        "When prior_summary is provided, TREAT IT AS THE CURRENT BEST SUMMARY so far.\n"
        "- Update it with NEW facts from this chunk.\n"
        "- Do not repeat points already covered unless you add NEW details or corrections.\n"
        "- Remove or correct items if this chunk shows they were wrong.\n"
        "- Keep the result concise and readable (aim for 8-14 bullet-style lines or short paragraphs).\n"
        "- Preserve: participants, main topics, decisions, action items, dates/amounts, problems/solutions, commitments.\n"
        "- Never invent facts; only use information from prior_summary or this chunk.\n"
        "- Write in clear, professional international business English.\n"
    )

    user_msg = (
        f"{position_note}\n\n"
        "Prior summary (may be empty):\n"
        f"{prior_summary or '[none]'}\n\n"
        "Current chunk transcript:\n"
        f"{transcript_text}\n\n"
        "Return the UPDATED overall summary (not just the chunk)."
    )

    return ai_call(
        messages=[
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.2,
    )


def consolidate_summaries(chunk_summaries: list[str]) -> str:
    """Merge independent per-chunk summaries into one comprehensive summary."""
    combined = "\n\n---\n\n".join(
        f"Section {i + 1}:\n{s}" for i, s in enumerate(chunk_summaries)
    )
    system_msg = (
        "You are given summaries from different sections of a single meeting transcript.\n"
        "Merge them into ONE comprehensive, non-repetitive summary.\n"
        "- Keep all unique facts, decisions, action items, participants, dates, and amounts.\n"
        "- Remove exact or near-duplicate points; combine related items into single statements.\n"
        "- Organize by theme (not by section order).\n"
        "- Aim for 10-16 concise bullet points or short paragraphs.\n"
        "- Write in clear, professional English.\n"
        "- Do NOT add information not present in the input summaries.\n"
    )
    return ai_call(
        messages=[
            {"role": "system", "content": system_msg},
            {"role": "user", "content": f"Section summaries to consolidate:\n\n{combined}"},
        ],
        temperature=0.2,
    )


def main():
    if len(sys.argv) < 2:
        print("Usage: python summarize_call.py path/to/transcript.txt")
        sys.exit(1)

    transcript_path = Path(sys.argv[1]).resolve()
    if not transcript_path.exists():
        print(f"File not found: {transcript_path}")
        sys.exit(1)

    transcript_text = transcript_path.read_text(encoding="utf-8")

    print(f"[INFO] Generating summary for: {transcript_path}")
    summary = generate_summary(transcript_text)

    summary_path = transcript_path.with_name(f"{transcript_path.stem}_summary.txt")
    summary_path.write_text(summary, encoding="utf-8")

    print(f"[OK] Summary written to: {summary_path}")


if __name__ == "__main__":
    main()
