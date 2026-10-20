import { useCallback, useEffect, useState } from "react";
import type { DownloadLibrary } from "@tube/shared";

export const downloadBridge = () => window.fanoosDesktop?.downloads;
export const captionId = (subtitle: { locale: string; label: string }) => `${subtitle.locale}\n${subtitle.label}`;
export const fileSize = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1024 ** 2).toFixed(1)} MB`;

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

export function downloadGroups(items: import("@tube/shared").OfflineDownload[]) {
  const groups = new Map<string, { key: string; name: string; items: typeof items }>();
  for (const item of items) {
    const episode = item.video.episode;
    const key = `${item.video.backend}/${episode ? `show/${episode.seriesId}` : `channel/${item.video.channelId}`}`;
    let group = groups.get(key);
    if (!group) { group = { key, name: episode?.seriesTitle || item.video.channelName, items: [] }; groups.set(key, group); }
    group.items.push(item);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function searchDownloads(items: import("@tube/shared").OfflineDownload[], query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const text = [item.video.title, item.video.altTitle, item.video.channelName, item.video.description, item.video.episode?.seriesTitle].filter(Boolean).join(" ").toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
