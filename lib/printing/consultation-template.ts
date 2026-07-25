// PURE rule for per-doctor consultation designs (migration 0024). No DB import
// on purpose - the resolver that fetches rows and calls this lives in
// ./repository, exactly so the rule stays unit-testable without a database
// (dev-rules §2: one source of truth per rule, tested).
//
// THE RULE: a consultation prints the doctor's own design when the doctor has
// one AND it is still usable; otherwise the location's ACTIVE consultation
// design. "Usable" is re-checked here rather than trusted, because the FK on
// doctors.consultation_template_id can only guarantee the row EXISTS - not that
// it is a consultation design, nor that it belongs to this bill's location. A
// design that fails either check is never printed; the caller falls back to the
// active design, so a mis-pointed row degrades to the standard receipt instead
// of printing a procedure/IP layout on a consultation bill.

// The minimum a candidate row must expose to be judged. Deliberately structural
// (not BillTemplateRow) so this file stays free of DB types.
export interface CandidateTemplate {
  bill_type: string;
  location_id: string;
}

export function isUsableConsultationTemplate(
  candidate: CandidateTemplate | null | undefined,
  locationId: string,
): boolean {
  if (!candidate) return false; // no design assigned, or the row is gone
  if (candidate.bill_type !== "consultation") return false; // wrong kind of design
  // The BILL's location decides (multi-branch ready, same rule the print route
  // already applies): branch A must never print branch B's design.
  return String(candidate.location_id) === String(locationId);
}
