import { Hono } from "hono";
import type { AgeRestrictedSetup } from "@tube/shared";
import { type AppEnv, fail, requireUser } from "../http.ts";
import { isOwner } from "../users.ts";
import { signedInState, signOutSignedIn, startSignedIn } from "../youtube/signed-in.ts";

/** Server-wide settings, for the server's owner only. */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", requireUser, async (c, next) => {
  if (!isOwner(c.get("user").id)) throw fail(403, "Only the server's owner can change this.", "not_owner");
  await next();
});

adminRoutes.get("/age-restricted", (c) => c.json(signedInState() satisfies AgeRestrictedSetup));

adminRoutes.post("/age-restricted/start", async (c) => c.json((await startSignedIn()) satisfies AgeRestrictedSetup));

adminRoutes.post("/age-restricted/sign-out", (c) => {
  signOutSignedIn();
  return c.json(signedInState() satisfies AgeRestrictedSetup);
});
