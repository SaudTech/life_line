import { pool } from "@/lib/db";

// Data access for the doctors master list (plan §5). Thin: each function is one
// query and nothing more - no validation, no money conversion, no business rules
// (those live in the schema, lib/money, and the actions). Mirrors
// lib/users/repository.ts.

// The row shape sent to the UI. Money stays as `fee_paise` - a BIGINT that pg
// returns as a string - and is formatted for display with formatPaise, never
// parsed into a float here.
export interface DoctorListRow {
  id: string;
  name: string;
  department: string | null;
  fee_paise: string;
  revisit_validity_days: number;
  active: boolean;
  created_at: Date;
}

// All doctors (active AND inactive) - the client shows both. Ordered by name for
// a stable, muscle-memory list.
export async function listDoctors(): Promise<DoctorListRow[]> {
  const { rows } = await pool.query<DoctorListRow>(
    `SELECT id, name, department, fee_paise, revisit_validity_days, active, created_at
       FROM doctors
      ORDER BY name ASC`,
  );
  return rows;
}

// Active doctors only, for pickers (a consultation can't be started against a
// deactivated doctor). Ordered by name for a stable list.
export async function listActiveDoctors(): Promise<DoctorListRow[]> {
  const { rows } = await pool.query<DoctorListRow>(
    `SELECT id, name, department, fee_paise, revisit_validity_days, active, created_at
       FROM doctors
      WHERE active
      ORDER BY name ASC`,
  );
  return rows;
}

// A single doctor by id - the consultation action reads the authoritative fee and
// validity from here (never trusts a fee sent by the client). Returns null if the
// id doesn't exist.
export async function getDoctorById(id: string): Promise<DoctorListRow | null> {
  const { rows } = await pool.query<DoctorListRow>(
    `SELECT id, name, department, fee_paise, revisit_validity_days, active, created_at
       FROM doctors
      WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export interface CreateDoctorInput {
  name: string;
  department: string | null;
  fee_paise: number; // integer paise, converted by the action
  revisit_validity_days: number;
  location_id: string; // bigint returned by pg as string
}

export async function createDoctor(
  input: CreateDoctorInput,
): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO doctors (name, department, fee_paise, revisit_validity_days, location_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      input.name,
      input.department,
      input.fee_paise,
      input.revisit_validity_days,
      input.location_id,
    ],
  );
  return rows[0];
}

export interface UpdateDoctorInput {
  id: string;
  name: string;
  department: string | null;
  fee_paise: number;
  revisit_validity_days: number;
}

// UPDATE the editable details (never the location or created_at).
export async function updateDoctor(input: UpdateDoctorInput): Promise<void> {
  await pool.query(
    `UPDATE doctors
        SET name = $2, department = $3, fee_paise = $4, revisit_validity_days = $5
      WHERE id = $1`,
    [
      input.id,
      input.name,
      input.department,
      input.fee_paise,
      input.revisit_validity_days,
    ],
  );
}

// Never hard-delete - deactivate only (plan D). `active=false` hides the doctor
// from new consultations while preserving every historical reference.
export async function setDoctorActive(
  id: string,
  active: boolean,
): Promise<void> {
  await pool.query(`UPDATE doctors SET active = $2 WHERE id = $1`, [id, active]);
}
