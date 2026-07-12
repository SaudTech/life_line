import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/dal";
import { getAdmissionDetail } from "@/lib/admissions/repository";
import { listActiveServices } from "@/lib/services/repository";
import { getUserLocationId } from "@/lib/users/repository";
import { hasPrintableTemplate } from "@/lib/printing/repository";
import { AdmissionDetailView } from "./admission-detail";

export const metadata: Metadata = {
  title: "Admission - Life Line Hospital",
};

// One admission's detail (plan §5c/§6): the running expense tally + discharge for
// an admitted patient, or the final invoice for a discharged one. Server-gated to
// the OP+IP desk and admin. The active service catalog is loaded once for the
// expense picker (catalog-only expenses, server-re-priced on add).
export default async function AdmissionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ admissionId: string }>;
  searchParams: Promise<{ admitted?: string }>;
}) {
  const session = await requireRole(["admin", "op_ip_desk", "supervisor"]);
  const { admissionId } = await params;
  const { admitted } = await searchParams;
  const [detail, services, locationId] = await Promise.all([
    getAdmissionDetail(admissionId),
    listActiveServices(),
    getUserLocationId(session.sub),
  ]);
  if (!detail) notFound();
  // Server-resolved Print gates (print-updates plan §1c): the discharge invoice
  // prints only with an active `ip` design; the advance receipt only with an active
  // `advance` design - none ships (the client doesn't use advance receipts), so its
  // buttons simply disappear.
  const [invoicePrintable, advancePrintable] = locationId
    ? await Promise.all([
        hasPrintableTemplate("ip", locationId),
        hasPrintableTemplate("advance", locationId),
      ])
    : [false, false];
  // ?admitted=1 (set by the admit flow's redirect) shows a one-time "just
  // admitted" banner with the advance-receipt print.
  return (
    <AdmissionDetailView
      detail={detail}
      services={services}
      justAdmitted={admitted === "1"}
      invoicePrintable={invoicePrintable}
      advancePrintable={advancePrintable}
    />
  );
}
