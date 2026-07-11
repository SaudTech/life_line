import { z } from "zod";

// Client-safe input shapes for bill correction (void + re-issue) - no "use
// server", no DB - shared by the client dialog (inline errors) and the server
// action (authoritative re-validation, §9). Mirrors lib/consultations/schema.ts.

const id = z.string().regex(/^\d+$/, "Invalid id.");

// A 4-digit supervisor PIN - the same shape as the discount PIN, reused because
// voiding reverses money and is gated on a supervisor exactly like a discount.
const pin = z.string().regex(/^\d{4}$/, "Enter the 4-digit PIN.");

// Void a finalized bill. A reason is REQUIRED (trimmed, non-empty, capped) so
// every void carries why it happened for the audit trail; the supervisor PIN is
// verified server-side against every approver's hash.
export const voidBillSchema = z.object({
  billId: id,
  reason: z
    .string()
    .trim()
    .min(1, "Enter a reason for voiding.")
    .max(500, "Keep the reason under 500 characters."),
  pin,
});
export type VoidBillValues = z.infer<typeof voidBillSchema>;
