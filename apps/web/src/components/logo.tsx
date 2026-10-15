import { useId } from "react";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * A lantern (fanoos) whose flame is a play button. No background: the frame takes
 * the text colour (dark on light, light on dark) and the flame is always amber.
 * Keep public/favicon.svg in sync.
 */
export function LogoMark({ className }: { className?: string }) {
  // useId() contains characters like ":" or "«»" that make url(#…) references fragile.
  const glow = `glow${useId().replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg viewBox="8.5 3.5 15 24" aria-hidden className={cn("text-foreground h-7 w-auto", className)}>
      <defs>
        <radialGradient id={glow} cx="50%" cy="55%" r="60%">
          <stop offset="0" className="[stop-color:var(--brand)]" stopOpacity=".6" />
          <stop offset="1" className="[stop-color:var(--brand)]" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="6.2" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.8 10.6 13.2 8.2h5.6l2.4 2.4z" fill="currentColor" />
      <rect x="10.2" y="11.3" width="11.6" height="12.4" rx="2.8" fill={`url(#${glow})`} stroke="currentColor" strokeWidth="1.5" />
      <path d="M14.3 14.6v6.2l5.2-3.1z" className="fill-brand" />
      <rect x="11.2" y="24.6" width="9.6" height="2.3" rx="1.15" fill="currentColor" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="font-display text-lg font-semibold lowercase">{brand.name}</span>
    </span>
  );
}
