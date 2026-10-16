import { toast } from "sonner";
import { paths } from "./paths";
import { useSource } from "./source";
import type { YouTubeLink } from "./youtube-url";

/** Navigate to what a YouTube link points at (resolving handles through the server). */
export async function openYouTubeLink(link: YouTubeLink, navigate: (to: string, opts?: { replace?: boolean }) => void, source: ReturnType<typeof useSource>, replace = false) {
  if (link.kind === "video") return navigate(paths.watch(link.id, link.start), { replace });
  if (link.kind === "channel") return navigate(paths.channel(link.id), { replace });
  try {
    const { channelId } = await source.resolve(link.url);
    navigate(paths.channel(channelId), { replace });
  } catch {
    toast.error(`Couldn't find ${link.label} on YouTube`);
  }
}
