import { useEffect, useState } from "react";
import {
  Box,
  Button,
  CssBaseline,
  Stack,
  ThemeProvider,
  createTheme,
} from "@mui/material";
import LouieWorkspace from "./components/LouieWorkspace";
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
type ViewMode = "classic" | "modern";

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
  const [viewMode, setViewMode] = useState<ViewMode>("classic");
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

  const brandBlue = "#0057A8";

  const modeSwitcher = (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        position: "fixed",
        top: viewMode === "classic" ? 8 : 12,
        right: 12,
        zIndex: 1200,
        background: viewMode === "classic" ? brandBlue : "transparent",
        borderRadius: "999px",
        p: viewMode === "classic" ? 0.5 : 0,
        boxShadow: viewMode === "classic" ? "0 6px 14px rgba(0,87,168,0.25)" : "none",
      }}
    >
      <Button
        size="small"
        variant={viewMode === "classic" ? "contained" : "outlined"}
        color={viewMode === "classic" ? "inherit" : "primary"}
        onClick={() => setViewMode("classic")}
        sx={
          viewMode === "classic"
            ? {
                bgcolor: "white",
                color: brandBlue,
                fontWeight: 700,
                "&:hover": { bgcolor: "#f2f6ff" },
              }
            : {}
        }
      >
        Classic
      </Button>
      <Button
        size="small"
        variant={viewMode === "modern" ? "contained" : "outlined"}
        color={viewMode === "classic" ? "inherit" : "primary"}
        onClick={() => setViewMode("modern")}
        sx={
          viewMode === "classic"
            ? {
                color: "white",
                borderColor: "rgba(255,255,255,0.6)",
                "&:hover": { bgcolor: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.9)" },
              }
            : {}
        }
      >
        Modern
      </Button>
    </Stack>
  );

  if (viewMode === "classic") {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {modeSwitcher}
        <LouieWorkspace />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {modeSwitcher}

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
            <KnowledgeWorkspace />
          )}
        </Box>
      </Box>
    </ThemeProvider>
  );
};

export default App;
