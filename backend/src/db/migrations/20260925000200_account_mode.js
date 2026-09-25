/**
 * Step 6: expert-reviewed labels (evaluation / future retraining only),
 * Grad-CAM reference on scans, follow-up link on scans.
 */
export async function up(knex) {
  await knex.schema.alterTable("scans", (t) => {
    t.string("gradcam_ref", 255).nullable();
    t.integer("followup_of").nullable(); // previous scan id (same user) this scan re-checks
  });
  await knex.schema.createTable("reviewed_labels", (t) => {
    t.increments("id").primary();
    t.integer("scan_id").notNullable().unique().references("id").inTable("scans").onDelete("CASCADE");
    t.string("class_key", 160).notNullable();
    t.string("model_class_key", 160).nullable();
    t.integer("expert_id").nullable().references("id").inTable("users").onDelete("SET NULL");
    t.string("source", 16).notNullable().defaultTo("expert");
    t.string("created_at", 32).notNullable();
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("reviewed_labels");
  await knex.schema.alterTable("scans", (t) => {
    t.dropColumn("gradcam_ref");
    t.dropColumn("followup_of");
  });
}
