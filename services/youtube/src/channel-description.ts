import { text } from "./parse.ts";

/** Modern AboutChannel wraps metadata; the legacy About tab exposes a Text directly. */
export function channelDescription(about: { metadata?: { description?: unknown } | null; description?: unknown }): string {
  return text(about.metadata?.description ?? about.description ?? "").replace(/\r\n?/g, "\n");
}
