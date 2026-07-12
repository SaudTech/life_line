import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/dal";
import { listActiveServices } from "@/lib/services/repository";
import { getBillForReissue, type ReissueSource } from "@/lib/billing/repository";
import { getUserLocationId } from "@/lib/users/repository";
import { hasPrintableTemplate } from "@/lib/printing/repository";
import { ProcedureFlow } from "./procedure-flow";

export const metadata: Metadata = {
  title: "Procedures - Life Line Hospital",
};

// OPD procedures counter: bill service lines (Injection, IV, ...) against a
// patient's active consultation - no new consultation fee. Gated by counter ROLE
// (op_desk, op_ip_desk, supervisor, admin): billing a procedure is a read/use of the service
// catalogue, precisely the counter's job - editing the catalogue stays admin-only
// at /admin/services. The active catalog is loaded once for the picker; the flow
// itself runs through server actions which re-gate the same roles.
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
  const session = await requireRole(["op_desk", "op_ip_desk", "supervisor", "admin"]);
  const { replaces } = await searchParams;
  const services = await listActiveServices();
  let reissue: ReissueSource | null = null;
  if (replaces) {
    const src = await getBillForReissue(replaces);
    if (src && src.type === "procedure") reissue = src;
  }
  // Server-resolved Print gate (print-updates plan §1c) - the client never decides
  // printability.
  const locationId = await getUserLocationId(session.sub);
  const printable = locationId ? await hasPrintableTemplate("procedure", locationId) : false;
  return <ProcedureFlow services={services} reissue={reissue} printable={printable} />;
}
