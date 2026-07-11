import { requireRole } from "@/lib/auth/dal";

// Supervisor section. Supervisors and admins (super-user) may enter; desk roles
// are bounced to their own home (server-enforced, §8).
export default async function SupervisorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(["supervisor", "admin"]);
  return <>{children}</>;
}
