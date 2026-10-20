import type { Server } from "./types.ts";

export const selectionKey = (server: Server, part: number | undefined) => `${server.id}:${server.clientId}:${part}`;
// Plex stores stream selection per account/part. Keep selection and session creation together.
const selections = new Map<string, Promise<void>>();
export async function selecting<T>(key: string, run: () => Promise<T>): Promise<T> {
 const previous = selections.get(key) ?? Promise.resolve();
 let release!: () => void;
 const gate = new Promise<void>((resolve) => { release = resolve; });
 const pending = previous.then(() => gate);
 selections.set(key, pending);
 await previous;
 try { return await run(); } finally { release(); if (selections.get(key) === pending) selections.delete(key); }
}
