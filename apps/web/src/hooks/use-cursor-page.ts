import { useEffect, useRef, useState } from "react";
import type { DataState } from "./use-data";

/** Cursor navigation replaces the current page; stale requests cannot change the new filter. */
export function useCursorPage<T extends { next?: string }>(identity: string, load: (next: string | undefined, signal: AbortSignal) => Promise<T>) {
  const [navigation, setNavigation] = useState<{ identity: string; cursors: (string | undefined)[]; index: number }>({ identity, cursors: [undefined], index: 0 });
  const current = navigation.identity === identity ? navigation : { identity, cursors: [undefined], index: 0 };
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([identity, current.index, current.cursors[current.index], attempt]);
  useEffect(() => {
    setNavigation((old) => old.identity === identity ? old : { identity, cursors: [undefined], index: 0 });
  }, [identity]);
  const loader = useRef(load); loader.current = load;
  const [result, setResult] = useState<{ key: string; state: DataState<T> }>({ key, state: { status: "loading" } });
  useEffect(() => {
    const controller = new AbortController();
    setResult({ key, state: { status: "loading" } });
    loader.current(current.cursors[current.index], controller.signal).then(
      (data) => { if (!controller.signal.aborted) setResult({ key, state: { status: "ready", data } }); },
      (error: Error) => { if (!controller.signal.aborted) setResult({ key, state: { status: "error", error } }); },
    );
    return () => controller.abort();
  }, [key]);
  const state: DataState<T> = result.key === key ? result.state : { status: "loading" };
  return {
    state,
    page: current.index + 1,
    previous: current.index > 0,
    next: state.status === "ready" && Boolean(state.data.next),
    back: () => { if (current.index > 0) setNavigation({ ...current, index: current.index - 1 }); },
    forward: () => { if (state.status === "ready" && state.data.next) setNavigation({ identity, cursors: [...current.cursors.slice(0, current.index + 1), state.data.next], index: current.index + 1 }); },
    retry: () => setAttempt((n) => n + 1),
  };
}
