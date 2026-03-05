import {
  Stack,
  Typography,
  TextField,
  InputAdornment,
  LinearProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Paper,
  Box,
  Divider,
  Chip,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import type { TranscriptListItem } from "../api";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import { formatTranscriptTitle } from "../utils/formatTranscriptTitle";
import { formatDuration } from "../utils/formatDuration";

interface TranscriptsListArgs {
  transcripts: TranscriptListItem[];
  loadingList: boolean;
  selectedId: string | null;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
}

const VideoListItem = ({
  selected,
  title,
  duration,
  updated,
  tags,
  onSelect,
}: {
  selected: boolean;
  title: string;
  duration: string;
  updated: string;
  tags: string[];
  onSelect: () => void;
}) => (
  <Paper
    onClick={onSelect}
    elevation={0}
    sx={(theme) => ({
      p: 2,
      borderRadius: 2,
      border: `1px solid ${selected ? theme.palette.primary.main : theme.palette.divider}`,
      bgcolor: selected
        ? "rgba(15, 118, 110, 0.06)"
        : theme.palette.background.paper,
      cursor: "pointer",
      transition: "all 180ms ease",
      "&:hover": {
        borderColor: theme.palette.primary.main,
        transform: "translateY(-2px)",
      },
    })}
  >
    <Stack spacing={1}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box
          sx={{
            width: 38,
            height: 38,
            borderRadius: 1.25,
            bgcolor: "primary.main",
            color: "common.white",
            display: "grid",
            placeItems: "center",
          }}
        >
          <PlayArrowRoundedIcon />
        </Box>
        <Stack spacing={0.5} flex={1}>
          <Typography variant="subtitle1" fontWeight={700}>
            {title}
          </Typography>
          <Stack
            direction="row"
            spacing={1.5}
            alignItems="center"
            color="text.secondary"
          >
            <Stack direction="row" spacing={0.5} alignItems="center">
              <AccessTimeRoundedIcon fontSize="small" />
              <Typography variant="caption">{duration}</Typography>
            </Stack>
            <Divider orientation="vertical" flexItem />
            <Typography variant="caption">{updated}</Typography>
          </Stack>
        </Stack>
      </Stack>
      <Stack direction="row" spacing={1} flexWrap="wrap">
        {tags.map((tag) => (
          <Chip
            key={tag}
            label={tag}
            size="small"
            sx={{ borderRadius: "10px" }}
          />
        ))}
      </Stack>
    </Stack>
  </Paper>
);

const TranscriptsList = ({ transcripts, loadingList, selectedId, setSelectedId }: TranscriptsListArgs) => {
  const [query, setQuery] = useState("");
  const [expandedTopics, setExpandedTopics] = useState<Record<string, boolean>>({});

  const filteredTranscripts = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return transcripts;
    return transcripts.filter(
      (t) =>
        t.title.toLowerCase().includes(term) ||
        (t.topic ?? "").toLowerCase().includes(term),
    );
  }, [query, transcripts]);

  const groupedByTopic = useMemo(() => {
    const groups: Record<string, TranscriptListItem[]> = {};
    filteredTranscripts.forEach((item) => {
      const topic = item.topic || "Other";
      if (!groups[topic]) groups[topic] = [];
      groups[topic].push(item);
    });
    return groups;
  }, [filteredTranscripts]);

  const topics = useMemo(
    () => Object.keys(groupedByTopic).sort((a, b) => a.localeCompare(b)),
    [groupedByTopic],
  );

  useEffect(() => {
    setExpandedTopics((prev) => {
      const next: Record<string, boolean> = {};
      topics.forEach((topic) => {
        next[topic] = prev[topic] ?? true; // default to expanded when new topic appears
      });
      return next;
    });
  }, [topics]);

  const tagsFor = (item: TranscriptListItem) => {
    const tags: string[] = [];
    if (item.duration) tags.push("Recorded");
    if (item.line_count > 0) tags.push("Transcript");
    return tags;
  };

  return (
    <>
      <Stack
        spacing={2}
        sx={{
          width: { xs: "100%", lg: "30%" },
          maxHeight: "100%",
          minHeight: 0,
          height: "100%",
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <Stack spacing={0.5}>
            <Typography
              variant="overline"
              color="primary.main"
              fontWeight={700}
            >
              Knowledge Base
            </Typography>
            <Typography
              variant="h5"
              fontFamily="'Space Grotesk', 'Manrope', sans-serif"
              fontWeight={700}
            >
              Transcripts
            </Typography>
          </Stack>
        </Stack>

        <TextField
          placeholder="Search titles…"
          size="small"
          sx={{
            pr: 0.5,
          }}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />

        <Stack
          spacing={1.5}
          sx={{ flex: 1, minHeight: 0, overflow: "auto", pr: 0.5 }}
        >
          {loadingList && <LinearProgress />}
          {!loadingList && filteredTranscripts.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              {query ? "No transcripts match your search." : "No transcript files found in /transcriptions."}
            </Typography>
          )}
          {topics.map((topic) => (
            <Accordion
              key={topic}
              expanded={expandedTopics[topic] ?? true}
              onChange={(_, isExpanded) =>
                setExpandedTopics((prev) => ({ ...prev, [topic]: isExpanded }))
              }
              disableGutters
              square
              sx={{
                background: "transparent",
                boxShadow: "none",
                border: "none",
                "&:before": { display: "none" },
                "&.Mui-expanded": { margin: 0 },
                "& .MuiAccordionSummary-root": {
                  px: 0,
                  minHeight: 0,
                },
                "& .MuiAccordionDetails-root": { px: 0, pt: 1.25, pb: 0 },
              }}
            >
              <AccordionSummary
                aria-controls={`${topic}-content`}
                id={`${topic}-header`}
                expandIcon={<KeyboardArrowDownRoundedIcon fontSize="small" />}
                sx={{
                  px: 0,
                  py: 0.5,
                  "& .MuiAccordionSummary-content": {
                    m: 0,
                    width: "100%",
                  },
                }}
              >
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  width="100%"
                >
                  <Typography
                    variant="overline"
                    fontWeight={700}
                    color="text.secondary"
                    sx={{ letterSpacing: 0.8 }}
                  >
                    {topic}
                  </Typography>
                  <Box
                    flex={1}
                    sx={{
                      borderBottom: "1px solid",
                      borderColor: "divider",
                      opacity: 0.7,
                    }}
                  />
                  <Chip
                    size="small"
                    label={`${groupedByTopic[topic]?.length ?? 0}`}
                    variant="outlined"
                  />
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1.25}>
                  {groupedByTopic[topic]?.map((item) => (
                    <VideoListItem
                      key={item.id}
                      selected={item.id === selectedId}
                      title={formatTranscriptTitle(item.title)}
                      duration={formatDuration(item.duration)}
                      updated={`${item.line_count} lines`}
                      tags={tagsFor(item)}
                      onSelect={() => setSelectedId(item.id)}
                    />
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
          ))}
        </Stack>
      </Stack>
    </>
  );
};

export default TranscriptsList;
