import { useEffect, useMemo, useRef, useState } from "react";
import { navigate } from "../App";
import { fetchSummaries, type SummaryListResponse } from "../api";
import { useTranscriptions } from "../hooks/useTranscriptions";
import { useArgumentMap } from "../hooks/useArgumentMap";
import { useAudioSnippets } from "../hooks/useAudioSnippets";
import {
  buildMeeting,
  type Meeting,
  type MeetingQuestion,
} from "../adapters/meetingAdapter";
import FloatingChat from "../components/FloatingChat";

const fmt = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
};

type AudioPlayerProps = {
  start: number;
  end: number;
  url?: string;
  loading?: boolean;
  error?: string;
  onLoad: () => void;
};

const AudioPlayer = ({
  start,
  end,
  url,
  loading,
  error,
  onLoad,
}: AudioPlayerProps) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="cdm-audio-wrap">
      <button
        className="cdm-audio-btn"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && !url && !loading) onLoad();
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M2 4.5h2l3-3v11l-3-3H2V4.5z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path
            d="M10 4a4 4 0 0 1 0 6"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <path
            d="M11.5 2.5a6.5 6.5 0 0 1 0 9"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        Audio segment
      </button>

      {open && (
        <div className="cdm-audio-player">
          <div className="cdm-audio-player-label">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M6 3v3l2 1"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            Sliced from meeting recording · {fmt(start)} – {fmt(end)}
          </div>
          {error ? (
            <div className="cdm-audio-error">{error}</div>
          ) : loading ? (
            <div className="cdm-audio-loading">Loading audio…</div>
          ) : url ? (
            <audio controls src={url} style={{ width: "100%" }} />
          ) : (
            <div className="cdm-audio-loading">Preparing snippet…</div>
          )}
        </div>
      )}
    </div>
  );
};

const ActivatableIframe = ({
  src,
  title,
  className,
}: {
  src: string;
  title: string;
  className?: string;
}) => {
  const [active, setActive] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setActive(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [active]);

  return (
    <div
      ref={wrapRef}
      className={`cdm-iframe-activatable ${active ? "cdm-iframe-active" : ""} ${className ?? ""}`}
    >
      <iframe src={src} title={title} allow="clipboard-write" />
      {!active && (
        <div className="cdm-iframe-overlay" onClick={() => setActive(true)}>
          <span className="cdm-iframe-overlay-hint">
            Click to interact with the deliberation map
          </span>
        </div>
      )}
    </div>
  );
};

const navItems = [
  "Services and programs",
  "Council",
  "Our organization",
  "Events and attractions",
  "Projects and strategies",
];

const isBuilding = (status: string) =>
  status === "queued" || status === "running";

const isLoadingMap = (status: string) =>
  status === "fetching" || status === "idle";

const buildingLabel = (status: string, message?: string): string => {
  if (message) return message;
  switch (status) {
    case "queued":
      return "Queued: building deliberation map from transcript…";
    case "running":
      return "Synthesizing the deliberation map. This can take a minute or two on long meetings.";
    default:
      return "Working on the deliberation map…";
  }
};

const QuestionSection = ({
  meetingId,
  question,
  audio,
}: {
  meetingId: string;
  question: MeetingQuestion;
  audio: ReturnType<typeof useAudioSnippets>;
}) => {
  const audioKey = `${meetingId}::${question.id}`;
  const url = audio.audioUrls[audioKey];
  const loading = !!audio.audioLoading[audioKey];
  const error = audio.audioError[audioKey];
  const onLoad = () =>
    audio.playSnippet(audioKey, question.audioSegment ?? null);

  return (
    <section id={`ng-${question.id}`} className="cdm-hero-section">
      <div className="cdm-section-inner">
        <h2 className="cdm-hero-question">
          {question.number}. {question.deliberativeQuestion}
        </h2>
        {question.summary && (
          <p className="cdm-hero-summary">{question.summary}</p>
        )}
        {question.decision && (
          <div className="cdm-decision-badge">{question.decision}</div>
        )}
        {question.audioSegment && (
          <AudioPlayer
            start={question.audioSegment.start}
            end={question.audioSegment.end}
            url={url}
            loading={loading}
            error={error}
            onLoad={onLoad}
          />
        )}
      </div>
      {question.negationGameUrl ? (
        <div className="cdm-hero-iframe-wrap">
          <ActivatableIframe
            src={question.negationGameUrl}
            title={question.deliberativeQuestion}
          />
        </div>
      ) : (
        <div className="cdm-section-inner">
          <div className="msga-callout">
            No deliberation board has been linked to this question yet.
          </div>
        </div>
      )}
    </section>
  );
};

const CdmPage = ({ meetingId }: { meetingId: string }) => {
  const { data: list, loading: listLoading, error: listError } = useTranscriptions();
  const argMap = useArgumentMap(meetingId, { autoFetch: true });
  const audio = useAudioSnippets(meetingId);

  const [summaries, setSummaries] = useState<SummaryListResponse | null>(null);
  const [summariesError, setSummariesError] = useState<string | null>(null);

  const item = useMemo(
    () => list.find((t) => t.id === meetingId),
    [list, meetingId],
  );

  useEffect(() => {
    let cancelled = false;
    setSummaries(null);
    setSummariesError(null);
    fetchSummaries(meetingId)
      .then((s) => {
        if (!cancelled) setSummaries(s);
      })
      .catch((err) => {
        if (!cancelled) {
          setSummariesError(
            err instanceof Error ? err.message : "Failed to load summary",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [meetingId]);

  const meeting: Meeting | null = useMemo(() => {
    if (!item) return null;
    return buildMeeting(item, argMap.payload, summaries);
  }, [item, argMap.payload, summaries]);

  // List query finished but no match → meeting not found
  if (!listLoading && list.length > 0 && !item) {
    return (
      <div style={{ padding: "3rem", textAlign: "center" }}>
        <p style={{ fontSize: "1.1rem", color: "#666" }}>
          Meeting not found: <code>{meetingId}</code>
        </p>
        <a
          href="#/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
          style={{ color: "var(--msga-link-blue)" }}
        >
          ← Back to Council Calendar
        </a>
      </div>
    );
  }

  const status = argMap.progress.status;
  const hasQuestions = !!meeting && meeting.questions.length > 0;
  const building = isBuilding(status);
  const loadingMap = isLoadingMap(status) && !hasQuestions;
  const errored = status === "error";
  const missing = status === "missing";

  return (
    <div className="cdm-page">
      <header className="msga-header">
        <a href="https://www.mississauga.ca" className="msga-header-logo">
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
      <nav className="msga-nav">
        {navItems.map((item) => (
          <div
            key={item}
            className={`msga-nav-item ${item === "Council" ? "active" : ""}`}
          >
            {item}
          </div>
        ))}
        <a
          href="#/chat"
          className="msga-nav-item msga-nav-item-cm"
          onClick={(e) => {
            e.preventDefault();
            navigate("/chat");
          }}
        >
          Civic Memory
        </a>
      </nav>
      <header className="cdm-header">
        <div className="cdm-header-left">
          <a
            href="#/"
            className="cdm-back-link"
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
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
          <div className="cdm-header-title">
            <span className="cdm-header-committee">
              {meeting?.committee ?? "Civic Deliberative Memory"}
            </span>
            <span className="cdm-header-date">
              {meeting?.date || (item?.title ?? meetingId)}
            </span>
          </div>
        </div>
        <div className="cdm-header-right">
          <a
            href={`#/topic/${meetingId}`}
            className="cdm-header-link"
            onClick={(e) => {
              e.preventDefault();
              navigate(`/topic/${meetingId}`);
            }}
          >
            Classic view
          </a>
        </div>
      </header>

      <div className="cdm-scroll">
        {(listLoading || loadingMap) && !errored && !missing && !building && (
          <div className="cdm-section-inner" style={{ padding: "1.5rem 0" }}>
            <div style={{ color: "#666" }}>Loading meeting…</div>
          </div>
        )}

        {(listError || summariesError) && (
          <div className="cdm-section-inner">
            <div className="msga-callout" style={{ color: "#c00" }}>
              {listError || summariesError}
            </div>
          </div>
        )}

        {building && (
          <div className="cdm-section-inner" style={{ padding: "1.5rem 0" }}>
            <div className="cdm-progress-callout">
              <span className="cdm-progress-spinner" />
              <span>{buildingLabel(status, argMap.progress.message)}</span>
            </div>
          </div>
        )}

        {errored && !building && (
          <div className="cdm-section-inner" style={{ padding: "1.5rem 0" }}>
            <div className="cdm-error-callout">
              <div style={{ marginBottom: "0.5rem" }}>
                <strong>Couldn't build the deliberation map.</strong>
              </div>
              {argMap.error && (
                <div style={{ marginBottom: "0.75rem", color: "#7a1f1f" }}>
                  {argMap.error}
                </div>
              )}
              <button
                className="cdm-action-btn"
                onClick={() => void argMap.ensure()}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {missing && !building && item && (
          <div className="cdm-empty-state">
            <div className="cdm-empty-icon">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="22" stroke="#ccc" strokeWidth="2" />
                <path
                  d="M16 24h16M24 16v16"
                  stroke="#ccc"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <h2>No deliberation map yet</h2>
            <p style={{ maxWidth: 480, margin: "0 auto 1rem" }}>
              This meeting's transcript hasn't been processed into a structured
              argument map yet. Generating one runs the full LLM pipeline over
              the transcript and usually takes a minute or two.
            </p>
            <button
              className="cdm-action-btn"
              onClick={() => void argMap.ensure()}
            >
              Generate argument map
            </button>
          </div>
        )}

        {hasQuestions &&
          meeting!.questions.map((q) => (
            <QuestionSection
              key={q.id}
              meetingId={meetingId}
              question={q}
              audio={audio}
            />
          ))}

        {hasQuestions && !building && (
          <div className="cdm-section-inner" style={{ padding: "0.5rem 0 1rem" }}>
            <button
              className="cdm-action-btn cdm-action-btn-ghost"
              onClick={() => void argMap.generate()}
              title="Re-run the LLM pipeline to produce a fresh version"
            >
              Regenerate argument map
            </button>
          </div>
        )}

        <div style={{ height: "5rem" }} />
      </div>

      {meeting && <FloatingChat meeting={meeting} />}
    </div>
  );
};

export default CdmPage;
