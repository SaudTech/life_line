import type { Template } from "@pdfme/common";
import { A4_BASE_PDF, box, hLine, staticText, textField } from "./build";

// Built-in FIXED A4 layout for the "Advance Deposit Receipt" (plan §5b) - the
// patient's proof of the advance handed over at admission. NOT admin-editable in
// the receipts designer yet (noted as a later graduation into the template
// library - that would be a new template kind, out of scope here). Rendered
// through the same pdfme generator + font + print path as bills.
//
// Uses plain `text` value fields (whole content replaced by the input at generate
// time, keyed by field name) paired with `staticText` captions - self-contained,
// independent of the bill field catalog (advance-receipt.ts's advanceReceiptToInputs
// supplies each field name's value verbatim). A4 usable area x 10..200.
export const ADVANCE_RECEIPT_DEFAULT_TEMPLATE = {
  basePdf: A4_BASE_PDF,
  schemas: [
    [
      // ── Letterhead ──────────────────────────────────────────────────────
      textField("hospitalName", "Life Line", { x: 10, y: 11, w: 190, h: 10 }, {
        fontSize: 24,
        alignment: "center",
        fontColor: "#0f172a",
      }),
      textField("hospitalTagline", "A MULTI SPECIALITY HOSPITAL", { x: 10, y: 22, w: 190, h: 4 }, {
        fontSize: 8,
        alignment: "center",
        characterSpacing: 2,
        fontColor: "#475569",
      }),
      textField("hospitalAddress", "Chandrayangutta 'X' Road, Hyderabad - 500 005", { x: 10, y: 27, w: 190, h: 4 }, {
        fontSize: 8.5,
        alignment: "center",
        fontColor: "#334155",
      }),
      textField("hospitalPhone", "Tel: 6309192617, 6309192618, 7382003300", { x: 10, y: 31, w: 190, h: 4 }, {
        fontSize: 8.5,
        alignment: "center",
        fontColor: "#334155",
      }),
      hLine(10, 38, 190, 0.6, "#0f172a"),

      // ── Title band ──────────────────────────────────────────────────────
      staticText("ADVANCE DEPOSIT RECEIPT", { x: 10, y: 41, w: 190, h: 6 }, {
        fontSize: 12,
        alignment: "center",
        characterSpacing: 1,
        fontColor: "#0f172a",
      }),

      // ── Meta row ────────────────────────────────────────────────────────
      staticText("Receipt No:", { x: 10, y: 50, w: 24, h: 6 }, { fontSize: 10, fontColor: "#475569" }),
      textField("receiptRef", "128", { x: 34, y: 50, w: 55, h: 6 }, { fontSize: 10, fontColor: "#0f172a" }),
      staticText("Date:", { x: 120, y: 50, w: 14, h: 6 }, { fontSize: 10, fontColor: "#475569" }),
      textField("admittedDateText", "01 Jul 2026", { x: 134, y: 50, w: 66, h: 6 }, { fontSize: 10, fontColor: "#0f172a" }),

      // ── Patient block (boxed) ───────────────────────────────────────────
      box({ x: 10, y: 58, w: 190, h: 22 }),
      staticText("Name:", { x: 14, y: 61, w: 16, h: 6 }, { fontSize: 9.5, fontColor: "#475569" }),
      textField("patientName", "Asha Rao", { x: 32, y: 61, w: 72, h: 6 }, { fontSize: 10, fontColor: "#0f172a" }),
      staticText("ID:", { x: 110, y: 61, w: 10, h: 6 }, { fontSize: 9.5, fontColor: "#475569" }),
      textField("patientCode", "LL000123", { x: 122, y: 61, w: 74, h: 6 }, { fontSize: 10, fontColor: "#0f172a" }),
      staticText("Age / Gender:", { x: 14, y: 70, w: 28, h: 6 }, { fontSize: 9.5, fontColor: "#475569" }),
      textField("patientAgeGender", "34 / Female", { x: 44, y: 70, w: 60, h: 6 }, { fontSize: 10, fontColor: "#0f172a" }),
      staticText("Phone:", { x: 110, y: 70, w: 16, h: 6 }, { fontSize: 9.5, fontColor: "#475569" }),
      textField("patientPhone", "9876543210", { x: 128, y: 70, w: 68, h: 6 }, { fontSize: 10, fontColor: "#0f172a" }),

      // ── Advance received (boxed, emphasised) ────────────────────────────
      box({ x: 10, y: 86, w: 190, h: 32 }, { borderColor: "#0f172a", borderWidth: 0.4 }),
      staticText("ADVANCE RECEIVED", { x: 14, y: 90, w: 120, h: 5 }, {
        fontSize: 9,
        characterSpacing: 1,
        fontColor: "#475569",
      }),
      staticText("₹", { x: 14, y: 97, w: 8, h: 12 }, { fontSize: 20, fontColor: "#0f172a" }),
      textField("advanceText", "5,000.00", { x: 24, y: 97, w: 110, h: 12 }, { fontSize: 22, fontColor: "#0f172a" }),
      staticText("Payment mode:", { x: 140, y: 92, w: 56, h: 5 }, { fontSize: 9, fontColor: "#475569" }),
      textField("paymentModeLabel", "Cash", { x: 140, y: 98, w: 56, h: 7 }, { fontSize: 12, fontColor: "#0f172a" }),
      textField("advanceInWords", "Five Thousand Rupees Only", { x: 14, y: 110, w: 182, h: 6 }, {
        fontSize: 9,
        fontColor: "#334155",
      }),

      // ── Signature ───────────────────────────────────────────────────────
      hLine(130, 138, 66, 0.3, "#94a3b8"),
      staticText("Received by (signature)", { x: 130, y: 140, w: 66, h: 5 }, {
        fontSize: 8.5,
        alignment: "center",
        fontColor: "#475569",
      }),

      // ── Footer ──────────────────────────────────────────────────────────
      hLine(10, 156, 190, 0.4, "#94a3b8"),
      textField("footerNote", "This advance will be adjusted against the final bill at discharge.", { x: 10, y: 159, w: 190, h: 6 }, {
        fontSize: 9,
        alignment: "center",
        fontColor: "#475569",
      }),
    ],
  ],
} as unknown as Template;
