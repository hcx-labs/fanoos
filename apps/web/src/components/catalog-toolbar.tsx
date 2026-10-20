import type { MouseEvent, ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

export const catalogGrid = "grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6";

export function CatalogToolbar({ children, query, onQuery, label }: { children: ReactNode; query: string; onQuery: (value: string) => void; label: string }) {
  return <div className="mt-8 flex flex-wrap items-center justify-between gap-4"><div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div><InputGroup className="h-9 w-full rounded-full sm:w-64 sm:shrink-0"><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput value={query} onChange={(e) => onQuery(e.target.value)} placeholder={`Filter ${label}`} aria-label={`Filter ${label}`} /></InputGroup></div>;
}

export function CatalogPagination({ page, previous, next, back, forward, loading, label }: { page: number; previous: boolean; next: boolean; back: () => void; forward: () => void; loading: boolean; label: string }) {
  const navigate = (event: MouseEvent<HTMLButtonElement>, action: () => void) => {
    const section = event.currentTarget.closest("section");
    if (section && section.getBoundingClientRect().top < 64) window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top - 64, behavior: "instant" });
    action();
  };
  return <nav aria-label={`${label} pagination`} className="bg-background text-foreground flex h-9 shrink-0 items-center gap-1 rounded-full border px-1 shadow-lg shadow-black/15"><Button variant="ghost" size="icon-sm" className="rounded-full" disabled={!previous || loading} onClick={(event) => navigate(event, back)} aria-label={`Previous ${label} page`}><ChevronLeft /></Button><span className="min-w-14 px-1 text-center text-xs font-medium tabular-nums" aria-live="polite">Page {page}</span><Button variant="ghost" size="icon-sm" className="rounded-full" disabled={!next || loading} onClick={(event) => navigate(event, forward)} aria-label={`Next ${label} page`}><ChevronRight /></Button></nav>;
}
