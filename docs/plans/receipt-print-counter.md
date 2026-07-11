# Plan — Receipt printing (counter side)

> **For the implementing session.** Read `CLAUDE.md`, `DEVELOPMENT_RULES.md`, `AGENTS.md`,
> `PROJECT_OVERVIEW.md` first. **Depends on `docs/plans/receipt-builder-admin.md` being done** —
> it reuses that plan's foundation: `getBillDocument(billId)` (`lib/printing/bill-document.ts`),
> `getActiveTemplate(type, locationId)` (`lib/printing/repository.ts`), the `bill_templates`
> table + seeded defaults, and `hospital_profile`. This plan is the **other half**: turn a saved
> bill into an A4 PDF and put the print dialog in front of the counter.

---

## 1. Context — what this adds, and the rule that governs it

Consultations and procedures already **save** finalized bills. The admin builder (previous
plan) lets an admin design the per-type layout. What's missing: **hand the patient the paper.**

The governing rule (`DEVELOPMENT_RULES §5`): **save before print, always. Save and print are
separate, retryable steps.** We already save in the submit action *before* the success screen —
so **print is a pure read that never mutates a bill**. If the printer jams, the counter clicks
Print again; it never re-submits and never risks a double bill.

**Output = a real A4 PDF** (pdfme `generate`), served from a URL. The browser prints PDFs
natively, so this is the most reliable counter print path and needs no print-CSS hacks.

---

## 2. Two small prerequisites in existing code

### 2a. Expose `billId` to the success screen (required)
Today both submit actions return only `billNumber` to the client, not `billId`:
- `ConsultationOutcome` (`lib/consultations/actions.ts:186`) and `ProcedureOutcome`
  (`lib/procedures/actions.ts:283`) — add `billId: number` (procedure) / `billId: number | null`
  (consultation) to the interface **and** to the `return { ok:true, data:{ … } }` payload.
  `createConsultationWithBill` / `createProcedureBill` already return `billId` — just thread it
  through. The print button needs it to build the PDF URL.

### 2b. Free revisit has no bill — no print
A consultation **revisit is free**: the action returns `billNumber: null` and creates **no
bill** (`lib/consultations/actions.ts` ~line 290). So `billId` is `null` there. **Only render
the Print button when `billId` is present.** A revisit shows its existing visit-acknowledgment
screen with no receipt. (If a printed slip for revisits is ever wanted, that's a separate ask.)

---

## 3. The PDF route (the core piece)

**Route Handler** `app/api/receipts/[billId]/pdf/route.ts` (Next 16 App Router — read the route
handler + async `params` guidance in `node_modules/next/dist/docs/`). `export const runtime =
"nodejs"` (pdfme fonts + `pg` need Node, not edge).

`GET /api/receipts/:billId/pdf`:
1. **Auth** — `requireSession` (`lib/auth/dal.ts`). Receipts carry patient data; never anonymous.
2. `doc = await getBillDocument(billId)` (previous plan). 404 if the bill doesn't exist.
3. `tpl = await getActiveTemplate(doc.type, locationId)` → the pdfme `Template` JSON.
4. Map `doc` → pdfme **`inputs`** (field-key → string; the line-items / expenses table → the
   `table` schema rows). Keep this mapping in a small **pure, tested** helper
   `lib/printing/to-pdf-inputs.ts` (one BillDocument → one inputs object), since the field keys
   are the catalog's contract (`lib/printing/fields.ts`).
5. `pdf = await generate({ template: tpl, inputs: [inputs], options: { font } })` — return the
   bytes with `Content-Type: application/pdf`, `Content-Disposition: inline; filename="receipt-<number>.pdf"`.
6. **Watermark / copy state** (read live from the bill, no mutation):
   - `doc.bill.status === "void"` → stamp **"VOID"**.
   - query `?copy=duplicate` → stamp **"DUPLICATE"** (used by reprints, §5b).
   - first print from the success screen passes no flag → **original, no watermark.**
   The watermark hook already exists as `BillDocument.bill.statusLabel`; feed it into a template
   text field or overlay.

> **Font gotcha (flag loudly):** pdfme's default font may not include the **₹** glyph. Bundle a
> Unicode font that has ₹ (e.g. a Noto Sans variant) under `lib/printing/fonts/`, register it in
> the `generate` `options.font`, and set it as the schemas' font. Verify ₹ renders, not tofu.

---

## 4. The Print button (counter UX)

Both flows end in a shared `SuccessScreen` (`consultation-flow.tsx:220` /
`procedure-flow.tsx:306`). Add a **primary "Print receipt" button** there (only when
`outcome.billId != null`):

- **Behaviour:** open `/api/receipts/<billId>/pdf` in a **hidden `<iframe>`** and call
  `iframe.contentWindow.print()` on load (falls back to opening the URL in a new tab if the
  iframe print is blocked). This shows the OS/browser print dialog straight to the counter's A4
  printer. A tiny reusable `printReceipt(billId)` client helper (`components/print-receipt.ts`).
- **Keyboard-first (dev-rules §UX):** the button is focusable and reachable; consider `P` /
  Enter to print, then the existing action to start the next patient. No confirmation popup —
  printing is reversible (just reprint).
- **Retryable & non-blocking:** the button stays enabled; clicking again reprints. Print failure
  never affects the saved bill. Keep the existing "New consultation / New bill" reset intact —
  print and reset are independent.
- **Best-effort audit:** log a `receipt.printed` activity row from the click (new tag in
  `lib/activity/actions.ts`, `targetId: billId`, details `{ bill_number, copy: "original"|"duplicate" }`).
  Best-effort — a logging failure must not block printing. (Log from the explicit click, **not**
  inside the GET route, so an iframe double-fetch doesn't double-count.)

---

## 5. Reprints from history (duplicate copies)

### 5b. Reprint action
On the **consultations history** and **procedures history** rows (the lists Agent B aligned to
the design system), add a small **"Reprint"** action → `printReceipt(billId, { copy: "duplicate" })`
which hits `…/pdf?copy=duplicate` → the PDF carries the **DUPLICATE** watermark. Same route, same
document, no new server logic beyond honoring the query flag. Log `receipt.printed` with
`copy: "duplicate"`.

---

## 6. Scope boundary (do NOT build here)
- **No void / re-issue workflow.** The route already renders a **VOID** watermark if a bill's
  `status` is `void`, so receipts Just Work once voiding ships — but the **action** that voids a
  bill and re-issues a corrected one (`bills.replaced_by_bill_id`, `voided_by/at/reason` columns
  already exist) is a **separate plan**. Don't build the void UI here.
- **No IP receipts** (no IP flow yet). The route inherits the builder plan's guarded `ip` branch.
- **No thermal/58mm** — `PROJECT_OVERVIEW` says A4; single A4 PDF only.
- **No email/WhatsApp** of receipts — print only.

---

## 7. Definition of done
- [ ] `billId` threaded into both outcomes; success screen shows **Print** only when a bill exists.
- [ ] `GET /api/receipts/:billId/pdf` returns a valid A4 PDF for a **consultation** bill and a
      **procedure** bill (with its line-items table), auth-gated, Node runtime.
- [ ] **₹ renders** correctly (bundled Unicode font); amounts + amount-in-words match the bill.
- [ ] `to-pdf-inputs.ts` is pure + **Vitest-covered** (consultation vs procedure mapping,
      empty discount, multi-line procedure).
- [ ] Success-screen Print opens the print dialog to the A4 printer; clicking again reprints;
      the saved bill is never mutated by printing.
- [ ] Reprint from history stamps **DUPLICATE**; a `void` bill stamps **VOID**.
- [ ] `receipt.printed` activity row on each print (best-effort, never blocks).
- [ ] Free **revisit** shows no Print button (no bill).
- [ ] `npm test`, `npx tsc --noEmit`, `npx next build` clean. Light theme only.

## 8. Verify (end-to-end)
1. Run a **procedure** bill to the success screen → click **Print** → the browser print dialog
   opens on an A4 receipt showing hospital header, patient, the line-items table, subtotal /
   discount / total, and **amount in words** with a correct **₹** glyph.
2. Run a **consultation** (new patient, not a revisit) → Print → receipt shows doctor + revisit
   validity, no items table. Do a **free revisit** → **no Print button** appears.
3. From **procedures history**, click **Reprint** on that bill → PDF carries **DUPLICATE**.
4. Manually set a bill `status='void'` in the DB → its receipt prints with **VOID**.
5. Kill the printer / cancel the dialog, click Print again → reprints fine; the bill row and
   `bill_number` are unchanged (print mutates nothing). Activity feed shows `receipt.printed` rows.
6. `npm test` (inputs-mapping green), `npx next build` clean.

## 9. After this
The **void + re-issue** correction workflow (the audit-trail path in the rules) is the natural
next step — the columns and the VOID receipt rendering are already in place, so it's the action
+ supervisor gate + history UI that remain. Then **IPD admit→discharge**, then daily reports.
