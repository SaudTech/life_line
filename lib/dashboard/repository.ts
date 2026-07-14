import { pool } from "@/lib/db";
import type { DayPoint, DepartmentRow } from "./summary";

// Data access for the admin financial dashboard (the four cards on the admin
// home). Thin: queries only - no money math (that's the pure shaper in ./summary),
// no formatting. Every query is scoped to ONE location + an inclusive clinic-day
// range, and is fully parameterized (never string-interpolated).
//
// "Money in" is reconciled from the SAME two sources as the daily report
// (lib/reports): finalized bills (bills.total_paise, status='final') PLUS admission
// advances (admissions.advance_paid_paise), which are collected at admit time and
// never become a bill row. Voided and pending_approval bills are never revenue.
//
// Clinic day, not the server day: the timestamptz columns are filtered with the
// half-open instant range [from 00:00 IST, (to+1) 00:00 IST) via the same
// `clinicRange` predicate the report uses - correct regardless of the DB session
// timezone, and index-friendly (no per-row function on the filtered column).

const CLINIC_TZ = "Asia/Kolkata";

// The half-open clinic-day range predicate for a timestamptz column, using the
// given 1-based parameter indices for the inclusive from/to ISO days. Mirrors
// lib/reports/repository.ts so both screens reckon a clinic day identically.
function clinicRange(col: string, fromParam: number, toParam: number): string {
  return `${col} >= ($${fromParam}::date)::timestamp AT TIME ZONE '${CLINIC_TZ}'
      AND ${col} <  (($${toParam}::date + 1))::timestamp AT TIME ZONE '${CLINIC_TZ}'`;
}

// Read a BIGINT sum pg returns as text into an integer. A location's daily/monthly
// totals are far below Number.MAX_SAFE_INTEGER, so this stays exact (only bridging
// pg's text BIGINT into JS - never a float in the money path, §1).
function toPaise(v: string | null): number {
  return v == null ? 0 : Number(v);
}

// Money-in per clinic day across [fromDay, toDay], reconciling finalized bills and
// admission advances into one figure per day. Returns only days that saw money -
// the pure shaper (seriesFromRows) zero-fills the gaps. This one query backs the
// Revenue-today card (pick today/yesterday out of the series), its sparkline, and
// the MTD card + its sparkline, so the whole "revenue over time" story is a single
// round-trip per range.
//
// The clinic-day GROUP key uses `AT TIME ZONE` on the already-range-filtered rows;
// the range predicate itself stays on the raw column, so the index is still used.
export async function getRevenueByDay(
  fromDay: string,
  toDay: string,
  locationId: string,
): Promise<DayPoint[]> {
  const { rows } = await pool.query<{ day: string; paise: string }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, sum(paise)::bigint AS paise
       FROM (
         SELECT (created_at AT TIME ZONE '${CLINIC_TZ}')::date AS day,
                total_paise AS paise
           FROM bills
          WHERE location_id = $3 AND status = 'final'
            AND ${clinicRange("created_at", 1, 2)}
         UNION ALL
         SELECT (admitted_at AT TIME ZONE '${CLINIC_TZ}')::date AS day,
                advance_paid_paise AS paise
           FROM admissions
          WHERE location_id = $3 AND advance_paid_paise > 0
            AND ${clinicRange("admitted_at", 1, 2)}
       ) s
      GROUP BY day
      ORDER BY day`,
    [fromDay, toDay, locationId],
  );
  return rows.map((r) => ({ day: r.day, paise: toPaise(r.paise) }));
}

// Distinct patient counts for a clinic-day range, split OP vs IP. OP = patients
// with a consultation/procedure bill; IP = patients admitted in the range. `total`
// is the DISTINCT union (a patient seen at the OP desk and admitted the same day
// counts once), so it is not necessarily op + ip.
export interface PatientCounts {
  total: number;
  op: number;
  ip: number;
}

export async function getPatientCounts(
  fromDay: string,
  toDay: string,
  locationId: string,
): Promise<PatientCounts> {
  const { rows } = await pool.query<{ total: number; op: number; ip: number }>(
    `WITH op AS (
        SELECT DISTINCT patient_id
          FROM bills
         WHERE location_id = $3 AND status = 'final'
           AND type IN ('consultation', 'procedure')
           AND ${clinicRange("created_at", 1, 2)}
      ), ip AS (
        SELECT DISTINCT patient_id
          FROM admissions
         WHERE location_id = $3
           AND ${clinicRange("admitted_at", 1, 2)}
      )
      SELECT (SELECT count(*) FROM op)::int AS op,
             (SELECT count(*) FROM ip)::int AS ip,
             (SELECT count(*) FROM (
                SELECT patient_id FROM op
                UNION
                SELECT patient_id FROM ip
             ) u)::int AS total`,
    [fromDay, toDay, locationId],
  );
  const r = rows[0];
  return { total: r?.total ?? 0, op: r?.op ?? 0, ip: r?.ip ?? 0 };
}

// Consultation + procedure revenue grouped by the CONSULTING doctor's department.
// Both bill types carry consultation_id (consultation bills since migration 0006,
// procedure bills natively), so both resolve department via consultation -> doctor.
// A procedure billed against no consultation, or a doctor with no department, falls
// into "Unassigned". In-patient revenue is NOT here - it has no department in the
// data model and is fetched separately as one bucket (getInPatientRevenue).
export async function getDepartmentRevenue(
  fromDay: string,
  toDay: string,
  locationId: string,
): Promise<DepartmentRow[]> {
  const { rows } = await pool.query<{ department: string; paise: string }>(
    `SELECT COALESCE(d.department, 'Unassigned') AS department,
            sum(b.total_paise)::bigint AS paise
       FROM bills b
       LEFT JOIN consultations c ON c.id = b.consultation_id
       LEFT JOIN doctors d ON d.id = c.doctor_id
      WHERE b.location_id = $3 AND b.status = 'final'
        AND b.type IN ('consultation', 'procedure')
        AND ${clinicRange("b.created_at", 1, 2)}
      GROUP BY COALESCE(d.department, 'Unassigned')`,
    [fromDay, toDay, locationId],
  );
  return rows.map((r) => ({ department: r.department, paise: toPaise(r.paise) }));
}

// All in-patient revenue for the range as a single figure: finalized discharge
// bills (type='ip') PLUS admission advances taken in the range. This is the one
// "In-Patient" bucket the department card shows (IP has no per-specialty split).
export async function getInPatientRevenue(
  fromDay: string,
  toDay: string,
  locationId: string,
): Promise<number> {
  const { rows } = await pool.query<{ paise: string }>(
    `SELECT (
       (SELECT COALESCE(sum(total_paise), 0)::bigint
          FROM bills
         WHERE location_id = $3 AND status = 'final' AND type = 'ip'
           AND ${clinicRange("created_at", 1, 2)})
       +
       (SELECT COALESCE(sum(advance_paid_paise), 0)::bigint
          FROM admissions
         WHERE location_id = $3 AND advance_paid_paise > 0
           AND ${clinicRange("admitted_at", 1, 2)})
     ) AS paise`,
    [fromDay, toDay, locationId],
  );
  return toPaise(rows[0]?.paise ?? null);
}
