import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { getDb, migrateLatest } from "./db/knex.js";

const db = getDb();
const [, applied] = await migrateLatest(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(", ")}`);

const app = createApp({ db });

app.listen(config.port, () => {
  console.log(`Backend server listening on port ${config.port} (ENV=${config.env})`);
  console.log(`Proxying ML service at ${config.mlServiceUrl}`);
  if (!config.mlInternalToken) {
    console.warn("[config] WARNING: ML_INTERNAL_TOKEN is not set -- the ML service will reject every request. Set it in .env.");
  }
});

export default app;
