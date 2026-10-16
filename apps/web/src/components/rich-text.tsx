import { Fragment, type ReactNode } from "react";
import { formatDuration } from "@/lib/format";

/** Query parameters that only exist to track clicks. */
const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_eid|mc_cid|igshid|si|ref|ref_src|_hsenc|_hsmi|yclid)$/i;

/** Remove tracking parameters from a link. */
export function cleanUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return raw;
  }
}

/** "nexigo.com/products/nexigo-nova-mini…" */
function display(url: string) {
  try {
    const u = new URL(url);
    const text = `${u.host.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}${u.search}`;
    return text.length > 48 ? `${text.slice(0, 46)}…` : text;
  } catch {
    return url;
  }
}

// Timestamps followed by a.m./p.m. are clock times, not positions in the video.
const TOKEN = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b(?!\s*[ap]\.?m\b))/gi;

/**
 * Plain text with clickable links (tracking parameters removed, opened without a
 * referrer) and, when onSeek is given, clickable timestamps.
 */
export function RichText({ text, onSeek, maxSeconds }: { text: string; onSeek?: (seconds: number) => void; maxSeconds?: number }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const [token, url, time] = match;
    if (url) {
      const href = cleanUrl(url);
      out.push(
        <a key={index} href={href} target="_blank" rel="noreferrer noopener nofollow" title={href} className="text-brand-strong break-all hover:underline">
          {display(href)}
        </a>,
      );
    } else if (time && onSeek && (!maxSeconds || time.split(":").reduce((total, n) => total * 60 + Number(n), 0) <= maxSeconds)) {
      const seconds = time.split(":").reduce((total, n) => total * 60 + Number(n), 0);
      out.push(
        <button key={index} type="button" onClick={() => onSeek(seconds)} className="text-brand-strong font-medium tabular-nums hover:underline" aria-label={`Jump to ${formatDuration(seconds)}`}>
          {time}
        </button>,
      );
    } else {
      out.push(token);
    }
    last = index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <Fragment>{out}</Fragment>;
}
