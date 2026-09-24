import bcrypt from "bcryptjs";
import { config } from "../config/index.js";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 72; // bcrypt only uses the first 72 bytes

export async function hashPassword(plain, cost = config.auth.bcryptCost) {
  if (typeof plain !== "string" || plain.length < PASSWORD_MIN_LENGTH) {
    throw new Error("Password does not meet the minimum length.");
  }
  return bcrypt.hash(plain, cost);
}

export async function verifyPassword(plain, hash) {
  if (typeof plain !== "string" || typeof hash !== "string") return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

// A real bcrypt hash of a random string, used to spend the same time on
// unknown emails as on known ones (no user-enumeration by timing).
let dummyHash = null;
export async function getDummyHash() {
  if (!dummyHash) dummyHash = await bcrypt.hash("dummy-password-for-timing-" + Math.random(), config.auth.bcryptCost);
  return dummyHash;
}
