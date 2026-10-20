/** Keep a useful resume point, without treating an entire short clip as end credits. */
export function resumePosition(seconds: number, duration: number): number | undefined {
  if (!Number.isFinite(seconds) || seconds < 10) return undefined;
  const tail = duration > 0 ? Math.min(20, duration * 0.05) : 0;
  return duration > 0 && seconds > duration - tail ? undefined : Math.floor(seconds);
}

/** Null marks a completed/forgotten download whose old server position must be removed. */
export function mergeOfflineProgress(server: Record<string, number>, pending: Record<string, number | null>): Record<string, number> {
  const merged = { ...server };
  for (const [key, value] of Object.entries(pending)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}
