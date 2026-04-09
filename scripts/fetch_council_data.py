"""
fetch_council_data.py
---------------------
Fetches Budget Committee and Road Safety Committee meeting agendas and minutes
from pub-mississauga.escribemeetings.com, downloads PDFs via the Playwright
browser session (so Cloudflare cookies are preserved), and links each meeting
to any matching .mp4 file in the project root.

Cloudflare note
---------------
Escribe is behind Cloudflare. The script opens a *visible* browser window and
waits for you to pass the CF challenge (usually auto-passes within ~5 s).
After that it runs automatically.

Usage
-----
    python scripts/fetch_council_data.py
    python scripts/fetch_council_data.py --year 2026
    python scripts/fetch_council_data.py --max-meetings 2   # quick test
    python scripts/fetch_council_data.py --no-download      # metadata only

Output
------
    data/raw/council_index.json    – meeting index with linked PDFs and MP4s
    data/raw/pdf_manifest.json     – flat list of every PDF with full metadata
    data/raw/<committee-slug>/     – downloaded PDFs organised by meeting date
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

# Committees to scrape from Escribe.
# Key   = exact name as it appears on the Escribe portal (used for filtering)
# Value = keywords to match against MP4 filenames
COMMITTEES: dict[str, list[str]] = {
    "Budget Committee": ["budget"],
    "Road Safety Committee": ["road", "road_safety"],
}

# MP4 files whose names contain any of these keywords are linked to the
# matching meeting even when they don't belong to a scraped committee
# (e.g. a standalone anti-discrimination recording).
EXTRA_MP4_KEYWORDS: dict[str, list[str]] = {
    "combat_discrimination": ["discrimination", "combat_discrimination"],
}

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
    """
    Return (date_iso, date_text) from a string containing a human date.
    date_iso is YYYY-MM-DD or "" if not found.
    """
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
    # Minutes variants — check before agenda to catch "agenda & minutes" edge case
    if any(kw in t for kw in ("minute", "approved minutes", "draft minutes",
                               "confirmed minutes", "meeting record")):
        return "minutes"
    # Agenda variants
    if any(kw in t for kw in ("agenda", "post-agenda", "post agenda",
                               "pre-agenda", "pre agenda", "consolidated agenda",
                               "order of business", "order paper",
                               "notice of meeting", "council agenda")):
        return "agenda"
    return "attachment"


# ---------------------------------------------------------------------------
# MP4 matching
# ---------------------------------------------------------------------------


def find_mp4s(root: Path, year: int) -> list[Path]:
    """Return .mp4 files in root whose name contains the given year."""
    return sorted(p for p in root.glob("*.mp4") if str(year) in p.stem)


def mp4_committee_keywords(committee: str) -> list[str]:
    return COMMITTEES.get(committee, [])


def match_mp4_to_meeting(mp4: Path, committee: str, date_iso: str) -> bool:
    """
    True when the MP4 belongs to this committee on this date.
    Matches committee keywords AND YYYY_MM_DD in filename.

    Uses whole-date patterns (e.g. 2026_01_20) rather than checking each
    component separately — avoids the false positive where day "20" matches
    inside the year string "2026".
    """
    name = mp4.stem.lower()

    # Date check: look for the full date as a unit with any separator
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

    # Committee keyword check
    keywords = mp4_committee_keywords(committee)
    return any(kw in name for kw in keywords)


def collect_unlinked_mp4s(all_mp4s: list[Path], linked: set[str]) -> list[dict]:
    """
    Return MP4s not linked to any meeting, annotated with their likely topic.
    """
    out = []
    for p in all_mp4s:
        rel = str(p.relative_to(ROOT_DIR))
        if rel in linked:
            continue
        name = p.stem.lower()
        topic = "unknown"
        for label, kws in EXTRA_MP4_KEYWORDS.items():
            if any(kw in name for kw in kws):
                topic = label
                break
        out.append({"file": rel, "topic": topic})
    return out


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
    # eSCRIBE has background polling — networkidle never fires, cap it.
    try:
        page.wait_for_load_state("networkidle", timeout=5_000)
    except Exception:
        pass
    return True


def _download_pdf(url: str, dest: Path, request_ctx) -> bool:
    """
    Download via Playwright's request context (shares CF+session cookies).
    Validates content-type to reject HTML error pages.
    """
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
        print(f"      → {dest.name}  ({len(body):,} bytes)")
        return True
    except Exception as exc:
        print(f"      [warn] {url}: {exc}", file=sys.stderr)
        return False


# ---------------------------------------------------------------------------
# Scraping
# ---------------------------------------------------------------------------


def scrape_committee_meetings(
    page,
    request_ctx,
    committee: str,
    year: int,
    max_meetings: int | None,
    download: bool,
    output_dir: Path,
    mp4s: list[Path],
    pdf_manifest: list[dict],
) -> list[dict]:
    """Scrape one committee; return list of meeting dicts."""

    listing_url = f"{ESCRIBE_BASE}/?Year={year}&Expanded={quote(committee)}"
    print(f"\n  Listing: {listing_url}")
    page.goto(listing_url, timeout=60_000, wait_until="domcontentloaded")
    _wait_for_page(page)

    # Collect meeting links — filter to this committee by title keyword
    committee_keywords = [w.lower() for w in committee.split()]
    anchors = page.query_selector_all("a[href*='Meeting.aspx']")
    seen: set[str] = set()
    meetings: list[dict] = []

    for a in anchors:
        href = a.get_attribute("href") or ""
        full_url = urljoin(ESCRIBE_BASE, href)
        if full_url in seen:
            continue
        seen.add(full_url)

        title = a.inner_text().strip()
        if not title:
            continue

        # Skip links that clearly belong to a different committee
        title_lower = title.lower()
        if not all(kw in title_lower for kw in committee_keywords):
            continue

        qs = parse_qs(urlparse(full_url).query)
        meeting_id = qs.get("Id", [None])[0]
        meetings.append({"id": meeting_id, "title": title, "listing_url": full_url})
        print(f"    {title[:72]}")

    print(f"  → {len(meetings)} meetings matched for '{committee}'")
    if max_meetings:
        meetings = meetings[:max_meetings]

    results: list[dict] = []
    committee_slug = slug(committee)

    for meeting in meetings:
        meeting_id = meeting["id"]
        title = meeting["title"]
        print(f"\n  ── {title[:65]}")

        # Views to check, in priority order:
        # &Agenda=Agenda  – standard agenda view
        # &Agenda=Merged  – merged / revised / post-agenda view (used by some committees)
        # (no Agenda param) – base meeting overview page (may list minutes separately)
        agenda_views = [
            ("Agenda", f"{ESCRIBE_BASE}/Meeting.aspx?Id={meeting_id}&Agenda=Agenda&lang=English"),
            ("Merged", f"{ESCRIBE_BASE}/Meeting.aspx?Id={meeting_id}&Agenda=Merged&lang=English"),
            ("Overview", f"{ESCRIBE_BASE}/Meeting.aspx?Id={meeting_id}&lang=English"),
        ]
        agenda_url = agenda_views[0][1]  # keep first for record

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

            # Parse date (only need to find it once)
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

            # Collect all filestream links from this view
            raw_links = page.query_selector_all("a[href*='filestream.ashx']")
            view_links: list[dict] = []
            for a in raw_links:
                href = a.get_attribute("href") or ""
                text = (a.inner_text().strip() or a.get_attribute("title") or "").strip()
                full = urljoin(ESCRIBE_BASE, href)
                view_links.append({"text": text, "url": full, "view": view_name})
            all_raw_links.extend(view_links)
            print(f"    [{view_name}] {len(view_links)} file links found"
                  + (f": {[l['text'] for l in view_links[:5]]}" if view_links else ""))

        # Skip if date is outside the target year
        if date_iso and not date_iso.startswith(str(year)):
            print(f"    [skip] date {date_iso} outside {year}")
            continue

        # Classify and dedup links across all views
        pdf_links: list[dict] = []
        for lnk in all_raw_links:
            pdf_links.append({
                "text": lnk["text"],
                "url": lnk["url"],
                "type": classify_pdf(lnk["text"]),
                "view": lnk["view"],
            })
        pdf_links = dedup_links(pdf_links)

        # Debug: show any links still falling through as "attachment"
        unclassified = [l for l in pdf_links if l["type"] == "attachment"]
        if unclassified:
            print(f"    [debug] attachment label texts: {[l['text'] for l in unclassified[:8]]}")

        by_type: dict[str, list[dict]] = {"agenda": [], "minutes": [], "attachment": []}
        for lnk in pdf_links:
            by_type[lnk["type"]].append(lnk)

        counts = {t: len(v) for t, v in by_type.items()}
        print(f"    date={date_iso or '?'}  {counts}")

        # Download PDFs; build per-file manifest entries
        saved: dict[str, list[str]] = {"agenda": [], "minutes": [], "attachment": []}

        if download:
            date_prefix = date_iso or "undated"
            for pdf_type, links in by_type.items():
                for i, lnk in enumerate(links):
                    name_slug = slug(lnk["text"]) or f"{pdf_type}_{i+1}"
                    filename = f"{date_prefix}_{name_slug}.pdf"
                    dest = output_dir / committee_slug / pdf_type / filename
                    ok = _download_pdf(lnk["url"], dest, request_ctx)
                    if ok:
                        rel_path = str(dest.relative_to(ROOT_DIR))
                        saved[pdf_type].append(rel_path)
                        # Add to flat manifest
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

        # Match MP4 files
        matched_mp4s = [
            str(p.relative_to(ROOT_DIR))
            for p in mp4s
            if match_mp4_to_meeting(p, committee, date_iso)
        ]

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
                "attachments": saved["attachment"],
            },
            "pdf_links": {
                "agenda": [l["url"] for l in by_type["agenda"]],
                "minutes": [l["url"] for l in by_type["minutes"]],
                "attachments": [l["url"] for l in by_type["attachment"]],
            },
            "mp4_files": matched_mp4s,
        })

        time.sleep(1)

    return results


def scrape_all(
    year: int,
    max_meetings: int | None,
    download: bool,
    output_dir: Path,
) -> tuple[list[dict], list[dict]]:
    """Return (meetings, pdf_manifest)."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright not installed: pip install playwright && playwright install chromium", file=sys.stderr)
        return [], []

    mp4s = find_mp4s(ROOT_DIR, year)
    print(f"\nFound {len(mp4s)} .mp4 files from {year} in {ROOT_DIR}:")
    for p in mp4s:
        print(f"  {p.name}")

    all_meetings: list[dict] = []
    pdf_manifest: list[dict] = []

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
        print("CF passed. Starting scrape...")

        for committee in COMMITTEES:
            print(f"\n{'─'*55}\nCommittee: {committee}")
            meetings = scrape_committee_meetings(
                page=page,
                request_ctx=context.request,
                committee=committee,
                year=year,
                max_meetings=max_meetings,
                download=download,
                output_dir=output_dir,
                mp4s=mp4s,
                pdf_manifest=pdf_manifest,
            )
            all_meetings.extend(meetings)

        browser.close()

    return all_meetings, pdf_manifest


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Fetch Budget Committee and Road Safety Committee agendas/minutes"
    )
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--max-meetings", type=int, default=None)
    parser.add_argument("--no-download", action="store_true", help="Skip PDF downloads")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)

    meetings, pdf_manifest = scrape_all(
        year=args.year,
        max_meetings=args.max_meetings,
        download=not args.no_download,
        output_dir=args.output.parent,
    )

    # Annotate any MP4s not matched to a meeting
    all_mp4s = find_mp4s(ROOT_DIR, args.year)
    linked_mp4s: set[str] = set(f for m in meetings for f in m.get("mp4_files", []))
    unlinked = collect_unlinked_mp4s(all_mp4s, linked_mp4s)

    index = {
        "generated": datetime.now().strftime("%Y-%m-%d"),
        "year": args.year,
        "committees": list(COMMITTEES.keys()),
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
    print(f"Index:    {args.output}")
    print(f"Manifest: {manifest_path}")
    print(f"Meetings: {len(meetings)}")
    for committee in COMMITTEES:
        ms = [m for m in meetings if m.get("committee") == committee]
        total_pdfs = sum(
            len(m["pdfs"]["agenda"]) + len(m["pdfs"]["minutes"]) + len(m["pdfs"]["attachments"])
            for m in ms if "pdfs" in m
        )
        total_mp4s = sum(len(m.get("mp4_files", [])) for m in ms)
        print(f"  {committee}: {len(ms)} meetings | {total_pdfs} PDFs | {total_mp4s} MP4s linked")
    if unlinked:
        print(f"Unlinked MP4s: {len(unlinked)}")
        for u in unlinked:
            print(f"  {u['file']}  [{u['topic']}]")


if __name__ == "__main__":
    main()
