/**
 * v2 initial schema: users, refresh tokens, plots, scans, actions,
 * follow-ups, expert reviews. Portable between SQLite and Postgres
 * (JSON stored as TEXT, timestamps as ISO strings).
 */
export async function up(knex) {
  await knex.schema.createTable("users", (t) => {
    t.increments("id").primary();
    t.string("email", 254).notNullable().unique();
    t.string("password_hash", 100).notNullable();
    t.string("role", 16).notNullable().defaultTo("user");
    t.string("preferred_language", 8).notNullable().defaultTo("en");
    t.boolean("store_location_opt_in").notNullable().defaultTo(false);
    t.integer("failed_login_attempts").notNullable().defaultTo(0);
    t.string("locked_until", 32).nullable();
    t.string("created_at", 32).notNullable();
    t.string("updated_at", 32).notNullable();
  });

  await knex.schema.createTable("refresh_tokens", (t) => {
    t.increments("id").primary();
    t.integer("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("token_hash", 64).notNullable().unique();
    t.string("family_id", 64).notNullable().index();
    t.string("expires_at", 32).notNullable();
    t.string("revoked_at", 32).nullable();
    t.integer("replaced_by").nullable();
    t.string("created_at", 32).notNullable();
  });

  await knex.schema.createTable("plots", (t) => {
    t.increments("id").primary();
    t.integer("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE").index();
    t.string("name", 120).notNullable();
    t.string("crop", 80).nullable();
    t.string("sowing_date", 10).nullable();
    t.string("location_label", 160).nullable(); // coarse, user-typed (e.g. district)
    t.float("lat").nullable(); // only stored if the user opted in
    t.float("lng").nullable();
    t.string("created_at", 32).notNullable();
  });

  await knex.schema.createTable("scans", (t) => {
    t.increments("id").primary();
    t.integer("user_id").nullable().references("id").inTable("users").onDelete("CASCADE").index();
    t.integer("plot_id").nullable().references("id").inTable("plots").onDelete("CASCADE").index();
    t.string("mode", 16).notNullable(); // farmer | account
    t.string("image_ref", 255).nullable();
    t.string("diagnosis", 160).nullable();
    t.string("crop", 80).nullable();
    t.string("class_key", 160).nullable();
    t.float("confidence").nullable();
    t.string("confidence_level", 16).nullable();
    t.string("unreliable_reason", 32).nullable();
    t.text("alternatives").nullable();
    t.string("retrieval_status", 40).nullable();
    t.text("sources").nullable();
    t.string("model_version", 40).nullable();
    t.string("language", 8).nullable();
    t.boolean("disputed").notNullable().defaultTo(false);
    t.string("created_at", 32).notNullable().index();
  });

  await knex.schema.createTable("actions", (t) => {
    t.increments("id").primary();
    t.integer("scan_id").notNullable().references("id").inTable("scans").onDelete("CASCADE").index();
    t.integer("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("action_type", 32).notNullable();
    t.string("note", 500).nullable();
    t.string("remind_at", 32).nullable();
    t.string("created_at", 32).notNullable();
  });

  await knex.schema.createTable("followups", (t) => {
    t.increments("id").primary();
    t.integer("previous_scan_id").notNullable().references("id").inTable("scans").onDelete("CASCADE");
    t.integer("new_scan_id").notNullable().references("id").inTable("scans").onDelete("CASCADE");
    t.integer("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("outcome", 16).notNullable(); // improved | same | worse
    t.text("basis").nullable();
    t.string("created_at", 32).notNullable();
  });

  await knex.schema.createTable("expert_reviews", (t) => {
    t.increments("id").primary();
    t.integer("scan_id").notNullable().references("id").inTable("scans").onDelete("CASCADE").index();
    t.integer("expert_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("decision", 16).notNullable(); // confirm | correct
    t.string("corrected_class_key", 160).nullable();
    t.string("note", 1000).nullable();
    t.string("created_at", 32).notNullable();
  });
}

export async function down(knex) {
  for (const table of ["expert_reviews", "followups", "actions", "scans", "plots", "refresh_tokens", "users"]) {
    await knex.schema.dropTableIfExists(table);
  }
}
