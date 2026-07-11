"use client";

import { useState } from "react";
import { useForm, Controller, type Path, type FieldValues } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
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
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";

import {
  newUserSchema,
  updateUserSchema,
  resetPasswordFormSchema,
  setPinFormSchema,
  ROLES,
  ROLE_LABELS,
  ROLE_ACCESS,
  PIN_ROLES,
  type NewUserValues,
  type UpdateUserValues,
  type ResetPasswordFormValues,
  type SetPinFormValues,
  type Role,
} from "@/lib/users/schema";
import {
  createUserAction,
  updateUserAction,
  resetPasswordAction,
  setPinAction,
  setActiveAction,
} from "@/lib/users/actions";
import { PERMISSIONS, PERMISSION_KEYS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/forms/action-result";
import type { UserListRow } from "@/lib/users/repository";

// Role choices for the app-wide <Combobox> (searchable dropdown).
const ROLE_OPTIONS: ComboboxOption[] = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

function applyResult<T extends FieldValues>(
  res: ActionResult<unknown> | undefined,
  setError: (name: Path<T> | "root", err: { message: string }) => void,
): boolean {
  if (res && !res.ok) {
    for (const [key, message] of Object.entries(res.fieldErrors ?? {})) {
      setError(key === "root" ? "root" : (key as Path<T>), { message });
    }
    if (res.formError) setError("root", { message: res.formError });
    return false;
  }
  return true;
}

function RoleField<T extends FieldValues>({
  control,
  name,
  invalid,
}: {
  control: import("react-hook-form").Control<T>;
  name: Path<T>;
  invalid: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Combobox
          options={ROLE_OPTIONS}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          invalid={invalid}
          placeholder="Choose a role"
          searchPlaceholder="Search roles…"
          ariaLabel="Role"
        />
      )}
    />
  );
}

// Granular permissions section (plan 1B): a checkbox per registry key, bound into
// the RHF form as `permissions: string[]`. When role === admin the boxes render
// all-on and disabled with a note - admins hold every permission implicitly, so
// nothing redundant is stored (the server normalises an admin's grants to none).
function PermissionsField<T extends FieldValues>({
  control,
  name,
  isAdmin,
}: {
  control: import("react-hook-form").Control<T>;
  name: Path<T>;
  isAdmin: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const value: string[] = Array.isArray(field.value) ? field.value : [];
        function toggle(key: string, checked: boolean) {
          const next = checked
            ? [...value, key]
            : value.filter((k) => k !== key);
          field.onChange(next);
        }
        return (
          <fieldset className="flex flex-col gap-2.5">
            <legend className="text-sm font-medium text-foreground">Permissions</legend>
            {isAdmin ? (
              <p className="text-xs text-muted-foreground">
                Admins have every permission.
              </p>
            ) : null}
            <div className="flex flex-col gap-2">
              {PERMISSION_KEYS.map((key) => {
                const checked = isAdmin || value.includes(key);
                return (
                  <label
                    key={key}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-md border bg-card p-2.5 transition-colors hover:bg-muted/40",
                      isAdmin && "cursor-not-allowed opacity-70 hover:bg-card",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      checked={checked}
                      disabled={isAdmin}
                      onChange={(e) => toggle(key, e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {PERMISSIONS[key].label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {PERMISSIONS[key].description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      }}
    />
  );
}

// ── Add / Edit user ─────────────────────────────────────────────────────────
export function UserFormDialog({
  mode,
  user,
  onClose,
  onCreated,
}: {
  mode: "add" | "edit";
  user: UserListRow | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  // Two shapes share this dialog; branch the form type on mode.
  if (mode === "add") return <AddForm onClose={onClose} onCreated={onCreated} />;
  if (user) return <EditForm user={user} onClose={onClose} />;
  return null;
}

function DialogShell({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function AddForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  // Three generics: `permissions` has a zod .default([]), so the FORM value (input)
  // is wider than the validated NewUserValues (output) handleSubmit hands us.
  const form = useForm<z.input<typeof newUserSchema>, unknown, NewUserValues>({
    resolver: zodResolver(newUserSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    defaultValues: { name: "", phone: "", role: "op_desk", password: "", email: "", permissions: [] },
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = form;
  const role = watch("role");

  async function onSubmit(values: NewUserValues) {
    const res = await createUserAction(values);
    if (applyResult<NewUserValues>(res, setError) && res?.ok) {
      toast.success(`${values.name} created`);
      onCreated();
    }
  }

  return (
    <DialogShell title="Add new user" description="Create an internal staff account." onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="af-name">Full name</FieldLabel>
            <Input id="af-name" autoFocus placeholder="e.g. Asha Nair" aria-invalid={errors.name ? true : undefined} {...register("name")} />
            <FieldError errors={[errors.name]} />
          </Field>
          <Field data-invalid={errors.phone ? true : undefined}>
            <FieldLabel htmlFor="af-phone">Phone</FieldLabel>
            <Input id="af-phone" type="tel" inputMode="tel" placeholder="Used to sign in" aria-invalid={errors.phone ? true : undefined} {...register("phone")} />
            <FieldError errors={[errors.phone]} />
          </Field>
          <Field data-invalid={errors.role ? true : undefined}>
            <FieldLabel htmlFor="role">Role</FieldLabel>
            <RoleField control={control} name="role" invalid={!!errors.role} />
            <p className="text-xs text-muted-foreground">{ROLE_ACCESS[role]}</p>
            <FieldError errors={[errors.role]} />
          </Field>
          <Field data-invalid={errors.password ? true : undefined}>
            <FieldLabel htmlFor="af-password">Password</FieldLabel>
            <Input id="af-password" type="password" autoComplete="new-password" aria-invalid={errors.password ? true : undefined} {...register("password")} />
            <FieldError errors={[errors.password]} />
          </Field>
          <Field data-invalid={errors.email ? true : undefined}>
            <FieldLabel htmlFor="af-email">Email (optional)</FieldLabel>
            <Input id="af-email" type="email" placeholder="name@lifelinehospital.org" aria-invalid={errors.email ? true : undefined} {...register("email")} />
            <FieldError errors={[errors.email]} />
          </Field>
          <PermissionsField control={control} name="permissions" isAdmin={role === "admin"} />
          {errors.root ? <FieldError errors={[errors.root]} /> : null}
        </FieldGroup>
        <DialogFooter className="mt-6 flex-row justify-start gap-2">
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Creating…" : "Create user"}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}

function EditForm({ user, onClose }: { user: UserListRow; onClose: () => void }) {
  const form = useForm<z.input<typeof updateUserSchema>, unknown, UpdateUserValues>({
    resolver: zodResolver(updateUserSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    defaultValues: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      email: user.email ?? "",
      // Only seed keys still in the registry, so an edit never re-submits a grant
      // that was retired (which the server would reject).
      permissions: user.permissions.filter((p) =>
        (PERMISSION_KEYS as string[]).includes(p),
      ),
    },
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = form;
  const role = watch("role");

  async function onSubmit(values: UpdateUserValues) {
    const res = await updateUserAction(values);
    if (applyResult<UpdateUserValues>(res, setError)) {
      toast.success("Changes saved");
      onClose();
    }
  }

  return (
    <DialogShell title="Edit user" description="Update name, phone, email and role." onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="ef-name">Full name</FieldLabel>
            <Input id="ef-name" autoFocus aria-invalid={errors.name ? true : undefined} {...register("name")} />
            <FieldError errors={[errors.name]} />
          </Field>
          <Field data-invalid={errors.phone ? true : undefined}>
            <FieldLabel htmlFor="ef-phone">Phone</FieldLabel>
            <Input id="ef-phone" type="tel" inputMode="tel" aria-invalid={errors.phone ? true : undefined} {...register("phone")} />
            <FieldError errors={[errors.phone]} />
          </Field>
          <Field data-invalid={errors.email ? true : undefined}>
            <FieldLabel htmlFor="ef-email">Email</FieldLabel>
            <Input id="ef-email" type="email" aria-invalid={errors.email ? true : undefined} {...register("email")} />
            <FieldError errors={[errors.email]} />
          </Field>
          <Field data-invalid={errors.role ? true : undefined}>
            <FieldLabel htmlFor="role">Role</FieldLabel>
            <RoleField control={control} name="role" invalid={!!errors.role} />
            <p className="text-xs text-muted-foreground">{ROLE_ACCESS[role]}</p>
            <FieldError errors={[errors.role]} />
          </Field>
          <PermissionsField control={control} name="permissions" isAdmin={role === "admin"} />
          {errors.root ? <FieldError errors={[errors.root]} /> : null}
        </FieldGroup>
        <DialogFooter className="mt-6 flex-row justify-start gap-2">
          <Button type="submit" disabled={isSubmitting || !isDirty}>{isSubmitting ? "Saving…" : "Save changes"}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}

// ── Reset password (confirm twice) ──────────────────────────────────────────
export function ResetPasswordDialog({ user, onClose }: { user: UserListRow; onClose: () => void }) {
  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    defaultValues: { password: "", confirmPassword: "" },
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  async function onSubmit(values: ResetPasswordFormValues) {
    const res = await resetPasswordAction({ id: user.id, password: values.password });
    if (applyResult<ResetPasswordFormValues>(res, setError)) {
      toast.success("Password reset");
      onClose();
    }
  }

  return (
    <DialogShell title="Reset password" description={`Set a new password for ${user.name}.`} onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <Field data-invalid={errors.password ? true : undefined}>
            <FieldLabel htmlFor="rp-new">New password</FieldLabel>
            <Input id="rp-new" type="password" autoFocus autoComplete="new-password" aria-invalid={errors.password ? true : undefined} {...register("password")} />
            <FieldError errors={[errors.password]} />
          </Field>
          <Field data-invalid={errors.confirmPassword ? true : undefined}>
            <FieldLabel htmlFor="rp-confirm">Confirm new password</FieldLabel>
            <Input id="rp-confirm" type="password" autoComplete="new-password" aria-invalid={errors.confirmPassword ? true : undefined} {...register("confirmPassword")} />
            <FieldError errors={[errors.confirmPassword]} />
          </Field>
          {errors.root ? <FieldError errors={[errors.root]} /> : null}
        </FieldGroup>
        <DialogFooter className="mt-6 flex-row justify-start gap-2">
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Reset password"}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}

// ── Set / change / clear discount PIN ───────────────────────────────────────
export function PinDialog({ user, onClose }: { user: UserListRow; onClose: () => void }) {
  const [clearing, setClearing] = useState(false);
  const form = useForm<SetPinFormValues>({
    resolver: zodResolver(setPinFormSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    defaultValues: { pin: "", confirmPin: "" },
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  async function onSubmit(values: SetPinFormValues) {
    const res = await setPinAction({ id: user.id, pin: values.pin });
    if (applyResult<SetPinFormValues>(res, setError)) {
      toast.success("Discount PIN updated");
      onClose();
    }
  }

  async function clearPin() {
    setClearing(true);
    const res = await setPinAction({ id: user.id, pin: "" });
    setClearing(false);
    if (res && !res.ok) {
      setError("root", { message: res.formError ?? "Could not clear the PIN." });
      return;
    }
    toast.success("PIN cleared");
    onClose();
  }

  return (
    <DialogShell
      title={user.has_pin ? "Change discount PIN" : "Set discount PIN"}
      description={`A 4-6 digit PIN for ${user.name} to authorize counter discounts. Separate from the login password.`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <Field data-invalid={errors.pin ? true : undefined}>
            <FieldLabel htmlFor="pin-new">New PIN</FieldLabel>
            <Input id="pin-new" inputMode="numeric" autoFocus autoComplete="off" aria-invalid={errors.pin ? true : undefined} {...register("pin")} />
            <FieldError errors={[errors.pin]} />
          </Field>
          <Field data-invalid={errors.confirmPin ? true : undefined}>
            <FieldLabel htmlFor="pin-confirm">Confirm PIN</FieldLabel>
            <Input id="pin-confirm" inputMode="numeric" autoComplete="off" aria-invalid={errors.confirmPin ? true : undefined} {...register("confirmPin")} />
            <FieldError errors={[errors.confirmPin]} />
          </Field>
          {errors.root ? <FieldError errors={[errors.root]} /> : null}
        </FieldGroup>
        <DialogFooter className="mt-6 flex-row flex-wrap justify-start gap-2">
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save PIN"}</Button>
          {user.has_pin ? (
            <Button type="button" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={clearPin} disabled={clearing || isSubmitting}>
              {clearing ? "Clearing…" : "Clear PIN"}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose} className="sm:ml-auto">Cancel</Button>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}

// ── Deactivate confirmation ─────────────────────────────────────────────────
export function DeactivateDialog({ user, onClose }: { user: UserListRow; onClose: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    const res = await setActiveAction({ id: user.id, active: false });
    setPending(false);
    if (res && !res.ok) {
      setError(res.formError ?? "Could not deactivate the account.");
      return;
    }
    toast.success("Account deactivated");
    onClose();
  }

  return (
    <DialogShell title="Deactivate account?" onClose={onClose}>
      <p className="text-sm leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{user.name}</span> will be moved to Trash and
        can no longer sign in. All records are preserved - you can reactivate the account at any time.
      </p>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      <DialogFooter className="mt-6 flex-row justify-start gap-2">
        <Button type="button" variant="destructive" onClick={confirm} disabled={pending}>
          {pending ? "Deactivating…" : "Deactivate"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      </DialogFooter>
    </DialogShell>
  );
}

export type { UserListRow };
