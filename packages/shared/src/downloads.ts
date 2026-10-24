import type { Channel, Subtitle, Video, VideoDetail } from "./index.ts";

/** A downloadable, unencrypted on-demand track. URLs are freshly resolved for each attempt. */
export type DownloadTrack = {
  id: string;
  kind: "video" | "audio";
  mimeType: string;
  codecs: string;
  bandwidth: number;
  bytes?: number;
  revision?: string;
  width?: number;
  height?: number;
  fps?: number;
  language?: string;
  label: string;
  default?: boolean;
  sampleRate?: number;
  channels?: number;
  initRange: string;
  indexRange: string;
  url: string;
};
/** A whole media file saved as-is and played progressively (a media server's original). */
export type DownloadFile = {
  id: string;
  label: string;
  /** Container type for playback, e.g. "video/mp4" or "video/x-matroska". */
  mimeType: string;
  container: string;
  videoCodec?: string;
  audioCodec?: string;
  /** The file's default audio track, the one progressive playback uses. */
  audio?: string;
  height?: number;
  bytes: number;
  url: string;
};
/**
 * A conversion the media server makes while the desktop app saves it segment by segment (DASH):
 * one audio track (converted to AAC) at one quality, where "copy" keeps the original video.
 */
export type DownloadConversion = {
  /** "<audio id>:<quality id>", stable across plans so a resumed download finds it again. */
  id: string;
  audio: { id: string; label: string; locale: string; default?: boolean };
  /** `codec`: the saved video's codec ("h264", "hevc"), so a device that can't decode it skips this one. */
  quality: { id: string; label: string; height?: number; copy?: boolean; codec?: string };
  /** Estimated bits per second, video and audio together. */
  bitrate: number;
  /** DASH manifest of a fresh server session, and where to end that session. */
  manifest: string;
  release?: string;
};
/** Separate video and audio tracks (DASH), whole files, or server conversions. */
export type DownloadPlan = { duration: number; tracks: DownloadTrack[]; files?: DownloadFile[]; conversions?: DownloadConversion[]; subtitles: Subtitle[] };
export type DownloadSelection = { backend?: string; videoId: string; videoTrack?: string; audioTrack?: string; file?: string; conversion?: string; subtitles: string[] };
export type DownloadStatus = "queued" | "downloading" | "paused" | "failed" | "complete";
export type OfflineDownload = {
  id: string;
  /** Older desktop builds omit it: those downloads are YouTube ones. */
  backend?: string;
  videoId: string;
  video: Video;
  channel: Channel;
  status: DownloadStatus;
  quality: string;
  audio: string;
  received: number;
  total: number;
  createdAt: number;
  downloadedAt?: number;
  /** Transfer rate while downloading, in bytes per second. */
  speed?: number;
  /** Queued again after a dropped connection: when the next attempt starts (ms epoch). */
  retryAt?: number;
  /** Paused by quitting or signing out; continues once this profile connects again. */
  resumeOnConnect?: boolean;
  error?: string;
  warning?: string;
};
export type DownloadLibrary = {
  items: OfflineDownload[];
  usedBytes: number;
  freeBytes: number;
  totalDiskBytes: number;
  profileName: string;
  server: string;
};

export type OfflineVideoDetail = VideoDetail & { downloadedAt: number; quality: string };
