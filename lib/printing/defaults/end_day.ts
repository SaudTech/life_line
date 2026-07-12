import type { Template } from "@pdfme/common";
import { LETTERHEAD_TOP_MM, box, hLine, labeledField, makeBasePdf, staticText, tableField, textField } from "./build";

// Seed template for the `end_day` report type (plan §4a) - a working default so
// the reports page can print a day-close sheet through the same pipeline as
// bills, before any admin opens the builder. Letterhead-safe (plan §3): reserved
// top band (basePdf.padding[0] = 40mm), NO hard-coded hospital header. Binds only
// End-Day catalog keys (lib/printing/fields.ts); the numbers come pre-formatted
// from the tested report shaper (lib/reports/summary.ts) - this layout does zero
// math. "Reset to default" restores exactly this JSON.
//
// A4 usable area is x 10..200 (190mm wide). Layout, top to bottom (below band):
//   hospital heading → "DAILY REPORT" title → date / generated meta → staff →
//   totals band (grand total + bills) → per-mode totals → by-type table →
//   by-mode table → discounts / voids / advances → activity table.
export const END_DAY_DEFAULT_TEMPLATE = {
  basePdf: makeBasePdf({ width: 210, height: 297, topMm: LETTERHEAD_TOP_MM }),
  schemas: [
    [
      // ── Heading (optional printed name for plain paper) ──────────────────
      textField("hospitalName", "Life Line", { x: 10, y: 42, w: 190, h: 9 }, {
        fontSize: 20,
        alignment: "center",
        fontColor: "#0f172a",
      }),
      staticText("DAILY REPORT", { x: 10, y: 53, w: 190, h: 6 }, {
        fontSize: 12,
        alignment: "center",
        characterSpacing: 1,
        fontColor: "#0f172a",
      }),
      hLine(10, 61, 190, 0.6, "#0f172a"),

      // ── Report meta ──────────────────────────────────────────────────────
      labeledField("reportDateText", { x: 10, y: 64, w: 120, h: 6 }),
      labeledField("generatedAtText", { x: 132, y: 64, w: 68, h: 6 }),
      labeledField("staffNameRole", { x: 10, y: 71, w: 190, h: 6 }),

      // ── Totals band ──────────────────────────────────────────────────────
      box({ x: 10, y: 80, w: 190, h: 16 }, { borderColor: "#0f172a", borderWidth: 0.4 }),
      labeledField("grandTotalText", { x: 14, y: 83, w: 120, h: 8 }, { fontSize: 15, fontColor: "#0f172a" }),
      labeledField("billsCountText", { x: 138, y: 84, w: 58, h: 6 }),

      // ── Collected by payment mode (headline figures) ─────────────────────
      labeledField("cashTotalText", { x: 10, y: 100, w: 90, h: 6 }),
      labeledField("cardTotalText", { x: 106, y: 100, w: 90, h: 6 }),
      labeledField("upiTotalText", { x: 10, y: 107, w: 90, h: 6 }),
      labeledField("otherTotalText", { x: 106, y: 107, w: 90, h: 6 }),

      // ── By bill type ─────────────────────────────────────────────────────
      staticText("By bill type", { x: 10, y: 117, w: 190, h: 5 }, {
        fontSize: 9,
        fontColor: "#475569",
      }),
      tableField(
        "typeTable",
        ["Bill type", "Count", "Amount"],
        [50, 20, 30],
        [
          ["Consultation", "12", "6,000.00"],
          ["Procedure", "5", "4,450.00"],
          ["In-patient", "1", "2,000.00"],
        ],
        { x: 10, y: 123, w: 190, h: 22 },
      ),

      // ── By payment mode ──────────────────────────────────────────────────
      staticText("By payment mode", { x: 10, y: 149, w: 190, h: 5 }, {
        fontSize: 9,
        fontColor: "#475569",
      }),
      tableField(
        "modeTable",
        ["Payment mode", "Count", "Amount"],
        [50, 20, 30],
        [
          ["Cash", "11", "7,200.00"],
          ["Card", "3", "2,300.00"],
          ["UPI", "4", "2,950.00"],
          ["Other", "0", "0.00"],
        ],
        { x: 10, y: 155, w: 190, h: 26 },
      ),

      // ── Discounts / voids / advances ─────────────────────────────────────
      hLine(10, 185, 190, 0.4, "#94a3b8"),
      labeledField("discountsText", { x: 10, y: 189, w: 62, h: 6 }),
      labeledField("voidsText", { x: 74, y: 189, w: 62, h: 6 }),
      labeledField("advancesText", { x: 138, y: 189, w: 62, h: 6 }),

      // ── Activity ─────────────────────────────────────────────────────────
      staticText("Activity", { x: 10, y: 199, w: 190, h: 5 }, {
        fontSize: 9,
        fontColor: "#475569",
      }),
      tableField(
        "activityTable",
        ["Activity", "Count"],
        [70, 30],
        [
          ["Patients registered", "4"],
          ["Consultations", "12"],
          ["Free revisits", "3"],
        ],
        { x: 10, y: 205, w: 190, h: 22 },
      ),
    ],
  ],
} as unknown as Template;
