import { Link } from "react-router";
import { ChannelAvatar } from "@/components/channel-avatar";
import { paths } from "@/lib/paths";
import type { Channel } from "@/lib/types";
/** A browsable channel/show card, shared by nested media-server libraries. */
export function ChannelCard({ channel }: { channel: Channel }) {
  return <Link to={paths.channel(channel)} className="group/card min-w-0">
    <div className="bg-muted aspect-[2/3] overflow-hidden rounded-xl">
      {channel.poster ? <img src={channel.poster} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover/card:scale-[1.03]" /> : <div className="grid size-full place-items-center"><ChannelAvatar name={channel.name} src={channel.avatar} className="size-16" /></div>}
    </div>
    <h2 className="mt-2 line-clamp-2 text-sm font-semibold">{channel.name}</h2>
    {!!channel.videoCount && <p className="text-muted-foreground mt-1 text-xs">{channel.videoCount} episodes</p>}
  </Link>;
}
