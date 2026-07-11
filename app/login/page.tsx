import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, homePathForRole } from "@/lib/auth/dal";
import LoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Sign in - Life Line Hospital",
};

export default async function LoginPage() {
  // Already signed in → skip the form and go to that role's home.
  const session = await getSession();
  if (session) {
    redirect(homePathForRole(session.role));
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-muted p-6">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8">
        <h1 className="text-xl font-semibold text-card-foreground">
          Line Line hospital. Done
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to the billing counter
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
