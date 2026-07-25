import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/dal";
import { getUserLocationId } from "@/lib/users/repository";
import {
  getActiveTemplate,
  getTemplateDoctorUsage,
  listTemplates,
} from "@/lib/printing/repository";
import { relativeTime } from "@/lib/admin/activity";
import { ReceiptsLibrary, type DesignRow } from "./receipts-library";

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

  // Designs, plus which doctors are assigned to each (migration 0024) - the
  // usage is read here, once, for the whole grid: it drives both the card's
  // "Used by ..." line and the warning shown before a delete.
  const [templates, usage] = await Promise.all([
    listTemplates(locationId),
    getTemplateDoctorUsage(locationId),
  ]);

  // Pre-format "Updated ..." on the server with a single server `now`, the same
  // way the admin dashboard formats its activity rows. A client-computed `now`
  // renders a different label than the server's → hydration mismatch.
  const now = new Date();
  const designs: DesignRow[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    bill_type: t.bill_type,
    is_active: t.is_active,
    updatedLabel: relativeTime(new Date(t.updated_at), now),
    doctors: usage.get(t.id) ?? [],
  }));

  return <ReceiptsLibrary designs={designs} />;
}
