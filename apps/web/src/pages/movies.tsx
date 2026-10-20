import { useState } from "react";
import { Link } from "react-router";
import { Film } from "lucide-react";
import { MovieCard } from "@/components/movie-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useData } from "@/hooks/use-data";
import { useChannelVideos } from "@/hooks/use-channel-videos";
import { useTitle } from "@/hooks/use-title";
import { itemKey, paths } from "@/lib/paths";
import { useSource } from "@/lib/source";
import type { Channel } from "@/lib/types";

export function MoviesPage() {
  useTitle("Movies");
  const source = useSource();
  const state = useData(() => source.following(), [source.key]);
  const [library, setLibrary] = useState("all");
  const libraries = (state.data ?? []).filter((c) => c.kind === "library" && c.libraryType === "movies");
  return <div className="page">
    <PageHeader title="Movies" description="Movies from your libraries, all in one place." actions={libraries.length > 1 && <Select value={library} onValueChange={setLibrary}><SelectTrigger className="rounded-full" aria-label="Movie library"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All libraries</SelectItem>{libraries.map((c) => <SelectItem key={itemKey(c)} value={itemKey(c)}>{c.name}{c.handle ? ` · ${c.handle}` : ""}</SelectItem>)}</SelectContent></Select>} />
    {state.status === "loading" && <div className="mt-8 grid grid-cols-2 gap-5 sm:grid-cols-3 xl:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="aspect-[2/3] rounded-xl" />)}</div>}
    {state.status === "error" && <p role="alert" className="text-destructive mt-8 text-sm">{state.error.message}</p>}
    {state.status === "ready" && !libraries.length && <Empty className="mt-8 py-16"><EmptyHeader><EmptyMedia variant="icon"><Film /></EmptyMedia><EmptyTitle>No movie libraries yet</EmptyTitle><EmptyDescription>Connect Plex in Settings to browse movies from your own servers and shared libraries.</EmptyDescription></EmptyHeader><Button asChild variant="secondary"><Link to="/settings">Connect Plex</Link></Button></Empty>}
    {libraries.filter((c) => library === "all" || itemKey(c) === library).map((c) => <MovieLibrary key={itemKey(c)} library={c} />)}
  </div>;
}
function MovieLibrary({ library }: { library: Channel }) {
  const { state, loadMore, loadingMore, moreError, reload } = useChannelVideos(library);
  return <section className="mt-8" aria-label={`${library.name}${library.handle ? ` on ${library.handle}` : ""}`}>
    <div className="mb-4 flex items-baseline gap-3"><h2 className="font-display text-xl font-semibold"><Link to={paths.channel(library)} className="hover:text-brand">{library.name}</Link></h2><span className="text-muted-foreground text-xs">{library.handle}</span></div>
    {state.status === "error" ? <div className="flex items-center gap-3"><p role="alert" className="text-destructive text-sm">{state.error.message}</p><Button variant="outline" onClick={reload}>Try again</Button></div> : <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">{state.status === "loading" ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="aspect-[2/3] rounded-xl" />) : state.data.videos.map((movie) => <MovieCard key={itemKey(movie)} movie={movie} />)}</div>}
    {state.status === "ready" && !state.data.videos.length && <p className="text-muted-foreground text-sm">No movies in this library.</p>}
    {moreError && <p role="alert" className="text-destructive mt-4 text-sm">{moreError.message}</p>}
    {state.data?.next && <Button variant="outline" className="mt-6 rounded-full" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more movies"}</Button>}
  </section>;
}
