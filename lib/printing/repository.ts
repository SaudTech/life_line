import type { Template } from "@pdfme/common";
import { pool } from "@/lib/db";
import type { BillType } from "./fields";
import { DEFAULT_TEMPLATES, getDefaultTemplate } from "./defaults";

// Data access for bill_templates (plan §4). Thin: each function is one
// operation and nothing more - no validation, no pdfme-specific logic beyond
// JSON in/out (that lives in the action + the Designer itself). Mirrors
// lib/services/repository.ts.

export interface BillTemplateRow {
  id: string;
  bill_type: BillType;
  name: string;
  schema_json: Template;
  is_active: boolean;
  updated_at: Date;
}

// A design as it appears in the library index - everything but the (large)
// schema_json, which the list doesn't need (plan §2).
export interface TemplateSummary {
  id: string;
  bill_type: BillType;
  name: string;
  is_active: boolean;
  updated_at: Date;
}

// The active template for a (type, location) - lazily seeded from the
// checked-in default the first time it's ever read, so printing/preview works
// day one without a migration-time data step (plan §7: "getActiveTemplate
// returns the seed before any edit").
export async function getActiveTemplate(
  type: BillType,
  locationId: string,
): Promise<BillTemplateRow> {
  const { rows } = await pool.query<BillTemplateRow>(
    `SELECT id, bill_type, name, schema_json, is_active, updated_at
       FROM bill_templates
      WHERE bill_type = $1 AND location_id = $2 AND is_active
      LIMIT 1`,
    [type, locationId],
  );
  if (rows[0]) return rows[0];

  const seeded = await pool.query<BillTemplateRow>(
    `INSERT INTO bill_templates (location_id, bill_type, name, schema_json, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     RETURNING id, bill_type, name, schema_json, is_active, updated_at`,
    [locationId, type, `Default ${type} receipt`, JSON.stringify(getDefaultTemplate(type))],
  );
  return seeded.rows[0];
}

// Whether a PRINT can actually produce a receipt for this (type, location) - the
// single rule every Print/Reprint button is server-gated by (print-updates plan
// §1). True iff an admin-designed active row exists OR a checked-in default would
// seed one on first print. Does NOT seed (a mere render check must not write), and
// does NOT re-validate the stored row: save-time checkTemplate (actions.ts) already
// guarantees a stored active row is valid, so existence is sufficient. A type
// with neither would return false and its button simply never renders - though
// every shipped type now carries a checked-in default, so in practice this is
// only false for a type removed from DEFAULT_TEMPLATES.
export async function hasPrintableTemplate(
  type: BillType,
  locationId: string,
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM bill_templates WHERE bill_type = $1 AND location_id = $2 AND is_active LIMIT 1`,
    [type, locationId],
  );
  if (rows[0]) return true; // an admin-designed active row exists
  return type in DEFAULT_TEMPLATES; // or a checked-in default would seed on first print
}

// ── Library semantics (plan §2) ──────────────────────────────────────────────
// A row is a NAMED DESIGN; editing updates it in place; is_active marks the one
// the counter prints. getActiveTemplate above (the print/preview resolver) is
// deliberately untouched - nothing on the counter side changes.

// Every design at a location, grouped-friendly (type, then most-recent first).
// Omits schema_json - the index doesn't need it.
export async function listTemplates(locationId: string): Promise<TemplateSummary[]> {
  const { rows } = await pool.query<TemplateSummary>(
    `SELECT id, bill_type, name, is_active, updated_at
       FROM bill_templates
      WHERE location_id = $1
      ORDER BY bill_type ASC, updated_at DESC`,
    [locationId],
  );
  return rows;
}

// One full design (with schema_json) for the editor / preview. Location-scoped
// so one branch can never open another's design. null when not found/foreign.
export async function getTemplateById(
  id: string,
  locationId: string,
): Promise<BillTemplateRow | null> {
  const { rows } = await pool.query<BillTemplateRow>(
    `SELECT id, bill_type, name, schema_json, is_active, updated_at
       FROM bill_templates
      WHERE id = $1 AND location_id = $2
      LIMIT 1`,
    [id, locationId],
  );
  return rows[0] ?? null;
}

// Insert a new design. Active ONLY if it's the first design for that type, so a
// type is never left with zero active (the counter must always have one to
// print). The is_active value is computed atomically in the INSERT itself
// (NOT EXISTS), and the partial unique index is the ultimate guard.
export async function createTemplate(input: {
  type: BillType;
  locationId: string;
  name: string;
  schemaJson: Template;
  updatedBy: string;
}): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bill_templates (location_id, bill_type, name, schema_json, is_active, updated_by)
     VALUES ($1, $2, $3, $4,
       NOT EXISTS (SELECT 1 FROM bill_templates WHERE bill_type = $2 AND location_id = $1),
       $5)
     RETURNING id`,
    [input.locationId, input.type, input.name, JSON.stringify(input.schemaJson), input.updatedBy],
  );
  return rows[0];
}

// Update a design IN PLACE by id (the new "Save" - no more row-per-save
// pile-up). name/schemaJson are each optional (rename touches only name); a null
// param leaves that column untouched. Returns null if no such row for this
// location. The updated_at trigger bumps the timestamp.
export async function updateTemplate(input: {
  id: string;
  locationId: string;
  name?: string;
  schemaJson?: Template;
  updatedBy: string;
}): Promise<{ id: string } | null> {
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE bill_templates
        SET name = COALESCE($3, name),
            schema_json = COALESCE($4::jsonb, schema_json),
            updated_by = $5
      WHERE id = $1 AND location_id = $2
      RETURNING id`,
    [
      input.id,
      input.locationId,
      input.name ?? null,
      input.schemaJson ? JSON.stringify(input.schemaJson) : null,
      input.updatedBy,
    ],
  );
  return rows[0] ?? null;
}

// Make one design the active (printed) one for its type - atomically, so there
// is never a window with zero or two active rows: deactivate the current active
// of that type, then activate the target, in one transaction. Returns false if
// the target doesn't exist for this location.
export async function activateTemplate(
  id: string,
  locationId: string,
  updatedBy: string,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const target = await client.query<{ bill_type: BillType }>(
      `SELECT bill_type FROM bill_templates
        WHERE id = $1 AND location_id = $2 FOR UPDATE`,
      [id, locationId],
    );
    if (!target.rows[0]) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      `UPDATE bill_templates SET is_active = FALSE
        WHERE bill_type = $1 AND location_id = $2 AND is_active`,
      [target.rows[0].bill_type, locationId],
    );
    await client.query(
      `UPDATE bill_templates SET is_active = TRUE, updated_by = $3
        WHERE id = $1 AND location_id = $2`,
      [id, locationId, updatedBy],
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Copy a design's layout into a new INACTIVE row named "<name> (copy)". Returns
// the new id, or null if the source doesn't exist for this location.
export async function duplicateTemplate(
  id: string,
  locationId: string,
  updatedBy: string,
): Promise<{ id: string } | null> {
  const source = await getTemplateById(id, locationId);
  if (!source) return null;
  return createTemplate({
    type: source.bill_type,
    locationId,
    name: `${source.name} (copy)`,
    schemaJson: source.schema_json,
    updatedBy,
  });
}

// Delete a design - GUARDED (plan §5): never the active one (the counter prints
// it) and never the last of its type (the counter needs one). Nothing is
// silently removed; callers surface `reason` to the admin.
export async function deleteTemplate(
  id: string,
  locationId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const row = await getTemplateById(id, locationId);
  if (!row) return { ok: false, reason: "That design no longer exists." };
  if (row.is_active) {
    return {
      ok: false,
      reason: "This design is active at the counter. Set another design active first.",
    };
  }
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM bill_templates
      WHERE bill_type = $1 AND location_id = $2`,
    [row.bill_type, locationId],
  );
  if (rows[0].count === "1") {
    return {
      ok: false,
      reason: "This is the only design of its type. Create another before deleting this one.",
    };
  }
  await pool.query(`DELETE FROM bill_templates WHERE id = $1 AND location_id = $2`, [
    id,
    locationId,
  ]);
  return { ok: true };
}

// Replace the active template: deactivate whatever is currently active and
// insert the new one as active, in one transaction - never an UPDATE-in-place,
// so a prior version is always still in the table (never lost, just inactive).
export async function saveTemplate(input: {
  type: BillType;
  locationId: string;
  name: string;
  schemaJson: Template;
  updatedBy: string;
}): Promise<{ id: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE bill_templates SET is_active = FALSE
        WHERE bill_type = $1 AND location_id = $2 AND is_active`,
      [input.type, input.locationId],
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO bill_templates (location_id, bill_type, name, schema_json, is_active, updated_by)
       VALUES ($1, $2, $3, $4, TRUE, $5)
       RETURNING id`,
      [input.locationId, input.type, input.name, JSON.stringify(input.schemaJson), input.updatedBy],
    );
    await client.query("COMMIT");
    return inserted.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Restore the checked-in default for a type - just a saveTemplate() with the
// seed JSON, so it goes through the exact same "deactivate old, insert new
// active" path (plan §4/§7).
export async function resetToDefault(
  type: BillType,
  locationId: string,
  updatedBy: string,
): Promise<{ id: string }> {
  return saveTemplate({
    type,
    locationId,
    name: `Default ${type} receipt`,
    schemaJson: getDefaultTemplate(type),
    updatedBy,
  });
}
