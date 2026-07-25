import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/dal";
import { listDoctors } from "@/lib/doctors/repository";
import { listDepartments } from "@/lib/departments/repository";
import { getUserLocationId } from "@/lib/users/repository";
import { getActiveTemplate, listTemplates } from "@/lib/printing/repository";
import { DoctorsManager, type ConsultationDesign } from "./doctors-manager";

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

  // Guarantee the default consultation design exists before listing, so the
  // form's "Default" option can name it on a fresh install (getActiveTemplate
  // lazily seeds the checked-in default the first time it's read).
  if (locationId) await getActiveTemplate("consultation", locationId);

  const [doctors, departments, templates] = await Promise.all([
    listDoctors(),
    locationId ? listDepartments(locationId) : Promise.resolve([]),
    locationId ? listTemplates(locationId) : Promise.resolve([]),
  ]);

  // Only consultation designs can be assigned to a doctor (migration 0024) -
  // the receipt printed for a consultation is the only one that varies by
  // doctor. The active one is flagged so the form can label it "Default".
  const consultationDesigns: ConsultationDesign[] = templates
    .filter((t) => t.bill_type === "consultation")
    .map((t) => ({ id: t.id, name: t.name, isActive: t.is_active }));

  return (
    <DoctorsManager
      doctors={doctors}
      departments={departments}
      consultationDesigns={consultationDesigns}
    />
  );
}
