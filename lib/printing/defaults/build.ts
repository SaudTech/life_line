// Shared helpers for the checked-in seed pdfme templates (plan §4). Field
// defaults are the exact values pdfme's own `text`/`table` plugins fall back to
// (@pdfme/schemas' propPanel.defaultSchema for each), inlined here so this file
// has no runtime dependency on @pdfme/schemas - it only needs to produce plain
// JSON matching the `Template` shape from @pdfme/common.

import { labelFor } from "../fields";

// The reserved top band (mm) the on-letterhead seed templates leave blank, so
// our content starts BELOW the paper's pre-printed colour header (plan §3). The
// admin tunes this per design via the "Reserved letterhead height" control; this
// is only the sensible default the seeds ship with.
export const LETTERHEAD_TOP_MM = 40;

// One place that turns a page size + top offset into a pdfme `basePdf` (plan
// §2/§3): `width`/`height` are the paper size in mm; `topMm` becomes padding[0]
// (the reserved letterhead band). Side/bottom margins stay a fixed 10mm - only
// the top band is design-specific. Presets below are just common calls of this.
export function makeBasePdf({
  width,
  height,
  topMm = 10,
}: {
  width: number;
  height: number;
  topMm?: number;
}): { width: number; height: number; padding: [number, number, number, number] } {
  return { width, height, padding: [topMm, 10, 10, 10] };
}

export const A4_BASE_PDF = { width: 210, height: 297, padding: [10, 10, 10, 10] as [number, number, number, number] };

// Named quick-pick presets for the designer's Paper size control (plan §2).
// Half-A4 is A4 cut across the middle (a common half-sheet receipt); A5 is the
// portrait half. Each carries the reserved letterhead band by default.
export const HALF_A4_BASE_PDF = makeBasePdf({ width: 210, height: 148.5, topMm: LETTERHEAD_TOP_MM });
export const A5_BASE_PDF = makeBasePdf({ width: 148, height: 210, topMm: LETTERHEAD_TOP_MM });

const TEXT_DEFAULTS = {
  type: "text" as const,
  rotate: 0,
  alignment: "left" as "left" | "center" | "right",
  verticalAlignment: "top" as const,
  fontSize: 10,
  textFormat: "plain" as const,
  overflow: "visible" as const,
  fontVariantFallback: "synthetic" as const,
  lineHeight: 1,
  characterSpacing: 0,
  fontColor: "#000000",
  backgroundColor: "",
  borderColor: "#000000",
  borderWidth: { top: 0, right: 0, bottom: 0, left: 0 },
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  opacity: 1,
  strikethrough: false,
  underline: false,
};

// A single text field bound to a receipt field-catalog key. `content` is the
// sample text shown in the Designer canvas before real data is generated.
export function textField(
  key: string,
  content: string,
  position: { x: number; y: number; w: number; h: number },
  overrides: Partial<typeof TEXT_DEFAULTS> = {},
) {
  return {
    ...TEXT_DEFAULTS,
    ...overrides,
    name: key,
    content,
    position: { x: position.x, y: position.y },
    width: position.w,
    height: position.h,
  };
}

// A labeled field bound to a receipt field-catalog key: pdfme's
// `multiVariableText` type, with the static label baked into `text` as
// "<Label>: {key}". A plain `text` field can't do this - its whole `content`
// is REPLACED by the input value at generate time, so a hand-typed
// "Bill No: 1042" placeholder loses "Bill No:" the instant a real bill number
// is substituted. The matching input value must be
// JSON.stringify({ [key]: value }) (lib/printing/fields.ts's billDocumentToInputs
// handles this - it must never disagree with the field kind used here).
export function labeledField(
  key: string,
  position: { x: number; y: number; w: number; h: number },
  overrides: Partial<typeof TEXT_DEFAULTS> = {},
) {
  return {
    ...TEXT_DEFAULTS,
    ...overrides,
    type: "multiVariableText" as const,
    name: key,
    text: `${labelFor(key)}: {${key}}`,
    content: "{}",
    variables: [],
    readOnly: false,
    position: { x: position.x, y: position.y },
    width: position.w,
    height: position.h,
  };
}

// A STATIC text label (a title, a "Signature" caption) - not bound to any
// data. `readOnly: true` makes pdfme render this literal `content` at generate
// time instead of substituting an input, so it needs no field-catalog key
// (and the save validator exempts readOnly text - lib/printing/actions.ts).
export function staticText(
  content: string,
  position: { x: number; y: number; w: number; h: number },
  overrides: Partial<typeof TEXT_DEFAULTS> = {},
) {
  return {
    ...TEXT_DEFAULTS,
    ...overrides,
    type: "text" as const,
    name: `label-${position.x}-${position.y}`,
    content,
    readOnly: true,
    position: { x: position.x, y: position.y },
    width: position.w,
    height: position.h,
  };
}

const TABLE_DEFAULTS = {
  type: "table" as const,
  showHead: true,
  // repeatHead MUST be true for correct pagination: pdfme only runs its
  // keep-whole-rows-together page-break logic (which pushes a row that doesn't fit
  // to the next page, rather than slicing it) when repeatHead is on and the basePdf
  // is a blank page (getDynamicHeightsForTable in @pdfme/schemas). With it off, a
  // table that overflows a page gets rows cut in half across the boundary. It also
  // repeats the header on each continuation page, which is what you want anyway.
  repeatHead: true,
  tableStyles: { borderColor: "#000000", borderWidth: 0.3 },
  headStyles: {
    alignment: "left" as const,
    verticalAlignment: "middle" as const,
    fontSize: 10,
    lineHeight: 1,
    characterSpacing: 0,
    fontColor: "#ffffff",
    backgroundColor: "#2980ba",
    borderColor: "",
    borderWidth: { top: 0, right: 0, bottom: 0, left: 0 },
    padding: { top: 4, right: 4, bottom: 4, left: 4 },
  },
  bodyStyles: {
    alignment: "left" as const,
    verticalAlignment: "middle" as const,
    fontSize: 10,
    lineHeight: 1,
    characterSpacing: 0,
    fontColor: "#000000",
    backgroundColor: "",
    borderColor: "#888888",
    borderWidth: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
    padding: { top: 4, right: 4, bottom: 4, left: 4 },
    alternateBackgroundColor: "#f5f5f5",
  },
  columnStyles: {},
};

// A horizontal rule (pdfme `line` plugin). `thickness` is the line's HEIGHT in
// mm. Decorative - not a data field, so its name is a plain non-catalog id
// (shape fields are exempt from save validation, lib/printing/actions.ts).
// The name is derived from position so it's unique within a template without
// any mutable counter state.
export function hLine(
  x: number,
  y: number,
  w: number,
  thickness = 0.4,
  color = "#333333",
) {
  return {
    name: `rule-${x}-${y}`,
    type: "line" as const,
    position: { x, y },
    width: w,
    height: thickness,
    rotate: 0,
    opacity: 1,
    readOnly: true,
    color,
  };
}

// An outline box (pdfme `rectangle` plugin) to frame a block of fields.
// Decorative; `color: ""` = no fill, transparent interior over the fields.
export function box(
  position: { x: number; y: number; w: number; h: number },
  overrides: { borderColor?: string; borderWidth?: number; radius?: number } = {},
) {
  return {
    name: `box-${position.x}-${position.y}`,
    type: "rectangle" as const,
    position: { x: position.x, y: position.y },
    width: position.w,
    height: position.h,
    rotate: 0,
    opacity: 1,
    readOnly: true,
    borderWidth: overrides.borderWidth ?? 0.3,
    borderColor: overrides.borderColor ?? "#999999",
    color: "",
    radius: overrides.radius ?? 1.5,
  };
}

// A table field bound to a receipt field-catalog key (items / expenses).
// `sampleRows` is the placeholder content shown in the Designer canvas.
export function tableField(
  key: string,
  head: string[],
  headWidthPercentages: number[],
  sampleRows: string[][],
  position: { x: number; y: number; w: number; h: number },
) {
  return {
    ...TABLE_DEFAULTS,
    name: key,
    head,
    headWidthPercentages,
    content: JSON.stringify(sampleRows),
    position: { x: position.x, y: position.y },
    width: position.w,
    height: position.h,
  };
}
