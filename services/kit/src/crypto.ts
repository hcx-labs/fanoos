import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const randomId = () => randomBytes(12).toString("base64url");

/** Token encryption (AES-256-GCM) and URL signing, keyed from the service secret. */
export function keys(secret: Buffer) {
  const derive = (info: string) => Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), info, 32));
  const encryptionKey = derive("tokens");
  const signingKey = derive("signing");
  const sign = (value: string) => createHmac("sha256", signingKey).update(value).digest("base64url").slice(0, 22);
  // Plain functions (no `this`): services destructure these.
  const verify = (value: string, signature: string) => {
    const expected = Buffer.from(sign(value));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  };
  return {
    /** Output: base64(iv | tag | ciphertext). */
    encrypt(plain: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
      const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
    },
    decrypt(sealed: string): string {
      const raw = Buffer.from(sealed, "base64");
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    },
    sign,
    verify,
    /** A tamper-proof token carrying JSON (for public URLs: which account, which item, until when). */
    seal(data: object, ttlSeconds: number): string {
      const body = Buffer.from(JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
      return `${body}.${sign(`seal:${body}`)}`;
    },
    open<T>(token: string): T | null {
      const [body, signature] = token.split(".");
      if (!body || !signature || !verify(`seal:${body}`, signature)) return null;
      const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
      return data.exp * 1000 > Date.now() ? data : null;
    },
  };
}
