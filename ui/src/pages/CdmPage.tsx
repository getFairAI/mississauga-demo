import { useEffect } from "react";
import { navigate } from "../App";
import { getMeeting, roadSafetyArgumentMap } from "../data/mockData";
import FloatingChat from "../components/FloatingChat";
import ArgumentMap from "../components/ArgumentMap";

const CdmPage = ({ meetingId }: { meetingId: string }) => {
  const meeting = getMeeting(meetingId);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [meetingId]);

  if (!meeting) {
    return (
      <div style={{ padding: "3rem", textAlign: "center" }}>
        <p style={{ fontSize: "1.1rem", color: "#666" }}>Meeting not found.</p>
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

  const hasQuestions = meeting.questions.length > 0;
  // The first question with a negation game is the "hero"
  const heroQuestion = meeting.questions.find((q) => q.negationGameUrl);
  const otherQuestions = meeting.questions.filter(
    (q) => q.id !== heroQuestion?.id,
  );

  // Collect all key quotes from all questions
  const allQuotes = meeting.questions.flatMap(
    (q) =>
      q.keyQuotes?.map((kq) => ({
        ...kq,
        topic: q.label,
      })) ?? [],
  );

  return (
    <div className="cdm-page">
      {/* Compact header */}
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
            <span className="cdm-header-committee">{meeting.committee}</span>
            <span className="cdm-header-date">{meeting.date}</span>
          </div>
        </div>
        <div className="cdm-header-right">
          {meeting.agendaHtmlUrl && (
            <a
              href={meeting.agendaHtmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="cdm-header-link"
            >
              Agenda
            </a>
          )}
          {meeting.videoUrl && (
            <a
              href={meeting.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="cdm-header-link"
            >
              Video
            </a>
          )}
        </div>
      </header>

      {/* Scrollable content */}
      <div className="cdm-scroll">
        {hasQuestions ? (
          <>
            {/* Hero negation game */}
            {heroQuestion && (
              <section className="cdm-hero-section">
                <div className="cdm-section-inner">
                  <div className="cdm-hero-label">Primary deliberation</div>
                  <h2 className="cdm-hero-question">
                    {heroQuestion.deliberativeQuestion}
                  </h2>
                  <p className="cdm-hero-summary">{heroQuestion.summary}</p>
                  {heroQuestion.decision && (
                    <div className="cdm-decision-badge">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                      >
                        <circle
                          cx="7"
                          cy="7"
                          r="6"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        />
                        <path
                          d="M4.5 7L6.5 9L9.5 5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {heroQuestion.decision}
                    </div>
                  )}
                </div>
                <div className="cdm-hero-iframe-wrap">
                  <iframe
                    src={heroQuestion.negationGameUrl}
                    title={heroQuestion.deliberativeQuestion}
                    allow="clipboard-write"
                  />
                </div>
              </section>
            )}

            {/* Argument Map */}
            {meeting.id === "road-safety-2026-01-27" && (
              <section className="cdm-argmap-section">
                <ArgumentMap
                  questions={roadSafetyArgumentMap}
                />
              </section>
            )}

            {/* Other topics */}
            {otherQuestions.length > 0 && (
              <section className="cdm-topics-section">
                <div className="cdm-section-inner">
                  <h2 className="cdm-section-title">
                    Other topics discussed
                  </h2>
                </div>
                <div className="cdm-topics-grid">
                  {otherQuestions.map((q) => (
                    <div key={q.id} className="cdm-topic-card">
                      <div className="cdm-topic-card-header">
                        <h3 className="cdm-topic-card-question">
                          {q.deliberativeQuestion}
                        </h3>
                        {q.decision && (
                          <span className="cdm-topic-card-decision">
                            {q.decision}
                          </span>
                        )}
                      </div>
                      <p className="cdm-topic-card-summary">{q.summary}</p>
                      {q.keyQuotes && q.keyQuotes.length > 0 && (
                        <blockquote className="cdm-topic-card-quote">
                          <span className="cdm-topic-card-quote-text">
                            "{q.keyQuotes[0].quote}"
                          </span>
                          <cite>
                            — {q.keyQuotes[0].speaker}
                            {q.keyQuotes[0].role
                              ? `, ${q.keyQuotes[0].role}`
                              : ""}
                          </cite>
                        </blockquote>
                      )}
                      {q.negationGameUrl && (
                        <div className="cdm-topic-card-iframe-wrap">
                          <iframe
                            src={q.negationGameUrl}
                            title={q.deliberativeQuestion}
                            allow="clipboard-write"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Key statements */}
            {allQuotes.length > 0 && (
              <section className="cdm-quotes-section">
                <div className="cdm-section-inner">
                  <h2 className="cdm-section-title">Key statements</h2>
                  <div className="cdm-quotes-grid">
                    {allQuotes.map((q, i) => (
                      <div key={i} className="cdm-quote-card">
                        <div className="cdm-quote-topic">{q.topic}</div>
                        <blockquote className="cdm-quote-text">
                          "{q.quote}"
                        </blockquote>
                        <div className="cdm-quote-speaker">
                          {q.speaker}
                          {q.role ? `, ${q.role}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </>
        ) : (
          <div className="cdm-empty-state">
            <div className="cdm-empty-icon">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <circle
                  cx="24"
                  cy="24"
                  r="22"
                  stroke="#ccc"
                  strokeWidth="2"
                />
                <path
                  d="M16 24h16M24 16v16"
                  stroke="#ccc"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <h2>Deliberation map not yet available</h2>
            <p>
              This meeting's transcript is being processed. The structured
              argument map will appear here once it's ready.
            </p>
          </div>
        )}

        {/* Spacer for floating chat bar */}
        <div style={{ height: "5rem" }} />
      </div>

      {/* Floating chat */}
      <FloatingChat meeting={meeting} />
    </div>
  );
};

export default CdmPage;
