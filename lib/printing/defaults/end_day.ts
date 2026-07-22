import type { Template } from "@pdfme/common";
import { LETTERHEAD_TOP_MM, hLine, labeledField, makeBasePdf, staticText, tableField, textField } from "./build";

// Seed template for the `end_day` report type (plan §4a) - a working default so
// the reports page can print a day-close sheet through the same pipeline as
// bills. Letterhead-safe (plan §3): reserved top band (basePdf.padding[0] = 40mm),
// NO hard-coded hospital header. Binds only End-Day catalog keys
// (lib/printing/fields.ts); the numbers come pre-formatted from the tested report
// shaper (lib/reports/summary.ts) - this layout does zero math.
// "Reset to default" restores exactly this JSON.
//
// THIS IS THE PAPER TWIN of the on-screen sheet (app/(dashboard)/reports/daily-report.tsx).
// Same document, same order, same wording, so an admin can hand either one to the
// same person and it reads the same: masthead (hospital / END OF DAY REPORT / date /
// subject / generated) → COLLECTIONS → BY PAYMENT MODE → ADMISSION DEPOSITS →
// MEMORANDA (incl. the consultation split's doctor/hospital share totals) →
// double-ruled MONEY IN → ACTIVITY. If you change one, change the other.
// (The screen's per-doctor share rows are the one section this fixed flow cannot
// fit - it prints the split's two totals; a custom design can add doctorShareTable.)
//
// Three things it CANNOT mirror, by pdfme's nature - do not file these as bugs:
//   1. No donut. pdfme has no chart primitive; the by-mode table carries the same
//      figures the donut visualises, which is why the screen shows both.
//   2. Sans, not serif. No serif font is registered with generate() (see the PDF
//      route), so the masthead and MONEY IN use the default face.
//   3. Subtotals read "Total collected: ₹28,000.00" rather than sitting column-
//      aligned under Amount. A catalog field of kind "labeled" bakes its label into
//      the field ("<Label>: {key}"), so label and value cannot be split across the
//      page - see labeledField in ./build. They are right-aligned to the money
//      column instead, which keeps the eye running down one edge.
//
// A4 usable area is x 10..200 (190mm wide); content starts below the 40mm band.

// The screen sheet's ink, mirrored from :root in app/globals.css. Keep in step.
const INK = "#191b2a"; // --foreground
const MUTED = "#6d7285"; // --muted-foreground
const RULE = "#e3e5ee"; // --border, for hairline row rules

// A ledger table, not the boxed blue-header default: hairline rules under each row,
// no zebra banding, no outer box, and the Count/Amount columns (indices 1 and 2)
// right-aligned so the digits line up down the page. This is the whole reason the
// sheet reads as a document rather than a data dump.
const LEDGER_TABLE = {
  tableStyles: { borderColor: "", borderWidth: 0 },
  headStyles: {
    alignment: "left" as const,
    verticalAlignment: "middle" as const,
    fontSize: 7,
    lineHeight: 1,
    characterSpacing: 0.5,
    fontColor: MUTED,
    backgroundColor: "",
    borderColor: INK,
    borderWidth: { top: 0, right: 0, bottom: 0.4, left: 0 },
    padding: { top: 0.5, right: 1.5, bottom: 1.2, left: 0 },
  },
  bodyStyles: {
    alignment: "left" as const,
    verticalAlignment: "middle" as const,
    fontSize: 8.5,
    lineHeight: 1,
    characterSpacing: 0,
    fontColor: INK,
    backgroundColor: "",
    borderColor: RULE,
    borderWidth: { top: 0, right: 0, bottom: 0.2, left: 0 },
    padding: { top: 1.6, right: 1.5, bottom: 1.6, left: 0 },
    alternateBackgroundColor: "",
  },
  columnStyles: { alignment: { 1: "right", 2: "right" } },
};

// A section kicker ("COLLECTIONS") - the sheet's small letterspaced rule-line.
function sectionLabel(text: string, y: number) {
  return staticText(text, { x: 10, y, w: 190, h: 4 }, {
    fontSize: 7,
    characterSpacing: 1.2,
    fontColor: MUTED,
  });
}

// A subtotal line, right-aligned to the money column under a rule.
function subtotal(key: string, y: number) {
  return labeledField(key, { x: 80, y, w: 120, h: 5.5 }, {
    fontSize: 10.5,
    alignment: "right",
    fontColor: INK,
  });
}

// The muted count that pairs with a subtotal ("Bills: 2").
function subtotalNote(key: string, y: number) {
  return labeledField(key, { x: 80, y, w: 120, h: 4.5 }, {
    fontSize: 7.5,
    alignment: "right",
    fontColor: MUTED,
  });
}

export const END_DAY_DEFAULT_TEMPLATE = {
  basePdf: makeBasePdf({ width: 210, height: 297, topMm: LETTERHEAD_TOP_MM }),
  schemas: [
    [
      // ── Masthead ─────────────────────────────────────────────────────────
      // Left: who. Right: which day, whose figures, when produced. A printed copy
      // left on a desk must never be ambiguous about its own scope.
      textField("hospitalName", "Life Line", { x: 10, y: 42, w: 92, h: 8 }, {
        fontSize: 18,
        fontColor: INK,
      }),
      staticText("END OF DAY REPORT", { x: 10, y: 50.5, w: 92, h: 4 }, {
        fontSize: 7,
        characterSpacing: 1.8,
        fontColor: MUTED,
      }),
      labeledField("reportDateText", { x: 105, y: 42, w: 95, h: 4.5 }, {
        fontSize: 8,
        alignment: "right",
        fontColor: INK,
      }),
      labeledField("staffNameRole", { x: 105, y: 46.8, w: 95, h: 4.5 }, {
        fontSize: 8,
        alignment: "right",
        fontColor: INK,
      }),
      labeledField("generatedAtText", { x: 105, y: 51.6, w: 95, h: 4.5 }, {
        fontSize: 7.5,
        alignment: "right",
        fontColor: MUTED,
      }),
      hLine(10, 57.5, 190, 0.7, INK),

      // ── Collections ──────────────────────────────────────────────────────
      sectionLabel("COLLECTIONS", 62),
      tableField(
        "typeTable",
        ["Bill type", "Count", "Amount"],
        [60, 18, 22],
        [
          ["Consultation", "12", "₹6,000.00"],
          ["Procedure", "5", "₹4,450.00"],
          ["In-patient", "1", "₹2,000.00"],
        ],
        { x: 10, y: 66.5, w: 190, h: 24 },
        LEDGER_TABLE,
      ),
      hLine(10, 91.5, 190, 0.5, INK),
      subtotal("grandTotalText", 93),
      subtotalNote("billsCountText", 99),

      // ── By payment mode ──────────────────────────────────────────────────
      // No subtotal here: it is the same figure as Total collected above, and a
      // pdfme field name must be unique within a template (it is the input key).
      sectionLabel("BY PAYMENT MODE - COUNT THESE AGAINST THE DRAWER", 106),
      tableField(
        "modeTable",
        ["Payment mode", "Count", "Amount"],
        [60, 18, 22],
        [
          ["Cash", "11", "₹7,200.00"],
          ["Card", "3", "₹2,300.00"],
          ["UPI", "4", "₹2,950.00"],
          ["Other", "0", "₹0.00"],
        ],
        { x: 10, y: 110.5, w: 190, h: 31 },
        LEDGER_TABLE,
      ),

      // ── Admission deposits ───────────────────────────────────────────────
      // Cash taken at admit that never becomes a bill. It is in the drawer, so it
      // is on the sheet - split by mode, for the same reason the bills are.
      sectionLabel("ADMISSION DEPOSITS - HELD AGAINST A FUTURE DISCHARGE BILL", 147),
      tableField(
        "advanceModeTable",
        ["Payment mode", "Count", "Amount"],
        [60, 18, 22],
        [
          ["Cash", "1", "₹5,000.00"],
          ["Card", "0", "₹0.00"],
          ["UPI", "0", "₹0.00"],
          ["Other", "0", "₹0.00"],
        ],
        { x: 10, y: 151.5, w: 190, h: 31 },
        LEDGER_TABLE,
      ),
      hLine(10, 183, 190, 0.5, INK),
      subtotal("advancesText", 184.5),
      subtotalNote("advancesCountText", 190.5),

      // ── Memoranda ────────────────────────────────────────────────────────
      // Figures that must NOT be added or subtracted again - they are already inside
      // the numbers above (a discount is deducted before the bill total; a void was
      // never money). Refunds are NOT here: cash actually left the drawer, so it is a
      // deduction in the money-in working below, not a footnote.
      sectionLabel("MEMORANDA - ALREADY REFLECTED IN THE TOTALS ABOVE", 198),
      labeledField("discountsText", { x: 10, y: 203, w: 92, h: 4.5 }, { fontSize: 8.5, fontColor: INK }),
      labeledField("discountsApprovedText", { x: 108, y: 203, w: 92, h: 4.5 }, { fontSize: 8.5, fontColor: INK }),
      labeledField("voidsText", { x: 10, y: 209, w: 92, h: 4.5 }, { fontSize: 8.5, fontColor: INK }),
      // The consultation split's two totals (the on-screen sheet's "Consultation
      // split" section). Memoranda is the right home: the doctors' cut is still
      // inside the collected total and inside the drawer - it must not be
      // subtracted from Money in. The screen's per-doctor rows have no room in
      // this fixed flow; the `doctorShareTable` catalog field exists for a custom
      // design that wants them.
      labeledField("doctorShareText", { x: 108, y: 209, w: 92, h: 4.5 }, { fontSize: 8.5, fontColor: INK }),
      labeledField("hospitalShareText", { x: 10, y: 215, w: 88, h: 4.5 }, { fontSize: 8.5, fontColor: INK }),

      // ── Money in ─────────────────────────────────────────────────────────
      // The one number that has to match the drawer at close, shown as its WORKING:
      // what was taken for bills (Total collected, above), what was taken as deposits
      // (Total deposits held, above), less what was handed back on this line. A reader
      // counting cash can follow the arithmetic instead of reconstructing it.
      labeledField("refundsText", { x: 100, y: 216, w: 100, h: 4.5 }, {
        fontSize: 8.5,
        alignment: "right",
        fontColor: INK,
      }),
      // Two rules stacked = the ledger's double rule, which marks a figure nothing
      // follows (pdfme has no double-border style, so it is drawn as two lines).
      hLine(10, 222, 190, 0.7, INK),
      hLine(10, 223.4, 190, 0.35, INK),
      staticText("MONEY IN", { x: 10, y: 225.5, w: 80, h: 5.5 }, {
        fontSize: 10,
        characterSpacing: 1.4,
        fontColor: INK,
      }),
      staticText(
        "Total collected plus deposits held, less refunds. Reconcile the drawer against this.",
        { x: 10, y: 231, w: 88, h: 6 },
        { fontSize: 6.5, fontColor: MUTED },
      ),
      labeledField("moneyInText", { x: 100, y: 225, w: 100, h: 9 }, {
        fontSize: 16,
        alignment: "right",
        fontColor: INK,
      }),

      // ── Activity ─────────────────────────────────────────────────────────
      sectionLabel("ACTIVITY", 242),
      tableField(
        "activityTable",
        ["Activity", "Count"],
        [80, 20],
        [
          ["Patient registered", "4"],
          ["Consultation started", "12"],
          ["Free revisit", "3"],
        ],
        { x: 10, y: 246.5, w: 190, h: 24 },
        {
          ...LEDGER_TABLE,
          // Two columns here, so only index 1 is money-adjacent.
          columnStyles: { alignment: { 1: "right" } },
        },
      ),
      hLine(10, 271.5, 190, 0.5, INK),
      subtotal("activityTotalText", 273),
    ],
  ],
} as unknown as Template;
