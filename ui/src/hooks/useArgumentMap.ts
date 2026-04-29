import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildArgumentMap,
  fetchArgumentMap,
  openProgressSocket,
  type ArgumentMapPayload,
  type ArgumentMapResponse,
} from "../api";

type ProgressStatus =
  | "idle"
  | "fetching"
  | "missing"
  | "queued"
  | "running"
  | "finished"
  | "error";

type Progress = {
  status: ProgressStatus;
  message?: string;
};

type Options = {
  /** Auto-fetch existing map on mount and on transcriptId change. Never starts a build. */
  autoFetch?: boolean;
  /** Auto-fetch existing map AND start a build if none exists. Legacy. */
  autoStart?: boolean;
};

type UseArgumentMapResult = {
  data: ArgumentMapResponse | null;
  payload: ArgumentMapPayload | null;
  progress: Progress;
  error: string | null;
  /** Fetch only: load existing map; if none, set status to "missing". Never starts a build. */
  loadExisting: () => Promise<void>;
  /** Fetch + build if missing. Idempotent: returns early if a request is already in flight. */
  ensure: () => Promise<void>;
  /** Force a fresh build, even if a map already exists. */
  generate: () => Promise<void>;
  reset: () => void;
};

const IN_FLIGHT_STATUSES: ReadonlySet<ProgressStatus> = new Set([
  "fetching",
  "queued",
  "running",
]);

export function useArgumentMap(
  transcriptId: string | null | undefined,
  options: Options = {},
): UseArgumentMapResult {
  const [data, setData] = useState<ArgumentMapResponse | null>(null);
  const [progress, setProgress] = useState<Progress>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const isMountedRef = useRef(true);
  const latestIdRef = useRef<string | null>(null);
  const dataRef = useRef<ArgumentMapResponse | null>(null);
  const statusRef = useRef<ProgressStatus>("idle");

  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  useEffect(() => {
    statusRef.current = progress.status;
  }, [progress.status]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  const closeSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    closeSocket();
    setData(null);
    setError(null);
    setProgress({ status: "idle" });
  }, [closeSocket]);

  // Reset whenever the transcript changes.
  useEffect(() => {
    reset();
    latestIdRef.current = transcriptId ?? null;
  }, [reset, transcriptId]);

  const startSocket = useCallback(
    (
      roomId: string,
      targetId: string,
      fallbackFile: string | null | undefined,
    ) => {
      const guard = () => isMountedRef.current && latestIdRef.current === targetId;

      closeSocket();
      const socket = openProgressSocket(roomId, (payload) => {
        if (!guard()) return;
        if (typeof payload === "string") return;

        const dataPayload = payload as Record<string, unknown>;
        if (dataPayload.job !== "argument_map") return;

        const stage = dataPayload.stage as string | undefined;
        if (!stage) return;

        if (stage === "queued" || stage === "running") {
          setProgress({ status: stage as ProgressStatus });
          return;
        }

        if (stage === "finished") {
          setProgress((prev) => ({ ...prev, status: "finished" }));
          return;
        }

        if (stage === "result") {
          const argument_map = (dataPayload.argument_map ?? {}) as ArgumentMapPayload;
          setData({
            transcript_id:
              ((dataPayload.transcript_id as string | undefined) ??
                targetId),
            argument_map_file:
              (dataPayload.argument_map_file as string | undefined) ??
              fallbackFile ??
              undefined,
            argument_map,
          });
          setProgress((prev) => ({ ...prev, status: "finished" }));
          closeSocket();
          return;
        }

        if (stage === "error") {
          const message =
            (dataPayload.message as string) || "Argument map job failed.";
          setError(message);
          setProgress({ status: "error", message });
          closeSocket();
        }
      });

      socketRef.current = socket;
    },
    [closeSocket],
  );

  const loadExisting = useCallback(async () => {
    if (!transcriptId) return;
    if (IN_FLIGHT_STATUSES.has(statusRef.current)) return;
    if (
      dataRef.current &&
      statusRef.current === "finished" &&
      (dataRef.current.transcript_id ?? transcriptId) === transcriptId
    ) {
      return;
    }

    const targetId = transcriptId;
    latestIdRef.current = targetId;
    const guard = () => isMountedRef.current && latestIdRef.current === targetId;

    try {
      setError(null);
      setProgress({ status: "fetching" });
      const existing = await fetchArgumentMap(targetId);
      if (!guard()) return;
      if (existing) {
        setData(existing);
        setProgress({ status: "finished" });
      } else {
        setProgress({ status: "missing" });
      }
    } catch (err) {
      if (!guard()) return;
      const message =
        err instanceof Error ? err.message : "Failed to load argument map.";
      setError(message);
      setProgress({ status: "error", message });
    }
  }, [transcriptId]);

  const startBuild = useCallback(
    async (force: boolean) => {
      if (!transcriptId) {
        setError("Load a transcript first.");
        return;
      }
      if (IN_FLIGHT_STATUSES.has(statusRef.current)) return;
      if (
        !force &&
        dataRef.current &&
        statusRef.current === "finished" &&
        (dataRef.current.transcript_id ?? transcriptId) === transcriptId
      ) {
        return;
      }

      const targetId = transcriptId;
      latestIdRef.current = targetId;
      const guard = () => isMountedRef.current && latestIdRef.current === targetId;

      try {
        setError(null);
        setProgress({ status: "queued" });
        const start = await buildArgumentMap({ transcript_id: targetId });
        if (!guard()) return;

        if (start.status === "already_exists" && !force) {
          const found = await fetchArgumentMap(targetId);
          if (!guard()) return;
          if (found) {
            setData(found);
            setProgress({ status: "finished" });
            return;
          }
        }

        if (!start.room_id) {
          const message = "Unable to start argument map job.";
          setError(message);
          setProgress({ status: "error", message });
          return;
        }

        startSocket(start.room_id, targetId, start.argument_map_file ?? null);
      } catch (err) {
        if (!guard()) return;
        const message =
          err instanceof Error
            ? err.message
            : "Failed to start argument map job.";
        setError(message);
        setProgress({ status: "error", message });
      }
    },
    [startSocket, transcriptId],
  );

  const ensure = useCallback(async () => {
    if (!transcriptId) {
      setError("Load a transcript first.");
      return;
    }
    if (IN_FLIGHT_STATUSES.has(statusRef.current)) return;
    if (
      dataRef.current &&
      statusRef.current === "finished" &&
      (dataRef.current.transcript_id ?? transcriptId) === transcriptId
    ) {
      return;
    }

    const targetId = transcriptId;
    latestIdRef.current = targetId;
    const guard = () => isMountedRef.current && latestIdRef.current === targetId;

    try {
      setError(null);
      setProgress({ status: "fetching" });
      const existing = await fetchArgumentMap(targetId);
      if (!guard()) return;
      if (existing) {
        setData(existing);
        setProgress({ status: "finished" });
        return;
      }
    } catch (err) {
      if (!guard()) return;
      const message =
        err instanceof Error ? err.message : "Failed to load argument map.";
      setError(message);
      setProgress({ status: "error", message });
      return;
    }

    await startBuild(false);
  }, [startBuild, transcriptId]);

  const generate = useCallback(async () => {
    if (!transcriptId) {
      setError("Load a transcript first.");
      return;
    }
    // Force a build even if one already exists.
    await startBuild(true);
  }, [startBuild, transcriptId]);

  // Auto-fetch existing on mount / transcript change. Never starts a build.
  useEffect(() => {
    if (options.autoFetch && transcriptId) {
      void loadExisting();
    }
  }, [loadExisting, options.autoFetch, transcriptId]);

  // Legacy auto-start: fetch existing AND build if missing.
  useEffect(() => {
    if (options.autoStart && transcriptId) {
      void ensure();
    }
  }, [ensure, options.autoStart, transcriptId]);

  const payload = useMemo<ArgumentMapPayload | null>(() => {
    if (!data) return null;
    return (data.argument_map as ArgumentMapPayload) ?? null;
  }, [data]);

  return {
    data,
    payload,
    progress,
    error,
    loadExisting,
    ensure,
    generate,
    reset,
  };
}
