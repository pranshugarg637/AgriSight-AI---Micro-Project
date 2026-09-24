import { nowIso } from "../db/knex.js";
import { generateRefreshToken, hashToken, newFamilyId } from "../auth/tokens.js";

/** Issues a refresh token (new family unless one is given). Returns the raw token. */
export async function issueRefreshToken(db, userId, { ttlDays, familyId = newFamilyId() }) {
  const raw = generateRefreshToken();
  const [row] = await db("refresh_tokens")
    .insert({
      user_id: userId,
      token_hash: hashToken(raw),
      family_id: familyId,
      expires_at: new Date(Date.now() + ttlDays * 86400 * 1000).toISOString(),
      created_at: nowIso(),
    })
    .returning("id");
  return { raw, id: typeof row === "object" ? row.id : row, familyId };
}

export async function revokeFamily(db, familyId) {
  await db("refresh_tokens").where({ family_id: familyId }).whereNull("revoked_at").update({ revoked_at: nowIso() });
}

export async function revokeAllForUser(db, userId) {
  await db("refresh_tokens").where({ user_id: userId }).whereNull("revoked_at").update({ revoked_at: nowIso() });
}

/**
 * Rotates a refresh token.
 * - unknown token      -> { ok:false, reason:"invalid" }
 * - already revoked    -> reuse detected: whole family revoked, { ok:false, reason:"reused" }
 * - expired            -> { ok:false, reason:"expired" }
 * - valid              -> old revoked + linked to the new one, { ok:true, userId, raw }
 */
export async function rotateRefreshToken(db, rawToken, { ttlDays }) {
  if (!rawToken) return { ok: false, reason: "invalid" };
  const row = await db("refresh_tokens").where({ token_hash: hashToken(rawToken) }).first();
  if (!row) return { ok: false, reason: "invalid" };
  if (row.revoked_at) {
    await revokeFamily(db, row.family_id);
    return { ok: false, reason: "reused", userId: row.user_id };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await revokeFamily(db, row.family_id);
    return { ok: false, reason: "expired" };
  }
  const next = await issueRefreshToken(db, row.user_id, { ttlDays, familyId: row.family_id });
  await db("refresh_tokens").where({ id: row.id }).update({ revoked_at: nowIso(), replaced_by: next.id });
  return { ok: true, userId: row.user_id, raw: next.raw };
}

export async function findByRaw(db, rawToken) {
  if (!rawToken) return null;
  return db("refresh_tokens").where({ token_hash: hashToken(rawToken) }).first();
}
