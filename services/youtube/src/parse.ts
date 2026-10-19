/** Helpers for the loosely-typed text YouTube returns ("1.2M views", "3 days ago", "12:34"). */

export const text = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "text" in value && typeof (value as { text: unknown }).text === "string") return (value as { text: string }).text;
  const s = String((value as { toString(): string }).toString());
  return s === "[object Object]" ? "" : s;
};

/** "1.25M subscribers" → 1250000, "10,932,361 views" → 10932361, "13M" → 13000000. */
export function count(value: unknown): number {
  const s = text(value).replace(/,/g, "").trim();
  const m = /([\d.]+)\s*([KMB])?/i.exec(s);
  if (!m) return 0;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(Number(m[1]) * mult);
}

/** Whether YouTube's text is a rounded figure ("1.2M views", "13K"). */
export const isRounded = (value: unknown) => /\d\s*[KMB]\b/i.test(text(value));

/** "1:02:03" → 3723. */
export function clock(value: unknown): number {
  const parts = text(value).trim().split(":").map(Number);
  if (!parts.length || parts.some(Number.isNaN)) return 0;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

const unitMs: Record<string, number> = {
  s: 1e3, sec: 1e3, second: 1e3, m: 6e4, min: 6e4, minute: 6e4, h: 36e5, hour: 36e5,
  d: 864e5, day: 864e5, w: 6048e5, week: 6048e5, mo: 2592e6, month: 2592e6, y: 31536e6, year: 31536e6,
};

/** "3 days ago" / "9y ago" / "Streamed 2 hours ago" → approximate ISO timestamp, or "" if unknown. */
export function ago(value: unknown, now = Date.now()): string {
  const m = /(\d+)\s*(seconds?|sec|minutes?|min|hours?|h|days?|d|weeks?|w|months?|mo|years?|y)\b/i.exec(text(value));
  if (!m) return "";
  const unit = m[2]!.toLowerCase().replace(/s$/, "");
  return new Date(now - Number(m[1]) * (unitMs[unit] ?? 0)).toISOString();
}

/** Chapters from description timestamps ("0:00 Intro"); needs to start at 0:00 to count. */
export function chaptersFrom(description: string) {
  const out: { start: number; title: string }[] = [];
  for (const line of description.split("\n")) {
    const m = /^\s*[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*[-–—:|]?\s*(.+)$/.exec(line);
    if (m) out.push({ start: clock(m[1]), title: m[2]!.trim() });
  }
  return out.length >= 2 && out[0]!.start === 0 ? out : [];
}

type ThumbnailCandidate = { url?: string; width?: number; height?: number };

/** Prefer a full-size 16:9 URL YouTube actually supplied, including its query parameters. */
export function thumb(videoId: string, thumbnails: readonly ThumbnailCandidate[] = []): string {
  const candidates = Array.isArray(thumbnails) ? thumbnails : [];
  const fullSize = candidates.filter((image) => {
    if (!image.url || !image.width || !image.height || image.width < 1280 || image.height < 720) return false;
    const ratio = image.width / image.height;
    if (ratio < 1.7 || ratio > 1.85) return false;
    try {
      const url = new URL(image.url.startsWith("//") ? `https:${image.url}` : image.url);
      return url.protocol === "https:" && /^i\d?\.ytimg\.com$/.test(url.hostname);
    } catch {
      return false;
    }
  }).sort((a, b) => b.width! * b.height! - a.width! * a.height!);
  // Not every upload has hq720. The proxy tries other sizes if maxres is unavailable.
  return fullSize[0]?.url ?? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
}
