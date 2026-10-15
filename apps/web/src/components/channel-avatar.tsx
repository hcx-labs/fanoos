import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { hueFor, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Avatar image (served through the server's image proxy), falling back to tinted initials. */
export function ChannelAvatar({
  name,
  className,
  ring,
  textClassName,
  hueKey,
  src,
}: {
  src?: string;
  /** Tint from this key instead of the name (e.g. two accounts with the same name). */
  hueKey?: string;
  textClassName?: string;
  name: string;
  className?: string;
  /** Draw a brand ring, e.g. for channels with unseen uploads. */
  ring?: boolean;
}) {
  const hue = hueFor(hueKey ?? name);
  return (
    <Avatar
      className={cn(ring && "ring-brand ring-offset-background ring-2 ring-offset-2", className)}
      style={{ "--hue": hue } as React.CSSProperties}
    >
      {src && <AvatarImage src={src} alt="" referrerPolicy="no-referrer" className="object-cover" />}
      <AvatarFallback className={cn("bg-[oklch(0.86_0.07_var(--hue))] font-semibold text-[oklch(0.3_0.08_var(--hue))] dark:bg-[oklch(0.36_0.08_var(--hue))] dark:text-[oklch(0.93_0.05_var(--hue))]", textClassName)}>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
