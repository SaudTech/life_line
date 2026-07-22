import { writeFileSync } from "node:fs";
import { generate } from "@pdfme/generator";
import { describe, expect, it } from "vitest";

import { billDocumentToInputs, sampleBillDocument } from "../fields";
import { PDF_PLUGINS } from "../pdf-plugins";
import { END_DAY_DEFAULT_TEMPLATE } from "./end_day";

// The seed End-Day template is JSON that only pdfme can validate - a wrong field
// kind, a stray style key or a table whose columnStyles are malformed all typecheck
// fine and then blow up (or silently mis-render) at the printer, on the one screen
// where a hospital counts its money. So render it here, for real, through the same
// generate() the PDF route uses, with the same catalog inputs.

const PREVIEW_PATH = process.env.END_DAY_PREVIEW_PATH;

describe("END_DAY_DEFAULT_TEMPLATE", () => {
  it("renders a PDF from the end_day sample document", async () => {
    const inputs = billDocumentToInputs(sampleBillDocument("end_day"));

    const pdf = await generate({
      template: END_DAY_DEFAULT_TEMPLATE,
      inputs: [inputs],
      plugins: PDF_PLUGINS,
    });

    // %PDF- header + a plausible size: proof it rendered rather than returning an
    // empty buffer.
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);

    // Opt-in escape hatch for eyeballing the layout while designing it:
    //   END_DAY_PREVIEW_PATH=/tmp/x.pdf npx vitest run end_day
    if (PREVIEW_PATH) writeFileSync(PREVIEW_PATH, Buffer.from(pdf));
  });

  it("binds only keys the end_day catalog knows", () => {
    const known = new Set(Object.keys(billDocumentToInputs(sampleBillDocument("end_day"))));
    // Static labels and rules are readOnly decorations with no catalog key; every
    // OTHER field must resolve to a real input, or it prints blank on paper.
    const bound = END_DAY_DEFAULT_TEMPLATE.schemas[0]
      .filter((s) => !(s as { readOnly?: boolean }).readOnly)
      .map((s) => s.name);

    expect(bound.length).toBeGreaterThan(0);
    for (const name of bound) expect(known).toContain(name);
  });

  it("has no duplicate field names", () => {
    // A pdfme field name IS its input key: two fields sharing one name means the
    // second silently wins and one of them renders the wrong value.
    const names = END_DAY_DEFAULT_TEMPLATE.schemas[0].map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
