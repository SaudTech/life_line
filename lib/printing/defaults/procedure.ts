import type { Template } from "@pdfme/common";
import { A4_BASE_PDF, box, hLine, labeledField, staticText, tableField, textField } from "./build";

// Seed template for the `procedure` bill type (plan §4). Mirrors
// consultation.ts's letterhead / patient / totals blocks, swapping the
// doctor/validity rows for the line-items table.
export const PROCEDURE_DEFAULT_TEMPLATE = {
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

      textField("billStatusLabel", "", { x: 150, y: 11, w: 50, h: 8 }, {
        fontSize: 13,
        alignment: "right",
        fontColor: "#c0392b",
      }),

      // ── Title band ──────────────────────────────────────────────────────
      staticText("PROCEDURE BILL", { x: 10, y: 41, w: 190, h: 6 }, {
        fontSize: 11,
        alignment: "center",
        characterSpacing: 1,
        fontColor: "#0f172a",
      }),

      // ── Bill meta ───────────────────────────────────────────────────────
      labeledField("billNumber", { x: 10, y: 49, w: 62, h: 6 }),
      labeledField("billDateText", { x: 74, y: 49, w: 62, h: 6 }),
      labeledField("billTimeText", { x: 138, y: 49, w: 62, h: 6 }),

      // ── Patient block (boxed) ───────────────────────────────────────────
      box({ x: 10, y: 57, w: 190, h: 25 }),
      labeledField("patientCode", { x: 14, y: 60, w: 90, h: 6 }),
      labeledField("patientName", { x: 106, y: 60, w: 90, h: 6 }),
      labeledField("patientAgeGender", { x: 14, y: 67, w: 90, h: 6 }),
      labeledField("patientPhone", { x: 106, y: 67, w: 90, h: 6 }),
      labeledField("patientArea", { x: 14, y: 74, w: 182, h: 6 }),

      // ── Line items ──────────────────────────────────────────────────────
      tableField(
        "items",
        ["Description", "Qty", "Unit Price", "Amount"],
        [46, 14, 20, 20],
        [
          ["IV Fluid", "2", "150.00", "300.00"],
          ["Injection", "1", "150.00", "150.00"],
        ],
        { x: 10, y: 87, w: 190, h: 24 },
      ),

      // ── Payment + totals ────────────────────────────────────────────────
      hLine(10, 118, 190, 0.4, "#94a3b8"),
      labeledField("paymentModeLabel", { x: 10, y: 122, w: 95, h: 6 }),
      labeledField("cashierName", { x: 10, y: 129, w: 95, h: 6 }),

      box({ x: 110, y: 120, w: 90, h: 27 }, { borderColor: "#0f172a", borderWidth: 0.4 }),
      labeledField("subtotalText", { x: 114, y: 123, w: 82, h: 6 }),
      labeledField("discountText", { x: 114, y: 130, w: 82, h: 6 }),
      hLine(114, 137, 82, 0.3, "#94a3b8"),
      labeledField("totalText", { x: 114, y: 139, w: 82, h: 7 }, { fontSize: 13, fontColor: "#0f172a" }),

      labeledField("totalInWords", { x: 10, y: 150, w: 190, h: 6 }, { fontSize: 9, fontColor: "#334155" }),

      // ── Footer ──────────────────────────────────────────────────────────
      hLine(10, 162, 190, 0.4, "#94a3b8"),
      textField("footerNote", "Thank you. Get well soon.", { x: 10, y: 165, w: 190, h: 6 }, {
        fontSize: 9,
        alignment: "center",
        fontColor: "#475569",
      }),
    ],
  ],
} as unknown as Template;
