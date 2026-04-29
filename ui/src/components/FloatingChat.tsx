import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import type { Meeting } from "../adapters/meetingAdapter";
import { askAssistant, type AssistantResponse } from "../api";

const renderInline = (text: string) => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, j) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={j}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
};

const renderChatMarkdown = (text: string) => {
  const lines = text.split("\n");
  const elements: React.JSX.Element[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      elements.push(<h3 key={key++}>{renderInline(line.slice(4))}</h3>);
    } else if (line.startsWith("## ")) {
      elements.push(<h3 key={key++}>{renderInline(line.slice(3))}</h3>);
    } else if (line.startsWith("> *")) {
      const content = line.slice(3, line.endsWith("*") ? -1 : undefined);
      elements.push(<blockquote key={key++}>{content}</blockquote>);
    } else if (line.startsWith("> ")) {
      elements.push(
        <blockquote key={key++}>{renderInline(line.slice(2))}</blockquote>,
      );
    } else if (line.startsWith("---")) {
      elements.push(<hr key={key++} />);
    } else if (line.startsWith("- ")) {
      elements.push(<li key={key++}>{renderInline(line.slice(2))}</li>);
    } else if (line.trim() === "") {
      // skip
    } else {
      elements.push(<p key={key++}>{renderInline(line)}</p>);
    }
  }

  return elements;
};

type ChatSource = { reportId?: string; title?: string };

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  error?: boolean;
  sources?: ChatSource[];
};

type Props = {
  meeting: Meeting;
};

const ThinkingIndicator = () => {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setPhase(1), 1000);
    return () => clearTimeout(timer);
  }, []);
  const label = phase === 0 ? "Thinking" : "Searching transcripts";
  return (
    <div className="fc-thinking-indicator">
      <span>{label}</span>
      <span className="fc-thinking-dots" />
    </div>
  );
};

const TypewriterMessage = ({
  text,
  speed = 3,
  onComplete,
}: {
  text: string;
  speed?: number;
  onComplete?: () => void;
}) => {
  const [displayedLength, setDisplayedLength] = useState(0);
  const [done, setDone] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDisplayedLength(0);
    setDone(false);
  }, [text]);

  useEffect(() => {
    if (displayedLength >= text.length) {
      setDone(true);
      onComplete?.();
      return;
    }
    const chunkSize = Math.max(2, Math.floor(Math.random() * 5) + 2);
    const timer = setTimeout(() => {
      setDisplayedLength((prev) => Math.min(prev + chunkSize, text.length));
    }, speed);
    return () => clearTimeout(timer);
  }, [displayedLength, text, speed, onComplete]);

  useEffect(() => {
    const container = containerRef.current?.closest(".fc-messages");
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [displayedLength]);

  if (done) {
    return (
      <div ref={containerRef} className="chat-msg assistant">
        {renderChatMarkdown(text)}
      </div>
    );
  }

  const partial = text.slice(0, displayedLength);
  return (
    <div ref={containerRef} className="chat-msg assistant fc-streaming">
      {renderChatMarkdown(partial)}
      <span className="fc-cursor" />
    </div>
  );
};

const responseToMarkdown = (resp: AssistantResponse): string => {
  if (resp.type === "chart") {
    const points =
      resp.chart?.data?.map((d) => `- **${d.name}**: ${d.value}`).join("\n") ??
      "";
    return [
      "Generated a chart from the council records.",
      points,
      resp.answer ?? "",
    ]
      .filter((s) => s.trim().length > 0)
      .join("\n\n");
  }
  return resp.answer?.trim() || "I couldn't find a relevant answer in the meeting records.";
};

const FloatingChat = ({ meeting }: Props) => {
  const [expanded, setExpanded] = useState(true);
  const [closing, setClosing] = useState(false);
  const [draftInput, setDraftInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [, setStreamingId] = useState<string | null>(null);
  const [hasOpened, setHasOpened] = useState(false);
  const [hasBeenWelcomed, setHasBeenWelcomed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMessages([]);
  }, [meeting.id]);

  useEffect(() => {
    const container = messagesEndRef.current?.closest(".fc-messages");
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, thinking]);

  useEffect(() => {
    if (expanded && !closing) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [expanded, closing]);

  const handleStreamComplete = useCallback((msgId: string) => {
    setStreamingId(null);
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, streaming: false } : m)),
    );
  }, []);

  const handleClose = () => {
    setClosing(true);
    if (!hasBeenWelcomed) setHasBeenWelcomed(true);
    setTimeout(() => {
      setExpanded(false);
      setClosing(false);
    }, 250);
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const handleSend = useCallback(
    async (questionText?: string) => {
      const text = (questionText ?? draftInput).trim();
      if (!text || thinking) return;
      setDraftInput("");
      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", text },
      ]);
      setThinking(true);

      try {
        const response = await askAssistant(text);
        const markdown = responseToMarkdown(response);
        const msgId = `a-${Date.now()}`;
        setThinking(false);
        setMessages((prev) => [
          ...prev,
          {
            id: msgId,
            role: "assistant",
            text: markdown,
            streaming: true,
            sources: response.sources,
          },
        ]);
        setStreamingId(msgId);
      } catch (err) {
        setThinking(false);
        const message =
          err instanceof Error ? err.message : "Failed to reach the assistant.";
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: "assistant",
            text: `**Couldn't reach the assistant.** ${message}`,
            error: true,
          },
        ]);
      }
    },
    [draftInput, thinking],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleBarClick = () => {
    setExpanded(true);
    if (!hasOpened) setHasOpened(true);
  };

  const handleSuggestedQuestion = (question: string, qid: string) => {
    handleClose();
    setTimeout(() => {
      const section = document.getElementById(`ng-${qid}`);
      if (section) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
        section.classList.add("cdm-section-highlight");
        setTimeout(() => section.classList.remove("cdm-section-highlight"), 1800);
      }
    }, 300);
    void handleSend(question);
  };

  const suggestedQuestions = meeting.questions
    .filter((q) => q.deliberativeQuestion)
    .slice(0, 3)
    .map((q) => ({
      label: `${q.number}. ${q.deliberativeQuestion}`,
      question: q.deliberativeQuestion,
      id: q.id,
    }));

  return (
    <>
      {!expanded && (
        <div
          className={`fc-bar ${hasOpened ? "fc-bar-returning" : "fc-bar-initial"}`}
          onClick={handleBarClick}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="fc-bar-icon">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7.5 4.5v4l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <input
            className="fc-bar-input"
            type="text"
            placeholder="Search this meeting's records..."
            value={draftInput}
            onChange={(e) => setDraftInput(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onFocus={() => {
              if (!hasOpened) setHasOpened(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draftInput.trim()) {
                setExpanded(true);
                setHasBeenWelcomed(true);
                setTimeout(() => void handleSend(), 50);
              }
            }}
          />
        </div>
      )}

      {expanded && (
        <div
          className={`fc-overlay ${closing ? "fc-closing" : ""} ${messages.length === 0 ? "fc-overlay-welcome" : ""}`}
          onMouseDown={handleOverlayClick}
        >
          {messages.length === 0 && !hasBeenWelcomed && (
            <div className="fc-welcome" onMouseDown={(e) => e.stopPropagation()}>
              <h1 className="fc-welcome-title">Welcome to years of Mississauga meeting records.</h1>
              <p className="fc-welcome-subtitle">How can I help you today?</p>
              <div className="fc-welcome-input-wrap">
                <input
                  ref={inputRef}
                  className="fc-welcome-input"
                  type="text"
                  placeholder="Ask about this meeting..."
                  value={draftInput}
                  onChange={(e) => setDraftInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button
                  className="fc-send-btn"
                  onClick={() => void handleSend()}
                  disabled={thinking || !draftInput.trim()}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M14 2L7 9M14 2L9.5 14L7 9M14 2L2 6.5L7 9"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
              <div className="fc-welcome-chips">
                {suggestedQuestions.map((s) => (
                  <button
                    key={s.question}
                    className="fc-chip"
                    onClick={() => handleSuggestedQuestion(s.question, s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(messages.length > 0 || hasBeenWelcomed) && (
            <div
              className={`fc-column ${closing ? "fc-column-closing" : ""}`}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="fc-chat-header">
                <span className="fc-chat-title"></span>
                <button
                  className="fc-close-btn"
                  onClick={handleClose}
                  title="Close"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              <div className="fc-messages">
                {messages.map((msg) => (
                  <div key={msg.id}>
                    {msg.role === "assistant" && msg.streaming ? (
                      <TypewriterMessage
                        text={msg.text}
                        onComplete={() => handleStreamComplete(msg.id)}
                      />
                    ) : (
                      <div
                        className={`chat-msg ${msg.role}${msg.error ? " fc-error" : ""}`}
                      >
                        {msg.role === "assistant"
                          ? renderChatMarkdown(msg.text)
                          : msg.text}
                      </div>
                    )}
                    {msg.role === "assistant" &&
                      !msg.streaming &&
                      msg.sources &&
                      msg.sources.length > 0 && (
                        <div className="fc-sources">
                          {msg.sources.map((src, idx) => (
                            <span key={idx} className="fc-source-chip">
                              {src.title ?? src.reportId ?? "source"}
                            </span>
                          ))}
                        </div>
                      )}
                  </div>
                ))}
                {thinking && <ThinkingIndicator />}
                <div ref={messagesEndRef} />
              </div>

              <div className="fc-chips-row">
                {suggestedQuestions.map((s) => (
                  <button
                    key={s.question}
                    className="fc-chip fc-chip-inline"
                    onClick={() => handleSuggestedQuestion(s.question, s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <div className="fc-input-area">
                <input
                  ref={inputRef}
                  className="fc-input"
                  type="text"
                  placeholder="Ask about this meeting..."
                  value={draftInput}
                  onChange={(e) => setDraftInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button
                  className="fc-send-btn"
                  onClick={() => void handleSend()}
                  disabled={thinking || !draftInput.trim()}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M14 2L7 9M14 2L9.5 14L7 9M14 2L2 6.5L7 9"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default FloatingChat;
