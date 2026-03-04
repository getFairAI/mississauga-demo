#!/usr/bin/env python3
"""
Convert every .mp4 in the chunks directory (and subfolders) to .mp3 alongside the source.
Skips outputs that already exist. Requires ffmpeg on PATH.
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


def convert_file(src: Path) -> None:
    dest = src.with_suffix(".mp3")
    if dest.exists():
        print(f"[skip] {dest} already exists")
        return

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-vn",
        "-acodec",
        "mp3",
        str(dest),
    ]
    print(f"[run] {' '.join(cmd)}")
    subprocess.run(cmd, check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "chunks",
        help="Root directory to scan (default: ./chunks)",
    )
    args = parser.parse_args()

    if not args.root.exists():
        raise SystemExit(f"Root directory not found: {args.root}")

    mp4_files = sorted(args.root.rglob("*.mp4"))
    if not mp4_files:
        print("No .mp4 files found.")
        return

    for src in mp4_files:
        try:
            convert_file(src)
        except subprocess.CalledProcessError as exc:
            print(f"[error] ffmpeg failed for {src}: {exc}")


if __name__ == "__main__":
    main()
