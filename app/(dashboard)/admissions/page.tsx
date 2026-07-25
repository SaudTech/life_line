import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/dal";
import { listAdmissions } from "@/lib/admissions/repository";
import { AdmissionsManager } from "./admissions-manager";

export const metadata: Metadata = {
  title: "In-patients - Life Line Hospital",
};

// In-patient census (plan §5c). EVERY staff role may open the list (documents
// plan: any desk attaches/views a discharged patient's scans from here), but
// only the OP+IP desk, supervisors, and admin can admit/open the detail -
// op_desk gets a read-only census (the detail page and every IP action stay
// server-gated on IP_ROLES regardless, dev-rules §8). Preloads the
// currently-admitted list and recent discharges; the client switches between
// them and links into each admission's detail.
export default async function AdmissionsPage() {
  const session = await requireRole(["admin", "op_ip_desk", "supervisor", "op_desk"]);
  const [admitted, discharged] = await Promise.all([
    listAdmissions("admitted"),
    listAdmissions("discharged"),
  ]);
  return (
    <AdmissionsManager
      admitted={admitted}
      discharged={discharged}
      canOperate={session.role !== "op_desk"}
      canDeleteDocuments={session.role === "admin"}
    />
  );
}
