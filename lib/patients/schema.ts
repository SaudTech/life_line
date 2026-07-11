import { z } from "zod";

// Single source of truth for patient-input shapes (plan §5). CLIENT-SAFE: no
// "use server", no DB imports - imported by both the client form (instant inline
// errors) and the server actions (authoritative re-validation, §9). Mirrors
// lib/doctors/schema.ts.

// patients.id is BIGINT, which pg returns as a numeric string - validate the shape.
const id = z.string().regex(/^\d+$/, "Invalid id.");
const name = z.string().trim().min(1, "Name is required.").max(100);
// Phone is REQUIRED in the form (it's the lookup key) even though the column is
// nullable. Digits only; NON-unique - several patients may share one (mother +
// child), so we never dedupe by it (PROJECT_OVERVIEW §3).
const phone = z
  .string()
  .trim()
  .regex(/^\d{7,15}$/, "Enter a valid phone number (7-15 digits).");
// Age is optional: "" is allowed and normalised to NULL by the action; otherwise
// a whole number in a sane human range.
const age = z
  .union([z.coerce.number().int("Whole years only.").min(0, "Cannot be negative.").max(130, "Enter a valid age."), z.literal("")])
  .optional();
// Area is optional - "" allowed, normalised to NULL by the action.
const area = z.string().trim().max(100).optional().or(z.literal(""));
// Gender is optional - "" (unspecified) allowed, normalised to NULL by the action.
export const GENDERS = ["female", "male", "other"] as const;
const gender = z.enum(GENDERS).or(z.literal("")).optional();

export const newPatientSchema = z.object({ name, phone, age, area, gender });
export type NewPatientValues = z.infer<typeof newPatientSchema>;

export const updatePatientSchema = z.object({ id, name, phone, age, area, gender });
export type UpdatePatientValues = z.infer<typeof updatePatientSchema>;
