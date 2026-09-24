import { nowIso } from "../db/knex.js";

export const DEFAULT_PLOT_NAME = "My field";

export async function listPlots(db, userId) {
  return db("plots").where({ user_id: userId }).orderBy("id", "asc");
}

export async function getPlot(db, userId, plotId) {
  return db("plots").where({ id: plotId, user_id: userId }).first();
}

export async function createPlot(db, userId, data) {
  const [row] = await db("plots")
    .insert({ user_id: userId, created_at: nowIso(), ...data })
    .returning("id");
  return getPlot(db, userId, typeof row === "object" ? row.id : row);
}

/** Returns the requested plot (if owned), or the user's default plot (created on demand). */
export async function resolvePlotForScan(db, userId, plotId) {
  if (plotId) return getPlot(db, userId, plotId);
  const existing = await db("plots").where({ user_id: userId, name: DEFAULT_PLOT_NAME }).first();
  if (existing) return existing;
  return createPlot(db, userId, { name: DEFAULT_PLOT_NAME });
}
