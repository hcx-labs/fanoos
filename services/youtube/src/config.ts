import { serviceConfig } from "../../kit/src/env.ts";

const env = process.env;
const base = serviceConfig("youtube", 8788);

export const config = {
  ...base,
  google: {
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    get configured() {
      return Boolean(this.clientId && this.clientSecret);
    },
    /** Google returns here (through core's proxy). Register it in the Google OAuth client. */
    redirectUri: env.GOOGLE_REDIRECT_URI || new URL("/api/b/youtube/public/oauth/callback", base.publicUrl).toString(),
  },
  /** YouTube Data API key for public lookups (video stats, categories); saves linked accounts' quota. */
  youtubeApiKey: env.YOUTUBE_API_KEY ?? "",
  /** Invidious companion: generates YouTube's anti-bot tokens and streams video. */
  companion: {
    url: (env.COMPANION_URL ?? "").replace(/\/$/, ""),
    /** Optional signed-in instance, used only for videos YouTube age-restricts. */
    signedInUrl: (env.COMPANION_SIGNED_IN_URL ?? "").replace(/\/$/, ""),
    /** That instance's volume, read-only (Docker): where it leaves the google.com/device code to enter. */
    signedInDir: env.COMPANION_SIGNED_IN_DIR ?? "",
    secret: env.COMPANION_SECRET ?? "",
    get configured() {
      return Boolean(this.url && this.secret);
    },
  },
};
