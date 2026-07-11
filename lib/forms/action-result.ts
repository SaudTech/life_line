import type { ZodError } from "zod";

// Shared result contract for the RHF ⇄ Server Action bridge (plan D5). Pure and
// client-safe - no "use server", no DB imports - so both the client form and the
// server action can import it. On success an action may instead redirect() (which
// throws to unwind) rather than returning { ok: true }.
export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

// First error message per field, from a failed safeParse. Keyed by the joined
// zod issue path (e.g. "phone"); path-less issues collapse to "root".
export function zodFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "root";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
