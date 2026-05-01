import { useState, useEffect, useRef, useCallback, type JSX } from "react";
import { navigate } from "../App";
import {
  askAssistant,
  createChatSession,
  listChatSessions,
  loadChatSession,
  type ChatSessionSummary,
} from "../api";

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

const ACTIVE_SESSION_KEY = "civic.activeChatSession";

const makeSessionTitle = (text: string): string => {
  const s = text.trim();
  return s.length <= 7 ? s : s.slice(0, 7) + "...";
};

const navItems = [
  "Services and programs",
  "Council",
  "Our organization",
  "Events and attractions",
  "Projects and strategies",
];

const SearchChatPage = ({ initialQuery }: { initialQuery?: string }) => {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialQuery
      ? [{ id: "u-init", role: "user", text: initialQuery }]
      : [],
  );
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(!!initialQuery);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Mirror sessionId in a ref so async callbacks always see the latest value
  // without re-triggering the initial-query effect.
  const sessionIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    sessionIdRef.current = sessionId;
    if (sessionId) {
      localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
    }
  }, [sessionId]);

  const refreshSessions = useCallback(() => {
    listChatSessions()
      .then(setSessions)
      .catch(() => {
        // Sessions list is non-critical UI; ignore failures.
      });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  // Restore last active session on mount when there's no initialQuery.
  // initialQuery means "start a fresh chat with this question", so we skip
  // restoration in that case.
  useEffect(() => {
    if (initialQuery) return;
    const stored = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!stored) return;
    let cancelled = false;
    loadChatSession(stored)
      .then((data) => {
        if (cancelled || !data) return;
        setSessionId(data.id);
        setMessages(
          data.messages.map((m, idx) => ({
            id: `${data.id}-${idx}`,
            role: m.role,
            text: m.content,
          })),
        );
      })
      .catch(() => {
        // Stale id — drop it so we don't keep failing on every mount.
        localStorage.removeItem(ACTIVE_SESSION_KEY);
      });
    return () => {
      cancelled = true;
    };
  }, [initialQuery]);

  // Handle initial query (?q=...) — entries from the / or /cdm search bars.
  // Eagerly mint a session with a short title derived from the query so the
  // conversation shows up in the sidebar before the LLM response lands.
  useEffect(() => {
    if (!initialQuery) return;
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    setSessionId(undefined);
    sessionIdRef.current = undefined;

    let cancelled = false;
    const appendError = () => {
      if (cancelled) return;
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
    };

    createChatSession(makeSessionTitle(initialQuery))
      .then((session) => {
        if (cancelled) return null;
        setSessionId(session.id);
        sessionIdRef.current = session.id;
        refreshSessions();
        return askAssistant(initialQuery, session.id);
      })
      .then((response) => {
        if (cancelled || !response) return;
        if (response.session_id) setSessionId(response.session_id);
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
        refreshSessions();
      })
      .catch(appendError);

    return () => {
      cancelled = true;
    };
  }, [initialQuery, refreshSessions]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || thinking) return;
    setInput("");
    const userId = `u-${Date.now()}`;
    setMessages((prev) => [...prev, { id: userId, role: "user", text }]);
    setThinking(true);

    askAssistant(text, sessionIdRef.current)
      .then((response) => {
        if (response.session_id) setSessionId(response.session_id);
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: response.answer ?? "No response received.",
          },
        ]);
        setThinking(false);
        refreshSessions();
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

  const handleSelectSession = (id: string) => {
    if (id === sessionId || thinking) return;
    loadChatSession(id)
      .then((data) => {
        if (!data) return;
        setSessionId(data.id);
        setMessages(
          data.messages.map((m, idx) => ({
            id: `${data.id}-${idx}`,
            role: m.role,
            text: m.content,
          })),
        );
      })
      .catch(() => {
        // Surface a subtle inline error rather than silent failure.
        setMessages([
          {
            id: `e-${Date.now()}`,
            role: "assistant",
            text: "Couldn't load that conversation.",
          },
        ]);
      });
  };

  const handleNewChat = () => {
    if (thinking) return;
    setSessionId(undefined);
    sessionIdRef.current = undefined;
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    setMessages([]);
  };

  return (
    <div className="search-chat-page" style={{ background: "var(--msga-bg)" }}>
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
        <div className="msga-header-search">
          <input type="text" placeholder="Search mississauga.ca" />
          <button>Search</button>
        </div>
      </header>

      {/* Nav */}
      <nav className="msga-nav">
        {navItems.map((item) => (
          <div key={item} className="msga-nav-item">
            {item}
          </div>
        ))}
        <a
          href="#/chat"
          className="msga-nav-item msga-nav-item-cm active"
          onClick={(e) => {
            e.preventDefault();
            navigate("/chat");
          }}
        >
          Civic Memory
        </a>
      </nav>

      {/* Chat layout */}
      <div className="search-chat-layout">
        {/* Sidebar */}
        <div className="search-chat-sidebar">
          <div className="search-chat-sidebar-head">
            <h3>Conversations</h3>
            <button
              type="button"
              className="search-chat-new-btn"
              onClick={handleNewChat}
              disabled={thinking}
              title="Start a new conversation"
            >
              + New
            </button>
          </div>
          {sessions.length === 0 && (
            <div className="search-chat-sidebar-empty">
              No conversations yet.
            </div>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`search-chat-session ${s.id === sessionId ? "active" : ""}`}
              onClick={() => handleSelectSession(s.id)}
              title={s.title ?? "Untitled conversation"}
            >
              {s.title ?? "New conversation"}
            </div>
          ))}
        </div>

        {/* Main chat */}
        <div className="search-chat-main">
          <div className="search-chat-subheader">
            <a
              href="#/"
              className="cdm-back-link"
              onClick={(e) => {
                e.preventDefault();
                navigate("/");
              }}
              title="Back"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M10 12L6 8L10 4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
            <span className="search-chat-subheader-title">
              Civic Memory Search
            </span>
          </div>
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
