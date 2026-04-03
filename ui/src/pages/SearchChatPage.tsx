import { useState, useEffect, useRef, type JSX } from "react";
import { navigate } from "../App";
import { askAssistant } from "../api";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

// Simple markdown renderer for chat messages
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
        elements.push(
          <li key={key++}>
            <strong>{boldText}</strong>
            {rest}
          </li>,
        );
      } else {
        elements.push(<li key={key++}>{line.slice(2)}</li>);
      }
    } else if (line.startsWith("- ")) {
      elements.push(<li key={key++}>{line.slice(2)}</li>);
    } else if (line.trim() === "") {
      // skip
    } else {
      // Handle inline bold
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      const rendered = parts.map((part, j) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={j}>{part.slice(2, -2)}</strong>;
        }
        return part;
      });
      elements.push(<p key={key++}>{rendered}</p>);
    }
  }

  return elements;
};

const mockSessions = [
  "Institutional memory search",
  "Road safety budget allocation",
  "Stormwater infrastructure",
  "Transit fare policy",
];

const SearchChatPage = ({ initialQuery }: { initialQuery?: string }) => {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialQuery
      ? [{ id: "u-init", role: "user", text: initialQuery }]
      : [],
  );
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(!!initialQuery);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  // Handle initial query
  useEffect(() => {
    if (!initialQuery) return;

    askAssistant(initialQuery)
      .then((response) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === "a-init")) return prev;
          return [
            ...prev,
            {
              id: "a-init",
              role: "assistant",
              text: response.answer ?? "No response received.",
            },
          ];
        });
        setThinking(false);
      })
      .catch(() => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === "a-init")) return prev;
          return [
            ...prev,
            {
              id: "a-init",
              role: "assistant",
              text: "Sorry, I was unable to search the transcripts at this time.",
            },
          ];
        });
        setThinking(false);
      });
  }, [initialQuery]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || thinking) return;
    setInput("");
    const userId = `u-${Date.now()}`;
    setMessages((prev) => [...prev, { id: userId, role: "user", text }]);
    setThinking(true);

    askAssistant(text)
      .then((response) => {
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: response.answer ?? "No response received.",
          },
        ]);
        setThinking(false);
      })
      .catch(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: "Sorry, I was unable to search the transcripts at this time.",
          },
        ]);
        setThinking(false);
      });
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
          href="#/home"
          className="msga-nav-item"
          onClick={(e) => {
            e.preventDefault();
            navigate("/home");
          }}
        >
          ← Home
        </a>
        <div className="msga-nav-item active">Search</div>
      </nav>

      {/* Chat layout */}
      <div className="search-chat-layout">
        {/* Sidebar */}
        <div className="search-chat-sidebar">
          <h3>Conversations</h3>
          {mockSessions.map((session, idx) => (
            <div
              key={session}
              className={`search-chat-session ${idx === 0 ? "active" : ""}`}
            >
              {session}
            </div>
          ))}
        </div>

        {/* Main chat */}
        <div className="search-chat-main">
          <div className="chat-messages">
            {messages.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: "4rem 2rem",
                  color: "#999",
                }}
              >
                <div
                  style={{
                    fontSize: "1.5rem",
                    fontFamily: "var(--msga-font-heading)",
                    fontWeight: 700,
                    color: "var(--msga-text)",
                    marginBottom: "0.5rem",
                  }}
                >
                  Search Council Records
                </div>
                <p style={{ fontSize: "0.9rem", maxWidth: "480px", margin: "0 auto", lineHeight: 1.6 }}>
                  Ask any question about council meetings, committee discussions,
                  and deliberations. Results are drawn from meeting transcripts,
                  agendas, and argument maps.
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`chat-msg ${msg.role}`}>
                {msg.role === "assistant"
                  ? renderChatMarkdown(msg.text)
                  : msg.text}
              </div>
            ))}
            {thinking && (
              <div className="chat-thinking">Searching transcripts…</div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input-area">
            <input
              className="chat-input"
              type="text"
              placeholder="Ask about any council meeting or topic…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              className="chat-send-btn"
              onClick={handleSend}
              disabled={thinking}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SearchChatPage;
