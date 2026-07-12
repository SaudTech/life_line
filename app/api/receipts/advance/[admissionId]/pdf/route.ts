import { NextResponse, type NextRequest } from "next/server";
import { generate } from "@pdfme/generator";
import { requireSession } from "@/lib/auth/dal";
import { getUserLocationId } from "@/lib/users/repository";
import { getAdvanceReceiptDocument } from "@/lib/printing/advance-receipt-repository";
import { advanceReceiptToInputs } from "@/lib/printing/advance-receipt";
import { ADVANCE_RECEIPT_DEFAULT_TEMPLATE } from "@/lib/printing/defaults/advance-receipt";
import { hasPrintableTemplate } from "@/lib/printing/repository";
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
  const session = await requireSession();

  // The advance receipt is now gated like every other print (print-updates plan
  // §1c): it renders ONLY when an active `advance` template exists. None ships by
  // default (the client doesn't use advance receipts), so this returns 409 - and
  // the button that pointed here is gone. If an owner ever designs one, this opens
  // up uniformly with no special-casing.
  const locationId = await getUserLocationId(session.sub);
  if (!locationId || !(await hasPrintableTemplate("advance", locationId))) {
    return new NextResponse("No advance receipt design.", { status: 409 });
  }

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
