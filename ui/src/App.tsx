import { useEffect, useState } from "react";
import MississaugaPage from "./pages/MississaugaPage";
import HomePage from "./pages/HomePage";
import TopicDetailPage from "./pages/TopicDetailPage";
import SearchChatPage from "./pages/SearchChatPage";

type Route =
  | { page: "mississauga" }
  | { page: "home" }
  | { page: "topic"; topicId: string }
  | { page: "chat"; initialQuery?: string };

const parseHash = (hash: string): Route => {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path = "/", query = ""] = trimmed.split("?");
  const params = new URLSearchParams(query);

  if (path === "/home") return { page: "home" };
  if (path.startsWith("/topic/")) {
    const topicId = path.slice("/topic/".length);
    return { page: "topic", topicId };
  }
  if (path === "/chat") {
    return { page: "chat", initialQuery: params.get("q") ?? undefined };
  }
  // Default: Mississauga entry page
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
    case "topic":
      return <TopicDetailPage topicId={route.topicId} />;
    case "chat":
      return <SearchChatPage initialQuery={route.initialQuery} />;
  }
};

export default App;
