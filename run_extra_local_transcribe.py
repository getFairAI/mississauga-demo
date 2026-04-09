"""
run_extra_local_transcribe.py
-----------------------------
Enhanced transcription pipeline:

  Pass 1 – Transcription
    Attempts to transcribe each MP4 as a single file (no chunking).
    Falls back to the existing chunked path on OOM or any failure.

  Pass 2 – Speaker name resolution
    Loads agenda / minutes PDFs linked to the meeting via council_index.json,
    extracts text, and uses an LLM to replace generic SPEAKER_XX labels with
    real names from the meeting documents.

Usage
-----
    python run_extra_local_transcribe.py
    python run_extra_local_transcribe.py --device cpu
    python run_extra_local_transcribe.py --no-speaker-pass
    python run_extra_local_transcribe.py --job road_safety_comittee_2026_03_24

Output
------
    transcriptions/<name>.txt            raw diarized transcript (SPEAKER_XX)
    transcriptions/<name>_named.txt      speaker labels resolved to real names
    transcriptions/<name>_speakers.json  SPEAKER_XX → real name mapping
"""

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).parent
CHUNKS = ROOT / "chunks"
TRANSCRIPTIONS = ROOT / "transcriptions"
COUNCIL_INDEX = ROOT / "data" / "raw" / "council_index.json"

# Jobs: (mp4_stem, chunks_fallback_stem, output_stem)
# mp4_stem must match a file in ROOT/<name>.mp4
JOBS = [
    "budget_2026_01_12_09_30",
    "budget_2026_01_13_06_00",
    "budget_2026_01_13_09_30",
    "budget_2026_01_20_09_30",
    "combat_discrimination_2026_02_11_06_47",
    "road_safety_comittee_2026_01_27_09_30",
    "road_safety_comittee_2026_03_24",
]

# Lines sampled from start + middle of transcript for speaker identification.
SPEAKER_SAMPLE_LINES = 200


# ---------------------------------------------------------------------------
# PDF text extraction
# ---------------------------------------------------------------------------


def extract_pdf_text(pdf_path: Path, max_chars: int = 8000) -> str:
    """Extract plain text from a PDF. Tries pdfplumber, falls back to pypdf."""
    try:
        import pdfplumber
        with pdfplumber.open(pdf_path) as pdf:
            pages = [p.extract_text() or "" for p in pdf.pages]
        return "\n".join(pages)[:max_chars]
    except ImportError:
        pass
    try:
        from pypdf import PdfReader  # type: ignore[import-untyped]
        reader = PdfReader(str(pdf_path))
        pages = [p.extract_text() or "" for p in reader.pages]
        return "\n".join(pages)[:max_chars]
    except ImportError:
        pass
    print(f"  [warn] No PDF library available (install pdfplumber or pypdf). Skipping {pdf_path.name}")
    return ""


def load_meeting_context(job_name: str) -> str:
    """
    Find the meeting that has this MP4 linked in council_index.json,
    then extract and concatenate text from its agenda + minutes PDFs.
    Returns empty string if index not found or no PDFs matched.
    """
    if not COUNCIL_INDEX.exists():
        print(f"  [warn] {COUNCIL_INDEX} not found — run fetch_council_data.py first")
        return ""

    index = json.loads(COUNCIL_INDEX.read_text())

    # Derive date and committee from the job name — more reliable than
    # trusting the mp4_files associations in the index (which can be wrong).
    # Job name format: budget_2026_01_12_09_30 / road_safety_comittee_2026_03_24
    date_m = re.search(r"(\d{4})[_-](\d{2})[_-](\d{2})", job_name)
    date_iso = f"{date_m.group(1)}-{date_m.group(2)}-{date_m.group(3)}" if date_m else ""

    name_lower = job_name.lower()
    if "budget" in name_lower:
        committee_kw = "budget"
    elif "road" in name_lower:
        committee_kw = "road"
    elif "discrimination" in name_lower:
        committee_kw = "discrimination"
    else:
        committee_kw = ""

    matched_meeting = None
    for meeting in index.get("meetings", []):
        date_ok = (not date_iso) or meeting.get("date", "") == date_iso
        comm_ok = (not committee_kw) or committee_kw in meeting.get("committee", "").lower()
        if date_ok and comm_ok:
            matched_meeting = meeting
            break

    if not matched_meeting:
        print(f"  [warn] No meeting matched date={date_iso} committee_kw={committee_kw!r}")
        return ""

    committee = matched_meeting.get("committee", "")
    date = matched_meeting.get("date", "")
    title = matched_meeting.get("title", "")
    print(f"  Matched meeting: {title} ({date})")

    pdfs = matched_meeting.get("pdfs", {})
    # Only use minutes + agenda — they contain attendee lists.
    # Attachments (e.g. budget presentations) contain no names and confuse the LLM.
    attendee_pdf_paths = pdfs.get("minutes", []) + pdfs.get("agenda", [])

    if not attendee_pdf_paths:
        print("  [info] No minutes/agenda PDFs linked — speaker pass will rely on announcement patterns only")
        return ""

    # Limit to 2 000 chars per doc — attendee/cover info is always near the top.
    sections = [f"Meeting: {title}\nDate: {date}\nCommittee: {committee}\n"]
    for rel_path in attendee_pdf_paths:
        pdf_path = ROOT / rel_path
        if not pdf_path.exists():
            continue
        text = extract_pdf_text(pdf_path, max_chars=2_000)
        if text.strip():
            sections.append(f"\n--- {pdf_path.name} ---\n{text}")

    if len(sections) == 1:
        print("  [warn] No PDF text could be extracted")
        return ""

    return "\n".join(sections)


# ---------------------------------------------------------------------------
# Speaker identification (LLM second pass)
# ---------------------------------------------------------------------------


# Phrases the chair uses to yield the floor to someone.
_ANNOUNCEMENT_PATTERNS = re.compile(
    r"\b(I(?:'d| would) (?:like to |now )?(?:recognize|invite|call upon|turn it over to|welcome|ask|introduce)|"
    r"next (?:we(?:'ll| will) hear from|up is|is)|"
    r"the floor (?:goes |is )?to|"
    r"(?:thank you[,.]?\s+)?(?:please |)?(?:go ahead[,.]?\s+)?(?:Councillor|Councilor|Mr\.|Ms\.|Mrs\.|Dr\.|Deputy|Chair|Director|Sergeant|Officer|Staff)\b)",
    re.IGNORECASE,
)

# A line looks like: [0.00–3.24] SPEAKER_XX: text
_LINE_RE = re.compile(r"^\[[\d.]+[–-][\d.]+\]\s+(SPEAKER_\d+):\s+(.*)$")


def _parse_lines(raw: str) -> list[tuple[str, str, str]]:
    """Parse transcript into list of (speaker, text, full_line)."""
    result = []
    for line in raw.splitlines():
        line = line.strip()
        m = _LINE_RE.match(line)
        if m:
            result.append((m.group(1), m.group(2), line))
    return result


def extract_announcement_lines(raw: str, max_blocks: int = 60) -> str:
    """
    Find lines where a speaker announces/introduces the next speaker,
    and return them as annotated blocks:

        [announcement]  SPEAKER_00: I'd like to recognize Councillor Smith...
        [next speaker]  SPEAKER_01: Thank you Chair, I wanted to raise...

    These blocks give the LLM direct evidence for mapping SPEAKER_XX → name.
    """
    parsed = _parse_lines(raw)
    blocks: list[str] = []

    for i, (spk, text, line) in enumerate(parsed):
        if not _ANNOUNCEMENT_PATTERNS.search(text):
            continue
        # Grab this line plus up to 2 following lines as "response"
        block_lines = [f"  [announces] {line}"]
        for j in range(i + 1, min(i + 3, len(parsed))):
            block_lines.append(f"  [responds]  {parsed[j][2]}")
        blocks.append("\n".join(block_lines))
        if len(blocks) >= max_blocks:
            break

    return "\n\n".join(blocks)


def _build_opening_sample(parsed: list[tuple[str, str, str]], n: int) -> str:
    """First n lines of the transcript — captures roll call and opening remarks."""
    return "\n".join(line for _, _, line in parsed[:n])


def _build_mid_sample(parsed: list[tuple[str, str, str]], n: int) -> str:
    """n lines from the middle — catches latecomers and transitions."""
    mid = max(0, len(parsed) // 2 - n // 2)
    return "\n".join(line for _, _, line in parsed[mid: mid + n])


def extract_attendees(context: str) -> str:
    """
    Ask the LLM to extract a structured attendee list from the PDF context.
    Returns a plain-text summary of who was at the meeting.
    """
    from ai_utils import ai_call

    prompt = (
        "You are reading agenda and/or minutes documents for a City of Mississauga "
        "committee meeting. Extract a list of all named people at this meeting:\n"
        "- Chair / presiding officer\n"
        "- Committee members / councillors (with any titles)\n"
        "- City staff in attendance (with their roles)\n"
        "- Named presenters or delegates\n\n"
        "Format the output as a plain list, one person per line, e.g.:\n"
        "  Chair: Jane Smith\n"
        "  Member: Councillor John Doe\n"
        "  Staff: Monica Ruffolo, Legislative Coordinator\n\n"
        "If a name appears multiple times, list it once. "
        "Do not invent names that are not in the documents.\n\n"
        f"DOCUMENTS:\n{context}"
    )
    return ai_call([{"role": "user", "content": prompt}], temperature=0.0)


def build_speaker_mapping(raw_transcript: str, attendees: str) -> dict[str, str]:
    """
    Ask the LLM to map SPEAKER_XX labels to real names.
    Returns a dict like {"SPEAKER_00": "Chair Jane Smith", ...}.

    Evidence provided to the LLM (in order of reliability):
      1. Attendee list from agenda/minutes PDFs
      2. Chair-announcement blocks — the chair names the next speaker before
         they talk, giving direct SPEAKER_XX → name evidence
      3. Opening lines — roll call, chair opening, first remarks
      4. Mid-meeting sample — catches latecomers and transitions
    """
    from ai_utils import ai_call

    parsed = _parse_lines(raw_transcript)
    half = SPEAKER_SAMPLE_LINES // 2

    opening = _build_opening_sample(parsed, half)
    mid = _build_mid_sample(parsed, half)
    announcements = extract_announcement_lines(raw_transcript)

    ann_section = (
        f"CHAIR ANNOUNCEMENTS (most reliable — chair names next speaker before they talk):\n"
        f"{announcements}\n\n"
        if announcements.strip()
        else ""
    )

    prompt = (
        "You are resolving speaker labels in an automatically diarized transcript "
        "of a City of Mississauga committee meeting.\n\n"

        "The transcript uses labels like SPEAKER_00, SPEAKER_01, etc. "
        "Your job is to identify which real person each label corresponds to.\n\n"

        "## Key pattern — chair announcements\n"
        "In this meeting, the chairperson ALWAYS announces the next speaker by name "
        "before yielding the floor. This means:\n"
        "  - If SPEAKER_XX says '...I'd like to recognize Councillor Smith...' and\n"
        "    the very next line is SPEAKER_YY speaking, then SPEAKER_YY = Councillor Smith.\n"
        "  - If SPEAKER_XX says 'Thank you. Next, Monica Ruffolo will present...' and\n"
        "    the next line is SPEAKER_ZZ, then SPEAKER_ZZ = Monica Ruffolo.\n"
        "Apply this logic to every announcement block below.\n\n"

        "## Additional signals\n"
        "- The chair typically opens the meeting ('I call this meeting to order').\n"
        "- Speakers often say 'Thank you, Chair' or address the chair by name, "
        "  which confirms the chair's SPEAKER label.\n"
        "- Speakers may introduce themselves ('My name is...', 'I'm the coordinator...').\n"
        "- The attendee list from the meeting documents lists everyone who was present.\n\n"

        "## Output format\n"
        "Return ONLY a valid JSON object mapping every SPEAKER label found in the "
        "transcript to a real name (or keep the label if unknown):\n"
        '{"SPEAKER_00": "Chair Jane Smith", "SPEAKER_01": "Councillor John Doe", '
        '"SPEAKER_02": "Monica Ruffolo", "SPEAKER_03": "SPEAKER_03"}\n\n'

        "Do not include any text outside the JSON.\n\n"

        f"ATTENDEES (from meeting agenda/minutes):\n{attendees}\n\n"
        f"{ann_section}"
        f"OPENING LINES (first {half} lines — roll call, opening remarks):\n{opening}\n\n"
        f"MID-MEETING SAMPLE (lines ~{len(parsed)//2}–{len(parsed)//2 + half}):\n{mid}"
    )

    raw = ai_call([{"role": "user", "content": prompt}], temperature=0.0, json_mode=True)
    try:
        mapping = json.loads(raw)
        return {k: v for k, v in mapping.items() if re.match(r"SPEAKER_\d+", k)}
    except (json.JSONDecodeError, AttributeError):
        print("  [warn] LLM returned invalid JSON for speaker mapping")
        return {}


def apply_speaker_mapping(raw: str, mapping: dict[str, str]) -> str:
    """Replace all SPEAKER_XX tokens in the transcript with resolved names."""
    if not mapping:
        return raw

    def replace(m):
        label = m.group(0)
        return mapping.get(label, label)

    pattern = re.compile(r"SPEAKER_\d+")
    return pattern.sub(replace, raw)


def run_speaker_pass(job_name: str, raw_transcript: str) -> tuple[str, dict]:
    """
    Full speaker identification pipeline for one job.
    Returns (named_transcript, speaker_mapping).
    """
    print(f"\n  [speaker-pass] Loading meeting context for '{job_name}'...")
    context = load_meeting_context(job_name)

    if context.strip():
        print("  [speaker-pass] Extracting attendee list from documents...")
        attendees = extract_attendees(context)
        print(f"  [speaker-pass] Attendees:\n{attendees}\n")
    else:
        print("  [speaker-pass] No document context — relying on transcript announcement patterns only")
        attendees = ""

    print("  [speaker-pass] Building speaker mapping...")
    mapping = build_speaker_mapping(raw_transcript, attendees)

    if mapping:
        print("  [speaker-pass] Speaker mapping:")
        for k, v in sorted(mapping.items()):
            print(f"    {k} → {v}")
    else:
        print("  [speaker-pass] Could not build mapping")

    named = apply_speaker_mapping(raw_transcript, mapping)
    return named, mapping


# ---------------------------------------------------------------------------
# Transcription (pass 1)
# ---------------------------------------------------------------------------


async def _transcribe_full(mp4_path: Path, device: str) -> str:
    """Transcribe the full MP4 in one shot with WhisperX (no chunking)."""
    from whisperx_transcribe import transcribe_with_whisperx
    return await asyncio.to_thread(transcribe_with_whisperx, mp4_path, device)


async def transcribe_chunked(job_name: str) -> str:
    """
    Transcribe via pre-split chunks in ./chunks/<job_name>/.
    Saves individual part transcripts to transcriptions/<job_name>_part_*.txt
    and a naive (0-based) joined file to transcriptions/<job_name>.txt.
    Call join_and_fix_timestamps() afterwards to correct offsets.
    """
    chunks_path = CHUNKS / job_name
    if not chunks_path.exists():
        raise FileNotFoundError(
            f"No chunks at {chunks_path} — run scripts/split_video.py first."
        )
    from whisperx_transcribe import transcribe_large_file_chunked
    return await transcribe_large_file_chunked(chunks_path)


async def transcribe_full_with_fallback(job_name: str, device: str) -> str:
    """
    Try full-file transcription; fall back to chunked on OOM or any failure.
    Returns the raw transcript text (timestamps not yet corrected for chunked path).
    """
    mp4_path = ROOT / f"{job_name}.mp4"
    if mp4_path.exists():
        print(f"  Attempting full-file transcription of {mp4_path.name}...")
        try:
            text = await _transcribe_full(mp4_path, device)
            print(f"  Full transcription succeeded ({len(text):,} chars)")
            return text
        except Exception as exc:
            msg = str(exc)
            if "out of memory" in msg.lower() or "cuda" in msg.lower():
                print("  [OOM] GPU out of memory — falling back to chunks")
            else:
                print(f"  [warn] Full failed ({exc}) — falling back to chunks")
    else:
        print(f"  MP4 not found at {mp4_path} — going straight to chunks")

    return await transcribe_chunked(job_name)


# ---------------------------------------------------------------------------
# Timestamp join (between pass 1 and pass 2)
# ---------------------------------------------------------------------------


def join_and_fix_timestamps(job_name: str, gap: float = 0.0) -> str | None:
    """
    Find the per-chunk transcript files (<job_name>_part_*.txt), apply
    cumulative time offsets so timestamps are continuous, and overwrite
    transcriptions/<job_name>.txt with the corrected joined text.

    Returns the fixed text, or None if no part files were found (e.g. the
    job was transcribed as a single file with no chunking).
    """
    import sys as _sys
    scripts_dir = str(ROOT / "scripts")
    if scripts_dir not in _sys.path:
        _sys.path.insert(0, scripts_dir)
    from scripts.fix_transcript_timestamps import find_part_files, rebuild_from_parts

    final_path = TRANSCRIPTIONS / f"{job_name}.txt"
    parts = find_part_files(final_path)

    if not parts:
        print("  [join] No part files found — treating as single-file transcript (timestamps unchanged)")
        return None

    print(f"  [join] Fixing timestamps across {len(parts)} chunk(s)...")
    fixed_lines, total_duration = rebuild_from_parts(parts, gap=gap)
    fixed_text = "\n".join(fixed_lines) + "\n"

    final_path.write_text(fixed_text, encoding="utf-8")
    print(f"  [join] {len(fixed_lines)} lines  |  ~{total_duration / 60:.1f} min total duration")
    return fixed_text


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def run(jobs: list[str], device: str, speaker_pass: bool, try_full: bool):
    TRANSCRIPTIONS.mkdir(parents=True, exist_ok=True)

    for job_name in jobs:
        raw_out = TRANSCRIPTIONS / f"{job_name}.txt"
        named_out = TRANSCRIPTIONS / f"{job_name}_named.txt"
        mapping_out = TRANSCRIPTIONS / f"{job_name}_speakers.json"

        print(f"\n{'─'*60}")
        print(f"Job: {job_name}")

        # ── Pass 1: transcription ─────────────────────────────────────
        if raw_out.exists():
            print(f"  [skip] Raw transcript exists: {raw_out.name}")
            raw_text = raw_out.read_text(encoding="utf-8")
        else:
            if try_full:
                print("  Mode: full-file (fallback to chunked on failure)")
                raw_text = await transcribe_full_with_fallback(job_name, device)
            else:
                print("  Mode: chunked")
                raw_text = await transcribe_chunked(job_name)

            # ── Join & fix timestamps (chunked path only) ─────────────
            # Each chunk starts at 0s; rebuild_from_parts applies cumulative
            # offsets so the joined transcript has continuous wall-clock times.
            fixed = join_and_fix_timestamps(job_name)
            if fixed is not None:
                raw_text = fixed  # file already overwritten by join step

            # For full-file path (no parts) we still need to write the file.
            if not raw_out.exists():
                raw_out.write_text(raw_text, encoding="utf-8")

            print(f"  Saved raw transcript → {raw_out.name}")

        # ── Pass 2: speaker name resolution ──────────────────────────
        if not speaker_pass:
            continue

        if named_out.exists() and mapping_out.exists():
            print(f"  [skip] Named transcript exists: {named_out.name}")
            continue

        named_text, mapping = run_speaker_pass(job_name, raw_text)

        named_out.write_text(named_text, encoding="utf-8")
        mapping_out.write_text(json.dumps(mapping, indent=2), encoding="utf-8")
        print(f"  Saved named transcript → {named_out.name}")
        print(f"  Saved speaker mapping  → {mapping_out.name}")


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Transcribe meeting recordings and resolve speaker names.\n"
            "Default: chunked transcription (most reliable on GPU with limited VRAM).\n"
            "Use --full to attempt single-pass transcription first."
        )
    )
    parser.add_argument(
        "--device",
        default="cuda",
        help="WhisperX device: cuda (default) or cpu",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Attempt full-file transcription first; fall back to chunked on failure",
    )
    parser.add_argument(
        "--no-speaker-pass",
        action="store_true",
        help="Skip the LLM speaker name resolution step",
    )
    parser.add_argument(
        "--job",
        action="append",
        dest="jobs",
        metavar="JOB_NAME",
        help="Run only this job (can repeat). Default: all jobs.",
    )
    args = parser.parse_args()

    jobs = args.jobs if args.jobs else JOBS
    unknown = [j for j in jobs if j not in JOBS]
    if unknown:
        print(f"Unknown jobs: {unknown}", file=sys.stderr)
        print(f"Valid jobs: {JOBS}", file=sys.stderr)
        sys.exit(1)

    asyncio.run(run(jobs, args.device, not args.no_speaker_pass, args.full))


if __name__ == "__main__":
    main()
