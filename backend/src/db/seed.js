// Demo seed (dev only): creates one account per role plus a demo plot.
//   npm run seed
// Passwords come from SEED_DEMO_PASSWORD, or are generated and printed once.
import crypto from "crypto";
import { config } from "../config/index.js";
import { getDb, migrateLatest, closeDb } from "./knex.js";
import { hashPassword } from "../auth/passwords.js";
import { createUser, findUserByEmail } from "../repositories/users.js";
import { createPlot } from "../repositories/plots.js";

if (config.isProduction && !process.argv.includes("--force")) {
  console.error("Refusing to seed demo accounts when ENV=production (use --force if you really mean it).");
  process.exit(1);
}

const password = process.env.SEED_DEMO_PASSWORD || crypto.randomBytes(9).toString("base64url");
const accounts = [
  { email: process.env.SEED_USER_EMAIL || "demo-user@agrisight.local", role: "user" },
  { email: process.env.SEED_EXPERT_EMAIL || "demo-expert@agrisight.local", role: "expert" },
  { email: process.env.SEED_ADMIN_EMAIL || "demo-admin@agrisight.local", role: "admin" },
];

const db = getDb();
try {
  await migrateLatest(db);
  const hash = await hashPassword(password);
  for (const a of accounts) {
    const existing = await findUserByEmail(db, a.email);
    if (existing) {
      console.log(`exists: ${a.email} (${existing.role}) -- password unchanged`);
      continue;
    }
    const user = await createUser(db, { email: a.email, passwordHash: hash, role: a.role });
    if (a.role === "user") {
      await createPlot(db, user.id, { name: "Demo tomato plot", crop: "Tomato", location_label: "Demo district" });
    }
    console.log(`created: ${a.email} (${a.role})`);
  }
  if (!process.env.SEED_DEMO_PASSWORD) {
    console.log(`\nPassword for newly created demo accounts (shown once): ${password}`);
  }
} finally {
  await closeDb();
}
