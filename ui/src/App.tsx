import { useEffect, useState } from "react";
import MississaugaPage from "./pages/MississaugaPage";
import HomePage from "./pages/HomePage";
import TopicDetailPage from "./pages/TopicDetailPage";
import TranscriptPage from "./pages/TranscriptPage";
import CdmPage from "./pages/CdmPage";

type Route =
  | { page: "mississauga" }
  | { page: "home" }
  | { page: "cdm"; meetingId: string }
  | { page: "topic"; topicId: string }
  | { page: "transcript"; transcriptId: string };

const parseHash = (hash: string): Route => {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path = "/"] = trimmed.split("?");

  if (path === "/home") return { page: "home" };
  if (path.startsWith("/cdm/")) {
    const meetingId = path.slice("/cdm/".length);
    return { page: "cdm", meetingId };
  }
  if (path.startsWith("/topic/")) {
    const topicId = path.slice("/topic/".length);
    return { page: "topic", topicId };
  }
  if (path.startsWith("/transcript/")) {
    const transcriptId = path.slice("/transcript/".length);
    return { page: "transcript", transcriptId };
  }
  return { page: "mississauga" };
};

export const navigate = (hash: string) => {
  window.location.hash = hash;
};

const App = () => {
  const [route, setRoute] = useState<Route>(() =>
    parseHash(window.location.hash),
  );

  useEffect(() => {
    const handler = () => {
      window.scrollTo(0, 0);
      setRoute(parseHash(window.location.hash));
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  switch (route.page) {
    case "mississauga":
      return <MississaugaPage />;
    case "home":
      return <HomePage />;
    case "cdm":
      return <CdmPage meetingId={route.meetingId} />;
    case "topic":
      return <TopicDetailPage topicId={route.topicId} />;
    case "transcript":
      return <TranscriptPage transcriptId={route.transcriptId} />;
  }
};

export default App;
