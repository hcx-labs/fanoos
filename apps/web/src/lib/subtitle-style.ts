/*
 * How caption text looks (WebVTT tracks, drawn by the player's own overlay): font, size,
 * colours, edge, background and placement. Saved with the account's settings. Styled ASS
 * subtitles (Crunchyroll) keep their authored look.
 */
import type { CSSProperties } from "react";

export type SubtitleFont = "sans" | "serif" | "mono" | "rounded" | "casual" | "smallcaps";
export type SubtitleEdge = "none" | "outline" | "shadow" | "raised" | "depressed";
export type SubtitleBackground = "none" | "solid" | "transparent" | "glass" | "glow";

export type SubtitleStyle = {
  /** Multiplier on the player-relative base size. */
  size: number;
  font: SubtitleFont;
  bold: boolean;
  color: string;
  /** Text opacity, 0.25–1. */
  opacity: number;
  edge: SubtitleEdge;
  edgeColor: string;
  background: SubtitleBackground;
  backgroundColor: string;
  position: "bottom" | "top";
  /** Extra distance from the top or bottom edge, in % of the player's height. */
  offset: number;
};

export const defaultSubtitleStyle: SubtitleStyle = {
  size: 1,
  font: "sans",
  bold: false,
  color: "#ffffff",
  opacity: 1,
  edge: "shadow",
  edgeColor: "#000000",
  background: "transparent",
  backgroundColor: "#000000",
  position: "bottom",
  offset: 0,
};

export const subtitleFonts: { value: SubtitleFont; label: string; family: string }[] = [
  { value: "sans", label: "Sans", family: "var(--font-sans)" },
  { value: "serif", label: "Serif", family: 'Georgia, "Times New Roman", serif' },
  { value: "mono", label: "Mono", family: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
  { value: "rounded", label: "Rounded", family: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", var(--font-sans)' },
  { value: "casual", label: "Casual", family: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive' },
  { value: "smallcaps", label: "Small caps", family: "var(--font-sans)" },
];

export const subtitleEdges: { value: SubtitleEdge; label: string }[] = [
  { value: "none", label: "None" },
  { value: "outline", label: "Outline" },
  { value: "shadow", label: "Shadow" },
  { value: "raised", label: "Raised" },
  { value: "depressed", label: "Depressed" },
];

export const subtitleBackgrounds: { value: SubtitleBackground; label: string }[] = [
  { value: "none", label: "None" },
  { value: "solid", label: "Solid" },
  { value: "transparent", label: "Transparent" },
  { value: "glass", label: "Glass" },
  { value: "glow", label: "Glow" },
];

export const subtitleSwatches = ["#ffffff", "#fde047", "#67e8f9", "#86efac", "#f0abfc", "#fca5a5", "#93c5fd", "#000000"];

export const SUBTITLE_SIZES = { min: 0.5, max: 2.5, step: 0.1 };

/** Saved styles merged over the defaults, with out-of-range values pulled back in. */
export function normalizeSubtitleStyle(saved: Partial<SubtitleStyle> | undefined): SubtitleStyle {
  const style = { ...defaultSubtitleStyle, ...saved };
  const clamp = (v: number, lo: number, hi: number, fallback: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  const hex = (v: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
  return {
    ...style,
    size: clamp(style.size, SUBTITLE_SIZES.min, SUBTITLE_SIZES.max, 1),
    opacity: clamp(style.opacity, 0.25, 1, 1),
    offset: clamp(style.offset, 0, 40, 0),
    color: hex(style.color, defaultSubtitleStyle.color),
    edgeColor: hex(style.edgeColor, defaultSubtitleStyle.edgeColor),
    backgroundColor: hex(style.backgroundColor, defaultSubtitleStyle.backgroundColor),
    font: subtitleFonts.some((f) => f.value === style.font) ? style.font : "sans",
    edge: subtitleEdges.some((e) => e.value === style.edge) ? style.edge : "shadow",
    background: subtitleBackgrounds.some((b) => b.value === style.background) ? style.background : "transparent",
    position: style.position === "top" ? "top" : "bottom",
  };
}

const mix = (color: string, percent: number) => `color-mix(in oklab, ${color} ${percent}%, transparent)`;

/**
 * Styles for one cue's text (an inline box, so each wrapped line gets its own background).
 * Sizes are in em of the overlay's font size.
 */
export function subtitleTextStyle(style: SubtitleStyle): CSSProperties {
  const font = subtitleFonts.find((f) => f.value === style.font)!;
  const e = style.edgeColor;
  const shadows: string[] = {
    none: [],
    outline: [],
    shadow: [`0.05em 0.05em 0.1em ${e}`, `0 0 0.12em ${e}`],
    raised: [`0.03em 0.03em 0 ${e}`, `0.06em 0.06em 0 ${e}`],
    depressed: [`-0.04em -0.04em 0 ${e}`, `0.02em 0.02em 0 ${mix("#ffffff", 35)}`],
  }[style.edge];
  const bg = style.backgroundColor;
  if (style.background === "glow") shadows.push(`0 0 0.25em ${bg}`, `0 0 0.6em ${bg}`, `0 0 1em ${mix(bg, 80)}`);
  const box: CSSProperties =
    style.background === "solid"
      ? { background: bg }
      : style.background === "transparent"
        ? { background: mix(bg, 60) }
        : style.background === "glass"
          ? { background: mix(bg, 35), backdropFilter: "blur(10px) saturate(140%)", WebkitBackdropFilter: "blur(10px) saturate(140%)" }
          : {};
  const boxed = style.background === "solid" || style.background === "transparent" || style.background === "glass";
  return {
    fontFamily: font.family,
    fontVariant: style.font === "smallcaps" ? "small-caps" : undefined,
    fontWeight: style.bold ? 700 : 500,
    color: mix(style.color, Math.round(style.opacity * 100)),
    textShadow: shadows.length ? shadows.join(", ") : undefined,
    WebkitTextStroke: style.edge === "outline" ? `0.08em ${e}` : undefined,
    paintOrder: style.edge === "outline" ? "stroke fill" : undefined,
    ...box,
    ...(boxed ? { padding: "0.06em 0.4em", borderRadius: "0.18em", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" } : {}),
    // Glass blurs what's behind it, which needs a box of its own.
    display: style.background === "glass" ? "inline-block" : "inline",
  };
}
