import { z } from "zod";
import { newPatientSchema } from "@/lib/patients/schema";
import { PAYMENT_MODES, type PaymentModeValue } from "@/lib/consultations/schema";
import { isValidRupees } from "@/lib/money";

// Client-safe input shapes for the in-patient admit → discharge flow (plan §5/§6) -
// no "use server", no DB. Shared by the client flow (inline errors) and the server
// actions (authoritative re-validation, §9). The new-patient path reuses
// newPatientSchema verbatim so registration rules never drift between screens.

const id = z.string().regex(/^\d+$/, "Invalid id.");
const pin = z.string().regex(/^\d{4}$/, "Enter the 4-digit PIN.");

// A rupee amount required to be present and valid (advance at admission).
const requiredRupees = z
  .string()
  .trim()
  .refine((v) => isValidRupees(v), "Enter a valid amount.");

// A rupee amount that may be blank ("" → 0 paise, handled by the action).
const optionalRupees = z
  .string()
  .trim()
  .refine((v) => v === "" || isValidRupees(v), "Enter a valid amount.");

// The room charge is a per-day rate × number of days (plan §In-Patient). The rate
// is a rupee amount; days is a whole number, capped so rate × days stays
// integer-safe (a rupee amount is at most ~99 lakh = 9.9e8 paise; × 999 days is
// well within Number.MAX_SAFE_INTEGER). Both optional - the room can be left for
// discharge. The server computes the total (rate × days) and stores all three.
const roomDays = z.coerce.number().int().min(1, "At least 1 day.").max(999, "Too many days.");

// Admit a patient: EITHER an existing patient (patientId) OR a brand-new one
// (newPatient) - exactly one, never both. Record the advance (required) and its
// payment mode. Only the room RATE/day is captured here (optional) - the number of
// days is unknown at admission, so it (and the room total) are set at discharge.
export const admitSchema = z
  .object({
    patientId: id.optional(),
    newPatient: newPatientSchema.optional(),
    advanceAmount: requiredRupees,
    paymentMode: z.enum(PAYMENT_MODES),
    roomRate: optionalRupees.optional(),
  })
  .refine((v) => (v.patientId ? 1 : 0) + (v.newPatient ? 1 : 0) === 1, {
    message: "Select an existing patient or enter a new one.",
    path: ["patientId"],
  });
export type AdmitValues = z.infer<typeof admitSchema>;

// Add one catalog expense to an admission. Price is NEVER client-supplied - the
// server re-prices the service from its current price_paise (plan §5c). Quantity
// is capped so unit_price × quantity can't overflow Number.MAX_SAFE_INTEGER while
// still fitting the BIGINT column (same discipline as procedure lines).
export const addExpenseSchema = z.object({
  admissionId: id,
  serviceId: id,
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1.").max(9999, "Quantity is too large."),
});
export type AddExpenseValues = z.infer<typeof addExpenseSchema>;

export const removeExpenseSchema = z.object({
  admissionId: id,
  expenseId: id,
});
export type RemoveExpenseValues = z.infer<typeof removeExpenseSchema>;

// Adjust an existing catalog expense - its quantity and/or which catalog service
// it is (a tally line stays editable until discharge, so a mis-picked service is
// corrected in place rather than deleted and re-added). Like adding, the price is
// NEVER client-supplied - the server re-prices the item from its current catalog
// price and recomputes quantity × price. Same quantity cap as addExpenseSchema.
// serviceId omitted = keep the line's current service, change quantity only.
export const updateExpenseSchema = z.object({
  admissionId: id,
  expenseId: id,
  serviceId: id.optional(),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1.").max(9999, "Quantity is too large."),
});
export type UpdateExpenseValues = z.infer<typeof updateExpenseSchema>;

// Discharge: confirm the room (rate/day + days) + collect the settlement. Discount
// is EITHER a percentage OR a flat rupee amount (percent wins if both given); the
// server re-derives every paise value and requires a supervisor PIN for any discount.
export const dischargeSchema = z.object({
  admissionId: id,
  roomRate: optionalRupees.optional(),
  roomDays: roomDays.optional(),
  paymentMode: z.enum(PAYMENT_MODES),
  discountPct: z.coerce.number().int().min(0).max(100).optional(),
  discountAmount: optionalRupees.optional(),
  discountPin: pin.optional(),
});
export type DischargeValues = z.infer<typeof dischargeSchema>;

export { PAYMENT_MODES };
export type { PaymentModeValue };
