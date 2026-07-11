"use client";

import { useForm, type Path, type FieldValues } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";

import {
  newServiceSchema,
  updateServiceSchema,
  type NewServiceValues,
  type UpdateServiceValues,
} from "@/lib/services/schema";
import { createServiceAction, updateServiceAction } from "@/lib/services/actions";
import { formatPaise } from "@/lib/money";
import type { ActionResult } from "@/lib/forms/action-result";
import type { ServiceRow } from "@/lib/services/repository";

// Add / edit dialog for a service (plan §1A). Mirrors the Doctors form dialog: RHF
// + zod for instant inline errors, the server action re-validates authoritatively,
// and its ActionResult flows back into the form via setError. The price is a rupee
// STRING in the form; the action converts it to integer paise.

// Push a failed ActionResult's field/form errors back onto the form.
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

// The two form fields shared by add + edit, kept in one place so the two forms
// never drift. Generic over the values type; `errors` is the RHF error map.
function ServiceFields<T extends FieldValues>({
  register,
  errors,
  idPrefix,
}: {
  register: import("react-hook-form").UseFormRegister<T>;
  errors: import("react-hook-form").FieldErrors<T>;
  idPrefix: string;
}) {
  // Cast the fixed field names to Path<T> - both schemas share these keys.
  const name = "name" as Path<T>;
  const price = "price" as Path<T>;
  return (
    <FieldGroup>
      <Field data-invalid={errors.name ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-name`}>Name</FieldLabel>
        <Input
          id={`${idPrefix}-name`}
          autoFocus
          placeholder="e.g. Injection"
          aria-invalid={errors.name ? true : undefined}
          {...register(name)}
        />
        <FieldError errors={[errors.name as never]} />
      </Field>
      <Field data-invalid={errors.price ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-price`}>Price (₹)</FieldLabel>
        <Input
          id={`${idPrefix}-price`}
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          placeholder="e.g. 50 or 50.00"
          aria-invalid={errors.price ? true : undefined}
          {...register(price)}
        />
        <FieldError errors={[errors.price as never]} />
      </Field>
    </FieldGroup>
  );
}

export function ServiceFormDialog({
  mode,
  service,
  onClose,
}: {
  mode: "add" | "edit";
  service: ServiceRow | null;
  onClose: () => void;
}) {
  if (mode === "add") return <AddForm onClose={onClose} />;
  if (service) return <EditForm service={service} onClose={onClose} />;
  return null;
}

function AddForm({ onClose }: { onClose: () => void }) {
  const form = useForm<NewServiceValues>({
    resolver: zodResolver(newServiceSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    defaultValues: { name: "", price: "" },
  });
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = form;

  // The one save path both buttons share. Returns whether it landed, so the
  // caller decides what to do next (keep going vs close).
  async function save(values: NewServiceValues): Promise<boolean> {
    const res = await createServiceAction(values);
    if (applyResult<NewServiceValues>(res, setError) && res?.ok) {
      toast.success(`${values.name} added`);
      return true;
    }
    return false;
  }

  // Keyboard-first bulk entry (dev-rules §5): Enter (the primary button) saves and
  // immediately clears the form with focus back on Name, so a whole catalog can be
  // typed without touching the mouse. The toast confirms each save landed.
  async function onAddAnother(values: NewServiceValues) {
    if (await save(values)) {
      reset({ name: "", price: "" });
      // Return the cursor to Name for the next item. RHF's setFocus races with
      // both the reset re-render and the dialog's own focus management and loses,
      // so focus the DOM node directly by id on the next tick - deterministic.
      setTimeout(() => document.getElementById("as-name")?.focus(), 0);
    }
  }

  // Save the current entry and close - for the last item in a run.
  async function onSaveAndClose(values: NewServiceValues) {
    if (await save(values)) onClose();
  }

  return (
    <DialogShell
      title="Add service"
      description="Type Name, Tab to Price, press Enter to save and keep adding."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit(onAddAnother)} noValidate>
        <ServiceFields register={register} errors={errors} idPrefix="as" />
        {errors.root ? <FieldError errors={[errors.root]} /> : null}
        {/* Action order = tab order = primary first (dev-rules §5, spec §2). The
            primary repeat action leads, so one Tab from Price lands on it; Close
            sits at the right end and is reached last. Wraps on a phone. */}
        <DialogFooter className="mt-6 flex-row flex-wrap justify-start gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save & add another"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={handleSubmit(onSaveAndClose)}
          >
            Save &amp; close
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} className="sm:ml-auto">
            Close
          </Button>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}

function EditForm({ service, onClose }: { service: ServiceRow; onClose: () => void }) {
  const form = useForm<UpdateServiceValues>({
    resolver: zodResolver(updateServiceSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    defaultValues: {
      id: service.id,
      name: service.name,
      // Prefill the price as a plain rupee string ("50.00") the schema accepts.
      price: formatPaise(service.price_paise).replace(/,/g, ""),
    },
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = form;

  async function onSubmit(values: UpdateServiceValues) {
    const res = await updateServiceAction(values);
    if (applyResult<UpdateServiceValues>(res, setError)) {
      toast.success("Changes saved");
      onClose();
    }
  }

  return (
    <DialogShell
      title="Edit service"
      description="Update the name and price."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <ServiceFields register={register} errors={errors} idPrefix="es" />
        {errors.root ? <FieldError errors={[errors.root]} /> : null}
        <DialogFooter className="mt-6 flex-row justify-start gap-2">
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting ? "Saving…" : "Save changes"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}
