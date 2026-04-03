import { useState, useEffect, useRef } from "react";
import { navigate } from "../App";
import { streamTranscriptPages, sliceAudioByTranscript, type TranscriptLine } from "../api";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const TranscriptPage = ({ transcriptId }: { transcriptId: string }) => {
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [totalLines, setTotalLines] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audioUrls, setAudioUrls] = useState<Record<number, string>>({});
  const [loadingAudio, setLoadingAudio] = useState<Record<number, boolean>>({});
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setLines([]);
    setTotalLines(null);
    setTitle("");
    setLoading(true);
    setError(null);
    setAudioUrls({});

    const controller = new AbortController();
    abortRef.current = controller;

    streamTranscriptPages(transcriptId, 100, {
      signal: controller.signal,
      onPage: (page) => {
        if (!title && page.title) setTitle(page.title);
        setTotalLines(page.total_lines);
        setLines((prev) => [...prev, ...page.lines]);
      },
    })
      .then(() => setLoading(false))
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setError("Failed to load transcript.");
        setLoading(false);
      });

    return () => controller.abort();
  }, [transcriptId]);

  const handlePlay = async (line: TranscriptLine) => {
    if (audioUrls[line.index]) return; // already loaded
    setLoadingAudio((prev) => ({ ...prev, [line.index]: true }));
    try {
      const { url } = await sliceAudioByTranscript({
        transcript_id: transcriptId,
        start: line.start,
        end: line.end,
      });
      setAudioUrls((prev) => ({ ...prev, [line.index]: url }));
    } finally {
      setLoadingAudio((prev) => ({ ...prev, [line.index]: false }));
    }
  };

  const progress = totalLines ? Math.round((lines.length / totalLines) * 100) : 0;

  return (
    <div style={{ minHeight: "100vh", background: "var(--msga-bg)" }}>
      {/* Header */}
      <header className="msga-header">
        <a href="#/" className="msga-header-logo" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
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
          href={`#/topic/${transcriptId}`}
          className="msga-nav-item"
          onClick={(e) => { e.preventDefault(); navigate(`/topic/${transcriptId}`); }}
        >
          ← Topic
        </a>
        <div className="msga-nav-item active">Transcript</div>
      </nav>

      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "1.5rem 1rem 4rem" }}>
        {/* Title + progress */}
        <h1 className="topic-title" style={{ marginBottom: "0.25rem" }}>
          {title || transcriptId}
        </h1>

        {loading && totalLines !== null && (
          <div style={{ marginBottom: "1.25rem" }}>
            <div style={{ fontSize: "0.75rem", color: "#999", marginBottom: "0.35rem" }}>
              Loading… {lines.length} / {totalLines} lines ({progress}%)
            </div>
            <div style={{ height: "3px", background: "var(--msga-border)", borderRadius: "2px" }}>
              <div style={{ height: "100%", width: `${progress}%`, background: "var(--msga-blue)", borderRadius: "2px", transition: "width 0.3s" }} />
            </div>
          </div>
        )}

        {loading && totalLines === null && (
          <div style={{ color: "#bbb", fontSize: "0.85rem", marginBottom: "1rem" }}>Loading transcript…</div>
        )}

        {error && (
          <div style={{ color: "#c00", marginBottom: "1rem", fontSize: "0.9rem" }}>{error}</div>
        )}

        {/* Transcript lines */}
        <div style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
          {lines.map((line) => (
            <div
              key={line.index}
              style={{
                display: "grid",
                gridTemplateColumns: "7rem 9rem 1fr auto",
                gap: "0 0.75rem",
                padding: "0.45rem 0",
                borderBottom: "1px solid var(--msga-border)",
                alignItems: "start",
              }}
            >
              {/* Timestamp */}
              <span style={{ color: "#999", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", paddingTop: "1px" }}>
                {formatTime(line.start)} – {formatTime(line.end)}
              </span>

              {/* Speaker */}
              <span style={{ fontWeight: 600, color: "var(--msga-blue)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingTop: "1px" }}>
                {line.speaker}
              </span>

              {/* Text */}
              <span style={{ color: "var(--msga-text)" }}>{line.text}</span>

              {/* Play button */}
              <span style={{ paddingTop: "2px" }}>
                {audioUrls[line.index] ? (
                  <audio
                    src={audioUrls[line.index]}
                    controls
                    style={{ height: "24px", width: "140px" }}
                  />
                ) : (
                  <button
                    className="feed-item-audio-btn"
                    style={{ whiteSpace: "nowrap" }}
                    disabled={loadingAudio[line.index]}
                    onClick={() => handlePlay(line)}
                  >
                    {loadingAudio[line.index] ? "…" : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                          <circle cx="7" cy="7" r="6.5" stroke="currentColor" />
                          <path d="M5.5 4.5L9.5 7L5.5 9.5V4.5Z" fill="currentColor" />
                        </svg>
                        Play
                      </>
                    )}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>

        {!loading && lines.length === 0 && !error && (
          <div style={{ color: "#999", padding: "2rem 0", textAlign: "center" }}>No transcript lines found.</div>
        )}
      </div>
    </div>
  );
};

export default TranscriptPage;
