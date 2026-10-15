import type { SegmentCategory } from "./types";

export const segmentMeta: Record<SegmentCategory, { label: string; description: string; color: string }> = {
  sponsor: { label: "Sponsor", description: "Paid promotion or a direct advertisement.", color: "var(--seg-sponsor)" },
  selfpromo: { label: "Self-promotion", description: "Merch, Patreon, or the creator's other channels.", color: "var(--seg-selfpromo)" },
  interaction: { label: "Interaction reminder", description: "“Like and subscribe” prompts mid-video.", color: "var(--seg-interaction)" },
  intro: { label: "Intro", description: "Animations or title cards with no information.", color: "var(--seg-intro)" },
  outro: { label: "End cards", description: "Credits and end screens.", color: "var(--seg-outro)" },
  preview: { label: "Preview / recap", description: "Clips of what's coming up or what already happened.", color: "var(--seg-preview)" },
  filler: { label: "Filler tangent", description: "Off-topic jokes or tangents that aren't needed.", color: "var(--seg-filler)" },
  music_offtopic: { label: "Non-music section", description: "Talking in music videos.", color: "var(--seg-music)" },
};

export const segmentOrder = Object.keys(segmentMeta) as SegmentCategory[];
