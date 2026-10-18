const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export const formatCount = (value: number) => compact.format(value);

const exact = new Intl.NumberFormat("en");

/** "290,712 views", or "13M views" when YouTube only gave a rounded figure. */
export function formatViews(video: { views: number; viewsApprox?: boolean }) {
  if (!video.views) return "";
  return `${video.viewsApprox ? compact.format(video.views) : exact.format(video.views)} ${video.views === 1 ? "view" : "views"}`;
}

export function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Time spent, for Analytics: "45s", "12m", "3h 05m", "41h". */
export function formatWatchTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h >= 24 || !m ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}m`;
}

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 days ago"; empty when the date is unknown. */
export function formatAgo(iso: string, now = Date.now()) {
  const time = new Date(iso).getTime();
  if (!iso || Number.isNaN(time)) return "";
  const diff = (time - now) / 1000;
  for (const [unit, size] of units) {
    if (Math.abs(diff) >= size) return relative.format(Math.round(diff / size), unit);
  }
  return "just now";
}

/** Stable hue (0–359) for a string, used for avatar tints. */
export function hueFor(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}
