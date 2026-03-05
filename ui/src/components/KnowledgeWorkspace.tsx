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
import { formatTranscriptTitle } from "../utils/formatTranscriptTitle";
import { formatDuration } from "../utils/formatDuration";

import type {
  AnalysisResponse,
  ActionableTopic,
  TranscriptFull,
  TranscriptLine,
  TranscriptListItem,
  TranscriptPage,
  SummaryResponse,
} from "../api";
import {
  analyzeTranscript,
  fetchTranscript,
  fetchSummary,
  listTranscriptions,
  openProgressSocket,
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

const renderMarkdownBlocks = (md: string): ReactNode[] => {
  const lines = md.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let list: string[] = [];

  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <Box
        component="ul"
        key={`ul-${blocks.length}`}
        sx={{ pl: 3, my: 0, color: "text.primary" }}
      >
        {list.map((item, idx) => (
          <Box component="li" key={idx} sx={{ mb: 0.5 }}>
            <Typography variant="body2" component="span">
              {inlineMarkdownNodes(item)}
            </Typography>
          </Box>
        ))}
      </Box>,
    );
    list = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushList();
      return;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      list.push(line.slice(2));
      return;
    }
    if (list.length) flushList();
    blocks.push(
      <Typography
        key={`p-${blocks.length}`}
        variant="body1"
        sx={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}
      >
        {inlineMarkdownNodes(line)}
      </Typography>,
    );
  });

  flushList();
  return blocks;
};

const KnowledgeWorkspace = ({ initialTranscriptId }: { initialTranscriptId?: string | null }) => {
  const [mode, setMode] = useState<Mode>("stream");
  const [pageSize, setPageSize] = useState<number>(50);
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
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<{
    status: "idle" | "queued" | "running" | "chunking" | "chunk_complete" | "finished" | "error";
    current?: number;
    total?: number;
    message?: string;
  }>({ status: "idle" });
  const analysisSocketRef = useRef<WebSocket | null>(null);

  const [summaryProgress, setSummaryProgress] = useState<{
    status: "idle" | "queued" | "running" | "chunking" | "chunk_complete" | "finished" | "error";
    current?: number;
    total?: number;
    message?: string;
  }>({ status: "idle" });
  const summarySocketRef = useRef<WebSocket | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false); // for generation
  const [summaryFetching, setSummaryFetching] = useState(false); // for initial fetch
  const [summaryError, setSummaryError] = useState<string | null>(null);

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

  // Load content (full or stream) when selection or mode changes
  useEffect(() => {
    if (!selectedId) return;

    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      try {
        setError(null);
        setLoadingContent(true);
        setFullTranscript(null);
        setPages([]);
        setCurrentPage(null);

        if (mode === "full") {
          const data = await fetchTranscript(selectedId);
          if (cancelled) return;
          setFullTranscript(data);
        } else {
          await streamTranscriptPages(selectedId, pageSize, {
            signal: controller.signal,
            onPage: (page) => {
              if (cancelled) return;
              setPages((prev) => {
                const next = [
                  ...prev.filter((p) => p.page !== page.page),
                  page,
                ];
                return next.sort((a, b) => a.page - b.page);
              });
              setCurrentPage((prev) => prev ?? page.page);
            },
          });
        }
      } catch (err) {
        if (cancelled) return;
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message);
      } finally {
        if (!cancelled) setLoadingContent(false);
      }
    };

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedId, mode, pageSize]);

  // Reset analysis when switching transcripts
  useEffect(() => {
    setAnalysis(null);
    setAnalysisError(null);
    setAnalysisProgress({ status: "idle" });
    closeAnalysisSocket();
    setSummary(null);
    setSummaryError(null);
    setSummaryProgress({ status: "idle" });
    closeSummarySocket();
    let cancelled = false;
    if (!selectedId) return;
    const load = async () => {
      try {
        setSummaryFetching(true);
        const existing = await fetchSummary(selectedId);
        if (cancelled) return;
        setSummary(existing);
      } catch (err) {
        if (!cancelled) setSummaryError((err as Error).message);
      } finally {
        if (!cancelled) setSummaryFetching(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selectedMeta = useMemo(
    () => transcripts.find((t) => t.id === selectedId) ?? null,
    [transcripts, selectedId],
  );

  const activePage = useMemo(() => {
    if (!pages.length) return null;
    if (currentPage === null) return pages[0];
    return pages.find((p) => p.page === currentPage) ?? pages[0];
  }, [pages, currentPage]);

  const transcriptLines: TranscriptLine[] =
    mode === "full" ? (fullTranscript?.lines ?? []) : (activePage?.lines ?? []);

  const analysisProgressLabel = useMemo(() => {
    switch (analysisProgress.status) {
      case "queued":
        return "Analysis queued";
      case "running":
        return "Analysis running";
      case "chunking":
        return analysisProgress.total
          ? `Preparing ${analysisProgress.total} chunk${analysisProgress.total === 1 ? "" : "s"}…`
          : "Preparing chunks…";
      case "chunk_complete":
        return analysisProgress.total
          ? `Processed chunk ${analysisProgress.current ?? 0} of ${analysisProgress.total}`
          : "Processed chunk";
      case "error":
        return analysisProgress.message || "Analysis failed";
      case "finished":
      default:
        return "";
    }
  }, [analysisProgress]);

  const analysisProgressValue = useMemo(() => {
    if (!analysisProgress.total) return undefined;
    const current = analysisProgress.current ?? 0;
    return Math.min(100, Math.round((current / analysisProgress.total) * 100));
  }, [analysisProgress]);

  const summaryProgressLabel = useMemo(() => {
    switch (summaryProgress.status) {
      case "queued":
        return "Summary queued";
      case "running":
        return "Summarizing transcript";
      case "chunking":
        return summaryProgress.total
          ? `Preparing ${summaryProgress.total} chunk${summaryProgress.total === 1 ? "" : "s"}…`
          : "Preparing chunks…";
      case "chunk_complete":
        return summaryProgress.total
          ? `Summarized chunk ${summaryProgress.current ?? 0} of ${summaryProgress.total}`
          : "Summarized chunk";
      case "finished":
        return "Finalizing summary…";
      case "error":
        return summaryProgress.message || "Summary failed";
      default:
        return "";
    }
  }, [summaryProgress]);

  const summaryProgressValue = useMemo(() => {
    if (!summaryProgress.total) return undefined;
    const current = summaryProgress.current ?? 0;
    return Math.min(100, Math.round((current / summaryProgress.total) * 100));
  }, [summaryProgress]);

  const transcriptText = useMemo(
    () => transcriptLines.map((line) => lineLabel(line)).join("\n"),
    [transcriptLines],
  );

  type TranscriptGroup = {
    speaker: string;
    start: number;
    end: number;
    lines: TranscriptLine[];
  };

  const transcriptGroups = useMemo<TranscriptGroup[]>(() => {
    if (!transcriptLines.length) return [];
    return transcriptLines.reduce<TranscriptGroup[]>((groups, line) => {
      const last = groups[groups.length - 1];
      if (last && last.speaker === line.speaker) {
        last.lines.push(line);
        last.end = line.end;
      } else {
        groups.push({
          speaker: line.speaker,
          start: line.start,
          end: line.end,
          lines: [line],
        });
      }
      return groups;
    }, []);
  }, [transcriptLines]);

  const closeAnalysisSocket = () => {
    const ws = analysisSocketRef.current;
    if (ws) {
      ws.close();
      analysisSocketRef.current = null;
    }
  };

  const closeSummarySocket = () => {
    const ws = summarySocketRef.current;
    if (ws) {
      ws.close();
      summarySocketRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      closeAnalysisSocket();
      closeSummarySocket();
    };
  }, []);

  const speakerColorMap = useMemo(() => {
    const palette = [
      "#0f766e",
      "#f97316",
      "#2563eb",
      "#9333ea",
      "#16a34a",
      "#0ea5e9",
      "#ef4444",
    ];
    const map = new Map<string, string>();
    transcriptLines.forEach((line) => {
      if (!map.has(line.speaker)) {
        map.set(line.speaker, palette[map.size % palette.length]);
      }
    });
    return map;
  }, [transcriptLines]);

  const runAnalysis = async () => {
    if (!transcriptText.trim()) {
      setAnalysisError("Load a transcript first.");
      return;
    }

    const mergeAnalysis = (incoming: AnalysisResponse) => {
      setAnalysis((prev) => {
        const highlights = Array.from(
          new Set([...(prev?.highlights ?? []), ...(incoming.highlights ?? [])]),
        );

        const existing = prev?.actionable_topics ?? [];
        const nextActionables = [...existing];
        incoming.actionable_topics?.forEach((item) => {
          const key = `${(item.title || "").toLowerCase()}|${(item.action || "").toLowerCase()}|${(item.owner || "").toLowerCase()}|${(item.due || "").toLowerCase()}`;
          const already = nextActionables.some((a) =>
            `${(a.title || "").toLowerCase()}|${(a.action || "").toLowerCase()}|${(a.owner || "").toLowerCase()}|${(a.due || "").toLowerCase()}` === key,
          );
          if (!already) nextActionables.push(item);
        });

        return {
          transcript_id: incoming.transcript_id ?? prev?.transcript_id ?? selectedId ?? undefined,
          highlights,
          actionable_topics: nextActionables,
        };
      });
    };

    try {
      closeAnalysisSocket();
      setAnalysis(null);
      setAnalysisLoading(true);
      setAnalysisError(null);
      setAnalysisProgress({ status: "queued" });

      const start = await analyzeTranscript({
        transcript_id: selectedId ?? undefined,
      });

      const socket = openProgressSocket(start.room_id, (payload) => {
        if (typeof payload === "string") return; // join message or plain text
        const data = payload as Record<string, any>;
        if (data.job !== "analyze_transcript") return;

        const stage = data.stage as string | undefined;
        if (!stage) return;

        if (stage === "queued" || stage === "running") {
          setAnalysisProgress({ status: stage as any });
          return;
        }

        if (stage === "chunking") {
          setAnalysisProgress({ status: "chunking", total: data.total_chunks });
          return;
        }

        if (stage === "chunk_complete") {
          setAnalysisProgress({
            status: "chunk_complete",
            current: data.chunk ?? 0,
            total: data.total_chunks,
          });
          if (data.analysis) {
            mergeAnalysis(data.analysis as AnalysisResponse);
          }
          return;
        }

        if (stage === "finished") {
          setAnalysisProgress((prev) => ({ ...prev, status: "finished" }));
          return;
        }

        if (stage === "result") {
          if (data.analysis) {
            setAnalysis(data.analysis as AnalysisResponse);
          }
          setAnalysisLoading(false);
          setAnalysisProgress((prev) => ({ ...prev, status: "finished" }));
          closeAnalysisSocket();
          return;
        }

        if (stage === "error") {
          const message = (data.message as string) || "Analysis failed.";
          setAnalysisError(message);
          setAnalysisLoading(false);
          setAnalysisProgress({ status: "error", message });
          closeAnalysisSocket();
        }
      });

      analysisSocketRef.current = socket;
    } catch (err) {
      setAnalysisError((err as Error).message);
      setAnalysisProgress({ status: "error", message: (err as Error).message });
      setAnalysisLoading(false);
    } finally {
      // keep spinner controlled by websocket events
    }
  };

  const runSummary = async () => {
    if (!transcriptText.trim()) {
      setSummaryError("Load a transcript first.");
      return;
    }

    try {
      closeSummarySocket();
      setSummary(null);
      setSummaryLoading(true);
      setSummaryError(null);
      setSummaryProgress({ status: "queued" });

      const start = await summarizeTranscript({
        transcript_id: selectedId ?? undefined,
      });

      const socket = openProgressSocket(start.room_id, (payload) => {
        if (typeof payload === "string") return;
        const data = payload as Record<string, any>;
        if (data.job !== "summarize_transcript") return;

        const stage = data.stage as string | undefined;
        if (!stage) return;

        if (stage === "queued" || stage === "running") {
          setSummaryProgress({ status: stage as any });
          return;
        }

        if (stage === "chunking") {
          setSummaryProgress({ status: "chunking", total: data.total_chunks });
          return;
        }

        if (stage === "chunk_complete") {
          setSummaryProgress({
            status: "chunk_complete",
            current: data.chunk ?? 0,
            total: data.total_chunks,
          });
          if (typeof data.summary === "string") {
            setSummary({
              transcript_id: (data.transcript_id ?? start.transcript_id) as string | undefined,
              summary: data.summary,
            } as SummaryResponse);
          }
          return;
        }

        if (stage === "finished") {
          setSummaryProgress((prev) => ({ ...prev, status: "finished" }));
          return;
        }

        if (stage === "result") {
          if (data.summary) {
            setSummary(data.summary as SummaryResponse);
          }
          setSummaryLoading(false);
          setSummaryProgress((prev) => ({ ...prev, status: "finished" }));
          closeSummarySocket();
          return;
        }

        if (stage === "error") {
          const message = (data.message as string) || "Summary failed.";
          setSummaryError(message);
          setSummaryLoading(false);
          setSummaryProgress({ status: "error", message });
          closeSummarySocket();
        }
      });

      summarySocketRef.current = socket;
    } catch (err) {
      setSummaryError((err as Error).message);
      setSummaryProgress({ status: "error", message: (err as Error).message });
      setSummaryLoading(false);
    } finally {
      // spinner controlled by websocket lifecycle
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
                      <NotesRoundedIcon color="primary" />
                      <Typography variant="subtitle1" fontWeight={700}>
                        Transcript
                      </Typography>
                      {loadingContent && (
                        <LinearProgress
                          sx={{ flex: 1, ml: 2, borderRadius: 999 }}
                        />
                      )}
                    </Stack>
                  }
                  value="1"
                ></Tab>
                <Tab
                  label={
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      mb={1.5}
                    >
                      <AutoAwesomeIcon color="primary" />
                      <Typography variant="subtitle1" fontWeight={700}>
                        Summary
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
                <Tab
                  label={
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      mb={1.5}
                    >
                      <StarIcon color="primary" />
                      <Typography variant="subtitle1" fontWeight={700}>
                        Hightlights & Actionables
                      </Typography>
                      {loadingContent && (
                        <LinearProgress
                          sx={{ flex: 1, ml: 2, borderRadius: 999 }}
                        />
                      )}
                    </Stack>
                  }
                  value="3"
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
                  p: 0,
                  pt: 2,
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  justifyContent={
                    mode === "stream" ? "space-between" : "flex-end"
                  }
                  alignItems={"center"}
                  paddingBottom={"8px"}
                >
                  {mode === "stream" && (
                    <Box display={"flex"} flexDirection={"column"}>
                      <TextField
                        label="Page size"
                        type="number"
                        size="small"
                        value={pageSize}
                        onChange={(e) =>
                          setPageSize(Number(e.target.value) || 1)
                        }
                        inputProps={{ min: 1, step: 10 }}
                        sx={{ width: 140 }}
                      />
                    </Box>
                  )}

                  <ToggleButtonGroup
                    value={mode}
                    exclusive
                    size="small"
                    onChange={(_, val: Mode) => val && setMode(val)}
                  >
                    <ToggleButton value="stream" aria-label="Stream">
                      Paginated View
                    </ToggleButton>
                    <ToggleButton value="full" aria-label="Full">
                      Full View
                    </ToggleButton>
                  </ToggleButtonGroup>
                </Stack>
                {error && (
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      borderRadius: 1.5,
                      borderColor: "error.light",
                      mb: 2,
                    }}
                  >
                    <Typography variant="body2" color="error.main">
                      {error}
                    </Typography>
                  </Paper>
                )}

                {mode === "stream" && pages.length > 0 && (
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    justifyContent={"center"}
                    mb={1}
                    flexWrap="wrap"
                  >
                    <Pagination
                      count={pages.length}
                      color="primary"
                      page={activePage?.page}
                      onChange={(_, value) => setCurrentPage(value)}
                      variant="outlined"
                    />
                  </Stack>
                )}

                <Box
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                    pr: 1,
                    display: "grid",
                    gap: 1.25,
                  }}
                >
                  {loadingContent && transcriptLines.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      Loading transcript…
                    </Typography>
                  )}
                  {!loadingContent && transcriptLines.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No transcript data yet.
                    </Typography>
                  )}
                  {transcriptGroups.map((group) => {
                    const color =
                      speakerColorMap.get(group.speaker) ?? "#0f766e";
                    return (
                      <Paper
                        key={`${group.speaker}-${group.start}-${group.end}-${group.lines.length}`}
                        variant="outlined"
                        sx={{
                          p: 1.25,
                          borderRadius: 1.5,
                          borderColor: alpha(color, 0.4),
                          bgcolor: alpha(color, 0.08),
                        }}
                      >
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          mb={0.5}
                        >
                          <Chip
                            size="small"
                            label={group.speaker}
                            sx={{
                              height: 26,
                              bgcolor: color,
                              color: "#ffffff",
                              "& .MuiChip-label": { px: 1 },
                            }}
                          />
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            fontWeight={600}
                          >
                            [{group.start.toFixed(2)} – {group.end.toFixed(2)}]
                          </Typography>
                        </Stack>
                        <Stack spacing={0.35}>
                          {group.lines.map((line) => (
                            <Typography
                              key={line.index}
                              variant="body2"
                              sx={{ lineHeight: 1.5 }}
                            >
                              {line.text}
                            </Typography>
                          ))}
                        </Stack>
                      </Paper>
                    );
                  })}
                </Box>
              </TabPanel>

              <TabPanel
                value="2"
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
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent="space-between"
                  mb={1.5}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <SummarizeRoundedIcon color="primary" />
                    <Typography variant="subtitle1" fontWeight={700}>
                      Summary
                    </Typography>
                  </Stack>
                  <Stack
                    direction="row"
                    spacing={2}
                    alignItems="center"
                    flexWrap="wrap"
                    justifyContent="flex-end"
                  >
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<SummarizeRoundedIcon />}
                      onClick={runSummary}
                      disabled={summaryLoading || !transcriptLines.length}
                    >
                      Generate summary
                    </Button>
                  </Stack>
                </Stack>

                {summaryError && (
                  <Alert severity="error" sx={{ mb: 1.5 }}>
                    {summaryError}
                  </Alert>
                )}

                {summaryProgress.status !== "idle" && summaryProgress.status !== "finished" && (
                  <Stack spacing={0.5} mb={1.25}>
                    <LinearProgress
                      variant={summaryProgressValue !== undefined ? "determinate" : "indeterminate"}
                      value={summaryProgressValue}
                      sx={{ borderRadius: 999 }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {summaryProgressLabel}
                    </Typography>
                  </Stack>
                )}

                {!summary && !summaryFetching && summaryProgress.status === "idle" && (
                  <Typography variant="body2" color="text.secondary">
                    Load a transcript and click “Generate summary” to create a
                    concise recap.
                  </Typography>
                )}

                {!summary && summaryProgress.status !== "finished" && (
                  <Typography variant="body2" color="text.secondary">
                    Awaiting summary results…
                  </Typography>
                )}

                {summary && (
                  <Stack spacing={1.5}>
                    {summary.headline && (
                      <Typography variant="h6" fontWeight={700}>
                        {summary.headline}
                      </Typography>
                    )}
                    <Stack spacing={1}>
                      {renderMarkdownBlocks(summary.summary)}
                    </Stack>
                    {(summary.bullet_points?.length ||
                      summary.bullets?.length) && (
                      <Stack spacing={0.75} mt={0.5}>
                        <Typography
                          variant="subtitle2"
                          color="text.secondary"
                          fontWeight={700}
                        >
                          Key points
                        </Typography>
                        {(summary.bullet_points ?? summary.bullets ?? []).map(
                          (point) => (
                            <Stack
                              direction="row"
                              spacing={1}
                              alignItems="flex-start"
                              key={point}
                            >
                              <CheckCircleRoundedIcon
                                fontSize="small"
                                color="success"
                                sx={{ mt: "2px" }}
                              />
                              <Typography variant="body2">{point}</Typography>
                            </Stack>
                          ),
                        )}
                      </Stack>
                    )}
                  </Stack>
                )}
              </TabPanel>

              <TabPanel
                value="3"
                sx={{
                  flex: 1,
                  minHeight: 0,
                  overflow: "auto",
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
                    <TaskAltRoundedIcon color="primary" />
                    <Typography variant="subtitle1" fontWeight={700}>
                      Actionable topics from this transcript
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={1} alignItems="center">
                    {analysisLoading && (
                      <CircularProgress size={22} thickness={5} />
                    )}
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<BoltRoundedIcon />}
                      onClick={runAnalysis}
                      disabled={analysisLoading || !transcriptLines.length}
                    >
                      Find actionables
                    </Button>
                  </Stack>
                </Stack>
                {analysisError && (
                  <Alert severity="error" sx={{ mb: 1.5 }}>
                    {analysisError}
                  </Alert>
                )}

                {analysisProgress.status !== "idle" && analysisProgress.status !== "finished" && (
                  <Stack spacing={0.5} mb={1.25}>
                    <LinearProgress
                      variant={analysisProgressValue !== undefined ? "determinate" : "indeterminate"}
                      value={analysisProgressValue}
                      sx={{ borderRadius: 999 }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {analysisProgressLabel}
                    </Typography>
                  </Stack>
                )}

                {!analysis && analysisProgress.status === "idle" && (
                  <Typography variant="body2" color="text.secondary">
                    Load a transcript and click “Find actionables” to extract
                    highlights and next steps.
                  </Typography>
                )}

                {!analysis && analysisProgress.status !== "idle" && (
                  <Typography variant="body2" color="text.secondary">
                    Awaiting analysis results…
                  </Typography>
                )}

                {analysis && (
                  <Stack spacing={2}>
                    <Stack spacing={0.75}>
                      <Typography
                        variant="subtitle2"
                        color="text.secondary"
                        fontWeight={700}
                      >
                        Highlights
                      </Typography>
                      {analysis.highlights.length === 0 && (
                        <Typography variant="body2" color="text.secondary">
                          No highlights detected in this transcript.
                        </Typography>
                      )}
                      <Stack spacing={0.75}>
                        {analysis.highlights.map((point) => (
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="flex-start"
                            key={point}
                          >
                            <CheckCircleRoundedIcon
                              fontSize="small"
                              color="success"
                              sx={{ mt: "2px" }}
                            />
                            <Typography variant="body2">{point}</Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </Stack>

                    <Divider />

                    <Stack spacing={1}>
                      <Typography
                        variant="subtitle2"
                        color="text.secondary"
                        fontWeight={700}
                      >
                        Actionable topics
                      </Typography>
                      {analysis.actionable_topics.length === 0 && (
                        <Typography variant="body2" color="text.secondary">
                          No actionable topics were found.
                        </Typography>
                      )}
                      <Stack spacing={1.25}>
                        {analysis.actionable_topics.map(
                          (item: ActionableTopic, idx: number) => (
                            <Paper
                              key={`${item.title}-${idx}`}
                              variant="outlined"
                              sx={{
                                p: 1.25,
                                borderRadius: 1.5,
                                borderColor: "divider",
                              }}
                            >
                              <Stack
                                direction="row"
                                spacing={1}
                                alignItems="center"
                                mb={0.5}
                              >
                                <Chip
                                  size="small"
                                  label={item.owner ? item.owner : "Owner Unknown"}
                                  color={item.owner ? "primary" : "default"}
                                  variant={item.owner ? "filled" : "outlined"}
                                />
                                {item.due && (
                                  <Chip
                                    size="small"
                                    label={`Due ${item.due}`}
                                    color="secondary"
                                    variant="outlined"
                                  />
                                )}
                              </Stack>
                              <Typography
                                variant="subtitle2"
                                fontWeight={700}
                                gutterBottom
                              >
                                {item.title || "Action item"}
                              </Typography>
                              {item.action && (
                                <Typography
                                  variant="body2"
                                  color="text.primary"
                                >
                                  {item.action}
                                </Typography>
                              )}
                              {item.impact && (
                                <Typography
                                  variant="body2"
                                  color="text.secondary"
                                  mt={0.5}
                                >
                                  Impact: {item.impact}
                                </Typography>
                              )}
                              {item.evidence && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  mt={0.5}
                                  display="block"
                                >
                                  Evidence: “{item.evidence}”
                                </Typography>
                              )}
                            </Paper>
                          ),
                        )}
                      </Stack>
                    </Stack>
                  </Stack>
                )}
              </TabPanel>
            </Box>
          </TabContext>
        </Paper>
      </Stack>
    </Stack>
  );
};

export default KnowledgeWorkspace;
