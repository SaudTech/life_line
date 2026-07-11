# Plan — Daily report: "what I did today" (self-scoped, per user)

> **For the implementing session.** Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, `AGENTS.md`,
> `PROJECT_OVERVIEW.md` first. This is the **last Phase-1 pillar (reports)** — but scoped down per
> the owner: **each user generates a report of THEIR OWN transactions for a day ("what I did
> today"). Strictly self-scoped.** A hospital-wide / cross-staff admin report is **deferred**; for
> now the same self report is simply also surfaced on the admin side.

---

## 1. Context — what this is (and isn't, yet)

Staff stand at a counter handling real money all day. They need to **close out their own day**:
"here is everything I did and collected today," to reconcile their cash and hand over. So:

- **Every signed-in user can generate their OWN daily report** — bills they created, discounts
  they took/approved, voids they did, admissions/discharges they handled — for a chosen day
  (default **today**, clinic timezone). No one sees anyone else's data.
- **Admin:** for now, just **surface the same self report on the admin side** (admin runs it for
  their own actions). The **hospital-wide, all-staff aggregation is explicitly out of scope for
  this pass** — that's the next iteration once the self report is solid.

This is deliberately smaller than a full day-close. It answers "what did *I* do today," not "what
did the whole hospital take today."

---

## 2. Data & attribution (what we can stand on)
- **Bills** (`bills`): `created_by` (NOT NULL), `payment_mode`, `total_paise`, `discount_paise`,
  `discount_approved_by`, `status`, `type`, `voided_by`, `created_at`. Indexed on `created_by` and
  `created_at`. → the authoritative **money** source; fully attributable + payment-mode split.
- **Activity log** (`audit_log`): `actor_id` (`user_id`) + `action` + `at` + `location_id` +
  `details`, indexed on user + at. Every action is stamped with who did it. → the authoritative
  **"what I did"** source (counts of admissions, discharges, discounts, voids, patients created,
  etc.). Reuse `formatActivity`/tone from `lib/admin/activity.ts` for labels.
- **Clinic day:** `created_at`/`at` are `timestamptz`; "today" must be the **clinic day**
  (`Asia/Kolkata`). Reuse `clinicToday()` + `presetRange("today", …)` from `lib/date-range.ts` to
  get an inclusive `[from, nextDay)` range and filter on it. Never use the server's local date.

### Advance cash at admission — REQUIRED migration (owner confirmed)
`admissions` today has **no `created_by` and no `payment_mode`**, so the **advance** collected at
admit can't be attributed to a user or split by mode. **DECIDED: add the migration** so advance
cash is first-class attributable money like bills (correct cash reconciliation):
- New migration (next number, forward-only):
  ```sql
  ALTER TABLE admissions
    ADD COLUMN created_by UUID REFERENCES users (id),
    ADD COLUMN advance_payment_mode TEXT
      CHECK (advance_payment_mode IS NULL OR advance_payment_mode IN ('cash','card','upi','other'));
  ```
  Both nullable (older rows predate them; forward-only).
- **Set them in the admit action** (`lib/admissions/actions.ts` already has `s.sub` and collects the
  advance) — record `created_by = s.sub` and the advance's payment mode. Add the payment-mode field
  to the admit form/schema if it isn't captured yet (per the IPD plan §5b it should be collected).
- The report then attributes **advances I took today** (`admissions.created_by = me`,
  `admitted_at` in the clinic-day range) and splits them by `advance_payment_mode`, shown as a
  distinct **admission deposit** line separate from finalized bill revenue.

---

## 3. What the report shows (for the signed-in user, for the chosen day)

**A. What I did (activity summary)** — counts from `audit_log` (actor = me, clinic-day range):
- Consultations started, procedures billed, IP admissions, IP discharges, patients registered,
  discounts approved (supervisors), bills voided. One labelled count per action that applies to
  the user's role.

**B. What I collected (money summary)** — from `bills` (`created_by = me`, `created_at` in range):
- **By bill type:** consultation / procedure / IP — count + total.
- **By payment mode:** cash / card / UPI / other — count + total. **This is the reconciliation
  line** (what should be in the drawer as cash vs digital).
- **Discounts:** total discount value on my bills (and, for supervisors, discounts *I approved*
  via `discount_approved_by = me`), each shown distinctly.
- **Voids:** bills I voided today — **count + amount, shown separately and EXCLUDED from collected
  totals** (a void is not revenue; showing it preserves the audit trail).
- **Advances:** admission deposits I took today (`admissions.created_by = me`), split by
  `advance_payment_mode`, labelled separately from finalized bill revenue (a deposit is money held,
  settled later at discharge — don't conflate it with a finalized bill).
- **Grand total collected** = Σ finalized (non-void) bills I created, by mode. Integer paise
  throughout; formatted only for display (`formatPaise`).

**C. Header:** user name + role, the date, hospital name, generated-at timestamp — so a printed
copy is self-describing for handover.

---

## 4. Reporting layer (no business math in the UI — §26/27)
- `lib/reports/repository.ts` — the queries: `getMyActivityCounts(userId, from, to)` and
  `getMyMoneySummary(userId, from, to)` (SQL `GROUP BY type` / `GROUP BY payment_mode`, filtered by
  `created_by`/`actor_id` + the clinic-day range + `location_id`). Parameterized; reuse the shared
  `pool`.
- `lib/reports/summary.ts` — a **pure, Vitest-tested** shaper that turns the raw grouped rows into
  the display model and computes the **grand total (excluding voids)**. Tests cover: a day with
  mixed modes, discounts, a void excluded from the total, and an **empty day → all zeros** (no
  crash, honest "nothing yet"). The UI only renders what this returns — it never sums money itself.
- **Server action** `generateMyDailyReportAction({ day })`: `requireSession`, resolve the clinic
  range, **force `userId = session.sub`** (see §6 — never trust a user_id from the client), return
  the shaped report. `revalidatePath` not needed (read-only).

## 5. UI + entry points
- **A report page/panel** (design system = `admin/users/users-manager.tsx`; tables in
  `overflow-x-auto`, mobile-clean): a **date control** (default Today, reuse `DateRangeFilter`
  presets or a single-day picker), then sections A/B/C from §3. Colour for status only (void =
  red, etc.).
- **Entry points (self report, everywhere the user works):**
  - **Staff homes** — a "My day" / "Today's report" card or button on the `desk` and `supervisor`
    homes (and op_ip_desk).
  - **Admin home** — the **same** self report surfaced here (the `admin/page.tsx` quick-actions has
    a disabled "View reports" stub — wire it to this). Admin runs it for their own actions for now.
- **Print:** a **print-friendly layout** (browser `window.print()` + a small print stylesheet — an
  internal tabular handover sheet, so no pdfme/template needed here, unlike customer receipts).
  Header (§3C) + the tables print cleanly on A4.

## 6. Roles / security (strictly self-scoped)
- The action **always reports on `session.sub`** — there is **no `userId` input**; a user can
  never request another person's report. This is the core guarantee of "their own data."
- Any signed-in role may run it (op_desk / op_ip_desk / supervisor / admin) — each sees only their
  own. **No cross-staff or hospital-wide view in this pass** (that's the deferred admin report).
- Enforced on the server, not by hiding UI (§9).

## 7. Edge cases
- **Empty day** → every count/total is 0 with a clear "No transactions on this day" state (never a
  blank or a crash). Tested in `summary.ts`.
- **Voids** excluded from collected totals but shown (audit trail). A bill finalized today then
  voided today → appears under voids, not revenue.
- **Clinic-tz boundary** — a bill at 00:30 IST belongs to that clinic day, not the UTC day; the
  range math (`lib/date-range.ts`) handles it. Add a test at the day boundary.
- **Discount approver ≠ creator** — a supervisor who only approved a discount (didn't create the
  bill) still sees it under "discounts I approved," without double-counting the bill's revenue as
  theirs.
- **Past days** are viewable (pick any date), not just today — useful for a missed handover.

## 8. Out of scope (this pass)
Hospital-wide / all-staff aggregation, cross-branch reports, per-doctor or per-service analytics,
charts, CSV/PDF export, scheduled/emailed reports. (All later.) No nav *redesign* — at most reuse
existing homes + the admin quick-action stub.

## 9. Definition of done
- [ ] Any signed-in user can generate **their own** daily report for a chosen day (default today,
      clinic tz): an activity summary (what I did) + a money summary (collected, by type + by
      payment mode) + discounts + voids-shown-separately.
- [ ] Money is server-computed in a **pure, tested** `lib/reports/summary.ts` (empty-day, void-
      excluded, mixed-mode, day-boundary cases); the UI renders, never calculates.
- [ ] Reachable from the **staff homes** and the **admin home** (the "View reports" stub wired up);
      **strictly self-scoped** — no `userId` input, server forces `session.sub`.
- [ ] Printable handover sheet (browser print + print CSS), header self-describing.
- [ ] `admissions.created_by` + `advance_payment_mode` migration added; the admit action sets both;
      the report attributes + payment-splits advance deposits (shown separately from bill revenue).
- [ ] `npm test`, `npx tsc --noEmit`, `npx next build` clean. Light theme, dialogs primary-left /
      Cancel-right, mobile-clean.

## 10. Verify (end-to-end)
1. As an OP desk user, create a couple of consultations + a procedure (mixed cash/UPI), give one
   discount → open **My day** → counts and **by-payment-mode** totals match exactly.
2. **Void** one of those bills → it moves to the voids section and **drops out of the collected
   total**.
3. As a **supervisor**, approve a discount for someone → your report shows "discounts I approved"
   without claiming that bill's revenue.
4. Pick **yesterday** → shows that day's data (or a clean empty state). Pick a day with nothing →
   all zeros, no crash.
5. **Print** → a clean A4 handover sheet with your name/role/date and the tables.
6. Confirm you **cannot** see another user's numbers (the action takes no userId; only your own).
7. `npm test` (summary edges green), `npx next build` clean.

## 11. After this
Phase 1 is then **complete**. Next is the deferred **admin hospital-wide day-close** (all staff,
totals, per-cashier, admissions/discharges, voids — building on this same reporting layer), then
Phase 2 (patient-history-by-phone, cross-branch reports, legacy Access migration).
