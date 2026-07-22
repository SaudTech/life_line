import { pool } from "@/lib/db";

// Data access for the departments master list (migration 0020). Thin: each
// function is one query and nothing more - no validation, no business rules
// (those live in the schema and the actions).

export interface DepartmentRow {
  id: string;
  name: string;
  created_at: Date;
}

// Every department at a location - existence IS "active" here (no soft-delete
// column; see migration 0020's note on why a plain DELETE is safe). Ordered by
// name for a stable, muscle-memory list.
export async function listDepartments(locationId: string): Promise<DepartmentRow[]> {
  const { rows } = await pool.query<DepartmentRow>(
    `SELECT id, name, created_at
       FROM departments
      WHERE location_id = $1
      ORDER BY name ASC`,
    [locationId],
  );
  return rows;
}

export interface CreateDepartmentInput {
  name: string;
  location_id: string; // bigint returned by pg as string
}

export async function createDepartment(
  input: CreateDepartmentInput,
): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO departments (name, location_id)
     VALUES ($1, $2)
     RETURNING id`,
    [input.name, input.location_id],
  );
  return rows[0];
}

// No FK references a department (doctors.department is plain denormalized TEXT,
// migration 0016) - a hard delete can never orphan anything or change what an
// existing doctor's row reads back, so unlike services there is no trash/retention
// step here.
export async function deleteDepartment(id: string): Promise<void> {
  await pool.query(`DELETE FROM departments WHERE id = $1`, [id]);
}
