import { z } from "zod";

// Single source of truth for the suggestion-input shape. CLIENT-SAFE: no
// "use server", no DB imports - imported by both the client widget (instant
// inline error) and the server action (authoritative re-validation, §9).

const message = z
  .string()
  .trim()
  .min(3, "Tell us a bit more.")
  .max(2000, "Keep it under 2000 characters.");
// The page the user was on when they wrote it - context for whoever reads the
// note later. Not user input to validate against a business rule, just a
// bounded string so a stray value can never blow past the DB column.
const pagePath = z.string().trim().max(300).optional();

export const newSuggestionSchema = z.object({ message, pagePath });
export type NewSuggestionValues = z.infer<typeof newSuggestionSchema>;
