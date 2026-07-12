import type { Template } from "@pdfme/common";
import type { BillType } from "../fields";
import { CONSULTATION_DEFAULT_TEMPLATE } from "./consultation";
import { PROCEDURE_DEFAULT_TEMPLATE } from "./procedure";
import { IP_DEFAULT_TEMPLATE } from "./ip";
import { END_DAY_DEFAULT_TEMPLATE } from "./end_day";

// The checked-in seed template per shipped bill type (plan §4/§6b). `ip` and
// `end_day` both ship a working default; `advance` deliberately does NOT (plan
// §5), so a print gate on it is always false until an owner asks for one.
export const DEFAULT_TEMPLATES: Partial<Record<BillType, Template>> = {
  consultation: CONSULTATION_DEFAULT_TEMPLATE,
  procedure: PROCEDURE_DEFAULT_TEMPLATE,
  ip: IP_DEFAULT_TEMPLATE,
  end_day: END_DAY_DEFAULT_TEMPLATE,
};

export function getDefaultTemplate(type: BillType): Template {
  const template = DEFAULT_TEMPLATES[type];
  if (!template) {
    throw new Error(`No default template for bill type "${type}" yet.`);
  }
  return template;
}
