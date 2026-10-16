import { Hono } from "hono";
import type { Comment } from "@tube/shared";
import { SharedCache } from "../cache.ts";
import { db } from "../db.ts";
import {
  canWrite,
  getRating,
  postComment,
  QuotaExceeded,
  rate,
  type Rating,
  RelinkRequired,
  subscribe,
  unsubscribe,
  WriteNotAllowed,
} from "../google.ts";
import { type AppEnv, fail, requireUser } from "../http.ts";
import { proxyImage } from "../media.ts";

/**
 * Actions on YouTube as a linked account: subscribe, rate, comment. Only for
 * accounts that granted youtube.force-ssl; each write costs 50 quota units.
 */
export const actionRoutes = new Hono<AppEnv>();
actionRoutes.use("*", requireUser);

const videoId = (id: unknown) => {
  if (typeof id !== "string" || !/^[\w-]{11}$/.test(id)) throw fail(400, "Invalid video id.");
  return id;
};
const channelId = (id: unknown) => {
  if (typeof id !== "string" || !/^UC[\w-]{22}$/.test(id)) throw fail(400, "Invalid channel id.");
  return id;
};

/** The account must belong to the user and have granted write access. */
function writableAccount(userId: string, accountId: unknown): string {
  if (typeof accountId !== "string") throw fail(400, "Choose an account.");
  const row = db.prepare("SELECT scopes, needs_relink FROM accounts WHERE id = ? AND user_id = ?").get(accountId, userId) as
    | { scopes: string; needs_relink: number }
    | undefined;
  if (!row) throw fail(404, "Account not found.");
  if (row.needs_relink) throw fail(409, "This account needs to be linked again.", "relink");
  if (!canWrite(row.scopes)) throw fail(403, "This account is read-only. Allow actions for it in Settings → Linked accounts.", "read_only");
  return accountId;
}

/** Turn Google's failures into messages people can act on. */
async function google<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof QuotaExceeded) throw fail(429, "Today's YouTube quota for this server is used up. Actions work again after midnight Pacific time.", "quota");
    if (error instanceof WriteNotAllowed) throw fail(403, "Google refused: this account hasn't granted permission for actions. Allow actions again in Settings.", "read_only");
    if (error instanceof RelinkRequired) throw fail(409, "This account needs to be linked again.", "relink");
    const reason = (error as { reason?: string }).reason ?? "";
    if (reason === "subscriptionDuplicate") return undefined as T;
    if (reason === "commentsDisabled") throw fail(422, "Comments are turned off for this video.", "comments_disabled");
    if (reason === "subscriptionForbidden" || reason === "subscriptionNotFound") throw fail(422, "YouTube didn't allow that subscription change.", reason);
    console.warn("YouTube action failed:", (error as Error).message);
    throw fail(502, "YouTube didn't accept that action. Try again in a moment.", "upstream");
  }
}

actionRoutes.post("/subscriptions", async (c) => {
  const body = await c.req.json<{ accountId?: string; channelId?: string; subscribed?: boolean }>();
  const account = writableAccount(c.get("user").id, body.accountId);
  const channel = channelId(body.channelId);
  if (body.subscribed) {
    const info = await google(() => subscribe(account, channel));
    db.prepare("INSERT OR IGNORE INTO subscriptions (account_id, channel_id, title, avatar) VALUES (?, ?, ?, ?)").run(
      account,
      channel,
      info?.title ?? channel,
      info?.avatar ?? null,
    );
  } else {
    await google(() => unsubscribe(account, channel));
    db.prepare("DELETE FROM subscriptions WHERE account_id = ? AND channel_id = ?").run(account, channel);
  }
  return c.json({ ok: true });
});

// Each lookup costs quota; keep the answer (and replace it whenever the user rates).
const ratings = new SharedCache<Rating>("rating");

actionRoutes.get("/rating", async (c) => {
  const account = writableAccount(c.get("user").id, c.req.query("accountId"));
  const id = videoId(c.req.query("videoId"));
  return c.json({ rating: await google(() => ratings.get(`${account}:${id}`, () => getRating(account, id))) });
});

actionRoutes.post("/rating", async (c) => {
  const body = await c.req.json<{ accountId?: string; videoId?: string; rating?: Rating }>();
  const account = writableAccount(c.get("user").id, body.accountId);
  if (!["like", "dislike", "none"].includes(body.rating ?? "")) throw fail(400, "Invalid rating.");
  const id = videoId(body.videoId);
  await google(() => rate(account, id, body.rating!));
  await ratings.setMany([[`${account}:${id}`, body.rating!]]);
  return c.json({ ok: true });
});

actionRoutes.post("/comments", async (c) => {
  const body = await c.req.json<{ accountId?: string; videoId?: string; text?: string; parentId?: string }>();
  const account = writableAccount(c.get("user").id, body.accountId);
  const text = body.text?.trim() ?? "";
  if (!text) throw fail(422, "Write something first.");
  if (text.length > 10_000) throw fail(422, "Comments can be at most 10,000 characters.");
  if (body.parentId !== undefined && (typeof body.parentId !== "string" || !/^[\w.-]{10,100}$/.test(body.parentId))) throw fail(400, "Invalid reply target.");
  const posted = await google(() => postComment(account, videoId(body.videoId), text, body.parentId));
  const comment: Comment = {
    id: posted.id,
    author: posted.snippet.authorDisplayName,
    avatar: proxyImage(posted.snippet.authorProfileImageUrl),
    text: posted.snippet.textOriginal ?? text,
    likes: 0,
    publishedText: "just now",
    replyCount: 0,
  };
  return c.json(comment);
});
