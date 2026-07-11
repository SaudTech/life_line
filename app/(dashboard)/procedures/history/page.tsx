import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { listProcedureBills } from "@/lib/procedures/repository";
import { listUsersWithPermission } from "@/lib/users/repository";
import { listActiveServices } from "@/lib/services/repository";
import { clinicToday, presetRange } from "@/lib/date-range";
import { ProceduresList } from "./procedures-list";

export const metadata: Metadata = {
  title: "Procedures - Life Line Hospital",
};

// All procedure bills (gated on the same PERMISSION as the rest of Part 2, not
// a role - plan §4A). Preloads the most recent bills plus the filter option
// lists: staff who actually HOLD service_lines.modify (so "Created by" only
// ever offers names that could create one, not the whole staff directory) and
// the ACTIVE service catalog (same list "Bill a procedure" picks from - a
// deactivated/trashed service isn't a useful filter option here either). The
// client list filters on demand. Mirrors
// app/(dashboard)/consultations/history/page.tsx.
export default async function ProceduresHistoryPage() {
  await requirePermission("service_lines.modify");
  // Mirror the client's default filter (today) so the first paint already
  // matches what the debounced client re-fetch will show - no flash of the
  // full unfiltered history before it narrows.
  const today = presetRange("today", clinicToday());
  const [initial, creators, services] = await Promise.all([
    listProcedureBills({ dateFrom: today.dateFrom, dateTo: today.dateTo }),
    listUsersWithPermission("service_lines.modify"),
    listActiveServices(),
  ]);
  return <ProceduresList initial={initial} creators={creators} services={services} />;
}
