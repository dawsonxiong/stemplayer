export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "2:04, added 28 Sep 2026". Either part is left out when it isn't known. */
export function trackDetails(duration: number, date: number | null) {
  const parts: string[] = [];
  if (duration > 0) parts.push(formatTime(duration));
  if (date) parts.push(`added ${DATE_FORMAT.format(date)}`);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
