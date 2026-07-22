import { formatRupees } from "@/lib/money";
import { roleTitle } from "@/lib/nav";
import {
  getActivityCounts,
  getMoneySummary,
  getReportContext,
  getSubjectUser,
} from "@/lib/reports/repository";
import { shapeDailyReport } from "@/lib/reports/summary";
import type { EndDayDocument } from "./bill-document";

// The End-Day render resolver (print-updates plan §4b) - the report-side parallel
// of getBillDocument. It ONLY formats the already server-computed daily summary:
// every number comes from the pure, tested shaper (lib/reports/summary.ts) and is
// merely run through formatPaise here. There is ZERO money math in this file (no
// sums, no balances) - it reads the shaped figures and maps them to the end_day
// field keys + table rows (dev-rules §2/§4).
//
// SUBJECT-SCOPED: the caller passes the signed-in viewer (for the letterhead
// context + location) AND the resolved report subject - a specific staff member's
// id, or `null` for the whole-hospital total. The PDF ROUTE decides the subject
// under the same role rules as the on-screen report (a non-admin is forced to
// themselves; an admin may pick "everyone" or any staff member at their location),
// so the printed sheet matches exactly what is on screen (§4b).

// Human date for the sheet header, e.g. "Saturday, 11 July 2026". Built on a UTC
// instant so no offset nudges the day (the ISO already IS the clinic day) - mirrors
// formatDayLabel in lib/reports/actions.ts.
function formatDayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// When the sheet was produced, in the clinic timezone - mirrors the report action.
function generatedAtLabel(): string {
  return new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export async function getEndDayDocument(
  viewerId: string,
  day: string,
  // The resolved report subject: a specific staff id, or `null` for the whole
  // hospital. The route authorizes this before calling (a non-admin only ever gets
  // their own id here).
  subjectUserId: string | null,
): Promise<EndDayDocument> {
  const ctx = await getReportContext(viewerId);
  if (!ctx) throw new Error("Could not resolve the report context for this user.");

  // The "name · role" header line. For a specific subject, resolve their name+role
  // within the viewer's location (getSubjectUser is location-scoped). For the
  // whole-hospital total there is no single person, so label it as such.
  let staffNameRole: string;
  if (subjectUserId === null) {
    staffNameRole = "All staff · Hospital total";
  } else {
    const subject = await getSubjectUser(subjectUserId, ctx.locationId);
    staffNameRole = subject ? `${subject.name} · ${roleTitle(subject.role)}` : ctx.viewerName;
  }

  // Scope every figure to the subject (null → whole hospital), the same queries the
  // on-screen report uses.
  const [activityCounts, money] = await Promise.all([
    getActivityCounts(subjectUserId, day, day, ctx.locationId),
    getMoneySummary(subjectUserId, day, day, ctx.locationId),
  ]);
  const report = shapeDailyReport(activityCounts, money);

  // Read a mode's collected total from the shaped (already-summed) rows - a lookup,
  // not a sum. byMode is keyed by payment mode; each carries its own totalPaise.
  const modeTotal = (key: string): number =>
    report.byMode.find((l) => l.key === key)?.totalPaise ?? 0;

  return {
    type: "end_day",
    locationId: ctx.locationId,
    hospitalName: ctx.hospitalName,
    reportDateText: formatDayLabel(day),
    staffNameRole,
    generatedAtText: generatedAtLabel(),
    grandTotalText: formatRupees(report.collectedTotalPaise),
    billsCountText: String(report.collectedCount),
    cashTotalText: formatRupees(modeTotal("cash")),
    cardTotalText: formatRupees(modeTotal("card")),
    upiTotalText: formatRupees(modeTotal("upi")),
    otherTotalText: formatRupees(modeTotal("other")),
    discountsText: formatRupees(report.discountOnMyBillsPaise),
    discountsApprovedText: `${formatRupees(report.discountsApproved.totalPaise)} (${report.discountsApproved.count})`,
    voidsText: `${formatRupees(report.voids.totalPaise)} (${report.voids.count})`,
    advancesText: formatRupees(report.advancesTotalPaise),
    advancesCountText: String(report.advancesCount),
    moneyInText: formatRupees(report.moneyInTotalPaise),
    refundsText: `${formatRupees(report.refunds.totalPaise)} (${report.refunds.count})`,
    activityTotalText: String(report.activityTotal),
    modeRows: report.byMode.map((l) => ({
      mode: l.label,
      count: String(l.count),
      amountText: formatRupees(l.totalPaise),
    })),
    typeRows: report.byType.map((l) => ({
      label: l.label,
      count: String(l.count),
      amountText: formatRupees(l.totalPaise),
    })),
    advanceModeRows: report.advancesByMode.map((l) => ({
      mode: l.label,
      count: String(l.count),
      amountText: formatRupees(l.totalPaise),
    })),
    activityRows: report.activity.map((a) => ({
      label: a.label,
      count: String(a.count),
    })),
  };
}
