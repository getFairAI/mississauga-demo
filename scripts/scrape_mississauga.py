from playwright.sync_api import sync_playwright
from urllib.parse import urljoin
LISTING = "https://pub-mississauga.escribemeetings.com/?Year=2026&Expanded=Budget%20Committee"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)  # headful to pass human check
    page = browser.new_page()
    page.goto(LISTING, wait_until="networkidle")
    # Optional: wait a couple seconds in case of challenge
    anchors = page.query_selector_all("a[href]")
    urls = [urljoin(LISTING, a.get_attribute("href")) for a in anchors]
    meeting_urls = [u for u in urls if "Meeting.aspx" in u]
    video_urls = []
    for m in meeting_urls[:10]:
        page.goto(m, wait_until="networkidle")
        vids = [
            urljoin(m, a.get_attribute("href"))
            for a in page.query_selector_all("a[href]")
            if a.inner_text().lower().find("video") >= 0
            or ".mp4" in a.get_attribute("href").lower()
            or "m3u8" in a.get_attribute("href").lower()
        ]
        video_urls += vids
    browser.close()
    for u in dict.fromkeys(video_urls):
        print(u)
