import type { Template } from "@pdfme/common";
import { LETTERHEAD_TOP_MM, box, hLine, labeledField, makeBasePdf, staticText, tableField, textField } from "./build";

// Seed template for the `ip` (in-patient discharge) bill type (plan §6b) - a
// working default so IP invoices print day one, before any admin edits it.
// Letterhead-safe (plan §3): reserved top band, no hard-coded header. Adds the
// IP-specific rows (admitted/discharged, room charge, advance) and the itemised
// expenses table. "Reset to default" restores exactly this JSON.
export const IP_DEFAULT_TEMPLATE = {
  basePdf: makeBasePdf({ width: 210, height: 297, topMm: LETTERHEAD_TOP_MM }),
  schemas: [
    [
      // Watermark hook (DUPLICATE / VOID), right of the title band, red.
      textField("billStatusLabel", "", { x: 150, y: 41, w: 50, h: 8 }, {
        fontSize: 13,
        alignment: "right",
        fontColor: "#c0392b",
      }),

      // ── Title band ──────────────────────────────────────────────────────
      staticText("DISCHARGE INVOICE", { x: 10, y: 41, w: 190, h: 6 }, {
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

      // ── Stay details ────────────────────────────────────────────────────
      labeledField("admittedText", { x: 10, y: 85, w: 62, h: 6 }),
      labeledField("dischargedText", { x: 74, y: 85, w: 62, h: 6 }),
      labeledField("roomChargeText", { x: 138, y: 85, w: 62, h: 6 }),

      // ── Expenses table ──────────────────────────────────────────────────
      tableField(
        "expenses",
        ["Expense", "Qty", "Amount"],
        [60, 15, 25],
        [
          ["Dressing", "3", "300.00"],
          ["IV Fluids (DNS)", "2", "240.00"],
        ],
        { x: 10, y: 93, w: 190, h: 24 },
      ),

      // ── Payment + totals ────────────────────────────────────────────────
      hLine(10, 122, 190, 0.4, "#94a3b8"),
      labeledField("paymentModeLabel", { x: 10, y: 126, w: 95, h: 6 }),
      labeledField("cashierName", { x: 10, y: 133, w: 95, h: 6 }),

      box({ x: 110, y: 122, w: 90, h: 41 }, { borderColor: "#0f172a", borderWidth: 0.4 }),
      labeledField("subtotalText", { x: 114, y: 125, w: 82, h: 6 }),
      labeledField("discountText", { x: 114, y: 132, w: 82, h: 6 }),
      labeledField("totalText", { x: 114, y: 139, w: 82, h: 6 }),
      labeledField("advanceText", { x: 114, y: 146, w: 82, h: 6 }),
      hLine(114, 153, 82, 0.3, "#94a3b8"),
      labeledField("balanceText", { x: 114, y: 155, w: 82, h: 7 }, { fontSize: 13, fontColor: "#0f172a" }),

      labeledField("totalInWords", { x: 10, y: 167, w: 190, h: 6 }, { fontSize: 9, fontColor: "#334155" }),

      // ── Footer ──────────────────────────────────────────────────────────
      hLine(10, 179, 190, 0.4, "#94a3b8"),
      textField("footerNote", "Thank you. Get well soon.", { x: 10, y: 182, w: 190, h: 6 }, {
        fontSize: 9,
        alignment: "center",
        fontColor: "#475569",
      }),
    ],
  ],
} as unknown as Template;
