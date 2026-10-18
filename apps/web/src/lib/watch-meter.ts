/*
 * Measures what was actually watched, for Analytics: playback time as it passes (not seeks, not time
 * paused), how much of the video that covered (more when sped up), and segments skipped
 * automatically. Reported to core about every 30 seconds of watching and whenever playback stops.
 * Nothing is recorded while "Keep watch history" is off.
 */
import type { Video, WatchBeat } from "@tube/shared";
import { itemKey } from "./paths";
import { getLocalState } from "./store";

const BEAT_SECONDS = 30;
const tz = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

export type WatchMeter = ReturnType<typeof createWatchMeter>;

export function createWatchMeter(video: Video) {
  let seconds = 0;
  let media = 0;
  let skipped = 0;
  let last: number | null = null;
  let finished = false;
  // Counted as finished once per visit, at the end or close to it (end cards, credits).
  let marked = false;

  const send = (beat: WatchBeat, closing: boolean) =>
    fetch("/api/me/watch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(beat),
      credentials: "same-origin",
      keepalive: closing,
    }).catch(() => {});

  function flush(closing = false) {
    if (seconds < 1 && skipped < 1 && !finished) return;
    const beat: WatchBeat = {
      key: itemKey(video),
      title: video.title,
      kind: video.episode ? "episode" : "video",
      channelId: video.channelId,
      channelName: video.episode?.seriesTitle || video.channelName,
      category: video.category,
      thumbnail: video.thumbnail,
      duration: video.duration,
      seconds,
      media,
      skipped,
      finished,
      tz,
    };
    seconds = media = skipped = 0;
    finished = false;
    if (getLocalState().settings.keepHistory) void send(beat, closing);
  }

  return {
    /** On every time update while playing. Jumps (seeks) aren't counted. */
    tick(time: number, rate: number, duration: number) {
      if (last !== null) {
        const step = time - last;
        if (step > 0 && step < 2.5 * Math.max(rate, 1)) {
          media += step;
          seconds += step / (rate || 1);
        }
      }
      last = time;
      if (!marked && duration > 0 && time >= duration - Math.min(30, duration * 0.05)) finished = marked = true;
      if (seconds >= BEAT_SECONDS) flush();
    },
    /** A seek or pause: the next tick starts counting afresh. */
    jump(time: number | null = null) {
      last = time;
    },
    skipped(from: number, to: number) {
      if (to > from) skipped += to - from;
      last = to;
    },
    pause() {
      last = null;
      flush();
    },
    finish() {
      last = null;
      if (!marked) finished = marked = true;
      flush();
    },
    /** Leaving the page: send what's left even as the page unloads. */
    close() {
      last = null;
      flush(true);
    },
  };
}
