import type { Template } from "@pdfme/common";
import { pool } from "@/lib/db";
import type { BillType } from "./fields";
import { DEFAULT_TEMPLATES, getDefaultTemplate } from "./defaults";
import { isUsableConsultationTemplate } from "./consultation-template";

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

// The design a CONSULTATION prints on (migration 0024): the doctor's own
// assigned design when they have a usable one, otherwise the location's active
// consultation design (getActiveTemplate, unchanged - it still lazily seeds the
// checked-in default). The usability rule itself is the pure, tested
// isUsableConsultationTemplate; this function only fetches the candidate.
//
// Resolution is LIVE, never snapshotted on the bill: a reprint uses whatever
// design the doctor points at today, exactly as editing the active design has
// always affected reprints.
//
// `doctorId` is optional so a document without one (a preview sample, or a bill
// whose doctor could not be resolved) simply gets the default design.
export async function getConsultationTemplate(
  doctorId: string | null | undefined,
  locationId: string,
): Promise<BillTemplateRow> {
  if (doctorId) {
    const { rows } = await pool.query<BillTemplateRow & { location_id: string }>(
      `SELECT t.id, t.bill_type, t.name, t.schema_json, t.is_active, t.updated_at,
              t.location_id::text AS location_id
         FROM doctors d
         JOIN bill_templates t ON t.id = d.consultation_template_id
        WHERE d.id = $1
        LIMIT 1`,
      [doctorId],
    );
    // A row that fails the rule (wrong type / another branch) is ignored, never
    // printed - the doctor falls back to the standard receipt below.
    if (isUsableConsultationTemplate(rows[0], locationId)) return rows[0];
  }
  return getActiveTemplate("consultation", locationId);
}

// Which doctors currently print on a given design - the input to BOTH the
// library's "Used by N doctors" badge and the delete warning, so the two can
// never disagree. Ordered by name for a stable message.
export async function listDoctorsUsingTemplate(
  templateId: string,
  locationId: string,
): Promise<{ id: string; name: string }[]> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT d.id::text, d.name
       FROM doctors d
       JOIN bill_templates t ON t.id = d.consultation_template_id
      WHERE d.consultation_template_id = $1 AND t.location_id = $2
      ORDER BY d.name ASC`,
    [templateId, locationId],
  );
  return rows;
}

// Every assigned doctor at a location, grouped by design id - one query for the
// whole library page rather than one per card.
export async function getTemplateDoctorUsage(
  locationId: string,
): Promise<Map<string, string[]>> {
  const { rows } = await pool.query<{ template_id: string; name: string }>(
    `SELECT d.consultation_template_id::text AS template_id, d.name
       FROM doctors d
       JOIN bill_templates t ON t.id = d.consultation_template_id
      WHERE t.location_id = $1
      ORDER BY d.name ASC`,
    [locationId],
  );
  const usage = new Map<string, string[]>();
  for (const row of rows) {
    const names = usage.get(row.template_id);
    if (names) names.push(row.name);
    else usage.set(row.template_id, [row.name]);
  }
  return usage;
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
//
// Doctors assigned to this design (migration 0024) do NOT block the delete - the
// admin is warned by name in the confirm dialog first - but their pointers are
// cleared in the SAME transaction as the delete, so the table can never hold a
// dangling reference and those doctors fall back to the active design. The
// cleared names come back in `unassigned` so the action can audit them and the
// UI can say exactly who moved.
export async function deleteTemplate(
  id: string,
  locationId: string,
): Promise<{ ok: true; unassigned: string[] } | { ok: false; reason: string }> {
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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Clear the pointers FIRST (same transaction) - the FK would otherwise
    // reject the delete outright, and doing it here keeps "who was unassigned"
    // knowable for the audit log.
    const { rows: unassigned } = await client.query<{ name: string }>(
      `UPDATE doctors SET consultation_template_id = NULL
        WHERE consultation_template_id = $1
        RETURNING name`,
      [id],
    );
    await client.query(`DELETE FROM bill_templates WHERE id = $1 AND location_id = $2`, [
      id,
      locationId,
    ]);
    await client.query("COMMIT");
    return { ok: true, unassigned: unassigned.map((r) => r.name) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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
