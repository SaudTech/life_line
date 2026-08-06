"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/dal";
import { logActivity } from "@/lib/audit";
import { zodFieldErrors } from "@/lib/forms/action-result";
import type { ActionResult } from "@/lib/forms/action-result";
import { getUserLocationId } from "@/lib/users/repository";
import {
  createPatient,
  findPatientsByPhone,
  getPatient,
  type PatientRow,
} from "@/lib/patients/repository";
import { getDoctorById, type DoctorListRow } from "@/lib/doctors/repository";
import { snapshotDoctorShare } from "@/lib/doctors/share";
import {
  describeRevisitLadder,
  resolveRevisitCharge,
  type RevisitBand,
  type RevisitCharge,
} from "@/lib/doctors/revisit-tiers";
import { isValidRupees } from "@/lib/money";
import { computeTotalPaise, canFinalizeBill } from "@/lib/billing/rules";
import {
  findApproverByPin,
  logFailedPinAttempt,
  resolveDiscountPaise,
} from "@/lib/billing/discount";
import {
  consultationFiltersSchema,
  lookupPhoneSchema,
  startConsultationSchema,
  verifyPinSchema,
  type PaymentModeValue,
} from "./schema";
import { computeValidUntil, daysBetween, type IsoDay } from "./rules";
import { clinicToday } from "@/lib/date-range";
import {
  createConsultationWithBill,
  findLatestConsultationForDoctor,
  getLastVisitDates,
  listConsultations,
  recordRevisit,
  type ConsultationListRow,
} from "./repository";

// Server actions for the outpatient consultation flow (PROJECT_OVERVIEW §Consult).
// Accessible to admins, the OP+IN desk, and supervisors (who work the full counter
// as well as approving discounts) - gated on the SERVER in every action (hiding UI
// is not security, §9). Money is decided here from authoritative DB values via the
// pure rules (rules.ts, billing/rules.ts); the client's numbers are never trusted.
// Discounts require a supervisor PIN, verified server-side.

const CONSULT_ROLES = ["admin", "op_ip_desk", "supervisor"] as const;

// The history LIST is readable by every staff role (documents plan: any desk
// opens it to attach/view scans); starting/billing consultations stays
// CONSULT_ROLES-only.
const CONSULT_LIST_ROLES = ["admin", "op_ip_desk", "supervisor", "op_desk"] as const;

const PANEL_PATH = "/consultations";

// A patient row for the picker, enriched with the last visit day.
export type PatientPickRow = PatientRow & { last_visit: string | null };

// Phone lookup for the flow's first step: exact match, ALL patients on that number
// (mother + child) - the operator picks the right one. Enriched with each
// patient's last visit day for the picker.
export async function lookupPatientsAction(
  input: unknown,
): Promise<ActionResult<PatientPickRow[]>> {
  await requireRole(CONSULT_ROLES);
  const parsed = lookupPhoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const rows = await findPatientsByPhone(parsed.data.phone);
  const lastVisits = await getLastVisitDates(rows.map((r) => r.id));
  return {
    ok: true,
    data: rows.map((r) => ({ ...r, last_visit: lastVisits[r.id] ?? null })),
  };
}

// The consultations list (admin + OP+IN desk). Read-only; narrowed by search
// (patient name/phone/code or doctor name) and/or a clinic-day date range.
export async function listConsultationsAction(
  input: unknown,
): Promise<ActionResult<ConsultationListRow[]>> {
  await requireRole(CONSULT_LIST_ROLES);
  const parsed = consultationFiltersSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const rows = await listConsultations(parsed.data);
  return { ok: true, data: rows };
}

// What this patient's next visit to this doctor costs, and the row it continues.
// ONE resolver behind the preview, the discount authorization and the write, so
// the three can never disagree about the price (DEVELOPMENT_RULES §1).
//
// The taper is read from the CONSULTATION, not from the doctor's current
// settings: `series_started_on` is the day the run began and `valid_until` the
// free window as it was granted THEN, so an admin editing the window tomorrow
// cannot retroactively make a patient's past free visit chargeable. Only the
// priced rates - which are never frozen anywhere - come from the doctor as they
// stand right now.
interface RevisitContext {
  charge: RevisitCharge;
  // The consultation this visit continues, or null when there is none to continue.
  // Present for 'expired' too: that run existed, it has simply run out.
  previous: { id: string; validUntil: IsoDay; seriesStartedOn: IsoDay } | null;
}

async function resolveRevisitContext(
  patientId: string,
  doctor: DoctorListRow,
  today: IsoDay,
): Promise<RevisitContext> {
  const latest = await findLatestConsultationForDoctor(patientId, doctor.id);
  const fullFeePaise = Number(doctor.fee_paise);
  if (!latest) {
    return { charge: { kind: "expired", pricePaise: fullFeePaise }, previous: null };
  }
  const charge = resolveRevisitCharge(
    {
      freeThroughDay: daysBetween(latest.series_started_on, latest.valid_until),
      tiers: doctor.revisit_tiers.map((t) => ({
        throughDay: t.through_day,
        pricePaise: Number(t.price_paise),
      })),
      fullFeePaise,
    },
    // Clamped: a consultation dated in the future (clock skew, a corrected
    // system date) must read as "day 0", never throw at the counter.
    Math.max(0, daysBetween(latest.series_started_on, today)),
  );
  return {
    charge,
    previous: {
      id: latest.id,
      validUntil: latest.valid_until,
      seriesStartedOn: latest.series_started_on,
    },
  };
}

export interface ConsultationPreview {
  kind: "new" | "free-revisit" | "paid-revisit";
  feePaise: number; // what will be charged: 0 free, the reduced rate, or the full fee
  validUntil: IsoDay;
  doctorName: string;
  // Only for a paid revisit. The counter line stays short - "Revisit · day 5" -
  // and these back the info popover behind it: which day of the run this is, and
  // the doctor's WHOLE ladder with the row that applies marked, so an operator
  // asked "why ₹200?" can show the answer instead of reciting it.
  revisitDay?: number;
  ladder?: RevisitBand[];
  currentBandIndex?: number;
}

// Tell the UI, for a chosen patient + doctor, what this visit will cost - free
// revisit, a reduced revisit rate, or a new consultation at the full fee. The
// authoritative decision is re-made on submit; this is only for display.
export async function previewConsultationAction(input: {
  patientId: string;
  doctorId: string;
}): Promise<ActionResult<ConsultationPreview>> {
  await requireRole(CONSULT_ROLES);
  const doctor = await getDoctorById(input.doctorId);
  if (!doctor || !doctor.active || doctor.status !== "available") {
    return { ok: false, formError: "That doctor is unavailable." };
  }
  const today = clinicToday();
  const { charge, previous } = await resolveRevisitContext(input.patientId, doctor, today);

  if (charge.kind === "free") {
    return {
      ok: true,
      data: {
        kind: "free-revisit",
        feePaise: 0,
        validUntil: previous!.validUntil,
        doctorName: doctor.name,
      },
    };
  }
  if (charge.kind === "tier") {
    const tiers = doctor.revisit_tiers.map((t) => ({
      throughDay: t.through_day,
      pricePaise: Number(t.price_paise),
    }));
    return {
      ok: true,
      data: {
        kind: "paid-revisit",
        feePaise: charge.pricePaise,
        validUntil: previous!.validUntil,
        doctorName: doctor.name,
        revisitDay: daysBetween(previous!.seriesStartedOn, today),
        ladder: describeRevisitLadder({
          freeThroughDay: daysBetween(previous!.seriesStartedOn, previous!.validUntil),
          tiers,
          fullFeePaise: Number(doctor.fee_paise),
        }),
        // describeRevisitLadder puts the free window first, so a tier's row is
        // one past its index in the tier list.
        currentBandIndex: 1 + tiers.findIndex((t) => t.throughDay === charge.throughDay),
      },
    };
  }
  return {
    ok: true,
    data: {
      kind: "new",
      feePaise: Number(doctor.fee_paise),
      validUntil: computeValidUntil(today, doctor.revisit_validity_days),
      doctorName: doctor.name,
    },
  };
}

export interface DiscountAuthorization {
  approverName: string;
  subtotalPaise: number;
  discountPaise: number;
  totalPaise: number;
}

// Authorize a discount: verify a supervisor PIN (scrypt is salted per row, so we
// try each approver's hash) AND compute the discounted amounts from the doctor's
// authoritative fee - so the UI displays server-computed money, never its own
// formula (DEVELOPMENT_RULES §4). The discount is only truly written when the
// consultation is started, which re-verifies the PIN and re-derives the amounts.
export async function authorizeDiscountAction(input: {
  doctorId: string;
  // The patient this visit is for, when they already exist. It decides the
  // SUBTOTAL the discount comes off: a reduced revisit rate is not the full fee,
  // and discounting the wrong base would authorise the wrong money. Absent for a
  // patient being registered in this same flow - who can have no prior visit, so
  // the full fee is right by construction.
  patientId?: string;
  pct?: number;
  amount?: string; // flat rupee amount, e.g. "150" or "150.50"
  pin: string;
}): Promise<ActionResult<DiscountAuthorization>> {
  const s = await requireRole(CONSULT_ROLES);
  const pinParsed = verifyPinSchema.safeParse({ pin: input.pin });
  if (!pinParsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(pinParsed.error) };
  }
  const doctor = await getDoctorById(input.doctorId);
  if (!doctor || !doctor.active || doctor.status !== "available") {
    return { ok: false, formError: "That doctor is unavailable." };
  }
  // Validate the discount inputs BEFORE the pure rules see them - an out-of-range
  // percentage or a malformed custom amount (both reachable from the number field)
  // would otherwise throw inside computeDiscountPaise/rupeesToPaise and reject the
  // action, leaving the dialog stuck. Surface it as a clear error instead.
  if (input.pct !== undefined && (!Number.isInteger(input.pct) || input.pct < 0 || input.pct > 100)) {
    return { ok: false, formError: "Enter a discount between 0 and 100%." };
  }
  if (input.amount !== undefined && input.amount !== "" && !isValidRupees(input.amount)) {
    return { ok: false, formError: "Enter a valid discount amount." };
  }
  const subtotalPaise = input.patientId
    ? (await resolveRevisitContext(input.patientId, doctor, clinicToday())).charge.pricePaise
    : Number(doctor.fee_paise);
  if (subtotalPaise <= 0) {
    return { ok: false, formError: "There is nothing to discount - this visit is free." };
  }
  const discountPaise = resolveDiscountPaise(subtotalPaise, {
    pct: input.pct,
    amount: input.amount,
  });
  if (discountPaise <= 0) {
    return { ok: false, formError: "Enter a discount percentage or amount." };
  }
  // Resolved before the PIN check, not inside the failure log: the approver lookup is
  // SCOPED to this location, so only a supervisor at this branch can authorize this
  // branch's discount (§8).
  const locationId = await getUserLocationId(s.sub);
  if (!locationId) {
    return { ok: false, formError: "Could not resolve your location. Please sign in again." };
  }
  const approver = await findApproverByPin(pinParsed.data.pin, locationId);
  if (!approver) {
    await logFailedPinAttempt({
      actorId: s.sub,
      locationId,
      context: "consultation",
    });
    return { ok: false, fieldErrors: { pin: "PIN not recognised." } };
  }
  const totalPaise = computeTotalPaise(subtotalPaise, discountPaise);
  return {
    ok: true,
    data: { approverName: approver.name, subtotalPaise, discountPaise, totalPaise },
  };
}

export interface ConsultationOutcome {
  kind: "new" | "free-revisit" | "paid-revisit";
  consultationId: string;
  billId: string | null; // null for a FREE revisit (no bill is created) - print plan §2a/§2b
  billNumber: string | null; // the token for anything billed; null for a free revisit
  patientId: string;
  patientCode: string;
  patientName: string;
  doctorName: string;
  validUntil: IsoDay;
  subtotalPaise: number;
  discountPaise: number;
  totalPaise: number;
  paymentMode: PaymentModeValue | null; // null for a free revisit
  approverName: string | null; // supervisor who approved a discount, if any
}

// Start a consultation. Three outcomes, decided by the ONE resolver above:
//   free-revisit  - inside the free window: another visit on the same
//                   consultation, no bill, exactly as before.
//   paid-revisit  - inside a reduced-rate window (migration 0027): its own
//                   consultation row at that rate, with a real bill, carrying the
//                   run's anchor and window forward so the taper keeps counting
//                   from the first visit (migration 0028).
//   new           - the taper has run out (or there is no prior run): a fresh
//                   consultation at the full fee, anchored today.
export async function startConsultationAction(
  input: unknown,
): Promise<ActionResult<ConsultationOutcome>> {
  const s = await requireRole(CONSULT_ROLES);

  const parsed = startConsultationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const locationId = await getUserLocationId(s.sub);
  if (!locationId) {
    return {
      ok: false,
      formError: "Could not resolve your location. Please sign in again.",
    };
  }

  const doctor = await getDoctorById(v.doctorId);
  if (!doctor) {
    return { ok: false, fieldErrors: { doctorId: "That doctor no longer exists." } };
  }
  if (!doctor.active) {
    return { ok: false, fieldErrors: { doctorId: "That doctor is inactive." } };
  }
  if (doctor.status !== "available") {
    return { ok: false, fieldErrors: { doctorId: "That doctor is not available today." } };
  }

  // Resolve the patient: existing id, or register a new one (reusing Part 1's
  // createPatient so registration stays identical across screens).
  let patientId: string;
  let patientCode: string;
  let patientName: string;
  if (v.newPatient) {
    const np = v.newPatient;
    const created = await createPatient({
      name: np.name,
      phone: np.phone,
      age: typeof np.age === "number" ? np.age : null,
      area: np.area || null,
      gender: np.gender || null,
      location_id: locationId,
    });
    patientId = created.id;
    patientCode = created.patient_code;
    patientName = np.name;
    await logActivity({
      actorId: s.sub,
      action: "patient.create",
      entity: "patient",
      targetId: patientId,
      locationId,
      details: { patient_code: patientCode },
    });
  } else {
    const existing = await getPatient(v.patientId!);
    if (!existing) {
      return { ok: false, fieldErrors: { patientId: "That patient no longer exists." } };
    }
    patientId = existing.id;
    patientCode = existing.patient_code;
    patientName = existing.name;
  }

  const today = clinicToday();
  const { charge, previous } = await resolveRevisitContext(patientId, doctor, today);

  if (charge.kind === "free") {
    const latest = previous!;
    await recordRevisit(latest.id, v.reason ? v.reason : null);
    await logActivity({
      actorId: s.sub,
      action: "consultation.revisit",
      entity: "consultation",
      targetId: latest.id,
      locationId,
      details: { patient_id: patientId, doctor_id: v.doctorId },
    });
    revalidatePath(PANEL_PATH);
    return {
      ok: true,
      data: {
        kind: "free-revisit",
        consultationId: latest.id,
        billId: null,
        billNumber: null,
        patientId,
        patientCode,
        patientName,
        doctorName: doctor.name,
        validUntil: latest.validUntil,
        subtotalPaise: 0,
        discountPaise: 0,
        totalPaise: 0,
        paymentMode: null,
        approverName: null,
      },
    };
  }

  // Billed from here down - a paid revisit and a new consultation take the same
  // path and differ only in three values: the price, the window, and the anchor.
  const paidRevisit = charge.kind === "tier";
  const subtotalPaise = charge.pricePaise;
  const paymentMode: PaymentModeValue = v.paymentMode ?? "cash";

  let discountPaise = 0;
  let approverId: string | null = null;
  let approverName: string | null = null;
  const wantsDiscount =
    (v.discountPct && v.discountPct > 0) || (v.discountAmount && v.discountAmount !== "");
  if (wantsDiscount) {
    if (!v.discountPin) {
      return { ok: false, fieldErrors: { discountPin: "A supervisor PIN is required for a discount." } };
    }
    const approver = await findApproverByPin(v.discountPin, locationId);
    if (!approver) {
      await logFailedPinAttempt({ actorId: s.sub, locationId, context: "consultation" });
      return { ok: false, fieldErrors: { discountPin: "PIN not recognised." } };
    }
    discountPaise = resolveDiscountPaise(subtotalPaise, {
      pct: v.discountPct,
      amount: v.discountAmount,
    });
    if (discountPaise > 0) {
      approverId = approver.id;
      approverName = approver.name;
    }
  }

  // Enforce the finalize rule (mirrors the DB constraint) before writing.
  if (!canFinalizeBill({ discountPaise, approvedBy: approverId })) {
    return { ok: false, formError: "A discount needs supervisor approval." };
  }
  const totalPaise = computeTotalPaise(subtotalPaise, discountPaise);
  // A paid revisit continues a run: it inherits that run's window and anchor
  // rather than granting a fresh free period and restarting the taper (0028).
  const validUntil =
    paidRevisit && previous
      ? previous.validUntil
      : computeValidUntil(today, doctor.revisit_validity_days);
  const seriesStartedOn = paidRevisit && previous ? previous.seriesStartedOn : today;

  // Freeze the doctor's cut NOW, at the doctor's rate as it stands at this instant
  // and on what this bill actually collects (migration 0025). A rate edited later
  // must never move a figure that has already been printed on a payout slip and
  // paid out of the drawer. Priced from the same `doctor` row this bill's fee came
  // from, so the snapshot cannot disagree with the amount charged.
  const doctorShare = snapshotDoctorShare(totalPaise, {
    shareType: doctor.share_type === "flat" ? "flat" : "percentage",
    sharePercentage: doctor.share_percentage,
    // BIGINT arrives from pg as a string; null when the doctor is on a percentage.
    shareFlatPaise: doctor.share_flat_paise == null ? null : Number(doctor.share_flat_paise),
  });

  const { consultationId, billId, billNumber, replacedBillId } = await createConsultationWithBill({
    patientId,
    doctorId: v.doctorId,
    feeChargedPaise: subtotalPaise,
    validUntil,
    seriesStartedOn,
    revisitOfConsultationId: paidRevisit && previous ? previous.id : null,
    reason: v.reason ? v.reason : null,
    locationId,
    subtotalPaise,
    discountPaise,
    totalPaise,
    paymentMode,
    discountApprovedBy: approverId,
    createdBy: s.sub,
    replacesBillId: v.replacesBillId ?? null,
    doctorShare,
  });

  await logActivity({
    actorId: s.sub,
    action: paidRevisit ? "consultation.revisit_paid" : "consultation.create",
    entity: "consultation",
    targetId: consultationId,
    locationId,
    details: {
      patient_id: patientId,
      doctor_id: v.doctorId,
      fee_charged_paise: subtotalPaise,
      // Which run this continues, and at which rate - the audit trail for why
      // this consultation was not billed at the doctor's listed fee.
      ...(paidRevisit && previous
        ? { revisit_of_consultation_id: previous.id, revisit_day: daysBetween(previous.seriesStartedOn, today) }
        : {}),
    },
  });
  await logActivity({
    actorId: s.sub,
    action: "bill.finalize",
    entity: "bill",
    targetId: billId,
    locationId,
    details: { bill_number: billNumber, total_paise: totalPaise, payment_mode: paymentMode },
  });
  if (discountPaise > 0 && approverId) {
    await logActivity({
      actorId: s.sub,
      action: "discount.approve",
      entity: "bill",
      targetId: billId,
      locationId,
      details: { discount_paise: discountPaise, approved_by: approverId },
    });
  }
  // Re-issue link established (plan §Part B): record the correction with both ids.
  if (replacedBillId) {
    await logActivity({
      actorId: s.sub,
      action: "bill.reissue",
      entity: "bill",
      targetId: billId,
      locationId,
      details: { bill_number: billNumber, replaces_bill_id: replacedBillId },
    });
  }

  revalidatePath(PANEL_PATH);
  revalidatePath("/consultations/history");
  return {
    ok: true,
    data: {
      kind: paidRevisit ? "paid-revisit" : "new",
      consultationId,
      billId,
      billNumber,
      patientId,
      patientCode,
      patientName,
      doctorName: doctor.name,
      validUntil,
      subtotalPaise,
      discountPaise,
      totalPaise,
      paymentMode,
      approverName,
    },
  };
}
