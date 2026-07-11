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
import { listActiveServices } from "@/lib/services/repository";
import { isValidRupees, rupeesToPaise, formatPaise } from "@/lib/money";
import { computeLineTotal } from "@/lib/procedures/lines";
import { calculateDischargeBalance, type DischargeBalance } from "@/lib/billing/discharge";
import { canFinalizeBill } from "@/lib/billing/rules";
import {
  findApproverByPin,
  logFailedPinAttempt,
  resolveDiscountPaise,
} from "@/lib/billing/discount";
import { lookupPhoneSchema, verifyPinSchema } from "@/lib/consultations/schema";
import {
  admitSchema,
  addExpenseSchema,
  removeExpenseSchema,
  dischargeSchema,
  type PaymentModeValue,
} from "./schema";
import {
  createAdmission,
  addAdmissionExpense,
  removeAdmissionExpense,
  getAdmissionForDischarge,
  getAdmissionDetail,
  dischargeWithBill,
  type AdmissionExpenseRow,
} from "./repository";

// Server actions for the in-patient admit → discharge flow (plan §5/§6). Only the
// OP+IP desk and admin may admit/discharge (PROJECT_OVERVIEW §Roles) - gated on the
// SERVER in EVERY action via IP_ROLES; op_desk is blocked even if the UI leaks
// (dev-rules §8). Money is server-authoritative throughout: expenses are re-priced
// from the live catalog on every add, and the discharge balance is computed by the
// pure rule calculateDischargeBalance - the client only ever shows what the server
// returns (no client-side money formula, dev-rules §4).

const IP_ROLES = ["admin", "op_ip_desk"] as const;
const PANEL_PATH = "/admissions";

// ── Patient lookup (reused from the consultation/procedure intake) ────────────
export async function lookupForAdmitAction(
  input: unknown,
): Promise<ActionResult<PatientRow[]>> {
  await requireRole(IP_ROLES);
  const parsed = lookupPhoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const rows = await findPatientsByPhone(parsed.data.phone);
  return { ok: true, data: rows };
}

export interface AdmitOutcome {
  admissionId: string;
  patientId: string;
  patientCode: string;
  patientName: string;
  advancePaise: number;
  roomChargePaise: number;
  roomRatePaise: number | null;
  roomDays: number | null;
  paymentMode: PaymentModeValue;
}

// Admit a patient with an advance, in one transaction (plan §5b). Resolves the
// patient (existing id, or register-if-new reusing createPatient so registration
// stays identical across screens), converts rupee inputs to integer paise here
// (the one place client money strings are interpreted), and records the advance.
export async function admitAction(input: unknown): Promise<ActionResult<AdmitOutcome>> {
  const s = await requireRole(IP_ROLES);

  const parsed = admitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const locationId = await getUserLocationId(s.sub);
  if (!locationId) {
    return { ok: false, formError: "Could not resolve your location. Please sign in again." };
  }

  // Resolve the patient (existing or new).
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

  const advancePaise = rupeesToPaise(v.advanceAmount);
  // Only the room RATE/day is known at admission; the day count (and thus the room
  // total) is set at discharge. Store the rate so discharge can pre-fill it.
  const roomRatePaise = v.roomRate && v.roomRate !== "" ? rupeesToPaise(v.roomRate) : null;

  const { admissionId } = await createAdmission({
    patientId,
    advancePaise,
    advancePaymentMode: v.paymentMode,
    roomChargePaise: 0,
    roomRatePaise,
    roomDays: null,
    createdBy: s.sub,
    locationId,
  });

  await logActivity({
    actorId: s.sub,
    action: "admission.admit",
    entity: "admission",
    targetId: admissionId,
    locationId,
    details: { patient_id: patientId, advance_paise: advancePaise, payment_mode: v.paymentMode },
  });

  revalidatePath(PANEL_PATH);
  return {
    ok: true,
    data: {
      admissionId,
      patientId,
      patientCode,
      patientName,
      advancePaise,
      roomChargePaise: 0,
      roomRatePaise,
      roomDays: null,
      paymentMode: v.paymentMode,
    },
  };
}

// Best-effort audit that an advance-deposit receipt was printed (plan §5b, like
// receipt.printed) - logged from the client's explicit print click. A logging
// failure must never surface to the counter or block the print that already
// happened.
export async function logAdvancePrintedAction(input: {
  admissionId: string;
}): Promise<ActionResult> {
  const s = await requireRole(IP_ROLES);
  const parsed = removeExpenseSchema.pick({ admissionId: true }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  await logActivity({
    actorId: s.sub,
    action: "admission.advance_printed",
    entity: "admission",
    targetId: parsed.data.admissionId,
    locationId: await getUserLocationId(s.sub),
  });
  return { ok: true };
}

// ── Running expense tally (catalog-only, server-priced) ──────────────────────
export interface ExpenseTally {
  expenses: AdmissionExpenseRow[];
  roomChargePaise: string;
  advancePaise: string;
  expensesTotalPaise: number;
  runningTotalPaise: number; // room + Σ expenses
}

// Build the current tally from the admission detail (the one source of truth the
// list/detail read). Returned by add/remove so the client shows server-computed
// running totals, never its own sum.
async function tallyFor(admissionId: string): Promise<ExpenseTally | null> {
  const detail = await getAdmissionDetail(admissionId);
  if (!detail) return null;
  const expensesTotalPaise = detail.expenses.reduce((sum, e) => sum + Number(e.total_paise), 0);
  return {
    expenses: detail.expenses,
    roomChargePaise: detail.room_charge_paise,
    advancePaise: detail.advance_paid_paise,
    expensesTotalPaise,
    runningTotalPaise: Number(detail.room_charge_paise) + expensesTotalPaise,
  };
}

// Add one catalog expense to an admission. STRICTLY from the services catalog
// (no free-text) - the price is re-priced server-side from the live catalog on
// every add (plan §5c); the client's amount is never trusted. Stores the service
// name snapshot as `item`, the quantity, and quantity × current price as total.
export async function addExpenseAction(input: unknown): Promise<ActionResult<ExpenseTally>> {
  const s = await requireRole(IP_ROLES);
  const parsed = addExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const services = await listActiveServices();
  const service = services.find((sv) => sv.id === v.serviceId);
  if (!service) {
    return { ok: false, formError: "That service is no longer available." };
  }
  const unitPricePaise = Number(service.price_paise);
  const totalPaise = computeLineTotal(unitPricePaise, v.quantity);

  const added = await addAdmissionExpense({
    admissionId: v.admissionId,
    item: service.name,
    quantity: v.quantity,
    totalPaise,
  });
  if (!added) {
    return { ok: false, formError: "This admission is not open for new expenses." };
  }

  const locationId = await getUserLocationId(s.sub);
  await logActivity({
    actorId: s.sub,
    action: "admission.expense_added",
    entity: "admission",
    targetId: v.admissionId,
    locationId,
    details: { item: service.name, quantity: v.quantity, total_paise: totalPaise },
  });

  revalidatePath(PANEL_PATH);
  revalidatePath(`${PANEL_PATH}/${v.admissionId}`);
  const tally = await tallyFor(v.admissionId);
  return { ok: true, data: tally! };
}

export async function removeExpenseAction(input: unknown): Promise<ActionResult<ExpenseTally>> {
  const s = await requireRole(IP_ROLES);
  const parsed = removeExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const removed = await removeAdmissionExpense({
    admissionId: v.admissionId,
    expenseId: v.expenseId,
  });
  if (!removed) {
    return { ok: false, formError: "That expense could not be removed." };
  }

  const locationId = await getUserLocationId(s.sub);
  await logActivity({
    actorId: s.sub,
    action: "admission.expense_removed",
    entity: "admission",
    targetId: v.admissionId,
    locationId,
    details: { expense_id: v.expenseId },
  });

  revalidatePath(PANEL_PATH);
  revalidatePath(`${PANEL_PATH}/${v.admissionId}`);
  const tally = await tallyFor(v.admissionId);
  return { ok: true, data: tally! };
}

// ── Discharge ────────────────────────────────────────────────────────────────

interface ResolvedRoom {
  ratePaise: number | null; // per-day rate; null when no room is set
  days: number | null; // number of days; null when no room is set
  totalPaise: number; // rate × days (0 when no room is set)
}

// Resolve the room charge as rate/day × days. When the caller supplies room
// inputs (roomRate given, even blank), recompute from them; otherwise fall back to
// the admission's stored components/total (e.g. a preview before the desk touches
// the field). A blank/zero rate means "no room charge" (total 0), regardless of
// days. computeLineTotal keeps the multiply integer-safe and guarded.
function resolveRoom(
  roomRate: string | undefined,
  roomDays: number | undefined,
  stored: { ratePaise: string | null; days: number | null; totalPaise: string },
): ResolvedRoom {
  const untouched = roomRate === undefined && roomDays === undefined;
  if (untouched) {
    return {
      ratePaise: stored.ratePaise != null ? Number(stored.ratePaise) : null,
      days: stored.days,
      totalPaise: Number(stored.totalPaise),
    };
  }
  const ratePaise = roomRate && roomRate !== "" ? rupeesToPaise(roomRate) : 0;
  if (ratePaise <= 0) return { ratePaise: null, days: null, totalPaise: 0 };
  const days = roomDays && roomDays >= 1 ? roomDays : 1;
  return { ratePaise, days, totalPaise: computeLineTotal(ratePaise, days) };
}

export interface DischargePreview extends DischargeBalance {
  expenses: { item: string; quantity: number; totalPaise: number }[];
  roomChargePaise: number;
  roomRatePaise: number | null;
  roomDays: number | null;
}

// The stored room components, for resolveRoom's fallback.
function storedRoom(a: {
  roomRatePaise: string | null;
  roomDays: number | null;
  roomChargePaise: string;
}) {
  return { ratePaise: a.roomRatePaise, days: a.roomDays, totalPaise: a.roomChargePaise };
}

// Compute the discharge settlement for display - NO write, NO discount. The
// client only ever shows money this action returns (dev-rules §4). The balance is
// the pure rule calculateDischargeBalance over the confirmed room (rate × days) +
// the stored (already server-priced) expenses + the advance.
export async function previewDischargeAction(input: {
  admissionId: string;
  roomRate?: string;
  roomDays?: number;
}): Promise<ActionResult<DischargePreview>> {
  await requireRole(IP_ROLES);
  if (input.roomRate !== undefined && input.roomRate !== "" && !isValidRupees(input.roomRate)) {
    return { ok: false, formError: "Enter a valid room rate." };
  }
  const admission = await getAdmissionForDischarge(input.admissionId);
  if (!admission) return { ok: false, formError: "That admission no longer exists." };
  if (admission.status !== "admitted") {
    return { ok: false, formError: "This patient has already been discharged." };
  }
  const room = resolveRoom(input.roomRate, input.roomDays, storedRoom(admission));
  const expenses = admission.expenses.map((e) => ({
    item: e.item,
    quantity: e.quantity,
    totalPaise: Number(e.totalPaise),
  }));
  const balance = calculateDischargeBalance({
    roomChargePaise: room.totalPaise,
    expenses: expenses.map((e) => ({ totalPaise: e.totalPaise })),
    advancePaise: Number(admission.advancePaise),
    discountPaise: 0,
  });
  return {
    ok: true,
    data: { ...balance, expenses, roomChargePaise: room.totalPaise, roomRatePaise: room.ratePaise, roomDays: room.days },
  };
}

export interface DischargeDiscountAuthorization {
  approverName: string;
  balance: DischargeBalance;
}

// Authorize a discharge discount ahead of the write: verify a supervisor PIN AND
// compute the discounted balance server-side (context "discharge" for a failed
// PIN). The discount is only truly written on discharge, which re-verifies the PIN
// and re-derives the amounts. Mirrors authorizeProcedureDiscountAction.
export async function authorizeDischargeDiscountAction(input: {
  admissionId: string;
  roomRate?: string;
  roomDays?: number;
  pct?: number;
  amount?: string;
  pin: string;
}): Promise<ActionResult<DischargeDiscountAuthorization>> {
  const s = await requireRole(IP_ROLES);
  const pinParsed = verifyPinSchema.safeParse({ pin: input.pin });
  if (!pinParsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(pinParsed.error) };
  }
  if (input.pct !== undefined && (!Number.isInteger(input.pct) || input.pct < 0 || input.pct > 100)) {
    return { ok: false, formError: "Enter a discount between 0 and 100%." };
  }
  if (input.amount !== undefined && input.amount !== "" && !isValidRupees(input.amount)) {
    return { ok: false, formError: "Enter a valid discount amount." };
  }
  const admission = await getAdmissionForDischarge(input.admissionId);
  if (!admission) return { ok: false, formError: "That admission no longer exists." };
  if (admission.status !== "admitted") {
    return { ok: false, formError: "This patient has already been discharged." };
  }
  const room = resolveRoom(input.roomRate, input.roomDays, storedRoom(admission));
  const expenses = admission.expenses.map((e) => ({ totalPaise: Number(e.totalPaise) }));
  const subtotalPaise = room.totalPaise + expenses.reduce((sum, e) => sum + e.totalPaise, 0);
  const discountPaise = resolveDiscountPaise(subtotalPaise, { pct: input.pct, amount: input.amount });
  if (discountPaise <= 0) {
    return { ok: false, formError: "Enter a discount percentage or amount." };
  }
  const approver = await findApproverByPin(pinParsed.data.pin);
  if (!approver) {
    await logFailedPinAttempt({
      actorId: s.sub,
      locationId: await getUserLocationId(s.sub),
      context: "discharge",
    });
    return { ok: false, fieldErrors: { pin: "PIN not recognised." } };
  }
  const balance = calculateDischargeBalance({
    roomChargePaise: room.totalPaise,
    expenses,
    advancePaise: Number(admission.advancePaise),
    discountPaise,
  });
  return { ok: true, data: { approverName: approver.name, balance } };
}

export interface DischargeOutcome {
  billId: string;
  billNumber: string;
  patientName: string;
  patientCode: string;
  balance: DischargeBalance;
  paymentMode: PaymentModeValue;
  approverName: string | null;
}

// Finalize a discharge: compute room + expenses − discount − advance, write the
// `ip` bill + items and flip the admission to discharged in ONE guarded
// transaction (plan §6a). A discount requires a supervisor PIN (canFinalizeBill
// mirrors the DB constraint). A double-discharge is blocked by the guarded UPDATE
// inside dischargeWithBill (returns null → clear error, one bill only).
export async function dischargeAction(input: unknown): Promise<ActionResult<DischargeOutcome>> {
  const s = await requireRole(IP_ROLES);
  const parsed = dischargeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const locationId = await getUserLocationId(s.sub);
  if (!locationId) {
    return { ok: false, formError: "Could not resolve your location. Please sign in again." };
  }

  const admission = await getAdmissionForDischarge(v.admissionId);
  if (!admission) return { ok: false, formError: "That admission no longer exists." };
  if (admission.status !== "admitted") {
    return { ok: false, formError: "This patient has already been discharged." };
  }

  const detail = await getAdmissionDetail(v.admissionId);
  const patientName = detail?.patient_name ?? "";
  const patientCode = detail?.patient_code ?? "";

  const room = resolveRoom(v.roomRate, v.roomDays, storedRoom(admission));

  // Resolve any supervisor-approved discount from the confirmed subtotal.
  const subtotalBeforeDiscount =
    room.totalPaise + admission.expenses.reduce((sum, e) => sum + Number(e.totalPaise), 0);
  let discountPaise = 0;
  let approverId: string | null = null;
  let approverName: string | null = null;
  const wantsDiscount = (v.discountPct && v.discountPct > 0) || (v.discountAmount && v.discountAmount !== "");
  if (wantsDiscount) {
    if (!v.discountPin) {
      return { ok: false, fieldErrors: { discountPin: "A supervisor PIN is required for a discount." } };
    }
    const approver = await findApproverByPin(v.discountPin);
    if (!approver) {
      await logFailedPinAttempt({ actorId: s.sub, locationId, context: "discharge" });
      return { ok: false, fieldErrors: { discountPin: "PIN not recognised." } };
    }
    discountPaise = resolveDiscountPaise(subtotalBeforeDiscount, {
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

  const balance = calculateDischargeBalance({
    roomChargePaise: room.totalPaise,
    expenses: admission.expenses.map((e) => ({ totalPaise: Number(e.totalPaise) })),
    advancePaise: Number(admission.advancePaise),
    discountPaise,
  });

  // Map the admission to bill lines: the room charge as one line, then each
  // expense as a line. To keep money EXACT with no division, each expense line
  // stores quantity 1 with unit_price = line_total = the expense's stored total,
  // and the original quantity lives in the description text (plan §6a mapping).
  // The room line carries the per-day breakdown in its description when known.
  const lines: { description: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }[] = [];
  if (room.totalPaise > 0) {
    const roomDesc =
      room.ratePaise != null && room.days != null
        ? `Room charge (${formatPaise(room.ratePaise)}/day x ${room.days})`
        : "Room charge";
    lines.push({
      description: roomDesc,
      quantity: 1,
      unitPricePaise: room.totalPaise,
      lineTotalPaise: room.totalPaise,
    });
  }
  for (const e of admission.expenses) {
    const total = Number(e.totalPaise);
    lines.push({
      description: e.quantity > 1 ? `${e.item} ×${e.quantity}` : e.item,
      quantity: 1,
      unitPricePaise: total,
      lineTotalPaise: total,
    });
  }

  const result = await dischargeWithBill({
    admissionId: v.admissionId,
    patientId: admission.patientId,
    roomChargePaise: room.totalPaise,
    roomRatePaise: room.ratePaise,
    roomDays: room.days,
    lines,
    subtotalPaise: balance.subtotalPaise,
    discountPaise: balance.discountPaise,
    totalPaise: balance.totalPaise,
    paymentMode: v.paymentMode,
    discountApprovedBy: approverId,
    createdBy: s.sub,
    locationId,
  });
  if (!result) {
    // The guarded UPDATE wrote nothing - a concurrent/double discharge.
    return { ok: false, formError: "This patient has already been discharged." };
  }

  await logActivity({
    actorId: s.sub,
    action: "admission.discharge",
    entity: "admission",
    targetId: v.admissionId,
    locationId,
    details: {
      bill_number: result.billNumber,
      total_paise: balance.totalPaise,
      balance_due_paise: balance.balanceDuePaise,
      refund_paise: balance.refundPaise,
      payment_mode: v.paymentMode,
    },
  });
  await logActivity({
    actorId: s.sub,
    action: "bill.finalize",
    entity: "bill",
    targetId: result.billId,
    locationId,
    details: { bill_number: result.billNumber, total_paise: balance.totalPaise, payment_mode: v.paymentMode },
  });
  if (discountPaise > 0 && approverId) {
    await logActivity({
      actorId: s.sub,
      action: "discount.approve",
      entity: "bill",
      targetId: result.billId,
      locationId,
      details: { discount_paise: discountPaise, approved_by: approverId },
    });
  }

  revalidatePath(PANEL_PATH);
  revalidatePath(`${PANEL_PATH}/${v.admissionId}`);
  return {
    ok: true,
    data: {
      billId: result.billId,
      billNumber: result.billNumber,
      patientName,
      patientCode,
      balance,
      paymentMode: v.paymentMode,
      approverName,
    },
  };
}
