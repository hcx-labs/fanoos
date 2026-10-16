import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The top of every page: an optional line above the title, the title, one line or two of
 * description at a fixed size and measure, and actions on the right. Pages use this instead of
 * their own headings so titles and subtext line up the same everywhere.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Small icon before the description (e.g. a lock for privacy notes). */
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end gap-x-6 gap-y-4", className)}>
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="text-muted-foreground mb-1 text-sm">{eyebrow}</p>}
        <h1 className="font-display text-3xl font-semibold text-balance sm:text-4xl">{title}</h1>
        {description && (
          <div className="text-muted-foreground mt-2 max-w-3xl text-sm text-pretty sm:text-base">
            {Icon && <Icon className="text-brand mr-1.5 -mt-0.5 inline size-4" />}
            {description}
          </div>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export type PillOption = { value: string; label: ReactNode; color?: string; count?: number };

/** A row of choices, one selected (services, scopes). Same look on every page. */
export function ServicePills({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: PillOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value || "all"}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "text-muted-foreground hover:text-foreground flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
            value === o.value && "border-foreground text-foreground bg-card",
          )}
        >
          {o.color && <span className="size-2 rounded-full" style={{ background: o.color }} />}
          {o.label}
          {o.count !== undefined && <span className="text-muted-foreground text-[11px] tabular-nums">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
