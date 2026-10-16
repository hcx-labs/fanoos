import { createHash } from "node:crypto";
import { keys } from "../../kit/src/crypto.ts";
import { config } from "./config.ts";

export { randomId, randomToken } from "../../kit/src/crypto.ts";
export const { encrypt, decrypt, sign, verify: verifySignature, seal, open } = keys(config.secret);
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
