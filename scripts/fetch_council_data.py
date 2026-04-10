"""
fetch_council_data.py
---------------------
Fetches all committee meetings from pub-mississauga.escribemeetings.com for a
given year: agendas, minutes, and video recordings only.

Committees are discovered dynamically from the portal — no hardcoded list.
Already-indexed meetings (by Escribe meeting ID) are skipped, so re-running
is safe and incremental.

Cloudflare note
---------------
Escribe is behind Cloudflare. The script opens a *visible* browser window and
waits for you to pass the CF challenge (usually auto-passes within ~5 s).
After that it runs automatically.

Usage
-----
    python scripts/fetch_council_data.py
    python scripts/fetch_council_data.py --year 2026
    python scripts/fetch_council_data.py --committee "Budget Committee"
    python scripts/fetch_council_data.py --max-meetings 2   # quick test
    python scripts/fetch_council_data.py --no-download      # metadata only
    python scripts/fetch_council_data.py --no-video         # skip video downloads
    python scripts/fetch_council_data.py --reset            # re-scrape everything

Output
------
    data/raw/council_index.json    – meeting index with linked PDFs and videos
    data/raw/pdf_manifest.json     – flat list of every PDF with full metadata
    data/raw/<committee-slug>/     – downloaded PDFs organised by meeting date
    data/raw/<committee-slug>/video/ – downloaded video recordings
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse, parse_qs, quote

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

ESCRIBE_BASE = "https://pub-mississauga.escribemeetings.com"

ROOT_DIR = Path(__file__).parent.parent
DEFAULT_OUTPUT = ROOT_DIR / "data" / "raw" / "council_index.json"
MANIFEST_OUTPUT = ROOT_DIR / "data" / "raw" / "pdf_manifest.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def slug(text: str) -> str:
    text = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"\s+", "_", text).strip("_")[:60]


def dedup_links(links: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out = []
    for lnk in links:
        if lnk["url"] not in seen:
            seen.add(lnk["url"])
            out.append(lnk)
    return out


def parse_date(text: str) -> tuple[str, str]:
    """Return (date_iso, date_text) from a string containing a human date."""
    m = re.search(
        r"\b(January|February|March|April|May|June|July|August|September|"
        r"October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
        r"[a-z]*\.?\s+\d{1,2},?\s+\d{4}",
        text,
        re.I,
    )
    if not m:
        return "", ""
    date_text = m.group(0)
    normalized = re.sub(r"[,.]", "", date_text)
    for fmt in ("%B %d %Y", "%b %d %Y"):
        try:
            return datetime.strptime(normalized, fmt).strftime("%Y-%m-%d"), date_text
        except ValueError:
            continue
    return "", date_text


def classify_pdf(text: str) -> str:
    """Return 'minutes', 'agenda', or 'attachment' based on link text."""
    t = text.lower()
    if any(kw in t for kw in ("minute", "approved minutes", "draft minutes",
                               "confirmed minutes", "meeting record")):
        return "minutes"
    if any(kw in t for kw in ("agenda", "post-agenda", "post agenda",
                               "pre-agenda", "pre agenda", "consolidated agenda",
                               "order of business", "order paper",
                               "notice of meeting", "council agenda")):
        return "agenda"
    return "attachment"


def extract_committee_from_title(title: str) -> str:
    """
    Strip the date portion from a meeting title to get the committee name.
    e.g. "Budget Committee - January 12, 2026" → "Budget Committee"
    """
    cleaned = re.sub(
        r"\s*[-–]\s*(January|February|March|April|May|June|July|August|"
        r"September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|"
        r"Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}.*$",
        "",
        title,
        flags=re.I,
    ).strip()
    # Also strip trailing standalone year / time tokens
    cleaned = re.sub(r"\s*\d{4}\s*$", "", cleaned).strip()
    return cleaned or title


# ---------------------------------------------------------------------------
# MP4 matching (for existing local files)
# ---------------------------------------------------------------------------


def find_mp4s(root: Path, year: int) -> list[Path]:
    """Return .mp4 files in root whose name contains the given year."""
    return sorted(p for p in root.glob("*.mp4") if str(year) in p.stem)


def match_mp4_to_meeting(mp4: Path, committee: str, date_iso: str) -> bool:
    """
    True when the MP4 belongs to this committee on this date.
    Uses full-date patterns to avoid substring false-positives (e.g. day 20
    matching inside year 2026).
    """
    name = mp4.stem.lower()

    if date_iso:
        parts = date_iso.split("-")
        if len(parts) == 3:
            yyyy, mm, dd = parts
            date_patterns = [
                f"{yyyy}_{mm}_{dd}",
                f"{yyyy}{mm}{dd}",
                f"{yyyy}-{mm}-{dd}",
                f"{yyyy}.{mm}.{dd}",
            ]
            if not any(pat in name for pat in date_patterns):
                return False

    committee_slug_kw = slug(committee).split("_")
    return any(kw in name for kw in committee_slug_kw if len(kw) > 3)


def collect_unlinked_mp4s(all_mp4s: list[Path], linked: set[str]) -> list[dict]:
    """Return MP4s not linked to any meeting."""
    return [
        {"file": str(p.relative_to(ROOT_DIR)), "topic": "unknown"}
        for p in all_mp4s
        if str(p.relative_to(ROOT_DIR)) not in linked
    ]


# ---------------------------------------------------------------------------
# Playwright helpers
# ---------------------------------------------------------------------------


def _wait_for_page(page, timeout_s: int = 120) -> bool:
    """Wait past Cloudflare; returns True once a real Escribe page is loaded."""
    try:
        page.wait_for_selector(
            "a[href*='Meeting.aspx'], select#ddlYear, "
            "#ctl00_ContentPlaceHolder1, "
            "a[href*='filestream.ashx'], "
            "a[href*='Agenda=']",
            timeout=timeout_s * 1000,
        )
    except Exception:
        try:
            title = page.title().lower()
            if "just a moment" in title or "attention required" in title:
                print("  [CF] Still on challenge page", file=sys.stderr)
                return False
        except Exception:
            pass
    try:
        page.wait_for_load_state("networkidle", timeout=5_000)
    except Exception:
        pass
    return True


def _download_file(url: str, dest: Path, request_ctx, label: str = "file") -> bool:
    """
    Download via Playwright's request context (shares CF+session cookies).
    Skips if file already exists. Validates content-type to reject HTML errors.
    """
    if dest.exists():
        print(f"      [skip] already exists: {dest.name}")
        return True

    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        resp = request_ctx.get(url)
        if not resp.ok:
            print(f"      [warn] HTTP {resp.status}: {url}", file=sys.stderr)
            return False
        ct = resp.headers.get("content-type", "")
        if "html" in ct:
            print(f"      [warn] Got HTML (session expired?): {url}", file=sys.stderr)
            return False
        body = resp.body()
        with open(dest, "wb") as f:
            f.write(body)
        print(f"      → {dest.name}  ({len(body):,} bytes)  [{label}]")
        return True
    except Exception as exc:
        print(f"      [warn] {url}: {exc}", file=sys.stderr)
        return False


# ---------------------------------------------------------------------------
# Video discovery and download
# ---------------------------------------------------------------------------

# File extensions that indicate an actual video file
_VIDEO_EXTENSIONS = (".mp4", ".webm", ".m3u8", ".avi", ".mov", ".mkv", ".flv", ".wmv")

# Domains that host video content (for iframe / anchor matching)
_VIDEO_HOSTS = (
    "youtube.com", "youtu.be", "vimeo.com",
    "granicus.com", "civicplus.com", "peakdemocracy.com",
    "mediasite.com", "brightcove.com", "kaltura.com",
)


def _intercept_video_stream(page, view_url: str) -> list[dict]:
    """
    Navigate to a page and capture real video stream URLs by intercepting
    network requests as the video player initialises.

    blob: URLs are browser-internal object URLs — they cannot be fetched
    outside the browser and are intentionally ignored here.

    Returns list of {url, type} dicts for captured stream URLs.
    """
    # Patterns that indicate an actual streamable video resource
    _STREAM_EXTS = (".m3u8", ".mpd", ".mp4", ".webm", ".ts", ".m4v", ".m4s")
    _STREAM_KWS = ("manifest", "playlist.m3u8", "/video/", "/stream/", "/media/", "videoplayback")

    captured: list[dict] = []
    seen: set[str] = set()

    def on_request(request):
        url = request.url
        if url.startswith("blob:") or url.startswith("data:"):
            return
        url_lower = url.lower().split("?")[0]
        if any(url_lower.endswith(ext) for ext in _STREAM_EXTS) or \
                any(kw in url.lower() for kw in _STREAM_KWS):
            if url not in seen:
                seen.add(url)
                vtype = "youtube" if ("youtube.com" in url or "youtu.be" in url) else "direct"
                captured.append({"url": url, "type": vtype})

    page.on("request", on_request)
    try:
        page.goto(view_url, timeout=30_000, wait_until="domcontentloaded")
        # Give JS video player time to initialise and start requesting the stream
        page.wait_for_timeout(6_000)
    except Exception:
        pass
    page.remove_listener("request", on_request)
    return captured


def _find_video_links(page, meeting_id: str) -> list[dict]:
    """
    Discover video recordings for a meeting using two strategies:

    1. DOM inspection — iframes / anchors pointing to known video hosts or
       files with video extensions. blob: URLs are skipped (browser-internal).
    2. Network interception — load the Video view and capture stream requests
       (.m3u8 / .mpd / .mp4) emitted by the JS video player.

    IMPORTANT: filestream.ashx links are ALWAYS documents (PDFs).
    They are never video files and are excluded unconditionally.

    Returns list of {url, text, type} dicts:
      'direct'   – HLS/DASH/MP4 stream, downloadable via yt-dlp or requests
      'youtube'  – YouTube link (use yt-dlp)
      'external' – other video platform (record URL only)
    """
    found: list[dict] = []
    seen: set[str] = set()

    views = [
        f"{ESCRIBE_BASE}/Meeting.aspx?Id={meeting_id}&lang=English",
        f"{ESCRIBE_BASE}/Meeting.aspx?Id={meeting_id}&Agenda=Video&lang=English",
    ]

    for view_url in views:
        # ── Strategy 1: DOM inspection ─────────────────────────────────
        try:
            page.goto(view_url, timeout=30_000, wait_until="domcontentloaded")
            try:
                page.wait_for_load_state("networkidle", timeout=5_000)
            except Exception:
                pass
        except Exception:
            continue

        # <iframe> pointing to a known video host
        for iframe in page.query_selector_all("iframe[src]"):
            src = iframe.get_attribute("src") or ""
            if not src or src.startswith("blob:") or src in seen:
                continue
            if any(host in src for host in _VIDEO_HOSTS):
                seen.add(src)
                vtype = "youtube" if ("youtube.com" in src or "youtu.be" in src) else "external"
                found.append({"url": src, "text": "embedded player", "type": vtype})

        # <a> links to video files or known video platforms
        # Exclude filestream.ashx (always documents) and Meeting.aspx nav
        for a in page.query_selector_all("a[href]"):
            href = a.get_attribute("href") or ""
            if not href or href.startswith("#") or href.startswith("blob:") or \
                    "javascript" in href.lower() or "filestream.ashx" in href or \
                    "Meeting.aspx" in href:
                continue
            text = (a.inner_text().strip() or a.get_attribute("title") or "").strip()
            full = href if href.startswith("http") else urljoin(ESCRIBE_BASE, href)
            url_path = full.lower().split("?")[0]

            is_video_ext = any(url_path.endswith(ext) for ext in _VIDEO_EXTENSIONS)
            is_video_host = any(host in full for host in _VIDEO_HOSTS)
            is_watch_text = any(kw in text.lower() for kw in (
                "watch meeting", "view recording", "view video", "video recording", "watch recording",
            ))

            if (is_video_ext or is_video_host or is_watch_text) and full not in seen:
                seen.add(full)
                if is_video_ext:
                    vtype = "direct"
                elif "youtube.com" in full or "youtu.be" in full:
                    vtype = "youtube"
                else:
                    vtype = "external"
                found.append({"url": full, "text": text or full, "type": vtype})

    # ── Strategy 2: Network interception on the Video view ─────────────
    # Do this last; it involves a 6 s wait so only run for the Video view.
    video_view = f"{ESCRIBE_BASE}/Meeting.aspx?Id={meeting_id}&Agenda=Video&lang=English"
    stream_hits = _intercept_video_stream(page, video_view)
    for hit in stream_hits:
        if hit["url"] not in seen:
            seen.add(hit["url"])
            found.append({"url": hit["url"], "text": "intercepted stream", "type": hit["type"]})
            print(f"      [intercept] {hit['type']}: {hit['url'][:100]}")

    return found


def _download_video(vl: dict, dest_dir: Path, date_prefix: str, context) -> str | None:
    """
    Download or record a video link. Returns relative path string or None.

    - 'direct'   → stream download via requests + Playwright cookies
    - 'youtube'  → download via yt-dlp if installed, else record URL only
    - 'external' → record URL only (streaming services need auth / JS players)
    """
    url = vl["url"]
    vtype = vl["type"]
    text = vl.get("text", "recording")

    if vtype == "external":
        print(f"      [external] recording URL (manual download): {url}")
        return None

    if vtype == "youtube":
        try:
            import yt_dlp  # type: ignore
        except ImportError:
            print(f"      [youtube] yt-dlp not installed — recording URL only: {url}")
            return None

        dest_dir.mkdir(parents=True, exist_ok=True)
        name_slug = slug(text) or "recording"
        out_tmpl = str(dest_dir / f"{date_prefix}_{name_slug}.%(ext)s")
        # Check if any file with this prefix already exists
        existing = list(dest_dir.glob(f"{date_prefix}_{name_slug}.*"))
        if existing:
            print(f"      [skip] already exists: {existing[0].name}")
            return str(existing[0].relative_to(ROOT_DIR))
        try:
            ydl_opts = {
                "outtmpl": out_tmpl,
                "quiet": True,
                "no_warnings": True,
                "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                filename = ydl.prepare_filename(info)
            print(f"      → {Path(filename).name} [yt-dlp]")
            return str(Path(filename).relative_to(ROOT_DIR))
        except Exception as exc:
            print(f"      [warn] yt-dlp failed: {exc}", file=sys.stderr)
            return None

    # vtype == "direct" — HLS (.m3u8), DASH (.mpd), or plain .mp4
    # yt-dlp handles all of these and manages segmented streams correctly.
    name_slug = slug(text) or "recording"
    url_path = url.lower().split("?")[0]
    is_hls_dash = url_path.endswith(".m3u8") or url_path.endswith(".mpd")

    dest_dir.mkdir(parents=True, exist_ok=True)
    existing = list(dest_dir.glob(f"{date_prefix}_{name_slug}.*"))
    if existing:
        print(f"      [skip] already exists: {existing[0].name}")
        return str(existing[0].relative_to(ROOT_DIR))

    # Prefer yt-dlp for HLS/DASH (it handles segmented streams and retries)
    try:
        import yt_dlp  # type: ignore
        out_tmpl = str(dest_dir / f"{date_prefix}_{name_slug}.%(ext)s")
        ydl_opts = {
            "outtmpl": out_tmpl,
            "quiet": True,
            "no_warnings": True,
            "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info)
        print(f"      → {Path(filename).name} [yt-dlp]")
        return str(Path(filename).relative_to(ROOT_DIR))
    except ImportError:
        if is_hls_dash:
            print("      [warn] yt-dlp not installed — HLS/DASH streams require it: pip install yt-dlp", file=sys.stderr)
            return None
        # Fall through to plain HTTP streaming for direct .mp4
    except Exception as exc:
        print(f"      [warn] yt-dlp failed ({exc}) — trying plain HTTP", file=sys.stderr)

    # Plain HTTP streaming fallback for direct .mp4 files
    ext = next((e for e in _VIDEO_EXTENSIONS if url_path.endswith(e)), ".mp4")
    dest = dest_dir / f"{date_prefix}_{name_slug}{ext}"
    try:
        import requests as _requests
        pw_cookies = context.cookies()
        session = _requests.Session()
        for c in pw_cookies:
            session.cookies.set(c["name"], c["value"], domain=c.get("domain", ""))
        session.headers.update(HEADERS)

        with session.get(url, stream=True, timeout=60) as r:
            r.raise_for_status()
            ct = r.headers.get("content-type", "")
            if "html" in ct:
                print("      [warn] Got HTML for video URL — needs browser auth", file=sys.stderr)
                return None
            total = 0
            with open(dest, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    f.write(chunk)
                    total += len(chunk)
        print(f"      → {dest.name} ({total:,} bytes) [http stream]")
        return str(dest.relative_to(ROOT_DIR))
    except ImportError:
        print("      [warn] requests not installed — pip install requests", file=sys.stderr)
        return None
    except Exception as exc:
        print(f"      [warn] video download failed: {exc}", file=sys.stderr)
        if dest.exists():
            dest.unlink()
        return None


# ---------------------------------------------------------------------------
# Committee discovery
# ---------------------------------------------------------------------------


def discover_committees(page, year: int, filter_names: list[str] | None = None) -> list[str]:
    """
    Discover all committee names from the year listing page.
    Returns a sorted, deduplicated list of committee names.
    If filter_names is given, only those committees are returned.
    """
    listing_url = f"{ESCRIBE_BASE}/?Year={year}"
    print(f"\n  Discovering committees from: {listing_url}")
    page.goto(listing_url, timeout=60_000, wait_until="domcontentloaded")
    _wait_for_page(page)

    anchors = page.query_selector_all("a[href*='Meeting.aspx']")
    committees: dict[str, int] = {}
    for a in anchors:
        title = a.inner_text().strip()
        if not title:
            continue
        committee = extract_committee_from_title(title)
        if committee:
            committees[committee] = committees.get(committee, 0) + 1

    found = sorted(committees.keys())
    print(f"  Found {len(found)} committee(s):")
    for c in found:
        print(f"    {c}  ({committees[c]} meetings)")

    if filter_names:
        filter_lower = [f.lower() for f in filter_names]
        found = [c for c in found if any(f in c.lower() for f in filter_lower)]
        print(f"  → Filtered to: {found}")

    return found


# ---------------------------------------------------------------------------
# Index helpers
# ---------------------------------------------------------------------------


def _load_existing_index(output_path: Path) -> tuple[set[str], list[dict], list[dict]]:
    """
    Load existing council_index.json and pdf_manifest.json.
    Returns (seen_meeting_ids, existing_meetings, existing_manifest).
    """
    existing_meetings: list[dict] = []
    existing_manifest: list[dict] = []
    seen_ids: set[str] = set()

    if output_path.exists():
        try:
            data = json.loads(output_path.read_text())
            existing_meetings = data.get("meetings", [])
            seen_ids = {m["id"] for m in existing_meetings if m.get("id")}
        except Exception:
            pass

    manifest_path = output_path.parent / "pdf_manifest.json"
    if manifest_path.exists():
        try:
            existing_manifest = json.loads(manifest_path.read_text())
        except Exception:
            pass

    return seen_ids, existing_meetings, existing_manifest


# ---------------------------------------------------------------------------
# Scraping
# ---------------------------------------------------------------------------


def scrape_committee_meetings(
    page,
    request_ctx,
    browser_context,
    committee: str,
    year: int,
    max_meetings: int | None,
    download: bool,
    download_video: bool,
    output_dir: Path,
    mp4s: list[Path],
    pdf_manifest: list[dict],
    skip_ids: set[str],
) -> list[dict]:
    """Scrape one committee; return list of new meeting dicts."""

    listing_url = f"{ESCRIBE_BASE}/?Year={year}&Expanded={quote(committee)}"
    print(f"\n  Listing: {listing_url}")
    page.goto(listing_url, timeout=60_000, wait_until="domcontentloaded")
    _wait_for_page(page)

    # Collect meeting links for this committee
    committee_keywords = [w.lower() for w in committee.split() if len(w) > 2]
    anchors = page.query_selector_all("a[href*='Meeting.aspx']")
    seen_urls: set[str] = set()
    meetings: list[dict] = []

    for a in anchors:
        href = a.get_attribute("href") or ""
        full_url = urljoin(ESCRIBE_BASE, href)
        if full_url in seen_urls:
            continue
        seen_urls.add(full_url)

        title = a.inner_text().strip()
        if not title:
            continue

        title_lower = title.lower()
        if not all(kw in title_lower for kw in committee_keywords):
            continue

        qs = parse_qs(urlparse(full_url).query)
        meeting_id = qs.get("Id", [None])[0]

        if meeting_id in skip_ids:
            print(f"    [skip] already indexed: {title[:60]}")
            continue

        meetings.append({"id": meeting_id, "title": title, "listing_url": full_url})
        print(f"    {title[:72]}")

    print(f"  → {len(meetings)} new meeting(s) to process for '{committee}'")
    if max_meetings:
        meetings = meetings[:max_meetings]

    results: list[dict] = []
    committee_slug = slug(committee)

    for meeting in meetings:
        meeting_id = meeting["id"]
        title = meeting["title"]
        print(f"\n  ── {title[:65]}")

        # ── PDF views ─────────────────────────────────────────────────────
        agenda_views = [
            ("Agenda",   f"{ESCRIBE_BASE}/Meeting.aspx?Id={meeting_id}&Agenda=Agenda&lang=English"),
            ("Merged",   f"{ESCRIBE_BASE}/Meeting.aspx?Id={meeting_id}&Agenda=Merged&lang=English"),
            ("Overview", f"{ESCRIBE_BASE}/Meeting.aspx?Id={meeting_id}&lang=English"),
        ]
        agenda_url = agenda_views[0][1]

        all_raw_links: list[dict] = []
        date_iso, date_text = "", ""

        for view_name, view_url in agenda_views:
            try:
                page.goto(view_url, timeout=60_000, wait_until="domcontentloaded")
                try:
                    page.wait_for_load_state("networkidle", timeout=5_000)
                except Exception:
                    pass
            except Exception as exc:
                print(f"    [warn] {view_name}: Failed to load: {exc}", file=sys.stderr)
                continue

            if not date_iso:
                for sel in ["h1", "h2", ".pageTitle", ".headerTitle", "title"]:
                    try:
                        el = page.query_selector(sel)
                        if el:
                            date_iso, date_text = parse_date(el.inner_text())
                            if date_iso:
                                break
                    except Exception:
                        pass

            raw_links = page.query_selector_all("a[href*='filestream.ashx']")
            view_links: list[dict] = []
            for a in raw_links:
                href = a.get_attribute("href") or ""
                text = (a.inner_text().strip() or a.get_attribute("title") or "").strip()
                full = urljoin(ESCRIBE_BASE, href)
                view_links.append({"text": text, "url": full, "view": view_name})
            all_raw_links.extend(view_links)
            print(f"    [{view_name}] {len(view_links)} file link(s)"
                  + (f": {[l['text'] for l in view_links[:5]]}" if view_links else ""))

        # Skip meetings outside the target year
        if date_iso and not date_iso.startswith(str(year)):
            print(f"    [skip] date {date_iso} outside {year}")
            continue

        # Classify and dedup — agenda and minutes only, attachments discarded
        pdf_links: list[dict] = []
        for lnk in dedup_links(all_raw_links):
            doc_type = classify_pdf(lnk["text"])
            if doc_type in ("agenda", "minutes"):
                pdf_links.append({"text": lnk["text"], "url": lnk["url"], "type": doc_type})

        by_type: dict[str, list[dict]] = {"agenda": [], "minutes": []}
        for lnk in pdf_links:
            by_type[lnk["type"]].append(lnk)

        print(f"    date={date_iso or '?'}  agenda={len(by_type['agenda'])}  minutes={len(by_type['minutes'])}")

        # ── Download agenda + minutes PDFs only ───────────────────────────
        saved: dict[str, list[str]] = {"agenda": [], "minutes": []}

        if download:
            date_prefix = date_iso or "undated"
            for pdf_type, links in by_type.items():
                for i, lnk in enumerate(links):
                    name_slug = slug(lnk["text"]) or f"{pdf_type}_{i+1}"
                    filename = f"{date_prefix}_{name_slug}.pdf"
                    dest = output_dir / committee_slug / pdf_type / filename
                    ok = _download_file(lnk["url"], dest, request_ctx, label=pdf_type)
                    if ok and dest.stat().st_size > 0:
                        rel_path = str(dest.relative_to(ROOT_DIR))
                        if rel_path not in [e["file"] for e in pdf_manifest]:
                            saved[pdf_type].append(rel_path)
                            pdf_manifest.append({
                                "file": rel_path,
                                "meeting_id": meeting_id,
                                "meeting_title": title,
                                "committee": committee,
                                "date": date_iso,
                                "type": pdf_type,
                                "document_title": lnk["text"],
                                "source_url": lnk["url"],
                            })

        # ── Find and download videos ───────────────────────────────────────
        video_files: list[str] = []
        video_links: list[dict] = []

        if download_video:
            print(f"    Looking for video recordings...")
            video_links = _find_video_links(page, meeting_id)
            if video_links:
                print(f"    Found {len(video_links)} video link(s):")
                for vl in video_links:
                    print(f"      [{vl['type']}] {vl['text'][:60]}  {vl['url'][:80]}")
            else:
                print(f"    No video recordings found")

            video_dir = output_dir / committee_slug / "video"
            date_prefix = date_iso or "undated"
            for vl in video_links:
                rel = _download_video(vl, video_dir, date_prefix, browser_context)
                if rel:
                    video_files.append(rel)
                elif vl["type"] in ("youtube", "external"):
                    # Record the URL even if we can't download
                    video_files.append(vl["url"])

        # ── Match existing local MP4s ──────────────────────────────────────
        matched_mp4s = [
            str(p.relative_to(ROOT_DIR))
            for p in mp4s
            if match_mp4_to_meeting(p, committee, date_iso)
        ]
        # Merge downloaded videos with pre-existing local mp4s
        all_videos = list(dict.fromkeys(video_files + matched_mp4s))

        results.append({
            "id": meeting_id,
            "committee": committee,
            "title": title,
            "date": date_iso,
            "date_text": date_text,
            "agenda_url": agenda_url,
            "pdfs": {
                "agenda": saved["agenda"],
                "minutes": saved["minutes"],
            },
            "pdf_links": {
                "agenda": [l["url"] for l in by_type["agenda"]],
                "minutes": [l["url"] for l in by_type["minutes"]],
            },
            "video_links": [v["url"] for v in video_links],
            "mp4_files": all_videos,
        })

        time.sleep(1)

    return results


def scrape_all(
    year: int,
    max_meetings: int | None,
    download: bool,
    download_video: bool,
    output_dir: Path,
    committee_filter: list[str] | None,
    reset: bool,
) -> tuple[list[dict], list[dict]]:
    """Return (all_meetings, pdf_manifest) — merging new results with existing index."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright not installed: pip install playwright && playwright install chromium", file=sys.stderr)
        return [], []

    # Load existing index (for skip logic)
    if reset:
        skip_ids: set[str] = set()
        existing_meetings: list[dict] = []
        existing_manifest: list[dict] = []
    else:
        skip_ids, existing_meetings, existing_manifest = _load_existing_index(output_dir / "council_index.json")
        print(f"\nExisting index: {len(existing_meetings)} meetings already indexed (will skip)")

    mp4s = find_mp4s(ROOT_DIR, year)
    print(f"\nFound {len(mp4s)} local .mp4 file(s) from {year}:")
    for p in mp4s:
        print(f"  {p.name}")

    new_meetings: list[dict] = []
    new_manifest_entries: list[dict] = list(existing_manifest)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)
        context = browser.new_context(
            extra_http_headers=HEADERS,
            ignore_https_errors=True,
        )
        page = context.new_page()

        print(f"\n>>> Browser opening. Solve CF check if prompted. <<<")
        page.goto(f"{ESCRIBE_BASE}/?Year={year}", timeout=60_000, wait_until="domcontentloaded")
        _wait_for_page(page)
        print("CF passed. Starting scrape...\n")

        committees = discover_committees(page, year, filter_names=committee_filter)

        for committee in committees:
            print(f"\n{'─'*55}\nCommittee: {committee}")
            meetings = scrape_committee_meetings(
                page=page,
                request_ctx=context.request,
                browser_context=context,
                committee=committee,
                year=year,
                max_meetings=max_meetings,
                download=download,
                download_video=download_video,
                output_dir=output_dir,
                mp4s=mp4s,
                pdf_manifest=new_manifest_entries,
                skip_ids=skip_ids,
            )
            new_meetings.extend(meetings)

        browser.close()

    all_meetings = existing_meetings + new_meetings
    return all_meetings, new_manifest_entries


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Fetch all committee agendas, minutes, and videos from Escribe"
    )
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--max-meetings", type=int, default=None,
                        help="Limit new meetings per committee (for testing)")
    parser.add_argument("--committee", action="append", dest="committees", metavar="NAME",
                        help="Only scrape this committee (can repeat). Default: all.")
    parser.add_argument("--no-download", action="store_true", help="Skip all file downloads")
    parser.add_argument("--no-video", action="store_true", help="Skip video downloads")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--reset", action="store_true",
                        help="Ignore existing index and re-scrape everything")
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)

    meetings, pdf_manifest = scrape_all(
        year=args.year,
        max_meetings=args.max_meetings,
        download=not args.no_download,
        download_video=not args.no_video and not args.no_download,
        output_dir=args.output.parent,
        committee_filter=args.committees,
        reset=args.reset,
    )

    # Annotate local MP4s not linked to any meeting
    all_mp4s = find_mp4s(ROOT_DIR, args.year)
    linked_mp4s: set[str] = set(f for m in meetings for f in m.get("mp4_files", []))
    unlinked = collect_unlinked_mp4s(all_mp4s, linked_mp4s)

    committees_found = sorted({m.get("committee", "") for m in meetings if m.get("committee")})
    index = {
        "generated": datetime.now().strftime("%Y-%m-%d"),
        "year": args.year,
        "committees": committees_found,
        "meetings": meetings,
        "unlinked_mp4s": unlinked,
    }

    with open(args.output, "w") as f:
        json.dump(index, f, indent=2)

    manifest_path = args.output.parent / "pdf_manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(pdf_manifest, f, indent=2)

    # Summary
    print(f"\n{'─'*55}")
    print(f"Index:    {args.output}  ({len(meetings)} total meetings)")
    print(f"Manifest: {manifest_path}  ({len(pdf_manifest)} PDFs)")
    for committee in committees_found:
        ms = [m for m in meetings if m.get("committee") == committee]
        total_pdfs = sum(
            len(m["pdfs"]["agenda"]) + len(m["pdfs"]["minutes"])
            for m in ms if "pdfs" in m
        )
        total_vids = sum(len(m.get("mp4_files", [])) for m in ms)
        print(f"  {committee}: {len(ms)} meetings | {total_pdfs} PDFs | {total_vids} video(s)")
    if unlinked:
        print(f"Unlinked local MP4s: {len(unlinked)}")
        for u in unlinked:
            print(f"  {u['file']}")


if __name__ == "__main__":
    main()
