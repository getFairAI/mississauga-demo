import type { TranscriptListItem } from "./api";

export type FeedItem = {
  id: string;
  headline: string;
  brief: string;
  description: string;
  date: string;
  committee: { id: string; name: string };
  deliberativeQuestion?: string;
  keyQuotes?: { speaker: string; role?: string; quote: string }[];
  hasAudio: boolean;
  negationGameUrl?: string;
};

export function transcriptToFeedItem(t: TranscriptListItem): FeedItem {
  return {
    id: t.id,
    headline: t.title,
    brief: t.topic ?? "",
    description: t.topic ?? "",
    date: "",
    committee: { id: t.topic ?? t.id, name: t.topic ?? "Council" },
    hasAudio: t.duration !== null,
  };
}
