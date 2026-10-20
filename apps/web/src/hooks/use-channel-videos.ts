import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelPage, Video } from "@/lib/types";
import type { ItemRef } from "@/lib/paths";
import { itemKey } from "@/lib/paths";
import { useSource } from "@/lib/source";
import type { DataState } from "./use-data";

/** Append a batch without duplicating uploads that moved between pages while browsing. */
export function appendVideos(current: Video[], incoming: Video[]): Video[] {
  const seen = new Set(current.map(itemKey));
  return [...current, ...incoming.filter((video) => {
    const key = itemKey(video);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })];
}

export function useChannelVideos(ref: ItemRef, section?: string, query = "", sort: "new" | "popular" = "new") {
  const source = useSource();
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([source.key, ref.backend, ref.id, section, query, sort, attempt]);
  const [result, setResult] = useState<{ key: string; state: DataState<ChannelPage> }>({ key, state: { status: "loading" } });
  const [more, setMore] = useState<{ key: string; loading: boolean; error?: Error }>({ key, loading: false });
  const request = useRef<{ key: string; controller: AbortController; busy: boolean } | null>(null);

  useEffect(() => {
    const current = { key, controller: new AbortController(), busy: true };
    request.current = current;
    setResult({ key, state: { status: "loading" } });
    setMore({ key, loading: false });
    source.channel(ref, section, { signal: current.controller.signal, query, sort }).then(
      (data) => {
        if (!current.controller.signal.aborted) setResult({ key, state: { status: "ready", data } });
      },
      (error: Error) => {
        if (!current.controller.signal.aborted) setResult({ key, state: { status: "error", error } });
      },
    ).finally(() => { current.busy = false; });
    return () => current.controller.abort();
    // ref is an inline object; key includes every request input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const state: DataState<ChannelPage> = result.key === key ? result.state : { status: "loading" };
  const loadMore = useCallback(async () => {
    const current = request.current;
    if (!current || current.key !== key || current.busy || current.controller.signal.aborted || state.status !== "ready" || !state.data.next) return;
    current.busy = true;
    setMore({ key, loading: true });
    try {
      const data = await source.channel(ref, section, { next: state.data.next, signal: current.controller.signal, query, sort });
      if (current.controller.signal.aborted) return;
      setResult({ key, state: { status: "ready", data: { ...state.data, channels: state.data.channels ? [...state.data.channels, ...(data.channels ?? []).filter((channel) => !state.data.channels!.some((old) => itemKey(old) === itemKey(channel)))] : undefined, videos: appendVideos(state.data.videos, data.videos), next: data.next } } });
      setMore({ key, loading: false });
    } catch (error) {
      if (!current.controller.signal.aborted) setMore({ key, loading: false, error: error instanceof Error ? error : new Error(String(error)) });
    } finally {
      current.busy = false;
    }
  }, [key, state, source, ref.backend, ref.id, section, query, sort]);

  return {
    identity: JSON.stringify([source.key, ref.backend, ref.id]),
    state,
    loadMore,
    loadingMore: more.key === key && more.loading,
    moreError: more.key === key ? more.error : undefined,
    reload: () => {
      request.current?.controller.abort();
      setAttempt((value) => value + 1);
    },
  };
}
