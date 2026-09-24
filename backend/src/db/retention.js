// Deletes stored scan images older than IMAGE_RETENTION_DAYS. Run daily (cron / Task Scheduler).
import { getDb, migrateLatest, closeDb } from "./knex.js";
import { enforceImageRetention } from "../services/imageStore.js";

const db = getDb();
try {
  await migrateLatest(db);
  const n = await enforceImageRetention(db);
  console.log(`Retention: removed ${n} stored image(s).`);
} finally {
  await closeDb();
}
