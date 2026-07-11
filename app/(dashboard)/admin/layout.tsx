import { requireRole } from "@/lib/auth/dal";

// Admin-only section. Every /admin/* page is gated here (server-enforced, §8);
// a non-admin session is bounced to its own home, never shown this subtree.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(["admin"]);
  return <>{children}</>;
}
