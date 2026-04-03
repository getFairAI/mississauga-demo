import { useState, useMemo } from "react";
import { navigate } from "../App";
import { useTranscriptions } from "../hooks/useTranscriptions";
import type { TranscriptListItem } from "../api";

const navItems = [
  "Services and programs",
  "Council",
  "Our organization",
  "Events and attractions",
  "Projects and strategies",
];

function groupByTopic(transcripts: TranscriptListItem[]): Record<string, TranscriptListItem[]> {
  return transcripts.reduce<Record<string, TranscriptListItem[]>>((acc, t) => {
    const key = t.topic ?? "Other";
    (acc[key] ??= []).push(t);
    return acc;
  }, {});
}

const MississaugaPage = () => {
  const { data: transcripts, loading, error } = useTranscriptions();
  const grouped = useMemo(() => groupByTopic(transcripts), [transcripts]);
  const topicNames = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (name: string) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--msga-bg)" }}>
      {/* Header */}
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

      {/* Main Nav */}
      <nav className="msga-nav">
        {navItems.map((item) => (
          <div
            key={item}
            className={`msga-nav-item ${item === "Council" ? "active" : ""}`}
          >
            {item}
          </div>
        ))}
      </nav>

      {/* Main content */}
      <div className="msga-container" style={{ paddingTop: "0.5rem" }}>
        {/* Breadcrumb */}
        <div className="msga-breadcrumb">
          <a href="#">Home</a>
          <span>/</span>
          <a href="#">Council</a>
          <span>/</span>
          <a href="#">Council activities</a>
          <span>/</span>
          Council and committees calendar
        </div>

        <div className="msga-main-grid">
          {/* Main content area */}
          <main>
            <h1 className="msga-page-title" style={{ color: "#1a1a1a" }}>
              Council and Committees calendar
            </h1>

            <div className="msga-content">
              <p>
                You can use the search and filter functions to find meetings and
                related documents, videos, agendas and minutes. Preset filters
                include:
              </p>

              <ul className="msga-content-list">
                <li>
                  <strong>Calendar</strong>, which provides a calendar view of
                  all meetings
                </li>
                <li>
                  <strong>List</strong>, which lists all meetings, starting with
                  upcoming meetings
                </li>
                <li>
                  <strong>Past</strong>, which lists only past meetings
                </li>
                <li>
                  <strong>Conflicts Registry</strong>, which lists all reported
                  conflicts of interest
                </li>
              </ul>

              <div className="msga-callout">
                All meeting records prior to May 2020 can be found on{" "}
                <a href="#">individual committee pages</a>. To obtain a copy of
                a meeting video recorded before May 2020, contact the committee
                coordinator for more information. The contact information can be
                found on the individual committee pages.
              </div>

              {/* Committee accordions */}
              {loading && (
                <div style={{ color: "#999", padding: "1rem 0", fontSize: "0.9rem" }}>
                  Loading meetings…
                </div>
              )}
              {error && (
                <div style={{ color: "#c00", padding: "1rem 0", fontSize: "0.9rem" }}>
                  {error}
                </div>
              )}
              <div className="msga-accordion-list">
                {topicNames.map((topic) => {
                  const meetings = grouped[topic];
                  const isOpen = !!expanded[topic];
                  return (
                    <div key={topic} className="msga-accordion">
                      <button
                        className="msga-accordion-header"
                        onClick={() => toggle(topic)}
                        aria-expanded={isOpen}
                      >
                        <span className="msga-accordion-title">
                          {topic} ({meetings.length})
                        </span>
                        <span className="msga-accordion-chevron">
                          {isOpen ? "\u203A" : "\u02C7"}
                        </span>
                      </button>
                      {isOpen && (
                        <div className="msga-accordion-body">
                          {meetings.map((t) => (
                            <div key={t.id} className="msga-meeting-row">
                              <div className="msga-meeting-left">
                                <div className="msga-meeting-share">
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="#999"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                                    <polyline points="16 6 12 2 8 6" />
                                    <line x1="12" y1="2" x2="12" y2="15" />
                                  </svg>
                                </div>
                                <div>
                                  <a href="#" className="msga-meeting-name">
                                    {t.title}
                                  </a>
                                  <a
                                    href={`#/topic/${t.id}`}
                                    className="msga-meeting-louie-link"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      navigate(`/topic/${t.id}`);
                                    }}
                                  >
                                    Civic Deliberative Memory
                                  </a>
                                </div>
                              </div>
                              <div className="msga-meeting-right">
                                {t.duration !== null && (
                                  <div className="msga-meeting-doc-group">
                                    <a href="#" className="msga-meeting-video">
                                      Video
                                    </a>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </main>

          {/* Sidebar */}
          <aside>
            <div className="msga-sidebar-section">
              <h2>Related</h2>

              <a href="#" className="msga-sidebar-link">
                Live Council and Committee videos
              </a>
              <a href="#" className="msga-sidebar-link">
                Live press conferences and events
              </a>
              <a href="#" className="msga-sidebar-link">
                Archived videos
              </a>
              <a href="#" className="msga-sidebar-link">
                Subscribe to agendas and minutes
              </a>

              <div
                style={{
                  borderBottom: "1px solid var(--msga-border)",
                  margin: "0.5rem 0",
                }}
              />

              {/* Louie entry point - highlighted */}
              <a
                href="#/home"
                className="msga-sidebar-link louie-link"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/home");
                }}
              >
                Civic Deliberative Memory
              </a>
            </div>
          </aside>
        </div>
      </div>

      {/* Footer */}
      <footer className="msga-footer">
        <div className="msga-container">
          <div className="msga-footer-grid">
            <div>
              <div className="msga-footer-section-title">Find</div>
              <ul className="msga-footer-links">
                <li>
                  <a href="#">Publications</a>
                </li>
                <li>
                  <a href="#">Pay, apply and report</a>
                </li>
                <li>
                  <a href="#">Services A to Z</a>
                </li>
              </ul>
            </div>
            <div>
              <div className="msga-footer-section-title">Get in touch</div>
              <ul className="msga-footer-links">
                <li>
                  <a href="#">Contact us</a>
                </li>
                <li>
                  <a href="#">Get email updates</a>
                </li>
              </ul>
            </div>
            <div>
              <div className="msga-footer-section-title">Social</div>
              <ul className="msga-footer-links">
                <li>
                  <a href="#">X (Twitter)</a>
                </li>
                <li>
                  <a href="#">Facebook</a>
                </li>
                <li>
                  <a href="#">LinkedIn</a>
                </li>
                <li>
                  <a href="#">YouTube</a>
                </li>
                <li>
                  <a href="#">Instagram</a>
                </li>
              </ul>
            </div>
          </div>
          <div className="msga-footer-divider" />
          <div className="msga-footer-bottom">
            <div>&copy; City of Mississauga 2019–2026</div>
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

export default MississaugaPage;
