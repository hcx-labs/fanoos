import { createContext, useContext, useEffect, type RefObject } from "react";
import type { Channel } from "@/lib/types";

// Share the glow element, not palette state: changing artwork doesn't re-render the shell.
export const ArtworkGlowContext = createContext<RefObject<HTMLDivElement | null> | null>(null);
type Palette = readonly [string, string];
const palettes = new Map<string, Promise<Palette | null>>();

function sampleArtwork(url: string): Promise<Palette | null> {
  const cached = palettes.get(url);
  if (cached) return cached;
  const result = new Promise<Palette | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 32;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        // Favor artwork color over gray backgrounds, but require enough pixels that a tiny
        // bright logo cannot determine the whole palette. Sampling happens once per image.
        const buckets = new Map<number, { rgb: number[]; weight: number; count: number }>();
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
          const high = Math.max(r, g, b), low = Math.min(r, g, b);
          if (pixels[i + 3]! < 128 || high < 24 || low > 240) continue;
          const saturation = (high - low) / Math.max(high, 1);
          const weight = 0.25 + 3 * saturation * saturation;
          const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
          const bucket = buckets.get(key) ?? { rgb: [0, 0, 0], weight: 0, count: 0 };
          bucket.weight += weight;
          bucket.count++;
          bucket.rgb[0]! += r * weight;
          bucket.rgb[1]! += g * weight;
          bucket.rgb[2]! += b * weight;
          buckets.set(key, bucket);
        }
        const all = [...buckets.values()];
        const broadColors = all.filter((bucket) => bucket.count >= canvas.width * canvas.height * 0.01);
        const colors = (broadColors.length ? broadColors : all).sort((a, b) => b.weight - a.weight)
          .map(({ rgb, weight }) => rgb.map((value) => Math.round(value / weight)));
        if (!colors.length) return resolve(null);
        const first = colors[0]!;
        const second = colors.find((rgb) => rgb.reduce((sum, value, i) => sum + (value - first[i]!) ** 2, 0) > 3600) ?? first;
        const css = (rgb: number[]) => `rgb(${rgb.join(" ")})`;
        resolve([css(first), css(second)]);
      } catch {
        // Cross-origin artwork without CORS can display but cannot be sampled.
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
  if (palettes.size >= 64) palettes.delete(palettes.keys().next().value!);
  palettes.set(url, result);
  void result.then((palette) => {
    // A temporary image/CORS failure must not suppress retries on later visits.
    if (!palette && palettes.get(url) === result) palettes.delete(url);
  });
  return result;
}

export function resetArtworkGlow(element: HTMLDivElement | null) {
  element?.style.removeProperty("--page-glow-primary");
  element?.style.removeProperty("--page-glow-secondary");
  element?.style.removeProperty("--page-glow-strength");
}

/** Channels prefer their banner; shows prefer their poster. Try the next image on failure. */
export function useArtworkGlow(channel: Channel | undefined, loading = false) {
  const target = useContext(ArtworkGlowContext);
  const banner = channel?.banner;
  const avatar = channel?.avatar;
  const poster = channel?.poster;
  const series = channel?.kind === "series";
  useEffect(() => {
    const element = target?.current;
    if (!element) return;
    let cancelled = false;
    // Keep the previous palette while the next channel's data/artwork is loading.
    if (loading && !channel) return;
    void (async () => {
      const sources = series ? [poster, banner, avatar] : [banner, avatar, poster];
      for (const url of new Set(sources.filter((url): url is string => Boolean(url)))) {
        const palette = await sampleArtwork(url);
        if (cancelled) return;
        if (!palette) continue;
        element.style.setProperty("--page-glow-primary", palette[0]);
        element.style.setProperty("--page-glow-secondary", palette[1]);
        element.style.setProperty("--page-glow-strength", "2.3");
        return;
      }
      if (!cancelled) resetArtworkGlow(element);
    })();
    return () => {
      cancelled = true;
    };
  }, [target, banner, avatar, poster, series, loading, Boolean(channel)]);
}
