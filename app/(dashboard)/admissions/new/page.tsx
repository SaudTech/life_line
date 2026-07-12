import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/dal";
import { AdmitFlow } from "./admit-flow";

export const metadata: Metadata = {
  title: "Admit patient - Life Line Hospital",
};

// Admit an in-patient with an advance (plan §5b). Server-gated to the OP+IP desk
// and admin; the flow itself runs through server actions that re-gate the same
// roles.
export default async function AdmitPage() {
  await requireRole(["admin", "op_ip_desk", "supervisor"]);
  return <AdmitFlow />;
}
