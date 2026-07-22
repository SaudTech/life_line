import { NextResponse, type NextRequest } from "next/server";
import { generate } from "@pdfme/generator";
import { requireSession } from "@/lib/auth/dal";
import { getUserLocationId } from "@/lib/users/repository";
import { getSubjectUser } from "@/lib/reports/repository";
import { clinicToday } from "@/lib/date-range";
import { getEndDayDocument } from "@/lib/printing/end-day-document";
import { getActiveTemplate } from "@/lib/printing/repository";
import { billDocumentToInputs } from "@/lib/printing/fields";
import { loadPdfFonts, withRenderableFonts } from "@/lib/printing/fonts-loader";
import { PDF_PLUGINS } from "@/lib/printing/pdf-plugins";

// Turns the day-close being viewed into an A4 PDF through the active `end_day`
// template (print-updates plan §4c) - a pure READ, never a mutation. Mirrors the
// bill PDF route's conventions (Node runtime, no-store headers). The SUBJECT is
// resolved server-side under the SAME role rules as the on-screen report: a
// non-admin is forced to their own day (any ?subject is ignored); an admin may
// print "everyone" (the whole-hospital total) or a specific staff member at their
// own location. All money math stays in the tested reports shaper - this route only
// authorizes, formats + renders. Node runtime because pdfme's font embedding + `pg`
// both need Node, not edge.
export const runtime = "nodejs";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const isAdmin = session.role === "admin";

  const locationId = await getUserLocationId(session.sub);
  if (!locationId) {
    return new NextResponse("Could not resolve your location.", { status: 409 });
  }

  // ?day=YYYY-MM-DD (the clinic day being viewed); anything invalid falls back to
  // today, never a crash.
  const dayParam = req.nextUrl.searchParams.get("day");
  const day = dayParam && ISO_DAY.test(dayParam) ? dayParam : clinicToday();

  // ?subject = "everyone" | a staff id. Resolved to a subjectUserId (null = whole
  // hospital) under the report's role rules - mirrors generateDailyReportAction so
  // the printed sheet matches the screen. A non-admin is pinned to themselves; an
  // admin's picked staff member must be at their own location (else 404).
  const subjectParam = req.nextUrl.searchParams.get("subject");
  let subjectUserId: string | null;
  if (!isAdmin) {
    subjectUserId = session.sub;
  } else if (!subjectParam || subjectParam === "everyone") {
    subjectUserId = null;
  } else {
    const picked = await getSubjectUser(subjectParam, locationId);
    if (!picked) {
      return new NextResponse("That staff member is not at your location.", { status: 404 });
    }
    subjectUserId = picked.id;
  }

  let doc;
  try {
    doc = await getEndDayDocument(session.sub, day, subjectUserId);
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

  // The receipt font catalog, same as the bill routes - see lib/printing/fonts.ts.
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
      "Content-Disposition": `inline; filename="end-day-${day}.pdf"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
