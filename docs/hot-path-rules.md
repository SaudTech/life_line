# Hot-path rules for the counter screens

The consultation/billing counter is used ~144x/day with real money on screen and a
patient waiting. These rules exist so the next screens (procedure billing, IPD
admit/discharge) are fast and certain **by construction** - not audited into shape
later. They distil DEVELOPMENT_RULES §1/§4/§5/§6 into concrete build rules, plus what
the hardening review turned up.

## 1. Every save returns a definite success or failure the UI shows

- A save action returns a typed `ActionResult`. The client renders `Saved ✓ #<id>` on
  success and a **clear, specific** error on failure - never a silent stuck spinner.
- **Always wrap the awaited action in `try/catch`.** A thrown/rejected action (DB blip)
  must clear the pending state and show "Could not save - nothing was recorded." An
  `error.tsx` boundary does **not** catch a rejected action inside a client handler;
  only the `try/catch` does. (This was the P0 the review fixed in the consultation flow.)
- Disable the submit control while pending so a second click can't fire.

## 2. Save is its own step - nothing about recording the money depends on print or network

- The bill gets its DB-issued `bill_number` and is committed **before** anything prints.
- Save and print are separate, independently retryable steps. Print failure never
  un-saves a bill and never mints a duplicate.
- No internet round-trip on any save path - the DB is local on the LAN.

## 3. Write multi-step money changes in one transaction

- Consultation + first visit + bill, or admit + advance, or discharge + final bill:
  one `BEGIN/COMMIT` (see `createConsultationWithBill`). All-or-nothing means a caught
  throw guarantees nothing was written, so a retry is safe.

## 4. Compute money on the server from authoritative values - never trust the client

- The client sends *inputs* (doctor id, discount % or amount, PIN). The server reads
  the authoritative fee from the DB and runs the pure billing rules. Re-verify the
  supervisor PIN and re-derive every amount on submit; the preview is display-only.
- **Validate every numeric input before it reaches a pure rule.** The pure rules throw
  on out-of-range input by design; a public action must validate first and return a
  `formError`, or a malformed value rejects the action and hangs the UI. (P1 fix.)
- Money is integer paise end to end. Rupee strings cross the boundary only through
  `rupeesToPaise` / `formatPaise`. Never `parseFloat` an amount into a calculation.

## 5. Preload static lists with the screen; never per-keystroke

- Doctors, services, rooms load once with the page (server component) and are passed as
  props. Picking one is instant, not a fresh query.
- Live lookups (patient by phone) are **debounced** and **race-guarded** with a sequence
  ref, so a stale response can't overwrite a newer one.

## 6. Every counter query hits an index; no N+1; select only what's shown

- Look up by indexed columns (`patients.phone`, `users.phone`, `bills.created_at`,
  `bill_number`, `location_id`). No query inside a `.map`; batch with `= ANY($1)`.
- Never `SELECT *` money/PII you don't render. **Never** select `password_hash` /
  `pin_hash` into the app.

## 7. Keyboard-first, honest state

- Autofocus the first field; `Tab` follows real field order; `Enter` submits the step.
- Fixed layout: the total and the Save button never move.
- Colour is status only: green = saved, amber = pending approval, red = error/void.

## 8. Reporting money: one definition, and the day it lands on

The counter records money; the dashboard and the daily report have to agree about what
it recorded. They did not, and the fix is a rule, not a query.

- **"Money in" is defined once, in `lib/money-in.ts`.** Both `lib/dashboard/repository.ts`
  and `lib/reports/repository.ts` import the expression from there. Never hand-write a
  revenue sum at a call site - that is exactly how the two screens drifted apart.
- **Never sum `bills.total_paise` as revenue.** An IP bill's total is the GROSS bill and
  still contains the advance taken at admit. Summing it *and* the advance counts the
  advance twice (it inflated every admin figure by ~19% on the dev dataset). An IP bill
  contributes `balance_due_paise − refund_paise`; every other type contributes its total.
- **Cash moves twice in a stay, on two different clinic days:** the advance on the admit
  day, the balance on the discharge day. Each is reckoned on the day it happened, so a
  day's figure matches what that day's drawer actually held.
- **A refund is money leaving.** It is stored (`bills.refund_paise`), netted out of
  money-in, and shown as its own figure. A day's money-in may legitimately be negative.
  Never clamp it to zero - that hides an outflow (§4).
- **Only `status = 'final'` is money.** `pending_approval` isn't settled; `void` isn't
  revenue. The admin ledger ("Recent invoices") still *lists* both, marked and counted
  as zero, so an invoice is never invisible - but it reckons a row's effect with this
  same rule, so the ledger and the cards above it can never disagree.
- **Void accounting is an OPEN DECISION for the hospital owner - do not change it
  silently.** Today a voided bill is revenue on **no** day: `status='final'` drops it
  from its original day retroactively. So a day's revenue can change after the fact, and
  a Monday sheet printed Monday will not match Monday re-read on Tuesday. The daily
  report separately shows *what was voided*, keyed on `voided_at`.
  The alternative (bill counts on its billed day, the void subtracts on `voided_at`)
  never restates history and matches how the drawer physically behaved, but it is a real
  accounting policy change and both screens would have to move together. Ask the owner;
  whichever is chosen, `lib/money-in.ts` is the one place to implement it.
- **`location_id` filters every reporting query**, including the ones that only *look*
  like display (activity feeds, staff counts, approver lookups). An unscoped approver
  list is an authorization bug, not a cosmetic one - see `listDiscountApprovers`.

## 9. Known gap to close in billing: idempotency

- `startConsultationAction` is not idempotent - a genuine success whose response is lost
  to a dropped connection could be re-submitted into a second booking. When the billing
  screens land, carry a client-generated idempotency key on the save so a retry
  collapses to the same bill instead of a duplicate. (Deferred from the hardening pass;
  do not ship money-write retries without it.)
