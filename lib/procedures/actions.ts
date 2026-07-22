"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/dal";
import { logActivity } from "@/lib/audit";
import { zodFieldErrors } from "@/lib/forms/action-result";
import type { ActionResult } from "@/lib/forms/action-result";
import { getUserLocationId } from "@/lib/users/repository";
import { findPatientsByPhone, getPatient } from "@/lib/patients/repository";
import { listActiveServices } from "@/lib/services/repository";
import {
  findApproverByPin,
  logFailedPinAttempt,
  resolveDiscountPaise,
} from "@/lib/billing/discount";
import { computeTotalPaise, canFinalizeBill } from "@/lib/billing/rules";
import { isConsultationValid } from "@/lib/consultations/rules";
import { verifyPinSchema, type PaymentModeValue } from "@/lib/consultations/schema";
import { isValidRupees, rupeesToPaise } from "@/lib/money";
import { clinicToday } from "@/lib/date-range";
import { computeLineTotal, computeSubtotal } from "./lines";
import {
  lookupProcedureSchema,
  procedureBillFiltersSchema,
  procedureLineSchema,
  submitProcedureSchema,
} from "./schema";
import { z } from "zod";
import {
  getConsultationByNumber,
  getActiveConsultationsForPatient,
  createProcedureBill,
  listProcedureBills,
  type ConsultationForBilling,
  type ProcedureBillListRow,
} from "./repository";

// Server actions for the OPD procedures flow - bill service lines against an
// active consultation. Billing a procedure is a READ/USE of the service catalogue
// (never an edit of it - repriceLines re-prices every line from the DB, so a
// client price is never trusted), so it's gated by counter ROLE, not a permission:
// op_desk, op_ip_desk, supervisor and admin can ring up procedure bills. Editing
// the catalogue itself stays admin-only at /admin/services. Enforced in EVERY
// action - hiding UI is not security (DEVELOPMENT_RULES §8).

const PROCEDURE_ROLES = ["op_desk", "op_ip_desk", "supervisor", "admin"] as const;
const PANEL_PATH = "/procedures";

export interface ProcedureLookupPatient {
  patientId: string;
  patientCode: string;
  patientName: string;
  phone: string | null;
  consultations: ConsultationForBilling[]; // ACTIVE only, newest first
}

export interface ProcedureLookupTarget {
  patientId: string;
  patientCode: string;
  patientName: string;
  phone: string | null;
  consultation: ConsultationForBilling;
  active: boolean;
}

export type ProcedureLookupResult =
  | { mode: "phone"; patients: ProcedureLookupPatient[] }
  | { mode: "number"; target: ProcedureLookupTarget };

// The procedures list (role-gated same as the rest of this feature).
// Read-only; narrowed by any combination of filters - free text (patient/
// doctor/bill number), who created it, a date range, an amount range, or a
// specific service sold. Rupee amounts are converted to paise here, the one
// place client money strings are interpreted for this action.
export async function listProcedureBillsAction(
  input: unknown,
): Promise<ActionResult<ProcedureBillListRow[]>> {
  await requireRole(PROCEDURE_ROLES);
  const parsed = procedureBillFiltersSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;
  const rows = await listProcedureBills({
    q: v.q,
    createdBy: v.createdBy,
    dateFrom: v.dateFrom,
    dateTo: v.dateTo,
    minAmountPaise: v.minAmount && v.minAmount !== "" ? rupeesToPaise(v.minAmount) : undefined,
    maxAmountPaise: v.maxAmount && v.maxAmount !== "" ? rupeesToPaise(v.maxAmount) : undefined,
    serviceId: v.serviceId,
  });
  return { ok: true, data: rows };
}

// Find the target(s) for the flow's first step: EITHER a phone (every matching
// patient with their currently-active consultations) OR a consultation number
// (resolve that one consultation directly, flagged active/expired so the UI can
// block without another round trip). Exactly one of the two is set - enforced by
// the schema.
export async function lookupForProcedureAction(
  input: unknown,
): Promise<ActionResult<ProcedureLookupResult>> {
  await requireRole(PROCEDURE_ROLES);
  const parsed = lookupProcedureSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;
  const today = clinicToday();

  if (v.consultationNumber) {
    const row = await getConsultationByNumber(v.consultationNumber);
    if (!row) {
      return { ok: false, formError: "No consultation found with that number." };
    }
    return {
      ok: true,
      data: {
        mode: "number",
        target: {
          patientId: row.patient_id,
          patientCode: row.patient_code,
          patientName: row.patient_name,
          phone: row.phone,
          consultation: { id: row.id, doctor_name: row.doctor_name, valid_until: row.valid_until },
          active: isConsultationValid(row.valid_until, today),
        },
      },
    };
  }

  const patients = await findPatientsByPhone(v.phone!);
  const withConsultations = await Promise.all(
    patients.map(async (p) => ({
      patientId: p.id,
      patientCode: p.patient_code,
      patientName: p.name,
      phone: p.phone,
      consultations: await getActiveConsultationsForPatient(p.id, today),
    })),
  );
  return { ok: true, data: { mode: "phone", patients: withConsultations } };
}

interface RepricedLine {
  serviceId: string;
  description: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
}

// Re-price every line from the services catalog RIGHT NOW - the one place a
// client-supplied serviceId/quantity is turned into money (plan §4E). A service
// that has since been deactivated/trashed can't be billed.
async function repriceLines(
  lines: { serviceId: string; quantity: number }[],
): Promise<{ ok: true; lines: RepricedLine[] } | { ok: false; error: string }> {
  const services = await listActiveServices();
  const byId = new Map(services.map((s) => [s.id, s]));
  const priced: RepricedLine[] = [];
  for (const l of lines) {
    const service = byId.get(l.serviceId);
    if (!service) {
      return { ok: false, error: "One of the selected services is no longer available." };
    }
    const unitPricePaise = Number(service.price_paise);
    priced.push({
      serviceId: l.serviceId,
      description: service.name,
      quantity: l.quantity,
      unitPricePaise,
      lineTotalPaise: computeLineTotal(unitPricePaise, l.quantity),
    });
  }
  return { ok: true, lines: priced };
}

export interface ProcedurePreview {
  lines: RepricedLine[];
  subtotalPaise: number;
}

// Re-price the operator's chosen lines for display - NO write. The client only
// ever shows money this action returns, never its own formula (plan §4E).
export async function previewProcedureAction(input: {
  lines: unknown;
}): Promise<ActionResult<ProcedurePreview>> {
  await requireRole(PROCEDURE_ROLES);
  // The operator may be mid-edit (a row with no service picked yet, or a
  // cleared quantity field) - a malformed line is simply dropped from the
  // preview rather than surfaced as an error, since nothing is written here.
  const parsed = z.array(procedureLineSchema).safeParse(input.lines);
  if (!parsed.success || parsed.data.length === 0) {
    return { ok: true, data: { lines: [], subtotalPaise: 0 } };
  }
  const priced = await repriceLines(parsed.data);
  if (!priced.ok) return { ok: false, formError: priced.error };
  const subtotalPaise = computeSubtotal(
    priced.lines.map((l) => ({ unitPricePaise: l.unitPricePaise, quantity: l.quantity })),
  );
  return { ok: true, data: { lines: priced.lines, subtotalPaise } };
}

export interface ProcedureDiscountAuthorization {
  approverName: string;
  subtotalPaise: number;
  discountPaise: number;
  totalPaise: number;
}

// Authorize a discount ahead of submit: verify a supervisor PIN AND compute the
// discounted amounts from the operator's chosen lines - re-priced here, same as
// preview - so the UI displays server-computed money, never its own formula
// (mirrors consultations/actions.ts authorizeDiscountAction). The discount is
// only truly written when the bill is submitted, which re-verifies the PIN and
// re-derives the amounts from scratch.
export async function authorizeProcedureDiscountAction(input: {
  consultationId?: string;
  lines: unknown;
  pct?: number;
  amount?: string; // flat rupee amount, e.g. "150" or "150.50"
  pin: string;
}): Promise<ActionResult<ProcedureDiscountAuthorization>> {
  const s = await requireRole(PROCEDURE_ROLES);
  const pinParsed = verifyPinSchema.safeParse({ pin: input.pin });
  if (!pinParsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(pinParsed.error) };
  }
  if (
    input.pct !== undefined &&
    (!Number.isInteger(input.pct) || input.pct < 0 || input.pct > 100)
  ) {
    return { ok: false, formError: "Enter a discount between 0 and 100%." };
  }
  if (input.amount !== undefined && input.amount !== "" && !isValidRupees(input.amount)) {
    return { ok: false, formError: "Enter a valid discount amount." };
  }
  const linesParsed = z.array(procedureLineSchema).safeParse(input.lines);
  if (!linesParsed.success || linesParsed.data.length === 0) {
    return { ok: false, formError: "Add at least one line before applying a discount." };
  }
  // A bill isn't required to have a consultation (plan follow-up) - only
  // re-check ACTIVE when one was actually given.
  if (input.consultationId) {
    const consultation = await getConsultationByNumber(input.consultationId);
    if (!consultation) {
      return { ok: false, formError: "That consultation no longer exists." };
    }
    if (!isConsultationValid(consultation.valid_until, clinicToday())) {
      return { ok: false, formError: "This consultation has expired." };
    }
  }
  const priced = await repriceLines(linesParsed.data);
  if (!priced.ok) {
    return { ok: false, formError: priced.error };
  }
  const subtotalPaise = computeSubtotal(
    priced.lines.map((l) => ({ unitPricePaise: l.unitPricePaise, quantity: l.quantity })),
  );
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
      context: "procedure",
    });
    return { ok: false, fieldErrors: { pin: "PIN not recognised." } };
  }
  const totalPaise = computeTotalPaise(subtotalPaise, discountPaise);
  return {
    ok: true,
    data: { approverName: approver.name, subtotalPaise, discountPaise, totalPaise },
  };
}

export interface ProcedureOutcome {
  billId: string; // print plan §2a - a procedure bill always exists, unlike a free revisit
  billNumber: string;
  patientName: string;
  patientCode: string;
  doctorName: string | null;
  subtotalPaise: number;
  discountPaise: number;
  totalPaise: number;
  paymentMode: PaymentModeValue;
  approverName: string | null;
}

// Finalize a procedure bill for a patient. If a consultation is given, re-check
// it's ACTIVE and belongs to this patient (plan §4D); a procedure can also be
// billed standalone with no consultation at all (plan follow-up). Re-prices
// every line, resolves any supervisor-approved discount, then writes the bill +
// items in one transaction (plan §4B/§4F).
export async function submitProcedureAction(
  input: unknown,
): Promise<ActionResult<ProcedureOutcome>> {
  const s = await requireRole(PROCEDURE_ROLES);

  const parsed = submitProcedureSchema.safeParse(input);
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

  let doctorName: string | null = null;
  let patientName: string;
  let patientCode: string;

  if (v.consultationId) {
    const consultation = await getConsultationByNumber(v.consultationId);
    if (!consultation) {
      return { ok: false, formError: "That consultation no longer exists." };
    }
    if (consultation.patient_id !== v.patientId) {
      return { ok: false, formError: "That consultation does not belong to this patient." };
    }
    if (!isConsultationValid(consultation.valid_until, clinicToday())) {
      return { ok: false, formError: "This consultation has expired - start a new consultation." };
    }
    doctorName = consultation.doctor_name;
    patientName = consultation.patient_name;
    patientCode = consultation.patient_code;
  } else {
    const patient = await getPatient(v.patientId);
    if (!patient) {
      return { ok: false, formError: "That patient no longer exists." };
    }
    patientName = patient.name;
    patientCode = patient.patient_code;
  }

  const priced = await repriceLines(v.lines);
  if (!priced.ok) {
    return { ok: false, formError: priced.error };
  }
  const subtotalPaise = computeSubtotal(
    priced.lines.map((l) => ({ unitPricePaise: l.unitPricePaise, quantity: l.quantity })),
  );

  let discountPaise = 0;
  let approverId: string | null = null;
  let approverName: string | null = null;
  const wantsDiscount =
    (v.discountPct && v.discountPct > 0) || (v.discountAmount && v.discountAmount !== "");
  if (wantsDiscount) {
    if (!v.discountPin) {
      return {
        ok: false,
        fieldErrors: { discountPin: "A supervisor PIN is required for a discount." },
      };
    }
    const approver = await findApproverByPin(v.discountPin, locationId);
    if (!approver) {
      await logFailedPinAttempt({ actorId: s.sub, locationId, context: "procedure" });
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

  const { billId, billNumber, replacedBillId } = await createProcedureBill({
    consultationId: v.consultationId ?? null,
    patientId: v.patientId,
    lines: priced.lines,
    subtotalPaise,
    discountPaise,
    totalPaise,
    paymentMode: v.paymentMode,
    discountApprovedBy: approverId,
    createdBy: s.sub,
    locationId,
    replacesBillId: v.replacesBillId ?? null,
  });

  // One activity row per bill: "Bill finalized" carries the number, amount, and
  // payment mode. (We deliberately don't also log a separate "Bill created" - a
  // finalized bill was created; two rows for one action is just noise in the feed.)
  await logActivity({
    actorId: s.sub,
    action: "bill.finalize",
    entity: "bill",
    targetId: billId,
    locationId,
    details: {
      bill_number: billNumber,
      total_paise: totalPaise,
      payment_mode: v.paymentMode,
      consultation_id: v.consultationId ?? null,
    },
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
  revalidatePath("/procedures/history");
  return {
    ok: true,
    data: {
      billId,
      billNumber,
      patientName,
      patientCode,
      doctorName,
      subtotalPaise,
      discountPaise,
      totalPaise,
      paymentMode: v.paymentMode,
      approverName,
    },
  };
}
