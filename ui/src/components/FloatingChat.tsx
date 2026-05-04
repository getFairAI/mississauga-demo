import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import type { Meeting } from "../adapters/meetingAdapter";
import { askAssistant, type AssistantResponse, type AssistantHistoryMessage } from "../api";
import { loadChatHistory, saveChatHistory } from "../utils/chatHistoryStore";
import ChatMarkdown from "./ChatMarkdown";

type ChatSource = { reportId?: string; title?: string };

type BoardLink = { qid: string; label: string };

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  error?: boolean;
  sources?: ChatSource[];
  boardLink?: BoardLink;
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
        <ChatMarkdown text={text} />
      </div>
    );
  }

  const partial = text.slice(0, displayedLength);
  return (
    <div ref={containerRef} className="chat-msg assistant fc-streaming">
      <ChatMarkdown text={partial} />
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

const VISIBLE_WELCOME_CHIPS = 4;

const historyScope = (meetingId: string) => `fc:${meetingId}`;

const FloatingChat = ({ meeting }: Props) => {
  const [expanded, setExpanded] = useState(true);
  const [closing, setClosing] = useState(false);
  const [draftInput, setDraftInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadChatHistory<ChatMessage>(historyScope(meeting.id)).map((m) => ({
      ...m,
      streaming: false,
    })),
  );
  const [thinking, setThinking] = useState(false);
  const [, setStreamingId] = useState<string | null>(null);
  const [hasOpened, setHasOpened] = useState(false);
  const [hasBeenWelcomed, setHasBeenWelcomed] = useState(
    () =>
      loadChatHistory<ChatMessage>(historyScope(meeting.id)).length > 0,
  );
  const [showAllChips, setShowAllChips] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const restored = loadChatHistory<ChatMessage>(historyScope(meeting.id)).map(
      (m) => ({ ...m, streaming: false }),
    );
    setMessages(restored);
    setHasBeenWelcomed(restored.length > 0);
    setShowAllChips(false);
  }, [meeting.id]);

  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
    const persistable = messages
      .filter((m) => !m.error)
      .map(({ id, role, text, sources, boardLink }) => ({
        id,
        role,
        text,
        sources,
        boardLink,
      }));
    saveChatHistory(historyScope(meeting.id), persistable);
  }, [meeting.id, messages]);

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
    async (questionText?: string, boardLink?: BoardLink) => {
      const text = (questionText ?? draftInput).trim();
      if (!text || thinking) return;
      setDraftInput("");
      const history: AssistantHistoryMessage[] = messagesRef.current
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.text }));
      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", text },
      ]);
      setThinking(true);

      try {
        const response = await askAssistant(text, history);
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
            boardLink,
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

  const handleSendFromWelcome = () => {
    const q = draftInput.trim();
    if (!q) return;
    setHasBeenWelcomed(true);
    void handleSend();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleWelcomeKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendFromWelcome();
    }
  };

  const handleBarClick = () => {
    setExpanded(true);
    if (!hasOpened) setHasOpened(true);
  };

  const scrollToBoard = (qid: string) => {
    const section = document.getElementById(`ng-${qid}`);
    if (!section) return;
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    section.classList.add("cdm-section-highlight");
    setTimeout(() => section.classList.remove("cdm-section-highlight"), 1800);
  };

  const handleSuggestedQuestion = (question: string, qid: string) => {
    if (!hasBeenWelcomed) setHasBeenWelcomed(true);
    setShowAllChips(false);
    void handleSend(question, { qid, label: question });
  };

  const handleViewBoard = (qid: string) => {
    handleClose();
    setTimeout(() => scrollToBoard(qid), 300);
  };

  const allSuggestedQuestions = meeting.questions
    .filter((q) => q.deliberativeQuestion)
    .map((q) => ({
      label: `${q.number}. ${q.deliberativeQuestion}`,
      question: q.deliberativeQuestion,
      id: q.id,
    }));
  const suggestedQuestions = allSuggestedQuestions.slice(0, 3);
  const visibleWelcomeChips = showAllChips
    ? allSuggestedQuestions
    : allSuggestedQuestions.slice(0, VISIBLE_WELCOME_CHIPS);
  const hiddenChipCount = allSuggestedQuestions.length - VISIBLE_WELCOME_CHIPS;

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
          className={`fc-overlay ${closing ? "fc-closing" : ""} ${messages.length === 0 && !hasBeenWelcomed ? "fc-overlay-welcome" : ""}`}
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
                  onKeyDown={handleWelcomeKeyDown}
                />
                <button
                  className="fc-send-btn"
                  onClick={handleSendFromWelcome}
                  disabled={!draftInput.trim()}
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
              <div
                className={`fc-welcome-chips ${showAllChips ? "fc-welcome-chips-scroll" : ""}`}
              >
                {visibleWelcomeChips.map((s) => (
                  <button
                    key={s.question}
                    className="fc-chip"
                    onClick={() => handleSuggestedQuestion(s.question, s.id)}
                  >
                    {s.label}
                  </button>
                ))}
                {!showAllChips && hiddenChipCount > 0 && (
                  <button
                    className="fc-chip fc-chip-more"
                    onClick={() => setShowAllChips(true)}
                  >
                    Show more ({hiddenChipCount})
                  </button>
                )}
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
                        {msg.role === "assistant" ? (
                          <ChatMarkdown text={msg.text} />
                        ) : (
                          msg.text
                        )}
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
                    {msg.role === "assistant" &&
                      !msg.streaming &&
                      msg.boardLink && (
                        <button
                          className="fc-board-link"
                          onClick={() => handleViewBoard(msg.boardLink!.qid)}
                        >
                          View deliberation board
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 12 12"
                            fill="none"
                            aria-hidden
                          >
                            <path
                              d="M4 2.5L7.5 6L4 9.5"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
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
