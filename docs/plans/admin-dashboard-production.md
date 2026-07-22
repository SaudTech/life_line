# Plan - Make the Admin Dashboard Production Ready

> **For the implementing session.** Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, `AGENTS.md`
> first. This is a **correctness + hardening + capability** pass over the shipped admin
> dashboard. It is not a redesign.
>
> **The lens:** the admin dashboard is where the hospital owner decides what is true about
> the money. A counter bug over-charges one patient; a dashboard bug means the hospital
> **books the wrong revenue and does not know it**. So the ranking here is different from
> the counter's:
>
> 1. **A number that is wrong** is worse than a number that is slow. (P0)
> 2. **A number that is missing** is worse than a number that is ugly. (P1/P2)
> 3. Polish is last. (P3)
>
> Every finding below was read in the source and verified, not inferred. File:line
> references are current as of `8b54159`.

---

## 0. What exists today

Shipped and working:

| Route | File | Shows |
|---|---|---|
| `/admin` | `app/(dashboard)/admin/page.tsx:33` | Greeting, financial strip, all-time revenue chart, 30-row activity feed |
| `/admin/users` | `admin/users/users-manager.tsx:45` | Staff CRUD, filters, card/list toggle |
| `/admin/doctors` | `admin/doctors/doctors-manager.tsx:30` | Fee, revisit validity, duty status |
| `/admin/services` | `admin/services/services-manager.tsx:217` | Billable catalog + trash w/ 7-day purge |
| `/admin/receipts` | `admin/receipts/receipts-library.tsx:56` | pdfme template library |
| `/reports` | `reports/daily-report.tsx:82` | Daily report, subject picker, date stepper, print |

The data layer is genuinely good in the places that matter most: **money is integer paise
end to end, no float anywhere in storage or calculation**; voided and `pending_approval`
bills are correctly excluded from revenue (`lib/dashboard/repository.ts:56,91,130,151`); the
clinic-day SQL predicate (`clinicRange`, `repository.ts:24`) is timezone-correct and
index-friendly; and `lib/dashboard/summary.test.ts` covers all eight pure exports with real
boundary cases (leap year, year cross, zero baseline).

The problems are concentrated in three places: **what the SQL sums**, **what is never
indexed**, and **what the admin cannot see at all**.

---

## P0 - The dashboard reports revenue that the hospital did not collect

### P0-1. Admission advances are counted twice

**This is the most important item in this document. Every revenue number on the admin home
is inflated by the value of every advance taken in the range.**

The chain, verified:

1. `calculateDischargeBalance` (`lib/billing/discharge.ts:45`) sets
   `totalPaise = subtotal − discount`. It deliberately does **not** subtract the advance -
   `advancePaise` and `balanceDuePaise` are returned as separate fields (`discharge.ts:22-24`).
   The pure rule is correct and well tested.
2. `lib/admissions/actions.ts:610` passes that `balance.totalPaise` into `dischargeWithBill`,
   which writes it to `bills.total_paise` on the `type='ip'` row
   (`lib/admissions/repository.ts:377`). **So the IP bill's total already contains the money
   collected at admission.**
3. `getRevenueByDay` (`lib/dashboard/repository.ts:56-63`) sums `bills.total_paise`
   `UNION ALL` `admissions.advance_paid_paise` - **adding the advance a second time**.
   `getInPatientRevenue` (`repository.ts:149-157`) does the same explicitly.

**Failure scenario:** advance ₹10,000 at admit, discharge bill total ₹15,000. Cash actually
taken: ₹15,000. Dashboard reports: **₹25,000**. Revenue today, revenue MTD, the all-time
chart, and the In-Patient department bucket are all wrong. It is only correct when the
advance is zero.

The file's own header comment (`repository.ts:9-12`) claims it reconciles "from the SAME two
sources as the daily report." It reads the same tables, but the daily report **never sums
them**: `shapeDailyReport` (`lib/reports/summary.ts:157`) derives `collectedTotalPaise` from
bills only and keeps `advancesTotalPaise` as a separate field (`:159`). **The two screens can
never tie out.** An admin comparing `/admin` to `/reports` will find two different truths and
have no way to know which to trust.

**The fix.** Money-in for a stay is `advance` (on the admission day) `+ balance_due` (on the
discharge day). That is what the hospital actually collected, and it lands on the correct
clinic day. `balance_due` is **not stored anywhere** - confirmed, no column in any migration.

- **Migration `0018_ip_bill_settlement.sql`:** add `balance_due_paise BIGINT NOT NULL DEFAULT 0
  CHECK (>= 0)` and `refund_paise BIGINT NOT NULL DEFAULT 0 CHECK (>= 0)` to `bills`.
  Backfill existing IP rows as `GREATEST(0, total_paise − COALESCE(advance, 0))` joined via
  `bills.admission_id`, and `refund_paise` as `GREATEST(0, advance − total_paise)`.
- **Write path:** `admissions/actions.ts:610` already has `balance.balanceDuePaise` and
  `balance.refundPaise` in hand - it currently drops them into an audit-log JSON blob
  (`:631`) and nowhere else. Persist them on the bill row.
- **Read path:** in `getRevenueByDay` and `getInPatientRevenue`, sum
  `CASE WHEN type = 'ip' THEN balance_due_paise ELSE total_paise END`. Keep the advance leg.
- **Then make the two screens agree**, or the bug comes back. See P0-4.

### P0-2. Refunds are invisible - money leaves the building unrecorded

When the advance exceeds the discharge total, cash goes **out**. `calculateDischargeBalance`
computes `refundPaise` correctly and `discharge.test.ts:34-43` asserts it. But it is persisted
only inside `audit_log.details` JSON (`admissions/actions.ts:631`). **No column, no query, no
report, no screen.** The hospital cannot answer "how much did we refund last month."

The `refund_paise` column in P0-1's migration fixes the storage. Then subtract refunds in the
money-in queries and surface a **Refunds issued** figure on the dashboard and the daily
report. This compounds P0-1: today a refund case both over-reports revenue *and* hides the
outflow.

### P0-3. A void silently rewrites history

Voids are correctly excluded from revenue (`status = 'final'`), but the dashboard has no
`voided_at` awareness - unlike the report, which does (`lib/reports/repository.ts:130`). A
bill finalized Monday and voided Tuesday **disappears from Monday's revenue retroactively and
forever**. Monday's printed end-of-day report and the dashboard's Monday bar will never match
again, with no trace on screen explaining why.

Decide the accounting rule and write it down in `docs/hot-path-rules.md`. Recommended:
**revenue is reckoned as-of the clinic day it was billed; a void reduces the day it was
voided** (this matches how the cash drawer actually behaved). Then show a **Voids** figure so
the movement is visible rather than silent. Whichever rule you choose, the dashboard and the
report must implement the same one.

### P0-4. Lock the two screens together with a test

The root cause of P0-1 is not the SQL - it is that **nothing forces `/admin` and `/reports` to
agree**. There are **zero tests for any repository** in the codebase (`lib/dashboard/`,
`lib/reports/`, `lib/users/` have no test file). All the SQL, including the double-count, is
untested.

Add an integration test against the test Postgres (per `DEVELOPMENT_RULES` §3) that seeds one
admission with an advance, discharges it, and asserts:

```
getRevenueByDay(range) total  ===  shapeDailyReport(range).collectedTotalPaise + advancesTotalPaise
                              ===  advance + balanceDue      // and never advance + total
```

**This test is the deliverable of P0.** Without it, the numbers drift apart again the next
time someone touches either query. Add the refund and void cases to it too.

### P0-5. "All time" revenue is a hardcoded lie that also scans the whole table

`app/(dashboard)/admin/page.tsx:41`:

```ts
getRevenueByDay("2026-01-01", clinicDay, reportCtx.locationId)
```

Three problems in one line, and it runs on **every page load**:

- The label at `:96` says **"Total revenue (all time)"**. It is not all time; it starts at a
  magic literal. Any pre-2026 data is silently invisible - which directly collides with the
  Phase-2 plan to migrate ~174,000 historical Access records, at which point this chart will
  quietly omit **3.3 years of history** while claiming to be all-time.
- It is unbounded and grows forever, uncached.
- It is the single most expensive query on the page (see P1-1).

Fix: derive the floor from the data (`SELECT min(created_at)`) or, better, **make the range a
control** (P2-2) and default it to something bounded like 12 months. If the label says
all-time, it must be all-time.

### P0-6. The greeting and date use the wrong timezone

`admin/page.tsx:44-46` uses `new Date().getHours()` and `toLocaleDateString("en-US", …)` -
**server-local time**. Every figure beside them uses `clinicToday()` = `Asia/Kolkata`
(`lib/date-range.ts:24`). On a UTC host after 18:30 IST, the header reads *"Good afternoon"*
and shows **yesterday's date**, directly above cards labelled "Revenue today" computed for
the real IST today. An admin reading a date header and a revenue figure that disagree has no
reason to trust either.

Use the clinic timezone for both. Note this is latent today (the box runs IST) and becomes a
live bug the moment the app is hosted or the server TZ is misconfigured - cheap to fix now.

### P0-7. Cross-location leaks

`location_id` discipline is the one thing `DEVELOPMENT_RULES` §4 asks for from day one, and
the dashboard's four money queries all honour it correctly. These do not:

- `listRecentActivity` (`lib/users/repository.ts:313`) - **no `location_id` filter**. The
  activity feed shows every branch's activity.
- `getUserStats` (`:276`) - counts all users globally.
- `listUsers` (`:30`), `listUsersWithPermission` (`:125`), `listUsersByRole` (`:142`),
  `listDiscountApprovers` (`:160`) - all unscoped.

Harmless with one location, **wrong on the day a second branch exists**, and by then it is
buried. `listDiscountApprovers` is the one to look at hardest: an unscoped approver list is an
access-control question, not just a display bug.

---

## P1 - Production hardening

### P1-1. `admissions` has no index that any dashboard query can use

`migrations/0001_init.sql:219-220` creates only `admissions_patient_idx` and
`admissions_status_idx`. There is **no index on `location_id` and none on `admitted_at`** -
the exact two columns every dashboard query filters on. Every one is a guaranteed seq scan.

Per admin page load, that is **6 seq scans of `admissions`** (1 from `page.tsx:41` + 5 from
`financial-overview.tsx:107-114`) plus 6 passes over `bills`.

`bills` is better but not right: `bills_location_idx` / `bills_created_at_idx` /
`bills_status_idx` are three separate single-column indexes (`0001_init.sql:178-182`). There
is no composite covering the actual access pattern, and `bills_status_idx` on a 3-value column
is near-useless.

Migration `0019_dashboard_indexes.sql`:

```sql
CREATE INDEX admissions_location_admitted_idx ON admissions (location_id, admitted_at);
CREATE INDEX bills_location_status_created_idx ON bills (location_id, status, created_at);
```

At ~174k rows and growing 50k/year this is the difference between the dashboard staying
instant and degrading a little every month until someone notices. Confirm with `EXPLAIN
ANALYZE` before and after - **measure, do not guess** (§6). Run against a
`scripts/seed-bulk.mjs` dataset at realistic scale, not an empty dev DB where a seq scan is
always fast and this work looks pointless.

### P1-2. Nothing streams - ~10 queries block first paint

`admin/page.tsx:37` awaits `getReportContext`, **then** `:38-42` awaits a `Promise.all`, then
`:88` renders `<FinancialOverview>`, which is itself an async component firing **6 more
queries** (`financial-overview.tsx:107-114`). Because it is not wrapped in `<Suspense>`, Next
cannot flush any HTML until all of it resolves. There is **no `loading.tsx` anywhere in the
entire `app/` tree** - only `app/(dashboard)/error.tsx`.

So the admin stares at a blank page for the duration of the slowest query - and per P1-1 that
query is an unbounded seq scan.

- Wrap `FinancialOverview` and `RevenueChart` in `<Suspense>` with skeletons. The greeting and
  shell paint immediately.
- Add `app/(dashboard)/admin/loading.tsx`.
- `page.tsx:37` awaits `getReportContext` serially before the `Promise.all` - fold it in.
- **Read `node_modules/next/dist/docs/` on Suspense and streaming before writing this.**
  Next.js 16 differs from training data (`AGENTS.md`).

### P1-3. When location can't resolve, the dashboard silently deletes itself

`admin/page.tsx:88,93`: if `reportCtx` is null, `FinancialOverview` **and** `RevenueChart`
render nothing. No message, no error - the grid just collapses to an activity feed. The admin
sees a page that looks intentional and concludes the hospital made no money.

This is the exact failure the file's own comment at `:29` says it avoids ("every number on
screen is real, never a mock… honest system state"). An empty state that looks like a designed
empty state, but means "we could not load your data", is the worst kind of dishonest. Render
an explicit error. Compare `receipts/page.tsx:19-21`, which at least throws.

### P1-4. Missing error boundary and retry

No `admin/error.tsx` - everything falls to the generic `app/(dashboard)/error.tsx:15`. An
admin gets the same screen whether the user list or the receipt library failed.
`reports/page.tsx:32-38` shows flat error text with **no retry button**.

### P1-5. Hydration mismatches from `Date` during render

Two client components compute time during render, so server and client disagree:

- `receipts-library.tsx:72` - `useMemo(() => new Date(), [templates])` feeding `relativeTime`
  at `:343` → "Updated N minutes ago" mismatches on hydration.
- `services-manager.tsx:36-41` - `trashDaysLeft` calls `Date.now()` during render. This one
  drives a **7-day purge countdown**, so it is a data-destruction affordance showing a
  possibly-wrong number.

`admin/page.tsx:52-62` already does this correctly - it pre-formats relative times on the
server with a single `now`. Follow that pattern.

---

## P2 - What a hospital admin actually needs and cannot get

Ranked by how often a real hospital owner asks the question.

### P2-1. An audit log viewer (the biggest gap)

`grep -i audit` across `app/` returns exactly one **comment**. The `audit_log` table is
queried only by `listRecentActivity`, capped at a hardcoded **30 rows** on the home page
(`page.tsx:39`). There is no route, no pagination, no filter, no export.

For a hospital handling cash across multiple counters and shifts, **"who voided that bill and
when" is the single most important question the system will ever be asked** - during a cash
discrepancy, a staff dispute, or an audit. The table exists and is being written to correctly.
The screen simply does not exist.

Build `/admin/audit`: filter by actor, entity, action, date range; paginate; export. This is
the highest-value new screen in this document.

### P2-2. Date range control on the dashboard

The dashboard is frozen at today / MTD / "all time since 2026-01-01", with one hardcoded
comparison (MTD vs last month). An admin cannot ask "last week", "last quarter", "this
financial year", or "the same month last year".

`components/date-range-filter.tsx` **already exists** and `lib/date-range.ts` is tested. Wire
it in. Every dashboard query is already `(fromDay, toDay, locationId)` - the data layer is
ready for this today. This also retires P0-5's magic literal.

### P2-3. Export

No CSV/XLSX anywhere. Reports print to A4 via pdfme only. **The admin cannot hand numbers to
the hospital's accountant** without retyping them - which is precisely the manual-retyping
problem this system was built to end (`PROJECT_OVERVIEW` §1). Add CSV export to reports and
the audit log.

### P2-4. Metrics that are not computed at all

Nothing in the codebase computes:

- **Current inpatient census** - `admissions WHERE status = 'admitted'` is never queried for
  the dashboard. "How many patients are in the hospital right now" is unanswerable. This is
  arguably the first thing a hospital admin looks for, and it is a one-line query against an
  existing indexed column.
- **Outstanding receivables** - not stored (P0-1's `balance_due_paise` unlocks this).
- **Refunds issued** (P0-2).
- **Pending-approval bill queue** - bills sitting in `pending_approval` are the one thing on
  the dashboard that needs the admin to *act*, and they are invisible on it.
- **Doctor-level revenue** - only department is computed. "Which doctor earns most" is the
  second question every hospital owner asks.
- **Service-level revenue** - `bill_items` is **never aggregated anywhere in the app**. The
  billable catalog is managed but never analysed.
- **Payment-mode mix** on the dashboard (exists in reports only - cash vs UPI matters for the
  drawer).
- **Discounts given** and **void rate** on the dashboard.
- Average length of stay, new vs returning patients, revenue per patient, YoY comparison.

Do **not** build all of these. `DEVELOPMENT_RULES` §9 says don't build for a future that
isn't confirmed. **Ask the hospital owner which three they want** and build those. My
recommendation for the first three: **census, pending approvals, doctor revenue** - one is an
operational fact, one is an action, one is the question owners ask most.

### P2-5. Hospital profile is read but never editable

`hospital_profile` is read (`lib/reports/repository.ts:191`) and printed on every receipt, but
there is **no screen to edit it**. Changing the hospital's name or tagline on printed receipts
currently requires a developer and a SQL statement.

### P2-6. Multi-location has no switcher and no label

`locationId` is silently derived from the admin's own user row (`page.tsx:37`). There is **no
indication on screen of which location the numbers describe**. With one branch this is
invisible; with two, an admin reads one branch's revenue believing it is the hospital's. At
minimum, label it now.

---

## P3 - Polish

- **`revenue-chart.tsx:31`** - `useState("#2e3192")` (indigo) then overwritten in a
  `useEffect` (`:33-40`). The app's primary is teal `#0d9488`. Result: a **flash of the wrong
  brand colour on every load**, and if `--primary` is `oklch(...)` the raw string may not
  resolve in Recharts SVG at all. `#e5e7eb`/`#6b7280`/`#fff` at `:77-86` bypass tokens and
  duplicate `reports/charts.tsx:32-38`'s own hand-synced hex mirrors - **two competing chart
  palettes, both hand-maintained**. Unify.
- **`users-manager.tsx:45`** - `meId` is accepted in the type and **never destructured**;
  `users/page.tsx:18` passes it. The intent was self-protection. As shipped, **an admin can
  open Deactivate on their own account** - verify the server action rejects it (if it does
  not, this is P0, not P3: it is a lockout with no recovery path but SQL).
- **`top-nav.tsx:331-338`** - the Bell notifications button has **no `onClick`**. A focusable,
  labelled, entirely dead control. Remove it or wire it.
- **`lib/nav.ts:15-16`** - comment is stale ("Only /admin and /admin/users are real today");
  all 10 items are real. The whole `disabled` branch (`nav.ts:11-12`, `top-nav.tsx:150-160`,
  `:258-266`) is dead code. Same for `receipts-library.tsx`'s `disabled` (`:209,219,233`) -
  never true for any section. Delete both.
- **`daily-report.tsx:40-45`** - `ROLE_HINT` duplicates `ROLE_TITLE` in `lib/nav.ts:67-72`;
  its own comment admits it. One source of truth.
- **Accessibility:** `activity-feed.tsx:94` `aria-expanded` with no `aria-controls`;
  `:192` scroll container not keyboard-focusable; `services-manager.tsx:149` purge countdown
  lives only in a `title=` tooltip (not screen-reader reliable, unreachable by keyboard) -
  and it gates data destruction; `top-nav.tsx:228` "More links" hover-opens on a plain `div`
  (touch-hostile).
- **`/reports` has no back link** (`daily-report.tsx:154`) while every other admin screen has
  one.
- `admin/page.tsx:18` imports `type Tone` unused; `:39` activity limit `30` inline;
  `activity-feed.tsx:35` ad-hoc `STORAGE_KEY` vs the `usePersistentView` pattern;
  `revenue-chart.tsx:21` `"C"` should be `"Cr"` for crore.

### Not bugs - leave alone

- `lib/permissions.ts:29` `PERMISSIONS` is **intentionally empty** and documented as such. The
  user dialog's checkbox list (`user-dialogs.tsx:176-219`) is therefore unreachable and shows
  "No optional permissions". This is a deliberate design decision, not a defect. Leave it.
- `shapeDepartmentSplit` (`summary.ts:140`) `Math.round` means shares needn't sum to 100%.
  Cosmetic, not worth the complexity.

---

## Suggested sequence

Each step ends green, and nothing later depends on a number that is still wrong.

1. **P0-4 first - write the reconciliation test and watch it fail.** It proves the
   double-count exists before you touch the SQL, and it is the thing that stops it returning.
2. **P0-1, P0-2, P0-3** - migration `0018`, write path, read path, void/refund rule. Test
   goes green. **The numbers are now true.**
3. **P0-5, P0-6, P0-7** - magic date, timezone, location scoping.
4. **P1-1** - indexes, with `EXPLAIN ANALYZE` before/after at realistic scale.
5. **P1-2, P1-3, P1-4** - Suspense, skeletons, honest empty/error states.
6. **P2-1** - the audit log viewer.
7. **P2-2, P2-3** - date range, export.
8. **P2-4** - after asking the hospital owner which metrics they want.
9. **P1-5, P2-5, P2-6, P3** - as capacity allows.

## Rules this work must not break

- Money stays **integer paise**. The current code is clean here - keep it that way.
- **No business logic in the dashboard UI.** The percentage/shape math stays in
  `lib/dashboard/summary.ts` (pure, tested); the SQL stays in the repository; the components
  display. `financial-overview.tsx` currently respects this - preserve it.
- **One source of truth per rule.** The reason P0-1 exists is that "money in" is defined twice.
  After this work it must be defined **once**, in a pure function both screens call.
- Every new money query gets a test. **Untested is not done** (§3).
- **Read `node_modules/next/dist/docs/` before writing Next.js code** (`AGENTS.md`).
