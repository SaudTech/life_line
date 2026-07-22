import { pool } from "@/lib/db";
import type { IsoDay } from "@/lib/consultations/rules";
import { doctorShareSql } from "@/lib/doctors/share";
import { billCollectedSql, clinicRange, toPaise } from "@/lib/money-in";
import {
  emptyMoneyRaw,
  type ActivityCountRow,
  type DoctorShareRow,
  type MoneyGroupRow,
  type MoneyRaw,
} from "./summary";

// Data access for the daily report (plan §4). Thin: the queries only - no money
// math (that's the pure shaper in ./summary), no formatting. Every query is scoped
// to ONE location + an inclusive clinic-day range, and is fully parameterized
// (never string-interpolated).
//
// `userId` selects the SCOPE: a UUID reports on just that user (created_by /
// actor_id / voided_by / discount_approved_by = them - the self report), while
// `null` aggregates the WHOLE hospital (every staff member at the location - the
// admin day-close). The action decides which: non-admins are forced to their own
// session.sub (§6), only an admin may pass null (server-enforced, §8). The `$1::uuid
// IS NULL OR col = $1` shape lets one query serve both scopes without splitting it.
//
// Clinic day, not the server day: `at`/`created_at`/… are timestamptz. A clinic
// day [from, to] becomes the half-open instant range
//   [ from 00:00 IST , (to + 1) 00:00 IST )
// built with `AT TIME ZONE 'Asia/Kolkata'` so the boundary is correct regardless
// of the DB session timezone, and index-friendly (no per-row function on the column).
// `clinicRange` and the money-in expression both come from lib/money-in.ts - the ONE
// definition this screen and the admin dashboard share, so they cannot report
// different totals for the same day (they used to; see migration 0018).

// Counts of meaningful actions in the range (the activity summary, §3A). Grouped by
// action tag; the shaper keeps only the curated, unambiguous tags and labels them
// from the canonical registry. `userId` null → the whole hospital's actions.
// Location-scoped, but tolerant of the rare pre-location audit row.
export async function getActivityCounts(
  userId: string | null,
  fromDay: IsoDay,
  toDay: IsoDay,
  locationId: string,
): Promise<ActivityCountRow[]> {
  const { rows } = await pool.query<ActivityCountRow>(
    `SELECT action, count(*)::int AS count
       FROM audit_log
      WHERE ($1::uuid IS NULL OR user_id = $1)
        AND (location_id = $4 OR location_id IS NULL)
        AND ${clinicRange("at", 2, 3)}
      GROUP BY action`,
    [userId, fromDay, toDay, locationId],
  );
  return rows;
}

// The full money summary for the day (§3B), as raw grouped rows for the pure
// shaper. Figures are attributed by column: revenue by created_by (final only),
// discounts approved by discount_approved_by, voids by voided_by, advance deposits
// by admissions.created_by. Voids are keyed on voided_at (when it was voided), not
// created_at - so a bill made another day but voided today counts here. `userId`
// null → the whole hospital (all staff), for the admin day-close.
export async function getMoneySummary(
  userId: string | null,
  fromDay: IsoDay,
  toDay: IsoDay,
  locationId: string,
): Promise<MoneyRaw> {
  const args = [userId, fromDay, toDay, locationId];

  // My FINALIZED bills, grouped by type and (separately) by payment mode. Only
  // status='final' is collected money - a 'pending_approval' bill isn't settled yet,
  // and 'void' isn't revenue - so neither belongs in the reconciliation total (§3).
  // A finalized bill always has a mode, but COALESCE guards a stray null so its
  // money never silently drops out of the by-mode line.
  //
  // These are COLLECTED figures, so an IP bill contributes the balance taken at
  // discharge, not its gross total (which still contains the advance that this sheet
  // already lists under advancesByMode). This sheet is a CASH HANDOVER: every line
  // must be money that passed through the drawer on this clinic day, or the count
  // won't tie out at close (lib/money-in.ts).
  //
  // billCollectedSql, NOT billMoneyInSql: money TAKEN only. A refund is cash going the
  // other way and gets its own subtracted line on the sheet (shapeDailyReport), because
  // netting it in here made an IP row read "-₹2,000" for a stay that was billed ₹18,000
  // against a ₹20,000 advance. The day's money-in is identical either way.
  const billsByType = pool.query<{ key: string; count: number; total_paise: string }>(
    `SELECT type AS key, count(*)::int AS count,
            COALESCE(sum(${billCollectedSql()}), 0)::bigint AS total_paise
       FROM bills
      WHERE ($1::uuid IS NULL OR created_by = $1) AND location_id = $4 AND status = 'final'
        AND ${clinicRange("created_at", 2, 3)}
      GROUP BY type`,
    args,
  );
  const billsByMode = pool.query<{ key: string; count: number; total_paise: string }>(
    `SELECT COALESCE(payment_mode, 'other') AS key, count(*)::int AS count,
            COALESCE(sum(${billCollectedSql()}), 0)::bigint AS total_paise
       FROM bills
      WHERE ($1::uuid IS NULL OR created_by = $1) AND location_id = $4 AND status = 'final'
        AND ${clinicRange("created_at", 2, 3)}
      GROUP BY COALESCE(payment_mode, 'other')`,
    args,
  );

  // Total discount value on the scoped finalized bills.
  const discountMine = pool.query<{ total_paise: string }>(
    `SELECT COALESCE(sum(discount_paise), 0)::bigint AS total_paise
       FROM bills
      WHERE ($1::uuid IS NULL OR created_by = $1) AND location_id = $4 AND status = 'final'
        AND discount_paise > 0
        AND ${clinicRange("created_at", 2, 3)}`,
    args,
  );

  // Discounts APPROVED (supervisor) - counted by discount_approved_by even when the
  // approver didn't create the bill, and the revenue is NOT re-attributed to them (§7).
  const discountsApproved = pool.query<{ count: number; total_paise: string }>(
    `SELECT count(*)::int AS count,
            COALESCE(sum(discount_paise), 0)::bigint AS total_paise
       FROM bills
      WHERE ($1::uuid IS NULL OR discount_approved_by = $1) AND location_id = $4 AND status = 'final'
        AND discount_paise > 0
        AND ${clinicRange("created_at", 2, 3)}`,
    args,
  );

  // Bills voided today - shown separately, excluded from collected (§7).
  const voids = pool.query<{ count: number; total_paise: string }>(
    `SELECT count(*)::int AS count,
            COALESCE(sum(total_paise), 0)::bigint AS total_paise
       FROM bills
      WHERE ($1::uuid IS NULL OR voided_by = $1) AND location_id = $4 AND status = 'void'
        AND ${clinicRange("voided_at", 2, 3)}`,
    args,
  );

  // The doctor's cut of the scoped consultation bills, grouped per doctor. The
  // per-bill share comes from the ONE tested rule (lib/doctors/share.ts), priced
  // on what each bill COLLECTED and at the doctor's CURRENT rate (nothing is
  // snapshotted). A legacy bill with consultation_id NULL drops out of the join -
  // its money simply stays with the hospital in the shaper's remainder. The rate
  // columns ride along so the sheet can say how each figure was arrived at.
  const doctorShares = pool.query<{
    doctor_id: string;
    doctor_name: string;
    share_type: string;
    share_percentage: number;
    share_flat_paise: string | null;
    count: number;
    share_paise: string;
  }>(
    `SELECT d.id::text AS doctor_id, d.name AS doctor_name,
            d.share_type, d.share_percentage, d.share_flat_paise,
            count(*)::int AS count,
            COALESCE(sum(${doctorShareSql(billCollectedSql("b"), "d")}), 0)::bigint AS share_paise
       FROM bills b
       JOIN consultations c ON c.id = b.consultation_id
       JOIN doctors d ON d.id = c.doctor_id
      WHERE ($1::uuid IS NULL OR b.created_by = $1) AND b.location_id = $4
        AND b.status = 'final' AND b.type = 'consultation'
        AND ${clinicRange("b.created_at", 2, 3)}
      GROUP BY d.id, d.name, d.share_type, d.share_percentage, d.share_flat_paise
      ORDER BY d.name ASC, d.id ASC`,
    args,
  );

  // Admission deposits taken today, split by how the advance was tendered. Only real
  // deposits (advance > 0) - a ₹0 admission held no money to reconcile.
  const advancesByMode = pool.query<{ key: string; count: number; total_paise: string }>(
    `SELECT COALESCE(advance_payment_mode, 'other') AS key, count(*)::int AS count,
            COALESCE(sum(advance_paid_paise), 0)::bigint AS total_paise
       FROM admissions
      WHERE ($1::uuid IS NULL OR created_by = $1) AND location_id = $4 AND advance_paid_paise > 0
        AND ${clinicRange("admitted_at", 2, 3)}
      GROUP BY COALESCE(advance_payment_mode, 'other')`,
    args,
  );

  // Refunds handed back at discharge (advance > final total). Cash leaving the drawer
  // is already netted out of the by-mode lines above, so it is NOT subtracted again
  // here - this is the visible record of an outflow that previously existed only
  // inside an audit_log JSON blob, invisible to every screen (§4, never silently
  // dropped).
  const refunds = pool.query<{ count: number; total_paise: string }>(
    `SELECT count(*)::int AS count,
            COALESCE(sum(refund_paise), 0)::bigint AS total_paise
       FROM bills
      WHERE ($1::uuid IS NULL OR created_by = $1) AND location_id = $4 AND status = 'final'
        AND refund_paise > 0
        AND ${clinicRange("created_at", 2, 3)}`,
    args,
  );

  const [bt, bm, dm, da, vo, ds, av, rf] = await Promise.all([
    billsByType,
    billsByMode,
    discountMine,
    discountsApproved,
    voids,
    doctorShares,
    advancesByMode,
    refunds,
  ]);

  const toGroup = (r: { key: string; count: number; total_paise: string }): MoneyGroupRow => ({
    key: r.key,
    count: r.count,
    totalPaise: toPaise(r.total_paise),
  });

  return {
    ...emptyMoneyRaw(),
    billsByType: bt.rows.map(toGroup),
    billsByMode: bm.rows.map(toGroup),
    discountOnMyBillsPaise: toPaise(dm.rows[0]?.total_paise ?? null),
    discountsApproved: {
      count: da.rows[0]?.count ?? 0,
      totalPaise: toPaise(da.rows[0]?.total_paise ?? null),
    },
    voids: {
      count: vo.rows[0]?.count ?? 0,
      totalPaise: toPaise(vo.rows[0]?.total_paise ?? null),
    },
    doctorShares: ds.rows.map(
      (r): DoctorShareRow => ({
        doctorId: r.doctor_id,
        doctorName: r.doctor_name,
        shareType: r.share_type,
        sharePercentage: r.share_percentage,
        shareFlatPaise: toPaise(r.share_flat_paise),
        count: r.count,
        sharePaise: toPaise(r.share_paise),
      }),
    ),
    advancesByMode: av.rows.map(toGroup),
    refunds: {
      count: rf.rows[0]?.count ?? 0,
      totalPaise: toPaise(rf.rows[0]?.total_paise ?? null),
    },
  };
}

// Viewer context for a self-describing printed sheet (§3C): the signed-in user's
// own name (who generated it), plus their location's hospital name (the profile
// name, falling back to the location name - the same COALESCE the receipts use) and
// location id (the scope every query is bound to). Null if the viewer row is gone.
export interface ReportContext {
  viewerName: string;
  hospitalName: string;
  locationId: string;
}

export async function getReportContext(viewerId: string): Promise<ReportContext | null> {
  const { rows } = await pool.query<ReportContext>(
    `SELECT u.name                         AS "viewerName",
            COALESCE(hp.name, l.name)       AS "hospitalName",
            u.location_id::text             AS "locationId"
       FROM users u
       JOIN locations l ON l.id = u.location_id
       LEFT JOIN hospital_profile hp ON hp.location_id = u.location_id
      WHERE u.id = $1`,
    [viewerId],
  );
  return rows[0] ?? null;
}

// Resolve the SUBJECT of a report - the staff member an admin picked to report on -
// but ONLY within the viewer's own location. Returning null for a user who isn't at
// this location is the guard that an admin can't report across branches (and that a
// bogus/forged id resolves to nothing), enforced server-side (§8). Role is returned
// so the header can title the sheet with that person's role.
export interface SubjectUser {
  id: string;
  name: string;
  role: string;
}

export async function getSubjectUser(
  userId: string,
  locationId: string,
): Promise<SubjectUser | null> {
  const { rows } = await pool.query<SubjectUser>(
    `SELECT id, name, role
       FROM users
      WHERE id = $1 AND location_id = $2`,
    [userId, locationId],
  );
  return rows[0] ?? null;
}

// Every staff member at a location, for the admin's report subject picker. Includes
// deactivated accounts (they may have transacted before being deactivated, so their
// past days must still be viewable), each flagged so the picker can mark them.
// Ordered by name for a stable, muscle-memory list.
export interface ReportableStaff {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

export async function listReportableStaff(locationId: string): Promise<ReportableStaff[]> {
  const { rows } = await pool.query<ReportableStaff>(
    `SELECT id, name, role, active
       FROM users
      WHERE location_id = $1
      ORDER BY name ASC`,
    [locationId],
  );
  return rows;
}
