import { z } from "zod";
import { PAYMENT_MODES, type PaymentModeValue } from "@/lib/consultations/schema";
import { isValidRupees } from "@/lib/money";

// Client-safe input shapes for the OPD procedures flow (no "use server", no DB) -
// shared by the client flow (inline errors) and the server actions (authoritative
// re-validation, §9). Mirrors lib/consultations/schema.ts.

const id = z.string().regex(/^\d+$/, "Invalid id.");
const phone = z
  .string()
  .trim()
  .regex(/^\d{7,15}$/, "Enter a valid phone number (7-15 digits).");

// A 4-digit supervisor discount PIN.
const pin = z.string().regex(/^\d{4}$/, "Enter the 4-digit PIN.");

// Find the target consultation EITHER by the patient's phone (picks from their
// active consultations) OR directly by consultation number - never both, never
// neither (plan §4C).
export const lookupProcedureSchema = z
  .object({
    phone: phone.optional(),
    consultationNumber: id.optional(),
  })
  .refine((v) => (v.phone ? 1 : 0) + (v.consultationNumber ? 1 : 0) === 1, {
    message: "Enter a phone number or a consultation number.",
    path: ["phone"],
  });
export type LookupProcedureValues = z.infer<typeof lookupProcedureSchema>;

// One billed line: a service + how many. Price is never client-supplied - the
// server re-prices every line from the service's current price_paise (plan §4E).
// Quantity is capped (matching the flow's 4-digit input): without an upper bound
// a crafted request could send a huge quantity, and unit_price_paise * quantity
// would exceed Number.MAX_SAFE_INTEGER (9e15) while still fitting the BIGINT
// column - silently corrupting the stored money (DEVELOPMENT_RULES §4, never let
// a JS number silently corrupt a total). 9999 keeps every product integer-safe.
export const procedureLineSchema = z.object({
  serviceId: id,
  quantity: z.coerce
    .number()
    .int()
    .min(1, "Quantity must be at least 1.")
    .max(9999, "Quantity is too large."),
});
export type ProcedureLineValues = z.infer<typeof procedureLineSchema>;

// Submit a finalized procedure bill for a patient - optionally against an
// active consultation (a consultation just links the bill for context; a
// procedure can also be billed standalone, e.g. walk-in items with no
// consultation on file). Discount is EITHER a percentage OR a flat rupee
// amount (percent wins if both given, mirrors consultations); the server
// ignores the client's money and re-derives it all.
export const submitProcedureSchema = z.object({
  patientId: id,
  consultationId: id.optional(),
  lines: z.array(procedureLineSchema).min(1, "Add at least one line."),
  paymentMode: z.enum(PAYMENT_MODES),
  discountPct: z.coerce.number().int().min(0).max(100).optional(),
  discountAmount: z
    .string()
    .trim()
    .refine((v) => v === "" || isValidRupees(v), "Enter a valid amount.")
    .optional(),
  discountPin: pin.optional(),
  // Set when this bill corrects a voided one (re-issue, plan §Part B) - the id of
  // that voided bill, linked to the new one on the server.
  replacesBillId: id.optional(),
});
export type SubmitProcedureValues = z.infer<typeof submitProcedureSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date.");
const amount = z
  .string()
  .trim()
  .refine((v) => v === "" || isValidRupees(v), "Enter a valid amount.");

// All-optional filters for the "all procedures" list (plan follow-up). Every
// field narrows the query further; an absent field means "don't filter on
// this". createdBy is a user id (UUID, like other user references); dateFrom/
// dateTo are inclusive clinic-calendar days.
export const procedureBillFiltersSchema = z.object({
  q: z.string().optional(),
  createdBy: z.string().uuid().optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  minAmount: amount.optional(),
  maxAmount: amount.optional(),
  serviceId: id.optional(),
});
export type ProcedureBillFiltersValues = z.infer<typeof procedureBillFiltersSchema>;

export type { PaymentModeValue };
export { PAYMENT_MODES };
