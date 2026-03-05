import { useEffect, useState } from "react";
import {
  Box,
  Button,
  CssBaseline,
  Stack,
  ThemeProvider,
  createTheme,
} from "@mui/material";
import KnowledgeWorkspace from "./components/KnowledgeWorkspace";
import Chat, { type ChatEntry } from "./components/Chat";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#3aaaaa" },
    secondary: { main: "#f97316" },
    background: {
      default: "#f7f9fb",
      paper: "#ffffff",
    },
  },
  typography: {
    fontFamily: `'Manrope', 'Space Grotesk', 'Segoe UI', sans-serif`,
    h5: {
      fontFamily: `'Space Grotesk', 'Manrope', sans-serif`,
      fontWeight: 700,
    },
    h6: {
      fontFamily: `'Space Grotesk', 'Manrope', sans-serif`,
      fontWeight: 700,
    },
  },
  shape: {
    borderRadius: 14,
  },
});

type Route = "workspace" | "chat";

type RouteState = { route: Route; transcriptId: string | null };

const parseHash = (hash: string): RouteState => {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path = "/", query = ""] = trimmed.split("?");
  const params = new URLSearchParams(query);
  const transcriptId = params.get("transcript");
  const route: Route = path === "/chat" ? "chat" : "workspace";
  return { route, transcriptId };
};

const App = () => {
  const [routeState, setRouteState] = useState<RouteState>(() =>
    parseHash(window.location.hash),
  );
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "I can surface answers from the transcripts, highlights, and summaries in this workspace.",
    },
  ]);

  useEffect(() => {
    const handler = () => setRouteState(parseHash(window.location.hash));
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  const navigate = (target: Route) => {
    window.location.hash = target === "chat" ? "/chat" : "/";
    setRouteState((prev) => ({ ...prev, route: target }));
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />

      <Box
        sx={{
          width: "100%",
          minHeight: "100vh",
          height: "100%",
          background:
            "linear-gradient(180deg, #f7f9fb 0%, #eef2ff 30%, #f9fafb 100%)",
          p: { xs: 2, md: 3, lg: 4 },
          display: "flex",
        }}
      >
        <Box
          width={"100%"}
          height={"100%"}
          sx={{
            position: "relative",
            overflow: "hidden",
            borderRadius: 3,
            p: { xs: 2.5, md: 3 },
            bgcolor: "rgba(255,255,255,0.9)",
            backdropFilter: "blur(10px)",
            boxShadow: "0 30px 60px rgba(15,23,42,0.08)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background:
                "radial-gradient(circle at 20% 20%, rgba(15,118,110,0.08), transparent 35%), radial-gradient(circle at 80% 10%, rgba(249,115,22,0.12), transparent 30%)",
            }}
          />
          <Stack direction="row-reverse" spacing={2} pb={2}>
            <Button
              variant={routeState.route === "workspace" ? "contained" : "outlined"}
              onClick={() => navigate("workspace")}
            >
              Workspace
            </Button>
            <Button
              variant={routeState.route === "chat" ? "contained" : "outlined"}
              onClick={() => navigate("chat")}
            >
              Chat
            </Button>
          </Stack>
          {routeState.route === "chat" ? (
            <Chat messages={chatMessages} setMessages={setChatMessages} />
          ) : (
            <KnowledgeWorkspace initialTranscriptId={routeState.transcriptId} />
          )}
        </Box>
      </Box>
    </ThemeProvider>
  );
};

export default App;
