import { useEffect, useState } from "react";
import MississaugaPage from "./pages/MississaugaPage";
import CdmPage from "./pages/CdmPage";

type Route =
  | { page: "mississauga" }
  | { page: "cdm"; meetingId: string };

const parseHash = (hash: string): Route => {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path = "/"] = trimmed.split("?");

  if (path.startsWith("/cdm/")) {
    const meetingId = path.slice("/cdm/".length);
    return { page: "cdm", meetingId };
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
    case "cdm":
      return <CdmPage meetingId={route.meetingId} />;
  }
};

export default App;
