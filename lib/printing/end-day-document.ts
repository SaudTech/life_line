import { formatPaise } from "@/lib/money";
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
// SELF-SCOPED: the caller passes session.sub as `userId` and the clinic day; the
// PDF route forces that (never a userId from the client), exactly like the on-screen
// daily report (§4b). One user's own day, one location - the shaper is location- and
// user-scoped by the same queries the report page uses.

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
  userId: string,
  day: string,
): Promise<EndDayDocument> {
  const ctx = await getReportContext(userId);
  if (!ctx) throw new Error("Could not resolve the report context for this user.");

  // Role for the "name · role" header line, resolved within the viewer's own
  // location (getSubjectUser is location-scoped). Missing → just the name.
  const subject = await getSubjectUser(userId, ctx.locationId);

  const [activityCounts, money] = await Promise.all([
    getActivityCounts(userId, day, day, ctx.locationId),
    getMoneySummary(userId, day, day, ctx.locationId),
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
    staffNameRole: subject ? `${subject.name} · ${roleTitle(subject.role)}` : ctx.viewerName,
    generatedAtText: generatedAtLabel(),
    grandTotalText: formatPaise(report.collectedTotalPaise),
    billsCountText: String(report.collectedCount),
    cashTotalText: formatPaise(modeTotal("cash")),
    cardTotalText: formatPaise(modeTotal("card")),
    upiTotalText: formatPaise(modeTotal("upi")),
    otherTotalText: formatPaise(modeTotal("other")),
    discountsText: formatPaise(report.discountOnMyBillsPaise),
    discountsApprovedText: `${formatPaise(report.discountsApproved.totalPaise)} (${report.discountsApproved.count})`,
    voidsText: `${formatPaise(report.voids.totalPaise)} (${report.voids.count})`,
    advancesText: formatPaise(report.advancesTotalPaise),
    advancesCountText: String(report.advancesCount),
    activityTotalText: String(report.activityTotal),
    modeRows: report.byMode.map((l) => ({
      mode: l.label,
      count: String(l.count),
      amountText: formatPaise(l.totalPaise),
    })),
    typeRows: report.byType.map((l) => ({
      label: l.label,
      count: String(l.count),
      amountText: formatPaise(l.totalPaise),
    })),
    activityRows: report.activity.map((a) => ({
      label: a.label,
      count: String(a.count),
    })),
  };
}
