import { keys } from "../../kit/src/crypto.ts";
import { config } from "./config.ts";
export { randomId, randomToken } from "../../kit/src/crypto.ts";
export const { encrypt, decrypt, seal, open } = keys(config.secret);
