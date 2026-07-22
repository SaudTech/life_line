import type { Template } from "@pdfme/common";
import { A4_BASE_PDF, box, hLine, labeledField, staticText, textField } from "./build";

// The checked-in seed A4 layout for the "Advance Deposit Receipt" (plan §5b) -
// the patient's proof of the advance handed over at admission. Fully designable
// in /admin/receipts like every other type: each DATA field here binds a key
// from the `advance` catalog (lib/printing/fields.ts), with the field TYPE
// matching that key's kind exactly (labeled → multiVariableText with the
// caption baked into its text; plain → bare text whose whole content is the
// value). advanceReceiptToInputs supplies the matching wire shapes.
//
// Layout: centred letterhead, a title band, a boxed patient block, then one
// emphasised box carrying the advance amount large (₹ included in the value -
// formatRupees), the payment mode, and the amount in words. Signature line and
// footer note close it out. A4 usable area x 10..200.
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
      staticText("ADVANCE DEPOSIT RECEIPT", { x: 10, y: 41.5, w: 190, h: 6 }, {
        fontSize: 12,
        alignment: "center",
        characterSpacing: 1,
        fontColor: "#0f172a",
      }),

      // ── Meta row ────────────────────────────────────────────────────────
      labeledField("receiptRef", { x: 10, y: 50, w: 90, h: 6 }, {
        fontSize: 10,
        fontColor: "#0f172a",
      }),
      labeledField("admittedDateText", { x: 130, y: 50, w: 70, h: 6 }, {
        fontSize: 10,
        alignment: "right",
        fontColor: "#0f172a",
      }),

      // ── Patient block (boxed) ───────────────────────────────────────────
      box({ x: 10, y: 58, w: 190, h: 22 }),
      labeledField("patientName", { x: 14, y: 61.5, w: 92, h: 6 }, {
        fontSize: 10,
        fontColor: "#0f172a",
      }),
      labeledField("patientCode", { x: 110, y: 61.5, w: 86, h: 6 }, {
        fontSize: 10,
        fontColor: "#0f172a",
      }),
      labeledField("patientAgeGender", { x: 14, y: 70, w: 92, h: 6 }, {
        fontSize: 10,
        fontColor: "#0f172a",
      }),
      labeledField("patientPhone", { x: 110, y: 70, w: 86, h: 6 }, {
        fontSize: 10,
        fontColor: "#0f172a",
      }),

      // ── Advance received (boxed, emphasised) ────────────────────────────
      box({ x: 10, y: 86, w: 190, h: 34 }, { borderColor: "#0f172a", borderWidth: 0.4 }),
      staticText("ADVANCE RECEIVED", { x: 14, y: 90, w: 120, h: 5 }, {
        fontSize: 9,
        characterSpacing: 1,
        fontColor: "#475569",
      }),
      textField("advanceAmountText", "₹5,000.00", { x: 14, y: 96, w: 116, h: 12 }, {
        fontSize: 22,
        fontColor: "#0f172a",
      }),
      labeledField("paymentModeLabel", { x: 134, y: 99, w: 62, h: 6 }, {
        fontSize: 10.5,
        alignment: "right",
        fontColor: "#0f172a",
      }),
      textField("advanceInWords", "Five Thousand Rupees Only", { x: 14, y: 111, w: 182, h: 6 }, {
        fontSize: 9,
        fontColor: "#334155",
      }),

      // ── Signature ───────────────────────────────────────────────────────
      hLine(130, 140, 66, 0.3, "#94a3b8"),
      staticText("Received by (signature)", { x: 130, y: 142, w: 66, h: 5 }, {
        fontSize: 8.5,
        alignment: "center",
        fontColor: "#475569",
      }),

      // ── Footer ──────────────────────────────────────────────────────────
      hLine(10, 158, 190, 0.4, "#94a3b8"),
      textField("footerNote", "This advance will be adjusted against the final bill at discharge.", { x: 10, y: 161, w: 190, h: 6 }, {
        fontSize: 9,
        alignment: "center",
        fontColor: "#475569",
      }),
    ],
  ],
} as unknown as Template;
