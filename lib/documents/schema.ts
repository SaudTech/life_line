import { z } from "zod";

// Input schemas for the document actions/routes. Pure and client-safe.

// A bigint id as pg returns it - digits only, no signs, no padding.
const idSchema = z.string().regex(/^\d{1,18}$/, "Invalid id.");

export const recordRefSchema = z.object({
  recordType: z.enum(["opd", "ipd"]),
  recordId: idSchema,
});
export type RecordRef = z.infer<typeof recordRefSchema>;

export const documentIdSchema = z.object({
  documentId: idSchema,
});

export const patientIdSchema = z.object({
  patientId: idSchema,
});
