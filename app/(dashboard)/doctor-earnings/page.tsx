import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/dal";
import { clinicToday } from "@/lib/date-range";
import { generateDoctorEarningsAction } from "@/lib/doctors/earnings-actions";
import { listEarningsDoctors } from "@/lib/doctors/earnings-repository";
import { getReportContext } from "@/lib/reports/repository";
import { DoctorEarningsView } from "./earnings-view";

export const metadata: Metadata = {
  title: "Doctor Earnings - Life Line Hospital",
};

// Doctor earnings - what a doctor has coming for a window, across the WHOLE counter.
//
// Open to every signed-in staff member (scoped to their own location, enforced in
// the action). The daily report pins a non-admin to their own transactions, which is
// right for a drawer reconciliation and wrong here: the doctor is at the counter
// asking for their money and whoever is on shift has to be able to produce the
// figure. See lib/doctors/earnings-actions.ts for the full reasoning.
//
// The server preloads today so the first paint already has data, plus the doctor list
// that fills the picker.
export default async function DoctorEarningsPage() {
  const session = await requireSession();
  const today = clinicToday();

  const ctx = await getReportContext(session.sub);
  const [initial, doctors] = await Promise.all([
    generateDoctorEarningsAction({ day: today }),
    ctx ? listEarningsDoctors(ctx.locationId) : Promise.resolve([]),
  ]);

  if (!initial.ok || !initial.data) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center text-sm text-muted-foreground">
        Could not load doctor earnings. Please refresh.
      </div>
    );
  }

  return <DoctorEarningsView initial={initial.data} todayIso={today} doctors={doctors} />;
}
