import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/dal";
import { listConsultations } from "@/lib/consultations/repository";
import { clinicToday, presetRange } from "@/lib/date-range";
import { ConsultationsList } from "./consultations-list";

export const metadata: Metadata = {
  title: "Consultations - Life Line Hospital",
};

// All consultations (admin + OP+IN desk). Gated here on the server. Preloads
// today's consultations - mirrors the client's default filter (today) so the
// first paint already matches what the debounced client re-fetch will show.
export default async function ConsultationsHistoryPage() {
  await requireRole(["admin", "op_ip_desk"]);
  const today = presetRange("today", clinicToday());
  const initial = await listConsultations({ dateFrom: today.dateFrom, dateTo: today.dateTo });
  return <ConsultationsList initial={initial} />;
}
