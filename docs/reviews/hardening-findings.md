# Hardening review - findings

Review + fix pass over the shipped code (not a rewrite). Lens: this is a billing
counter with real money and a patient at the desk - silent failure/uncertainty
(P0) and hot-path latency (P1) outrank everything; code quality is P2.

## Summary

The codebase is in strong shape. The money core (`lib/money.ts`, `lib/billing/rules.ts`,
`lib/consultations/rules.ts`) is integer-paise throughout, pure, and well tested
(131 tests green). Auth (scrypt, constant-time HMAC session, generic login errors,
server-side `requireRole`/`requireAdmin` in every action), parameterized SQL
everywhere, no `password_hash`/`pin_hash` ever selected to the app, one shared pool,
hot columns indexed, and the audit-log schema reconciles with `lib/audit.ts` across
migrations 0001-0006. Dimension-A action results are handled in every client form
except the two consultation handlers.

**Re-scoped to reality:** the plan predates the consultation/billing/doctors/patients
work, which has since shipped. Those are now the highest-stakes surfaces, so they got
the deepest look.

### What was wrong / what changed

- **P0** - the consultation `confirm()` handler had no `try/catch` around the awaited
  `startConsultationAction`. A thrown/rejected action (transient DB error, etc.) left
  the Confirm button stuck spinning with no message - staff cannot tell whether the
  bill saved. That is the exact double-charge/uncertainty failure mode. **Fixed:** the
  handler now catches, clears the pending state, and shows a definite "not saved" error.
  The write is a single all-or-nothing transaction, so a caught throw means nothing was
  saved and a retry is safe.
- **P1** - the discount `PinDialog.authorize()` handler had the same missing `try/catch`
  (stuck on "Authorizing..."), and `authorizeDiscountAction` **threw** on an
  out-of-range percentage or a malformed custom amount (reachable from the `type=number`
  field, e.g. `100.555`) because it called `computeDiscountPaise`/`rupeesToPaise`
  directly on unvalidated input. **Fixed:** the action now validates the discount inputs
  and returns a `formError` instead of throwing; the client handler also catches any
  rejection and shows an error.
- **P1** - there was **no `error.tsx` boundary** anywhere. A throw in a server component
  (e.g. Postgres down while loading `/consultations` or `/admin`) rendered a blank/
  generic screen. **Fixed:** added `app/(dashboard)/error.tsx` - a recoverable,
  keyboard-focusable "try again" boundary for the signed-in area.
- **P2** - removed the **card-style A/B/C switcher** on the users screen (design
  indecision that shouldn't ship). Kept one card (Layout A - "Rows"). This also removed
  the three raw `bg-white` usages that lived only in the B/C layouts and the switcher.

### Intentionally left (with reason)

- **No composite `(patient_id, doctor_id)` index** on `consultations` for the
  revisit lookup. Single-column `consultations_patient_idx` is already used; at
  ~144 visits/day this is nanoseconds. Adding one would be optimizing for scale we
  don't have (DEVELOPMENT_RULES §6). Noted, not changed.
- **`UsersManager` accepts a `meId` prop it never reads.** Pre-existing, harmless,
  out of scope for a surgical pass.
- **`shadcn` `dark:` utilities** in `components/ui/*` are **not** a finding: `app/globals.css`
  deliberately binds the `dark` variant to a `.dark` class that is never applied, so
  they are inert (light-only theme, ui-foundation §D1).
- **Idempotency of `startConsultationAction`.** A genuine success whose response is
  lost to a dropped connection could be re-submitted into a second booking. Adding an
  idempotency key is a new abstraction beyond this pass; captured as a rule in
  `docs/hot-path-rules.md` for the billing screens to adopt by construction.

---

## Findings (triaged)

### P0 - silent failure / money-correctness

| # | File:line | Problem | Fix |
|---|-----------|---------|-----|
| P0-1 | `app/(dashboard)/consultations/consultation-flow.tsx` `confirm()` | Awaited `startConsultationAction` with no `try/catch`; a thrown/rejected action leaves Confirm stuck spinning, no error - staff can't tell if the bill saved (double-charge risk). | Wrap in `try/catch`; on failure clear `submitting` and show a definite "not saved - try again" error. |

### P1 - counter latency / keyboard certainty

| # | File:line | Problem | Fix |
|---|-----------|---------|-----|
| P1-1 | `lib/consultations/actions.ts` `authorizeDiscountAction` | Calls `computeDiscountPaise`/`rupeesToPaise` on unvalidated `pct`/`amount`; an out-of-range % or malformed amount (reachable from the number input) throws → action rejects. | Validate discount inputs up front; return a `formError` instead of throwing. |
| P1-2 | `app/(dashboard)/consultations/consultation-flow.tsx` `PinDialog.authorize()` | No `try/catch`; a rejected `authorizeDiscountAction` leaves the dialog stuck on "Authorizing...". | Wrap in `try/catch`; on any rejection clear `busy` and show an error. |
| P1-3 | `app/(dashboard)/**` (no boundary) | No `error.tsx`; a server-component throw (DB down) shows a blank/generic screen with no recovery. | Add `app/(dashboard)/error.tsx` with a focusable "try again". |

### P2 - code quality / consistency

| # | File:line | Problem | Fix |
|---|-----------|---------|-----|
| P2-1 | `app/(dashboard)/admin/users/{users-manager,user-card}.tsx` | Shipped a card-style A/B/C switcher (design indecision) + three raw `bg-white` usages in the B/C layouts. | Delete the switcher and Layouts B/C; keep Layout A. Removes the `bg-white` usages. |

### Verified clean (no action)

- Parameterized SQL everywhere (only interpolation is a constant column list in
  `patients/repository.ts`, not user input).
- `password_hash` / `pin_hash` never selected into the app or logged; `logActivity`
  forbids secrets in `details`.
- Every mutating action calls `requireAdmin()`/`requireRole()`; guards read live DB
  state (last-admin lock-out, self-deactivate).
- Money is integer paise end to end; `formatPaise` is display-only.
- Session HMAC verify is constant-time; `SESSION_SECRET`/`DATABASE_URL` are hard-fail;
  cookie is `httpOnly`+`sameSite=lax`, `secure` gated correctly for the plain-HTTP LAN.
- Static doctor list is preloaded once on the consultation page (not per-keystroke);
  phone lookup is debounced + race-guarded; no N+1 in the shipped queries.
