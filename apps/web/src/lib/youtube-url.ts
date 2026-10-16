/**
 * Recognises YouTube links pasted into search, so they open in the app directly.
 *
 *   video:   youtube.com/watch?v=ID, youtu.be/ID, /shorts/ID, /live/ID, /embed/ID, /v/ID
 *            (www., m., music., youtube-nocookie.com; &t=90, ?t=1m30s, #t=…)
 *   channel: /channel/UC… (direct), /@handle, /c/name, /user/name (resolved by the server)
 */
export type YouTubeLink =
  | { kind: "video"; id: string; start?: number }
  | { kind: "channel"; id: string }
  | { kind: "handle"; url: string; label: string };

const VIDEO_ID = /^[\w-]{11}$/;

/** "1h2m3s", "90", "1:30" → seconds. */
function parseTime(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (/^\d+(:\d{1,2}){1,2}$/.test(raw)) return raw.split(":").reduce((t, n) => t * 60 + Number(n), 0);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw);
  if (!m || !m[0]) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) || undefined;
}

export function parseYouTubeLink(text: string): YouTubeLink | null {
  const raw = text.trim();
  if (!/youtu\.?be|youtube/i.test(raw) || /\s/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const start = parseTime(url.searchParams.get("t") ?? url.searchParams.get("start") ?? new URLSearchParams(url.hash.slice(1)).get("t"));

  if (host === "youtu.be") {
    const id = parts[0] ?? "";
    return VIDEO_ID.test(id) ? { kind: "video", id, start } : null;
  }
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;

  const v = url.searchParams.get("v");
  if (parts[0] === "watch" && v && VIDEO_ID.test(v)) return { kind: "video", id: v, start };
  if (["shorts", "live", "embed", "v", "e"].includes(parts[0] ?? "") && VIDEO_ID.test(parts[1] ?? "")) {
    return { kind: "video", id: parts[1]!, start };
  }
  if (parts[0] === "channel" && /^UC[\w-]{22}$/.test(parts[1] ?? "")) return { kind: "channel", id: parts[1]! };
  if (parts[0]?.startsWith("@")) return { kind: "handle", url: `https://www.youtube.com/${parts[0]}`, label: parts[0] };
  if ((parts[0] === "c" || parts[0] === "user") && parts[1]) {
    return { kind: "handle", url: `https://www.youtube.com/${parts[0]}/${parts[1]}`, label: parts[1] };
  }
  return null;
}
