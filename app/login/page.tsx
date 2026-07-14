import type { Metadata } from "next";
import Image from "next/image";
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
        {/* Hospital branding - mirrors the signage: logo, indigo wordmark, red
            tagline (public/color-theme-reference.jpg). */}
        <div className="flex flex-col items-center text-center">
          <Image
            src="/logo.png"
            alt="Life Line Maternity & Nursing Home"
            width={72}
            height={72}
            priority
            className="size-[72px] object-contain"
          />
          <h1 className="mt-3 font-display text-3xl font-bold tracking-[0.04em] text-primary">
            LIFE LINE
          </h1>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-destructive">
            Maternity &amp; Nursing Home
          </p>
        </div>

        <div className="my-5 border-t" />

        <p className="text-sm font-medium text-muted-foreground">
          Sign in to the billing counter
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
