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
import { getDoctorById } from "@/lib/doctors/repository";
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
import { computeValidUntil, isRevisitFree, type IsoDay } from "./rules";
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
  await requireRole(CONSULT_ROLES);
  const parsed = consultationFiltersSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const rows = await listConsultations(parsed.data);
  return { ok: true, data: rows };
}

export interface ConsultationPreview {
  kind: "new" | "revisit";
  feePaise: number; // the doctor's fee (0 shown for a revisit)
  validUntil: IsoDay;
  doctorName: string;
}

// Tell the UI, for a chosen patient + doctor, whether this will be a free revisit
// or a new paid consultation - so it can show the fee/payment or "no charge". The
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
  const latest = await findLatestConsultationForDoctor(input.patientId, input.doctorId);
  const revisit =
    latest !== null &&
    isRevisitFree(
      { doctorId: latest.doctor_id, validUntil: latest.valid_until },
      { doctorId: input.doctorId, on: today },
    );
  return {
    ok: true,
    data: {
      kind: revisit ? "revisit" : "new",
      feePaise: revisit ? 0 : Number(doctor.fee_paise),
      validUntil: revisit ? latest!.valid_until : computeValidUntil(today, doctor.revisit_validity_days),
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
  const subtotalPaise = Number(doctor.fee_paise);
  const discountPaise = resolveDiscountPaise(subtotalPaise, {
    pct: input.pct,
    amount: input.amount,
  });
  if (discountPaise <= 0) {
    return { ok: false, formError: "Enter a discount percentage or amount." };
  }
  const approver = await findApproverByPin(pinParsed.data.pin);
  if (!approver) {
    await logFailedPinAttempt({
      actorId: s.sub,
      locationId: await getUserLocationId(s.sub),
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
  kind: "new" | "revisit";
  consultationId: string;
  billId: string | null; // null for a revisit (no bill is created) - print plan §2a/§2b
  billNumber: string | null; // the token for a new consultation; null for a revisit
  patientId: string;
  patientCode: string;
  patientName: string;
  doctorName: string;
  validUntil: IsoDay;
  subtotalPaise: number;
  discountPaise: number;
  totalPaise: number;
  paymentMode: PaymentModeValue | null; // null for a revisit
  approverName: string | null; // supervisor who approved a discount, if any
}

// Start a consultation. Free revisit (same doctor, still valid) → just a visit, no
// bill. Otherwise a new consultation + first visit + finalized bill, with the
// doctor's fee, chosen payment mode, and any supervisor-approved discount.
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
  const latest = await findLatestConsultationForDoctor(patientId, v.doctorId);
  const freeRevisit =
    latest !== null &&
    isRevisitFree(
      { doctorId: latest.doctor_id, validUntil: latest.valid_until },
      { doctorId: v.doctorId, on: today },
    );

  if (freeRevisit) {
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
        kind: "revisit",
        consultationId: latest.id,
        billId: null,
        billNumber: null,
        patientId,
        patientCode,
        patientName,
        doctorName: doctor.name,
        validUntil: latest.valid_until,
        subtotalPaise: 0,
        discountPaise: 0,
        totalPaise: 0,
        paymentMode: null,
        approverName: null,
      },
    };
  }

  // New, paid consultation - compute the bill from authoritative values.
  const subtotalPaise = Number(doctor.fee_paise);
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
    const approver = await findApproverByPin(v.discountPin);
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
  const validUntil = computeValidUntil(today, doctor.revisit_validity_days);

  const { consultationId, billId, billNumber, replacedBillId } = await createConsultationWithBill({
    patientId,
    doctorId: v.doctorId,
    feeChargedPaise: subtotalPaise,
    validUntil,
    reason: v.reason ? v.reason : null,
    locationId,
    subtotalPaise,
    discountPaise,
    totalPaise,
    paymentMode,
    discountApprovedBy: approverId,
    createdBy: s.sub,
    replacesBillId: v.replacesBillId ?? null,
  });

  await logActivity({
    actorId: s.sub,
    action: "consultation.create",
    entity: "consultation",
    targetId: consultationId,
    locationId,
    details: { patient_id: patientId, doctor_id: v.doctorId, fee_charged_paise: subtotalPaise },
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
      kind: "new",
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
