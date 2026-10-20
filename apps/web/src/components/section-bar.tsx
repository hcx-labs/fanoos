import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

/** Floating section label used by Home's date groups and media catalogs. */
export function SectionBar({ title, detail, children, ref, className }: { title: ReactNode; detail?: ReactNode; children?: ReactNode; ref?: Ref<HTMLDivElement>; className?: string }) {
  return <div data-section-bar ref={ref} className={cn("pointer-events-none sticky top-16 z-20 mt-12 flex flex-wrap items-center gap-x-3 gap-y-2 py-3 select-none", className)}><div className="bg-background flex h-9 min-w-0 items-baseline gap-2 rounded-full border px-4 pt-1.5 shadow-lg shadow-black/15"><h2 className="font-display truncate text-base font-semibold">{title}</h2>{detail && <span className="text-muted-foreground truncate text-xs font-medium">{detail}</span>}</div>{children && <div className="pointer-events-auto ml-auto flex flex-wrap gap-1.5">{children}</div>}</div>;
}
