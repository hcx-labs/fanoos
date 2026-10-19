import { YT } from "youtubei.js";
import { fail } from "../../kit/src/service.ts";

export type ChannelListOptions = { query?: string; sort?: "new" | "popular" };
export const channelListKey = (id: string, { query = "", sort = "new" }: ChannelListOptions = {}) =>
  JSON.stringify([id, query.trim(), query.trim() ? "search" : sort]);

// YouTube.js returns several list classes with the same paging interface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function channelList(channel: any, { query = "", sort = "new" }: ChannelListOptions = {}): Promise<any> {
  if (query.trim()) {
    if (!channel.has_search) throw fail(422, "YouTube doesn't offer search for this channel.", "unsupported");
    return channel.search(query.trim());
  }
  if (!channel.has_videos) return null;
  const videos = await channel.getVideos();
  if (sort !== "popular") return videos;
  const popular = (videos.filters ?? []).find((label: string) => /^popular$/i.test(label));
  if (popular) {
    // youtubei.js exposes legacy chips through `filters`, but Channel.applyFilter only
    // accepts the newer ChipBarView. Call the legacy chip's endpoint directly.
    const legacyChip = videos.filter_nodes?.primary_filters?.find(
      (chip: { type: string; text?: { toString(): string } }) => chip.type === "ChipCloudChip" && chip.text?.toString() === popular,
    );
    if (legacyChip) {
      if (legacyChip.is_selected) return videos;
      const response = await legacyChip.endpoint.call(videos.actions, { parse: true });
      return new YT.FilteredChannelList(videos.actions, response, true);
    }
    return videos.applyFilter(popular);
  }
  const legacyPopular = (videos.sort_filters ?? []).find((label: string) => /popular/i.test(label));
  if (legacyPopular) return videos.applySort(legacyPopular);
  // Never silently substitute a sort of only the latest batch.
  throw fail(422, "YouTube doesn't offer Popular sorting for this channel.", "unsupported");
}
