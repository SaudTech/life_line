# Batch polish - final review & hardening (Agent E)

Scope: whole-app read, P0/P1 hardening pass, final mobile sweep, and verification of
Agents A-D's shipped work. Money counter - bias to correctness, no silent failures,
speed. Findings below are ordered by severity; each says whether it was fixed or
deferred.

Gate status after this pass:
- `npm test` - green
- `npx tsc --noEmit` - clean
- `npx next build` - clean

---

## P0 - none found

The money and rule layers are sound. Spot checks confirmed:

- Money is integer paise end to end (`lib/money.ts`, `lib/billing/rules.ts`,
  `lib/procedures/lines.ts`); BIGINT columns with `CHECK (>= 0)`; display-only
  `formatPaise`. No JS float ever enters a calculation.
- Prices/fees are server-authoritative. Procedure lines are re-priced from the live
  catalog on preview, discount-authorize, and submit (`repriceLines` in
  `lib/procedures/actions.ts`); consultation fee is read from the doctor row. The
  client's money is never trusted.
- `canFinalizeBill` is enforced in both write actions before the transaction, mirroring
  the `bills_discount_needs_approval` DB constraint. Discounts require a supervisor PIN,
  re-verified server-side at submit (not only at authorize).
- Multi-row writes are wrapped in one `BEGIN/COMMIT/ROLLBACK` transaction
  (`createConsultationWithBill`, `createProcedureBill`); the bill number is DB-issued.
- Roles/permissions are enforced on the server in every action (`requireRole` /
  `requirePermission`), read fresh from the DB so a grant change takes effect at once.
- No silent catches. Every `catch` either surfaces a user-facing message
  (flows show "Could not save - nothing was recorded") or is deliberate best-effort with
  `console.error` (`lib/audit.ts`, `lib/services/sweep.ts`) or graceful degradation
  (localStorage in `activity-feed.tsx`).
- `error.tsx` boundary covers the whole `(dashboard)` tree.

---

## P1 - fixed

### 1. Money correctness: procedure line quantity was unbounded on the server
`lib/procedures/schema.ts:34` (`procedureLineSchema.quantity`)

`quantity` was `z.coerce.number().int().min(1)` with no upper bound. The flow UI caps
the field at 4 digits, but the server action re-validates with this same schema and a
crafted/buggy request could send a very large quantity. `computeLineTotal` then computes
`unitPricePaise * quantity` as a JS number: with `unit_price_paise` up to ~9.9e8 (99 lakh
rupees) and `quantity` up to INTEGER max (~2.1e9), the product (~2e18) exceeds
`Number.MAX_SAFE_INTEGER` (9.0e15) while still fitting the BIGINT `line_total_paise`
column (max 9.2e18) - i.e. a silently corrupted total gets stored. Violates
DEVELOPMENT_RULES §4 ("never let a JS number silently corrupt a total").

Failure scenario: POST `submitProcedureAction` with `lines:[{serviceId, quantity: 1e15}]`
-> line total computed with lost precision -> wrong money persisted, no error.

Fix: added `.max(9999, ...)` (matches the UI's 4-digit cap; even 9999 x 99 lakh stays
integer-safe). Over-limit now returns a clean field error instead of corrupting money.
Added a test in `lib/procedures/schema.test.ts` (accepts 9999, rejects 10000 / 1e9).

### 2. Double-submit / double-bill defense-in-depth on the money write
`app/(dashboard)/consultations/consultation-flow.tsx` (`confirm`),
`app/(dashboard)/procedures/procedure-flow.tsx` (`confirm`)

Both confirm handlers guarded re-entry only through the `submitting` React state and the
disabled button. That covers ordinary double-clicks (React flushes the disabled state
synchronously within the event), but a mobile double-tap (touchend synthetic click +
click) can dispatch two handlers before React repaints. For the consultation flow that
could create two bills and, for a brand-new patient, two patient rows; for procedures,
two bills. On a money counter that is a double-charge risk (DEVELOPMENT_RULES §1).

Fix: added a synchronous `useRef` re-entry guard (`confirmingRef` / `submittingRef`)
checked-and-set before the write and cleared in `finally`, so a second call is an
immediate no-op regardless of React's render timing. No behavior change on the happy path.

---

## Verified consistent (Agents A-D)

- Dialog Cancel buttons are uniformly `variant="ghost"` across users, doctors, services,
  patients, and both PIN dialogs; footers are primary-left / Cancel-right. Remaining
  `variant="outline"` usages are non-Cancel utility buttons (toolbar Clear, Add line,
  Remove discount, empty-state actions) - correct, left as-is.
- Top nav (Agent C): search removed; avatar Popover shows name/role/phone/email + Sign
  out via `logoutAction`; bar wraps responsively (no horizontal scroll at 360px).
  `layout.tsx` -> `getUserProfile(session.sub)` wired correctly; `UserProfile`/`getUserProfile`
  additive in `lib/users/repository.ts`, memoized per request via React `cache`.
- Procedures history (Agent B): `date-range-filter.tsx` popover uses `bg-popover`, presets
  compute via the tested `lib/procedures/date-range.ts`; toolbar `flex-wrap`s cleanly.
- PIN-failure logging (Agent D): `discount.pin_failed` logged from all four call sites via
  the shared `logFailedPinAttempt`; no PIN/secret in `details`; best-effort so it can't
  break the billing action.

## Mobile sweep (~360px) - clean

- Both counter flows collapse the `lg:grid-cols-[minmax(0,1fr)_360px]` two-column layout to
  a single column; a fixed bottom running-total bar (`lg:hidden`) keeps the payable amount
  always visible without scrolling, with `pb-24` on the container so it never overlaps
  content.
- All wide tables (consultations/procedures history, doctors, services, patients) sit in an
  `overflow-x-auto` wrapper - the page body never scrolls sideways.
- Toolbars (`procedures-list`, `users-manager`) use `flex-wrap` with sensible `min-w`.
- Inputs use the right types: phone/PIN `type="tel"/"text"` + `inputMode="numeric"`, money
  `inputMode="decimal"`, age/quantity numeric with a `min`. Light theme only, semantic
  tokens, no `dark:` reliance in app screens.

---

## P2 - deferred (note only)

- No `global-error.tsx` at the app root and no `error.tsx` on the `/login` route. The
  `(dashboard)` boundary already covers every signed-in screen; login is a tiny form.
  Low value, deferred.
- `admission_expenses.quantity` (IP flow) has the same "no upper bound" shape at the DB
  level, but no IP admission/discharge code is shipped yet, so there is nothing to guard
  now. Apply the same quantity cap when that flow's schema is written.
- The custom discount `type="number"` inputs don't strip non-numeric keystrokes on change
  (unlike the phone/qty fields); the server rejects anything non-`isValidRupees` with a
  clear message, so there's no correctness risk - purely a minor input-polish item.
