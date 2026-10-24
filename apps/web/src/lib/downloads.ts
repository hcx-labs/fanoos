import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { DownloadLibrary, DownloadPlan, OfflineDownload, Subtitle, Video } from "@tube/shared";
import { formatDuration } from "./format";

export const downloadBridge = () => window.fanoosDesktop?.downloads;
/** Whether this desktop build saves videos from this backend (older builds: YouTube only). */
export const canDownload = (video: Pick<Video, "backend" | "live" | "upcoming">) => {
  const bridge = downloadBridge();
  return Boolean(bridge && !video.live && !video.upcoming && (bridge.backends ?? ["youtube"]).includes(video.backend ?? "youtube"));
};
/** Server conversions this build can save, if the plan offers any; otherwise whole files or tracks. */
export const conversionsOf = (plan: DownloadPlan) => downloadBridge()?.formats?.includes("segments") ? plan.conversions ?? [] : [];
/** YouTube keeps the original locale/label key; other services add the track id, since labels can repeat. */
export const captionId = (subtitle: Pick<Subtitle, "locale" | "label" | "id">, backend = "youtube") =>
  backend === "youtube" || !subtitle.id ? `${subtitle.locale}\n${subtitle.label}` : `${subtitle.locale}\n${subtitle.label}\n${subtitle.id}`;
export const fileSize = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1024 ** 2).toFixed(1)} MB`;
export const transferRate = (bytesPerSecond: number) => `${fileSize(bytesPerSecond)}/s`;
/** "About 3 min left", from the current rate; nothing until there's a rate to go by. */
export function timeLeft(item: Pick<OfflineDownload, "received" | "total" | "speed">) {
  if (!item.speed || item.speed < 1024 || item.total <= item.received) return "";
  const seconds = (item.total - item.received) / item.speed;
  return seconds < 60 ? "Less than a minute left" : seconds < 3600 ? `About ${Math.round(seconds / 60)} min left` : `About ${formatDuration(seconds).replace(/:\d\d$/, "")} h left`;
}
export const isPending = (item: OfflineDownload) => item.status === "queued" || item.status === "downloading";
const backendOf = (item: { backend?: string; video: Video }) => item.backend ?? item.video.backend ?? "youtube";

export function useDownloads() {
  const [library, setLibrary] = useState<DownloadLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const bridge = downloadBridge();
    if (!bridge) return;
    try { setLibrary(await bridge.list()); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => {
    void reload();
    return downloadBridge()?.subscribe(() => void reload());
  }, [reload]);
  return { library, error, reload };
}

/** This video's download, if it's saved or in the queue for the active profile. */
export function useDownloadOf(video: Pick<Video, "id" | "backend">) {
  const { library, reload } = useDownloads();
  const item = library?.items.find((i) => i.videoId === video.id && backendOf(i) === (video.backend ?? "youtube"));
  return { item, library, reload };
}

/** Where a saved download plays: the bundled offline shell or the server's own app. */
export const downloadPath = (id: string) => window.fanoosDesktop?.offline ? `/watch/${id}` : `/downloads/${id}`;

/** A toast when a download finishes (the desktop app shows a system notification when unfocused). */
export function useDownloadNotices() {
  const navigate = useNavigate();
  useEffect(() => downloadBridge()?.onCompleted?.(({ id, title }) => {
    toast.success("Download complete", { description: title, action: { label: "Watch", onClick: () => navigate(downloadPath(id)) } });
  }), [navigate]);
}

/** Channels and shows by name; movies (one "channel" each on media servers) share one group. */
export function downloadGroups(items: OfflineDownload[]) {
  const groups = new Map<string, { key: string; name: string; kind: "channel" | "show" | "movies"; items: OfflineDownload[] }>();
  for (const item of items) {
    const episode = item.video.episode;
    const movie = item.video.kind === "movie";
    const backend = backendOf(item);
    const key = `${backend}/${episode ? `show/${episode.seriesId}` : movie ? "movies" : `channel/${item.video.channelId}`}`;
    let group = groups.get(key);
    if (!group) { group = { key, name: episode?.seriesTitle || (movie ? "Movies" : item.video.channelName), kind: episode ? "show" : movie ? "movies" : "channel", items: [] }; groups.set(key, group); }
    group.items.push(item);
  }
  for (const group of groups.values()) group.items.sort(group.kind === "show" ? episodeOrder : (a, b) => (b.downloadedAt ?? b.createdAt) - (a.downloadedAt ?? a.createdAt));
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const episodeNumber = (item: OfflineDownload) => Number.parseFloat(item.video.episode?.number ?? "") || 0;
function episodeOrder(a: OfflineDownload, b: OfflineDownload) {
  return (a.video.episode?.season ?? 0) - (b.video.episode?.season ?? 0) || episodeNumber(a) - episodeNumber(b) || a.video.title.localeCompare(b.video.title);
}

/** The next saved episode of the same show, for "Up next" while offline. */
export function nextDownload(items: OfflineDownload[], current: OfflineDownload | undefined) {
  if (!current?.video.episode) return undefined;
  const show = items.filter((i) => i.status === "complete" && i.video.episode?.seriesId === current.video.episode?.seriesId && backendOf(i) === backendOf(current)).sort(episodeOrder);
  const index = show.findIndex((i) => i.id === current.id);
  return index >= 0 ? show[index + 1] : undefined;
}

export function searchDownloads(items: OfflineDownload[], query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const text = [item.video.title, item.video.altTitle, item.video.channelName, item.video.description, item.video.episode?.seriesTitle, item.video.episode?.seasonTitle].filter(Boolean).join(" ").toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
