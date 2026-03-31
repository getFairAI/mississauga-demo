import { useState, useRef, useEffect } from "react";
import { navigate } from "../App";
import { feedItems } from "../data/mockData";

// Sort feed items newest-first by date
const parseDate = (d: string) => new Date(d).getTime();
const sortedFeedItems = [...feedItems].sort((a, b) => parseDate(b.date) - parseDate(a.date));

const SUGGESTIONS = [
  "When have councillors mentioned institutional memory or forgetting things?",
  "What has council said about transit funding?",
  "How has the stormwater issue evolved over time?",
  "What are the main arguments for and against school bus cameras?",
];

const HomePage = () => {
  const [searchValue, setSearchValue] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);

  // When overlay opens, focus the overlay input and sync value
  useEffect(() => {
    if (searchExpanded && overlayInputRef.current) {
      overlayInputRef.current.focus();
    }
  }, [searchExpanded]);

  const handleSearch = (query?: string) => {
    const q = query || searchValue.trim();
    if (!q) return;
    setSearchExpanded(false);
    navigate(`/chat?q=${encodeURIComponent(q)}`);
  };

  const handleEscape = () => {
    setSearchExpanded(false);
    setSearchValue("");
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--msga-bg)" }}>
      {/* Header */}
      <header className="msga-header">
        <a
          href="#/"
          className="msga-header-logo"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="4" fill="white" fillOpacity="0.2" />
            <path d="M6 8h12M6 12h12M6 16h8" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          MISSISSAUGA
        </a>
        <div className="msga-header-subtitle" style={{ color: "white", fontSize: "0.85rem", fontWeight: 600, letterSpacing: "0.3px" }}>
          Civic Deliberative Memory
        </div>
      </header>

      {/* Nav */}
      <nav className="msga-nav">
        <a
          href="#/"
          className="msga-nav-item"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          &larr; mississauga.ca
        </a>
        <div className="msga-nav-item active">Home</div>
      </nav>

      {/* Search area — resting state */}
      <div className="home-search-wrapper">
        <p className="home-search-description">
          Civic Deliberative Memory surfaces the issues your council is working
          on, tracks how they evolve over time, and invites structured public
          input.
        </p>
        <input
          ref={searchInputRef}
          className="home-search-input"
          type="text"
          placeholder="Ask any question about council meetings..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onFocus={() => setSearchExpanded(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSearch();
            }
          }}
        />
        <div
          style={{
            fontSize: "0.75rem",
            color: "#999",
            marginTop: "0.5rem",
          }}
        >
          Press Enter to search across all council transcripts
        </div>
      </div>

      {/* Search overlay — expanded state (fills viewport) */}
      {searchExpanded && (
        <div
          className="search-overlay"
          onClick={(e) => {
            // Close if clicking the backdrop (not the input/suggestions)
            if (e.target === e.currentTarget) handleEscape();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") handleEscape();
          }}
        >
          <input
            ref={overlayInputRef}
            className="search-overlay-input"
            type="text"
            placeholder="Ask any question about council meetings..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSearch();
              }
              if (e.key === "Escape") handleEscape();
            }}
          />
          <div className="search-overlay-hint">
            Press Enter to search &middot; Escape to close
          </div>

          {/* Suggestions */}
          <div className="search-overlay-suggestions">
            <h4>Try asking</h4>
            {SUGGESTIONS.map((s) => (
              <div
                key={s}
                className="search-overlay-suggestion"
                onClick={() => {
                  setSearchValue(s);
                  handleSearch(s);
                }}
              >
                {s}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feed */}
      <div className="feed-container">
        {sortedFeedItems.map((item) => (
          <article key={item.id} className="feed-item">
            {/* Committee + date */}
            <div style={{ display: "flex", alignItems: "center" }}>
              <span className="feed-item-committee">
                {item.committee.name}
              </span>
              <span className="feed-item-date">{item.date}</span>
            </div>

            {/* Headline */}
            <h2
              className="feed-item-headline"
              onClick={() => navigate(`/topic/${item.id}`)}
            >
              {item.headline}
            </h2>

            {/* Brief */}
            <p className="feed-item-brief">{item.brief}</p>

            {/* Deliberative question */}
            {item.deliberativeQuestion && (
              <div
                className="feed-item-question"
                onClick={() => navigate(`/topic/${item.id}`)}
              >
                {item.deliberativeQuestion}
              </div>
            )}

            {/* Key quotes */}
            {item.keyQuotes?.slice(0, 1).map((kq, idx) => (
              <div key={idx} className="feed-item-quote">
                <div className="feed-item-quote-speaker">
                  {kq.speaker}
                  {kq.role ? `, ${kq.role}` : ""}
                </div>
                <div className="feed-item-quote-text">"{kq.quote}"</div>
              </div>
            ))}

            {/* Audio button (decorative) */}
            {item.hasAudio && (
              <button className="feed-item-audio-btn">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="6.5" stroke="currentColor" />
                  <path d="M5.5 4.5L9.5 7L5.5 9.5V4.5Z" fill="currentColor" />
                </svg>
                Listen to excerpt
              </button>
            )}
          </article>
        ))}
      </div>

      {/* Footer */}
      <footer className="msga-footer">
        <div className="msga-container">
          <div className="msga-footer-divider" style={{ marginTop: 0 }} />
          <div className="msga-footer-bottom">
            <div>&copy; City of Mississauga 2019–2026 &middot; Powered by Louie</div>
            <div>
              <a href="#">Privacy and terms</a>
              <a href="#">Accessibility</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default HomePage;
