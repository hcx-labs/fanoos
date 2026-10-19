import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { actions } from "@/lib/store";
import {
  defaultSubtitleStyle,
  subtitleBackgrounds,
  subtitleEdges,
  subtitleFonts,
  subtitleSwatches,
  subtitleTextStyle,
  SUBTITLE_SIZES,
  type SubtitleStyle,
} from "@/lib/subtitle-style";
import { cn } from "@/lib/utils";

/** Base caption size, relative to the player's height (the player is a size container). */
const BASE_SIZE = "clamp(13px, 4.6cqh, 52px)";

/**
 * Draws the active cues of a (hidden) WebVTT track over the video in the viewer's style.
 * Cue markup comes from the browser's own parser (getCueAsHTML: text, i, b, u, ruby, spans).
 */
export function SubtitleOverlay({ track, style, lifted }: { track: TextTrack | null; style: SubtitleStyle; lifted: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const textStyle = subtitleTextStyle(style);
  const styleKey = JSON.stringify(textStyle);

  useEffect(() => {
    const el = box.current;
    if (!el || !track) return;
    const draw = () => {
      const seen = new Set<string>();
      const lines: HTMLElement[] = [];
      for (const cue of Array.from(track.activeCues ?? [])) {
        if (!(cue instanceof VTTCue)) continue;
        // YouTube's auto-generated captions repeat the previous line in overlapping cues.
        const plain = cue.text.replace(/<[^>]*>/g, "").trim();
        if (!plain || seen.has(plain)) continue;
        seen.add(plain);
        const line = document.createElement("div");
        const text = document.createElement("span");
        Object.assign(text.style, textStyle);
        text.append(cue.getCueAsHTML());
        line.append(text);
        lines.push(line);
      }
      el.replaceChildren(...lines);
    };
    draw();
    track.addEventListener("cuechange", draw);
    return () => {
      track.removeEventListener("cuechange", draw);
      el.replaceChildren();
    };
    // textStyle is rebuilt each render; styleKey says when it actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, styleKey]);

  const edge = `calc(${style.offset}cqh + ${lifted && style.position === "bottom" ? "4.75rem" : "1.25rem"})`;
  return (
    <div
      ref={box}
      aria-live="off"
      className="pointer-events-none absolute inset-x-0 z-[1] mx-auto flex max-w-[90%] flex-col items-center gap-[0.15em] text-center leading-[1.35] whitespace-pre-line transition-[bottom,top] duration-200"
      style={{ fontSize: `calc(${BASE_SIZE} * ${style.size})`, ...(style.position === "top" ? { top: edge } : { bottom: edge }) }}
    />
  );
}

/** The player menu's "Subtitle style" page: live preview and every option. */
export function SubtitleStyleMenu({ style }: { style: SubtitleStyle }) {
  const set = (patch: Partial<SubtitleStyle>) => actions.setting("subtitleStyle", { ...style, ...patch });
  const chip = (active: boolean) =>
    cn("rounded-md px-2 py-1 text-xs font-medium hover:bg-white/10", active && "bg-white text-black hover:bg-white");
  return (
    <div className="space-y-3 px-2 pt-1 pb-2 text-sm">
      {/* Preview on a busy backdrop, like a real frame. */}
      <div
        className="relative grid h-20 place-items-center overflow-hidden rounded-lg"
        style={{ background: "linear-gradient(135deg, #3b82f6, #f59e0b 45%, #f8fafc 55%, #14532d)" }}
      >
        <span className="px-2 text-center leading-[1.35]" style={{ fontSize: `calc(15px * ${Math.min(style.size, 1.6)})` }}>
          <span style={subtitleTextStyle(style) as CSSProperties}>The quick brown fox</span>
        </span>
      </div>

      <Field label="Size" value={`${Math.round(style.size * 100)}%`}>
        <Slider
          aria-label="Subtitle size"
          value={[style.size]}
          min={SUBTITLE_SIZES.min}
          max={SUBTITLE_SIZES.max}
          step={SUBTITLE_SIZES.step}
          onValueChange={([v]) => set({ size: Math.round((v ?? 1) * 10) / 10 })}
          className="[&_[data-slot=slider-range]]:bg-brand [&_[data-slot=slider-track]]:bg-white/20"
        />
      </Field>

      <Field label="Font">
        <div className="flex flex-wrap gap-1">
          {subtitleFonts.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={style.font === f.value}
              className={chip(style.font === f.value)}
              style={{ fontFamily: f.family, fontVariant: f.value === "smallcaps" ? "small-caps" : undefined }}
              onClick={() => set({ font: f.value })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Field>

      <label className="flex items-center justify-between">
        <span className="text-white/70">Bold</span>
        <Switch checked={style.bold} onCheckedChange={(bold) => set({ bold })} />
      </label>

      <Field label="Text color">
        <Swatches value={style.color} onChange={(color) => set({ color })} label="Text color" />
      </Field>

      <Field label="Text opacity" value={`${Math.round(style.opacity * 100)}%`}>
        <Slider
          aria-label="Text opacity"
          value={[style.opacity]}
          min={0.25}
          max={1}
          step={0.05}
          onValueChange={([v]) => set({ opacity: v ?? 1 })}
          className="[&_[data-slot=slider-range]]:bg-brand [&_[data-slot=slider-track]]:bg-white/20"
        />
      </Field>

      <Field label="Edge">
        <div className="flex flex-wrap gap-1">
          {subtitleEdges.map((e) => (
            <button key={e.value} type="button" aria-pressed={style.edge === e.value} className={chip(style.edge === e.value)} onClick={() => set({ edge: e.value })}>
              {e.label}
            </button>
          ))}
        </div>
        {style.edge !== "none" && <Swatches value={style.edgeColor} onChange={(edgeColor) => set({ edgeColor })} label="Edge color" />}
      </Field>

      <Field label="Background">
        <div className="flex flex-wrap gap-1">
          {subtitleBackgrounds.map((b) => (
            <button
              key={b.value}
              type="button"
              aria-pressed={style.background === b.value}
              className={chip(style.background === b.value)}
              onClick={() => set({ background: b.value })}
            >
              {b.label}
            </button>
          ))}
        </div>
        {style.background !== "none" && (
          <Swatches value={style.backgroundColor} onChange={(backgroundColor) => set({ backgroundColor })} label="Background color" />
        )}
      </Field>

      <Field label="Position">
        <div className="flex gap-1">
          {(["bottom", "top"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={style.position === p} className={chip(style.position === p)} onClick={() => set({ position: p })}>
              {p === "bottom" ? "Bottom" : "Top"}
            </button>
          ))}
        </div>
      </Field>

      <Field label={style.position === "bottom" ? "Raise" : "Lower"} value={`${style.offset}%`}>
        <Slider
          aria-label="Distance from the edge"
          value={[style.offset]}
          min={0}
          max={40}
          step={1}
          onValueChange={([v]) => set({ offset: v ?? 0 })}
          className="[&_[data-slot=slider-range]]:bg-brand [&_[data-slot=slider-track]]:bg-white/20"
        />
      </Field>

      <button
        type="button"
        className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs text-white/70 hover:bg-white/10 hover:text-white"
        onClick={() => actions.setting("subtitleStyle", defaultSubtitleStyle)}
      >
        <RotateCcw className="size-3.5" /> Reset to default
      </button>
      <p className="px-1 text-[11px] leading-snug text-white/45">
        Applies to captions such as YouTube's. Styled subtitles (Crunchyroll) keep their own look. Shortcuts: + and − change the size.
      </p>
    </div>
  );
}

function Field({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-white/70">
        <span>{label}</span>
        {value && <span className="text-xs text-white/50 tabular-nums">{value}</span>}
      </div>
      {children}
    </div>
  );
}

function Swatches({ value, onChange, label }: { value: string; onChange: (color: string) => void; label: string }) {
  const custom = !subtitleSwatches.includes(value.toLowerCase());
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={label}>
      {subtitleSwatches.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn("size-6 rounded-full border border-white/25", value.toLowerCase() === c && "ring-brand ring-2 ring-offset-2 ring-offset-neutral-900")}
          style={{ background: c }}
        />
      ))}
      {/* Any other colour. */}
      <label
        className={cn(
          "relative size-6 cursor-pointer overflow-hidden rounded-full border border-white/25 bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]",
          custom && "ring-brand ring-2 ring-offset-2 ring-offset-neutral-900",
        )}
        title="Custom colour"
      >
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`${label}: custom`} />
      </label>
    </div>
  );
}
