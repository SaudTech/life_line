import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/dal";
import { getUserLocationId } from "@/lib/users/repository";
import { getActiveTemplate, listTemplates } from "@/lib/printing/repository";
import { ReceiptsLibrary } from "./receipts-library";

export const metadata: Metadata = {
  title: "Receipt designs - Life Line Hospital",
};

// Admin-only receipt design LIBRARY (plan §4a). The (dashboard) layout already
// gates the group, but requireAdmin() here is the page's own server check
// (hiding UI ≠ security, §8). Reads every design for the location; each is a
// named row in bill_templates, one active per type.
export default async function ReceiptsPage() {
  const session = await requireAdmin();
  const locationId = await getUserLocationId(session.sub);
  if (!locationId) {
    throw new Error("Could not resolve your location.");
  }

  // Guarantee each non-IP type has at least its seeded default design, so the
  // library is never empty on a fresh install (getActiveTemplate lazily seeds
  // the checked-in default the first time it's read - plan §4a: a type always
  // has ≥1 design). Cheap: a single indexed lookup once seeded.
  await Promise.all([
    getActiveTemplate("consultation", locationId),
    getActiveTemplate("procedure", locationId),
  ]);

  const templates = await listTemplates(locationId);
  return <ReceiptsLibrary templates={templates} />;
}
