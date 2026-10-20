import type { LinkRequest, LinkStart, LinkStatus, ProviderAccount } from "@tube/shared";
import { config } from "./config.ts";
import { db, pending } from "./db.ts";
import { encrypt, randomId } from "./crypto.ts";
import { account, cloud, forgetServers } from "./client.ts";
import { fail } from "../../kit/src/service.ts";
type Flow = { clientId: string; pin: number; code: string; account?: string; linked?: ProviderAccount };
export const accountView = (ref: string): ProviderAccount => { const row = account(ref, true); return { ref, name: row.name, email: row.email, canWrite: true, needsRelink: !!row.needs_relink }; };
export async function begin(body: LinkRequest): Promise<LinkStart> {
 const back = new URL(body.returnUrl);
 if (back.origin !== config.publicUrl.origin || back.pathname !== "/api/links/complete") throw fail(400, "Invalid sign-in return URL.");
 const clientId = body.account ? account(body.account, true).client_id : `fanoos-${randomId()}`;
 const pin = await cloud<{ id: number; code: string; expiresIn: number }>("/api/v2/pins", clientId, undefined, { method: "POST", body: new URLSearchParams({ strong: "true" }) });
 const flow = randomId();
 pending.put("plex", flow, { clientId, pin: pin.id, code: pin.code, account: body.account } satisfies Flow, Math.max(30, pin.expiresIn || 600) * 1000);
 const query = new URLSearchParams({ clientID: clientId, code: pin.code, forwardUrl: body.returnUrl, "context[device][product]": "Fanoos" });
 return { flow, kind: "redirect", url: `https://app.plex.tv/auth#?${query}` };
}
export async function poll(id: string): Promise<LinkStatus> {
 const flow = pending.get<Flow>("plex", id);
 if (!flow) return { status: "failed", error: "Plex sign-in expired. Try again." };
 if (flow.linked) return { status: "linked", account: flow.linked, write: true };
 const pin = await cloud<{ authToken?: string }>(`/api/v2/pins/${flow.pin}?code=${encodeURIComponent(flow.code)}`, flow.clientId);
 if (!pin.authToken) return { status: "pending" };
 const user = await cloud<{ id: number; username: string; title?: string; email?: string }>("/api/v2/user", flow.clientId, pin.authToken);
 if (flow.account && account(flow.account, true).user_id !== String(user.id)) return { status: "failed", error: "Sign in with the same Plex account when reconnecting." };
 const ref = flow.account ?? randomId();
 db.prepare(`INSERT INTO accounts (ref,user_id,client_id,name,email,token,needs_relink) VALUES (?,?,?,?,?,?,0)
 ON CONFLICT(ref) DO UPDATE SET token=excluded.token,name=excluded.name,email=excluded.email,needs_relink=0`).run(ref, String(user.id), flow.clientId, user.title || user.username, user.email || "", encrypt(pin.authToken));
 forgetServers(ref);
 const linked = accountView(ref); pending.put("plex", id, { ...flow, linked }, 300_000);
 return { status: "linked", account: linked, write: true };
}
