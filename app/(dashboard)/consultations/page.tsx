import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/dal";
import { listActiveDoctors } from "@/lib/doctors/repository";
import { getBillForReissue, type ReissueSource } from "@/lib/billing/repository";
import { ConsultationFlow } from "./consultation-flow";

export const metadata: Metadata = {
  title: "New consultation - Life Line Hospital",
};

// Outpatient consultation counter. Available to admins and the OP+IN desk only -
// gated here on the server (the group layout only checks for any session, §9). The
// active doctors are loaded once for the picker; the flow itself runs through
// server actions (patient lookup, start consultation) which re-gate the same roles.
//
// `?replaces=<billId>` opens the flow to RE-ISSUE a voided consultation bill
// (plan §Part B): the source is looked up and pre-fills the patient + doctor;
// finalizing links the correction to the voided original. An invalid/stale id
// (not void, already replaced, wrong type) just opens a normal, empty flow.
export default async function ConsultationsPage({
  searchParams,
}: {
  searchParams: Promise<{ replaces?: string }>;
}) {
  await requireRole(["admin", "op_ip_desk"]);
  const { replaces } = await searchParams;
  const doctors = await listActiveDoctors();
  let reissue: ReissueSource | null = null;
  if (replaces) {
    const src = await getBillForReissue(replaces);
    if (src && src.type === "consultation") reissue = src;
  }
  return <ConsultationFlow doctors={doctors} reissue={reissue} />;
}
