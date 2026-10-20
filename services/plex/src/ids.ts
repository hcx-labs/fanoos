import { fail } from "../../kit/src/service.ts";
export const itemId = (server: string, key: string | number, library = false) => `${server}.${library ? "l" : "m"}.${key}`;
export function parseId(value: string) {
 const match = /^([a-fA-F0-9-]{8,48})\.([lm])\.(\d{1,12})$/.exec(value);
 if (!match) throw fail(400, "Invalid Plex item.");
 return { server: match[1]!, library: match[2] === "l", key: match[3]! };
}
