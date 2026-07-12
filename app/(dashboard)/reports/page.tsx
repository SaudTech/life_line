import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/dal";
import { clinicToday } from "@/lib/date-range";
import { generateDailyReportAction } from "@/lib/reports/actions";
import {
  getReportContext,
  listReportableStaff,
  type ReportableStaff,
} from "@/lib/reports/repository";
import { getUserLocationId } from "@/lib/users/repository";
import { hasPrintableTemplate } from "@/lib/printing/repository";
import { DailyReportView } from "./daily-report";

export const metadata: Metadata = {
  title: "Reports - Life Line Hospital",
};

// The daily report (plan §5). A non-admin sees ONLY their own day; an admin defaults
// to the hospital-wide totals and can pick any staff member (scope is server-enforced,
// §6/§8). The server preloads today's report so the first paint already has data, and
// (for an admin) the staff list that fills the subject picker.
export default async function ReportsPage() {
  const session = await requireSession();
  const today = clinicToday();

  const [initial, staff, locationId] = await Promise.all([
    generateDailyReportAction({ day: today }),
    loadStaffForAdmin(session.role, session.sub),
    getUserLocationId(session.sub),
  ]);

  if (!initial.ok || !initial.data) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center text-sm text-muted-foreground">
        Could not load your report. Please refresh.
      </div>
    );
  }

  // Server-resolved: is there an End-Day design a print can use for this location?
  // Gates the Print button (print-updates plan §1c/§4c). The on-screen report always
  // renders for reading; only the printed A4 sheet depends on a template existing.
  const printable = locationId ? await hasPrintableTemplate("end_day", locationId) : false;

  return (
    <DailyReportView initial={initial.data} todayIso={today} staff={staff} printable={printable} />
  );
}

// The subject picker is admin-only, so only fetch the staff list for an admin. Any
// other role gets an empty list (and no picker) - they can't report on anyone else.
async function loadStaffForAdmin(role: string, viewerId: string): Promise<ReportableStaff[]> {
  if (role !== "admin") return [];
  const ctx = await getReportContext(viewerId);
  if (!ctx) return [];
  return listReportableStaff(ctx.locationId);
}
