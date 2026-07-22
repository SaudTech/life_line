import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/dal";
import { listDoctors } from "@/lib/doctors/repository";
import { listDepartments } from "@/lib/departments/repository";
import { getUserLocationId } from "@/lib/users/repository";
import { DoctorsManager } from "./doctors-manager";

export const metadata: Metadata = {
  title: "Doctors - Life Line Hospital",
};

// Admin-only doctors master list. The (dashboard) layout already gates the group,
// but requireAdmin() here is the page's own server check (hiding UI ≠ security,
// §9). Loads every doctor once - active and inactive - and hands them to the
// client manager, which edits and toggles status from there. Also loads the
// admin's location's departments (migration 0020) so the doctor form's inline
// department picker can add a new one or remove an existing one, all without a
// separate admin page.
export default async function DoctorsPage() {
  const s = await requireAdmin();
  const locationId = await getUserLocationId(s.sub);
  const [doctors, departments] = await Promise.all([
    listDoctors(),
    locationId ? listDepartments(locationId) : Promise.resolve([]),
  ]);

  return <DoctorsManager doctors={doctors} departments={departments} />;
}
