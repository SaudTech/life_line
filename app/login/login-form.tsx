"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginAction } from "@/lib/auth/actions";
import { loginSchema, type LoginValues } from "@/lib/auth/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";

// Reference implementation of the form stack (plan Part 2): shadcn `field`
// primitives + react-hook-form + one shared zod schema (loginSchema), validated
// on the client here for instant inline errors and re-validated authoritatively
// in loginAction. Keyboard-first (dev-rules §5): phone autofocuses, Tab order is
// phone → password → Sign in, Enter submits, and the button disables while pending.
export default function LoginForm() {
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone: "", password: "" },
  });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  // No self-service reset - accounts are admin-managed (dev-rules §8). The link
  // just reveals who to contact rather than pretending a reset flow exists.
  const [showForgot, setShowForgot] = useState(false);

  async function onSubmit(values: LoginValues) {
    // On success the server action redirects (throws to unwind), so nothing
    // returns here. Only failures come back as an ActionResult.
    const res = await loginAction(values);
    if (res && !res.ok) {
      for (const [key, message] of Object.entries(res.fieldErrors ?? {})) {
        setError(key as keyof LoginValues, { message });
      }
      // Generic auth failures are form-level (root), never a field error - no
      // wrong-phone vs wrong-password leak (security §8).
      if (res.formError) {
        setError("root", { message: res.formError });
      }
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-8" noValidate>
      <FieldGroup>
        <Field data-invalid={errors.phone ? true : undefined}>
          <FieldLabel htmlFor="phone">Phone</FieldLabel>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            autoFocus
            autoComplete="username"
            aria-invalid={errors.phone ? true : undefined}
            {...register("phone")}
          />
          <FieldError errors={[errors.phone]} />
        </Field>

        <Field data-invalid={errors.password ? true : undefined}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            {...register("password")}
          />
          <FieldError errors={[errors.password]} />
        </Field>

        {errors.root ? (
          <FieldError errors={[errors.root]} />
        ) : null}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>

        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowForgot((v) => !v)}
            aria-expanded={showForgot}
            className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            Forgot password?
          </button>
          {showForgot ? (
            <p className="mt-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Contact your admin - they can help reset your password.
            </p>
          ) : null}
        </div>
      </FieldGroup>
    </form>
  );
}
