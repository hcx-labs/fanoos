import { mergeConfig } from "vite";
import { fileURLToPath } from "node:url";
import base from "./vite.config.ts";

export default mergeConfig(base, {
  base: "./",
  build: {
    outDir: "../desktop/offline-dist",
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL("./offline.html", import.meta.url)) },
  },
});
