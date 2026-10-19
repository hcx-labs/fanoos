/** Keep the saved preference, but resolve it against this video's available heights. */
export function effectiveQuality(preference: string, heights: readonly number[]): string {
  if (preference === "auto") return "auto";
  const wanted = Number.parseInt(preference, 10);
  if (!Number.isFinite(wanted)) return "auto";
  const available = heights.filter((height) => Number.isFinite(height) && height > 0).sort((a, b) => b - a);
  const height = available.find((height) => height <= wanted) ?? available.at(-1);
  return height === undefined ? "auto" : `${height}p`;
}
