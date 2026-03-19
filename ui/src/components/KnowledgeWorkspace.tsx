import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
  IconButton,
} from "@mui/material";
import Tab from "@mui/material/Tab";
import TabContext from "@mui/lab/TabContext";
import TabList from "@mui/lab/TabList";
import TabPanel from "@mui/lab/TabPanel";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import { formatTranscriptTitle } from "../utils/formatTranscriptTitle";
import { formatDuration } from "../utils/formatDuration";
import TranscriptsList from "./TranscriptsList";
import { useTranscriptions } from "../hooks/useTranscriptions";
import { useTranscriptionData } from "../hooks/useTranscriptionData";
import { useArgumentMap } from "../hooks/useArgumentMap";
import { useAudioSnippets } from "../hooks/useAudioSnippets";

const KnowledgeWorkspace = () => {
  const { data: transcripts, loading: loadingTranscripts, error: transcriptsError } =
    useTranscriptions();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const {
    data: transcriptData,
    loading: loadingTranscript,
    error: transcriptError,
  } = useTranscriptionData(selectedId, { enabled: Boolean(selectedId) });

  const {
    data: argumentMap,
    payload: argumentMapPayload,
    progress: argumentMapProgress,
    error: argumentMapError,
    ensure: ensureArgumentMap,
  } = useArgumentMap(selectedId);

  const { audioUrls, audioLoading, audioError, playSnippet } =
    useAudioSnippets(selectedId);

  const [graphUrl, setGraphUrl] = useState<string>("");
  const [value, setValue] = useState("1");

  const handleCoreQuestionNavigate = (negationUrl?: string) => {
    const trimmed = negationUrl?.trim();
    if (!trimmed) return;
    setGraphUrl(trimmed);
    setValue("2");
  };

  const handleChange = (_: SyntheticEvent, newValue: string) => {
    setValue(newValue);
  };

  useEffect(() => {
    if (value === "1") {
      void ensureArgumentMap();
    }
  }, [value, ensureArgumentMap]);

  const selectedMeta = useMemo(
    () => transcripts.find((t) => t.id === selectedId) ?? null,
    [transcripts, selectedId],
  );

  const transcriptStats = useMemo(
    () => ({
      lineCount: transcriptData?.total_lines ?? selectedMeta?.line_count ?? 0,
      duration: transcriptData?.duration ?? selectedMeta?.duration ?? null,
    }),
    [selectedMeta, transcriptData],
  );

  const argumentMapData = argumentMapPayload;

  const isArgumentMapBusy = ["fetching", "queued", "running"].includes(
    argumentMapProgress.status,
  );

  const isLoadingContent = loadingTranscript || isArgumentMapBusy;

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
        loadingList={loadingTranscripts}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        error={transcriptsError}
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
                  ? `${transcriptStats.lineCount} lines • ${formatDuration(transcriptStats.duration)}`
                  : "Choose a transcript"}
              </Typography>
            </Stack>
          </Stack>
        </Paper>

        {transcriptError ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {transcriptError}
          </Alert>
        ) : null}

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
                      {isLoadingContent && (
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
                      {isLoadingContent && (
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
                          const hasNegationUrl = Boolean(cq.negation_url?.trim());
                          return (
                          <Paper
                            key={`${cq.question}-${idx}`}
                            variant="outlined"
                            role={hasNegationUrl ? "button" : undefined}
                            tabIndex={hasNegationUrl ? 0 : undefined}
                            onClick={() => {
                              if (!hasNegationUrl) return;
                              handleCoreQuestionNavigate(cq.negation_url);
                            }}
                            onKeyDown={(e) => {
                              if (e.target !== e.currentTarget) return;
                              if (!hasNegationUrl) return;
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleCoreQuestionNavigate(cq.negation_url);
                              }
                            }}
                            sx={{
                              p: 1.25,
                              borderRadius: 1.5,
                              cursor: hasNegationUrl ? "pointer" : "default",
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
                                        <Box
                                          mt={1}
                                          width={'100%'}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <audio controls src={audioUrls[evKey]} style={{ width: "100%" }} />
                                        </Box>
                                      )}
                                      {audioError[evKey] && (
                                        <Typography
                                          variant="caption"
                                          color="error"
                                          display="block"
                                          sx={{ mt: 0.5 }}
                                        >
                                          {audioError[evKey]}
                                        </Typography>
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
