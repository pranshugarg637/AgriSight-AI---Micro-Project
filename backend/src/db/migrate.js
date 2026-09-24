// Usage: npm run migrate            (apply all pending migrations)
//        npm run migrate -- --rollback
import { getDb, migrateLatest, closeDb, MIGRATIONS_DIR } from "./knex.js";

const db = getDb();
try {
  if (process.argv.includes("--rollback")) {
    const [batch, log] = await db.migrate.rollback({ directory: MIGRATIONS_DIR, loadExtensions: [".js"] });
    console.log(`Rolled back batch ${batch}:`, log);
  } else {
    const [batch, log] = await migrateLatest(db);
    console.log(log.length ? `Applied batch ${batch}: ${log.join(", ")}` : "Database already up to date.");
  }
} finally {
  await closeDb();
}
