import { NextResponse, type NextRequest } from "next/server";
import { generate } from "@pdfme/generator";
import { loadPdfFonts, withRenderableFonts } from "@/lib/printing/fonts-loader";
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
  const session = await requireSession();

  const { billId } = await params;

  let doc;
  try {
    doc = await getBillDocument(billId);
  } catch {
    return new NextResponse("Receipt not found.", { status: 404 });
  }

  // Reprinting a consultation/procedure bill (copy=duplicate) is supervisor/admin
  // only - the desk (op_desk/op_ip_desk) can still fetch the ORIGINAL print (no
  // copy param) right after billing. Hiding the history pages' Print button is
  // not security, so this is the authoritative check; it's scoped to these two
  // bill types only - an IP invoice's "reprint when viewed later" is unaffected.
  const isDuplicateRequest = req.nextUrl.searchParams.get("copy") === "duplicate";
  const isDeskRole = session.role === "op_desk" || session.role === "op_ip_desk";
  if (isDuplicateRequest && isDeskRole && (doc.type === "consultation" || doc.type === "procedure")) {
    return new NextResponse("Reprints are restricted to supervisors and admins.", { status: 403 });
  }

  // The bill's OWN location picks the template, not the viewer's (multi-branch
  // ready) - a supervisor at branch A reprinting a branch B bill still gets
  // branch B's layout. getActiveTemplate throws for a type with no active row AND
  // no default; return 409 (not a broken/empty PDF) so this route stays the
  // authority even if a Print button ever leaks through (print-updates plan §1b).
  let tpl;
  try {
    tpl = await getActiveTemplate(doc.type, doc.locationId);
  } catch {
    return new NextResponse("No receipt design for this document type.", { status: 409 });
  }

  // Watermark: read live from the bill's current status, plus the `copy` query
  // flag reprints pass - never stored, never mutates anything (print plan §3.6).
  // A void bill always shows VOID (a duplicate of a void bill is still void);
  // otherwise a reprint shows DUPLICATE; a fresh original shows nothing.
  const isVoid = doc.bill.statusLabel === "VOID";
  const isDuplicate = req.nextUrl.searchParams.get("copy") === "duplicate";
  const watermark = isVoid ? "VOID" : isDuplicate ? "DUPLICATE" : doc.bill.statusLabel;
  const docForPrint = { ...doc, bill: { ...doc.bill, statusLabel: watermark } };

  const inputs = billDocumentToInputs(docForPrint);

  // The full receipt font catalog (lib/printing/fonts.ts), so a template designed in
  // any offered face renders in that face here. Roboto remains the fallback, and
  // every catalog font is asserted to carry the ₹ glyph (fonts.test.ts) - a face
  // without U+20B9 would print every amount as a .notdef box.
  // withRenderableFonts swaps out any fontName this machine cannot render, so a
  // missing system font degrades to Roboto instead of throwing mid-queue.
  const font = await loadPdfFonts();
  const pdf = await generate({
    template: withRenderableFonts(tpl.schema_json, font),
    inputs: [inputs],
    plugins: PDF_PLUGINS,
    options: { font },
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
