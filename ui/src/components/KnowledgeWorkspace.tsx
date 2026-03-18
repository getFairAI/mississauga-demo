import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Pagination,
  IconButton,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import NotesRoundedIcon from "@mui/icons-material/NotesRounded";
import SummarizeRoundedIcon from "@mui/icons-material/SummarizeRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import TaskAltRoundedIcon from "@mui/icons-material/TaskAltRounded";
import Tab from "@mui/material/Tab";
import TabContext from "@mui/lab/TabContext";
import TabList from "@mui/lab/TabList";
import TabPanel from "@mui/lab/TabPanel";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import StarIcon from "@mui/icons-material/Star";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import { formatTranscriptTitle } from "../utils/formatTranscriptTitle";
import { formatDuration } from "../utils/formatDuration";

import type {
  AnalysisResponse,
  ActionableTopic,
  ArgumentMapPayload,
  ArgumentMapResponse,
  TranscriptFull,
  TranscriptLine,
  TranscriptListItem,
  TranscriptPage,
  SummaryResponse,
} from "../api";
import {
  analyzeTranscript,
  buildArgumentMap,
  fetchArgumentMap,
  fetchTranscript,
  fetchSummary,
  listTranscriptions,
  openProgressSocket,
  sliceAudioByTranscript,
  streamTranscriptPages,
  summarizeTranscript,
} from "../api";
import TranscriptsList from "./TranscriptsList";

type Mode = "stream" | "full";

const lineLabel = (line: TranscriptLine) =>
  `[${line.start.toFixed(2)} – ${line.end.toFixed(2)}] ${line.speaker}: ${line.text}`;

const inlineMarkdownNodes = (text: string): ReactNode[] => {
  // Escape HTML to avoid injection issues.
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <Box component="strong" key={idx} sx={{ fontWeight: 700 }}>
          {part.slice(2, -2)}
        </Box>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <Box
          component="code"
          key={idx}
          sx={{
            bgcolor: "grey.100",
            borderRadius: 0.75,
            px: 0.75,
            py: 0.25,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.9em",
          }}
        >
          {part.slice(1, -1)}
        </Box>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <Box component="em" key={idx} sx={{ fontStyle: "italic" }}>
          {part.slice(1, -1)}
        </Box>
      );
    }
    return <span key={idx}>{escape(part)}</span>;
  });
};

const KnowledgeWorkspace = ({ initialTranscriptId }: { initialTranscriptId?: string | null }) => {

  const [transcripts, setTranscripts] = useState<TranscriptListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullTranscript, setFullTranscript] = useState<TranscriptFull | null>(
    null,
  );
  const [pages, setPages] = useState<TranscriptPage[]>([]);
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [argumentMap, setArgumentMap] = useState<ArgumentMapResponse | null>(null);
  const [argumentMapError, setArgumentMapError] = useState<string | null>(null);
  const [argumentMapProgress, setArgumentMapProgress] = useState<{
    status: "idle" | "fetching" | "queued" | "running" | "finished" | "error";
    message?: string;
  }>({ status: "idle" });
  const argumentMapSocketRef = useRef<WebSocket | null>(null);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [audioLoading, setAudioLoading] = useState<Record<string, boolean>>({});
  const [audioError, setAudioError] = useState<Record<string, string | undefined>>({});

  const [graphUrl, setGraphUrl] = useState<string>("");
  const [value, setValue] = useState("1");

  const handleChange = (_: React.SyntheticEvent, newValue: string) => {
    setValue(newValue);
  };

  // Load available transcripts on mount
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        setLoadingList(true);
        const items = await listTranscriptions();
        if (cancelled) return;
        setTranscripts(items);
        const preferred = initialTranscriptId && items.find((t) => t.id === initialTranscriptId)?.id;
        if (preferred) {
          setSelectedId(preferred);
        } else if (!selectedId && items.length) {
          setSelectedId(items[0].id);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!initialTranscriptId || !transcripts.length) return;
    const exists = transcripts.find((t) => t.id === initialTranscriptId);
    if (exists) {
      setSelectedId(initialTranscriptId);
    }
  }, [initialTranscriptId, transcripts]);

  // Reset analysis when switching transcripts
  useEffect(() => {
    setArgumentMap(null);
    setArgumentMapError(null);
    setArgumentMapProgress({ status: "idle" });
    closeArgumentMapSocket();
    setAudioUrls((prev) => {
      Object.values(prev).forEach((url) => URL.revokeObjectURL(url));
      return {};
    });
    setAudioLoading({});
    setAudioError({});
    let cancelled = false;
    if (!selectedId) return;
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selectedMeta = useMemo(
    () => transcripts.find((t) => t.id === selectedId) ?? null,
    [transcripts, selectedId],
  );

  useEffect(() => {
    if (value === "1") {
      void ensureArgumentMap();
    }
  }, [value, selectedId]);

  const argumentMapProgressLabel = useMemo(() => {
    switch (argumentMapProgress.status) {
      case "fetching":
        return "Loading key items…";
      case "queued":
        return "Key items queued";
      case "running":
        return "Building key items…";
      case "finished":
        return "Key items ready";
      case "error":
        return argumentMapProgress.message || "Key items failed";
      default:
        return "";
    }
  }, [argumentMapProgress]);

  const argumentMapData = useMemo<ArgumentMapPayload | null>(() => {
    if (!argumentMap) return null;
    return (argumentMap.argument_map as ArgumentMapPayload) ?? null;
  }, [argumentMap]);

  type TranscriptGroup = {
    speaker: string;
    start: number;
    end: number;
    lines: TranscriptLine[];
  };

  const closeArgumentMapSocket = () => {
    const ws = argumentMapSocketRef.current;
    if (ws) {
      ws.close();
      argumentMapSocketRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      closeArgumentMapSocket();
      Object.values(audioUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [audioUrls]);

  const ensureArgumentMap = async () => {
    if (!selectedId) {
      setArgumentMapError("Load a transcript first.");
      return;
    }
    // Avoid duplicate runs if already finished.
    if (argumentMap && argumentMapProgress.status === "finished") {
      return;
    }

    try {
      closeArgumentMapSocket();
      setArgumentMapError(null);
      setArgumentMapProgress({ status: "fetching" });

      // Try existing file first.
      const existing = await fetchArgumentMap(selectedId);
      if (existing) {
        setArgumentMap(existing);
        setArgumentMapProgress({ status: "finished" });
        return;
      }

      setArgumentMapProgress({ status: "queued" });
      const start = await buildArgumentMap({ transcript_id: selectedId });

      if (start.status === "already_exists") {
        const found = await fetchArgumentMap(selectedId);
        if (found) {
          setArgumentMap(found);
          setArgumentMapProgress({ status: "finished" });
          return;
        }
      }

      if (!start.room_id) {
        setArgumentMapProgress({ status: "error", message: "Unable to start key items job." });
        return;
      }

      const socket = openProgressSocket(start.room_id, (payload) => {
        if (typeof payload === "string") return;
        const data = payload as Record<string, any>;
        if (data.job !== "argument_map") return;

        const stage = data.stage as string | undefined;
        if (!stage) return;

        if (stage === "queued" || stage === "running") {
          setArgumentMapProgress({ status: stage as any });
          return;
        }

        if (stage === "finished") {
          setArgumentMapProgress((prev) => ({ ...prev, status: "finished" }));
          return;
        }

        if (stage === "result") {
          const argument_map = (data.argument_map ?? {}) as ArgumentMapPayload;
          setArgumentMap({
            transcript_id: (data.transcript_id ?? start.transcript_id ?? selectedId) as string | undefined,
            argument_map_file: data.argument_map_file ?? start.argument_map_file ?? null,
            argument_map,
          });
          setArgumentMapProgress((prev) => ({ ...prev, status: "finished" }));
          closeArgumentMapSocket();
          return;
        }

        if (stage === "error") {
          const message = (data.message as string) || "Key items failed.";
          setArgumentMapError(message);
          setArgumentMapProgress({ status: "error", message });
          closeArgumentMapSocket();
        }
      });

      argumentMapSocketRef.current = socket;
    } catch (err) {
      const message = (err as Error).message;
      setArgumentMapError(message);
      setArgumentMapProgress({ status: "error", message });
    } finally {
      // progress handled via websocket
    }
  };

  const parseTimestampRange = (input?: string | null): { start: number; end: number } | null => {
    if (!input) return null;
    const cleaned = input.replace(/[\[\]\s]/g, "");
    const parts = cleaned.split(/[-–]/);
    if (parts.length !== 2) return null;

    const toSeconds = (raw: string) => {
      if (!raw) return NaN;
      if (raw.includes(":")) {
        return raw.split(":").reduce((acc, cur) => acc * 60 + Number(cur), 0);
      }
      return Number(raw);
    };

    const start = toSeconds(parts[0]);
    const end = toSeconds(parts[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return { start, end };
  };

  const playSnippet = async (key: string, range: { start: number; end: number } | null) => {
    if (!range) {
      setAudioError((prev) => ({ ...prev, [key]: "No timestamp available for this question." }));
      return;
    }
    if (!selectedId) {
      setAudioError((prev) => ({ ...prev, [key]: "Select a transcript first." }));
      return;
    }
    setAudioError((prev) => ({ ...prev, [key]: undefined }));
    setAudioLoading((prev) => ({ ...prev, [key]: true }));
    try {
      if (audioUrls[key]) {
        URL.revokeObjectURL(audioUrls[key]);
      }
      const { url } = await sliceAudioByTranscript({
        transcript_id: selectedId,
        start: range.start,
        end: range.end,
        output_format: "mp3",
      });
      setAudioUrls((prev) => ({ ...prev, [key]: url }));
    } catch (err) {
      setAudioError((prev) => ({ ...prev, [key]: (err as Error).message }));
    } finally {
      setAudioLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  return (
    <Stack
      height={"100%"}
      minHeight={0}
      direction={{ xs: "column", lg: "row" }}
      spacing={2.5}
      position="relative"
      zIndex={1}
    >
      {/* Library column */}
      <TranscriptsList
        transcripts={transcripts}
        loadingList={loadingList}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
      />

      {/* Detail column */}
      <Stack
        spacing={2}
        sx={{
          width: { xs: "100%", lg: "80%" },
          flex: 1,
          minHeight: 0,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            borderRadius: 2,
            border: "1px solid",
            borderColor: "divider",
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            mb={1.5}
          >
            <Stack spacing={0.25}>
              <Typography variant="overline" color="text.secondary">
                Selected transcript
              </Typography>
              <Typography
                variant="h6"
                fontFamily="'Space Grotesk', 'Manrope', sans-serif"
                fontWeight={700}
              >
                {selectedMeta ? formatTranscriptTitle(selectedMeta.title) : "—"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {selectedMeta
                  ? `${selectedMeta.line_count} lines • ${formatDuration(selectedMeta.duration)}`
                  : "Choose a transcript"}
              </Typography>
            </Stack>
          </Stack>
        </Paper>

        <Paper
          elevation={0}
          sx={{
            p: 2,
            borderRadius: 2,
            border: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            height: "100%",
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <TabContext value={value}>
            <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
              <TabList
                onChange={handleChange}
                aria-label="lab API tabs example"
              >
                <Tab
                  label={
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      mb={1.5}
                    >
                      <FactCheckRoundedIcon color="primary" />
                      <Typography variant="subtitle1" fontWeight={700}>
                        Key items
                      </Typography>
                      {loadingContent && (
                        <LinearProgress
                          sx={{ flex: 1, ml: 2, borderRadius: 999 }}
                        />
                      )}
                    </Stack>
                  }
                  value="1"
                />
                <Tab
                  label={
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      mb={1.5}
                    >
                      <TimelineRoundedIcon color="primary" />
                      <Typography variant="subtitle1" fontWeight={700}>
                        Graph board
                      </Typography>
                      {loadingContent && (
                        <LinearProgress
                          sx={{ flex: 1, ml: 2, borderRadius: 999 }}
                        />
                      )}
                    </Stack>
                  }
                  value="2"
                />
              </TabList>
            </Box>
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <TabPanel
                value="1"
                sx={{
                  flex: 1,
                  minHeight: 0,
                  overflow: "auto",
                  display: "flex",
                  flexDirection: "column",
                  p: 0,
                  pt: 2,
                }}
              >
                {argumentMapError && (
                  <Alert severity="error" sx={{ mb: 1.5 }}>
                    {argumentMapError}
                  </Alert>
                )}

                {argumentMapProgress.status !== "idle" &&
                  argumentMapProgress.status !== "finished" &&
                  argumentMapProgress.status !== "error" && (
                    <Stack spacing={0.5} mb={1.25}>
                      <LinearProgress variant="indeterminate" sx={{ borderRadius: 999 }} />
                      <Typography variant="caption" color="text.secondary">
                        {argumentMapProgressLabel}
                      </Typography>
                    </Stack>
                  )}

                {!argumentMap && argumentMapProgress.status === "idle" && (
                  <Typography variant="body2" color="text.secondary">
                    Open this tab to fetch key items. If none exist yet, we will start generating them.
                  </Typography>
                )}

                {argumentMap && (
                  <Stack spacing={2}>
                    {argumentMap.argument_map_file && (
                      <Typography variant="caption" color="text.secondary">
                        Stored as {argumentMap.argument_map_file}
                      </Typography>
                    )}


                    {Array.isArray(argumentMapData?.argument_map?.agenda) && (
                      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                          Agenda & presenters
                        </Typography>
                        <Stack spacing={0.75}>
                          {argumentMapData.argument_map.agenda.map((item, idx) => (
                            <Stack
                              key={`${item.item}-${idx}`}
                              direction="row"
                              spacing={1}
                              alignItems="center"
                              flexWrap="wrap"
                            >
                              <Chip
                                label={item.presenter || "Unknown presenter"}
                                size="small"
                                color="primary"
                                variant="outlined"
                              />
                              <Typography variant="body2">{item.item ?? "Agenda item"}</Typography>
                            </Stack>
                          ))}
                        </Stack>
                      </Paper>
                    )}

                    {Array.isArray(argumentMapData?.argument_map?.core_questions) && (
                      <Stack spacing={1.25}>
                        <Typography variant="subtitle2" fontWeight={700}>
                          Core questions
                        </Typography>
                        {argumentMapData.argument_map.core_questions.map((cq, idx) => {
                          const key = `${selectedId ?? "q"}-${idx}`;
                          const range = parseTimestampRange(cq.evidence?.[0]?.timestamp as string);
                          return (
                          <Paper
                            key={`${cq.question}-${idx}`}
                            variant="outlined"
                            role="button"
                            tabIndex={0}
                            sx={{
                              p: 1.25,
                              borderRadius: 1.5,
                              cursor: "pointer",
                              "&:hover": { borderColor: "primary.main", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" },
                            }}
                          >
                              <Stack spacing={0.5} mb={0.5}>
                                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                  <Chip
                                    size="small"
                                    label={cq.type ? cq.type : "question"}
                                    color="primary"
                                    variant="outlined"
                                  />
                                  {cq.unresolved && (
                                    <Chip size="small" color="warning" label="Unresolved" variant="outlined" />
                                  )}
                                  {range && (
                                    <Chip
                                      size="small"
                                      label={`[${range.start.toFixed(1)}s - ${range.end.toFixed(1)}s]`}
                                      variant="outlined"
                                    />
                                  )}
                                </Stack>
                                <Typography variant="subtitle2" fontWeight={700}>
                                  {cq.question || "Question"}
                                </Typography>
                              </Stack>
                              {Array.isArray(cq.options_or_claims) && cq.options_or_claims.length > 0 && (
                                <Stack spacing={0.5} mt={0.5}>
                                  {cq.options_or_claims.map((opt, i) => (
                                    <Stack direction="row" spacing={1} alignItems="flex-start" key={`${opt.label}-${i}`}>
                                      <Chip
                                        size="small"
                                        label={opt.label || `Option ${i + 1}`}
                                        color="secondary"
                                        variant="outlined"
                                      />
                                      <Typography variant="body2">{opt.claim || "Claim/option"}</Typography>
                                    </Stack>
                                  ))}
                                </Stack>
                              )}
                              
                              {Array.isArray(cq.evidence) && cq.evidence.length > 0 && (
                                <Stack spacing={0.5} mt={1}>
                                  <Typography variant="caption" color="text.secondary">
                                    Evidence
                                  </Typography>
                                  {cq.evidence.map((ev, i) => {
                                    const evKey = `${key}-ev-${i}`;
                                    const evRange = parseTimestampRange(ev.timestamp as string);
                                    return (<Box>
                                      <Stack key={`${ev.quote}-${i}`} direction="row" spacing={1} alignItems="center">
                                        <IconButton
                                          size="small"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void playSnippet(evKey, evRange);
                                          }}
                                          disabled={!evRange}
                                          hidden={!!audioUrls[evKey]}
                                        >
                                          {audioLoading[evKey] ? <CircularProgress size={18} thickness={6} /> : <PlayArrowRoundedIcon />}
                                        </IconButton>
                                        
                                        <Box display={'flex'} flexDirection={'column'} width={'100%'}>
                                          <Typography variant="body2" color="text.secondary">
                                            {ev.timestamp ? `[${ev.timestamp}] ` : ""}
                                            {ev.speaker ? `${ev.speaker}: ` : ""}
                                            “{ev.quote}”
                                          </Typography>
                                          
                                        </Box>
                                      </Stack>
                                      {audioUrls[evKey] && (
                                        <Box mt={1} width={'100%'}>
                                          <audio controls src={audioUrls[evKey]} style={{ width: "100%" }} />
                                        </Box>
                                      )}
                                    </Box>);
                                  })}
                                </Stack>
                              )}
                            </Paper>
                          );
                        })}
                      </Stack>
                    )}
                  </Stack>
                )}
              </TabPanel>
              <TabPanel
                value="2"
                sx={{
                  flex: 1,
                  minHeight: 0,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  p: 0,
                  pt: 2,
                }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent="space-between"
                  mb={1.5}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TimelineRoundedIcon color="primary" />
                    <Typography variant="subtitle1" fontWeight={700}>
                      Graph board
                    </Typography>
                  </Stack>
                  <TextField
                    label="Embed URL"
                    placeholder="https://"
                    size="small"
                    value={graphUrl}
                    onChange={(e) => setGraphUrl(e.target.value)}
                    sx={{ minWidth: { xs: "100%", sm: 320 }, maxWidth: 480 }}
                  />
                </Stack>

                <Paper
                  variant="outlined"
                  sx={{
                    borderRadius: 2,
                    borderColor: "divider",
                    bgcolor: "grey.50",
                    flex: 1,
                    minHeight: 360,
                    overflow: "hidden",
                    position: "relative",
                  }}
                >
                  {graphUrl.trim() ? (
                    <Box
                      component="iframe"
                      title="Graph board embed"
                      src={graphUrl.trim()}
                      allow="fullscreen"
                      allowFullScreen
                      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                      sx={{
                        border: 0,
                        width: "100%",
                        height: "100%",
                        display: "block",
                      }}
                    />
                  ) : (
                    <Stack
                      height="100%"
                      alignItems="center"
                      justifyContent="center"
                      spacing={1}
                      px={3}
                      textAlign="center"
                    >
                      <Typography variant="subtitle2" color="text.secondary">
                        Paste an embed URL to load a graph or external board.
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        The frame will appear here and resize to fill the space.
                      </Typography>
                    </Stack>
                  )}
                </Paper>
              </TabPanel>
            </Box>
          </TabContext>
        </Paper>
      </Stack>
    </Stack>
  );
};

export default KnowledgeWorkspace;
