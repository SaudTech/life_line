import { pool } from "@/lib/db";

// Data access for the suggestions box (migration 0022). Thin: each function is
// one query and nothing more - no validation, no business rules (those live in
// the schema and the actions).

export interface CreateSuggestionInput {
  message: string;
  page_path: string | null;
  user_id: string | null;
  location_id: string; // bigint returned by pg as string
}

export async function createSuggestion(
  input: CreateSuggestionInput,
): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO suggestions (message, page_path, user_id, location_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [input.message, input.page_path, input.user_id, input.location_id],
  );
  return rows[0];
}

// The row shape sent to the admin list - who (if resolvable) said what, from
// where, and when. Newest first so the most recent notes need no scrolling.
export interface SuggestionRow {
  id: string;
  message: string;
  page_path: string | null;
  user_name: string | null;
  user_role: string | null;
  created_at: Date;
}

export async function listSuggestions(): Promise<SuggestionRow[]> {
  const { rows } = await pool.query<SuggestionRow>(
    `SELECT s.id, s.message, s.page_path, u.name AS user_name, u.role AS user_role, s.created_at
       FROM suggestions s
       LEFT JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC`,
  );
  return rows;
}
