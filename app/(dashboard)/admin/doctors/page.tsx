import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/dal";
import { listDoctors } from "@/lib/doctors/repository";
import { DoctorsManager } from "./doctors-manager";

export const metadata: Metadata = {
  title: "Doctors - Life Line Hospital",
};

// Admin-only doctors master list. The (dashboard) layout already gates the group,
// but requireAdmin() here is the page's own server check (hiding UI ≠ security,
// §9). Loads every doctor once - active and inactive - and hands them to the
// client manager, which edits and toggles status from there.
export default async function DoctorsPage() {
  await requireAdmin();
  const doctors = await listDoctors();

  return <DoctorsManager doctors={doctors} />;
}
