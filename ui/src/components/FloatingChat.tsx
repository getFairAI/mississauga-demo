import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import {
  type Meeting,
  mockChatResponses,
  institutionalMemoryResponse,
} from "../data/mockData";

// Process inline bold (**text**) within a string
const renderInline = (text: string) => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, j) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={j}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
};

// Simple markdown-ish renderer for chat messages
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

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean; // currently being typed out
  proposeCitizen?: boolean; // show "Propose as citizen point" button
};

const mockSessions = [
  { id: "current", label: "Current session" },
  { id: "road-safety", label: "Road safety budget" },
  { id: "institutional", label: "Institutional memory" },
  { id: "transit", label: "Transit fare policy" },
];

// Trailing questions appended to AI responses
const trailingQuestions = [
  "\n\nDo you have any questions about this meeting?",
  "\n\nWould you like to explore any of these points further?",
  "\n\nIs there anything else you'd like to know?",
];

type Props = {
  meeting: Meeting;
};

const findMockResponse = (
  text: string,
  meeting: Meeting,
  messageCount: number,
): { response: string; proposeCitizen: boolean } => {
  const lower = text.toLowerCase();

  // Third interaction: citizen disagrees with allocation
  if (
    lower.includes("proportional") ||
    lower.includes("don't think") ||
    lower.includes("disagree") ||
    lower.includes("collision data") ||
    lower.includes("not the best") ||
    lower.includes("better allocation")
  ) {
    return {
      response: mockChatResponses["citizen-disagree"],
      proposeCitizen: true,
    };
  }

  // Check for institutional memory
  if (
    lower.includes("institutional memory") ||
    lower.includes("forgetting") ||
    lower.includes("lost knowledge")
  ) {
    return {
      response:
        institutionalMemoryResponse +
        (trailingQuestions[messageCount % trailingQuestions.length] || ""),
      proposeCitizen: false,
    };
  }

  // Check for $2.2M / funding questions
  if (
    lower.includes("2.2") ||
    lower.includes("funding") ||
    lower.includes("million") ||
    lower.includes("budget") ||
    lower.includes("provincial")
  ) {
    return {
      response:
        mockChatResponses["2.2m"] +
        (trailingQuestions[messageCount % trailingQuestions.length] || ""),
      proposeCitizen: false,
    };
  }

  // Check for school bus questions
  if (
    lower.includes("school bus") ||
    lower.includes("stop arm") ||
    lower.includes("camera")
  ) {
    return {
      response:
        mockChatResponses["school bus"] +
        (trailingQuestions[messageCount % trailingQuestions.length] || ""),
      proposeCitizen: false,
    };
  }

  // Check for unresolved / what's pending
  if (
    lower.includes("unresolved") ||
    lower.includes("pending") ||
    lower.includes("deferred") ||
    lower.includes("never been resolved")
  ) {
    return {
      response:
        mockChatResponses["unresolved"] +
        (trailingQuestions[messageCount % trailingQuestions.length] || ""),
      proposeCitizen: false,
    };
  }

  // Default response
  return {
    response: `Based on the ${meeting.committee} meeting transcript from ${meeting.date}:\n\nThis is a mock response for the demo. In production, this would search the meeting transcript and deliberation records to answer: "${text}"\n\nThe AI would draw from:\n- **Full meeting transcript** with speaker attribution\n- **Structured argument maps** for each agenda item\n- **Historical records** showing how this issue has evolved across meetings\n\nIs there anything else you'd like to know about this meeting?`,
    proposeCitizen: false,
  };
};

// Animated thinking indicator: "Thinking..." → "Searching..."
const ThinkingIndicator = () => {
  const [phase, setPhase] = useState(0); // 0 = Thinking, 1 = Searching
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

// Typewriter component — streams text character by character then renders markdown
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
    // Fast chunked streaming
    const chunkSize = Math.max(2, Math.floor(Math.random() * 5) + 2);
    const timer = setTimeout(() => {
      setDisplayedLength((prev) => Math.min(prev + chunkSize, text.length));
    }, speed);
    return () => clearTimeout(timer);
  }, [displayedLength, text, speed, onComplete]);

  // Scroll parent container as text grows
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

  // While streaming, show partial text as plain (avoids broken markdown)
  const partial = text.slice(0, displayedLength);
  return (
    <div ref={containerRef} className="chat-msg assistant fc-streaming">
      {renderChatMarkdown(partial)}
      <span className="fc-cursor" />
    </div>
  );
};

const FloatingChat = ({ meeting }: Props) => {
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draftInput, setDraftInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [hasOpened, setHasOpened] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const assistantMsgCount = useRef(0);

  // Initialize with meeting summary + trailing question
  useEffect(() => {
    const summaryText =
      meeting.summary + "\n\nDo you have any questions about this meeting?";
    setMessages([
      {
        id: "summary",
        role: "assistant",
        text: summaryText,
        streaming: true,
      },
    ]);
    setStreamingId("summary");
    assistantMsgCount.current = 0;
  }, [meeting.id]);

  // Scroll chat to bottom on new messages
  useEffect(() => {
    const container = messagesEndRef.current?.closest(".fc-messages");
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, thinking]);

  // Focus input when expanded
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
    setSidebarOpen(false);
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

  const handleSend = () => {
    const text = draftInput.trim();
    if (!text || thinking) return;
    setDraftInput("");
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", text },
    ]);
    setThinking(true);

    assistantMsgCount.current++;
    const { response, proposeCitizen } = findMockResponse(
      text,
      meeting,
      assistantMsgCount.current,
    );

    // 2-second thinking phase, then stream the response
    const msgId = `a-${Date.now()}`;
    setTimeout(() => {
      setThinking(false);
      setMessages((prev) => [
        ...prev,
        {
          id: msgId,
          role: "assistant",
          text: response,
          streaming: true,
          proposeCitizen,
        },
      ]);
      setStreamingId(msgId);
    }, 2000);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleBarClick = () => {
    setExpanded(true);
    if (!hasOpened) setHasOpened(true);
  };

  const handleProposeCitizen = (msgId: string) => {
    // Mark the button as clicked and add a confirmation message
    setMessages((prev) => [
      ...prev.map((m) =>
        m.id === msgId ? { ...m, proposeCitizen: false } : m,
      ),
      {
        id: `citizen-${Date.now()}`,
        role: "assistant",
        text: `Your point has been submitted to the **Citizen Engagement Coordinator** for review. If approved, it will be added to the deliberation map as a citizen-contributed argument.\n\nThis is a premium feature of the Civic Deliberative Memory platform. Citizen contributions are reviewed by the municipality's designated coordinator before being surfaced to councillors.\n\nThank you for participating in Mississauga's civic deliberation process.`,
        streaming: true,
      },
    ]);
    setStreamingId(`citizen-${Date.now()}`);
  };

  return (
    <>
      {/* Collapsed bar */}
      {!expanded && (
        <div
          className={`fc-bar ${hasOpened ? "fc-bar-returning" : "fc-bar-initial"}`}
          onClick={handleBarClick}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className="fc-bar-icon"
          >
            <circle
              cx="8"
              cy="8"
              r="7"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M7.5 4.5v4l2.5 1.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Search this meeting's records...</span>
        </div>
      )}

      {/* Expanded overlay */}
      {expanded && (
        <div
          className={`fc-overlay ${closing ? "fc-closing" : ""}`}
          onMouseDown={handleOverlayClick}
        >
          {/* Sidebar */}
          {sidebarOpen && (
            <div
              className="fc-sidebar"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="fc-sidebar-header">
                <span>Conversations</span>
                <button
                  className="fc-sidebar-close"
                  onClick={() => setSidebarOpen(false)}
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
              {mockSessions.map((s, idx) => (
                <div
                  key={s.id}
                  className={`fc-sidebar-item ${idx === 0 ? "active" : ""}`}
                >
                  {s.label}
                </div>
              ))}
            </div>
          )}

          {/* Chat column */}
          <div
            className={`fc-column ${closing ? "fc-column-closing" : ""}`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Chat header */}
            <div className="fc-chat-header">
              <button
                className="fc-history-btn"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                title="Conversation history"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M2 4h12M2 8h12M2 12h12"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <span className="fc-chat-title">
                {meeting.committee} — {meeting.date}
              </span>
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

            {/* Messages */}
            <div className="fc-messages">
              {messages.map((msg) => (
                <div key={msg.id}>
                  {msg.role === "assistant" && msg.streaming ? (
                    <TypewriterMessage
                      text={msg.text}
                      speed={streamingId === "summary" ? 2 : 3}
                      onComplete={() => handleStreamComplete(msg.id)}
                    />
                  ) : (
                    <div className={`chat-msg ${msg.role}`}>
                      {msg.role === "assistant"
                        ? renderChatMarkdown(msg.text)
                        : msg.text}
                    </div>
                  )}
                  {/* Propose citizen point button */}
                  {msg.proposeCitizen && !msg.streaming && (
                    <button
                      className="fc-propose-btn"
                      onClick={() => handleProposeCitizen(msg.id)}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                      >
                        <path
                          d="M7 1v12M1 7h12"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                      Propose as citizen point
                    </button>
                  )}
                </div>
              ))}
              {thinking && <ThinkingIndicator />}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
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
                onClick={handleSend}
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
        </div>
      )}
    </>
  );
};

export default FloatingChat;
