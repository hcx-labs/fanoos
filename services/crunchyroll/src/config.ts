import { serviceConfig } from "../../kit/src/env.ts";

const env = process.env;

export const config = {
  ...serviceConfig("crunchyroll", 8789),
  /**
   * Client credentials of Crunchyroll's Android TV app (there's no official API). The TV app's
   * activation-code sign-in is what lets Fanoos link an account without seeing its password.
   */
  basicAuth: env.CRUNCHYROLL_BASIC_AUTH ?? "",
  appVersion: env.CRUNCHYROLL_APP_VERSION || "3.76.0_22366",
  /** Catalogue language for titles and descriptions. */
  locale: env.CRUNCHYROLL_LOCALE || "en-US",
};
