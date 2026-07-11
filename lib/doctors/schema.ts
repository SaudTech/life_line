import { z } from "zod";
import { isValidRupees } from "@/lib/money";

// Single source of truth for doctor-input shapes (plan §5). CLIENT-SAFE: no
// "use server", no DB imports - imported by both the client form (instant inline
// errors) and the server actions (authoritative re-validation, §9). The `fee` is
// a rupee STRING here; the action converts it to integer paise via
// rupeesToPaise before storing (money never travels as a float - §4A).

// doctors.id is BIGINT, which pg returns as a numeric string - validate the shape
// rather than z.string().uuid() (doctors are not UUIDs, unlike users).
const id = z.string().regex(/^\d+$/, "Invalid id.");
const name = z.string().trim().min(1, "Name is required.").max(100);
// Department is optional - "" is allowed and normalised to NULL by the action.
const department = z.string().trim().max(100).optional().or(z.literal(""));
const fee = z
  .string()
  .trim()
  .refine(isValidRupees, "Enter a valid amount (e.g. 250 or 250.50).");
const revisitValidityDays = z.coerce
  .number()
  .int("Whole days only.")
  .min(0, "Cannot be negative.")
  .max(3650, "That's too many days.");

export const newDoctorSchema = z.object({
  name,
  department,
  fee,
  revisitValidityDays,
});
export type NewDoctorValues = z.infer<typeof newDoctorSchema>;

export const updateDoctorSchema = z.object({
  id,
  name,
  department,
  fee,
  revisitValidityDays,
});
export type UpdateDoctorValues = z.infer<typeof updateDoctorSchema>;

export const setDoctorActiveSchema = z.object({
  id,
  active: z.boolean(),
});
export type SetDoctorActiveValues = z.infer<typeof setDoctorActiveSchema>;
