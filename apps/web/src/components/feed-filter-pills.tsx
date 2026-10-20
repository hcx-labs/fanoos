import { cn } from "@/lib/utils";

/** The feed's compact, horizontally scrolling filters, beside its view controls. */
export function FeedFilterPills({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string; count?: number }[];
  onChange: (value: string) => void;
}) {
  return <div className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] pr-10" role="group" aria-label={label}>
    {options.map((option) => {
      const selected = value === option.value;
      return <button key={option.value} type="button" aria-pressed={selected} onClick={() => onChange(option.value)} className={cn(
        "bg-secondary text-secondary-foreground hover:bg-accent flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors",
        selected && "bg-foreground text-background hover:bg-foreground",
      )}>
        {option.label}
        {option.count !== undefined && <span className={cn("text-[11px] tabular-nums", selected ? "text-background/70" : "text-muted-foreground")}>{option.count}</span>}
      </button>;
    })}
  </div>;
}
