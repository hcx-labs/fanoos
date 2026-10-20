import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Film, Tv } from "lucide-react";
import { ChannelCard } from "@/components/channel-card";
import { MovieCard } from "@/components/movie-card";
import { PageHeader, ServicePills, type PillOption } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useData } from "@/hooks/use-data";
import { api, qs } from "@/lib/api";
import { useCatalogPageSize } from "@/hooks/use-catalog-page-size";
import { useCursorPage } from "@/hooks/use-cursor-page";
import { SectionBar } from "@/components/section-bar";
import { CatalogActions } from "@/components/catalog-actions";
import { CatalogToolbar, CatalogPagination, catalogGrid } from "@/components/catalog-toolbar";
import { useTitle } from "@/hooks/use-title";
import { itemKey } from "@/lib/paths";
import { useSource } from "@/lib/source";
import { backendName, useAccounts } from "@/lib/session";
import type { Channel } from "@/lib/types";

const grid = catalogGrid;

export function MoviesPage() { return <CatalogPage kind="movies" />; }
export function ShowsPage() { return <CatalogPage kind="shows" />; }

/** Both catalogs keep the same header → filters → shelves in every loading state. */
function CatalogPage({ kind }: { kind: "movies" | "shows" }) {
  const title = kind === "movies" ? "Movies" : "Shows";
  useTitle(title);
  const source = useSource();
  const { bySlug } = useAccounts();
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const state = useData(() => source.following({ kind, catalog: true }), [source.key, kind, attempt]);
  const [params, setParams] = useSearchParams();
  const selected = params.get("library") || "all";
  const libraries = (state.data ?? []).filter((c) => c.kind === "library" && c.libraryType === kind);
  const shows = kind === "shows" ? (state.data ?? []).filter((c) => c.kind === "series") : [];
  const services = [...new Set(shows.map((c) => c.backend ?? c.provider))];
  const name = (slug: string) => { const backend = bySlug(slug); return backend ? backendName(backend) : slug; };
  const options: PillOption[] = [
    { value: "all", label: "Everything" },
    ...services.map((slug) => ({ value: slug, label: name(slug), color: bySlug(slug)?.info?.color })),
    ...libraries.map((c) => ({ value: itemKey(c), label: `${c.name} · ${c.handle || name(c.backend ?? c.provider)}`, color: bySlug(c.backend ?? c.provider)?.info?.color })),
  ];
  const visible = libraries.filter((c) => selected === "all" || selected === itemKey(c));
  const visibleServices = services.filter((slug) => selected === "all" || selected === slug);
  const hasContent = visible.length > 0 || visibleServices.length > 0;
  return (
    <div className="page">
      <div className="pb-2">
      <PageHeader actions={<CatalogActions kind={kind} onSync={() => setAttempt((n) => n + 1)} />} title={title} description={kind === "movies" ? "Movies from your libraries, all in one place." : "Your shows, across streaming services and server libraries."} />
      <CatalogToolbar query={query} onQuery={setQuery} label={kind}>
        <ServicePills label={kind === "movies" ? "Movie library" : "Show library"} value={selected} onChange={(value) => setParams(value === "all" ? {} : { library: value })} options={options} />
        {state.status === "loading" && <div className="flex gap-2" aria-hidden="true"><Skeleton className="h-9 w-28 rounded-full" /><Skeleton className="h-9 w-44 rounded-full" /></div>}
      </CatalogToolbar>
      </div>
      {state.status === "loading" && <section className="mt-8" aria-label={`Loading ${title.toLowerCase()}`} aria-busy="true"><Skeleton className="mb-4 h-7 w-48" /><CatalogSkeleton /></section>}
      {state.status === "error" && <div className="mt-8 flex items-center gap-3"><p role="alert" className="text-destructive text-sm">{state.error.message}</p><Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>Try again</Button></div>}
      {visibleServices.map((slug) => <SavedShowsShelf key={slug} title={name(slug)} backend={slug} query={query} revision={attempt} />)}
      {visible.map((library) => <LibraryShelf key={itemKey(library)} library={library} query={query} revision={attempt} />)}
      {state.status === "ready" && !hasContent && <Empty className="mt-8 py-16"><EmptyHeader><EmptyMedia variant="icon">{kind === "movies" ? <Film /> : <Tv />}</EmptyMedia><EmptyTitle>{selected === "all" ? `No ${title.toLowerCase()} yet` : "This library is unavailable"}</EmptyTitle><EmptyDescription>{selected === "all" ? `Connect ${kind === "movies" ? "Plex" : "a streaming account or Plex library"} in Settings to see your ${title.toLowerCase()} here.` : "Choose another filter to browse your connected libraries."}</EmptyDescription></EmptyHeader>{selected === "all" ? <Button asChild variant="secondary"><Link to="/settings">Connect account</Link></Button> : <Button variant="secondary" onClick={() => setParams({})}>Show everything</Button>}</Empty>}
    </div>
  );
}

function CatalogSkeleton() {
  const pageSize = useCatalogPageSize();
  return <div className={grid}>{Array.from({ length: pageSize }, (_, i) => <div key={i}><Skeleton className="aspect-[2/3] rounded-xl" /><Skeleton className="mt-2 h-4 w-4/5" /><Skeleton className="mt-2 h-3 w-1/3" /></div>)}</div>;
}
function SavedShowsShelf({ title, backend, query, revision }: { title: string; backend: string; query: string; revision: number }) {
  const source = useSource();
  const pageSize = useCatalogPageSize();
  const pager = useCursorPage(JSON.stringify([source.key, backend, query, revision, pageSize]), (next, signal) => api<{ channels: Channel[]; next?: string; total: number }>(`/following${qs({ kind: "shows", backend, next, q: query, limit: String(pageSize) })}`, { signal }));
  return <section className="mt-6" aria-label={title}><SectionBar className="mt-0 mb-4" title={title} detail={pager.state.data ? `${pager.state.data.total} shows` : undefined}><CatalogPagination {...pager} loading={pager.state.status === "loading"} label={title} /></SectionBar>{pager.state.status === "loading" ? <CatalogSkeleton /> : pager.state.status === "error" ? <div className="flex items-center gap-3"><p role="alert" className="text-destructive text-sm">{pager.state.error.message}</p><Button variant="outline" onClick={pager.retry}>Try again</Button></div> : <><div className={grid}>{pager.state.data.channels.map((show) => <ChannelCard key={itemKey(show)} channel={show} />)}</div>{!pager.state.data.channels.length && <p className="text-muted-foreground text-sm">No shows match this filter.</p>}</>}</section>;
}
function LibraryShelf({ library, query, revision }: { library: Channel; query: string; revision: number }) {
  const source = useSource();
  const pageSize = useCatalogPageSize();
  const refreshed = useRef(-1);
  const pager = useCursorPage(JSON.stringify([source.key, itemKey(library), query, revision, pageSize]), async (next, signal) => {
    const refresh = revision > 0 && refreshed.current !== revision;
    const data = await source.channel(library, undefined, { next, signal, query, sort: "new", limit: pageSize, refresh });
    if (refresh && !signal.aborted) refreshed.current = revision;
    return data;
  });
  const { state } = pager;
  return (
    <section className="mt-6" aria-label={`${library.name}${library.handle ? ` on ${library.handle}` : ""}`} aria-busy={state.status === "loading"}>
      <SectionBar className="mt-0 mb-4" title={library.name} detail={library.handle}><CatalogPagination {...pager} loading={state.status === "loading"} label={library.name} /></SectionBar>
      {state.status === "loading" && <CatalogSkeleton />}
      {state.status === "error" && <div className="flex items-center gap-3"><p role="alert" className="text-destructive text-sm">{state.error.message}</p><Button variant="outline" onClick={pager.retry}>Try again</Button></div>}
      {state.status === "ready" && <div className={grid}>{state.data.channels ? state.data.channels.map((show) => <ChannelCard key={itemKey(show)} channel={show} />) : state.data.videos.map((movie) => <MovieCard key={itemKey(movie)} movie={movie} />)}</div>}
      {state.status === "ready" && !(state.data.channels?.length || state.data.videos.length) && <p className="text-muted-foreground text-sm">{query ? "No titles match this filter." : "No titles in this library."}</p>}
    </section>
  );
}
