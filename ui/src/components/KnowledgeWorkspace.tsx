import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  Switch,
  FormControlLabel,
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
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false); // for generation
  const [summaryFetching, setSummaryFetching] = useState(false); // for initial fetch
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [saveSummary, setSaveSummary] = useState(false);

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
    setSummary(null);
    setSummaryError(null);
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
    try {
      setAnalysisLoading(true);
      setAnalysisError(null);
      const result = await analyzeTranscript({
        transcript_id: selectedId ?? undefined,
        transcript_text: transcriptText,
      });
      setAnalysis(result);
    } catch (err) {
      setAnalysisError((err as Error).message);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const runSummary = async () => {
    if (!transcriptText.trim()) {
      setSummaryError("Load a transcript first.");
      return;
    }
    try {
      setSummaryLoading(true);
      setSummaryError(null);
      setSummary(null);
      const result = await summarizeTranscript({
        transcript_id: selectedId ?? undefined,
        transcript_text: transcriptText,
        save_summary: saveSummary,
      });
      setSummary(result);
    } catch (err) {
      setSummaryError((err as Error).message);
    } finally {
      setSummaryLoading(false);
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
                    {(summaryFetching || summaryLoading) && (
                      <CircularProgress size={18} thickness={5} />
                    )}
                  </Stack>
                  <Stack
                    direction="row"
                    spacing={2}
                    alignItems="center"
                    flexWrap="wrap"
                    justifyContent="flex-end"
                  >
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={saveSummary}
                          onChange={(_, val) => setSaveSummary(val)}
                        />
                      }
                      label="Save to backend"
                    />
                    {summaryLoading && (
                      <CircularProgress size={22} thickness={5} />
                    )}
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

                {!summary && !summaryFetching && (
                  <Typography variant="body2" color="text.secondary">
                    Load a transcript and click “Generate summary” to create a
                    concise recap.
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

                {!analysis && (
                  <Typography variant="body2" color="text.secondary">
                    Load a transcript and click “Find actionables” to extract
                    highlights and next steps.
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
                                  label={item.owner ? item.owner : "Owner TBC"}
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
