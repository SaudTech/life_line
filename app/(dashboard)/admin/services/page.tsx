import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/dal";
import { listServices } from "@/lib/services/repository";
import { sweepExpiredServices } from "@/lib/services/sweep";
import { SERVICE_RETENTION_DAYS } from "@/lib/services/schema";
import { ServicesManager, type ServiceItem } from "./services-manager";

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

  // Resolve the purge countdown here, against one server clock: it gates data
  // destruction, so the number must match the server's sweep window rather than
  // whatever Date.now() the browser happens to hold (a client-side count also
  // renders differently than the server did → hydration mismatch).
  const now = Date.now();
  const items: ServiceItem[] = services.map((s) => ({
    ...s,
    trashDaysLeft: trashDaysLeft(s.trashed_at, now),
  }));

  return <ServicesManager services={items} />;
}

// Whole days left before a trashed service is permanently purged. Clamped to 0 so
// a service that's past the window (but not yet swept) reads "today", never a
// negative. Mirrors the server's purgeExpiredServices window.
function trashDaysLeft(trashedAt: Date | null, now: number): number {
  if (!trashedAt) return SERVICE_RETENTION_DAYS;
  const purgeAt = new Date(trashedAt).getTime() + SERVICE_RETENTION_DAYS * 86_400_000;
  return Math.max(0, Math.ceil((purgeAt - now) / 86_400_000));
}
