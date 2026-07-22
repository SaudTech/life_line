import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/dal";
import { listProcedureBills } from "@/lib/procedures/repository";
import { listUsersByRole, getUserLocationId } from "@/lib/users/repository";
import { listActiveServices } from "@/lib/services/repository";
import { hasPrintableTemplate } from "@/lib/printing/repository";
import { clinicToday, presetRange } from "@/lib/date-range";
import { ProceduresList } from "./procedures-list";

export const metadata: Metadata = {
  title: "Procedures - Life Line Hospital",
};

// All procedure bills (gated by counter ROLE, same as the rest of the flow:
// op_desk, op_ip_desk, admin). Preloads the most recent bills plus the filter
// option lists: staff who can actually create a procedure bill (the counter
// roles, so "Created by" only ever offers names that could create one, not the
// whole staff directory) and the ACTIVE service catalog (same list "Bill a
// procedure" picks from - a deactivated/trashed service isn't a useful filter
// option here either). The client list filters on demand. Mirrors
// app/(dashboard)/consultations/history/page.tsx.
const PROCEDURE_ROLES = ["op_desk", "op_ip_desk", "supervisor", "admin"] as const;

export default async function ProceduresHistoryPage() {
  const session = await requireRole(PROCEDURE_ROLES);
  // Mirror the client's default filter (today) so the first paint already
  // matches what the debounced client re-fetch will show - no flash of the
  // full unfiltered history before it narrows.
  const today = presetRange("today", clinicToday());
  // The creator picker is location-scoped (§4), so it must wait on locationId rather
  // than run alongside it - one extra round-trip, off the counter's hot path.
  const locationId = await getUserLocationId(session.sub);
  const [initial, creators, services] = await Promise.all([
    listProcedureBills({ dateFrom: today.dateFrom, dateTo: today.dateTo }),
    locationId ? listUsersByRole([...PROCEDURE_ROLES], locationId) : Promise.resolve([]),
    listActiveServices(),
  ]);
  const printable = locationId ? await hasPrintableTemplate("procedure", locationId) : false;
  return (
    <ProceduresList initial={initial} creators={creators} services={services} printable={printable} />
  );
}
