import { z } from "zod";
import { isValidRupees, isRupeesTooLarge, MAX_RUPEES } from "@/lib/money";

// Shown instead of the generic format message when the amount is shaped like a
// number but exceeds the cap (e.g. "99999999") - "invalid format" is the wrong
// error for a well-formed number that's simply too big.
const AMOUNT_TOO_LARGE = `Amount is too large (max ₹${MAX_RUPEES.toLocaleString("en-IN")}).`;

// Single source of truth for doctor-input shapes (plan §5). CLIENT-SAFE: no
// "use server", no DB imports - imported by both the client form (instant inline
// errors) and the server actions (authoritative re-validation, §9). The `fee` is
// a rupee STRING here; the action converts it to integer paise via
// rupeesToPaise before storing (money never travels as a float - §4A).

// Department used to be a fixed enum here. It's now a DB-backed master list
// (migration 0020, lib/departments/*) so the hospital can add or retire one
// itself - the client combobox sources its options from listActiveDepartments(),
// not a constant. This schema only checks that SOME non-blank name was chosen;
// the server action is what checks it's a real, active department for the
// doctor's location (never trust the client).

// A doctor's current duty state - separate from `active` (plan D: active only
// gates whether the doctor can be picked for a NEW consultation; a doctor can
// stay active but be on leave today).
export const DOCTOR_STATUSES = ["available", "on_leave", "unavailable"] as const;
export type DoctorStatus = (typeof DOCTOR_STATUSES)[number];
export const DOCTOR_STATUS_LABELS: Record<DoctorStatus, string> = {
  available: "Available",
  on_leave: "On Leave",
  unavailable: "Unavailable",
};

// doctors.id is BIGINT, which pg returns as a numeric string - validate the shape
// rather than z.string().uuid() (doctors are not UUIDs, unlike users).
const id = z.string().regex(/^\d+$/, "Invalid id.");
const name = z.string().trim().min(1, "Name is required.").max(100);
const department = z.string().trim().min(1, "Select a department.").max(100);
// Phone is required, but (unlike lib/users/schema's phone) doctors don't sign
// in, so no uniqueness/lock-out rules apply here.
const phone = z
  .string()
  .trim()
  .regex(/^\d{7,15}$/, "Enter a valid phone number (7-15 digits).");
const status = z.enum(DOCTOR_STATUSES);
const fee = z
  .string()
  .trim()
  .refine((v) => isValidRupees(v) || isRupeesTooLarge(v), "Enter a valid amount (e.g. 250 or 250.50).")
  .refine((v) => !isRupeesTooLarge(v), AMOUNT_TOO_LARGE);
const revisitValidityDays = z.coerce
  .number()
  .int("Whole days only.")
  .min(0, "Cannot be negative.")
  .max(3650, "That's too many days.");

// The doctor's share of the consultation fee, quoted either as a whole percent
// OR a flat rupee amount - never both. One text field (`doctorShareValue`) plus
// a type toggle (`doctorShareType`), mirroring the existing discount pct/amount
// pattern (lib/billing/discount.ts) rather than adding two separate inputs.
// `doctorShareValue`'s meaning - and therefore its validation - depends on
// `doctorShareType`, so it's checked in `withDoctorShare` below, not here.
export const DOCTOR_SHARE_TYPES = ["percentage", "flat"] as const;
export type DoctorShareType = (typeof DOCTOR_SHARE_TYPES)[number];
const doctorShareType = z.enum(DOCTOR_SHARE_TYPES);
const doctorShareValue = z.string().trim();

const PERCENTAGE_RE = /^\d{1,3}$/;

// Cross-field check shared by both schemas below (they otherwise diverge only
// by `id`) - keeps the percent/flat validation in one place.
function validateDoctorShare(
  v: { doctorShareType: DoctorShareType; doctorShareValue: string },
  ctx: z.RefinementCtx,
) {
  if (v.doctorShareType === "percentage") {
    if (!PERCENTAGE_RE.test(v.doctorShareValue) || Number(v.doctorShareValue) > 100) {
      ctx.addIssue({
        code: "custom",
        path: ["doctorShareValue"],
        message: "Enter a whole percentage from 0 to 100.",
      });
    }
  } else if (isRupeesTooLarge(v.doctorShareValue)) {
    ctx.addIssue({ code: "custom", path: ["doctorShareValue"], message: AMOUNT_TOO_LARGE });
  } else if (!isValidRupees(v.doctorShareValue)) {
    ctx.addIssue({
      code: "custom",
      path: ["doctorShareValue"],
      message: "Enter a valid amount (e.g. 250 or 250.50).",
    });
  }
}

// Which consultation receipt design this doctor's bills print on (migration
// 0024). "" means "use the default" - the location's ACTIVE consultation design
// - and is what every doctor has until an admin picks otherwise; anything else
// is a bill_templates id. The shape is all that's checked here: that the id is a
// real, CONSULTATION design at this doctor's location can only be verified
// against the DB, so the action does it (never trust the client).
const consultationTemplateId = z
  .string()
  .trim()
  .regex(/^\d*$/, "Select a design from the list.")
  .default("");

const doctorShareShape = { doctorShareType, doctorShareValue };

export const newDoctorSchema = z
  .object({
    name,
    department,
    phone,
    status,
    fee,
    revisitValidityDays,
    consultationTemplateId,
    ...doctorShareShape,
  })
  .superRefine(validateDoctorShare);
export type NewDoctorValues = z.infer<typeof newDoctorSchema>;

export const updateDoctorSchema = z
  .object({
    id,
    name,
    department,
    phone,
    status,
    fee,
    revisitValidityDays,
    consultationTemplateId,
    ...doctorShareShape,
  })
  .superRefine(validateDoctorShare);
export type UpdateDoctorValues = z.infer<typeof updateDoctorSchema>;

export const setDoctorActiveSchema = z.object({
  id,
  active: z.boolean(),
});
export type SetDoctorActiveValues = z.infer<typeof setDoctorActiveSchema>;
