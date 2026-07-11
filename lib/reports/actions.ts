"use server";

import { requireSession } from "@/lib/auth/dal";
import { roleTitle } from "@/lib/nav";
import { clinicToday } from "@/lib/date-range";
import type { ActionResult } from "@/lib/forms/action-result";
import {
  getActivityCounts,
  getMoneySummary,
  getReportContext,
  getSubjectUser,
} from "./repository";
import { BILL_TYPES, shapeDailyReport, type BillTypeValue, type DailyReport } from "./summary";

// The daily report action (plan §4/§6). Reports on a SUBJECT for a day:
//   - "everyone"  → the whole hospital's totals (all staff) - the admin day-close.
//   - a user id   → that one staff member's own transactions.
//
// SECURITY (server-enforced, §6/§8): who you may report on depends on your role.
//   - A NON-ADMIN is pinned to themselves (session.sub). The `subject` input is
//     ignored for them - they can never see anyone else's numbers (§6).
//   - An ADMIN may pick "everyone" (aggregate, their default) or any specific staff
//     member, but ONLY within their own location - getSubjectUser rejects an id from
//     another branch or a forged id. Admin "seeing all reports" is a stated role
//     power (PROJECT_OVERVIEW §4); it's still an explicit, validated choice, never
//     an unchecked id straight into a query.

// The subject the report is scoped to. "everyone" is the whole hospital; any other
// value is a specific staff member's id.
export type ReportSubject = "everyone" | (string & {});

export interface ReportMeta {
  hospitalName: string;
  generatedByName: string; // the signed-in user who ran the report
  scope: "everyone" | "user";
  subjectUserId: string | null; // the picked user (null for the whole hospital)
  subjectName: string | null; // that user's name (null for the whole hospital)
  subjectRoleTitle: string | null; // that user's role, titled (null for the whole hospital)
  subjectIsSelf: boolean; // the subject is the signed-in user (drives "my" vs "their")
  canChooseSubject: boolean; // admin ⇒ the subject picker is available
  // Capability flags for the SUBJECT's role, so the UI only shows figures that role
  // can actually produce (a report on an OP desk never shows IP or approvals). For
  // the whole-hospital view every capability is on (all roles are in the mix).
  canApprove: boolean; // subject can approve discounts (supervisor / admin)
  canAdmit: boolean; // subject can admit → take advance deposits (op_ip_desk / admin)
  allowedBillTypes: BillTypeValue[]; // the bill types this subject can bill
  dayIso: string; // the clinic day reported on, 'YYYY-MM-DD'
  dayLabel: string; // human-readable, e.g. "Saturday, 11 July 2026"
  generatedAtLabel: string; // when this was generated, in the clinic timezone
}

// The bill types a role can produce. IP (admit/discharge) is limited to the IP
// roles (mirrors IP_ROLES in lib/admissions/actions.ts); consultations + procedures
// are outpatient work every billing role does. A null role means the whole-hospital
// view - every type is in play.
function allowedBillTypesFor(role: string | null): BillTypeValue[] {
  if (role === null || role === "admin" || role === "op_ip_desk") return [...BILL_TYPES];
  // op_desk / supervisor: outpatient only, no in-patient bills.
  return BILL_TYPES.filter((t) => t !== "ip");
}

// Discount approval is a supervisor/admin power (mirrors listDiscountApprovers).
function canApproveFor(role: string | null): boolean {
  return role === null || role === "supervisor" || role === "admin";
}

// Admitting (and thus taking an advance deposit) is limited to the IP roles.
function canAdmitFor(role: string | null): boolean {
  return role === null || role === "admin" || role === "op_ip_desk";
}

export interface DailyReportResult {
  meta: ReportMeta;
  report: DailyReport;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// Format a plain clinic-day ISO string as a human date, with no timezone math (the
// ISO already IS the clinic day). Built on a UTC instant so no offset can nudge it.
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

// Generate a report for a day (default: today, clinic tz) on a subject. The `day` is
// validated to a clinic ISO day and the `subject` is resolved on the SERVER against
// the viewer's role + location; a non-admin's subject is forced to themselves.
export async function generateDailyReportAction(input: {
  day?: string;
  subject?: ReportSubject;
}): Promise<ActionResult<DailyReportResult>> {
  const session = await requireSession();
  const isAdmin = session.role === "admin";

  const day = input.day?.trim() || clinicToday();
  if (!ISO_DAY.test(day)) {
    return { ok: false, formError: "Pick a valid date." };
  }

  const ctx = await getReportContext(session.sub);
  if (!ctx) {
    return { ok: false, formError: "Could not resolve your account. Please sign in again." };
  }

  // Resolve the subject under the role rules above.
  let userId: string | null; // null → the whole hospital
  let subjectName: string | null = null;
  let subjectRoleTitle: string | null = null;
  let subjectUserId: string | null = null;
  let subjectRole: string | null = null; // null → whole hospital (all roles)

  if (!isAdmin) {
    // Non-admins only ever see their own day - the subject input is ignored.
    userId = session.sub;
    subjectUserId = session.sub;
    subjectName = ctx.viewerName;
    subjectRoleTitle = roleTitle(session.role);
    subjectRole = session.role;
  } else {
    const subject: ReportSubject = input.subject ?? "everyone";
    if (subject === "everyone") {
      userId = null; // hospital-wide aggregate
    } else {
      const picked = await getSubjectUser(subject, ctx.locationId);
      if (!picked) {
        return { ok: false, formError: "That staff member is not at your location." };
      }
      userId = picked.id;
      subjectUserId = picked.id;
      subjectName = picked.name;
      subjectRoleTitle = roleTitle(picked.role);
      subjectRole = picked.role;
    }
  }

  const scope = userId === null ? "everyone" : "user";

  const [activityCounts, money] = await Promise.all([
    getActivityCounts(userId, day, day, ctx.locationId),
    getMoneySummary(userId, day, day, ctx.locationId),
  ]);

  const report = shapeDailyReport(activityCounts, money);

  const generatedAtLabel = new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return {
    ok: true,
    data: {
      meta: {
        hospitalName: ctx.hospitalName,
        generatedByName: ctx.viewerName,
        scope,
        subjectUserId,
        subjectName,
        subjectRoleTitle,
        subjectIsSelf: subjectUserId === session.sub,
        canChooseSubject: isAdmin,
        canApprove: canApproveFor(subjectRole),
        canAdmit: canAdmitFor(subjectRole),
        allowedBillTypes: allowedBillTypesFor(subjectRole),
        dayIso: day,
        dayLabel: formatDayLabel(day),
        generatedAtLabel,
      },
      report,
    },
  };
}
