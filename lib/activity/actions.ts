// The canonical activity-tag registry - the single source of truth for every
// action tag the app may write to audit_log (the app-wide activity log). PURE and
// client-safe: no DB, no React, no server-only imports, so both the logging helper
// (server) and formatActivity (used to render the dashboard feed) share ONE
// definition of what a tag means (DEVELOPMENT_RULES §2, one source of truth).
//
// Naming convention: `domain.verb`, lower_snake. Adding a feature = add its tags
// HERE (never an ad-hoc string at the call site). The typed ActivityAction union
// below makes a mistyped tag a COMPILE error, not a silent bad row.

export type Tone = "accent" | "success" | "warning" | "danger";
export interface ActivityMeta {
  label: string;
  tone: Tone;
}

// ONE place that defines every tag the app may emit. `as const satisfies` keeps
// the literal keys (for the ActivityAction union) while checking every value is a
// valid ActivityMeta.
export const ACTIVITY = {
  // ── Auth ───────────────────────────────────────────────────────────────
  "auth.sign_in":         { label: "Signed in",                 tone: "accent"  },
  "auth.sign_out":        { label: "Signed out",                tone: "accent"  },
  "auth.sign_in_failed":  { label: "Failed sign-in attempt",    tone: "warning" }, // defined; wiring is a later security pass

  // ── Staff / users ──────────────────────────────────────────────────────
  "user.create":          { label: "New staff created",         tone: "success" },
  "user.update":          { label: "Staff account updated",     tone: "accent"  },
  "user.password_reset":  { label: "Password reset",            tone: "warning" },
  "user.password_change": { label: "Password changed",          tone: "accent"  }, // self-service - actor and target are the same user
  "user.pin_set":         { label: "Discount PIN set",          tone: "accent"  },
  "user.pin_clear":       { label: "Discount PIN cleared",      tone: "accent"  },
  "user.deactivate":      { label: "Staff account deactivated", tone: "danger"  },
  "user.activate":        { label: "Staff account reactivated", tone: "success" },
  "user.permissions_change": { label: "Permissions updated",    tone: "accent"  },

  // ── Patients ───────────────────────────────────────────────────────────
  "patient.create":       { label: "Patient registered",        tone: "success" },
  "patient.update":       { label: "Patient details updated",   tone: "accent"  },

  // ── Doctors ────────────────────────────────────────────────────────────
  "doctor.create":        { label: "Doctor added",              tone: "success" },
  "doctor.update":        { label: "Doctor updated",            tone: "accent"  },
  "doctor.activate":      { label: "Doctor reactivated",        tone: "success" },
  "doctor.deactivate":    { label: "Doctor deactivated",        tone: "danger"  },

  // ── Departments ────────────────────────────────────────────────────────
  "department.create":     { label: "Department added",         tone: "success" },
  "department.delete":     { label: "Department removed",       tone: "danger"  },

  // ── Services / items ───────────────────────────────────────────────────
  "service.create":       { label: "Service added",             tone: "success" },
  "service.update":       { label: "Service updated",           tone: "accent"  },
  "service.activate":     { label: "Service reactivated",        tone: "success" },
  "service.deactivate":   { label: "Service deactivated",        tone: "warning" },
  "service.trash":        { label: "Service moved to Trash",     tone: "warning" },
  "service.restore":      { label: "Service restored from Trash", tone: "success" },
  "service.delete":       { label: "Service permanently deleted", tone: "danger" },

  // ── Consultations / visits ─────────────────────────────────────────────
  "consultation.create":  { label: "Consultation started",      tone: "accent"  },
  "consultation.revisit": { label: "Free revisit recorded",     tone: "accent"  },
  // A revisit past the free window, billed at one of the doctor's reduced rates
  // (migration 0027) - money changed hands, so it is its own kind of event.
  "consultation.revisit_paid": { label: "Revisit at reduced rate", tone: "accent" },

  // ── Bills ──────────────────────────────────────────────────────────────
  "bill.create":          { label: "Bill created",              tone: "accent"  },
  "bill.finalize":        { label: "Bill finalized",            tone: "success" },
  "bill.void":            { label: "Bill voided",               tone: "danger"  },
  "bill.reissue":         { label: "Bill re-issued",            tone: "accent"  },
  "bill.reprint":         { label: "Bill reprinted",            tone: "accent"  },
  "receipt.printed":      { label: "Receipt printed",           tone: "accent"  },

  // ── Doctor payouts (migration 0026) ────────────────────────────────────
  // Cash leaving the drawer to a doctor. "success" like a finalized bill: it is a
  // completed money movement, not a warning.
  "doctor.payout":        { label: "Doctor paid",               tone: "success" },

  // ── Discounts ──────────────────────────────────────────────────────────
  "discount.request":     { label: "Discount pending approval", tone: "warning" },
  "discount.approve":     { label: "Discount approved",         tone: "success" },
  "discount.decline":     { label: "Discount declined",         tone: "danger"  },
  "discount.pin_failed":  { label: "Failed discount PIN attempt", tone: "danger" },

  // ── In-patient (admit / discharge) ─────────────────────────────────────
  "admission.admit":           { label: "Patient admitted",           tone: "accent"  },
  "admission.discharge":       { label: "Patient discharged",         tone: "success" },
  "admission.advance_printed": { label: "Advance receipt printed",    tone: "accent"  },
  "admission.expense_added":   { label: "IP expense added",           tone: "accent"  },
  "admission.expense_updated": { label: "IP expense quantity changed", tone: "accent"  },
  "admission.expense_removed": { label: "IP expense removed",         tone: "warning" },

  // ── Receipt / report templates ─────────────────────────────────────────
  "receipt.template_created":    { label: "Receipt design created",   tone: "success" },
  "receipt.template_saved":      { label: "Receipt design saved",     tone: "success" },
  "receipt.template_activated":  { label: "Receipt design set active", tone: "accent" },
  "receipt.template_duplicated": { label: "Receipt design duplicated", tone: "accent" },
  "receipt.template_deleted":    { label: "Receipt design deleted",    tone: "danger" },
  "receipt.template_reset": { label: "Receipt template reset to default", tone: "accent" },

  // ── Patient documents (scans / case studies on OPD & IPD records) ─────
  "document.upload":       { label: "Documents uploaded",       tone: "success" },
  "document.delete":       { label: "Document deleted",         tone: "danger"  },

  // ── Suggestions ────────────────────────────────────────────────────────
  "suggestion.create":     { label: "Suggestion submitted",     tone: "accent"  },

  // ── System ─────────────────────────────────────────────────────────────
  "system.first_run_admin": { label: "Initial admin created",   tone: "accent"  },
  // The break-glass account (lib/auth/super-admin.ts). A REPAIR is amber on purpose:
  // it means the account had been deactivated, demoted, or had its password changed,
  // and a restart put it back - which somebody should notice.
  "system.super_admin_create": { label: "Super admin created",  tone: "accent"  },
  "system.super_admin_repair": { label: "Super admin restored", tone: "warning" },
} as const satisfies Record<string, ActivityMeta>;

// The set of valid tags, as a type. logActivity takes this, so a typo fails to
// compile instead of writing an unknown tag to the log.
export type ActivityAction = keyof typeof ACTIVITY;

// Look up a tag's display metadata. Unknown tags (e.g. from an older log row whose
// tag was renamed) fall back to a readable form of the raw tag rather than
// throwing - the feed must always render.
export function activityMeta(action: string): ActivityMeta {
  return (
    (ACTIVITY as Record<string, ActivityMeta>)[action] ?? {
      label: action.replace(/[._]/g, " "),
      tone: "accent",
    }
  );
}
