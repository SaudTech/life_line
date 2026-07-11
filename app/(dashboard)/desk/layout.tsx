import { requireRole } from "@/lib/auth/dal";

// Billing-counter section for the desk roles. Supervisors and admins may also
// work the counter; no one else reaches it (server-enforced, §8).
export default async function DeskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(["op_desk", "op_ip_desk", "supervisor", "admin"]);
  return <>{children}</>;
}
