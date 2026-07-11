import { pool } from "@/lib/db";

// Data access for the services master list (plan §1A). Thin: each function is one
// query and nothing more - no validation, no money conversion, no business rules
// (those live in the schema, lib/money, and the actions). Mirrors
// lib/doctors/repository.ts.

// The row shape sent to the UI. Money stays as `price_paise` - a BIGINT that pg
// returns as a string - and is formatted for display with formatPaise, never
// parsed into a float here.
export interface ServiceRow {
  id: string;
  name: string;
  price_paise: string;
  // The billable toggle: true = sold at the counter, false = retired but kept.
  active: boolean;
  // When the service was moved to Trash. NULL = not trashed. Independent of
  // `active`. The UI shows the "deletes in N days" countdown from it; the purge
  // uses it to decide what has expired.
  trashed_at: Date | null;
  created_at: Date;
}

// The whole catalog (both trashed and not) - the client partitions them into the
// live list and the archived (Trash) list. Ordered by name for a stable list.
export async function listServices(): Promise<ServiceRow[]> {
  const { rows } = await pool.query<ServiceRow>(
    `SELECT id, name, price_paise, active, trashed_at, created_at
       FROM services
      ORDER BY name ASC`,
  );
  return rows;
}

// Billable services only, for the Part 2 procedure picker: active AND not trashed.
// (An inactive or trashed service can't be added to a bill.) Ordered by name.
export async function listActiveServices(): Promise<ServiceRow[]> {
  const { rows } = await pool.query<ServiceRow>(
    `SELECT id, name, price_paise, active, trashed_at, created_at
       FROM services
      WHERE active AND trashed_at IS NULL
      ORDER BY name ASC`,
  );
  return rows;
}

export interface CreateServiceInput {
  name: string;
  price_paise: number; // integer paise, converted by the action
  location_id: string; // bigint returned by pg as string
}

export async function createService(
  input: CreateServiceInput,
): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO services (name, price_paise, location_id)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [input.name, input.price_paise, input.location_id],
  );
  return rows[0];
}

export interface UpdateServiceInput {
  id: string;
  name: string;
  price_paise: number;
}

// UPDATE the editable details (never the location or created_at).
export async function updateService(input: UpdateServiceInput): Promise<void> {
  await pool.query(
    `UPDATE services
        SET name = $2, price_paise = $3
      WHERE id = $1`,
    [input.id, input.name, input.price_paise],
  );
}

// The billable toggle only. Active = sold at the counter, Inactive = retired but
// kept indefinitely. Does NOT touch trashed_at - deactivating never deletes.
export async function setServiceActive(
  id: string,
  active: boolean,
): Promise<void> {
  await pool.query(`UPDATE services SET active = $2 WHERE id = $1`, [id, active]);
}

// Move to / restore from Trash. Trashing stamps `trashed_at = now()`, starting the
// retention clock (hidden from the picker, but preserved); restoring clears it,
// cancelling the scheduled purge. Leaves `active` untouched - the billable flag is
// a separate axis. Permanent deletion happens later in purgeExpiredServices.
export async function setServiceTrashed(
  id: string,
  trashed: boolean,
): Promise<void> {
  await pool.query(
    `UPDATE services
        SET trashed_at = CASE WHEN $2 THEN now() ELSE NULL END
      WHERE id = $1`,
    [id, trashed],
  );
}

// Permanently delete services that have been in Trash longer than the retention
// window, and return what was removed (id + name) so the caller can audit-log it.
//
// The FK bill_items.service_id → services.id is analytics-only: bill_items snapshot
// description + price at billing time, so a past bill reprints fully without the
// services row. We therefore detach that link (→ NULL) and hard-delete, both inside
// ONE transaction with FOR UPDATE, so a concurrent sweep can't double-delete and a
// referenced service can never be orphaned mid-purge.
export async function purgeExpiredServices(
  retentionDays: number,
): Promise<{ id: string; name: string }[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string; name: string }>(
      `SELECT id, name
         FROM services
        WHERE trashed_at IS NOT NULL
          AND trashed_at < now() - make_interval(days => $1)
        FOR UPDATE`,
      [retentionDays],
    );
    if (rows.length === 0) {
      await client.query("COMMIT");
      return [];
    }
    const ids = rows.map((r) => r.id);
    await client.query(
      `UPDATE bill_items SET service_id = NULL WHERE service_id = ANY($1::bigint[])`,
      [ids],
    );
    await client.query(`DELETE FROM services WHERE id = ANY($1::bigint[])`, [ids]);
    await client.query("COMMIT");
    return rows;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
