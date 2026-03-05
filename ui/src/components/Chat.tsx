import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  Alert,
  Avatar,
  Box,
  Chip,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import BarChartRoundedIcon from "@mui/icons-material/BarChartRounded";
import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import { renderMarkdown } from "../utils/renderMarkdown";
import {
  askAssistant,
  type AssistantChart,
  type AssistantResponse,
  type AssistantSource,
} from "../api";

const suggestedPrompts = [
  "What was discussed in the Combat Discrimination Meeting",
  "How many Budget meetings took place this year",
  "What are the most relevant results from this year's budget meetings",
];

type ChatEntry = {
  id: string;
  role: "user" | "assistant";
  text: string;
  chart?: AssistantChart;
  sources?: AssistantSource[];
};

export type { ChatEntry };

const ChatMessage = ({ role, text, chart, sources }: ChatEntry) => {
  const isUser = role === "user";
  const maxChart = useMemo(
    () => Math.max(1, ...(chart?.data?.map((d) => d.value) ?? [1])),
    [chart],
  );

  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="flex-start"
      justifyContent={isUser ? "flex-end" : "flex-start"}
      sx={{ width: "100%" }}
    >
      {!isUser && (
        <Avatar sx={{ bgcolor: "primary.main", width: 32, height: 32 }}>
          KB
        </Avatar>
      )}
      <Paper
        elevation={0}
        sx={(theme) => ({
          px: 2,
          py: 1.25,
          maxWidth: "90%",
          borderRadius: 2,
          bgcolor: isUser
            ? theme.palette.primary.main
            : theme.palette.background.paper,
          color: isUser
            ? theme.palette.common.white
            : theme.palette.text.primary,
          border: isUser ? "none" : `1px solid ${theme.palette.divider}`,
          boxShadow: isUser ? "0 10px 30px rgba(15, 118, 110, 0.25)" : "none",
        })}
      >
        <Stack spacing={0.75} sx={{ lineHeight: 1.6 }}>
          {renderMarkdown(text)}
        </Stack>

        {!isUser && chart?.data?.length ? (
          <Box
            sx={{
              mt: 1.25,
              p: 1.25,
              borderRadius: 1.5,
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "grey.50",
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <BarChartRoundedIcon fontSize="small" color="primary" />
              <Typography variant="caption" color="text.secondary">
                Chart ({chart.type ?? "bar"})
              </Typography>
            </Stack>
            <Stack spacing={0.75} mt={1}>
              {chart.data.map((row, idx) => (
                <Stack
                  key={`${row.name}-${idx}`}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                >
                  <Typography variant="body2" sx={{ minWidth: 90 }}>
                    {row.name}
                  </Typography>
                  <Box
                    sx={{
                      flex: 1,
                      height: 8,
                      borderRadius: 999,
                      bgcolor: "grey.200",
                      overflow: "hidden",
                    }}
                  >
                    <Box
                      sx={{
                        width: `${Math.min(100, Math.round((row.value / maxChart) * 100))}%`,
                        height: "100%",
                        bgcolor: "primary.main",
                      }}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {row.value}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
        ) : null}

        {!isUser && sources?.length ? (
          <Stack direction="row" spacing={0.75} flexWrap="wrap" mt={1}>
            {sources.map((source, idx) => {
              const transcriptId = source.reportId;
              const href = transcriptId
                ? `#/workspace?transcript=${encodeURIComponent(transcriptId)}`
                : "#/workspace";
              return (
                <Chip
                  key={`${source.reportId ?? source.title ?? idx}`}
                  size="small"
                  icon={<InsightsRoundedIcon fontSize="small" />}
                  label={source.title ?? source.reportId ?? "Source"}
                  variant="outlined"
                  clickable
                  component="a"
                  href={href}
                  sx={{
                    padding: '4px'
                  }}
                />
              );
            })}
          </Stack>
        ) : null}
      </Paper>
      {isUser && (
        <Avatar sx={{ bgcolor: "secondary.main", width: 32, height: 32 }}>
          You
        </Avatar>
      )}
    </Stack>
  );
};

type ChatProps = {
  messages: ChatEntry[];
  setMessages: Dispatch<SetStateAction<ChatEntry[]>>;
};

const Chat = ({ messages, setMessages }: ChatProps) => {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addMessage = (msg: Omit<ChatEntry, "id">) =>
    setMessages((prev) => [
      ...prev,
      { id: `${msg.role}-${Date.now()}-${prev.length}`, ...msg },
    ]);

  const handleSend = async (value?: string) => {
    const question = (value ?? prompt).trim();
    if (!question || loading) return;

    addMessage({ role: "user", text: question });
    setPrompt("");
    setError(null);
    setLoading(true);

    try {
      const response: AssistantResponse = await askAssistant(question);
      const answer =
        (response.answer ?? "").trim() ||
        (response.type === "chart"
          ? "Generated a chart based on the workspace knowledge."
          : "The assistant did not return an answer.");

      addMessage({
        role: "assistant",
        text: answer,
        chart: response.type === "chart" ? response.chart : undefined,
        sources: response.sources,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not reach the assistant.";
      setError(message);
      addMessage({
        role: "assistant",
        text: "I hit an error while trying to answer that. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: 2,
        paddingBottom: '48px'
      }}
    >
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {suggestedPrompts.map((promptText) => (
          <Chip
            key={promptText}
            label={promptText}
            variant="outlined"
            sx={{ borderRadius: "12px" }}
            onClick={() => handleSend(promptText)}
          />
        ))}
      </Stack>

      <Box sx={{ flex: 1, minHeight: 240, overflow: "hidden", display: "flex" }}>
        <Box
          sx={{
            flex: 1,
            p: 1.5,
            borderRadius: 2,
            border: "1px solid",
            borderColor: "divider",
            bgcolor: "background.default",
            overflowY: "auto",
          }}
        >
          <Stack spacing={1.5} pb={1}>
            {messages.map((msg) => (
              <ChatMessage
                id={msg.id}
                key={msg.id}
                role={msg.role}
                text={msg.text}
                chart={msg.chart}
                sources={msg.sources}
              />
            ))}
            {loading ? (
              <Typography variant="body2" color="text.secondary" textAlign="left">
                Assistant is thinking…
              </Typography>
            ) : null}
          </Stack>
        </Box>
      </Box>

      {error ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      ) : null}

      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        mt={1}
        sx={{
          position: { xs: "static", md: "sticky" },
          bottom: 0,
          bgcolor: "transparent",
          pt: 0.5,
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
              handleSend();
            }
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <ChatBubbleOutlineRoundedIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        <IconButton
          color="primary"
          size="large"
          disabled={loading}
          onClick={() => handleSend()}
        >
          <SendRoundedIcon />
        </IconButton>
      </Stack>
    </Box>
  );
};

export default Chat;
