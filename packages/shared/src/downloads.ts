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
export type DownloadPlan = { duration: number; tracks: DownloadTrack[]; subtitles: Subtitle[] };
export type DownloadSelection = { videoId: string; videoTrack: string; audioTrack: string; subtitles: string[] };
export type DownloadStatus = "queued" | "downloading" | "paused" | "failed" | "complete";
export type OfflineDownload = {
  id: string;
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
  error?: string;
  warning?: string;
};
export type DownloadLibrary = {
  items: OfflineDownload[];
  usedBytes: number;
  freeBytes: number;
  totalDiskBytes: number;
  limitBytes: number;
  profileName: string;
  server: string;
};

export type OfflineVideoDetail = VideoDetail & { downloadedAt: number; quality: string };
