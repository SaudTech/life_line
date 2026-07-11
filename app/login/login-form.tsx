"use client";

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
      </FieldGroup>
    </form>
  );
}
