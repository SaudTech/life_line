"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/dal";
import { logActivity } from "@/lib/audit";
import {
  clinicToday,
  dayWindow,
  isValidClinicTime,
  rangeWindow,
  shiftWindow,
} from "@/lib/date-range";
import type { ActionResult } from "@/lib/forms/action-result";
import { formatPaise } from "@/lib/money";
import { getReportContext } from "@/lib/reports/repository";
import {
  getDoctorDayConsults,
  getDoctorEarningRows,
  getDoctorPayoutRows,
  recordDoctorPayout,
  type EarningsWindow,
} from "./earnings-repository";
import {
  NO_RATE_LABEL,
  rateLineKey,
  shapeDoctorEarnings,
  type DoctorEarningsResult,
  type EarningsInput,
  type EarningsMeta,
} from "./earnings";
import {
  clockLabel,
  detectSessions,
  MAX_GAP_MINUTES,
  MIN_GAP_MINUTES,
  type GapMode,
} from "./sessions";
import { describeShareRate } from "./share";

// The doctor-earnings actions - "what has this doctor got coming for these windows,
// across the whole counter", and "record that it has been handed over".
//
// ACCESS (server-enforced, dev-rules §8): ANY signed-in staff member, scoped to
// their own location. This is a deliberate departure from the daily report, where a
// non-admin is pinned to their own transactions. The reason is operational: the
// doctor is standing at the counter asking for their money, and whichever desk user
// is on shift has to be able to produce the figure AND settle it. It means a desk
// user can see numbers outside their own day - that is the intended trade, not an
// oversight. Location scoping is NOT relaxed: `locationId` comes from the session's
// own user row, never from the client, so no branch can be reported on from another.
//
// THE WINDOW IS A LIST. A whole day is one window; a shift is one narrower window;
// a doctor paid for both of today's sittings at once is TWO windows, which is not a
// range because the afternoon between them is somebody else's work.
//
// SESSIONS are detected (lib/doctors/sessions.ts) only when EXACTLY ONE doctor is
// selected and the report covers a single day. Shifts are per-doctor, and the sheet's
// masthead names one set of windows - offering sessions for three doctors at once
// would mean a header that cannot honestly say what it covers.

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DOCTOR_ID = /^\d+$/;
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/;

// Bounds the OR-chain in the query. Far above any real day's sittings - a doctor
// with more than a dozen detected sessions has a gap threshold problem, not a
// reporting one.
const MAX_WINDOWS = 12;

// ── Shared window resolution ──────────────────────────────────────────────────
// ONE definition of "what does this input cover", used by BOTH actions. If the report
// and the settlement resolved windows even slightly differently, a desk could settle
// consultations the sheet in front of them never showed - the single most expensive
// bug this feature could have.
interface Resolved {
  day: string;
  isMultiDay: boolean;
  windows: EarningsWindow[];
  windowKind: EarningsMeta["windowKind"];
  windowLabels: string[];
  doctorIds: string[];
  gapMode: GapMode;
}

function resolveInput(input: EarningsInput): Resolved | { error: string } {
  const day = input.day?.trim() || clinicToday();
  if (!ISO_DAY.test(day)) return { error: "Pick a valid date." };

  const toDay = input.toDay?.trim() || "";
  if (toDay && !ISO_DAY.test(toDay)) return { error: "Pick a valid end date." };
  if (toDay && toDay < day) return { error: "The end date cannot be before the start date." };
  const isMultiDay = Boolean(toDay) && toDay !== day;

  // Ids are validated to digits even though every query is parameterized: a malformed
  // id should be a clear error, not a silently empty payout sheet.
  const doctorIds = (input.doctorIds ?? []).map((id) => id.trim()).filter(Boolean);
  if (doctorIds.some((id) => !DOCTOR_ID.test(id))) {
    return { error: "Unrecognised doctor selection." };
  }

  // Explicit windows (the session strip) win over the shift fields, which win over the
  // day/range. Exactly one of the three decides the sheet, so the masthead can always
  // name what it covers.
  const explicit = input.windows ?? [];
  const startTime = input.startTime?.trim() || "";
  const endTime = input.endTime?.trim() || "";
  const wantsShift = Boolean(startTime || endTime);

  let windows: EarningsWindow[];
  let windowKind: EarningsMeta["windowKind"];

  if (explicit.length > 0) {
    if (explicit.length > MAX_WINDOWS) {
      return { error: `Select at most ${MAX_WINDOWS} sessions at a time.` };
    }
    for (const w of explicit) {
      if (!WALL_CLOCK.test(w.from) || !WALL_CLOCK.test(w.to) || w.to <= w.from) {
        return { error: "That session selection is not valid." };
      }
    }
    windows = explicit.map((w) => ({ from: w.from, to: w.to }));
    windowKind = "sessions";
  } else if (wantsShift) {
    if (!isValidClinicTime(startTime) || !isValidClinicTime(endTime)) {
      return { error: "Enter both shift times as HH:MM (24-hour)." };
    }
    if (isMultiDay) {
      // A shift is a slice of ONE day. Silently ignoring one of the two inputs would
      // produce a sheet whose masthead disagrees with the figures under it.
      return { error: "A shift window covers a single day - clear the end date." };
    }
    windows = [shiftWindow(day, startTime, endTime)];
    windowKind = "shift";
  } else if (isMultiDay) {
    windows = [rangeWindow({ dateFrom: day, dateTo: toDay })];
    windowKind = "range";
  } else {
    windows = [dayWindow(day)];
    windowKind = "day";
  }

  return {
    day,
    isMultiDay,
    windows,
    windowKind,
    // Every window the sheet covers, worded. A payout slip that cannot name its own
    // periods is how the same shift gets paid twice.
    windowLabels: windows.map((w) => `${clockLabel(w.from)} to ${clockLabel(w.to)}`),
    doctorIds,
    gapMode: resolveGapMode(input),
  };
}

// ── The report ────────────────────────────────────────────────────────────────
export async function generateDoctorEarningsAction(
  input: EarningsInput,
): Promise<ActionResult<DoctorEarningsResult>> {
  const session = await requireSession();

  const r = resolveInput(input);
  if ("error" in r) return { ok: false, formError: r.error };

  // Location comes from the viewer's OWN user row, never from the client - the one
  // scope guard that keeps a branch's figures inside that branch (§8).
  const ctx = await getReportContext(session.sub);
  if (!ctx) {
    return { ok: false, formError: "Could not resolve your account. Please sign in again." };
  }

  const filter = r.doctorIds.length > 0 ? r.doctorIds : null;
  const sessionsDoctorId = r.doctorIds.length === 1 && !r.isMultiDay ? r.doctorIds[0] : null;

  const [rateRows, payoutRows, dayConsults] = await Promise.all([
    getDoctorEarningRows(r.windows, ctx.locationId, filter),
    getDoctorPayoutRows(r.windows, ctx.locationId, filter),
    sessionsDoctorId
      ? getDoctorDayConsults(r.day, ctx.locationId, sessionsDoctorId)
      : Promise.resolve([]),
  ]);

  // Word every rate ONCE, from the one wording rule, and key the labels the same way
  // the shaper keys its rate lines - so a rate line and the figures under it can never
  // describe the same frozen rate with different words.
  const rateLabels = new Map<string, string>();
  for (const row of rateRows) {
    rateLabels.set(rateLineKey(row), describeShareRate(row, formatPaise) ?? NO_RATE_LABEL);
  }

  const report = shapeDoctorEarnings(rateRows, payoutRows, rateLabels);

  // The day's detected sittings for the single selected doctor - always the WHOLE
  // day, regardless of which of them the sheet is currently narrowed to, so the strip
  // never hides the session you want to switch to.
  const detected = detectSessions(dayConsults, r.gapMode);

  return {
    ok: true,
    data: {
      meta: {
        hospitalName: ctx.hospitalName,
        generatedByName: ctx.viewerName,
        windowLabels: r.windowLabels,
        dayLabel: formatDayLabel(r.day),
        endDayLabel: r.isMultiDay ? formatDayLabel(input.toDay!.trim()) : null,
        windowKind: r.windowKind,
        dayIso: r.day,
        generatedAtLabel: nowLabel(),
        doctorFilterCount: r.doctorIds.length,
        gapMinutes: detected.gapMinutes,
        gapSmart: detected.smart,
        gapReason: detected.reason,
      },
      report,
      sessions: sessionsDoctorId ? detected.sessions : [],
    },
  };
}

// ── The settlement ────────────────────────────────────────────────────────────
// Record that ONE doctor has been paid for the consultations in the current window.
//
// The client sends the WINDOW and the doctor - never a list of bills and never an
// amount. Both are re-derived on the server from the same resolution the report used,
// so a stale screen or a forged payload cannot settle work outside the window or
// record a figure nobody saw. Only the consultations not already settled are covered,
// which is what makes clicking twice harmless rather than expensive.
export interface SettleResult {
  count: number;
  paise: number;
  doctorName: string;
}

export async function settleDoctorPayoutAction(
  input: EarningsInput & { doctorId: string },
): Promise<ActionResult<SettleResult>> {
  const session = await requireSession();

  if (!DOCTOR_ID.test(input.doctorId ?? "")) {
    return { ok: false, formError: "Unrecognised doctor." };
  }
  // Settle exactly the doctor being paid, whatever else the sheet is showing - so a
  // click on one doctor's row can never settle the doctor above them.
  const r = resolveInput({ ...input, doctorIds: [input.doctorId] });
  if ("error" in r) return { ok: false, formError: r.error };

  if (r.isMultiDay) {
    // A payout is anchored to one clinic day (doctor_payouts.covers_day). Settling a
    // week in one click is not a shift payment and would make every later "already
    // paid" note unreadable.
    return { ok: false, formError: "Settle one day at a time - clear the end date." };
  }

  const ctx = await getReportContext(session.sub);
  if (!ctx) {
    return { ok: false, formError: "Could not resolve your account. Please sign in again." };
  }

  // Name the doctor from the SAME scoped query the sheet uses, so a doctor at another
  // location resolves to nothing rather than being settled across branches.
  const rateRows = await getDoctorEarningRows(r.windows, ctx.locationId, [input.doctorId]);
  if (rateRows.length === 0) {
    return { ok: false, formError: "No consultations for that doctor in this window." };
  }
  const doctorName = rateRows[0].doctorName;

  const coversLabel =
    r.windowKind === "day" ? "Whole day" : r.windowLabels.join(" · ");

  let settled: Awaited<ReturnType<typeof recordDoctorPayout>>;
  try {
    settled = await recordDoctorPayout({
      windows: r.windows,
      locationId: ctx.locationId,
      doctorId: input.doctorId,
      coversDay: r.day,
      coversLabel,
      paidBy: session.sub,
    });
  } catch {
    // The unique index rejected the write - another desk settled these consultations
    // between this screen loading and this click. Reporting it as a conflict (rather
    // than a generic failure) tells the user the true story: the money is accounted
    // for, just not by them.
    return {
      ok: false,
      formError: "These consultations were just settled by someone else. Refresh to see who.",
    };
  }

  if (!settled) {
    return { ok: false, formError: "Everything in this window is already marked as paid." };
  }

  await logActivity({
    actorId: session.sub,
    action: "doctor.payout",
    entity: "doctor_payout",
    targetId: settled.payoutId,
    locationId: ctx.locationId,
    details: {
      doctor_id: input.doctorId,
      doctor_name: doctorName,
      consultation_count: settled.count,
      paid_paise: settled.paise,
      covers_day: r.day,
      covers_label: coversLabel,
    },
  });

  revalidatePath("/doctor-earnings");
  return { ok: true, data: { count: settled.count, paise: settled.paise, doctorName } };
}

// Smart unless the caller explicitly asked for a number. Smart is the default because
// a fixed threshold is wrong for both a doctor seeing someone every four minutes and
// one seeing four patients all morning - see lib/doctors/sessions.ts.
function resolveGapMode(input: EarningsInput): GapMode {
  if (input.gapSmart === false && typeof input.gapMinutes === "number" && Number.isFinite(input.gapMinutes)) {
    return { kind: "manual", minutes: Math.min(MAX_GAP_MINUTES, Math.max(MIN_GAP_MINUTES, Math.round(input.gapMinutes))) };
  }
  return { kind: "smart" };
}

function nowLabel(): string {
  return new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// Word a clinic ISO day with no timezone math - the ISO already IS the clinic day,
// so it is built on a UTC instant and read back in UTC.
function formatDayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
