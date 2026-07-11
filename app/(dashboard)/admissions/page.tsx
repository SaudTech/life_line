import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/dal";
import { listAdmissions } from "@/lib/admissions/repository";
import { AdmissionsManager } from "./admissions-manager";

export const metadata: Metadata = {
  title: "In-patients - Life Line Hospital",
};

// In-patient census (plan §5c). Only the OP+IP desk and admin may reach this -
// server-gated (op_desk is blocked even if the nav leaked, dev-rules §8). Preloads
// the currently-admitted list and recent discharges; the client switches between
// them and links into each admission's detail.
export default async function AdmissionsPage() {
  await requireRole(["admin", "op_ip_desk"]);
  const [admitted, discharged] = await Promise.all([
    listAdmissions("admitted"),
    listAdmissions("discharged"),
  ]);
  return <AdmissionsManager admitted={admitted} discharged={discharged} />;
}
