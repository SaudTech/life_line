import { NextResponse, type NextRequest } from "next/server";
import { generate } from "@pdfme/generator";
import { requireSession } from "@/lib/auth/dal";
import { getAdvanceReceiptDocument } from "@/lib/printing/advance-receipt-repository";
import { advanceReceiptToInputs } from "@/lib/printing/advance-receipt";
import { ADVANCE_RECEIPT_DEFAULT_TEMPLATE } from "@/lib/printing/defaults/advance-receipt";
import { PDF_PLUGINS } from "@/lib/printing/pdf-plugins";

// Turns a SAVED admission's advance into an A4 PDF (plan §5b) - a pure READ, never
// a mutation (save-before-print: the admission is saved first, then this prints;
// reprintable, retryable). Uses the built-in FIXED advance-receipt layout (NOT
// admin-editable in the receipts designer yet). Node runtime because pdfme's font
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

  const inputs = advanceReceiptToInputs(doc);

  // No options.font - pdfme's bundled Roboto already includes the ₹ glyph (same
  // as the bill route).
  const pdf = await generate({
    template: ADVANCE_RECEIPT_DEFAULT_TEMPLATE,
    inputs: [inputs],
    plugins: PDF_PLUGINS,
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
