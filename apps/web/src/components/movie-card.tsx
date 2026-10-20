import { Link } from "react-router";
import { Play } from "lucide-react";
import { paths } from "@/lib/paths";
import { formatDuration } from "@/lib/format";
import type { Video } from "@/lib/types";
export function MovieCard({ movie }: { movie: Video }) {
  return <Link to={paths.channelOf(movie)} className="group/card min-w-0">
    <div className="bg-muted relative aspect-[2/3] overflow-hidden rounded-xl">
      <img src={movie.poster || movie.thumbnail} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover/card:scale-[1.03]" />
      <span className="absolute inset-0 grid place-items-center bg-black/30 text-white opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-visible/card:opacity-100"><Play className="size-10 drop-shadow" /></span>
      {!!movie.progress && <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25"><span className="bg-brand block h-full" style={{ width: `${Math.min(100, movie.progress / movie.duration * 100)}%` }} /></span>}
    </div>
    <h2 className="mt-2 line-clamp-2 text-sm font-semibold">{movie.title}</h2>
    <p className="text-muted-foreground mt-1 text-xs">{[movie.year, movie.duration ? formatDuration(movie.duration) : null, movie.rating].filter(Boolean).join(" · ")}</p>
  </Link>;
}
