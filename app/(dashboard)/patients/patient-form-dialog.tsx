"use client";

import { useForm, Controller, type Control, type Path, type FieldValues } from "react-hook-form";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";

import {
  newPatientSchema,
  updatePatientSchema,
  GENDERS,
  type NewPatientValues,
  type UpdatePatientValues,
} from "@/lib/patients/schema";
import { createPatientAction, updatePatientAction } from "@/lib/patients/actions";
import type { ActionResult } from "@/lib/forms/action-result";
import type { PatientRow } from "@/lib/patients/repository";

// Gender choices for the app-wide <Combobox> (searchable dropdown).
const GENDER_OPTIONS: ComboboxOption[] = GENDERS.map((g) => ({
  value: g,
  label: g.charAt(0).toUpperCase() + g.slice(1),
}));

// Register / edit dialog for a patient (plan §5). Mirrors the Doctor form dialog:
// RHF + zod for instant inline errors, the server action re-validates
// authoritatively, and its ActionResult flows back into the form via setError.
//
// Fields: Name (autofocus) → Phone (required - the lookup key) → Age (optional) →
// Area (optional). On register success, the toast shows the DB-assigned Patient ID.

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

// The field set shared by register + edit, in one place so the two forms never
// drift. Generic over the values type; `errors` is the RHF error map.
function PatientFields<T extends FieldValues>({
  register,
  control,
  errors,
  idPrefix,
}: {
  register: import("react-hook-form").UseFormRegister<T>;
  control: Control<T>;
  errors: import("react-hook-form").FieldErrors<T>;
  idPrefix: string;
}) {
  // Cast the fixed field names to Path<T> - both schemas share these keys.
  const name = "name" as Path<T>;
  const phone = "phone" as Path<T>;
  const age = "age" as Path<T>;
  const area = "area" as Path<T>;
  const gender = "gender" as Path<T>;
  return (
    <FieldGroup>
      <Field data-invalid={errors.name ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-name`}>Full name</FieldLabel>
        <Input
          id={`${idPrefix}-name`}
          autoFocus
          placeholder="e.g. Meera Ann"
          aria-invalid={errors.name ? true : undefined}
          {...register(name)}
        />
        <FieldError errors={[errors.name as never]} />
      </Field>
      <Field data-invalid={errors.phone ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-phone`}>Phone</FieldLabel>
        <Input
          id={`${idPrefix}-phone`}
          type="tel"
          inputMode="tel"
          placeholder="e.g. 9876543210"
          aria-invalid={errors.phone ? true : undefined}
          {...register(phone)}
        />
        <FieldError errors={[errors.phone as never]} />
        <p className="text-xs text-muted-foreground">
          The lookup key at the counter. Several patients may share one number.
        </p>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field data-invalid={errors.age ? true : undefined}>
          <FieldLabel htmlFor={`${idPrefix}-age`}>Age (optional)</FieldLabel>
          <Input
            id={`${idPrefix}-age`}
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            placeholder="e.g. 34"
            aria-invalid={errors.age ? true : undefined}
            {...register(age)}
          />
          <FieldError errors={[errors.age as never]} />
        </Field>
        <Field data-invalid={errors.gender ? true : undefined}>
          <FieldLabel htmlFor={`${idPrefix}-gender`}>Gender (optional)</FieldLabel>
          <Controller
            control={control}
            name={gender}
            render={({ field }) => (
              <Combobox
                options={GENDER_OPTIONS}
                value={field.value || ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                invalid={errors.gender ? true : undefined}
                placeholder="Select…"
                searchPlaceholder="Search…"
                ariaLabel="Gender"
              />
            )}
          />
          <FieldError errors={[errors.gender as never]} />
        </Field>
      </div>
      <Field data-invalid={errors.area ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-area`}>Area (optional)</FieldLabel>
        <Input
          id={`${idPrefix}-area`}
          placeholder="e.g. Kadavanthra"
          aria-invalid={errors.area ? true : undefined}
          {...register(area)}
        />
        <FieldError errors={[errors.area as never]} />
      </Field>
    </FieldGroup>
  );
}

export function PatientFormDialog({
  mode,
  patient,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  patient: PatientRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  if (mode === "add") return <AddForm onClose={onClose} onSaved={onSaved} />;
  if (patient) return <EditForm patient={patient} onClose={onClose} onSaved={onSaved} />;
  return null;
}

function AddForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  // Input/output generics: z.coerce.number() on age means the FORM value (input)
  // is wider than the validated NewPatientValues (output) handleSubmit hands us.
  const form = useForm<z.input<typeof newPatientSchema>, unknown, NewPatientValues>({
    resolver: zodResolver(newPatientSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    defaultValues: { name: "", phone: "", age: "", area: "", gender: "" },
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  async function onSubmit(values: NewPatientValues) {
    const res = await createPatientAction(values);
    if (applyResult<NewPatientValues>(res, setError) && res?.ok) {
      toast.success(`${values.name} registered`, {
        description: `Patient ID ${res.data?.patient_code}`,
      });
      onSaved();
      onClose();
    }
  }

  return (
    <DialogShell
      title="Register patient"
      description="Add a new patient. A Patient ID is assigned automatically."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <PatientFields register={register} control={control} errors={errors} idPrefix="ap" />
        {errors.root ? <FieldError errors={[errors.root]} /> : null}
        <DialogFooter className="mt-6 flex-row justify-start gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Registering…" : "Register patient"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}

function EditForm({
  patient,
  onClose,
  onSaved,
}: {
  patient: PatientRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useForm<z.input<typeof updatePatientSchema>, unknown, UpdatePatientValues>({
    resolver: zodResolver(updatePatientSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    defaultValues: {
      id: patient.id,
      name: patient.name,
      phone: patient.phone ?? "",
      age: patient.age ?? "",
      area: patient.area ?? "",
      gender: patient.gender ?? "",
    },
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = form;

  async function onSubmit(values: UpdatePatientValues) {
    const res = await updatePatientAction(values);
    if (applyResult<UpdatePatientValues>(res, setError)) {
      toast.success("Changes saved");
      onSaved();
      onClose();
    }
  }

  return (
    <DialogShell
      title="Edit patient"
      description={`Patient ID ${patient.patient_code}`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <PatientFields register={register} control={control} errors={errors} idPrefix="ep" />
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
