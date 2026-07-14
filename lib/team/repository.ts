import { pool } from "@/lib/db";
import type { Role } from "@/lib/users/schema";

// Data access for the supervisor's "My team" dashboard: the staff who report to a
// given supervisor (users.supervisor_id = them), each with a few at-a-glance
// figures for the current clinic day. Thin - one query, no money math or
// formatting (the page formats; the amounts are exact integer paise here).
//
// Scoped to the supervisor's own location, and the day figures use the same
// half-open clinic-day range as the daily report (Asia/Kolkata boundary, computed
// in SQL so it's correct regardless of the DB session timezone and index-friendly).

export interface TeamMemberRow {
  id: string;
  name: string;
  role: Role;
  phone: string;
  active: boolean;
  has_pin: boolean;
  // Today's figures, attributed the same way the daily report attributes them:
  // collected = this member's FINAL bills; actions = their audit-log entries.
  collected_paise: string; // BIGINT as text; a single day stays exact as Number()
  bill_count: number;
  action_count: number;
}

// One row per FINAL bill created today by a member of the supervisor's team - the
// list behind the "Bills today" figure, so the count and the list always agree.
// Includes who created it and the patient, so the supervisor can scan and open any
// one. Newest first. A bill is "opened" by its receipt PDF (the app's canonical
// bill view), keyed by id.
export interface TeamBillRow {
  id: string;
  bill_number: string;
  type: "consultation" | "procedure" | "ip";
  total_paise: string; // BIGINT as text
  payment_mode: string | null;
  time_label: string; // clinic-tz time of day
  patient_name: string;
  patient_code: string;
  staff_name: string;
}

export async function getSupervisorTeamBills(
  supervisorId: string,
  locationId: string,
  dayIso: string,
): Promise<TeamBillRow[]> {
  const { rows } = await pool.query<TeamBillRow>(
    `SELECT b.id::text, b.bill_number::text, b.type,
            b.total_paise::text, b.payment_mode,
            to_char(b.created_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS time_label,
            p.name          AS patient_name,
            p.patient_code,
            u.name          AS staff_name
       FROM bills b
       JOIN users u    ON u.id = b.created_by
       JOIN patients p ON p.id = b.patient_id
      WHERE u.supervisor_id = $1
        AND b.location_id = $2
        AND b.status = 'final'
        AND b.created_at >= ($3::date)::timestamp AT TIME ZONE 'Asia/Kolkata'
        AND b.created_at <  (($3::date + 1))::timestamp AT TIME ZONE 'Asia/Kolkata'
      ORDER BY b.created_at DESC`,
    [supervisorId, locationId, dayIso],
  );
  return rows;
}

export async function getSupervisorTeam(
  supervisorId: string,
  locationId: string,
  dayIso: string,
): Promise<TeamMemberRow[]> {
  const { rows } = await pool.query<TeamMemberRow>(
    `SELECT u.id, u.name, u.role, u.phone, u.active,
            (u.pin_hash IS NOT NULL)                       AS has_pin,
            COALESCE(b.collected_paise, 0)::bigint         AS collected_paise,
            COALESCE(b.bill_count, 0)::int                 AS bill_count,
            COALESCE(a.action_count, 0)::int               AS action_count
       FROM users u
       LEFT JOIN (
         SELECT created_by, sum(total_paise) AS collected_paise, count(*) AS bill_count
           FROM bills
          WHERE location_id = $2 AND status = 'final'
            AND created_at >= ($3::date)::timestamp AT TIME ZONE 'Asia/Kolkata'
            AND created_at <  (($3::date + 1))::timestamp AT TIME ZONE 'Asia/Kolkata'
          GROUP BY created_by
       ) b ON b.created_by = u.id
       LEFT JOIN (
         SELECT user_id, count(*) AS action_count
           FROM audit_log
          WHERE (location_id = $2 OR location_id IS NULL)
            AND at >= ($3::date)::timestamp AT TIME ZONE 'Asia/Kolkata'
            AND at <  (($3::date + 1))::timestamp AT TIME ZONE 'Asia/Kolkata'
          GROUP BY user_id
       ) a ON a.user_id = u.id
      WHERE u.supervisor_id = $1 AND u.location_id = $2
      ORDER BY u.active DESC, u.name ASC`,
    [supervisorId, locationId, dayIso],
  );
  return rows;
}
