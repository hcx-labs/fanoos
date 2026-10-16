/*
 * Community data: SponsorBlock segments, Return YouTube Dislike estimates and
 * DeArrow titles. SponsorBlock and DeArrow are queried by a 4-character hash
 * prefix, so those services never learn which video is being watched.
 */
import type { Segment, SegmentCategory } from "@tube/shared";
import { SharedCache } from "../cache.ts";
import { sha256 } from "../crypto.ts";

const categories: SegmentCategory[] = ["sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "filler", "music_offtopic"];

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3500), headers: { "user-agent": "tube-client" } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const segmentsCache = new SharedCache<Segment[]>("sponsorblock");
export const segments = (id: string) =>
  segmentsCache.get(id, async () => {
    const url = `https://sponsor.ajay.app/api/skipSegments/${sha256(id).slice(0, 4)}?categories=${encodeURIComponent(JSON.stringify(categories))}`;
    const all = await getJson<{ videoID: string; segments: { segment: [number, number]; category: SegmentCategory }[] }[]>(url);
    return (all?.find((v) => v.videoID === id)?.segments ?? []).map((s) => ({ start: s.segment[0], end: s.segment[1], category: s.category }));
  });

const votesCache = new SharedCache<{ likes: number; dislikes: number } | null>("ryd");
export const votes = (id: string) =>
  votesCache.get(id, () => getJson<{ likes: number; dislikes: number }>(`https://returnyoutubedislikeapi.com/votes?videoId=${encodeURIComponent(id)}`));

const titleCache = new SharedCache<Record<string, string>>("dearrow");
/** Community titles for all videos sharing this id's hash prefix (so one call serves many). */
async function titlesFor(prefix: string) {
  return titleCache.get(prefix, async () => {
    const data = await getJson<Record<string, { titles: { title: string; original: boolean; votes: number; locked: boolean }[] }>>(
      `https://sponsor.ajay.app/api/branding/${prefix}`,
    );
    const map: Record<string, string> = {};
    for (const [videoId, branding] of Object.entries(data ?? {})) {
      const best = branding.titles.find((t) => !t.original && (t.locked || t.votes >= 0));
      // DeArrow marks auto-formatted words with ">"; strip the markers.
      if (best) map[videoId] = best.title.replace(/(^|\s)>(\S)/g, "$1$2");
    }
    return map;
  });
}

export async function communityTitle(id: string) {
  return (await titlesFor(sha256(id).slice(0, 4)))[id];
}
