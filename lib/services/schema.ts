import { z } from "zod";
import { isValidRupees } from "@/lib/money";

// How long a deactivated ("trashed") service is kept before it is permanently
// purged (plan follow-up: services behave like an OS Trash). Client-safe so the
// UI can show the countdown and the server can drive the purge from one number.
export const SERVICE_RETENTION_DAYS = 7;

// Single source of truth for service-input shapes (plan §1A). CLIENT-SAFE: no
// "use server", no DB imports - imported by both the client form (instant inline
// errors) and the server actions (authoritative re-validation, §8). The `price`
// is a rupee STRING here; the action converts it to integer paise via
// rupeesToPaise before storing (money never travels as a float - §4).
//
// A near-exact Doctors clone with fewer fields: a service is just a name and a
// price. services.id is BIGINT, which pg returns as a numeric string - validate
// the shape rather than z.string().uuid() (services are not UUIDs, like doctors).
const id = z.string().regex(/^\d+$/, "Invalid id.");
const name = z.string().trim().min(1, "Name is required.").max(100);
const price = z
  .string()
  .trim()
  .refine(isValidRupees, "Enter a valid amount (e.g. 50 or 50.00).");

export const newServiceSchema = z.object({ name, price });
export type NewServiceValues = z.infer<typeof newServiceSchema>;

export const updateServiceSchema = z.object({ id, name, price });
export type UpdateServiceValues = z.infer<typeof updateServiceSchema>;

// The billable toggle: Active = sold at the counter, Inactive = retired but kept.
export const setServiceActiveSchema = z.object({
  id,
  active: z.boolean(),
});
export type SetServiceActiveValues = z.infer<typeof setServiceActiveSchema>;

// The Trash toggle: trashed = scheduled for permanent deletion after the retention
// window; restoring (trashed=false) cancels it. Independent of `active`.
export const setServiceTrashedSchema = z.object({
  id,
  trashed: z.boolean(),
});
export type SetServiceTrashedValues = z.infer<typeof setServiceTrashedSchema>;
