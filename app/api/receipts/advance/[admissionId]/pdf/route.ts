import { NextResponse, type NextRequest } from "next/server";
import { generate } from "@pdfme/generator";
import { loadPdfFonts, withRenderableFonts } from "@/lib/printing/fonts-loader";
import { requireSession } from "@/lib/auth/dal";
import { getAdvanceReceiptDocument } from "@/lib/printing/advance-receipt-repository";
import { advanceReceiptToInputs } from "@/lib/printing/advance-receipt";
import { getActiveTemplate } from "@/lib/printing/repository";
import { PDF_PLUGINS } from "@/lib/printing/pdf-plugins";

// Turns a SAVED admission's advance into an A4 PDF (plan §5b) - a pure READ, never
// a mutation (save-before-print: the admission is saved first, then this prints;
// reprintable, retryable). Prints the ACTIVE `advance` design for the admission's
// own location (designable in /admin/receipts like every other type; the
// checked-in default seeds on first print). Node runtime because pdfme's font
// embedding + `pg` both need Node, not edge. Mirrors the bill PDF route.
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ admissionId: string }> },
) {
  // Carries patient data - never served anonymously.
  await requireSession();

  const { admissionId } = await params;

  let doc;
  try {
    doc = await getAdvanceReceiptDocument(admissionId);
  } catch {
    return new NextResponse("Advance receipt not found.", { status: 404 });
  }

  // The admission's OWN location picks the template, not the viewer's (multi-
  // branch ready, same rule as the bill route). getActiveTemplate seeds the
  // checked-in default on first read; it throws only for a type with no active
  // row AND no default - return 409 (not a broken PDF) so this route stays the
  // authority even if a Print button ever leaks through (print-updates plan §1b).
  let tpl;
  try {
    tpl = await getActiveTemplate("advance", doc.locationId);
  } catch {
    return new NextResponse("No advance receipt design.", { status: 409 });
  }

  const inputs = advanceReceiptToInputs(doc);

  // The receipt font catalog, same as the bill route. Roboto stays the fallback and
  // every catalog font carries ₹ (fonts.test.ts).
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
      "Content-Disposition": `inline; filename="advance-receipt-${doc.reference}.pdf"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
