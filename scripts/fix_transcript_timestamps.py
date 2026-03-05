"""Repair non-sequential timestamps in concatenated transcript files.

Usage examples:
    # Produce transcriptions/budget_2026_01_20_09_30_fixed.txt
    python3 scripts/fix_transcript_timestamps.py transcriptions/budget_2026_01_20_09_30.txt

    # Rewrite the input file in-place and assume a 0.5s gap between chunks
    python3 scripts/fix_transcript_timestamps.py transcriptions/budget_2026_01_20_09_30.txt --in-place --gap 0.5

How it works:
    - If per-chunk transcript files like `<stem>_part_000.txt` exist in the same
      folder, they are used to rebuild the final transcript with cumulative
      offsets (most accurate).
    - If no part files are found, it falls back to detecting large backwards
      jumps and adds offsets to keep timestamps monotonic.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple

EN_DASH = "\u2013"
TIME_RE = re.compile(
    rf"\[(?P<start>\d+(?:\.\d+)?)\s*[{EN_DASH}-]\s*(?P<end>\d+(?:\.\d+)?)\]\s*(?P<speaker>[^:]+):\s*(?P<text>.*)$"
)


@dataclass
class Line:
    start: float
    end: float
    speaker: str
    text: str

    def with_offset(self, offset: float) -> "Line":
        return Line(self.start + offset, self.end + offset, self.speaker, self.text)

    def format(self) -> str:
        return f"[{self.start:.2f}{EN_DASH}{self.end:.2f}] {self.speaker}: {self.text}".strip()


def parse_transcript(path: Path) -> List[Line]:
    lines: List[Line] = []
    for idx, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw.strip():
            continue
        match = TIME_RE.match(raw.strip())
        if not match:
            raise ValueError(f"{path}:{idx}: line not in '[start–end] Speaker: text' format")
        lines.append(
            Line(
                start=float(match.group("start")),
                end=float(match.group("end")),
                speaker=match.group("speaker").strip(),
                text=match.group("text").strip(),
            )
        )
    return lines


def part_sort_key(path: Path) -> Tuple[int, int]:
    """Extract numeric part indices so parts sort correctly."""

    m = re.search(r"_part_(\d+)(?:_(\d+))?", path.stem)
    if not m:
        return (0, 0)
    primary = int(m.group(1))
    secondary = int(m.group(2)) if m.group(2) else 0
    return (primary, secondary)


def rebuild_from_parts(parts: Sequence[Path], gap: float = 0.0) -> Tuple[List[str], float]:
    """Combine part transcripts with cumulative offsets."""

    combined: List[str] = []
    offset = 0.0
    for part in parts:
        part_lines = parse_transcript(part)
        adjusted = [line.with_offset(offset) for line in part_lines]
        combined.extend(line.format() for line in adjusted)
        if adjusted:
            offset = adjusted[-1].end + gap
    return combined, offset


def fix_monotonic(lines: Sequence[Line], jump_threshold: float, gap: float) -> List[str]:
    """Make timestamps non-decreasing by inserting offsets when a big backwards jump is detected."""

    fixed: List[str] = []
    offset = 0.0
    prev_end: float | None = None
    jumps = 0

    for line in lines:
        adj = line.with_offset(offset)
        if prev_end is not None and adj.start < prev_end - jump_threshold:
            jumps += 1
            offset += (prev_end - adj.start) + gap
            adj = line.with_offset(offset)
        fixed.append(adj.format())
        prev_end = adj.end

    if jumps:
        print(f"Applied {jumps} offset block(s) using jump_threshold={jump_threshold}s, gap={gap}s")
    else:
        print("No backward jumps detected; file was already monotonic.")
    return fixed


def find_part_files(base_path: Path) -> List[Path]:
    stem = base_path.stem.split("_part_")[0]
    pattern = f"{stem}_part_*.txt"
    return sorted(base_path.parent.glob(pattern), key=part_sort_key)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("final_file", type=Path, help="Path to the full transcript to repair")
    parser.add_argument("--output", type=Path, help="Where to write the fixed transcript. Default: <stem>_fixed.txt")
    parser.add_argument("--in-place", action="store_true", help="Overwrite the input file instead of writing a new one")
    parser.add_argument("--gap", type=float, default=0.0, help="Seconds to insert between detected chunks (default: 0)")
    parser.add_argument(
        "--jump-threshold",
        type=float,
        default=20.0,
        help="Minimum backward jump (seconds) that triggers a new offset when no part files are present",
    )
    parser.add_argument("--force-fallback", action="store_true", help="Ignore part files and use jump-detection mode")
    args = parser.parse_args()

    final_path = args.final_file
    if not final_path.exists():
        raise SystemExit(f"File not found: {final_path}")

    output_path = final_path if args.in_place else args.output or final_path.with_name(f"{final_path.stem}_fixed.txt")

    parts: List[Path] = []
    if not args.force_fallback:
        parts = [p for p in find_part_files(final_path) if p != final_path and p.exists()]

    if parts:
        print(f"Rebuilding using {len(parts)} part file(s): {[p.name for p in parts]}")
        fixed_lines, _ = rebuild_from_parts(parts, gap=args.gap)
    else:
        print("No part files found; using jump-detection fallback.")
        fixed_lines = fix_monotonic(parse_transcript(final_path), args.jump_threshold, args.gap)

    output_path.write_text("\n".join(fixed_lines) + "\n", encoding="utf-8")
    print(f"Wrote fixed transcript to {output_path}")


if __name__ == "__main__":
    main()
