import { pool } from "@/lib/db";
import { CLINIC_TZ, clinicInstantWindows, toPaise } from "@/lib/money-in";
import type { DoctorEarningRateRow, DoctorPayoutRow } from "./earnings";
import type { SessionConsult } from "./sessions";

// Data access for the doctor-earnings sheet. Thin: queries only - no money math
// (that is the pure shaper in ./earnings), no formatting beyond the clinic-clock
// strings, which have to be produced by the DB to be in the clinic's timezone.
//
// TWO THINGS THESE QUERIES DELIBERATELY DO NOT DO.
//
// 1. They do not filter on bills.created_by. The subject is the DOCTOR, so which
//    desk user took the money is irrelevant to what the doctor is owed - four
//    consultations billed at one desk and nine at another are simply thirteen. That
//    single omission is what makes the combined figure correct; adding two per-desk
//    sheets together by hand is where the double-counting comes from.
//
// 2. They do not re-price anything. Shares are SUMMED from bills.doctor_share_paise,
//    frozen when each bill was written (migration 0025). A rate raised this evening
//    cannot move a figure paid out this afternoon.
//
// THE WINDOW is a LIST of half-open instant ranges in clinic wall-clock, not a clinic
// DAY and not a single range. A whole day is one window (00:00 → next 00:00); a shift
// is one narrower window; a doctor paid for both of today's sittings at once is TWO
// windows, which is not expressible as a range because the afternoon between them is
// somebody else's work. See lib/date-range.ts and clinicInstantWindows.

export interface EarningsWindow {
  from: string; // 'YYYY-MM-DD HH:MM' clinic wall-clock, inclusive
  to: string; // same, EXCLUSIVE
}

// Flatten windows into query parameters, in the (from, to, from, to, …) order
// clinicInstantWindows reads them.
function windowParams(windows: EarningsWindow[]): string[] {
  return windows.flatMap((w) => [w.from, w.to]);
}

// Common WHERE for both report queries - ONE definition, so the detail list can never
// contain a bill the totals do not, which is exactly the disagreement a doctor
// notices at the counter.
//
// Parameter layout is windows first (2 per window, so their count is dynamic), then
// the fixed scope parameters. `$n::bigint[] IS NULL OR c.doctor_id = ANY($n)` is the
// array form of the `IS NULL OR col = $n` shape used across the reports repository:
// it lets ONE query serve "all doctors", "one doctor" and "these three doctors".
function scopeSql(windows: EarningsWindow[]): {
  sql: string;
  locParam: number;
  docParam: number;
  nextParam: number;
} {
  const locParam = windows.length * 2 + 1;
  const docParam = locParam + 1;
  return {
    sql: `b.location_id = $${locParam}
        AND b.status = 'final'
        AND b.type = 'consultation'
        AND ($${docParam}::bigint[] IS NULL OR c.doctor_id = ANY($${docParam}))
        AND ${clinicInstantWindows("b.created_at", 1, windows.length)}`,
    locParam,
    docParam,
    nextParam: docParam + 1,
  };
}

// Grouped by (doctor × the rate FROZEN on the bill). The rate is part of the group
// key rather than read from `doctors`, so a doctor whose rate changed inside the
// window lands as two rows - the honest reading of a window that was priced two
// ways, instead of one figure that quietly averages two agreements.
export async function getDoctorEarningRows(
  windows: EarningsWindow[],
  locationId: string,
  doctorIds: string[] | null,
): Promise<DoctorEarningRateRow[]> {
  const scope = scopeSql(windows);
  const { rows } = await pool.query<{
    doctor_id: string;
    doctor_name: string;
    department: string | null;
    share_type: string | null;
    share_percentage: number | null;
    share_flat_paise: string | null;
    count: number;
    collected_paise: string;
    share_paise: string;
  }>(
    `SELECT d.id::text AS doctor_id, d.name AS doctor_name, d.department,
            b.doctor_share_type       AS share_type,
            b.doctor_share_percentage AS share_percentage,
            b.doctor_share_flat_paise AS share_flat_paise,
            count(*)::int AS count,
            COALESCE(sum(b.total_paise), 0)::bigint        AS collected_paise,
            COALESCE(sum(b.doctor_share_paise), 0)::bigint AS share_paise
       FROM bills b
       JOIN consultations c ON c.id = b.consultation_id
       JOIN doctors d ON d.id = c.doctor_id
      WHERE ${scope.sql}
      GROUP BY d.id, d.name, d.department, b.doctor_share_type,
               b.doctor_share_percentage, b.doctor_share_flat_paise
      ORDER BY d.name ASC, d.id ASC,
               b.doctor_share_percentage ASC NULLS LAST,
               b.doctor_share_flat_paise ASC NULLS LAST`,
    [...windowParams(windows), locationId, doctorIds],
  );

  return rows.map((r) => ({
    doctorId: r.doctor_id,
    doctorName: r.doctor_name,
    department: r.department,
    shareType: r.share_type,
    sharePercentage: r.share_percentage,
    // Nullable: a legacy bill has an amount but no recorded rate, and passing null
    // through keeps "no rate" distinguishable from a real 0.
    shareFlatPaise: r.share_flat_paise == null ? null : toPaise(r.share_flat_paise),
    count: r.count,
    collectedPaise: toPaise(r.collected_paise),
    sharePaise: toPaise(r.share_paise),
  }));
}

// Which of this window's consultations have ALREADY been settled, grouped by the
// payout that settled them (migration 0026). Same scope as the grouped query, so the
// paid figures can never describe consultations the totals don't contain.
//
// A window can intersect SEVERAL payouts - the morning settled at 2pm, the evening at
// 8pm, and someone now looking at the whole day - so this returns one row per
// (doctor × payout), not a flag.
//
// Voided payouts are excluded via `pb.active`: voiding releases those consultations
// to be paid again, and a sheet that still called them paid would block a payment
// that is genuinely owed.
export async function getDoctorPayoutRows(
  windows: EarningsWindow[],
  locationId: string,
  doctorIds: string[] | null,
): Promise<DoctorPayoutRow[]> {
  const scope = scopeSql(windows);
  const { rows } = await pool.query<{
    doctor_id: string;
    payout_id: string;
    paid_by_name: string;
    paid_at_label: string;
    count: number;
    paise: string;
  }>(
    `SELECT c.doctor_id::text AS doctor_id,
            po.id::text       AS payout_id,
            u.name            AS paid_by_name,
            to_char(po.paid_at AT TIME ZONE '${CLINIC_TZ}', 'FMDD Mon YYYY, FMHH12:MI am') AS paid_at_label,
            count(*)::int AS count,
            COALESCE(sum(b.doctor_share_paise), 0)::bigint AS paise
       FROM bills b
       JOIN consultations c ON c.id = b.consultation_id
       JOIN doctor_payout_bills pb ON pb.bill_id = b.id AND pb.active
       JOIN doctor_payouts po ON po.id = pb.payout_id
       JOIN users u ON u.id = po.paid_by
      WHERE ${scope.sql}
      GROUP BY c.doctor_id, po.id, u.name, po.paid_at
      ORDER BY po.paid_at ASC`,
    [...windowParams(windows), locationId, doctorIds],
  );

  return rows.map((r) => ({
    doctorId: r.doctor_id,
    payoutId: r.payout_id,
    paidByName: r.paid_by_name,
    paidAtLabel: r.paid_at_label,
    count: r.count,
    paise: toPaise(r.paise),
  }));
}

// Record a settlement for ONE doctor over the given windows, covering every
// consultation in them that is not already settled. All or nothing in one
// transaction, and the amount is summed from the same frozen column the sheet showed.
//
// The client sends the WINDOW, never a list of bills or an amount: the set of
// consultations and the money are both re-derived here, so a stale screen or a forged
// payload cannot settle a bill that isn't in the window or pay a figure nobody saw.
//
// Returns null when there is nothing left to settle (someone else got there first) -
// the caller turns that into an honest message rather than writing an empty payout.
//
// RACE: two desks clicking at the same instant both reach the INSERT. The unique index
// doctor_payout_bills_one_active lets exactly one commit; the other violates it and
// rolls back whole, so the same consultation can never sit in two live payouts. The
// error is deliberately allowed to propagate - swallowing it would report a success
// that did not happen.
export async function recordDoctorPayout(input: {
  windows: EarningsWindow[];
  locationId: string;
  doctorId: string;
  coversDay: string;
  coversLabel: string;
  paidBy: string;
}): Promise<{ payoutId: string; count: number; paise: number } | null> {
  const scope = scopeSql(input.windows);
  const params = [...windowParams(input.windows), input.locationId, [input.doctorId]];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // The unsettled consultations in scope, locked for the life of the transaction so
    // a concurrent payout cannot slip one in between the read and the insert.
    const { rows: billRows } = await client.query<{ id: string; share_paise: string }>(
      `SELECT b.id, b.doctor_share_paise AS share_paise
         FROM bills b
         JOIN consultations c ON c.id = b.consultation_id
        WHERE ${scope.sql}
          AND NOT EXISTS (
                SELECT 1 FROM doctor_payout_bills pb
                 WHERE pb.bill_id = b.id AND pb.active)
        ORDER BY b.id
          FOR UPDATE OF b`,
      params,
    );

    if (billRows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const paise = billRows.reduce((s, r) => s + toPaise(r.share_paise), 0);
    const { rows: payoutRows } = await client.query<{ id: string }>(
      `INSERT INTO doctor_payouts
         (doctor_id, location_id, consultation_count, paid_paise, covers_day, covers_label, paid_by)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7)
       RETURNING id`,
      [
        input.doctorId,
        input.locationId,
        billRows.length,
        paise,
        input.coversDay,
        input.coversLabel,
        input.paidBy,
      ],
    );
    const payoutId = payoutRows[0].id;

    await client.query(
      `INSERT INTO doctor_payout_bills (payout_id, bill_id)
       SELECT $1, unnest($2::bigint[])`,
      [payoutId, billRows.map((r) => r.id)],
    );

    await client.query("COMMIT");
    return { payoutId, count: billRows.length, paise };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Every consultation ONE doctor was billed for across a WHOLE clinic day, as
// (minute, frozen cut) pairs for the pure session detector.
//
// Deliberately independent of the report's applied window: the session strip must
// keep showing every sitting of the day even while the sheet is narrowed to one of
// them, or selecting a session would hide the others and you could never switch.
// Minute resolution matches the window format, and truncation is safe in both
// directions - a bill at 13:55:30 reads as 13:55 and still falls inside the
// half-open [.., 13:56) bound the detector derives from it.
export async function getDoctorDayConsults(
  day: string,
  locationId: string,
  doctorId: string,
): Promise<SessionConsult[]> {
  // Every parameter below is REFERENCED by the SQL. Passing an extra one that the
  // query never mentions is not harmless: Postgres cannot infer its type and rejects
  // the whole statement with "could not determine data type of parameter $n".
  const { rows } = await pool.query<{ at: string; share_paise: string }>(
    `SELECT to_char(b.created_at AT TIME ZONE '${CLINIC_TZ}', 'YYYY-MM-DD HH24:MI') AS at,
            b.doctor_share_paise AS share_paise
       FROM bills b
       JOIN consultations c ON c.id = b.consultation_id
      WHERE b.location_id = $1 AND b.status = 'final' AND b.type = 'consultation'
        AND c.doctor_id = $2
        AND ${clinicInstantWindows("b.created_at", 3, 1)}
      ORDER BY b.created_at ASC`,
    [locationId, doctorId, `${day} 00:00`, nextDayMidnight(day)],
  );
  return rows.map((r) => ({ at: r.at, sharePaise: toPaise(r.share_paise) }));
}

// The exclusive upper bound of a clinic day. Not "23:59": a bill written at 23:59:30
// is real money and must land inside the day it was taken.
function nextDayMidnight(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.toISOString().slice(0, 10)} 00:00`;
}

// Every doctor at a location, for the report's doctor picker. Includes inactive
// doctors: they may have consulted before being deactivated, so past windows must
// stay reportable. Ordered by name for a stable, muscle-memory list.
export interface EarningsDoctorOption {
  id: string;
  name: string;
  department: string | null;
  active: boolean;
}

export async function listEarningsDoctors(locationId: string): Promise<EarningsDoctorOption[]> {
  const { rows } = await pool.query<EarningsDoctorOption>(
    `SELECT id::text AS id, name, department, active
       FROM doctors
      WHERE location_id = $1
      ORDER BY name ASC`,
    [locationId],
  );
  return rows;
}
