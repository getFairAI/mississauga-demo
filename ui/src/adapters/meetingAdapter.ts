import type {
  ArgumentMapPayload,
  SummaryListResponse,
  TranscriptListItem,
} from "../api";

export type KeyQuote = {
  speaker: string;
  role?: string;
  quote: string;
};

export type MeetingQuestion = {
  id: string;
  number: number;
  label: string;
  question: string;
  deliberativeQuestion: string;
  negationGameUrl?: string;
  audioSegment?: { start: number; end: number };
  summary: string;
  decision?: string;
  theme?: string;
  keyQuotes?: KeyQuote[];
};

export type Meeting = {
  id: string;
  committee: string;
  committeeId: string;
  date: string;
  time: string;
  location: string;
  questions: MeetingQuestion[];
  summary: string;
};

export type ArgNode = {
  tag: string;
  type: "support" | "negate" | "mitigate";
  content: string;
  speaker?: string;
  timestamp?: string;
};

export type ArgOption = {
  label: string;
  nodes: ArgNode[];
};

export type SubQuestion = {
  text: string;
  speaker?: string;
  answers: { text: string; speaker?: string }[];
};

export type UnresolvedItem = { text: string };

export type QuestionMap = {
  id: string;
  number: string;
  question: string;
  status: "open" | "closed";
  claim?: string;
  options?: ArgOption[];
  nodes?: ArgNode[];
  subQuestions?: SubQuestion[];
  unresolved?: UnresolvedItem[];
  referral?: string;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

type FilenameMeta = {
  date: string;
  time: string;
  committeeId: string;
};

const FILENAME_RE = /^(.*?)_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})$/;

const parseFilenameMetadata = (id: string): FilenameMeta => {
  const m = id.match(FILENAME_RE);
  if (!m) return { date: "", time: "", committeeId: id };
  const [, prefix, y, mo, d, hh, mm] = m;
  try {
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm));
    const weekday = WEEKDAYS[dt.getUTCDay()];
    const month = MONTHS[+mo - 1];
    const date = `${weekday}, ${parseInt(d, 10)} ${month} ${y}`;
    let h12 = +hh % 12;
    if (h12 === 0) h12 = 12;
    const ampm = +hh < 12 ? "AM" : "PM";
    const time = `${h12}:${mm} ${ampm}`;
    return { date, time, committeeId: prefix };
  } catch {
    return { date: "", time: "", committeeId: prefix };
  }
};

const HMS_RE = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
const MS_RE = /^(\d{1,3}):(\d{2})(?:\.\d+)?$/;

const parseTimestampToSeconds = (raw: string): number | null => {
  const s = raw.trim();
  if (!s) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const hms = s.match(HMS_RE);
  if (hms) return +hms[1] * 3600 + +hms[2] * 60 + +hms[3];
  const ms = s.match(MS_RE);
  if (ms) return +ms[1] * 60 + +ms[2];
  return null;
};

type Range = { start: number; end: number };

const parseRange = (raw: string | undefined): Range | null => {
  if (!raw) return null;
  const split = raw.split(/\s*-\s*/);
  if (split.length === 2) {
    const start = parseTimestampToSeconds(split[0]);
    const end = parseTimestampToSeconds(split[1]);
    if (start !== null && end !== null) return { start, end };
  }
  const single = parseTimestampToSeconds(raw);
  if (single !== null) return { start: single, end: single };
  return null;
};

const evidenceRangeFor = (
  evidence: Array<{ timestamp?: string }> | undefined,
): Range | undefined => {
  if (!evidence || evidence.length === 0) return undefined;
  let min = Infinity;
  let max = -Infinity;
  for (const e of evidence) {
    const r = parseRange(e.timestamp);
    if (!r) continue;
    if (r.start < min) min = r.start;
    if (r.end > max) max = r.end;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  if (max <= min) max = min + 30; // ensure a non-zero clip duration
  return { start: min, end: max };
};

const titleCaseTopic = (topic: string | undefined): string => {
  if (!topic) return "General";
  return topic;
};

const shortLabelFor = (questionText: string, fallbackIndex: number): string => {
  if (!questionText) return `Q${fallbackIndex}`;
  const words = questionText.replace(/[?.!]+$/, "").split(/\s+/);
  if (words.length <= 6) return words.join(" ");
  return words.slice(0, 6).join(" ") + "…";
};

export function buildMeeting(
  list: TranscriptListItem,
  argMap: ArgumentMapPayload | null,
  summaries: SummaryListResponse | null,
): Meeting {
  const meta = parseFilenameMetadata(list.id);
  const fallbackSummary =
    summaries?.versions?.[summaries.versions.length - 1]?.summary ?? "";

  const coreQuestions = argMap?.argument_map?.core_questions ?? [];

  const questions: MeetingQuestion[] = coreQuestions.map((cq, idx) => {
    const number = idx + 1;
    const baseQuestion = cq.question ?? "";
    const deliberativeQuestion = cq.deliberative_question ?? baseQuestion;
    const decision =
      cq.decision ?? (cq.unresolved ? "Unresolved" : undefined);
    const theme = cq.theme ?? list.topic;
    const summary = cq.summary ?? "";
    const negationGameUrl = cq.negation_url;
    const audioSegment = evidenceRangeFor(cq.evidence);
    const keyQuotes: KeyQuote[] = (cq.evidence ?? [])
      .filter((e) => e.quote)
      .map((e) => ({
        speaker: e.speaker ?? "",
        role: e.role,
        quote: e.quote ?? "",
      }));

    return {
      id: `${list.id}-q${number}`,
      number,
      label: shortLabelFor(baseQuestion, number),
      question: baseQuestion,
      deliberativeQuestion,
      negationGameUrl,
      audioSegment,
      summary,
      decision,
      theme,
      keyQuotes,
    };
  });

  return {
    id: list.id,
    committee: titleCaseTopic(list.topic),
    committeeId: meta.committeeId,
    date: meta.date,
    time: meta.time,
    location: "",
    questions,
    summary: fallbackSummary,
  };
}

const labelToNodeType = (
  label: string | undefined,
): "support" | "negate" | "mitigate" => {
  if (!label) return "support";
  const head = label.trim().toUpperCase();
  if (head.startsWith("N")) return "negate";
  if (head.startsWith("M")) return "mitigate";
  return "support";
};

const toArgNode = (
  label: string,
  claim: string,
  evidence: Array<{ speaker?: string; timestamp?: string; quote?: string }>,
): ArgNode => {
  const speakerEvidence = evidence?.find((e) => e.speaker);
  return {
    tag: label,
    type: labelToNodeType(label),
    content: claim,
    speaker: speakerEvidence?.speaker,
    timestamp: speakerEvidence?.timestamp,
  };
};

export function buildQuestionMaps(
  argMap: ArgumentMapPayload | null,
): QuestionMap[] {
  const cqs = argMap?.argument_map?.core_questions ?? [];
  return cqs.map((cq, idx) => {
    const number = `${idx + 1}`;
    const status: "open" | "closed" = cq.type === "closed" ? "closed" : "open";

    const evidence = cq.evidence ?? [];
    const optionsOrClaims = cq.options_or_claims ?? [];

    if (status === "closed") {
      // closed → all options_or_claims become flat nodes
      const nodes: ArgNode[] = optionsOrClaims.map((o) =>
        toArgNode(o.label ?? "S", o.claim ?? "", evidence),
      );
      const claim = optionsOrClaims.find((o) => /^S/i.test(o.label ?? ""))?.claim;
      return {
        id: `q-${idx + 1}`,
        number,
        question: cq.question ?? "",
        status,
        claim,
        nodes: nodes.length ? nodes : undefined,
        unresolved: cq.unresolved
          ? [{ text: "Outcome not finalized in this meeting." }]
          : undefined,
      };
    }

    // open → group nodes by their option label
    const options: ArgOption[] = optionsOrClaims.map((o) => ({
      label: o.label ?? "O",
      nodes: [toArgNode(o.label ?? "O", o.claim ?? "", evidence)],
    }));

    return {
      id: `q-${idx + 1}`,
      number,
      question: cq.question ?? "",
      status,
      options: options.length ? options : undefined,
      unresolved: cq.unresolved
        ? [{ text: "Outcome not finalized in this meeting." }]
        : undefined,
    };
  });
}
