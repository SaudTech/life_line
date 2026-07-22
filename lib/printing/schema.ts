import { z } from "zod";

// Single source of truth for receipt-template input shapes (mirrors
// lib/services/schema.ts). CLIENT-SAFE: no "use server", no DB imports.

// `advance` and `end_day` added (plan §4a) so the designer/actions accept them.
// Both are fully designable (catalog + checked-in default in lib/printing).
export const BILL_TYPES = ["consultation", "procedure", "ip", "advance", "end_day"] as const;
export const billTypeSchema = z.enum(BILL_TYPES);

export const getTemplateSchema = z.object({ type: billTypeSchema });
export type GetTemplateValues = z.infer<typeof getTemplateSchema>;

// A template id (bill_templates.id is a BIGINT, returned by pg as a string).
const templateIdSchema = z.string().trim().min(1, "A design id is required.");
const templateNameSchema = z.string().trim().min(1, "Name is required.").max(100);

// `schemaJson` is the raw pdfme Template - a plain JSON object here (deep
// structural validity is checked in the action via pdfme's own checkTemplate,
// not re-implemented as a zod shape).
const templateJsonSchema = z.custom<Record<string, unknown>>(
  (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  "Invalid template.",
);

// Create a new design. `name`/`schemaJson` optional: a "New design" click sends
// only `type`, and the server seeds the checked-in default and a starter name.
export const createTemplateSchema = z.object({
  type: billTypeSchema,
  name: templateNameSchema.optional(),
  schemaJson: templateJsonSchema.optional(),
});
export type CreateTemplateValues = z.infer<typeof createTemplateSchema>;

// The editor's "Save" - update THIS design in place (name + layout).
export const updateTemplateSchema = z.object({
  id: templateIdSchema,
  name: templateNameSchema,
  schemaJson: templateJsonSchema,
});
export type UpdateTemplateValues = z.infer<typeof updateTemplateSchema>;

// Rename only (thin update).
export const renameTemplateSchema = z.object({
  id: templateIdSchema,
  name: templateNameSchema,
});
export type RenameTemplateValues = z.infer<typeof renameTemplateSchema>;

// Address a single design by id (activate / duplicate / delete / fetch one).
export const templateIdOnlySchema = z.object({ id: templateIdSchema });
export type TemplateIdValues = z.infer<typeof templateIdOnlySchema>;

// Best-effort print audit (print plan §4) - logged from the client's explicit
// click, never from the GET route itself, so an iframe re-fetch (retry, print
// preview re-render) never double-counts a single print.
export const logReceiptPrintedSchema = z.object({
  billId: z.string().min(1),
  billNumber: z.string().min(1),
  copy: z.enum(["original", "duplicate"]),
});
export type LogReceiptPrintedValues = z.infer<typeof logReceiptPrintedSchema>;
