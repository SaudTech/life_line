import { requireSession } from "@/lib/auth/dal";
import { getUserProfile } from "@/lib/users/repository";
import { Toaster } from "@/components/ui/sonner";
import { TopNav } from "./top-nav";

// Shared shell for the signed-in role home pages (admin, supervisor, desk).
// Fixed, predictable frame - the top nav bar plus the page body. The group
// requires ANY valid session here; each section's own layout narrows to the
// allowed role (server-enforced, §8), so a desk user can't reach /admin. The bar
// is role-aware but display-only; server gating remains the authority.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const profile = await getUserProfile(session.sub);

  return (
    <div className="flex flex-1 flex-col">
      <TopNav
        role={session.role}
        name={profile?.name ?? "Staff"}
        phone={profile?.phone ?? null}
        email={profile?.email ?? null}
        supervisorName={profile?.supervisor_name ?? null}
      />
      <main className="flex-1 p-6">{children}</main>
      <Toaster />
    </div>
  );
}
