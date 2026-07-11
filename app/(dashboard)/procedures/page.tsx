import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { listActiveServices } from "@/lib/services/repository";
import { getBillForReissue, type ReissueSource } from "@/lib/billing/repository";
import { ProcedureFlow } from "./procedure-flow";

export const metadata: Metadata = {
  title: "Procedures - Life Line Hospital",
};

// OPD procedures counter: bill service lines (Injection, IV, ...) against a
// patient's active consultation - no new consultation fee (plan §Part2). Gated
// on the PERMISSION, not the role (plan §4A): admin or any user granted
// service_lines.modify can reach this, even from a desk role that otherwise
// couldn't. The active catalog is loaded once for the picker; the flow itself
// runs through server actions which re-gate the same permission.
//
// `?replaces=<billId>` opens the flow to RE-ISSUE a voided procedure bill (plan
// §Part B): the source pre-fills the patient (+ its consultation) and its
// service lines; finalizing links the correction to the voided original. An
// invalid/stale id just opens a normal, empty flow.
export default async function ProceduresPage({
  searchParams,
}: {
  searchParams: Promise<{ replaces?: string }>;
}) {
  await requirePermission("service_lines.modify");
  const { replaces } = await searchParams;
  const services = await listActiveServices();
  let reissue: ReissueSource | null = null;
  if (replaces) {
    const src = await getBillForReissue(replaces);
    if (src && src.type === "procedure") reissue = src;
  }
  return <ProcedureFlow services={services} reissue={reissue} />;
}
