import { useState, useRef, useEffect, type JSX } from "react";
import { navigate } from "../App";
import {
  listTranscriptions,
  askAssistant,
  fetchArgumentMaps,
  fetchSummaries,
  buildArgumentMap,
  summarizeTranscript,
  openProgressSocket,
  type ArgumentMapPayload,
  type SummaryResponse,
  type SummaryVersion,
  type ArgumentMapVersion,
} from "../api";
import { transcriptToFeedItem, type FeedItem } from "../feedTypes";

const renderChatMarkdown = (text: string) => {
  const lines = text.split("\n");
  const elements: JSX.Element[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("### ")) {
      elements.push(<h3 key={key++}>{line.slice(4)}</h3>);
    } else if (line.startsWith("## ")) {
      elements.push(<h3 key={key++}>{line.slice(3)}</h3>);
    } else if (line.startsWith("> *")) {
      const content = line.slice(3, line.endsWith("*") ? -1 : undefined);
      elements.push(<blockquote key={key++}>{content}</blockquote>);
    } else if (line.startsWith("> ")) {
      elements.push(<blockquote key={key++}>{line.slice(2)}</blockquote>);
    } else if (line.startsWith("---")) {
      elements.push(<hr key={key++} />);
    } else if (line.startsWith("- **")) {
      const boldEnd = line.indexOf("**", 4);
      if (boldEnd > 0) {
        const boldText = line.slice(4, boldEnd);
        const rest = line.slice(boldEnd + 2);
        elements.push(<li key={key++}><strong>{boldText}</strong>{rest}</li>);
      } else {
        elements.push(<li key={key++}>{line.slice(2)}</li>);
      }
    } else if (line.startsWith("- ")) {
      elements.push(<li key={key++}>{line.slice(2)}</li>);
    } else if (line.trim() === "") {
      // skip
    } else {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      const rendered = parts.map((part, j) =>
        part.startsWith("**") && part.endsWith("**")
          ? <strong key={j}>{part.slice(2, -2)}</strong>
          : part
      );
      elements.push(<p key={key++}>{rendered}</p>);
    }
  }
  return elements;
};

type ChatMessage = { id: string; role: "user" | "assistant"; text: string };

function firstNegationUrl(map: ArgumentMapPayload): string | undefined {
  for (const q of map.argument_map?.core_questions ?? []) {
    if (q.negation_url) return q.negation_url;
  }
}

function buildInitialSummary(
  item: FeedItem,
  map: ArgumentMapPayload | null,
  summary: SummaryResponse | null,
): string {
  let text = `**${item.headline}**\n\n`;

  if (summary?.summary) {
    text += `${summary.summary}\n\n`;
  }

  const questions = map?.argument_map?.core_questions ?? [];
  if (questions.length > 0) {
    text += `### Core questions\n\n`;
    for (const q of questions) {
      text += `- ${q.question}${q.unresolved ? " *(unresolved)*" : ""}\n`;
    }
    text += "\n";
  }

  const firstQ = questions[0];
  if (firstQ?.evidence && firstQ.evidence.length > 0) {
    text += `### Key statements\n\n`;
    for (const ev of firstQ.evidence.slice(0, 3)) {
      text += `**${ev.speaker}**${ev.timestamp ? ` [${ev.timestamp}]` : ""}:\n`;
      text += `> *"${ev.quote}"*\n\n`;
    }
  }

  if (map && firstNegationUrl(map)) {
    text += `The structured deliberation map below shows the arguments and evidence on this topic.`;
  } else {
    text += `Ask me anything about the discussion, arguments, or related transcript excerpts.`;
  }

  return text;
}

const TopicDetailPage = ({ topicId }: { topicId: string }) => {
  const [item, setItem] = useState<FeedItem | null | undefined>(undefined);
  const [allItems, setAllItems] = useState<FeedItem[]>([]);
  // undefined = still loading; [] = loaded, none available
  const [mapVersions, setMapVersions] = useState<ArgumentMapVersion[] | undefined>(undefined);
  const [summaryVersions, setSummaryVersions] = useState<SummaryVersion[] | undefined>(undefined);
  const [activeMapIdx, setActiveMapIdx] = useState(0);
  const [activeSummaryIdx, setActiveSummaryIdx] = useState(0);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [mapExpanded, setMapExpanded] = useState(true);
  const [generatingMap, setGeneratingMap] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [mapProgress, setMapProgress] = useState<{ chunk: number; total: number; synthesizing?: boolean } | null>(null);
  const [summaryProgress, setSummaryProgress] = useState<{ chunk: number; total: number } | null>(null);
  const mapSocketRef = useRef<WebSocket | null>(null);
  const summarySocketRef = useRef<WebSocket | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatThinking, setChatThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setItem(undefined);
    setMapVersions(undefined);
    setSummaryVersions(undefined);
    setActiveMapIdx(0);
    setActiveSummaryIdx(0);
    listTranscriptions()
      .then((transcripts) => {
        const all = transcripts.map(transcriptToFeedItem);
        setAllItems(all);
        setItem(all.find((i) => i.id === topicId) ?? null);
      })
      .catch(() => setItem(null));
  }, [topicId]);

  useEffect(() => {
    if (!item) return;
    fetchArgumentMaps(item.id)
      .then((r) => {
        const versions = r?.versions ?? [];
        setMapVersions(versions);
        setActiveMapIdx(versions.length > 0 ? versions.length - 1 : 0);
      })
      .catch(() => setMapVersions([]));
    fetchSummaries(item.id)
      .then((r) => {
        const versions = r?.versions ?? [];
        setSummaryVersions(versions);
        setActiveSummaryIdx(versions.length > 0 ? versions.length - 1 : 0);
      })
      .catch(() => setSummaryVersions([]));
  }, [item]);

  // Build initial chat message once both map and summary have resolved
  useEffect(() => {
    if (!item || mapVersions === undefined || summaryVersions === undefined) return;
    const latestMap = mapVersions.length > 0 ? mapVersions[mapVersions.length - 1].argument_map : null;
    const latestSummary = summaryVersions.length > 0 ? { summary: summaryVersions[summaryVersions.length - 1].summary } as SummaryResponse : null;
    window.scrollTo(0, 0);
    document.querySelector(".topic-main")?.scrollTo(0, 0);
    setChatMessages([{
      id: "summary",
      role: "assistant",
      text: buildInitialSummary(item, latestMap, latestSummary),
    }]);
  }, [item, mapVersions, summaryVersions]);

  useEffect(() => {
    const el = messagesEndRef.current?.closest(".chat-messages");
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages]);

  useEffect(() => {
    return () => {
      mapSocketRef.current?.close();
      summarySocketRef.current?.close();
    };
  }, []);

  const handleGenerateMap = () => {
    if (!item || generatingMap) return;
    setGeneratingMap(true);
    setMapProgress(null);
    buildArgumentMap({ transcript_id: item.id })
      .then((start) => {
        if (!start.room_id) { setGeneratingMap(false); return; }

        mapSocketRef.current?.close();
        const socket = openProgressSocket(start.room_id, (payload) => {
          if (typeof payload === "string") return;
          const data = payload as Record<string, unknown>;
          if (data.job !== "argument_map") return;
          const stage = data.stage as string;
          if (stage === "chunk_complete") {
            setMapProgress({ chunk: data.chunk as number, total: data.total_chunks as number });
          } else if (stage === "synthesizing") {
            setMapProgress((prev) => ({ chunk: prev?.total ?? 0, total: prev?.total ?? 0, synthesizing: true }));
          } else if (stage === "result") {
            const newMap = data.argument_map as ArgumentMapPayload;
            setMapVersions((prev) => {
              const existing = prev ?? [];
              const nextVersion = existing.length > 0 ? existing[existing.length - 1].version + 1 : 1;
              const updated = [...existing, { version: nextVersion, argument_map: newMap }];
              setActiveMapIdx(updated.length - 1);
              return updated;
            });
            setGeneratingMap(false);
            setMapProgress(null);
            socket.close();
            mapSocketRef.current = null;
          } else if (stage === "error") {
            setGeneratingMap(false);
            setMapProgress(null);
            socket.close();
            mapSocketRef.current = null;
          }
        });
        mapSocketRef.current = socket;
      })
      .catch(() => { setGeneratingMap(false); setMapProgress(null); });
  };

  const handleGenerateSummary = () => {
    if (!item || generatingSummary) return;
    setGeneratingSummary(true);
    setSummaryProgress(null);
    summarizeTranscript({ transcript_id: item.id })
      .then((start) => {
        if (!start.room_id) { setGeneratingSummary(false); return; }

        summarySocketRef.current?.close();
        const socket = openProgressSocket(start.room_id, (payload) => {
          if (typeof payload === "string") return;
          const data = payload as Record<string, unknown>;
          if (data.job !== "summarize_transcript") return;
          const stage = data.stage as string;
          if (stage === "chunk_complete") {
            setSummaryProgress({ chunk: data.chunk as number, total: data.total_chunks as number });
          } else if (stage === "result") {
            const rawSummary = data.summary as { summary?: string } | string | undefined;
            const summaryText = typeof rawSummary === "string"
              ? rawSummary
              : rawSummary?.summary ?? "";
            if (summaryText) {
              setSummaryVersions((prev) => {
                const existing = prev ?? [];
                const nextVersion = existing.length > 0 ? existing[existing.length - 1].version + 1 : 1;
                const updated = [...existing, { version: nextVersion, summary: summaryText }];
                setActiveSummaryIdx(updated.length - 1);
                return updated;
              });
            }
            setGeneratingSummary(false);
            setSummaryProgress(null);
            socket.close();
            summarySocketRef.current = null;
          } else if (stage === "error") {
            setGeneratingSummary(false);
            setSummaryProgress(null);
            socket.close();
            summarySocketRef.current = null;
          }
        });
        summarySocketRef.current = socket;
      })
      .catch(() => { setGeneratingSummary(false); setSummaryProgress(null); });
  };

  const handleChatSend = () => {
    const text = chatInput.trim();
    if (!text || chatThinking) return;
    setChatInput("");
    setChatMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text }]);
    setChatThinking(true);
    askAssistant(text)
      .then((r) => {
        setChatMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", text: r.answer ?? "No response received." }]);
        setChatThinking(false);
      })
      .catch(() => {
        setChatMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", text: "Sorry, I was unable to retrieve an answer at this time." }]);
        setChatThinking(false);
      });
  };

  if (item === undefined) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "#999" }}>Loading…</div>;
  }

  if (!item) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <p>Topic not found.</p>
        <a href="#/home" onClick={(e) => { e.preventDefault(); navigate("/home"); }}>← Back to feed</a>
      </div>
    );
  }

  const otherItems = allItems.filter((fi) => fi.id !== item.id && fi.committee.id === item.committee.id);
  const activeMap = mapVersions && mapVersions.length > 0 ? mapVersions[activeMapIdx]?.argument_map : undefined;
  const activeSummary = summaryVersions && summaryVersions.length > 0 ? summaryVersions[activeSummaryIdx] : undefined;
  const agenda = activeMap?.argument_map?.agenda ?? [];
  const coreQuestions = activeMap?.argument_map?.core_questions ?? [];
  const negationUrl = activeMap ? firstNegationUrl(activeMap) : undefined;
  const keyEvidence = coreQuestions[0]?.evidence ?? [];
  const description = activeSummary?.summary ?? item.description;

  return (
    <div style={{ height: "100vh", overflow: "hidden", background: "var(--msga-bg)" }}>
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
        <a href="#/home" className="msga-nav-item" onClick={(e) => { e.preventDefault(); navigate("/home"); }}>
          ← Home
        </a>
        <div className="msga-nav-item active" style={{ fontSize: "0.75rem" }}>{item.committee.name}</div>
      </nav>

      <div className="topic-detail-layout">
        {/* Left: content */}
        <div className="topic-main">
          <div className="topic-meta">
            <span className="topic-committee-tag">{item.committee.name}</span>
            <span className="topic-date">{item.date}</span>
          </div>

          <h1 className="topic-title">{item.headline}</h1>

          {/* ── Summary section ── */}
          <div style={{ marginBottom: "1.25rem" }}>
            {/* Section header row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: summaryExpanded ? "0.5rem" : 0 }}>
              <button
                onClick={() => setSummaryExpanded((v) => !v)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: "0.4rem", fontFamily: "var(--msga-font-heading)", fontWeight: 700, fontSize: "0.8rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--msga-text)" }}
              >
                <span style={{ fontSize: "0.65rem", transition: "transform 0.15s", display: "inline-block", transform: summaryExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                Summary
              </button>
              <button className="feed-item-audio-btn" onClick={handleGenerateSummary} disabled={generatingSummary} style={{ fontSize: "0.75rem" }}>
                {generatingSummary
                  ? summaryProgress ? `Summarizing… ${summaryProgress.chunk}/${summaryProgress.total}` : "Summarizing…"
                  : "Generate summary"}
              </button>
            </div>

            {summaryExpanded && (
              <>
                {/* Version tabs */}
                {summaryVersions && summaryVersions.length > 1 && (
                  <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.5rem" }}>
                    {summaryVersions.map((v, idx) => (
                      <button
                        key={v.version}
                        onClick={() => setActiveSummaryIdx(idx)}
                        style={{ padding: "0.2rem 0.55rem", fontSize: "0.72rem", border: "1px solid var(--msga-border)", borderRadius: "3px", cursor: "pointer", background: idx === activeSummaryIdx ? "var(--msga-blue)" : "white", color: idx === activeSummaryIdx ? "white" : "var(--msga-text)", fontWeight: idx === activeSummaryIdx ? 700 : 400 }}
                      >
                        v{v.version}
                      </button>
                    ))}
                  </div>
                )}

                {summaryVersions === undefined ? (
                  <p className="topic-description" style={{ color: "#bbb" }}>Loading…</p>
                ) : summaryVersions.length === 0 ? (
                  <p className="topic-description" style={{ color: "#999", fontStyle: "italic" }}>No summary available yet. Use "Generate summary" to create one.</p>
                ) : (
                  <div className="topic-description">{renderChatMarkdown(description)}</div>
                )}
              </>
            )}
          </div>

          {/* ── Argument Map section ── */}
          <div style={{ marginBottom: "1.25rem" }}>
            {/* Section header row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: mapExpanded ? "0.5rem" : 0 }}>
              <button
                onClick={() => setMapExpanded((v) => !v)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: "0.4rem", fontFamily: "var(--msga-font-heading)", fontWeight: 700, fontSize: "0.8rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--msga-text)" }}
              >
                <span style={{ fontSize: "0.65rem", transition: "transform 0.15s", display: "inline-block", transform: mapExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                Argument Map
              </button>
              <button className="feed-item-audio-btn" onClick={handleGenerateMap} disabled={generatingMap} style={{ fontSize: "0.75rem" }}>
                {generatingMap
                  ? mapProgress?.synthesizing
                    ? "Synthesizing map…"
                    : mapProgress ? `Extracting… ${mapProgress.chunk}/${mapProgress.total}` : "Starting…"
                  : "Generate argument map"}
              </button>
            </div>

            {mapExpanded && (
              <>
                {/* Version tabs */}
                {mapVersions && mapVersions.length > 1 && (
                  <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.5rem" }}>
                    {mapVersions.map((v, idx) => (
                      <button
                        key={v.version}
                        onClick={() => setActiveMapIdx(idx)}
                        style={{ padding: "0.2rem 0.55rem", fontSize: "0.72rem", border: "1px solid var(--msga-border)", borderRadius: "3px", cursor: "pointer", background: idx === activeMapIdx ? "var(--msga-blue)" : "white", color: idx === activeMapIdx ? "white" : "var(--msga-text)", fontWeight: idx === activeMapIdx ? 700 : 400 }}
                      >
                        v{v.version}
                      </button>
                    ))}
                  </div>
                )}

                {mapVersions === undefined ? null : mapVersions.length === 0 ? (
                  <div className="msga-callout" style={{ fontSize: "0.85rem", lineHeight: 1.6 }}>
                    No argument map available yet. Use "Generate argument map" to create one.
                  </div>
                ) : (
                  <>
                    {/* Agenda */}
                    {agenda.length > 0 && (
                      <>
                        <div className="topic-section-header" style={{ marginTop: 0 }}>Agenda</div>
                        <ul style={{ margin: "0 0 1rem", padding: "0 0 0 1.25rem", fontSize: "0.85rem", lineHeight: 1.7 }}>
                          {agenda.map((a, idx) => (
                            <li key={idx}>
                              {a.item}
                              {a.presenter && <span style={{ color: "#888" }}> — {a.presenter}</span>}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}

                    {/* Core Questions */}
                    {coreQuestions.length > 0 && (
                      <>
                        <div className="topic-section-header" style={{ marginTop: agenda.length > 0 ? undefined : 0 }}>Core Questions</div>
                        {coreQuestions.map((q, idx) => (
                          <div key={idx} style={{ marginBottom: "1rem", padding: "0.75rem", background: "white", border: "1px solid var(--msga-border)", borderRadius: "4px", fontSize: "0.85rem" }}>
                            <div style={{ fontWeight: 600, marginBottom: "0.4rem" }}>
                              {q.question}
                              {q.unresolved && <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#c55", fontWeight: 400 }}>unresolved</span>}
                            </div>
                            {(q.options_or_claims ?? []).map((o, oi) => (
                              <div key={oi} style={{ color: "#555", marginBottom: "0.2rem" }}>
                                <span style={{ fontWeight: 600, color: "var(--msga-blue)" }}>{o.label}</span>{" — "}{o.claim}
                              </div>
                            ))}
                          </div>
                        ))}
                      </>
                    )}

                    {/* Key evidence quotes from first core question */}
                    {keyEvidence.length > 0 && (
                      <>
                        <div className="topic-section-header">Key statements</div>
                        {keyEvidence.map((ev, idx) => (
                          <div key={idx} className="feed-item-quote" style={{ marginBottom: "0.75rem" }}>
                            <div className="feed-item-quote-speaker">
                              {ev.speaker}
                              {ev.timestamp && <span style={{ fontWeight: 400, color: "#999" }}> [{ev.timestamp}]</span>}
                            </div>
                            <div className="feed-item-quote-text">"{ev.quote}"</div>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* Negation Game embed */}
          {negationUrl ? (
            <>
              <div className="topic-section-header">Deliberation Map</div>
              <div className="topic-negation-frame">
                <iframe src={negationUrl} title="Negation Game — Deliberation Map" allow="clipboard-write" />
              </div>
            </>
          ) : activeMap && (
            <>
              <div className="topic-section-header">Deliberation Map</div>
              <div className="msga-callout" style={{ fontSize: "0.85rem", lineHeight: 1.6 }}>
                No deliberation map linked for this topic yet.
              </div>
            </>
          )}

          {/* Other meetings from same committee */}
          {otherItems.length > 0 && (
            <>
              <div className="topic-section-header">Other meetings — {item.committee.name}</div>
              <ul className="topic-other-questions">
                {otherItems.map((oq) => (
                  <li key={oq.id}>
                    <a href={`#/topic/${oq.id}`} onClick={(e) => { e.preventDefault(); navigate(`/topic/${oq.id}`); }}>
                      {oq.headline}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* View transcript link */}
          <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--msga-border)" }}>
            <a
              href={`#/transcript/${item.id}`}
              style={{ color: "var(--msga-link-blue)", fontSize: "0.85rem", fontWeight: 600, textDecoration: "none" }}
              onClick={(e) => { e.preventDefault(); navigate(`/transcript/${item.id}`); }}
            >
              View full transcript →
            </a>
          </div>
        </div>

        {/* Right: Chat panel */}
        <div className="topic-chat-panel">
          <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--msga-border)", background: "white", fontSize: "0.8rem", fontWeight: 700, fontFamily: "var(--msga-font-heading)", color: "var(--msga-text)" }}>
            Ask about this topic
          </div>

          <div className="chat-messages">
            {chatMessages.map((msg) => (
              <div key={msg.id} className={`chat-msg ${msg.role}`}>
                {msg.role === "assistant" ? renderChatMarkdown(msg.text) : msg.text}
              </div>
            ))}
            {chatThinking && <div className="chat-thinking">Searching transcripts…</div>}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input-area">
            <input
              className="chat-input"
              type="text"
              placeholder="Ask a question about this topic…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
            />
            <button className="chat-send-btn" onClick={handleChatSend} disabled={chatThinking}>Send</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TopicDetailPage;
