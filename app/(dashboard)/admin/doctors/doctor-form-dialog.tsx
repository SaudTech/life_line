"use client";

import { useEffect, useState } from "react";
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
  DOCTOR_STATUSES,
  DOCTOR_STATUS_LABELS,
  DOCTOR_SHARE_TYPES,
  type DoctorShareType,
  type NewDoctorValues,
  type UpdateDoctorValues,
} from "@/lib/doctors/schema";
import { createDoctorAction, updateDoctorAction } from "@/lib/doctors/actions";
import { createDepartmentAction, deleteDepartmentAction } from "@/lib/departments/actions";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/forms/action-result";
import type { DoctorListRow } from "@/lib/doctors/repository";
import type { DepartmentRow } from "@/lib/departments/repository";
import type { ConsultationDesign } from "./doctors-manager";

// Dropdown choices for the app-wide <Combobox>, mirroring lib/users/schema's
// ROLE_OPTIONS pattern.
const STATUS_OPTIONS: ComboboxOption[] = DOCTOR_STATUSES.map((s) => ({
  value: s,
  label: DOCTOR_STATUS_LABELS[s],
}));

// Fee, revisit-days and doctor's share all default to "0" - without this, a
// counter clerk clicking in to correct a zero and typing "4" ends up with "04"
// (the keystroke lands after the existing digit rather than replacing it).
// Selecting the whole value on focus means typing immediately overwrites it,
// same as most POS/billing number fields.
function selectOnFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.target.select();
}

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
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

// The department picker's list used to be the fixed DEPARTMENTS enum; it's now
// a DB-backed master list (migration 0020, lib/departments/*) with no separate
// admin page - add or remove a department right here, inline, via the same
// Combobox. `field.value`/`onChange` still operate on the department NAME (a
// plain string, matching doctors.department's TEXT column), never an id -
// removing keeps the doctor's own row untouched even if its department is
// later deleted from the list.
//
// Holds its own copy of the list (seeded from the server-loaded `departments`
// prop) so a create/remove updates the dropdown instantly instead of waiting
// on the page's next revalidation round-trip; the effect re-syncs from the
// prop once that round-trip lands, so the two never drift for long.
function DepartmentField<T extends FieldValues>({
  control,
  name,
  invalid,
  departments,
  idPrefix,
}: {
  control: import("react-hook-form").Control<T>;
  name: Path<T>;
  invalid: boolean;
  departments: DepartmentRow[];
  idPrefix: string;
}) {
  const [depts, setDepts] = useState(departments);
  useEffect(() => setDepts(departments), [departments]);

  async function handleCreate(rawName: string, onChange: (v: string) => void) {
    const trimmed = rawName.trim();
    const res = await createDepartmentAction({ name: trimmed });
    if (!res.ok) {
      toast.error(res.fieldErrors?.name ?? res.formError ?? "Could not add the department.");
      throw new Error("create failed");
    }
    const id = res.data!.id;
    setDepts((prev) =>
      prev.some((d) => d.name === trimmed)
        ? prev
        : [...prev, { id, name: trimmed, created_at: new Date() }].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
    );
    onChange(trimmed);
    toast.success(`${trimmed} added`);
  }

  async function handleRemove(
    option: ComboboxOption,
    currentValue: string,
    onChange: (v: string) => void,
  ) {
    const dept = depts.find((d) => d.name === option.value);
    if (!dept) return;
    const res = await deleteDepartmentAction({ id: dept.id });
    if (!res.ok) {
      toast.error(res.formError ?? "Could not remove the department.");
      return;
    }
    setDepts((prev) => prev.filter((d) => d.id !== dept.id));
    if (currentValue === dept.name) onChange("");
    toast.success(`${dept.name} removed`);
  }

  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const options: ComboboxOption[] = depts.map((d) => ({ value: d.name, label: d.name }));
        // A doctor already assigned a department that's since been removed from
        // the list would otherwise show a blank trigger (its value matches no
        // option) - keep it visible as a plain, non-editable entry.
        if (field.value && !options.some((o) => o.value === field.value)) {
          options.unshift({ value: field.value, label: field.value });
        }
        return (
          <Combobox
            options={options}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            invalid={invalid}
            placeholder="Choose a department"
            searchPlaceholder="Search or add a department…"
            emptyText="No department found - type a name to add one."
            ariaLabel="Department"
            onCreate={(n) => handleCreate(n, field.onChange)}
            createLabel={(q) => `Add "${q}" as a new department`}
            onRemove={(o) => handleRemove(o, field.value, field.onChange)}
            removeLabel="Remove department"
          />
        );
      }}
    />
  );
}

const SHARE_TYPE_LABEL: Record<DoctorShareType, string> = { percentage: "%", flat: "₹" };

// The doctor's share of the consultation fee - one number that means either a
// percentage or a flat rupee amount, depending on the toggle inside the same
// control. Kept as ONE field (not a percent input plus a separate amount
// input stacked below it) so choosing the mode never grows the form's height;
// the schema validates `doctorShareValue` against whichever `doctorShareType`
// is currently selected (lib/doctors/schema.ts).
function DoctorShareField<T extends FieldValues>({
  control,
  register,
  invalid,
  idPrefix,
}: {
  control: import("react-hook-form").Control<T>;
  register: import("react-hook-form").UseFormRegister<T>;
  invalid: boolean;
  idPrefix: string;
}) {
  const shareType = "doctorShareType" as Path<T>;
  const shareValue = "doctorShareValue" as Path<T>;
  return (
    <Controller
      control={control}
      name={shareType}
      render={({ field: typeField }) => {
        const current = (typeField.value as DoctorShareType) || "percentage";
        return (
          <div
            className={cn(
              "flex h-9 items-stretch overflow-hidden rounded-md border border-input bg-white transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
              invalid && "border-destructive",
            )}
          >
            <Input
              id={`${idPrefix}-share`}
              type="number"
              inputMode="decimal"
              step={current === "percentage" ? "1" : "any"}
              min="0"
              max={current === "percentage" ? "100" : undefined}
              placeholder={current === "percentage" ? "e.g. 40" : "e.g. 500"}
              aria-invalid={invalid ? true : undefined}
              aria-label="Doctor's share"
              className="h-full flex-1 rounded-none border-0 shadow-none focus-visible:ring-0"
              onFocus={selectOnFocus}
              {...register(shareValue)}
            />
            <div className="flex items-center gap-0.5 border-l border-input bg-muted/40 p-1">
              {DOCTOR_SHARE_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => typeField.onChange(type)}
                  aria-pressed={current === type}
                  aria-label={type === "percentage" ? "Percentage" : "Flat amount"}
                  className={cn(
                    "h-full min-w-7 rounded px-2 text-xs font-semibold transition-colors",
                    current === type
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {SHARE_TYPE_LABEL[type]}
                </button>
              ))}
            </div>
          </div>
        );
      }}
    />
  );
}

// Which consultation receipt design this doctor's bills print on (migration
// 0024). "" is the default - the design marked Active in the receipt library -
// and is what a doctor keeps unless the hospital wants their own letterhead.
// Only CONSULTATION designs are offered; the server action re-checks that the
// chosen id really is one, at this location.
function ConsultationDesignField<T extends FieldValues>({
  control,
  name,
  invalid,
  designs,
}: {
  control: import("react-hook-form").Control<T>;
  name: Path<T>;
  invalid: boolean;
  designs: ConsultationDesign[];
}) {
  const activeName = designs.find((d) => d.isActive)?.name;
  const options: ComboboxOption[] = [
    { value: "", label: activeName ? `Default (${activeName})` : "Default" },
    ...designs.filter((d) => !d.isActive).map((d) => ({ value: d.id, label: d.name })),
  ];
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        // A design that has since been deleted would leave the trigger blank -
        // fall back to the Default entry so the control always reads truthfully
        // (that IS what such a doctor now prints; see deleteTemplate).
        const value = options.some((o) => o.value === field.value) ? field.value : "";
        return (
          <Combobox
            options={options}
            value={value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            invalid={invalid}
            placeholder="Default"
            ariaLabel="Consultation print design"
          />
        );
      }}
    />
  );
}

// The form fields shared by add + edit, kept in one place so the two forms
// never drift. Generic over the values type; `errors` is the RHF error map.
function DoctorFields<T extends FieldValues>({
  register,
  control,
  errors,
  departments,
  consultationDesigns,
  idPrefix,
}: {
  register: import("react-hook-form").UseFormRegister<T>;
  control: import("react-hook-form").Control<T>;
  errors: import("react-hook-form").FieldErrors<T>;
  departments: DepartmentRow[];
  consultationDesigns: ConsultationDesign[];
  idPrefix: string;
}) {
  // Cast the fixed field names to Path<T> - both schemas share these keys.
  const name = "name" as Path<T>;
  const department = "department" as Path<T>;
  const phone = "phone" as Path<T>;
  const status = "status" as Path<T>;
  const fee = "fee" as Path<T>;
  const days = "revisitValidityDays" as Path<T>;
  // Two fields per row at sm+ (falls back to one column on narrow phones) -
  // seven stacked fields was overflowing the dialog's viewport height, so
  // related fields are paired side by side instead of piling straight down.
  const row = "grid gap-x-4 gap-y-5 sm:grid-cols-2";
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

      <div className={row}>
        <Field data-invalid={errors.department ? true : undefined}>
          <FieldLabel htmlFor={`${idPrefix}-dept`}>Department</FieldLabel>
          <DepartmentField
            control={control}
            name={department}
            invalid={errors.department ? true : false}
            departments={departments}
            idPrefix={idPrefix}
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
      </div>

      <div className={row}>
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
            onFocus={selectOnFocus}
            {...register(fee)}
          />
          <FieldError errors={[errors.fee as never]} />
        </Field>
      </div>

      <div className={row}>
        <Field data-invalid={errors.doctorShareValue ? true : undefined}>
          <FieldLabel htmlFor={`${idPrefix}-share`}>Doctor&apos;s share</FieldLabel>
          <DoctorShareField
            control={control}
            register={register}
            invalid={errors.doctorShareValue ? true : false}
            idPrefix={idPrefix}
          />
          <FieldError errors={[errors.doctorShareValue as never]} />
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
            onFocus={selectOnFocus}
            {...register(days)}
          />
          <FieldError errors={[errors.revisitValidityDays as never]} />
          <p className="text-xs text-muted-foreground">
            Free re-consultation window.
          </p>
        </Field>
      </div>

      <Field data-invalid={errors.consultationTemplateId ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-design`}>Consultation print design</FieldLabel>
        <ConsultationDesignField
          control={control}
          name={"consultationTemplateId" as Path<T>}
          invalid={errors.consultationTemplateId ? true : false}
          designs={consultationDesigns}
        />
        <FieldError errors={[errors.consultationTemplateId as never]} />
        <p className="text-xs text-muted-foreground">
          Receipt layout used for this doctor&apos;s consultations. Leave on Default unless
          they need their own. Manage layouts under Admin → Receipt designs.
        </p>
      </Field>
    </FieldGroup>
  );
}

export function DoctorFormDialog({
  mode,
  doctor,
  departments,
  consultationDesigns,
  onClose,
}: {
  mode: "add" | "edit";
  doctor: DoctorListRow | null;
  departments: DepartmentRow[];
  consultationDesigns: ConsultationDesign[];
  onClose: () => void;
}) {
  if (mode === "add")
    return (
      <AddForm
        departments={departments}
        consultationDesigns={consultationDesigns}
        onClose={onClose}
      />
    );
  if (doctor)
    return (
      <EditForm
        doctor={doctor}
        departments={departments}
        consultationDesigns={consultationDesigns}
        onClose={onClose}
      />
    );
  return null;
}

function AddForm({
  departments,
  consultationDesigns,
  onClose,
}: {
  departments: DepartmentRow[];
  consultationDesigns: ConsultationDesign[];
  onClose: () => void;
}) {
  // Input/output generics: z.coerce.number() means the FORM value (input) is
  // wider than the validated NewDoctorValues (output) handleSubmit hands us.
  const form = useForm<z.input<typeof newDoctorSchema>, unknown, NewDoctorValues>({
    resolver: zodResolver(newDoctorSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    defaultValues: {
      name: "",
      // "" until chosen - the resolver rejects a blank submit (department is required).
      department: "",
      phone: "",
      status: "available",
      fee: "",
      revisitValidityDays: 0,
      doctorShareType: "percentage",
      doctorShareValue: "0",
      // "" = the location's active consultation design (migration 0024).
      consultationTemplateId: "",
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
        <DoctorFields
          register={register}
          control={control}
          errors={errors}
          departments={departments}
          consultationDesigns={consultationDesigns}
          idPrefix="ad"
        />
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

function EditForm({
  doctor,
  departments,
  consultationDesigns,
  onClose,
}: {
  doctor: DoctorListRow;
  departments: DepartmentRow[];
  consultationDesigns: ConsultationDesign[];
  onClose: () => void;
}) {
  const form = useForm<z.input<typeof updateDoctorSchema>, unknown, UpdateDoctorValues>({
    resolver: zodResolver(updateDoctorSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    defaultValues: {
      id: doctor.id,
      name: doctor.name,
      department: doctor.department ?? "",
      phone: doctor.phone ?? "",
      status: (doctor.status || "available") as (typeof DOCTOR_STATUSES)[number],
      // Prefill the fee as a plain rupee string ("250.00") the schema accepts.
      fee: formatPaise(doctor.fee_paise).replace(/,/g, ""),
      revisitValidityDays: doctor.revisit_validity_days,
      doctorShareType: (doctor.share_type || "percentage") as DoctorShareType,
      doctorShareValue:
        doctor.share_type === "flat"
          ? formatPaise(doctor.share_flat_paise ?? 0).replace(/,/g, "")
          : String(doctor.share_percentage ?? 0),
      // NULL (no custom design) prefills as "" - the Default entry.
      consultationTemplateId: doctor.consultation_template_id ?? "",
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
      description="Update name, department, phone, status, fee, revisit validity and print design."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <DoctorFields
          register={register}
          control={control}
          errors={errors}
          departments={departments}
          consultationDesigns={consultationDesigns}
          idPrefix="ed"
        />
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
