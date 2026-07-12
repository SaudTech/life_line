"use client";

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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";

import {
  newDoctorSchema,
  updateDoctorSchema,
  DEPARTMENTS,
  DOCTOR_STATUSES,
  DOCTOR_STATUS_LABELS,
  type NewDoctorValues,
  type UpdateDoctorValues,
} from "@/lib/doctors/schema";
import { createDoctorAction, updateDoctorAction } from "@/lib/doctors/actions";
import { formatPaise } from "@/lib/money";
import type { ActionResult } from "@/lib/forms/action-result";
import type { DoctorListRow } from "@/lib/doctors/repository";

// Dropdown choices for the app-wide <Combobox>, mirroring lib/users/schema's
// ROLE_OPTIONS pattern.
const DEPARTMENT_OPTIONS: ComboboxOption[] = DEPARTMENTS.map((d) => ({ value: d, label: d }));
const STATUS_OPTIONS: ComboboxOption[] = DOCTOR_STATUSES.map((s) => ({
  value: s,
  label: DOCTOR_STATUS_LABELS[s],
}));

// Add / edit dialog for a doctor (plan §5). Mirrors the Users form dialog: RHF +
// zod for instant inline errors, the server action re-validates authoritatively,
// and its ActionResult flows back into the form via setError. The fee is a rupee
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

// The form fields shared by add + edit, kept in one place so the two forms
// never drift. Generic over the values type; `errors` is the RHF error map.
function DoctorFields<T extends FieldValues>({
  register,
  control,
  errors,
  idPrefix,
}: {
  register: import("react-hook-form").UseFormRegister<T>;
  control: import("react-hook-form").Control<T>;
  errors: import("react-hook-form").FieldErrors<T>;
  idPrefix: string;
}) {
  // Cast the fixed field names to Path<T> - both schemas share these keys.
  const name = "name" as Path<T>;
  const department = "department" as Path<T>;
  const phone = "phone" as Path<T>;
  const status = "status" as Path<T>;
  const fee = "fee" as Path<T>;
  const days = "revisitValidityDays" as Path<T>;
  return (
    <FieldGroup>
      <Field data-invalid={errors.name ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-name`}>Full name</FieldLabel>
        <Input
          id={`${idPrefix}-name`}
          autoFocus
          placeholder="e.g. Dr. Anita Rao"
          aria-invalid={errors.name ? true : undefined}
          {...register(name)}
        />
        <FieldError errors={[errors.name as never]} />
      </Field>
      <Field data-invalid={errors.department ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-dept`}>Department</FieldLabel>
        <Controller
          control={control}
          name={department}
          render={({ field }) => (
            <Combobox
              options={DEPARTMENT_OPTIONS}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              invalid={errors.department ? true : undefined}
              placeholder="Choose a department"
              searchPlaceholder="Search departments…"
              ariaLabel="Department"
            />
          )}
        />
        <FieldError errors={[errors.department as never]} />
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
      </Field>
      <Field data-invalid={errors.status ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-status`}>Status</FieldLabel>
        <Controller
          control={control}
          name={status}
          render={({ field }) => (
            <Combobox
              options={STATUS_OPTIONS}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              invalid={errors.status ? true : undefined}
              placeholder="Choose a status"
              ariaLabel="Status"
            />
          )}
        />
        <FieldError errors={[errors.status as never]} />
      </Field>
      <Field data-invalid={errors.fee ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-fee`}>Consultation fee (₹)</FieldLabel>
        <Input
          id={`${idPrefix}-fee`}
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          placeholder="e.g. 250 or 250.50"
          aria-invalid={errors.fee ? true : undefined}
          {...register(fee)}
        />
        <FieldError errors={[errors.fee as never]} />
      </Field>
      <Field data-invalid={errors.revisitValidityDays ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-days`}>Revisit validity (days)</FieldLabel>
        <Input
          id={`${idPrefix}-days`}
          type="number"
          inputMode="numeric"
          step="1"
          min="0"
          placeholder="e.g. 7"
          aria-invalid={errors.revisitValidityDays ? true : undefined}
          {...register(days)}
        />
        <FieldError errors={[errors.revisitValidityDays as never]} />
        <p className="text-xs text-muted-foreground">
          A revisit within this many days reuses the same consultation for free.
        </p>
      </Field>
    </FieldGroup>
  );
}

export function DoctorFormDialog({
  mode,
  doctor,
  onClose,
}: {
  mode: "add" | "edit";
  doctor: DoctorListRow | null;
  onClose: () => void;
}) {
  if (mode === "add") return <AddForm onClose={onClose} />;
  if (doctor) return <EditForm doctor={doctor} onClose={onClose} />;
  return null;
}

function AddForm({ onClose }: { onClose: () => void }) {
  // Input/output generics: z.coerce.number() means the FORM value (input) is
  // wider than the validated NewDoctorValues (output) handleSubmit hands us.
  const form = useForm<z.input<typeof newDoctorSchema>, unknown, NewDoctorValues>({
    resolver: zodResolver(newDoctorSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    defaultValues: {
      name: "",
      // "" until chosen - the resolver rejects a blank submit (department is required).
      department: "" as (typeof DEPARTMENTS)[number],
      phone: "",
      status: "available",
      fee: "",
      revisitValidityDays: 0,
    },
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  async function onSubmit(values: NewDoctorValues) {
    const res = await createDoctorAction(values);
    if (applyResult<NewDoctorValues>(res, setError) && res?.ok) {
      toast.success(`${values.name} added`);
      onClose();
    }
  }

  return (
    <DialogShell
      title="Add doctor"
      description="Add a doctor to the consultation master list."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <DoctorFields register={register} control={control} errors={errors} idPrefix="ad" />
        {errors.root ? <FieldError errors={[errors.root]} /> : null}
        <DialogFooter className="mt-6 flex-row justify-start gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Adding…" : "Add doctor"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}

function EditForm({ doctor, onClose }: { doctor: DoctorListRow; onClose: () => void }) {
  const form = useForm<z.input<typeof updateDoctorSchema>, unknown, UpdateDoctorValues>({
    resolver: zodResolver(updateDoctorSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    defaultValues: {
      id: doctor.id,
      name: doctor.name,
      department: (doctor.department ?? "") as (typeof DEPARTMENTS)[number],
      phone: doctor.phone ?? "",
      status: (doctor.status || "available") as (typeof DOCTOR_STATUSES)[number],
      // Prefill the fee as a plain rupee string ("250.00") the schema accepts.
      fee: formatPaise(doctor.fee_paise).replace(/,/g, ""),
      revisitValidityDays: doctor.revisit_validity_days,
    },
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = form;

  async function onSubmit(values: UpdateDoctorValues) {
    const res = await updateDoctorAction(values);
    if (applyResult<UpdateDoctorValues>(res, setError)) {
      toast.success("Changes saved");
      onClose();
    }
  }

  return (
    <DialogShell
      title="Edit doctor"
      description="Update name, department, phone, status, fee and revisit validity."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <DoctorFields register={register} control={control} errors={errors} idPrefix="ed" />
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
