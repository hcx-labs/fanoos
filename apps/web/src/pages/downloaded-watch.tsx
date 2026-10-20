import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import { Player, type PlayerHandle } from "@/components/player/player";
import { PlayerBoundary } from "@/components/player/player-boundary";
import { VideoInfo } from "@/pages/watch";
import { downloadBridge } from "@/lib/downloads";
import type { OfflineVideoDetail } from "@/lib/types";

export function DownloadedWatchPage() {
  const { id = "" } = useParams();
  const [detail, setDetail] = useState<OfflineVideoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theater, setTheater] = useState(false);
  const player = useRef<PlayerHandle>(null);
  useEffect(() => {
    let live = true;
    void downloadBridge()?.detail(id).then((data) => live && setDetail(data)).catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [id]);
  if (error) return <p role="alert" className="page text-destructive">{error}</p>;
  if (!detail) return <p role="status" className="page text-muted-foreground">Loading your download…</p>;
  return <div className="page max-w-6xl">
    <Link className="text-muted-foreground mb-5 inline-flex items-center gap-2 text-sm hover:text-foreground" to="/downloads"><ArrowLeft className="size-4" />Downloads</Link>
    <PlayerBoundary><Player ref={player} video={detail.video} stream={detail.stream} theater={theater} onTheaterChange={setTheater} /></PlayerBoundary>
    <p className="text-muted-foreground mt-4 text-xs">Available offline · {detail.quality} · Downloaded {new Date(detail.downloadedAt).toLocaleDateString()}</p>
    <VideoInfo video={detail.video} channel={detail.channel} onSeek={(time) => player.current?.seek(time)} offline />
  </div>;
}
