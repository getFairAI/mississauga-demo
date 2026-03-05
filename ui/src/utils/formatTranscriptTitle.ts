export const formatTranscriptTitle = (raw: string): string => {
  const match = raw.match(/_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{1,2})$/);
  if (!match) return raw;

  const [, year, month, day, hour, minute] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};
