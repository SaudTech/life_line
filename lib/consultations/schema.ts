import { z } from "zod";
import { newPatientSchema } from "@/lib/patients/schema";
import { isValidRupees } from "@/lib/money";

// Client-safe input shapes for the consultation flow (no "use server", no DB) -
// shared by the client flow (inline errors) and the server action (authoritative
// re-validation, §9). The new-patient path reuses newPatientSchema verbatim so
// registration rules never drift between the two screens.

const id = z.string().regex(/^\d+$/, "Invalid id.");
const phone = z
  .string()
  .trim()
  .regex(/^\d{7,15}$/, "Enter a valid phone number (7-15 digits).");

export const PAYMENT_MODES = ["cash", "card", "upi", "other"] as const;
export type PaymentModeValue = (typeof PAYMENT_MODES)[number];

export const lookupPhoneSchema = z.object({ phone });
export type LookupPhoneValues = z.infer<typeof lookupPhoneSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date.");

// All-optional filters for the "all consultations" list. Every field narrows
// the query further; an absent field means "don't filter on this". dateFrom/
// dateTo are inclusive clinic-calendar days. Mirrors
// lib/procedures/schema.ts's procedureBillFiltersSchema.
export const consultationFiltersSchema = z.object({
  q: z.string().optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});
export type ConsultationFiltersValues = z.infer<typeof consultationFiltersSchema>;

// A 4-digit supervisor discount PIN.
const pin = z.string().regex(/^\d{4}$/, "Enter the 4-digit PIN.");
export const verifyPinSchema = z.object({ pin });

// A consultation is for a chosen doctor and EITHER an existing patient (patientId)
// OR a brand-new one (newPatient) - exactly one of the two, never both. The paid
// path also carries the reason, payment mode, and any supervisor-approved discount
// (percent + PIN); the server ignores these for a free revisit.
export const startConsultationSchema = z
  .object({
    doctorId: id,
    patientId: id.optional(),
    newPatient: newPatientSchema.optional(),
    reason: z.string().trim().max(500).optional().or(z.literal("")),
    paymentMode: z.enum(PAYMENT_MODES).optional(),
    // A discount is EITHER a percentage OR a flat rupee amount (the server picks
    // percent first). Both are inputs; the paise value is computed server-side.
    discountPct: z.coerce.number().int().min(0).max(100).optional(),
    discountAmount: z.string().trim().refine(isValidRupees, "Enter a valid amount.").optional(),
    discountPin: pin.optional(),
    // Set when this consultation corrects a voided bill (re-issue, plan §Part B) -
    // the id of that voided bill, linked to the new one on the server.
    replacesBillId: id.optional(),
  })
  .refine((v) => (v.patientId ? 1 : 0) + (v.newPatient ? 1 : 0) === 1, {
    message: "Select an existing patient or enter a new one.",
    path: ["patientId"],
  });
export type StartConsultationValues = z.infer<typeof startConsultationSchema>;
