import { z } from "zod";

// Single source of truth for login input shape (plan D4). Client-safe: no
// "use server", no DB imports - imported by both the client form (instant inline
// errors) and the server action (authoritative re-validation).
//
// Validation is intentionally light - presence only. The real check is the
// credentials on the server; adding format rules here would leak hints about what
// a valid phone/password looks like, which the generic auth error deliberately hides.
export const loginSchema = z.object({
  phone: z.string().trim().min(1, "Enter your phone number."),
  password: z.string().min(1, "Enter your password."),
});

export type LoginValues = z.infer<typeof loginSchema>;
