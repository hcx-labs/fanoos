export const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export type AudioTrack = { id: string; displayName: string; audioIsDefault: boolean };

export function audioMetadata(track: AudioTrack | undefined) {
  let lang: string | undefined;
  try { lang = track ? Intl.getCanonicalLocales(track.id.split(".")[0]!)[0] : undefined; } catch { /* Don't emit invalid language tags. */ }
  return { label: track?.displayName || lang || "Audio", lang, role: track && !track.audioIsDefault ? "alternate" : "main" };
}
