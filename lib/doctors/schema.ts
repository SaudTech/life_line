import { z } from "zod";
import { isValidRupees } from "@/lib/money";

// Single source of truth for doctor-input shapes (plan §5). CLIENT-SAFE: no
// "use server", no DB imports - imported by both the client form (instant inline
// errors) and the server actions (authoritative re-validation, §9). The `fee` is
// a rupee STRING here; the action converts it to integer paise via
// rupeesToPaise before storing (money never travels as a float - §4A).

// Fixed department list (mirrors lib/users/schema's ROLES pattern) - department
// is now a required dropdown, not free text. The DB column stays plain TEXT
// (migration 0016), so existing rows never needed a backfill; only new writes
// are constrained to this set.
//
// Deliberately broad: this is an onsite install with no self-serve deploy, so a
// missing department means a site visit to ship a fix. Erring toward "too many
// options" costs nothing (the Combobox is searchable); erring toward "too few"
// costs a truck roll - so the list covers every department a general hospital
// is likely to run, not just what today's doctors happen to need.
//
// Named by the practitioner's TITLE ("Cardiologist"), not the specialty noun
// ("Cardiology") - this is how Indian hospitals/clinics label doctors in
// practice (a board, a prescription pad, a Google listing all say "Dr. X,
// Pulmonologist", never "Dr. X, Pulmonology").
export const DEPARTMENTS = [
  "General Physician",
  "General Surgeon",
  "Cardiologist",
  "Cardiothoracic Surgeon (CTVS)",
  "Orthopedician",
  "Pediatrician",
  "Neonatologist",
  "Gynecologist",
  "Obstetrician",
  "ENT Specialist",
  "Dermatologist (Skin Specialist)",
  "Cosmetologist",
  "Neurologist",
  "Neurosurgeon",
  "Psychiatrist",
  "Psychologist",
  "Ophthalmologist (Eye Specialist)",
  "Dentist",
  "Oral & Maxillofacial Surgeon",
  "Urologist",
  "Nephrologist",
  "Radiologist",
  "Anesthetist",
  "Gastroenterologist",
  "Endocrinologist",
  "Pulmonologist",
  "Rheumatologist",
  "Oncologist",
  "Hematologist",
  "Plastic Surgeon",
  "Vascular Surgeon",
  "Emergency Medicine Specialist",
  "Intensivist (Critical Care)",
  "Physiotherapist",
  "Dietitian / Nutritionist",
  "Pathologist",
  "Microbiologist",
  "Family Physician",
  "Geriatrician",
  "Sports Medicine Specialist",
  "Pain Management Specialist",
  "Diabetologist",
  "Andrologist",
  "Infectious Disease Specialist",
  "Allergist / Immunologist",
  "Homeopath",
  "Ayurvedic Doctor",
  "Physiatrist (Rehabilitation)",
  "Other",
] as const;
export type Department = (typeof DEPARTMENTS)[number];

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
const department = z.enum(DEPARTMENTS, { message: "Select a department." });
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
  .refine(isValidRupees, "Enter a valid amount (e.g. 250 or 250.50).");
const revisitValidityDays = z.coerce
  .number()
  .int("Whole days only.")
  .min(0, "Cannot be negative.")
  .max(3650, "That's too many days.");

export const newDoctorSchema = z.object({
  name,
  department,
  phone,
  status,
  fee,
  revisitValidityDays,
});
export type NewDoctorValues = z.infer<typeof newDoctorSchema>;

export const updateDoctorSchema = z.object({
  id,
  name,
  department,
  phone,
  status,
  fee,
  revisitValidityDays,
});
export type UpdateDoctorValues = z.infer<typeof updateDoctorSchema>;

export const setDoctorActiveSchema = z.object({
  id,
  active: z.boolean(),
});
export type SetDoctorActiveValues = z.infer<typeof setDoctorActiveSchema>;
