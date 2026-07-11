# Plan — Receipts: from "tabs" to a real template library

> **For the implementing session.** Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, `AGENTS.md`,
> `PROJECT_OVERVIEW.md` first. This **redesigns the admin Receipts page only**. It **revises the
> UI described in `receipt-builder-admin.md` §5** (the type-tabs + single-template editor) and
> supersedes it. **Do NOT touch the top nav or any other admin screen — the owner was emphatic:
> no navigation changes of any kind.** `/admin/receipts` stays the single existing entry point.

---

## 1. Context — the problem, in the owner's words

The Receipts page is a **full report designer**, but today it's crammed behind **"super simple
tabs"** (a Consultation / Procedure / IP segmented switch) that always edit **the one active
template per type**. Two things are wrong:

1. **A big feature reads as a tiny widget.** It doesn't look or behave like the substantial tool
   it is — you land straight in an editor with a 3-button tab strip on top.
2. **No multiple designs.** The owner wants to **create several designs for consultation (or any
   type) and keep exactly one active/used** — like having a few receipt layouts on the shelf and
   choosing which one the counter prints. Today "Save" just overwrites the active layout; there
   is no library, no naming, no "make this one the active one."

**The happy surprise:** the data model already supports this. `bill_templates`
(`migrations/0010_printing.sql`) holds **many rows per `(bill_type, location_id)`**, with a
**partial unique index `bill_templates_active_unique … WHERE is_active`** guaranteeing exactly
one active per type. Today `saveTemplate` inserts a fresh active row every save and the extras
are dead "history." We just need to **treat those rows as named designs** and build the UI. **No
migration required** (every column we need — `name`, `is_active`, `updated_at`, `updated_by` —
already exists).

---

## 2. The semantic shift (data layer) — `lib/printing/repository.ts`

Today: a save = "deactivate old active, insert new active" (version-history semantics). Change to
**library semantics: a row = a named design; editing updates it in place; `is_active` marks the
one the counter prints.**

**Keep unchanged:** `getActiveTemplate(type, locationId)` — the **print/preview resolver still
reads the active row** exactly as now. Nothing on the counter side changes.

**Add:**
- `listTemplates(locationId)` → all rows: `{ id, bill_type, name, is_active, updated_at }[]`,
  ordered by type then `updated_at desc`. Feeds the library. (Don't select `schema_json` here —
  it's large; the list doesn't need it.)
- `getTemplateById(id, locationId)` → one full row (with `schema_json`) for the editor. Scoped by
  location so one branch can't open another's.
- `createTemplate({ type, locationId, name, schemaJson, updatedBy })` → INSERT. **Active only if
  it's the first design for that type** (so a type is never left with zero active); otherwise
  `is_active = FALSE`. Returns the new id.
- `updateTemplate({ id, locationId, name?, schemaJson?, updatedBy })` → **UPDATE in place** by id
  (this is the new "Save" for an existing design — no more row-per-save pile-up).
- `activateTemplate(id, locationId, updatedBy)` → **one transaction**: `UPDATE … SET is_active =
  FALSE WHERE bill_type = (that row's type) AND location_id = $ AND is_active`, then `SET
  is_active = TRUE` on the target. The partial unique index guarantees correctness; do it in
  `BEGIN/COMMIT/ROLLBACK` like `saveTemplate` does today.
- `duplicateTemplate(id, locationId, updatedBy)` → copy `schema_json` into a new **inactive** row
  named e.g. `"<name> (copy)"`. Returns the new id.
- `deleteTemplate(id, locationId)` → **guarded** (see §5 edge cases): refuse if the row is active
  or is the last design of its type.

`resetToDefault` stays (restores a fresh default design). The old `saveTemplate`
insert-on-every-save can be **removed once `saveTemplateAction` moves to create/update** (grep
for its uses first).

> Existing piled-up inactive rows (from the old save behaviour) will simply appear in the library
> as designs — harmless. Optional one-time cleanup is not required; the admin can delete extras.

---

## 3. Actions — `lib/printing/actions.ts`

Mirror the repository additions as admin-only server actions (each re-checks `requireAdmin`,
resolves `locationId`, `revalidatePath("/admin/receipts")`). **Reuse the existing save
validation** — `checkTemplate` (structural) + the **field-catalog cross-check** against
`fieldKeysForType` (semantic) — inside both create and update, so no design can bind a field that
doesn't belong to its bill type. That block already exists in `saveTemplateAction`; factor it into
a small `validateTemplateForType(type, schemaJson)` helper and call it from both.

Actions: `listTemplatesAction`, `getTemplateAction`, `createTemplateAction`,
`updateTemplateAction`, `activateTemplateAction`, `duplicateTemplateAction`,
`renameTemplateAction` (thin `updateTemplate` with just `name`), `deleteTemplateAction`. Keep
`getActiveTemplateAction`/`resetTemplateAction`/`logReceiptPrintedAction`.

**Activity log** (new tags in the registry the feed reads — follow how `receipt.template_saved`
was added): `receipt.template_created`, `receipt.template_activated`, `receipt.template_deleted`
(tone `danger`), `receipt.template_duplicated`. Keep `receipt.template_saved` for updates. Each
with `targetId: id`, `details: { bill_type, name }`.

---

## 4. UI — two levels, both in the existing `/admin/receipts` route

The whole redesign lives under the one route (no nav change). Split the single mega-component into
a **library index** + a **focused editor**, as real sub-routes so each is a deep-linkable place
and the feature reads as substantial:

### 4a. Library index — `app/(dashboard)/admin/receipts/page.tsx` (server component)
Replace the current "load the active template and drop into the editor" with a **template
library** that uses the **User-Management design system** (`admin/users/users-manager.tsx` — the
canonical look: page header, sectioning, cards, empty states, semantic tokens, light-only).

Layout:
- **Page header:** title "Receipt designs" + one-line description. No editor toolbar here.
- **Grouped by bill type** — a section per type (**Consultation**, **Procedure**, **IP** shown
  disabled / "coming soon"). Each section header has a **"New design"** button (creates a blank/
  default-seeded design of that type and opens the editor).
- **Designs as cards** within each section (the users-screen card idiom). Each card shows:
  - **Name**, an **"Active" badge** on the one that's used at the counter (green — status colour
    only, §UX), and **updated** time (reuse `relativeTime` from `lib/admin/activity`).
  - **Actions** (kebab or inline buttons): **Edit** (→ editor), **Set active** (disabled/hidden if
    already active), **Duplicate**, **Rename**, **Preview** (existing `PreviewDialog`), **Delete**
    (guarded — see §5). Any dialog follows the batch-polish rule: **primary action LEFT, Cancel
    RIGHT.**
  - Optional (nice-to-have, defer if it adds risk): a small rendered thumbnail. Otherwise a clean
    receipt glyph. Don't block the redesign on live thumbnails.
- **Empty/edge:** a type always has ≥1 design (the seeded default), so sections are never empty in
  practice; still handle it gracefully.

This alone fixes the complaint: the feature now presents as a managed library of designs, not a
tab strip, and "multiple designs, one active" is front and centre.

### 4b. Editor — `app/(dashboard)/admin/receipts/[templateId]/page.tsx`
Move the **existing designer** (`receipts-manager.tsx`'s designer half: the field palette +
`ReceiptDesigner` + image upload + `insertField`/`appendSchema` logic — keep all of it) into a
**single-design editor** loaded by id. Changes vs today:
- **No bill-type tabs here.** The design's type is fixed (it came from the row); the palette shows
  `fieldsForType(row.bill_type)`.
- **Header:** Back → library, the **design name** (editable via Rename), an **"Active" badge** if
  it's the used one (plus a **"Set active"** button if not), **Preview**, **Save** (calls
  `updateTemplateAction` — updates THIS design in place), and **Save as new** (→
  `duplicateTemplateAction` then open the copy). Drop the old global "Reset to default" from the
  editor header (offer it as a per-design action or a "New from default" in the library instead).
- Keep the **client-only dynamic import** of `ReceiptDesigner` (ssr:false), the
  `h-[calc(100vh-116px)]` full-height shell, and the **"needs a larger screen" notice below lg** —
  the designer is a desktop tool; that's acceptable per the mobile rules.
- `new` handling: "New design" can route to `…/[templateId]` after the row is created server-side
  (simplest — create then redirect), so the editor always has a real id to save against.

---

## 5. Edge cases / guards (money-counter integrity — the counter must always be able to print)
- **Every type keeps exactly one active design.** Enforced by the partial unique index + the
  transactional `activateTemplate`. `createTemplate` makes the first design of a type active.
- **Deleting is guarded:** refuse to delete **the active design** (UI: hide/disable Delete on it;
  server: reject with a clear message — "Set another design active first") and refuse to delete
  **the last remaining design of a type** (the counter needs one to print). Nothing is silently
  removed (§ save-before-print / no silent deletes spirit).
- **Activation is atomic** — never a window with zero or two active rows (transaction).
- **Field validation on save/create** — a design can't bind a field foreign to its bill type
  (reuse the existing catalog check). Invalid pdfme JSON is rejected by `checkTemplate`.
- **Location-scoped** everything (`getTemplateById`/update/delete take `locationId`) — no
  cross-branch edits.
- **Concurrent admins:** last write wins on an in-place update is acceptable here (single-hospital,
  rare); the active-uniqueness invariant is still index-protected.

---

## 6. Out of scope (do not build)
- **No nav changes** (top bar untouched — owner's hard rule).
- **No changes to the print/counter side** — `getActiveTemplate` is unchanged, so printing keeps
  working exactly as today.
- **No IP designs** — IP stays disabled.
- **No hospital-profile/letterhead editor** here (separate future screen).
- **No live thumbnail rendering** unless trivial — optional enhancement, don't block on it.

## 7. Definition of done
- [ ] `/admin/receipts` shows a **library of named designs grouped by bill type**, using the
      user-management design system; the used design shows an **Active** badge.
- [ ] Admin can **create, edit (in place), duplicate, rename, set-active, preview, and delete**
      designs; delete is guarded (not the active one, not the last of a type).
- [ ] Exactly one active design per type at all times; **the counter still prints the active one**
      (verify a real print/preview still works — `getActiveTemplate` untouched).
- [ ] Editor is a focused per-design screen at `…/[templateId]`; no type-tabs; keeps the pdfme
      designer, field palette, image upload, and the desktop-only notice.
- [ ] Field-catalog + `checkTemplate` validation runs on create and update.
- [ ] New activity tags fire (created / activated / duplicated / deleted); saves still log.
- [ ] Dialogs: primary-left / Cancel-right. Light theme only. **Top nav unchanged.**
- [ ] `npm test`, `npx tsc --noEmit`, `npx next build` clean.

## 8. Verify (end-to-end)
1. Open `/admin/receipts` → a real **library** appears (not a tab strip): Consultation and
   Procedure sections, each with at least the default design carrying an **Active** badge.
2. **New design** under Consultation → editor opens → arrange fields → **Save** → back to library
   shows a second Consultation design (inactive).
3. **Set active** on the new one → its badge moves; the old one loses Active. **Preview** it.
4. Run a real **consultation print/preview** → it uses the now-active design (confirms the counter
   reads `getActiveTemplate`).
5. **Duplicate**, **Rename**, then **Delete** a non-active design → works. Try to delete the
   **active** design → **blocked** with a clear message. Delete down to the last design of a type →
   **blocked**.
6. Activity feed shows created / activated / deleted rows.
7. **Top nav is visually identical to before.** `npm test` + `npx next build` clean.

## 9. Note for the implementer
This replaces `receipts-manager.tsx`'s dual role (tabs + editor). Reuse — don't rewrite — the
proven designer internals (`ReceiptDesigner`, `insertField`, `appendSchema`, image upload,
`PreviewDialog`, the field catalog in `lib/printing/fields.ts`). The work is mostly **(a)** the
repository/action additions in §2–§3 and **(b)** splitting the one component into a library index
+ an `[templateId]` editor in §4. No DB migration.
