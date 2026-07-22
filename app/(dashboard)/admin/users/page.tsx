import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/dal";
import { getUserLocationId, listUsers } from "@/lib/users/repository";
import { UsersManager } from "./users-manager";

export const metadata: Metadata = {
  title: "Users - Life Line Hospital",
};

// Admin-only staff management. The (dashboard) layout already gates the group,
// but requireAdmin() here is the page's own server check (hiding UI ≠ security,
// §8). Loads every user at THIS admin's location once - active and trashed - and
// hands them to the client manager, which filters and edits from there.
export default async function UsersPage() {
  const session = await requireAdmin();
  const locationId = await getUserLocationId(session.sub);
  if (!locationId) {
    throw new Error("Could not resolve your location. Please sign in again.");
  }
  const users = await listUsers(locationId);

  return <UsersManager users={users} meId={session.sub} />;
}
