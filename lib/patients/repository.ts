import { pool } from "@/lib/db";

// Data access for the patients master list (plan §5). Thin: each function is one
// query and nothing more - no validation, no business rules (those live in the
// schema and the actions). Mirrors lib/doctors/repository.ts.
//
// Part 2 (consultations) reuses findPatientsByPhone + createPatient DIRECTLY,
// independent of the /patients screen - keep them clean and UI-agnostic.

// The row shape sent to the UI. patient_code (the MRN) is the identifier shown to
// users; phone is NON-unique (several patients may share one) and never used to
// identify a patient.
export type Gender = "female" | "male" | "other";

export interface PatientRow {
  id: string;
  patient_code: string;
  name: string;
  age: number | null;
  phone: string | null;
  area: string | null;
  gender: Gender | null;
  created_at: Date;
}

const COLUMNS =
  "id, patient_code, name, age, phone, area, gender, created_at";

export interface CreatePatientInput {
  name: string;
  phone: string | null;
  age: number | null;
  area: string | null;
  gender: Gender | null;
  location_id: string; // bigint returned by pg as string
}

// INSERT without patient_code - the DB mints it via the sequence default
// (migration 0004) so the MRN is unique and race-free. RETURN it (and the id) so
// the action can show the assigned code.
export async function createPatient(
  input: CreatePatientInput,
): Promise<{ id: string; patient_code: string }> {
  const { rows } = await pool.query<{ id: string; patient_code: string }>(
    `INSERT INTO patients (name, phone, age, area, gender, location_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, patient_code`,
    [input.name, input.phone, input.age, input.area, input.gender, input.location_id],
  );
  return rows[0];
}

// EXACT phone match, returning ALL rows - the "type a number → list of N patients
// → pick one" lookup. This is the piece the consultation screen (Part 2) reuses;
// duplicates across patients are expected and correct, never deduped.
export async function findPatientsByPhone(phone: string): Promise<PatientRow[]> {
  const { rows } = await pool.query<PatientRow>(
    `SELECT ${COLUMNS}
       FROM patients
      WHERE phone = $1
      ORDER BY name ASC`,
    [phone],
  );
  return rows;
}

// Management-screen search: phone PREFIX, name ILIKE, or patient ID (MRN)
// ILIKE, capped. Ordered by name for a stable list. The table grows large over
// time, so this never returns everything - an empty query returns nothing.
export async function searchPatients(q: string): Promise<PatientRow[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const { rows } = await pool.query<PatientRow>(
    `SELECT ${COLUMNS}
       FROM patients
      WHERE phone LIKE $1 || '%'
         OR name ILIKE '%' || $1 || '%'
         OR patient_code ILIKE '%' || $1 || '%'
      ORDER BY name ASC
      LIMIT 50`,
    [trimmed],
  );
  return rows;
}

// The most recently registered patients - the default view before any search, so
// the screen is useful on arrival (newest first). Small, fixed limit; not a
// substitute for search on the large table.
export async function recentPatients(limit = 10): Promise<PatientRow[]> {
  const { rows } = await pool.query<PatientRow>(
    `SELECT ${COLUMNS}
       FROM patients
      ORDER BY created_at DESC, id DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

// A single patient by id - for prefilling the edit form / detail views.
export async function getPatient(id: string): Promise<PatientRow | null> {
  const { rows } = await pool.query<PatientRow>(
    `SELECT ${COLUMNS} FROM patients WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export interface UpdatePatientInput {
  id: string;
  name: string;
  phone: string | null;
  age: number | null;
  area: string | null;
  gender: Gender | null;
}

// UPDATE the editable details only (never patient_code, location, or created_at).
export async function updatePatient(input: UpdatePatientInput): Promise<void> {
  await pool.query(
    `UPDATE patients
        SET name = $2, phone = $3, age = $4, area = $5, gender = $6
      WHERE id = $1`,
    [input.id, input.name, input.phone, input.age, input.area, input.gender],
  );
}
