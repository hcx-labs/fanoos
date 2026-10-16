/*
 * The signed-in streaming companion, managed from the app (Settings → Age-restricted
 * videos). This backend starts it as a child process, reads Google's device sign-in code
 * from its output for the UI, and restarts it on boot when a session is saved. In a
 * container image it runs as its own service instead (compose.yaml), and is adopted
 * when it answers at COMPANION_SIGNED_IN_URL.
 * It is only ever asked to stream videos YouTube age-restricts (see stream.ts).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgeRestrictedSetup } from "@tube/shared";
import { config } from "./config.ts";

export type SignedInState = AgeRestrictedSetup;

const repoRoot = resolve(import.meta.dirname, "../../..");
const script = join(repoRoot, "scripts/companion.sh");
const cacheDir = join(config.dataDir, "companion-signed-in");
const port = Number(new URL(config.companion.signedInUrl || "http://127.0.0.1:8283").port || 8283);

/** No companion script here (a container image): the signed-in instance runs as its own service. */
const external = !existsSync(script);

/** Where the signed-in instance listens: one this backend starts locally, or another container (Docker). */
export const signedInUrl = config.companion.signedInUrl || `http://127.0.0.1:${port}`;

let state: SignedInState = { status: "off" };
let child: ChildProcess | null = null;

export const signedInState = (): SignedInState => (external && state.status === "off" ? { status: "external", url: signedInUrl } : state);
export const signedInReady = () => state.status === "ready";

/** A completed sign-in leaves YouTube.js OAuth credentials in the cache folder. */
const hasSavedSession = () =>
  existsSync(cacheDir) && readdirSync(cacheDir, { recursive: true }).some((name) => /oauth|credential/i.test(String(name)));

async function healthy() {
  try {
    return (await fetch(`${signedInUrl}/healthz`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

/** Start the signed-in instance (or adopt one already running). */
export async function startSignedIn(): Promise<SignedInState> {
  if (child || state.status === "ready") return state;
  if (!config.companion.secret) return (state = { status: "error", error: "COMPANION_SECRET isn't set on the server." });
  if (await healthy()) return (state = { status: "ready", external: external || undefined });
  // In a container there's no companion script or Deno: the instance has to run as its own service.
  if (external) return (state = { status: "external", url: signedInUrl });

  state = { status: "starting" };
  const proc = spawn("bash", [script, "signed-in"], {
    cwd: repoRoot,
    env: { ...process.env, COMPANION_CACHE_ROOT: config.dataDir, COMPANION_SIGNED_IN_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = proc;
  let tail = "";
  const onOutput = (chunk: Buffer) => {
    const text = chunk.toString();
    tail = (tail + text).slice(-2000);
    const code = /Go to (\S+) in your browser and enter code (\S+)/.exec(text);
    if (code) state = { status: "waiting", url: code[1]!, code: code[2]! };
    // Google approved; the server comes up right after.
    if (/Sign in successful/.test(text)) state = { status: "starting" };
    if (/Server successfully started/.test(text)) state = { status: "ready" };
  };
  proc.stdout!.on("data", onOutput);
  proc.stderr!.on("data", onOutput);
  proc.on("exit", (exitCode) => {
    if (child !== proc) return;
    child = null;
    // A deliberate stop sets "off" first; anything else is a failure worth showing.
    if (state.status !== "off") state = { status: "error", error: `The streaming service stopped (exit ${exitCode}). ${lastLine(tail)}`.trim() };
  });
  return state;
}

const lastLine = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /error|fail/i.test(l))
    .at(-1)
    ?.slice(0, 200) ?? "";

export function stopSignedIn() {
  state = { status: "off" };
  child?.kill("SIGTERM");
  child = null;
}

/** Stop the instance and delete its saved Google session. */
export function signOutSignedIn() {
  stopSignedIn();
  rmSync(cacheDir, { recursive: true, force: true });
}

/** On boot: resume automatically if a session was saved earlier. */
export function resumeSignedIn() {
  if (hasSavedSession()) void startSignedIn();
  // Adopt an instance that runs on its own (another container), if one answers.
  else void healthy().then((ok) => ok && (state = { status: "ready", external: external || undefined }));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    child?.kill("SIGTERM");
    process.exit(0);
  });
}
process.once("exit", () => child?.kill("SIGTERM"));
