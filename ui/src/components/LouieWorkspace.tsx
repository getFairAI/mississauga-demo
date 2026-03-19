import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import StarBorderRoundedIcon from "@mui/icons-material/StarBorderRounded";
import { formatDuration } from "../utils/formatDuration";
import { formatTranscriptTitle } from "../utils/formatTranscriptTitle";
import { useTranscriptions } from "../hooks/useTranscriptions";
import { useTranscriptionData } from "../hooks/useTranscriptionData";
import { useArgumentMap } from "../hooks/useArgumentMap";
import { useAudioSnippets } from "../hooks/useAudioSnippets";
import { type ChatEntry } from "./Chat";
import { askAssistant } from "../api";

type TabKey = "graph" | "chat";

const brandBlue = "#0057A8";

const louieIcon = (
  <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden>
    <rect x="1" y="1" width="14" height="10" rx="2.5" fill="currentColor" />
    <circle cx="5" cy="6" r="1.3" fill="white" />
    <circle cx="8" cy="6" r="1.3" fill="white" />
    <circle cx="11" cy="6" r="1.3" fill="white" />
    <path
      d="M4 13 L6.5 11h3"
      stroke="white"
      strokeWidth={1.4}
      fill="none"
      strokeLinejoin="round"
    />
  </svg>
);

const LouieWorkspace = () => {
  const { data: transcripts, loading: loadingTranscripts, error: listError } = useTranscriptions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("graph");

  const {
    loading: loadingTranscript,
    error: transcriptError,
  } = useTranscriptionData(selectedId, { enabled: Boolean(selectedId) });

  const {
    payload: argumentPayload,
    progress: argumentProgress,
    error: argumentError,
    ensure: ensureArgumentMap,
  } = useArgumentMap(selectedId);

  const { audioUrls, audioLoading, audioError, playSnippet } = useAudioSnippets(selectedId);

  const [messages, setMessages] = useState<ChatEntry[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "I can surface answers from the transcripts, highlights, and summaries in this workspace.",
    },
  ]);
  const [prompt, setPrompt] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  useEffect(() => {
    if (tab === "graph") {
      void ensureArgumentMap();
    }
  }, [tab, ensureArgumentMap]);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof transcripts> = {};
    transcripts.forEach((t) => {
      const topic = t.topic || "Council";
      if (!groups[topic]) groups[topic] = [];
      groups[topic].push(t);
    });
    return groups;
  }, [transcripts]);

  const topics = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  const selectedMeta = useMemo(
    () => transcripts.find((t) => t.id === selectedId) ?? null,
    [transcripts, selectedId],
  );

  const currentMeetingLabel = useMemo(() => {
    if (!selectedMeta) return "Select a meeting";
    return `${formatTranscriptTitle(selectedMeta.title)}`;
  }, [selectedMeta]);

  const dateFromTitle = (title?: string | null) => {
    if (!title) return "";
    const match = title.match(/\b(\w{3,9}\s+\d{1,2},\s*\d{4})/i);
    return match ? match[1] : title;
  };

  const argumentBusy = ["fetching", "queued", "running"].includes(argumentProgress.status);

  const handleSend = async (value?: string) => {
    const text = (value ?? prompt).trim();
    if (!text || chatLoading) return;
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text }]);
    setPrompt("");
    setChatError(null);
    setChatLoading(true);
    try {
      const res = await askAssistant(text);
      const answer =
        (res.answer ?? "").trim() ||
        (res.type === "chart"
          ? "Generated a chart based on the workspace knowledge."
          : "The assistant did not return an answer.");
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: answer,
          chart: res.type === "chart" ? res.chart : undefined,
          sources: res.sources,
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not reach the assistant.";
      setChatError(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: "I hit an error while trying to answer that. Please try again.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const coreQuestions = argumentPayload?.argument_map?.core_questions ?? [];

  return (
    <Box sx={{ width: "100%", minHeight: "100vh", bgcolor: "#f5f5f5" }}>
      {/* City header + nav */}
      <Box sx={{ background: brandBlue, height: 52, display: "flex", alignItems: "center", px: 2 }}>
        <Typography sx={{ color: "white", fontSize: 15, fontWeight: 700, letterSpacing: 1.5 }}>
          ⊠ MISSISSAUGA
        </Typography>
      </Box>
      <Box
        sx={{
          background: "#1a6fc4",
          display: "flex",
          px: 2,
          overflowX: "auto",
          gap: 1,
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {["Services and programs", "Council", "Our organization", "Events and attractions", "Projects and strategies"].map(
          (label, idx) => (
            <Box
              key={label}
              sx={{
                fontSize: 12,
                color: idx === 1 ? "white" : "rgba(255,255,255,0.85)",
                px: 1.75,
                py: 1.2,
                borderBottom: idx === 1 ? "3px solid white" : "3px solid transparent",
                whiteSpace: "nowrap",
                fontWeight: idx === 1 ? 600 : 400,
              }}
            >
              {label}
            </Box>
          ),
        )}
      </Box>

      <Box sx={{ px: 2.5, py: 2, width: "100%" }}>
        <Typography sx={{ fontSize: 12, color: "#555", mb: 1.4 }}>
          <Box component="span" sx={{ color: brandBlue, cursor: "pointer" }}>
            Home
          </Box>
          <Box component="span" sx={{ mx: 0.6, color: "#aaa" }}>
            /
          </Box>
          <Box component="span" sx={{ color: brandBlue, cursor: "pointer" }}>
            Council
          </Box>
          <Box component="span" sx={{ mx: 0.6, color: "#aaa" }}>
            /
          </Box>
          Council activities
        </Typography>

        <Typography sx={{ fontSize: 22, fontWeight: 700, color: "#1a1a1a", mb: 1.5 }}>
          Council and Committees calendar
        </Typography>

        {/* Search + list */}
        <Stack spacing={1.25}>
          <TextField
            placeholder="Search meetings…"
            size="small"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ maxWidth: 420, background: "white" }}
          />

          {loadingTranscripts && <LinearProgress sx={{ borderRadius: 1 }} />}
          {listError ? <Alert severity="error">{listError}</Alert> : null}

          {topics.map((topic) => {
            const items = grouped[topic] ?? [];
            return (
              <Box
                key={topic}
                sx={{
                  border: "1px solid #ccc",
                  borderRadius: "2px",
                  overflow: "hidden",
                  bgcolor: "white",
                }}
              >
                <Box
                  sx={{
                    bgcolor: brandBlue,
                    color: "white",
                    px: 2,
                    py: 1.1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  <span>{`${topic} (${items.length})`}</span>
                  <span>›</span>
                </Box>
                {items.map((item) => {
                  const isSelected = item.id === selectedId;
                  const label = dateFromTitle(item.title);
                  return (
                    <Box
                      key={item.id}
                      sx={{
                        borderTop: "1px solid #eee",
                        px: 2,
                        py: 1.4,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 2,
                        alignItems: "flex-start",
                        bgcolor: isSelected ? "#f7fbff" : "white",
                        cursor: "pointer",
                      }}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <Stack spacing={0.4} sx={{ minWidth: 200, flex: 1 }}>
                        <Typography
                          sx={{
                            fontSize: 13,
                            color: brandBlue,
                            fontWeight: 600,
                            textDecoration: "none",
                          }}
                        >
                          {formatTranscriptTitle(item.title)}
                        </Typography>
                        <Typography sx={{ fontSize: 12, color: "#555", lineHeight: 1.6 }}>
                          {label || "Meeting"} • {formatDuration(item.duration)} • {item.line_count} lines
                        </Typography>
                      </Stack>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography sx={{ fontSize: 12, color: "#555" }}>☐ Transcript</Typography>
                        <Divider flexItem orientation="vertical" />
                        <Typography sx={{ fontSize: 12, color: "#555" }}>Agenda</Typography>
                        <Divider flexItem orientation="vertical" />
                        <Typography sx={{ fontSize: 12, color: "#555" }}>Minutes</Typography>
                        <Divider flexItem orientation="vertical" />
                        <Box
                          component="span"
                          sx={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 0.5,
                            fontSize: 12,
                            color: brandBlue,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setTab("graph");
                            setSelectedId(item.id);
                            void ensureArgumentMap();
                          }}
                        >
                          <StarBorderRoundedIcon fontSize="inherit" sx={{ mt: "-2px" }} />
                          Arg. Map
                        </Box>
                      </Stack>
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Stack>

        {/* Louie panel */}
        {selectedId && (
          <Box
            sx={{
              mt: 2,
              border: "1px solid #d6e2f0",
              borderRadius: "4px",
              overflow: "hidden",
              background: "white",
            }}
          >
            <Box sx={{ px: 2, pt: 1.25, pb: 1, borderBottom: "1px solid #e0e8f0" }}>
              <Stack direction="row" alignItems="center" spacing={1.25} mb={1}>
                <Box
                  sx={{
                    width: 28,
                    height: 28,
                    borderRadius: "6px",
                    bgcolor: brandBlue,
                    color: "white",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {louieIcon}
                </Box>
                <Stack spacing={0.2}>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: "#222" }}>
                    {currentMeetingLabel}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: "#888" }}>
                    Argument graph + transcript chat
                  </Typography>
                </Stack>
                <Box sx={{ flex: 1 }} />
                <Chip
                  label="Close"
                  size="small"
                  onClick={() => setSelectedId(null)}
                  sx={{ fontSize: 11, bgcolor: "#f5f5f5" }}
                />
              </Stack>

              <Typography sx={{ fontSize: 11, color: "#888", mb: 1 }}>
                {dateFromTitle(selectedMeta?.title)}
              </Typography>

              <Stack direction="row" spacing={3} sx={{ borderBottom: "1px solid #e0e8f0" }}>
                {(["graph", "chat"] as TabKey[]).map((key) => (
                  <Typography
                    key={key}
                    component="button"
                    onClick={() => setTab(key)}
                    sx={{
                      border: "none",
                      background: "none",
                      fontSize: 13,
                      px: 1.8,
                      py: 0.8,
                      cursor: "pointer",
                      color: tab === key ? brandBlue : "#888",
                      borderBottom: tab === key ? `2px solid ${brandBlue}` : "2px solid transparent",
                      fontWeight: tab === key ? 600 : 400,
                    }}
                  >
                    {key === "graph" ? "Argument graph" : "Chat"}
                  </Typography>
                ))}
              </Stack>
              {loadingTranscript && <LinearProgress sx={{ borderRadius: 0, height: 3 }} />}
              {transcriptError ? <Alert severity="error" sx={{ mt: 1 }}>{transcriptError}</Alert> : null}
            </Box>

            {tab === "graph" && (
              <Box sx={{ bgcolor: "white", minHeight: 360 }}>
                {argumentError && <Alert severity="error">{argumentError}</Alert>}
                {argumentBusy && (
                  <Stack spacing={0.5} p={2}>
                    <LinearProgress />
                    <Typography variant="caption" color="text.secondary">
                      {argumentProgress.status === "fetching"
                        ? "Loading key items…"
                        : argumentProgress.status === "queued"
                          ? "Key items queued"
                          : "Building key items…"}
                    </Typography>
                  </Stack>
                )}
                {!argumentBusy && coreQuestions.length === 0 && (
                  <Typography sx={{ p: 2, fontSize: 13, color: "#666" }}>
                    Open this tab to fetch key items. If none exist yet, we will start generating them.
                  </Typography>
                )}

                {coreQuestions.length > 0 && (
                  <Stack spacing={1.5} p={2}>
                    {coreQuestions.map((cq, idx) => {
                      const range = cq.evidence?.[0]?.timestamp
                        ? (() => {
                            const cleaned = (cq.evidence?.[0]?.timestamp || "").replace(/[\[\]\s]/g, "");
                            const parts = cleaned.split(/[-–]/);
                            if (parts.length !== 2) return null;
                            const toSeconds = (raw: string) =>
                              raw.includes(":")
                                ? raw.split(":").reduce((acc, cur) => acc * 60 + Number(cur), 0)
                                : Number(raw);
                            const start = toSeconds(parts[0]);
                            const end = toSeconds(parts[1]);
                            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
                            return { start, end };
                          })()
                        : null;
                      const key = `${selectedId ?? "q"}-${idx}`;
                      return (
                        <Box
                          key={`${cq.question}-${idx}`}
                          sx={{
                            border: "1px solid #e0e8f0",
                            borderRadius: 2,
                            p: 1.25,
                            display: "flex",
                            flexDirection: "column",
                            gap: 0.5,
                            background: "#fafcff",
                          }}
                        >
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Chip size="small" label={cq.type || "question"} color="primary" variant="outlined" />
                            {cq.unresolved && <Chip size="small" label="Unresolved" color="warning" variant="outlined" />}
                            {range && (
                              <Chip
                                size="small"
                                label={`[${range.start.toFixed(1)}s - ${range.end.toFixed(1)}s]`}
                                variant="outlined"
                              />
                            )}
                          </Stack>
                          <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>{cq.question || "Question"}</Typography>
                          {Array.isArray(cq.options_or_claims) && cq.options_or_claims.length > 0 && (
                            <Stack spacing={0.4}>
                              {cq.options_or_claims.map((opt, i) => (
                                <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                                  <Chip size="small" label={opt.label || `Option ${i + 1}`} color="secondary" variant="outlined" />
                                  <Typography sx={{ fontSize: 13 }}>{opt.claim}</Typography>
                                </Stack>
                              ))}
                            </Stack>
                          )}
                          {Array.isArray(cq.evidence) && cq.evidence.length > 0 && (
                            <Stack spacing={0.5} mt={0.5}>
                              <Typography sx={{ fontSize: 12, color: "#777" }}>Evidence</Typography>
                              {cq.evidence.map((ev, evIdx) => {
                                const evKey = `${key}-ev-${evIdx}`;
                                const evRange = ev.timestamp
                                  ? (() => {
                                      const cleaned = ev.timestamp.replace(/[\[\]\s]/g, "");
                                      const parts = cleaned.split(/[-–]/);
                                      if (parts.length !== 2) return null;
                                      const toSeconds = (raw: string) =>
                                        raw.includes(":")
                                          ? raw.split(":").reduce((acc, cur) => acc * 60 + Number(cur), 0)
                                          : Number(raw);
                                      const start = toSeconds(parts[0]);
                                      const end = toSeconds(parts[1]);
                                      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
                                      return { start, end };
                                    })()
                                  : null;
                                return (
                                  <Box key={evKey}>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                      <IconButton
                                        size="small"
                                        onClick={() => void playSnippet(evKey, evRange)}
                                        disabled={!evRange}
                                        hidden={!!audioUrls[evKey]}
                                      >
                                        {audioLoading[evKey] ? (
                                          <CircularProgress size={18} thickness={6} />
                                        ) : (
                                          <PlayArrowRoundedIcon />
                                        )}
                                      </IconButton>
                                      <Typography sx={{ fontSize: 13, color: "#444" }}>
                                        {ev.timestamp ? `[${ev.timestamp}] ` : ""}
                                        {ev.speaker ? `${ev.speaker}: ` : ""}
                                        “{ev.quote}”
                                      </Typography>
                                    </Stack>
                                    {audioUrls[evKey] && (
                                      <Box sx={{ mt: 0.5 }}>
                                        <audio controls src={audioUrls[evKey]} style={{ width: "100%" }} />
                                      </Box>
                                    )}
                                    {audioError[evKey] && (
                                      <Typography sx={{ fontSize: 12, color: "error.main", mt: 0.25 }}>
                                        {audioError[evKey]}
                                      </Typography>
                                    )}
                                  </Box>
                                );
                              })}
                            </Stack>
                          )}
                        </Box>
                      );
                    })}
                  </Stack>
                )}
              </Box>
            )}

            {tab === "chat" && (
              <Box sx={{ background: "#f7f8fa" }}>
                <Box
                  sx={{
                    display: "flex",
                    gap: 1,
                    px: 2,
                    py: 1,
                    background: "white",
                    borderBottom: "1px solid #e8e8e8",
                    overflowX: "auto",
                    "&::-webkit-scrollbar": { display: "none" },
                  }}
                >
                  {[
                    "What was discussed in this meeting?",
                    "How many meetings took place this year?",
                    "What are the most relevant results from this year's meetings?",
                    "In the budget meeting what did the mayor say?",
                  ].map((chip) => (
                    <Chip
                      key={chip}
                      label={chip}
                      onClick={() => handleSend(chip)}
                      variant="outlined"
                      sx={{
                        fontSize: 11,
                        borderRadius: "20px",
                        borderColor: "#d0d8e8",
                        color: "#444",
                        background: "white",
                        "&:hover": { background: "#e8f0fb", borderColor: brandBlue, color: brandBlue },
                      }}
                    />
                  ))}
                </Box>
                <Box sx={{ display: "flex", height: "calc(100vh - 320px)", minHeight: 360, overflow: "hidden" }}>
                  <Box
                    sx={{
                      width: 200,
                      flexShrink: 0,
                      background: "white",
                      borderRight: "1px solid #e8e8e8",
                      p: 1.4,
                      display: "flex",
                      flexDirection: "column",
                      gap: 1.2,
                    }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box
                        sx={{
                          width: 30,
                          height: 30,
                          borderRadius: "8px",
                          background: brandBlue,
                          color: "white",
                          display: "grid",
                          placeItems: "center",
                        }}
                      >
                        {louieIcon}
                      </Box>
                      <Stack spacing={0.1}>
                        <Typography sx={{ fontSize: 13, fontWeight: 600, color: "#222" }}>louie</Typography>
                        <Typography
                          component="a"
                          href="https://louie.npw.com"
                          sx={{ fontSize: 10, color: brandBlue, textDecoration: "none" }}
                        >
                          louie.npw.com
                        </Typography>
                      </Stack>
                    </Stack>
                    <Box sx={{ fontSize: 11, color: "#aaa", lineHeight: 1.7, borderTop: "1px solid #eee", pt: 1 }}>
                      <strong style={{ color: "#555", fontWeight: 500 }}>Committee:</strong>
                      <br />
                      {selectedMeta?.topic || "—"}
                      <br />
                      <br />
                      <strong style={{ color: "#555", fontWeight: 500 }}>Meeting:</strong>
                      <br />
                      {dateFromTitle(selectedMeta?.title) || "—"}
                      <br />
                      <br />
                      <strong style={{ color: "#555", fontWeight: 500 }}>Sources:</strong>
                      <br />
                      Transcript · Agenda · Minutes
                    </Box>
                  </Box>
                  <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <Box
                      sx={{
                        flex: 1,
                        overflowY: "auto",
                        p: 1.5,
                        display: "flex",
                        flexDirection: "column",
                        gap: 1.25,
                      }}
                    >
                      {messages.map((msg) => {
                        const isUser = msg.role === "user";
                        return (
                          <Box
                            key={msg.id}
                            sx={{
                              display: "flex",
                              gap: 1.25,
                              alignItems: "flex-start",
                              maxWidth: "88%",
                              alignSelf: isUser ? "flex-end" : "flex-start",
                              flexDirection: isUser ? "row-reverse" : "row",
                            }}
                          >
                            <Box
                              sx={{
                                width: 28,
                                height: 28,
                                borderRadius: isUser ? "50%" : "8px",
                                background: isUser ? "#e2672a" : brandBlue,
                                color: "white",
                                display: "grid",
                                placeItems: "center",
                                fontSize: 10,
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {isUser ? "YOU" : louieIcon}
                            </Box>
                            <Box
                              sx={{
                                fontSize: 12,
                                lineHeight: 1.65,
                                px: 1.25,
                                py: 1,
                                borderRadius: isUser ? "12px 4px 12px 12px" : "4px 12px 12px 12px",
                                background: isUser ? brandBlue : "white",
                                color: isUser ? "white" : "#222",
                                border: isUser ? `1px solid ${brandBlue}` : "1px solid #e0e8f0",
                                maxWidth: "100%",
                              }}
                            >
                              {msg.text}
                            </Box>
                          </Box>
                        );
                      })}
                      {chatLoading && (
                        <Typography sx={{ fontSize: 12, color: "#777" }}>Assistant is thinking…</Typography>
                      )}
                    </Box>
                    {chatError ? <Alert severity="error" sx={{ mx: 1.5 }}>{chatError}</Alert> : null}
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={{
                        px: 1.5,
                        py: 1,
                        background: "white",
                        borderTop: "1px solid #e8e8e8",
                      }}
                    >
                      <TextField
                        fullWidth
                        placeholder="Ask about any video or transcript…"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void handleSend();
                          }
                        }}
                        size="small"
                        InputProps={{
                          sx: {
                            borderRadius: "20px",
                            bgcolor: "#f7f8fa",
                            "&:hover": { bgcolor: "white" },
                          },
                        }}
                      />
                      <IconButton
                        color="primary"
                        onClick={() => void handleSend()}
                        disabled={chatLoading}
                        sx={{
                          bgcolor: brandBlue,
                          color: "white",
                          "&:hover": { bgcolor: "#004080" },
                        }}
                      >
                        <SendRoundedIcon />
                      </IconButton>
                    </Stack>
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default LouieWorkspace;
