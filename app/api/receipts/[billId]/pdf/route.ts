import { NextResponse, type NextRequest } from "next/server";
import { generate } from "@pdfme/generator";
import { requireSession } from "@/lib/auth/dal";
import { getBillDocument } from "@/lib/printing/bill-document-repository";
import { getActiveTemplate } from "@/lib/printing/repository";
import { billDocumentToInputs } from "@/lib/printing/fields";
import { PDF_PLUGINS } from "@/lib/printing/pdf-plugins";

// Turns a SAVED bill into an A4 PDF - a pure READ, never a mutation (print
// plan §1: save and print are separate, retryable steps; the printer jamming
// or the operator clicking Print twice can never risk a double bill). Node
// runtime because pdfme's font embedding + `pg` both need Node, not edge.
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ billId: string }> },
) {
  // Receipts carry patient data - never served anonymously (print plan §3.1).
  await requireSession();

  const { billId } = await params;

  let doc;
  try {
    doc = await getBillDocument(billId);
  } catch {
    return new NextResponse("Receipt not found.", { status: 404 });
  }

  // The bill's OWN location picks the template, not the viewer's (multi-branch
  // ready) - a supervisor at branch A reprinting a branch B bill still gets
  // branch B's layout.
  const tpl = await getActiveTemplate(doc.type, doc.locationId);

  // Watermark: read live from the bill's current status, plus the `copy` query
  // flag reprints pass - never stored, never mutates anything (print plan §3.6).
  // A void bill always shows VOID (a duplicate of a void bill is still void);
  // otherwise a reprint shows DUPLICATE; a fresh original shows nothing.
  const isVoid = doc.bill.statusLabel === "VOID";
  const isDuplicate = req.nextUrl.searchParams.get("copy") === "duplicate";
  const watermark = isVoid ? "VOID" : isDuplicate ? "DUPLICATE" : doc.bill.statusLabel;
  const docForPrint = { ...doc, bill: { ...doc.bill, statusLabel: watermark } };

  const inputs = billDocumentToInputs(docForPrint);

  // No `options.font` passed - pdfme's own bundled default (Roboto) already
  // includes the ₹ glyph (verified directly: fontkit reports a real glyph, not
  // .notdef, for U+20B9), so there's nothing to bundle here.
  const pdf = await generate({
    template: tpl.schema_json,
    inputs: [inputs],
    plugins: PDF_PLUGINS,
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="receipt-${doc.bill.number}.pdf"`,
      // Belt-and-braces against a stale reprint after a template edit -
      // components/print-receipt.ts also cache-busts the URL itself, since
      // some browsers' built-in PDF viewers are known to reuse a cached
      // render for a previously-seen URL even with no-store alone.
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
