import { nowIso } from "../db/knex.js";

export const ROLES = ["user", "expert", "admin"];

const PUBLIC_FIELDS = ["id", "email", "role", "preferred_language", "store_location_opt_in", "created_at"];

export function toPublicUser(row) {
  if (!row) return null;
  const out = {};
  for (const f of PUBLIC_FIELDS) out[f] = row[f];
  out.store_location_opt_in = Boolean(row.store_location_opt_in);
  return out;
}

export const normaliseEmail = (email) => String(email).trim().toLowerCase();

export async function findUserByEmail(db, email) {
  return db("users").where({ email: normaliseEmail(email) }).first();
}

export async function findUserById(db, id) {
  return db("users").where({ id }).first();
}

export async function createUser(db, { email, passwordHash, role = "user", preferredLanguage = "en" }) {
  if (!ROLES.includes(role)) throw new Error(`Invalid role ${role}`);
  const now = nowIso();
  const [row] = await db("users")
    .insert({
      email: normaliseEmail(email),
      password_hash: passwordHash,
      role,
      preferred_language: preferredLanguage,
      created_at: now,
      updated_at: now,
    })
    .returning("id");
  const id = typeof row === "object" ? row.id : row;
  return findUserById(db, id);
}

export async function updateUser(db, id, patch) {
  await db("users").where({ id }).update({ ...patch, updated_at: nowIso() });
  return findUserById(db, id);
}

export async function recordFailedLogin(db, user, { maxFailed, lockoutMinutes }) {
  const attempts = (user.failed_login_attempts || 0) + 1;
  const patch = { failed_login_attempts: attempts };
  if (attempts >= maxFailed) {
    patch.locked_until = new Date(Date.now() + lockoutMinutes * 60 * 1000).toISOString();
    patch.failed_login_attempts = 0;
  }
  await db("users").where({ id: user.id }).update(patch);
}

export async function clearFailedLogins(db, userId) {
  await db("users").where({ id: userId }).update({ failed_login_attempts: 0, locked_until: null });
}

export function isLocked(user) {
  return Boolean(user.locked_until && new Date(user.locked_until).getTime() > Date.now());
}

export async function deleteUser(db, id) {
  await db("users").where({ id }).del();
}
