const API_BASE =
  // Prefer env override; fallback to local dev server.
  (import.meta.env?.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";

export type TranscriptListItem = {
  id: string;
  title: string;
  line_count: number;
  duration: number | null;
  topic: string;
  argument_map_file?: string | null;
  has_argument_map?: boolean;
};

export type TranscriptLine = {
  index: number;
  start: number;
  end: number;
  speaker: string;
  text: string;
};

export type TranscriptFull = {
  id: string;
  title: string;
  total_lines: number;
  duration: number | null;
  lines: TranscriptLine[];
};

export type TranscriptPage = {
  id: string;
  title: string;
  page: number;
  total_pages: number;
  page_size: number;
  total_lines: number;
  duration: number | null;
  lines: TranscriptLine[];
};

export type ActionableTopic = {
  title: string;
  action?: string;
  owner?: string | null;
  due?: string | null;
  impact?: string;
  evidence?: string;
};

export type SummaryResponse = {
  transcript_id?: string | null;
  summary_file?: string | null;
  headline?: string | null;
  summary: string;
  bullet_points?: string[];
  bullets?: string[];
};

export type SummaryVersion = {
  version: number;
  summary: string;
  summary_file?: string;
  headline?: string | null;
  bullet_points?: string[];
  bullets?: string[];
};

export type SummaryListResponse = {
  transcript_id: string;
  versions: SummaryVersion[];
};

export type SummaryStartResponse = {
  room_id: string;
  status: string;
  transcript_id?: string | null;
  save_summary?: boolean;
};

export type AnalysisResponse = {
  transcript_id?: string | null;
  highlights: string[];
  actionable_topics: ActionableTopic[];
};

export type AnalyzeStartResponse = {
  room_id: string;
  status: string;
  transcript_id?: string | null;
};

export type ArgumentMapPayload = {
  word_count?: {
    raw?: number;
    critical_words?: string[];
    compression_ratio?: number | string;
  };
  argument_map?: {
    agenda?: { item?: string; presenter?: string | null }[];
    core_questions?: Array<{
      question?: string;
      negation_url?: string;
      type?: string;
      unresolved?: boolean;
      options_or_claims?: Array<{ label?: string; claim?: string; support?: string[] }>;
      evidence?: Array<{ speaker?: string; timestamp?: string; quote?: string }>;
    }>;
  };
  raw?: unknown;
};

export type ArgumentMapResponse = {
  transcript_id?: string;
  argument_map_file?: string;
  argument_map: ArgumentMapPayload;
};

export type ArgumentMapVersion = {
  version: number;
  argument_map: ArgumentMapPayload;
  argument_map_file?: string;
};

export type ArgumentMapListResponse = {
  transcript_id: string;
  versions: ArgumentMapVersion[];
};

export type ArgumentMapStartResponse = {
  room_id?: string;
  status: string;
  transcript_id?: string | null;
  argument_map_file?: string | null;
};

export type AssistantSource = {
  reportId?: string;
  title?: string;
};

export type AssistantChart = {
  type?: string;
  data?: { name: string; value: number }[];
};

export type AssistantResponse = {
  type: "text" | "chart";
  answer?: string;
  chart?: AssistantChart;
  sources?: AssistantSource[];
};

export async function sendOpenAI(file: File, roomId?: string, diarize = false) {
  const form = new FormData();
  form.append("file", file);
  if (roomId) form.append("room_id", roomId);
  if (diarize) form.append("diarize", String(diarize));

  const res = await fetch(`${API_BASE}/openai_transcribe`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ room_id: string; transcript: string; diarize: boolean; segments?: unknown; raw?: unknown }>;
}

export async function sendWhisperX(file: File, device = "cuda", roomId?: string) {
  const form = new FormData();
  form.append("file", file);
  form.append("device", device);
  if (roomId) form.append("room_id", roomId);

  const res = await fetch(`${API_BASE}/whisperx_traanscribe`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ room_id: string; transcript: string; device: string }>;
}

export async function summarizeTranscript(body: {
  transcript_id?: string;
}) {
  const res = await fetch(`${API_BASE}/transcriptions/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript_id: body.transcript_id,
      save_summary: true,
    }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<SummaryStartResponse>;
}

export async function fetchSummaries(transcriptId: string): Promise<SummaryListResponse | null> {
  const res = await fetch(
    `${API_BASE}/transcriptions/${encodeURIComponent(transcriptId)}/summary`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<SummaryListResponse>;
}

/** Backward-compat wrapper — returns the latest version in the old format. */
export async function fetchSummary(transcriptId: string): Promise<SummaryResponse | null> {
  const result = await fetchSummaries(transcriptId);
  if (!result || result.versions.length === 0) return null;
  const latest = result.versions[result.versions.length - 1];
  return {
    transcript_id: result.transcript_id,
    summary_file: latest.summary_file,
    summary: latest.summary,
    headline: latest.headline,
    bullet_points: latest.bullet_points,
    bullets: latest.bullets,
  };
}

export async function analyzeTranscript(body: { transcript_id?: string }) {
  const res = await fetch(`${API_BASE}/transcriptions/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<AnalyzeStartResponse>;
}

export async function buildArgumentMap(body: { transcript_id?: string }) {
  const res = await fetch(`${API_BASE}/transcriptions/argument-map`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<ArgumentMapStartResponse>;
}

export async function fetchArgumentMaps(transcriptId: string): Promise<ArgumentMapListResponse | null> {
  const res = await fetch(
    `${API_BASE}/transcriptions/${encodeURIComponent(transcriptId)}/argument-map`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<ArgumentMapListResponse>;
}

/** Backward-compat wrapper — returns the latest version in the old format. */
export async function fetchArgumentMap(transcriptId: string): Promise<ArgumentMapResponse | null> {
  const result = await fetchArgumentMaps(transcriptId);
  if (!result || result.versions.length === 0) return null;
  const latest = result.versions[result.versions.length - 1];
  return {
    transcript_id: result.transcript_id,
    argument_map_file: latest.argument_map_file,
    argument_map: latest.argument_map,
  };
}

export async function sliceAudioSegment(params: {
  file: File;
  start: number;
  end: number;
  output_format?: "mp3" | "wav";
}): Promise<{ url: string; contentType: string | null }> {
  const form = new FormData();
  form.append("file", params.file);
  form.append("start", String(params.start));
  form.append("end", String(params.end));
  form.append("output_format", params.output_format ?? "mp3");

  const res = await fetch(`${API_BASE}/audio/slice`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  return { url, contentType: res.headers.get("Content-Type") };
}

export async function sliceAudioByTranscript(params: {
  transcript_id: string;
  start: number;
  end: number;
  output_format?: "mp3" | "wav";
}): Promise<{ url: string; contentType: string | null }> {
  const res = await fetch(`${API_BASE}/audio/slice-by-id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript_id: params.transcript_id,
      start: params.start,
      end: params.end,
      output_format: params.output_format ?? "mp3",
    }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  return { url, contentType: res.headers.get("Content-Type") };
}

export function openProgressSocket(roomId: string, onMessage: (data: unknown) => void) {
  const ws = new WebSocket(`${API_BASE.replace("http", "ws")}/ws/${roomId}`);
  ws.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data));
    } catch {
      onMessage(event.data);
    }
  };
  return ws;
}

export async function listTranscriptions(): Promise<TranscriptListItem[]> {
  const res = await fetch(`${API_BASE}/transcriptions`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const data = (await res.json()) as { items: TranscriptListItem[] };
  return data.items ?? [];
}

export async function fetchTranscript(transcriptId: string): Promise<TranscriptFull> {
  const res = await fetch(`${API_BASE}/transcriptions/${encodeURIComponent(transcriptId)}?stream=false`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<TranscriptFull>;
}

export async function streamTranscriptPages(
  transcriptId: string,
  pageSize: number,
  opts: { signal?: AbortSignal; onPage: (page: TranscriptPage) => void },
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/transcriptions/${encodeURIComponent(transcriptId)}?stream=true&page_size=${pageSize}`,
    { signal: opts.signal },
  );
  if (!res.ok) {
    throw new Error(await res.text());
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("Streaming not supported in this browser.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      opts.onPage(JSON.parse(trimmed) as TranscriptPage);
    }
  }

  const tail = buffer.trim();
  if (tail) {
    opts.onPage(JSON.parse(tail) as TranscriptPage);
  }
}

export async function askAssistant(question: string): Promise<AssistantResponse> {
  const form = new FormData();
  form.append("question", question);

  const res = await fetch(`${API_BASE}/assistant`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json() as Promise<AssistantResponse>;
}
