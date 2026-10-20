import { serviceConfig } from "../../kit/src/env.ts";
export const config = { ...serviceConfig("plex", 8790), onlyOwned: process.env.PLEX_OWNED_ONLY === "1" };
