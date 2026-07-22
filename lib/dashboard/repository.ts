import { pool } from "@/lib/db";
import { doctorShareSql } from "@/lib/doctors/share";
import { CLINIC_TZ, billCollectedSql, billMoneyInSql, clinicRange, toPaise } from "@/lib/money-in";
import type { MovementKind, MovementStatus } from "./ledger";
import type { DayPoint, DepartmentRow } from "./summary";

// Data access for the admin financial dashboard (the four cards on the admin
// home). Thin: queries only - no money math (that's the pure shaper in ./summary),
// no formatting. Every query is scoped to ONE location + an inclusive clinic-day
// range, and is fully parameterized (never string-interpolated).
//
// "Money in" is DEFINED ONCE, in lib/money-in.ts, and this file and the daily report
// (lib/reports) both call it - so the two screens cannot drift apart again. Read that
// file before touching any sum here. The short version: an advance is collected at
// admit and the balance at discharge, so a stay contributes
//   advance (admit day) + balance_due − refund (discharge day)
// and an IP bill's total_paise is the GROSS bill, which still contains the advance and
// must never be summed as revenue. Voided and pending_approval bills are never money.
//
// Clinic day, not the server day: the timestamptz columns are filtered with the
// half-open instant range [from 00:00 IST, (to+1) 00:00 IST) via the shared
// `clinicRange` predicate - correct regardless of the DB session timezone, and
// index-friendly (no per-row function on the filtered column; migration 0019).

// Money-in per clinic day across [fromDay, toDay], reconciling finalized bills and
// admission advances into one figure per day. Returns only days that saw money -
// the pure shaper (seriesFromRows) zero-fills the gaps. This one query backs the
// Revenue-today card (pick today/yesterday out of the series), its sparkline, and
// the MTD card + its sparkline, so the whole "revenue over time" story is a single
// round-trip per range.
//
// A day's figure can be NEGATIVE if refunds outweigh what was billed - that is real
// (cash left the drawer) and is never clamped away.
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
                ${billMoneyInSql()} AS paise
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

// The earliest clinic day that saw money at this location, or null if none ever has.
// The all-time revenue chart asks for this instead of hardcoding a start date: a magic
// floor silently truncates history (and would hide the ~174k migrated Access rows, all
// of which predate it, under a chart still labelled "all time").
export async function getFirstRevenueDay(locationId: string): Promise<string | null> {
  const { rows } = await pool.query<{ day: string | null }>(
    `SELECT to_char(min(day), 'YYYY-MM-DD') AS day
       FROM (
         SELECT min(created_at AT TIME ZONE '${CLINIC_TZ}')::date AS day
           FROM bills WHERE location_id = $1 AND status = 'final'
         UNION ALL
         SELECT min(admitted_at AT TIME ZONE '${CLINIC_TZ}')::date AS day
           FROM admissions WHERE location_id = $1 AND advance_paid_paise > 0
       ) s`,
    [locationId],
  );
  return rows[0]?.day ?? null;
}

// The doctors' summed cut of consultation money for a clinic-day range - the same
// per-bill rule the daily report uses (lib/doctors/share.ts), priced on what each
// bill collected at each doctor's CURRENT rate (nothing is snapshotted, so editing
// a rate re-prices history - intended for a payout figure). Shown as a DEDUCTION
// from gross revenue (hospital net = revenue − this); it is never part of money-in
// itself, because the cut is still in the drawer and settled with doctors later.
// A legacy consultation bill with no consultation link contributes no share.
export async function getDoctorShareTotal(
  fromDay: string,
  toDay: string,
  locationId: string,
): Promise<number> {
  const { rows } = await pool.query<{ paise: string }>(
    `SELECT COALESCE(sum(${doctorShareSql(billCollectedSql("b"), "d")}), 0)::bigint AS paise
       FROM bills b
       JOIN consultations c ON c.id = b.consultation_id
       JOIN doctors d ON d.id = c.doctor_id
      WHERE b.location_id = $3 AND b.status = 'final' AND b.type = 'consultation'
        AND ${clinicRange("b.created_at", 1, 2)}`,
    [fromDay, toDay, locationId],
  );
  return toPaise(rows[0]?.paise ?? null);
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
            sum(${billMoneyInSql("b")})::bigint AS paise
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

// All in-patient money-in for the range as a single figure: what was collected at
// discharge (balance due, less any refund) PLUS the advances taken at admit. This is
// the one "In-Patient" bucket the department card shows (IP has no per-specialty
// split). Summing the discharge bills' total_paise here instead would count every
// advance twice - see lib/money-in.ts.
export async function getInPatientRevenue(
  fromDay: string,
  toDay: string,
  locationId: string,
): Promise<number> {
  const { rows } = await pool.query<{ paise: string }>(
    `SELECT (
       (SELECT COALESCE(sum(${billMoneyInSql()}), 0)::bigint
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

// Patients admitted RIGHT NOW (not a range - a live census). "How many patients are in
// the hospital" is the one operational fact an admin looks for that no amount of
// revenue history answers. Reads the same indexed columns as everything else here.
export async function getCurrentCensus(locationId: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM admissions
      WHERE location_id = $1 AND status = 'admitted'`,
    [locationId],
  );
  return rows[0]?.count ?? 0;
}

// One row of the admin's money ledger ("Recent invoices"): a bill, or an admission
// advance, whichever moved money most recently. `grossPaise` is signed by the money-in
// rule; the pure shaper (./ledger) decides the label/direction and whether it counted.
export interface MovementRow {
  id: string; // unique across both sources ("bill-12" / "adv-3") - a React key
  kind: MovementKind;
  status: MovementStatus;
  billNumber: string | null; // null for an advance: it never becomes a bill
  at: Date;
  grossPaise: number;
  paymentMode: string | null;
  patientName: string;
  patientCode: string;
  actorName: string | null;
}

// The most recent money movements at a location, newest first. ONE query over both
// places money is recorded, so the ledger cannot miss a source the way a bills-only
// list would (an advance is cash at the counter but never a bill row).
//
// Every status except a never-finalized draft is included: a voided or pending bill IS
// an invoice the admin needs to see, so it is listed and clearly marked rather than
// hidden - the shaper zeroes its effect so it is never mistaken for collected money.
//
// An IP bill contributes balance_due − refund (a refund makes the row NEGATIVE, and it
// must stay negative here - that is cash leaving the drawer, §4). Never total_paise;
// see lib/money-in.ts.
export async function listRecentMovements(
  locationId: string,
  limit = 12,
): Promise<MovementRow[]> {
  const { rows } = await pool.query<{
    id: string;
    kind: MovementKind;
    status: MovementStatus;
    bill_number: string | null;
    at: Date;
    gross_paise: string;
    payment_mode: string | null;
    patient_name: string;
    patient_code: string;
    actor_name: string | null;
  }>(
    `WITH ledger AS (
       SELECT 'bill-' || b.id            AS id,
              b.type                     AS kind,
              b.status                   AS status,
              b.bill_number::text        AS bill_number,
              b.created_at               AS at,
              ${billMoneyInSql("b")}     AS gross_paise,
              b.payment_mode             AS payment_mode,
              b.patient_id               AS patient_id,
              b.created_by               AS created_by
         FROM bills b
        WHERE b.location_id = $1 AND b.status IN ('final', 'pending_approval', 'void')
       UNION ALL
       SELECT 'adv-' || a.id,
              'advance',
              'final',
              NULL,
              a.admitted_at,
              a.advance_paid_paise,
              a.advance_payment_mode,
              a.patient_id,
              a.created_by
         FROM admissions a
        WHERE a.location_id = $1 AND a.advance_paid_paise > 0
     )
     SELECT l.id, l.kind, l.status, l.bill_number, l.at,
            l.gross_paise::text AS gross_paise,
            l.payment_mode,
            p.name         AS patient_name,
            p.patient_code AS patient_code,
            u.name         AS actor_name
       FROM ledger l
       JOIN patients p ON p.id = l.patient_id
       LEFT JOIN users u ON u.id = l.created_by
      ORDER BY l.at DESC
      LIMIT $2`,
    [locationId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    billNumber: r.bill_number,
    at: r.at,
    grossPaise: toPaise(r.gross_paise),
    paymentMode: r.payment_mode,
    patientName: r.patient_name,
    patientCode: r.patient_code,
    actorName: r.actor_name,
  }));
}

// Bills parked in 'pending_approval' at this location, right now. These are the one
// thing on the dashboard that needs the admin to ACT: a bill with an unapproved
// discount cannot finalise, so the money is not collected and the patient is waiting
// (PROJECT_OVERVIEW §6, Discount). Not a range - a live queue depth.
export async function getPendingApprovalCount(locationId: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM bills
      WHERE location_id = $1 AND status = 'pending_approval'`,
    [locationId],
  );
  return rows[0]?.count ?? 0;
}
