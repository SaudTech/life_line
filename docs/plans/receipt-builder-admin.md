# Plan — Receipt / Report Builder (admin side)

> **For the implementing session.** Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, `AGENTS.md`,
> and `PROJECT_OVERVIEW.md` first. This builds the **admin authoring half** of receipt
> printing. The **counter print button (save-before-print, duplicate/void handling)** is a
> SEPARATE later plan — but everything built here (the data resolver + field catalog + seeded
> templates) is exactly what that print step will consume, so it is the shared foundation.

---

## 0. Client updates (call, 2026-07-12) — these REVISE the sections below

Four things came back from the client. Fold them in; where they change an earlier decision it is
called out at the point of change too.

1. **Receipt set = Consultation, Procedure, End-Day.** The client names three printed documents:
   the consultation receipt, the procedure receipt, and an **End-Day report** (the "My day" close-out
   — see `docs/plans/daily-report-my-transactions.md`). **No advance-payment receipt** exists.

2. **A print button appears ONLY when a valid active design exists for that type — the default for
   ALL prints.** This is the unifying rule and it dissolves the "advance receipt?" question: every
   type is treated identically — button shown if and only if a valid, active template exists for
   `(type, location)`. **Advance simply has no design, so no button.** Same for any type not yet
   designed. **This RETIRES the "always seed a default so printing works day one" promise in §4:** a
   seed is now an *optional starter*, not a guarantee, and the gate is template existence + validity
   (`checkTemplate` passes, fields valid for the type). The gating itself lives in the counter plan;
   the builder side just has to make "no active template" a real, first-class state (empty designer;
   the type shows as "No design yet" in the library).

3. **Per-design paper size — fully customisable (owner: exact sizes unknown yet).** Size is a
   **per-template setting** in the designer, stored in the template's `basePdf` width/height (mm). The
   designer offers **quick presets** (A4 `210×297`, Half-A4 `210×148.5`, A5 `148×210`) **and a custom
   width×height (mm) entry** so any paper the client actually uses can be dialled in without a code
   change. See §4 (storage) and §5 (designer control).

4. **Reserve empty space at the top for pre-printed letterhead.** The paper already carries the
   hospital header in colour; our content must **start below** it and never overprint it. So each
   template has a **top reserved height (mm)** setting; the designer shows that band shaded/locked and
   the generated PDF places content below it (pdfme `basePdf.padding` top). **Implication for §3c:**
   the digital hospital-header block becomes **optional** — on letterhead it is omitted and the
   reserved band does the job; keep `hospital_profile` only for plain-paper / End-Day prints not on
   letterhead. Do **not** hard-code a header into the seeded templates.

> **Owner decisions (confirmed 2026-07-12):**
> - **End-Day IS a pdfme template type** (`end_day`), designed in the same builder with the same
>   size + letterhead handling as the others. This **supersedes** the browser-CSS print approach in
>   `docs/plans/daily-report-my-transactions.md` (that plan is updated to consume the printing
>   foundation instead). Its field catalog (§3d) covers the report's numbers, not a single bill.
> - **Paper size is fully custom** in the designer (presets + custom width×height mm) — the exact
>   client paper sizes aren't fixed yet, so no size is hard-coded (§0.3).
> - **IP receipt** stays in the type enum but **unseeded/undesigned** — the §0.2 gate auto-hides its
>   button until someone designs one. No IP work is forced here.

---

## 1. Context — why this, and the one hard problem

Consultations and procedures already produce **finalized bills with real DB-issued
`bill_number`s** (`bills` + `bill_items`), but there is **no way to hand the patient a
receipt**. That is the missing half of the counter loop. Before we can print, an admin must be
able to **design the A4 receipt layout** and we must be able to **feed a saved bill into that
layout**.

**The hard part you called out:** the three bill `type`s carry *different data*:

| type | extra data beyond the common core |
|---|---|
| `consultation` | doctor, reason, fee, `valid_until` (revisit window) — **no line items** |
| `procedure` | a table of `bill_items` (description / qty / unit / line total) |
| `ip` (future) | admission dates, room charge, advance paid, `admission_expenses` table, balance/refund — **schema exists (`admissions`, `admission_expenses`), no flow shipped yet** |

So this is **not one template** — it is **one template per bill type**, all binding to a
**single normalized data model** so the shared parts (hospital header, patient block, totals)
stay identical and only the type-specific section differs. Design it type-extensible from day
one so adding `ip` later is just one resolver branch + one seeded template, no refactor.

---

## 2. Library — pdfme (pinned, add to deps)

`PROJECT_OVERVIEW` mandates **pdfme** for A4 layouts. It is **not installed yet**. Add pinned:
`@pdfme/common`, `@pdfme/schemas`, `@pdfme/ui` (the `Designer` — admin builder), and
`@pdfme/generator` (renders a `template` + `inputs` → PDF; used later by the print step and
now by the builder preview). Read the pdfme docs for the installed version before coding — the
`Template` JSON shape (`basePdf`, `schemas`) and the **`table` schema plugin** (dynamic rows —
use it for line items / expenses) are the parts that matter. Follow the **Next.js 16** rules in
`AGENTS.md`; the `Designer`/`generator` are **client-only** (`"use client"`, dynamic import,
no SSR) because they touch the DOM/fonts.

---

## 3. The foundation (build these first — pure, tested, no UI)

### 3a. `lib/printing/bill-document.ts` — the normalized render model
One TS type + one resolver. `getBillDocument(billId)` does all the joins and returns a
**fully display-ready** object. **All money is pre-formatted to rupee strings here** — the
template does zero math and zero business logic (dev-rules: no logic in UI). Discriminated on
`type` so each variant is type-safe:

```ts
type BillDocument = {
  hospital: { name: string; address?: string; phone?: string };   // §3c
  bill: { number: string; dateText: string; timeText: string;
          statusLabel?: string; /* "DUPLICATE"/"VOID" watermark hook */ };
  patient: { code: string; name: string; ageGender?: string; phone?: string; area?: string };
  payment: { modeLabel?: string; cashierName: string };
  totals: { subtotalText: string; discountText?: string;
            totalText: string; totalInWords: string };            // §3b amount-in-words
} & (
  | { type: "consultation"; doctorName: string; reason?: string; validUntilText: string }
  | { type: "procedure"; items: { desc: string; qty: string; unitText: string; lineText: string }[] }
  | { type: "ip"; admittedText: string; dischargedText?: string;
      roomChargeText: string; advanceText: string;
      expenses: { item: string; qty: string; amountText: string }[];
      balanceText: string }                                       // future; resolver branch may throw "not shipped" for now
);
```
Joins by type: always `bills → patients → locations`; `consultation` also
`bills.consultation_id → consultations → doctors`; `procedure` also `bill_items`; `ip` later
via `admissions`/`admission_expenses`. **No bill-fetch-by-id helper exists today — create it
here.** Reuse `formatPaise` (`lib/money.ts`) and the clinic-timezone date pattern
(`clinicToday` in `lib/consultations/actions.ts`) for dates.

### 3b. `lib/printing/amount-in-words.ts` — Indian rupees in words (tested)
`"₹1,23,456"` → `"One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees Only"`.
Indian lakh/crore grouping. Pure function, **Vitest table of cases** (0, single rupee, paise,
lakh boundary, crore) — receipts legally show amount in words, so this is correctness-critical.

### 3c. Hospital letterhead data — small schema gap to close
`locations` has **only `name`** — no address/phone/GST for the receipt header. Add a
forward-only migration (next number after `0009`) with a tiny **`hospital_profile`** single-row
(per `location_id`) table: `name, address, phone, gstin?, footer_note?, updated_at, updated_by`
(all text). Seed one row for the default location in the same migration (or in `first-run/`).
The resolver reads it for `BillDocument.hospital`.

### 3d. `lib/printing/fields.ts` — the field catalog (single source of truth)
A pure registry listing **every bindable field, grouped by bill type**, each with a stable
`key` (matches a pdfme schema field name), a human `label`, and a `sample` value. The builder
reads it to render the "insert field" palette and to **validate a saved template only
references fields valid for its selected type**; §3a's resolver produces exactly these keys.
Also export a **`sampleBillDocument(type)`** (fixed fake data per type) so the builder preview
shows a realistic receipt with no real bill. One registry feeding resolver + builder + preview
keeps them from drifting.

---

## 4. Template storage — per type (size + letterhead offset live in the template)

Migration (same or next number): **`bill_templates`**
`id, location_id, bill_type CHECK IN ('consultation','procedure','ip','advance','end_day'),
name, schema_json JSONB NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true, updated_at, updated_by
UUID REFERENCES users(id)`, with a **unique active template per `(bill_type, location_id)`**
(partial unique index `WHERE is_active`). `schema_json` holds the pdfme `Template`.

> **§0.1 note:** the enum is a **superset** — `advance` and `end_day` (and `ip`) are listed so the
> system is uniform, but nothing forces a design for them. With the §0.2 gate, a type with no active
> valid template simply shows **no print button**. (`end_day` only if the owner confirms End-Day is a
> pdfme template — §0 flag.)

**Paper size + top offset live in `schema_json.basePdf` (§0.3, §0.4).** Use pdfme's blank-page
`basePdf` form `{ width, height, padding: [top, right, bottom, left] }` (all mm), NOT a base64 PDF:
- **width/height** = the chosen preset (A4 `210×297`, Half-A4 `210×148.5`).
- **padding[0] (top)** = the reserved letterhead band; content renders below it.
Keeping both inside `schema_json` means the generator (counter plan) already honours them with no
extra columns — one source of truth. (Optionally mirror `paper_size`/`top_offset_mm` to columns only
if you later need to query them; not required.)

**Seeding is now OPTIONAL (revised per §0.2).** A seeded starter template per *shipped, confirmed*
type (Consultation, Procedure) is a convenience, **not** a guarantee that a button appears — the
button is gated on a valid active template regardless. Any seed must respect §0.4: **no hard-coded
hospital header**, a sensible default top offset, and a default size. Keep seeds as checked-in JSON
(`lib/printing/defaults/`). Do **not** seed `advance`; seed `end_day`/`ip` only once confirmed.

Data access in **`lib/printing/repository.ts`**: `getActiveTemplate(type, locationId)`,
`saveTemplate(...)`, `resetToDefault(type, locationId)`. Follow the existing repository +
Server Action pattern (see `lib/services/`).

---

## 5. Admin builder UI

New admin route **`app/(dashboard)/admin/receipts/`** (label "Receipts" / "Print templates").
- **Gate it**: admin-only, or add a `receipts.manage` permission to `lib/permissions.ts` +
  the user form (mirror how `service_lines.modify` was added). Enforce on the server in the
  action (`requirePermission`/`requireAdmin` from `lib/auth/dal.ts`) — not just hidden UI.
- **Layout** (match the User-Management design system — `admin/users/users-manager.tsx`):
  - **Bill-type selector** (Consultation / Procedure / End-Day / others). A type with no active
    template loads an **empty** designer and reads as "No design yet" (§0.2) — not an error.
  - **Paper-size control (§0.3):** preset selector (A4 / Half-A4 / A5) **plus custom width×height
    (mm) inputs**. Any choice rewrites `basePdf.width/height`; validate sane bounds (e.g. 50-420mm)
    and warn before shrinking if fields would fall outside the new page.
  - **Top-offset control (§0.4):** a "Reserved letterhead height (mm)" input that sets
    `basePdf.padding[0]`. Render that top band **shaded and locked** on the canvas ("Pre-printed
    letterhead — keep clear") so the admin never places fields in it; content starts below.
  - **pdfme `Designer`** (client-only, dynamic import), initialized from the loaded `schema_json`
    (its `basePdf` carries the chosen size + top offset); default a fresh template to A4 with a
    sensible top offset and **no hard-coded header** (§0.4).
  - **Field palette** from `lib/printing/fields.ts` filtered to the selected type — click to
    insert that field onto the canvas; the line-items / expenses table uses pdfme's **`table`**
    schema.
  - **Live preview** button → render current template with `sampleBillDocument(type)` via
    `@pdfme/generator` and show the PDF (so the admin sees a realistic receipt, no real patient
    data).
  - **Save** (writes `schema_json`, validates fields against the catalog for that type,
    `revalidatePath`), and **Reset to default** (restores the seeded template).
- **Activity log**: log template save + reset via the existing `logActivity`
  (`lib/activity/actions.ts`) with a new tag (e.g. `"receipt.template_saved"`).
- **Mobile**: the Designer is a desktop admin tool — it is acceptable for it to require a wider
  screen; show a clean "best edited on a larger screen" notice below ~lg instead of trying to
  cram the canvas. (Consistent with the batch-polish mobile rules for the rest of admin.)

---

## 6. Scope boundary (do NOT build here)

- **No counter print button / no `window.print` / no save-before-print / no duplicate-copy or
  void watermark wiring** — that is the next plan (the counter side). This plan stops at:
  admin can design + save a per-type template, and `getBillDocument` + `generator` can turn a
  saved bill into a PDF (proven via the builder preview). The print step will just call the same
  two pieces from the consultation/procedure success screens.
- **No IP flow.** Wire the `ip` type into the catalog/template selector as **disabled**; leave
  the resolver's `ip` branch as a guarded "not available yet". Adding it later = one resolver
  branch + one seeded template.

---

## 7. Definition of done
- [ ] pdfme deps pinned; `@pdfme/ui` Designer renders client-only under Next 16 (no SSR error).
- [ ] `hospital_profile` migration + default-location seed; resolver reads the header from it.
- [ ] `getBillDocument(billId)` returns a correct normalized model for a **consultation** bill
      and a **procedure** bill (with items); `ip` guarded.
- [ ] `amount-in-words` + any paise formatting are **pure + Vitest-covered** (lakh/crore edges).
- [ ] `bill_templates` table + seeded default template per shipped type; `getActiveTemplate`
      returns the seed before any edit.
- [ ] `/admin/receipts`: pick type → edit in Designer → **Preview** (sample data) → **Save** →
      reload shows the saved layout; **Reset** restores default. Permission-gated + server-enforced.
- [ ] Template save/reset writes an activity-log row.
- [ ] `npm test`, `npx tsc --noEmit`, `npx next build` all clean. Light theme only.

## 8. Verify (end-to-end)
1. `npm run migrate` → `hospital_profile` + `bill_templates` created and seeded.
2. Log in as admin → **Receipts** → select **Procedure** → **Preview**: a realistic A4 receipt
   renders from sample data with a line-items table and amount-in-words.
3. Move a field, **Save**, reload → the change persisted. **Reset to default** → seed restored.
4. Switch to **Consultation** → its template loads independently (doctor/validity, no items).
5. `IP` selector is visibly disabled. Activity feed shows a "template saved" row.
6. `npm test` (amount-in-words + resolver cases green), `npx next build` clean.

## 9. Next after this
The **counter print step**: on the consultation/procedure success screen, a **Print** button
that fetches `getBillDocument(billId)`, renders it with the active template via `@pdfme/generator`,
and opens the browser print dialog — **save already happened**, so print is a separate,
retryable step (dev-rules §5), with a "DUPLICATE" watermark on reprints and "VOID" on voided
bills (hooks already in `BillDocument.bill.statusLabel`).
