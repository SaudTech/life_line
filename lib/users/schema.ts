import { z } from "zod";
import { PERMISSION_KEYS } from "@/lib/permissions";

// Single source of truth for user-management input shapes (plan §5). CLIENT-SAFE:
// no "use server", no DB imports - imported by both the client forms (instant
// inline errors) and the server actions (authoritative re-validation, §10). The
// role whitelist here is the same one the server trusts; never rely on the client
// <Select> alone.

export const ROLES = ["op_desk", "op_ip_desk", "supervisor", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  op_desk: "OP Desk",
  op_ip_desk: "OP + IP Desk",
  supervisor: "Supervisor",
  admin: "Admin",
};

// Plain-language description of what each role can do, shown on the card and in
// the add/edit dialog so the admin sees the effect of a role choice.
export const ROLE_ACCESS: Record<Role, string> = {
  op_desk: "OP counter access",
  op_ip_desk: "IP + OP counter access",
  supervisor: "Discount authorization",
  admin: "Full administrative access",
};

// Roles for which the discount-approval PIN is meaningful (plan D). The UI only
// shows the PIN controls for these; the schema still permits a PIN for any role
// so the server stays the authority, but callers gate on this set.
export const PIN_ROLES: readonly Role[] = ["supervisor", "admin"];

// Shared field rules. Phone is the sign-in identifier and is UNIQUE for staff
// (unlike patients.phone); a strict digit format keeps it clean at the DB's
// unique index. Email is optional - absent is stored as NULL, so "" is allowed
// and normalised away by the action.
const phone = z
  .string()
  .trim()
  .regex(/^\d{7,15}$/, "Enter a valid phone number (7-15 digits).");
const email = z
  .string()
  .trim()
  .email("Enter a valid email.")
  .optional()
  .or(z.literal(""));
const password = z.string().min(8, "Password must be at least 8 characters.");
const pin = z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits.");

// Granular permissions (plan 1B). Each entry must be a KEY from the typed registry
// (lib/permissions.ts) - the server rejects any key not in the registry (plan
// B-4), so the client checkbox list can never smuggle in an unknown capability.
// The registry is intentionally EMPTY today (no grantable capability yet), and
// z.enum can't take an empty tuple - so guard it: no keys ⇒ only an empty grant
// list validates (any stray key is rejected). Re-add the z.enum branch the day a
// real permission returns.
const permissions =
  PERMISSION_KEYS.length > 0
    ? z.array(z.enum(PERMISSION_KEYS as unknown as [string, ...string[]])).default([])
    : z.array(z.never()).default([]);

export const newUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100),
  phone,
  role: z.enum(ROLES),
  password,
  email,
  pin: z.union([pin, z.literal("")]).optional(), // optional; "" = no PIN
  permissions,
});
export type NewUserValues = z.infer<typeof newUserSchema>;

export const updateUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required.").max(100),
  phone,
  role: z.enum(ROLES),
  email,
  permissions,
});
export type UpdateUserValues = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({
  id: z.string().uuid(),
  password,
});
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

// Client-only form for the reveal-and-confirm password reset UI: the admin types
// the new password twice. The `id` is supplied by the panel, not the form, and
// only { id, password } is sent to resetPasswordAction (which re-validates).
export const resetPasswordFormSchema = z
  .object({ password, confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;

// "" clears the PIN (pin_hash = NULL); a 4-6 digit value sets it.
export const setPinSchema = z.object({
  id: z.string().uuid(),
  pin: z.union([pin, z.literal("")]),
});
export type SetPinValues = z.infer<typeof setPinSchema>;

// Client-only form for the reveal-and-confirm "Set PIN" UI (clearing is a direct
// button, no form). PIN entered twice; only the value is sent to setPinAction.
export const setPinFormSchema = z
  .object({ pin, confirmPin: z.string() })
  .refine((d) => d.pin === d.confirmPin, {
    message: "PINs do not match.",
    path: ["confirmPin"],
  });
export type SetPinFormValues = z.infer<typeof setPinFormSchema>;

export const setActiveSchema = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
});
export type SetActiveValues = z.infer<typeof setActiveSchema>;
