"""
Split a video into ~15-minute segments with forced keyframes so each segment is decodable.

Usage:
    python scripts/split_video.py /path/to/video.mp4 --segment-seconds 900 --out-dir chunks
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


def split_video(
    source: Path,
    out_dir: Path,
    segment_seconds: int = 450,
) -> None:
    if not source.exists():
        raise FileNotFoundError(f"Source not found: {source}")
    # Create a subfolder under out_dir named after the video (without extension)
    video_stem = source.stem
    target_dir = out_dir / video_stem
    target_dir.mkdir(parents=True, exist_ok=True)
    pattern = target_dir / "part_%03d.mp4"

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(source),
        "-map",
        "0",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-force_key_frames",
        f"expr:gte(t,n_forced*{segment_seconds})",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-f",
        "segment",
        "-segment_time",
        str(segment_seconds),
        "-reset_timestamps",
        "1",
        str(pattern),
    ]

    subprocess.run(cmd, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path, help="Input video path")
    parser.add_argument("--segment-seconds", type=int, default=450, help="Segment length in seconds")
    parser.add_argument("--out-dir", type=Path, default=Path("chunks"), help="Output directory for segments")
    args = parser.parse_args()

    split_video(args.video, args.out_dir, segment_seconds=args.segment_seconds)


if __name__ == "__main__":
    main()
