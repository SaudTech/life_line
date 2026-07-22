import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/dal";
import { getUserLocationId } from "@/lib/users/repository";
import { hasPrintableTemplate } from "@/lib/printing/repository";
import { AdmitFlow } from "./admit-flow";

export const metadata: Metadata = {
  title: "Admit patient - Life Line Hospital",
};

// Admit an in-patient with an advance (plan §5b). Server-gated to the OP+IP desk
// and admin; the flow itself runs through server actions that re-gate the same
// roles. Server-resolved Print gate for the advance receipt (print-updates §1c) -
// gates the confirmation screen's print button.
export default async function AdmitPage() {
  const session = await requireRole(["admin", "op_ip_desk", "supervisor"]);
  const locationId = await getUserLocationId(session.sub);
  const advancePrintable = locationId ? await hasPrintableTemplate("advance", locationId) : false;
  return <AdmitFlow advancePrintable={advancePrintable} />;
}
