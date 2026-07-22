import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/dal";
import { listConsultations } from "@/lib/consultations/repository";
import { getUserLocationId } from "@/lib/users/repository";
import { hasPrintableTemplate } from "@/lib/printing/repository";
import { clinicToday } from "@/lib/date-range";
import { ConsultationsList } from "./consultations-list";

export const metadata: Metadata = {
  title: "Consultations - Life Line Hospital",
};

// All consultations (admin + OP+IN desk). Gated here on the server. Preloads
// today's consultations - mirrors the client's default filter (today) so the
// first paint already matches what the debounced client re-fetch will show.
//
// Reprint is supervisor/admin only (op_ip_desk can still view, search, void and
// re-issue - just not print a duplicate copy). Enforced again, authoritatively,
// by the pdf route itself - hiding this button is not security.
export default async function ConsultationsHistoryPage() {
  const session = await requireRole(["admin", "op_ip_desk", "supervisor"]);
  const today = clinicToday();
  const initial = await listConsultations({ dateFrom: today, dateTo: today });
  const locationId = await getUserLocationId(session.sub);
  const canReprint = session.role === "admin" || session.role === "supervisor";
  const printable =
    canReprint && locationId ? await hasPrintableTemplate("consultation", locationId) : false;
  return <ConsultationsList initial={initial} printable={printable} todayIso={today} />;
}
