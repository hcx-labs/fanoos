/**
 * Product identity. Change it here and the logo wordmark and copy follow
 * (also update <title> in index.html and APP_NAME on the server).
 *
 * Fanoos (فانوس) is Persian/Urdu for "lantern"; fanoos-e-khayal, the "lantern
 * of imagination", was the revolving magic lantern that cast moving pictures.
 */
export const brand = {
  name: "Fanoos",
  tagline: "The videos you subscribed to. Nothing else.",
  description: "A calm, private way to watch — your channels from every account, a beautiful player, and none of the tracking.",
} as const;

/** localStorage namespace. Kept independent of the name so renaming doesn't reset anyone's data. */
export const storageKey = (key: string) => `tube.${key}`;
