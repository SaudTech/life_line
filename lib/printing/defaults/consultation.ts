import type { Template } from "@pdfme/common";
import { LETTERHEAD_TOP_MM, box, hLine, labeledField, makeBasePdf, staticText, textField } from "./build";

// Seed template for the `consultation` bill type (plan §4) - a working default
// so printing works day one, before any admin ever opens the builder. An admin
// can edit and save over this; "Reset to default" restores exactly this JSON.
//
// LETTERHEAD-SAFE (plan §3): the paper is pre-printed with the hospital's colour
// header, so this default reserves the top band (basePdf.padding[0] = 40mm) and
// hard-codes NO hospital name/address/phone - content starts below the band. An
// admin can still add a printed header for plain paper via the field palette.
//
// A4 usable area is x 10..200 (190mm wide). Layout, top to bottom (below band):
//   title band → bill meta (no/date/time) → boxed patient block → doctor +
//   validity + reason → rule → payment + boxed totals → amount in words → footer.
export const CONSULTATION_DEFAULT_TEMPLATE = {
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
      staticText("CONSULTATION RECEIPT", { x: 10, y: 41, w: 190, h: 6 }, {
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

      // ── Consultation details ────────────────────────────────────────────
      labeledField("doctorName", { x: 10, y: 87, w: 95, h: 7 }, { fontSize: 11 }),
      labeledField("validUntilText", { x: 105, y: 87, w: 95, h: 7 }, { fontSize: 11 }),
      labeledField("reason", { x: 10, y: 95, w: 190, h: 7 }),

      // ── Payment + totals ────────────────────────────────────────────────
      hLine(10, 106, 190, 0.4, "#94a3b8"),
      labeledField("paymentModeLabel", { x: 10, y: 110, w: 95, h: 6 }),
      labeledField("cashierName", { x: 10, y: 117, w: 95, h: 6 }),

      box({ x: 110, y: 108, w: 90, h: 27 }, { borderColor: "#0f172a", borderWidth: 0.4 }),
      labeledField("subtotalText", { x: 114, y: 111, w: 82, h: 6 }),
      labeledField("discountText", { x: 114, y: 118, w: 82, h: 6 }),
      hLine(114, 125, 82, 0.3, "#94a3b8"),
      labeledField("totalText", { x: 114, y: 127, w: 82, h: 7 }, { fontSize: 13, fontColor: "#0f172a" }),

      labeledField("totalInWords", { x: 10, y: 138, w: 190, h: 6 }, { fontSize: 9, fontColor: "#334155" }),

      // ── Footer ──────────────────────────────────────────────────────────
      hLine(10, 150, 190, 0.4, "#94a3b8"),
      textField("footerNote", "Thank you. Get well soon.", { x: 10, y: 153, w: 190, h: 6 }, {
        fontSize: 9,
        alignment: "center",
        fontColor: "#475569",
      }),
    ],
  ],
} as unknown as Template;
