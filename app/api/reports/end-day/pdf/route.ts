import { NextResponse, type NextRequest } from "next/server";
import { generate } from "@pdfme/generator";
import { requireSession } from "@/lib/auth/dal";
import { getUserLocationId } from "@/lib/users/repository";
import { clinicToday } from "@/lib/date-range";
import { getEndDayDocument } from "@/lib/printing/end-day-document";
import { getActiveTemplate } from "@/lib/printing/repository";
import { billDocumentToInputs } from "@/lib/printing/fields";
import { PDF_PLUGINS } from "@/lib/printing/pdf-plugins";

// Turns the signed-in user's own day-close into an A4 PDF through the active
// `end_day` template (print-updates plan §4c) - a pure READ, never a mutation.
// Mirrors the bill PDF route's conventions (Node runtime, no-store headers). The
// report is SELF-SCOPED and server-forced: the subject is always session.sub, never
// a userId from the client (§4b), and all money math stays in the tested reports
// shaper - this route only formats + renders. Node runtime because pdfme's font
// embedding + `pg` both need Node, not edge.
export const runtime = "nodejs";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const session = await requireSession();

  const locationId = await getUserLocationId(session.sub);
  if (!locationId) {
    return new NextResponse("Could not resolve your location.", { status: 409 });
  }

  // ?day=YYYY-MM-DD (the clinic day being viewed); anything invalid falls back to
  // today, never a crash.
  const dayParam = req.nextUrl.searchParams.get("day");
  const day = dayParam && ISO_DAY.test(dayParam) ? dayParam : clinicToday();

  let doc;
  try {
    doc = await getEndDayDocument(session.sub, day);
  } catch {
    return new NextResponse("Could not build the report.", { status: 404 });
  }

  // No valid active/default template ⇒ 409 (not a broken PDF), so the route is the
  // authority even if a Print button ever leaks through (§1b).
  let tpl;
  try {
    tpl = await getActiveTemplate("end_day", locationId);
  } catch {
    return new NextResponse("No end-of-day report design.", { status: 409 });
  }

  const inputs = billDocumentToInputs(doc);

  const pdf = await generate({
    template: tpl.schema_json,
    inputs: [inputs],
    plugins: PDF_PLUGINS,
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="end-day-${day}.pdf"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
