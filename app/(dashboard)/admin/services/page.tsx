import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/dal";
import { listServices } from "@/lib/services/repository";
import { sweepExpiredServices } from "@/lib/services/sweep";
import { ServicesManager } from "./services-manager";

export const metadata: Metadata = {
  title: "Services - Life Line Hospital",
};

// Admin-only services master list. The (dashboard) layout already gates the group,
// but requireAdmin() here is the page's own server check (hiding UI ≠ security,
// §8). Loads every service once - active and inactive - and hands them to the
// client manager, which edits and toggles status from there.
//
// Sweep expired Trash before loading, so an admin never sees a service that is
// already past its retention window (the daily interval in instrumentation.ts is
// the belt-and-braces path for when nobody opens the page).
export default async function ServicesPage() {
  await requireAdmin();
  await sweepExpiredServices();
  const services = await listServices();

  return <ServicesManager services={services} />;
}
