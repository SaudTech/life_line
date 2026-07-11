import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/dal";
import { recentPatients } from "@/lib/patients/repository";
import { PatientsManager } from "./patients-manager";

export const metadata: Metadata = {
  title: "Patients - Life Line Hospital",
};

// Admin-only patients master list. The (dashboard) layout gates the group, but
// requireAdmin() here is the page's own server check (hiding UI ≠ security, §9).
//
// The patients table grows large over time, so the screen is search-driven (by
// phone or name). We do NOT preload everything - only the 10 most recent patients
// as a useful default view; the client manager queries searchPatientsAction on
// demand once the operator types.
export default async function PatientsPage() {
  await requireAdmin();
  const recent = await recentPatients(10);
  return <PatientsManager recent={recent} />;
}
