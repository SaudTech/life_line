import { z } from "zod";

// Single source of truth for department-input shapes. CLIENT-SAFE: no
// "use server", no DB imports - imported by both the client combobox (instant
// inline errors) and the server actions (authoritative re-validation). A
// department is just a name, location-scoped - it used to be a fixed enum in
// lib/doctors/schema.ts; now the list lives in the DB so the hospital can add or
// remove one itself.
//
// departments.id is BIGINT, which pg returns as a numeric string - validate the
// shape rather than z.string().uuid() (departments are not UUIDs, like doctors).
const id = z.string().regex(/^\d+$/, "Invalid id.");
const name = z.string().trim().min(1, "Enter a department name.").max(100);

export const newDepartmentSchema = z.object({ name });
export type NewDepartmentValues = z.infer<typeof newDepartmentSchema>;

export const deleteDepartmentSchema = z.object({ id });
export type DeleteDepartmentValues = z.infer<typeof deleteDepartmentSchema>;
