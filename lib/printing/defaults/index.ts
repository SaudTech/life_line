import type { Template } from "@pdfme/common";
import type { BillType } from "../fields";
import { CONSULTATION_DEFAULT_TEMPLATE } from "./consultation";
import { PROCEDURE_DEFAULT_TEMPLATE } from "./procedure";
import { IP_DEFAULT_TEMPLATE } from "./ip";
import { ADVANCE_RECEIPT_DEFAULT_TEMPLATE } from "./advance-receipt";
import { END_DAY_DEFAULT_TEMPLATE } from "./end_day";

// The checked-in seed template per shipped bill type (plan §4/§6b). Every type
// ships a working default now - `advance` graduated out of plan §5's "no
// default" state when the owner asked for advance receipts, which flips
// hasPrintableTemplate on and surfaces the print buttons with no other change.
export const DEFAULT_TEMPLATES: Partial<Record<BillType, Template>> = {
  consultation: CONSULTATION_DEFAULT_TEMPLATE,
  procedure: PROCEDURE_DEFAULT_TEMPLATE,
  ip: IP_DEFAULT_TEMPLATE,
  advance: ADVANCE_RECEIPT_DEFAULT_TEMPLATE,
  end_day: END_DAY_DEFAULT_TEMPLATE,
};

export function getDefaultTemplate(type: BillType): Template {
  const template = DEFAULT_TEMPLATES[type];
  if (!template) {
    throw new Error(`No default template for bill type "${type}" yet.`);
  }
  return template;
}
