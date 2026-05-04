import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  LinearProgress,
  Button,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import PlayArrow from "@mui/icons-material/PlayArrow";
import StarBorder from "@mui/icons-material/StarBorder";
import KeyboardArrowDown from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRight from "@mui/icons-material/KeyboardArrowRight";
import ArrowBack from "@mui/icons-material/ArrowBack";
import SendIcon from "@mui/icons-material/Send";
import Close from "@mui/icons-material/Close";
import { formatDuration } from "../utils/formatDuration";
import { formatTranscriptTitle } from "../utils/formatTranscriptTitle";
import { useTranscriptions } from "../hooks/useTranscriptions";
import { useTranscriptionData } from "../hooks/useTranscriptionData";
import { useArgumentMap } from "../hooks/useArgumentMap";
import { useAudioSnippets } from "../hooks/useAudioSnippets";
import { motion, AnimatePresence } from "motion/react";
import { askAssistant, type AssistantResponse } from "../api";
import ChatMarkdown from "./ChatMarkdown";
import AudioPlayer from "./AudioPlayer";

const brandBlue = "#0072BC";

const suggestedPrompts = [
  "What was discussed in the Combat Discrimination Meeting",
  "How many Budget meetings took place this year",
  "What are the most relevant results from this year's budget meetings",
];


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

const LouieWorkspace = ({
  initialTranscriptId,
  soloView = false,
  onAsk,
}: {
  initialTranscriptId?: string | null;
  soloView?: boolean;
  onAsk?: (text: string) => void;
}) => {
  const tab: "graph" = "graph";
  const { data: transcripts, loading: loadingTranscripts, error: listError } = useTranscriptions();
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const { audioUrls, audioLoading, audioError, playSnippet, dismiss } = useAudioSnippets(selectedId);

  const [prompt, setPrompt] = useState("");
  const [collapsedTopics, setCollapsedTopics] = useState<Record<string, boolean>>({});
  const [openQuestions, setOpenQuestions] = useState<Record<string, boolean>>({});
  const askInputRef = useRef<HTMLInputElement | null>(null);
  const [askMode, setAskMode] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeQuestionKey, setActiveQuestionKey] = useState<string | null>(null);
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [chatMessages, setChatMessages] = useState<
    { id: string; role: "user" | "assistant"; text: string }[]
  >([
    {
      id: "welcome",
      role: "assistant",
      text: "Hi! Ask me anything about this meeting.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  useEffect(() => {
    if (!transcripts.length) return;
    if (initialTranscriptId) {
      setSelectedId((prev) => {
        if (prev && transcripts.some((t) => t.id === prev)) return prev;
        const preferred =
          initialTranscriptId &&
          transcripts.find((t) => t.id === initialTranscriptId)?.id;
        return preferred ?? transcripts[0].id;
      });
    }
  }, [initialTranscriptId, transcripts]);

  useEffect(() => {
    if (tab === "graph" && selectedId) {
      void ensureArgumentMap();
    }
  }, [tab, selectedId, ensureArgumentMap]);

  useEffect(() => {
    setActiveQuestionKey(null);
    setOpenQuestions({});
  }, [selectedId]);

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

  const parseTimestampRange = (input?: string | null): { start: number; end: number } | null => {
    if (!input) return null;
    const cleaned = input.replace(/[\[\]\s]/g, "");
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
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAskMode(false);
        setSearchFocused(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openTranscriptSolo = (id: string) => {
    if (soloView) {
      setSelectedId(id);
      return;
    }
    window.location.hash = `#/workspace?transcript=${encodeURIComponent(id)}&solo=1`;
  };

  const exitSoloView = () => {
    window.location.hash = "#/workspace";
    setSelectedId(null);
  };

  const handleSend = (value?: string) => {
    const text = (value ?? prompt).trim();
    if (!text) return;
    setPrompt("");
    setSearchFocused(false);
    setAskMode(false);
    if (onAsk) {
      onAsk(text);
    } else {
      window.location.hash = "/home";
    }
  };

  const handleSelectQuestion = (key: string) => {
    setActiveQuestionKey(key);
    setOpenQuestions((prev) => ({ ...prev, [key]: true }));
  };

  const sendChat = async (text?: string) => {
    const question = (text ?? chatInput).trim();
    if (!question || chatLoading) return;
    setChatInput("");
    setChatError(null);
    setChatMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}-${prev.length}`, role: "user", text: question },
    ]);
    setChatLoading(true);
    try {
      const res: AssistantResponse = await askAssistant(question);
      const answer =
        (res.answer ?? "").trim() ||
        (res.type === "chart"
          ? "Generated a chart based on the workspace knowledge."
          : "I couldn't find an answer yet.");
      setChatMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}-${prev.length}`,
          role: "assistant",
          text: answer,
        },
      ]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not reach the assistant.";
      setChatError(message);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}-${prev.length}`,
          role: "assistant",
          text: "I hit an error while trying to answer that. Please try again.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const coreQuestions = argumentPayload?.argument_map?.core_questions ?? [];

  if (soloView && selectedId) {
    return (
      <Box sx={{ width: "100%", minHeight: "100vh", bgcolor: "#f4f6f8", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <Box sx={{ background: brandBlue, height: 58, display: "flex", alignItems: "center", px: 2.5 }}>
          <Typography sx={{ color: "white", fontSize: 16, fontWeight: 700, letterSpacing: 1.5 }}>
            ⊠ MISSISSAUGA
          </Typography>
        </Box>
        {/* Breadcrumb bar */}
        <Box
          sx={{
            background: "#003D6B",
            color: "rgba(255,255,255,0.8)",
            height: 32,
            display: "flex",
            alignItems: "center",
            px: 2.5,
            fontSize: 12,
          }}
        >
          Home / Council / Committees / <Box component="span" sx={{ color: "white", fontWeight: 700, ml: 0.6 }}>{selectedMeta?.topic || "Road Safety Committee"}</Box>
        </Box>
        {/* Title row */}
        <Box
          sx={{
            background: "white",
            borderBottom: `3px solid ${brandBlue}`,
            py: 1.1,
            px: 2.5,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
          }}
        >
          <Box>
            <Typography sx={{ fontSize: 19, fontWeight: 700, color: "#003D6B" }}>
              {selectedMeta?.topic || "Road Safety Committee"} — Civic Deliberative Memory
            </Typography>
            <Typography sx={{ fontSize: 13, color: "#666" }}>
              Question history across this meeting · Powered by Louie
            </Typography>
          </Box>
          <Button
            startIcon={<ArrowBack />}
            variant="outlined"
            onClick={exitSoloView}
            sx={{
              ml: "auto",
              borderColor: "#C8DFF0",
              bgcolor: "#E8F4FB",
              color: brandBlue,
              fontSize: 12,
              fontWeight: 700,
              borderRadius: "3px",
              textTransform: "none",
            }}
          >
            Back
          </Button>
          <Button
            variant="outlined"
            sx={{
              ml: 1,
              borderColor: "#C8DFF0",
              bgcolor: "#E8F4FB",
              color: brandBlue,
              fontSize: 12,
              fontWeight: 700,
              borderRadius: "3px",
              textTransform: "none",
            }}
            onClick={() => setShowChatPanel(true)}
          >
            💬 Ask Louie
          </Button>
        </Box>

        <Box sx={{ flex: 1, overflow: "hidden", px: 2.5, pb: 4, pt: 1.5 }}>
          <Box
            sx={{
              display: "flex",
              gap: 2,
              position: "relative",
              alignItems: "stretch",
              flexWrap: { xs: "wrap", md: "nowrap" },
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box
                sx={{
                  background: "white",
                  border: "1px solid #C8DFF0",
                  borderRadius: "3px",
                  overflow: "hidden",
                  boxShadow: "0 6px 16px rgba(0,0,0,0.04)",
                }}
              >
                <Box sx={{ p: 1.2, borderBottom: "1px solid #F0F4F8" }}>
                  <Typography sx={{ fontSize: 17, fontWeight: 700, color: "#003D6B" }}>
                    {currentMeetingLabel}
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: "#666", mt: 0.2 }}>
                    {selectedMeta?.duration
                      ? `${formatDuration(0)} · ${Math.round((selectedMeta.duration ?? 0) / 60)} mins`
                      : "Meeting transcript"}
                  </Typography>
                </Box>

                {coreQuestions.length === 0 && (
                  <Stack alignItems="center" py={3} spacing={1}>
                    <CircularProgress size={22} />
                    <Typography sx={{ fontSize: 12, color: "#777" }}>Loading key questions…</Typography>
                  </Stack>
                )}

                {!activeQuestionKey && coreQuestions.length > 0 && (
                  <Box>
                    {coreQuestions.map((cq, idx) => {
                      const key = `${selectedId ?? "q"}-${idx}`;
                      const color = ["#D68910", "#5B2C8D", "#C0392B", "#2E86C1"][idx % 4];
                      return (
                        <Box
                          key={key}
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1.2,
                            p: 1.25,
                            borderBottom: "1px solid #F0F4F8",
                            cursor: "pointer",
                            "&:hover": { background: "#f7fbff" },
                          }}
                          onClick={() => setActiveQuestionKey(key)}
                        >
                          <Box sx={{ width: 13, height: 13, borderRadius: "50%", background: color, flexShrink: 0 }} />
                          <Typography sx={{ fontSize: 15, fontWeight: 700, color: "#003D6B" }}>
                            {idx + 1}. {cq.question || "Question"}
                          </Typography>
                        </Box>
                      );
                    })}
                  </Box>
                )}

                {activeQuestionKey && (
                  <Box sx={{ bgcolor: "white" }}>
                    {coreQuestions.map((cq, idx) => {
                      const key = `${selectedId ?? "q"}-${idx}`;
                      if (key !== activeQuestionKey) return null;
                      const range = parseTimestampRange(cq.evidence?.[0]?.timestamp as string);
                      return (
                        <Box key={key} sx={{ display: "flex", flexDirection: "column" }}>
                          <Box
                            sx={{
                              background: "white",
                              borderBottom: `3px solid ${brandBlue}`,
                              py: 0.9,
                              px: 1.5,
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                            }}
                          >
                            <Button
                              variant="outlined"
                              onClick={() => setActiveQuestionKey(null)}
                              sx={{
                                borderColor: "#C8DFF0",
                                color: brandBlue,
                                textTransform: "none",
                                fontSize: 12,
                                fontWeight: 700,
                                borderRadius: "3px",
                                background: "#F4F9FF",
                              }}
                            >
                              ← Back
                            </Button>
                            <Typography sx={{ fontSize: 15, fontWeight: 700, color: "#003D6B", flex: 1 }}>
                              {idx + 1}. {cq.question || "Question"}
                            </Typography>
                            <Button
                              variant="contained"
                              sx={{ bgcolor: brandBlue, textTransform: "none", fontSize: 12, fontWeight: 700, borderRadius: "3px" }}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void playSnippet(`${key}-question`, range);
                              }}
                              disabled={!range}
                            >
                              ▶ Listen
                            </Button>
                          </Box>
                          <Box
                            sx={{
                              px: 1.5,
                              py: 0.75,
                              borderBottom: "1px solid #E5EEF8",
                              bgcolor: "#f8fbff",
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                              minHeight: 54,
                            }}
                          >
                            {audioLoading[`${key}-question`] ? (
                              <Stack direction="row" spacing={1} alignItems="center">
                                <CircularProgress size={18} thickness={6} />
                                <Typography sx={{ fontSize: 12.5, color: "#003D6B" }}>Loading audio…</Typography>
                              </Stack>
                            ) : audioUrls[`${key}-question`] ? (
                              <>
                                <Box sx={{ flex: 1 }}>
                                  <AudioPlayer
                                    src={audioUrls[`${key}-question`]}
                                    autoPlay
                                    onEnded={() => dismiss(`${key}-question`)}
                                  />
                                </Box>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    dismiss(`${key}-question`);
                                  }}
                                  sx={{
                                    color: brandBlue,
                                    borderColor: brandBlue,
                                    textTransform: "none",
                                    "&:hover": { borderColor: brandBlue, bgcolor: "#e9f2ff" },
                                  }}
                                >
                                  Close
                                </Button>
                              </>
                            ) : (
                              <Typography sx={{ fontSize: 12.5, color: "#003D6B" }}>
                                Press Listen to hear this question in the meeting audio.
                              </Typography>
                            )}
                            {audioError[`${key}-question`] && (
                              <Typography sx={{ fontSize: 12, color: "error.main", ml: 1 }}>
                                {audioError[`${key}-question`]}
                              </Typography>
                            )}
                          </Box>
                          <Box sx={{ background: "#003D6B", color: "rgba(255,255,255,0.7)", fontSize: 12, px: 1.5, py: 0.5 }}>
                            Home / Council / Committees / <Box component="span" sx={{ color: "white", fontWeight: 700 }}>Road Safety Committee</Box>
                          </Box>
                          <Box
                            sx={{
                              flex: 1,
                              bgcolor: "#f4f6f8",
                              p: 1.5,
                              minHeight: 420,
                            }}
                          >
                            <Box
                              sx={{
                                background: "white",
                                border: "1px solid #C8DFF0",
                                borderRadius: "3px",
                                overflow: "hidden",
                                boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
                              }}
                            >
                              {cq.negation_url ? (
                                <Box
                                  component="iframe"
                                  src={cq.negation_url as string}
                                  title={`negation-${key}`}
                                  sx={{ width: "100%", height: { xs: 420, md: 540 }, border: "none" }}
                                  allow="autoplay; encrypted-media; clipboard-write"
                                />
                              ) : (
                                <Box sx={{ p: 2 }}>
                                  <Typography sx={{ fontSize: 13, color: "#555" }}>
                                    No negation view available for this question.
                                  </Typography>
                                </Box>
                              )}
                            </Box>
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                )}
              </Box>
            </Box>

            {showChatPanel && (
              <Box
                sx={{
                  width: { xs: "100%", md: 360 },
                  maxWidth: { xs: "100%", md: 360 },
                  flex: { xs: "1 1 100%", md: "0 0 360px" },
                  borderLeft: { xs: "none", md: "2px solid #C8DFF0" },
                  borderRight: { xs: "none", md: "2px solid #C8DFF0" },
                  borderBottom: { xs: "none", md: "2px solid #C8DFF0" },
                  borderTop: { xs: "2px solid #C8DFF0", md: "none" },
                  boxShadow: { xs: "0 -8px 24px rgba(0,0,0,0.08)", md: "none" },
                  display: "flex",
                  flexDirection: "column",
                  bgcolor: "white",
                  borderRadius: { xs: "0 0 4px 4px", md: "0" },
                }}
              >
            <Box
              sx={{
                background: brandBlue,
                color: "white",
                px: 1.2,
                py: 1,
                display: "flex",
                alignItems: "center",
                gap: 1,
              }}
            >
              <Typography sx={{ fontSize: 14, fontWeight: 700, flex: 1 }}>
                Ask Louie — Full History
              </Typography>
              <IconButton size="small" onClick={() => setShowChatPanel(false)} sx={{ color: "white" }}>
                <Close />
              </IconButton>
            </Box>

            <Box
              sx={{
                flex: 1,
                overflowY: "auto",
                p: 1.1,
                display: "flex",
                flexDirection: "column",
                gap: 0.85,
                bgcolor: "#f7f9fb",
              }}
            >
              {chatMessages.map((msg) => (
                <Box
                  key={msg.id}
                  sx={{
                    alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "88%",
                    background:
                      msg.role === "user" ? brandBlue : "#E8F4FB",
                    color: msg.role === "user" ? "white" : "#003D6B",
                    borderRadius: 2,
                    px: 1.1,
                    py: 0.75,
                    fontSize: 13,
                    boxShadow: msg.role === "user" ? "0 6px 14px rgba(0,114,188,0.25)" : "none",
                  }}
                >
                  {msg.role === "assistant" ? (
                    <ChatMarkdown text={msg.text} className="chat-markdown-louie" />
                  ) : (
                    msg.text
                  )}
                </Box>
              ))}
              {(chatLoading) && (
                <Typography sx={{ fontSize: 12.5, color: "#555" }}>
                  Assistant is thinking…
                </Typography>
              )}
              {chatError && (
                <Typography sx={{ fontSize: 12, color: "error.main" }}>
                  {chatError}
                </Typography>
              )}
            </Box>

            <Box
              sx={{
                p: 1,
                borderTop: "1px solid #C8DFF0",
                display: "flex",
                gap: 0.6,
                alignItems: "center",
              }}
            >
              <TextField
                size="small"
                fullWidth
                placeholder="Ask about the full history..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendChat();
                  }
                }}
                sx={{
                  "& .MuiOutlinedInput-root": {
                    borderRadius: "3px",
                    background: "white",
                  },
                }}
              />
              <IconButton
                onClick={() => void sendChat()}
                disabled={chatLoading}
                sx={{ textTransform: "none", fontWeight: 700, fontSize: 12 }}
              >
                <SendIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  </Box>
    );
  }

  return (
    <Box sx={{ width: "100%", minHeight: "100vh", bgcolor: "#f5f5f5" }}>
      {/* City header + nav */}
      <Box sx={{ background: brandBlue, height: 58, display: "flex", alignItems: "center", px: 2.5 }}>
        <Typography sx={{ color: "white", fontSize: 16, fontWeight: 700, letterSpacing: 1.5 }}>
          ⊠ MISSISSAUGA
        </Typography>
      </Box>
      <Box
        sx={{
          background: brandBlue,
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
        <Box display={'flex'} justifyContent={'space-between'}>
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
             <Box component="span" sx={{ mx: 0.6, color: brandBlue }}>
              Council activities
            </Box>
           {soloView && <><Box component="span" sx={{ mx: 0.6, color: "#aaa" }}>
              /
            </Box>
            {selectedId}</>}
          </Typography>
          {soloView && selectedId && (
            <Button
              startIcon={<ArrowBack />}
              onClick={exitSoloView}
              sx={{ mb: 1.5, color: brandBlue }}
            >
              Back
            </Button>
          )}
        </Box>

        {!soloView && (
          <>
            {!searchFocused && (
              <Box
                sx={{
                  width: "100%",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  mt: 1,
                  mb: 2,
                }}
              >
                <motion.div
                  layout
                  animate={{
                    width: "min(560px, 92vw)",
                    scale: 1,
                  }}
                  transition={{ type: "spring", stiffness: 260, damping: 22 }}
                  style={{ width: "100%" }}
                >
                  <TextField
                    fullWidth
                    placeholder="Ask anything about council and committees…"
                    size="medium"
                    value={searchQuery}
                    onFocus={() => setSearchFocused(true)}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    sx={{
                      "& .MuiOutlinedInput-root": {
                        borderRadius: 0,
                        background: "#E8F4FB",
                        boxShadow: "0 12px 28px rgba(0,114,188,0.20)",
                        "& fieldset": { border: "1px solid #c8dff0" },
                        "&.Mui-focused fieldset": { border: "1px solid #c8dff0" },
                      },
                      "& .MuiOutlinedInput-root.Mui-focused": {
                        boxShadow: "0 16px 40px rgba(0,114,188,0.28)",
                        outline: "none",
                      },
                    }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" sx={{ color: brandBlue }} />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() => void handleSend(searchQuery)}
                            sx={{
                              bgcolor: "transparent",
                              color: "white",
                              borderRadius: 0,
                              p: 0.9,
                            }}
                          >
                            <SendIcon fontSize="small" sx={{ color: brandBlue}}/>
                          </IconButton>
                        </InputAdornment>
                      ),
                      sx: {
                        py: 1,
                        px: 1,
                        fontWeight: 600,
                        color: "#003D6B",
                      },
                    }}
                  />
                </motion.div>
              </Box>
            )}

            <AnimatePresence initial={false}>
              {searchFocused && (
                <motion.div
                  key="search-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 1400,
                    background: "radial-gradient(circle at 30% 20%, rgba(0,114,188,0.35), rgba(0,61,107,0.85))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "24px",
                  }}
                  onClick={() => setSearchFocused(false)}
                >
                  <motion.div
                    layout
                    onClick={(e) => e.stopPropagation()}
                    animate={{ width: "min(900px, 92vw)", scale: 1.06, y: -10 }}
                    initial={{ width: "min(600px, 92vw)", scale: 0.94, y: 16 }}
                    transition={{ type: "spring", stiffness: 240, damping: 18 }}
                    style={{ width: "100%" }}
                  >
                    <TextField
                      fullWidth
                      placeholder="Ask anything…"
                      size="medium"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      autoFocus
                      sx={{
                        "& .MuiOutlinedInput-root": {
                          borderRadius: 0,
                          background: "rgba(255,255,255,0.16)",
                          backdropFilter: "blur(8px)",
                          boxShadow: "0 30px 90px rgba(0,0,0,0.35)",
                          "& fieldset": { border: "1px solid rgba(255,255,255,0.35)" },
                          "&.Mui-focused fieldset": { border: "1px solid rgba(255,255,255,0.35)" },
                        },
                        "& .MuiOutlinedInput-root.Mui-focused": {
                          boxShadow: "0 36px 110px rgba(0,0,0,0.45)",
                          outline: "none",
                        },
                      }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="medium" sx={{ color: "white" }} />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() => void handleSend(searchQuery)}
                            sx={{
                              bgcolor: "transparent",
                              color: "white",
                              borderRadius: 0,
                              p: 1.1,
                            }}
                          >
                            <SendIcon />
                          </IconButton>
                        </InputAdornment>
                      ),
                      sx: {
                        py: 1.35,
                        px: 1.2,
                        fontSize: 18,
                        color: "white",
                        "& input::placeholder": { color: "rgba(255,255,255,0.78)" },
                        "& fieldset": { border: "none" },
                      },
                    }}
                    />
                    <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                      {suggestedPrompts.map((chip) => (
                        <Chip
                          key={chip}
                          label={chip}
                          onClick={() => setSearchQuery(chip)}
                          sx={{
                            bgcolor: "rgba(255,255,255,0.14)",
                            color: "white",
                            borderColor: "rgba(255,255,255,0.35)",
                          }}
                        />
                      ))}
                    </Stack>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {!searchFocused && (
          <Typography sx={{ fontSize: 22, fontWeight: 700, color: "#1a1a1a", mb: 1.5, mt: 2 }}>
            Council and Committees calendar
          </Typography>
        )}

        {/* Search + list */}
        {!soloView && (
        <Stack spacing={1.25} sx={{ opacity: searchFocused ? 0 : 1, pointerEvents: searchFocused ? "none" : "auto" }}>
          {loadingTranscripts && <LinearProgress sx={{ borderRadius: 1 }} />}
          {listError ? <Alert severity="error">{listError}</Alert> : null}

          {topics.map((topic) => {
            const items = grouped[topic] ?? [];
            const collapsed = collapsedTopics[topic] ?? false;
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
                    cursor: "pointer",
                  }}
                  onClick={() =>
                    setCollapsedTopics((prev) => ({ ...prev, [topic]: !collapsed }))
                  }
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                      {collapsed ? (
                      <KeyboardArrowRight fontSize="small" />
                    ) : (
                      <KeyboardArrowDown fontSize="small" />
                    )}
                    <span>{`${topic} (${items.length})`}</span>
                  </Stack>
                  <span>{collapsed ? "+" : "–"}</span>
                </Box>
                {!collapsed &&
                  items.map((item) => {
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
                      onClick={() => openTranscriptSolo(item.id)}
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
                            openTranscriptSolo(item.id);
                            void ensureArgumentMap();
                          }}
                        >
                          <StarBorder fontSize="inherit" sx={{ mt: "-2px" }} />
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
        )}

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
                  onClick={() => (soloView ? exitSoloView() : setSelectedId(null))}
                  sx={{ fontSize: 11, bgcolor: "#f5f5f5" }}
                />
              </Stack>

              <Typography sx={{ fontSize: 11, color: "#888", mb: 1 }}>
                {dateFromTitle(selectedMeta?.title)}
              </Typography>

              <Stack direction="row" spacing={3} sx={{ borderBottom: "1px solid #e0e8f0" }}>
                <Typography
                  component="button"
                  sx={{
                    border: "none",
                    background: "none",
                    fontSize: 13,
                    px: 1.8,
                    py: 0.8,
                    cursor: "pointer",
                    color: brandBlue ,
                    borderBottom: `2px solid ${brandBlue}`,
                    fontWeight: 600,
                  }}
                >
                  {"Key Items"}
                </Typography>
              </Stack>
              {loadingTranscript && <LinearProgress sx={{ borderRadius: 0, height: 3 }} />}
              {transcriptError ? <Alert severity="error" sx={{ mt: 1 }}>{transcriptError}</Alert> : null}
            </Box>

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
                  {activeQuestionKey && (
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography sx={{ fontSize: 13, color: "#0f172a" }}>
                        Showing 1 of {coreQuestions.length} key questions
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => setActiveQuestionKey(null)}
                        sx={{
                          color: brandBlue,
                          borderColor: brandBlue,
                          textTransform: "none",
                          "&:hover": { borderColor: brandBlue, bgcolor: "#e9f2ff" },
                        }}
                      >
                        Back to all
                      </Button>
                    </Stack>
                  )}
                  {coreQuestions.map((cq, idx) => {
                    const key = `${selectedId ?? "q"}-${idx}`;
                    if (activeQuestionKey && activeQuestionKey !== key) return null;
                    const range = parseTimestampRange(cq.evidence?.[0]?.timestamp as string);
                    const speakers = Array.from(
                      new Set(
                        (cq.evidence ?? [])
                          .map((ev) => ev.speaker?.trim())
                          .filter((s): s is string => Boolean(s)),
                      ),
                    );
                    const isActive = activeQuestionKey === key;
                    const isOpen = isActive ? true : openQuestions[key] ?? false;

                    if (isActive) {
                      return (
                        <Box
                          key={`${cq.question}-${idx}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleSelectQuestion(key)}
                          sx={{
                            border: "1px solid #e0e8f0",
                            borderRadius: 2,
                            p: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: 0,
                            background: "#fafcff",
                            cursor: "pointer",
                            outline: "none",
                            overflow: "hidden",
                          }}
                        >
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            justifyContent="space-between"
                            sx={{ px: 1.5, py: 1.25, borderBottom: "1px solid #d6e2f0" }}
                          >
                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                              <Chip size="small" label={cq.type || "question"} color="primary" variant="outlined" />
                              {cq.unresolved && (
                                <Chip size="small" label="Unresolved" color="warning" variant="outlined" />
                              )}
                              {range && (
                                <Chip
                                  size="small"
                                  label={`[${formatDuration(range.start)} - ${formatDuration(range.end)}]`}
                                  variant="outlined"
                                />
                              )}
                              <Typography sx={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                                {cq.question || "Question"}
                              </Typography>
                              {speakers.length > 0 &&
                                speakers.map((name) => (
                                  <Chip
                                    key={`${key}-${name}`}
                                    size="small"
                                    label={name}
                                    sx={{ bgcolor: "#eef4ff", color: "#234" }}
                                  />
                                ))}
                            </Stack>
                          </Stack>
                          {cq.negation_url ? (
                            <Box
                              component="iframe"
                              src={cq.negation_url as string}
                              title={`negation-${key}`}
                              sx={{
                                width: "100%",
                                height: { xs: "60vh", md: "70vh" },
                                minHeight: 420,
                                border: "none",
                                bgcolor: "white",
                                borderRadius: "0 0 8px 8px",
                              }}
                              allow="autoplay; encrypted-media; clipboard-write"
                            />
                          ) : (
                            <Typography sx={{ p: 2, fontSize: 13, color: "#555" }}>
                              No negation view available for this question.
                            </Typography>
                          )}
                        </Box>
                      );
                    }

                    return (
                      <Box
                        key={`${cq.question}-${idx}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleSelectQuestion(key)}
                        sx={{
                          border: "1px solid #e0e8f0",
                          borderRadius: 2,
                          p: 1.25,
                          display: "flex",
                          flexDirection: "column",
                          gap: 0.75,
                          background: "#fafcff",
                          cursor: "pointer",
                          outline: "none",
                        }}
                      >
                        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenQuestions((prev) => ({ ...prev, [key]: !isOpen }));
                                setActiveQuestionKey(key);
                              }}
                            >
                              {isOpen ? (
                                <KeyboardArrowDown fontSize="small" />
                              ) : (
                                <KeyboardArrowRight fontSize="small" />
                              )}
                            </IconButton>
                            <Chip size="small" label={cq.type || "question"} color="primary" variant="outlined" />
                            {cq.unresolved && <Chip size="small" label="Unresolved" color="warning" variant="outlined" />}
                            {range && (
                              <Chip
                                size="small"
                                label={`[${formatDuration(range.start)} - ${formatDuration(range.end)}]`}
                                variant="outlined"
                              />
                            )}
                            {speakers.length > 0 &&
                              speakers.map((name) => (
                                <Chip
                                  key={`${key}-${name}`}
                                  size="small"
                                  label={name}
                                  sx={{ bgcolor: "#eef4ff", color: "#234" }}
                                />
                              ))}
                          </Stack>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              void playSnippet(`${key}-question`, range);
                            }}
                            disabled={!range}
                          >
                            {audioLoading[`${key}-question`] ? (
                              <CircularProgress size={18} thickness={6} />
                            ) : (
                              <PlayArrow />
                            )}
                          </IconButton>
                        </Stack>

                        <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>
                          {cq.question || "Question"}
                        </Typography>

                        {range && (
                          <Typography sx={{ fontSize: 12, color: "#6b7280" }}>
                            Timestamp: {formatDuration(range.start)} - {formatDuration(range.end)}
                          </Typography>
                        )}

                        {audioUrls[`${key}-question`] && (
                          <Box
                            sx={{
                              mt: 0.75,
                              border: "1px solid #d6e2f0",
                              borderRadius: 1.5,
                              p: 0.75,
                              bgcolor: "#f8fbff",
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                            }}
                          >
                            <Box sx={{ flex: 1 }}>
                              <AudioPlayer
                                src={audioUrls[`${key}-question`]}
                                autoPlay
                                onEnded={() => dismiss(`${key}-question`)}
                              />
                            </Box>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={(e) => {
                                e.stopPropagation();
                                dismiss(`${key}-question`);
                              }}
                              sx={{
                                color: brandBlue,
                                borderColor: brandBlue,
                                textTransform: "none",
                                "&:hover": { borderColor: brandBlue, bgcolor: "#e9f2ff" },
                              }}
                            >
                              Close
                            </Button>
                          </Box>
                        )}

                        {isOpen && (
                          <Stack spacing={0.75} mt={0.5}>
                            {Array.isArray(cq.options_or_claims) && cq.options_or_claims.length > 0 ? (
                              <Stack spacing={0.4}>
                                {cq.options_or_claims.map((opt, i) => (
                                  <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                                    <Chip size="small" label={opt.label || `Option ${i + 1}`} color="secondary" variant="outlined" />
                                    <Typography sx={{ fontSize: 13 }}>{opt.claim}</Typography>
                                  </Stack>
                                ))}
                              </Stack>
                            ) : null}

                            {Array.isArray(cq.evidence) && cq.evidence.length > 0 ? (
                              <Stack spacing={0.5}>
                                <Typography sx={{ fontSize: 12, color: "#777" }}>Evidence</Typography>
                                {cq.evidence.map((ev, evIdx) => {
                                  const evKey = `${key}-ev-${evIdx}`;
                                  const evRange = parseTimestampRange(ev.timestamp as string);
                                  return (
                                    <Box key={evKey}>
                                      <Stack direction="row" spacing={1} alignItems="center">
                                        <IconButton
                                          size="small"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void playSnippet(evKey, evRange);
                                          }}
                                          disabled={!evRange}
                                          hidden={!!audioUrls[evKey]}
                                        >
                                          {audioLoading[evKey] ? (
                                            <CircularProgress size={18} thickness={6} />
                                          ) : (
                                            <PlayArrow />
                                          )}
                                        </IconButton>
                                        <Typography sx={{ fontSize: 13, color: "#444" }}>
                                          {ev.timestamp ? `[${formatDuration(evRange?.start)} - ${formatDuration(evRange?.end)}] ` : ""}
                                          {ev.speaker ? `${ev.speaker}: ` : ""}
                                          “{ev.quote}”
                                        </Typography>
                                      </Stack>
                                      {audioUrls[evKey] && (
                                        <Box
                                          sx={{
                                            mt: 0.75,
                                            border: "1px solid #d6e2f0",
                                            borderRadius: 1.5,
                                            p: 0.75,
                                            bgcolor: "#f8fbff",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 1,
                                          }}
                                        >
                                          <Box sx={{ flex: 1 }}>
                                            <AudioPlayer
                                              src={audioUrls[evKey]}
                                              autoPlay
                                              onEnded={() => dismiss(evKey)}
                                            />
                                          </Box>
                                          <Button
                                            size="small"
                                            variant="outlined"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              dismiss(evKey);
                                            }}
                                            sx={{
                                              color: brandBlue,
                                              borderColor: brandBlue,
                                              textTransform: "none",
                                              "&:hover": { borderColor: brandBlue, bgcolor: "#e9f2ff" },
                                            }}
                                          >
                                            Close
                                          </Button>
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
                            ) : null}
                          </Stack>
                        )}
                      </Box>
                    );
                  })}
                </Stack>
              )}
            </Box>
          </Box>
        )}
      </Box>

      {askMode && (
        <Box
          sx={{
            position: "fixed",
            inset: 0,
            zIndex: 1500,
            bgcolor: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            px: 2,
            py: 3,
          }}
          onClick={() => setAskMode(false)}
        >
          <Box
            onClick={(e) => e.stopPropagation()}
            sx={{
              width: "min(860px, 100%)",
              bgcolor: "white",
              borderRadius: 3,
              boxShadow: "0 24px 80px rgba(0,0,0,0.25)",
              p: { xs: 2, sm: 3 },
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
            }}
          >
            <Typography sx={{ fontWeight: 700, fontSize: 16, color: "#0f172a" }}>
              Ask anything about the transcripts
            </Typography>
            <TextField
              fullWidth
              value={prompt}
              placeholder="Type your question…"
              inputRef={askInputRef}
              autoFocus
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                  setAskMode(false);
                }
              }}
              InputProps={{
                sx: {
                  borderRadius: "14px",
                  fontSize: 16,
                  py: 1.2,
                  background: "#eef4ff",
                  border: `1px solid ${brandBlue}33`,
                },
              }}
            />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {[
                "What was discussed in this meeting?",
                "Summarize the key decisions and owners.",
                "List quotes from the mayor about budget.",
                "Give me action items with deadlines.",
              ].map((chip) => (
                <Chip
                  key={chip}
                  label={chip}
                  onClick={() => {
                    setPrompt(chip);
                    askInputRef.current?.focus();
                    askInputRef.current?.select();
                  }}
                  sx={{
                    borderRadius: "18px",
                    borderColor: "#d0d8e8",
                    color: "#0f172a",
                    "&:hover": { borderColor: brandBlue, color: brandBlue },
                  }}
                />
              ))}
            </Stack>
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button onClick={() => setAskMode(false)}>Cancel</Button>
              <Button
                variant="contained"
                onClick={() => {
                  void handleSend();
                  setAskMode(false);
                }}
                sx={{
                  bgcolor: brandBlue,
                  textTransform: "none",
                  "&:hover": { bgcolor: "#0b5ebd" },
                }}
              >
                Ask
              </Button>
            </Stack>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default LouieWorkspace;
