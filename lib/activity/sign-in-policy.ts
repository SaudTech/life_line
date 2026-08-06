// Policy for WHICH sign-ins reach the activity log. PURE and client-safe (no DB,
// no React, no server-only imports) so the one rule lives in exactly one testable
// place rather than as an `if` buried in the sign-in server action
// (DEVELOPMENT_RULES §2: rules are pure functions, actions stay thin).

// The admin is the sole reader of the activity feed and signs in constantly to
// check it. Recording those sign-ins turns the feed into a log of the admin
// watching the log - noise that pushes the counter events (bills, discounts,
// admissions) the feed exists to surface off the first screen. The audit_log is
// append-only (DEVELOPMENT_RULES §4/§8), so this must be decided at WRITE time:
// a read-side filter would still leave the rows in the table forever. Nothing
// accountability-relevant is lost - the admin is not a counter operator handling
// money, and every action an admin actually TAKES (creating staff, resetting a
// password, voiding a bill) is still logged under its own tag, attributed to them.
// Every other role's sign-in is recorded exactly as before.
export function shouldLogSignIn(role: string): boolean {
  return role !== "admin";
}
