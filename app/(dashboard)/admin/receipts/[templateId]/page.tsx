import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/dal";
import { getUserLocationId } from "@/lib/users/repository";
import { getTemplateById } from "@/lib/printing/repository";
import { ReceiptEditor } from "../receipt-editor";

export const metadata: Metadata = {
  title: "Edit receipt design - Life Line Hospital",
};

// Focused per-design editor (plan §4b). Loaded by id; the design's bill type is
// fixed (it came from the row), so there are no type-tabs here - just the pdfme
// designer, the field palette for that type, and this one design's Save.
// admin-only and location-scoped (getTemplateById takes locationId), so one
// branch can never open another's design.
export default async function ReceiptEditorPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const session = await requireAdmin();
  const locationId = await getUserLocationId(session.sub);
  if (!locationId) {
    throw new Error("Could not resolve your location.");
  }

  const row = await getTemplateById(templateId, locationId);
  if (!row) notFound();

  return <ReceiptEditor row={row} />;
}
