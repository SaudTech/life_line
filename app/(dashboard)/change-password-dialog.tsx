"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  changeOwnPasswordFormSchema,
  type ChangeOwnPasswordFormValues,
} from "@/lib/users/schema";
import { changeOwnPasswordAction } from "@/lib/users/actions";
import type { ActionResult } from "@/lib/forms/action-result";

// Self-service "Change password" dialog, opened from the top bar's account
// popover by ANY signed-in staff member. Client-side validation mirrors the
// server exactly (one schema family in lib/users/schema.ts); the action
// re-validates and verifies the current password before writing (§8, §10).

// A password input with an inline show/hide toggle. The toggle is display-only
// convenience (the counter PC is shared - staff can double-check what they
// typed without a second "confirm" mistake); tabIndex={-1} keeps the
// keyboard-first Tab order flowing field → field, never through the eyes.
function PasswordInput({
  id,
  autoFocus,
  invalid,
  registration,
}: {
  id: string;
  autoFocus?: boolean;
  invalid: boolean;
  registration: ReturnType<ReturnType<typeof useForm<ChangeOwnPasswordFormValues>>["register"]>;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        autoFocus={autoFocus}
        autoComplete={id === "cp-current" ? "current-password" : "new-password"}
        aria-invalid={invalid ? true : undefined}
        className="pr-9"
        {...registration}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const form = useForm<ChangeOwnPasswordFormValues>({
    resolver: zodResolver(changeOwnPasswordFormSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    defaultValues: { currentPassword: "", password: "", confirmPassword: "" },
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  async function onSubmit(values: ChangeOwnPasswordFormValues) {
    const res: ActionResult | undefined = await changeOwnPasswordAction({
      currentPassword: values.currentPassword,
      password: values.password,
    });
    if (res && !res.ok) {
      for (const [key, message] of Object.entries(res.fieldErrors ?? {})) {
        setError(
          key === "root" ? "root" : (key as keyof ChangeOwnPasswordFormValues),
          { message },
        );
      }
      if (res.formError) setError("root", { message: res.formError });
      return;
    }
    toast.success("Password updated", {
      description: "Use your new password the next time you sign in.",
    });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-10 flex-none items-center justify-center rounded-full bg-primary/10 text-primary"
            >
              <KeyRound className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <DialogTitle>Change password</DialogTitle>
              <DialogDescription>
                Update the password you use to sign in.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <Field data-invalid={errors.currentPassword ? true : undefined}>
              <FieldLabel htmlFor="cp-current">Current password</FieldLabel>
              <PasswordInput
                id="cp-current"
                autoFocus
                invalid={!!errors.currentPassword}
                registration={register("currentPassword")}
              />
              <FieldError errors={[errors.currentPassword]} />
            </Field>

            {/* Visual break between "prove it's you" and "pick the new one" */}
            <div className="border-t" aria-hidden />

            <Field data-invalid={errors.password ? true : undefined}>
              <FieldLabel htmlFor="cp-new">New password</FieldLabel>
              <PasswordInput
                id="cp-new"
                invalid={!!errors.password}
                registration={register("password")}
              />
              <FieldDescription className="text-xs">
                At least 8 characters. Avoid reusing an old password.
              </FieldDescription>
              <FieldError errors={[errors.password]} />
            </Field>

            <Field data-invalid={errors.confirmPassword ? true : undefined}>
              <FieldLabel htmlFor="cp-confirm">Confirm new password</FieldLabel>
              <PasswordInput
                id="cp-confirm"
                invalid={!!errors.confirmPassword}
                registration={register("confirmPassword")}
              />
              <FieldError errors={[errors.confirmPassword]} />
            </Field>

            <div className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 flex-none" aria-hidden />
              <span>
                You stay signed in on this device. The new password applies from
                your next sign-in.
              </span>
            </div>

            {errors.root ? <FieldError errors={[errors.root]} /> : null}
          </FieldGroup>

          <DialogFooter className="mt-6 flex-row justify-start gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Updating…" : "Update password"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
