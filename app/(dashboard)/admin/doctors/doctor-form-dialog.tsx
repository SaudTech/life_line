"use client";

import { useEffect, useState } from "react";
import {
  useForm,
  useFieldArray,
  useWatch,
  Controller,
  type Control,
  type FieldErrors,
  type Path,
  type FieldValues,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

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
import {
  MAX_REVISIT_TIERS,
  bandRangeLabel,
  ladderThroughDay,
} from "@/lib/doctors/revisit-tiers";
import { createDoctorAction, updateDoctorAction } from "@/lib/doctors/actions";
import { createDepartmentAction, deleteDepartmentAction } from "@/lib/departments/actions";
import { formatPaise, isValidRupees, rupeesToPaise } from "@/lib/money";
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
      {/* The dialog itself never scrolls - the header and the footer stay put and
          only the fields between them move, so Save is always one click away. */}
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader className="shrink-0">
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

// The three form fields that make up a doctor's revisit ladder. Both doctor
// schemas carry them identically, so this component reads them under one
// concrete shape rather than threading the parent's generic through
// useFieldArray/useWatch (which need a literal field name, not a Path<T>).
interface LadderForm {
  fee: string;
  revisitValidityDays: number;
  revisitTiers: { throughDay: number; price: string }[];
}

// A number typed into an <input type="number"> comes back as a STRING (RHF only
// coerces with valueAsNumber, and the zod schema is what coerces on submit), so
// the live ladder has to read every day value defensively.
function toDay(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// Revisit pricing (migration 0027) - the free window and the priced bands that
// taper after it, edited as ONE control because they are one rule. Each row's
// left cell is the span that row covers, derived live from the row above it, so
// an admin sets end days and immediately reads back the bands the counter will
// charge; the footer states what happens past the last band (a new, full-fee
// consultation) instead of leaving it to be inferred.
//
// Nothing here computes a charge - it renders the same shape resolveRevisitCharge
// resolves, and every rule it hints at is enforced by validateRevisitLadder via
// the schema (§1: the UI never re-implements a rule).
function RevisitPricingField<T extends FieldValues>({
  control,
  register,
  errors,
  idPrefix,
}: {
  control: import("react-hook-form").Control<T>;
  register: import("react-hook-form").UseFormRegister<T>;
  errors: import("react-hook-form").FieldErrors<T>;
  idPrefix: string;
}) {
  const ladderControl = control as unknown as Control<LadderForm>;
  const { fields, append, remove } = useFieldArray({
    control: ladderControl,
    name: "revisitTiers",
  });
  const watched = useWatch({ control: ladderControl, name: "revisitTiers" });
  const rows = watched ?? [];
  const freeDays = toDay(useWatch({ control: ladderControl, name: "revisitValidityDays" }));
  const feeRaw = useWatch({ control: ladderControl, name: "fee" }) ?? "";

  const ladderErrors = (errors as unknown as FieldErrors<LadderForm>).revisitTiers;
  const freeDaysError = (errors as FieldValues).revisitValidityDays;

  // The day each band starts on: one past whatever ended before it. A row whose
  // own end day is still blank or malformed shows "-" rather than a wrong span.
  const days = rows.map((r) => toDay(r?.throughDay));
  function startOf(index: number): number | null {
    const previous = index === 0 ? freeDays : days[index - 1];
    return previous === null ? null : previous + 1;
  }
  function spanOf(index: number): string {
    const from = startOf(index);
    const through = days[index];
    return from === null || through === null ? "-" : bandRangeLabel(from, through);
  }

  const lastDay = ladderThroughDay({
    freeThroughDay: freeDays ?? 0,
    tiers: days.filter((d): d is number => d !== null).map((d) => ({ throughDay: d, pricePaise: 1 })),
  });
  const full = isValidRupees(feeRaw) ? formatPaise(rupeesToPaise(feeRaw)) : null;
  const atCap = fields.length >= MAX_REVISIT_TIERS;

  const dayInput =
    "h-8 w-16 px-2 text-center font-mono tabular-nums";

  return (
    <Field data-invalid={freeDaysError || ladderErrors ? true : undefined}>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={`${idPrefix}-days`}>Revisit pricing</FieldLabel>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={atCap}
          onClick={() => append({ throughDay: (lastDay ?? 0) + 1, price: "" })}
          className="-my-1 h-7 gap-1 px-2 text-xs"
        >
          <Plus className="size-3.5" aria-hidden />
          Add reduced rate
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="w-[86px] shrink-0">Days</span>
          <span className="w-16 shrink-0 text-center">Last day</span>
          <span className="min-w-0 flex-1">Charge</span>
          <span className="w-7 shrink-0" aria-hidden />
        </div>

        {/* The free window - the one band that already existed. */}
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="w-[86px] shrink-0 truncate text-xs font-semibold text-primary">
            {freeDays === null ? "-" : bandRangeLabel(0, freeDays)}
          </span>
          <Input
            id={`${idPrefix}-days`}
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            aria-label="Free through day"
            aria-invalid={freeDaysError ? true : undefined}
            className={dayInput}
            onFocus={selectOnFocus}
            {...register("revisitValidityDays" as Path<T>)}
          />
          <span className="min-w-0 flex-1 text-xs font-semibold text-primary">Free</span>
          <span className="w-7 shrink-0" aria-hidden />
        </div>

        {fields.map((row, i) => {
          const rowError = ladderErrors?.[i];
          return (
            <div key={row.id} className="border-t px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="w-[86px] shrink-0 truncate text-xs font-medium text-secondary-foreground">
                  {spanOf(i)}
                </span>
                <Input
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min="0"
                  aria-label={`Reduced rate ${i + 1} - last day`}
                  aria-invalid={rowError?.throughDay ? true : undefined}
                  className={dayInput}
                  onFocus={selectOnFocus}
                  {...register(`revisitTiers.${i}.throughDay` as Path<T>)}
                />
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <span className="text-xs text-muted-foreground">₹</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    placeholder="e.g. 400"
                    aria-label={`Reduced rate ${i + 1} - amount`}
                    aria-invalid={rowError?.price ? true : undefined}
                    className="h-8 min-w-0 flex-1 font-mono tabular-nums"
                    onFocus={selectOnFocus}
                    {...register(`revisitTiers.${i}.price` as Path<T>)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Remove reduced rate ${i + 1}`}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
              {rowError ? (
                <FieldError errors={[(rowError.throughDay ?? rowError.price) as never]} />
              ) : null}
            </div>
          );
        })}

        {/* What happens past the last band: not a revisit at all. */}
        <div className="flex items-center gap-2 border-t bg-muted/40 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {freeDays === null ? "After that" : `Day ${lastDay + 1} onwards`}
          </span>
          <span className="shrink-0 font-mono tabular-nums text-secondary-foreground">
            {full === null ? "Full fee" : `Full fee ₹${full}`}
          </span>
        </div>
      </div>

      <FieldError errors={[freeDaysError as never]} />
      <p className="text-xs text-muted-foreground">
        Days are counted from the first consultation (the consultation day itself is day 0). A
        return visit is charged the rate for the day it falls on; once the last one runs out, it
        is a new consultation at the full fee.
      </p>
    </Field>
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
            Leave on Default unless this doctor needs their own layout.
          </p>
        </Field>
      </div>

      <RevisitPricingField
        control={control}
        register={register}
        errors={errors}
        idPrefix={idPrefix}
      />
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
      // No priced bands: a new doctor behaves exactly as every doctor did before
      // migration 0027 - free inside the window, full fee after it.
      revisitTiers: [],
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
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
          <DoctorFields
            register={register}
            control={control}
            errors={errors}
            departments={departments}
            consultationDesigns={consultationDesigns}
            idPrefix="ad"
          />
          {errors.root ? <FieldError errors={[errors.root]} /> : null}
        </div>
        <DialogFooter className="mt-4 shrink-0 flex-row justify-start gap-2 border-t pt-4">
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
      // Prices prefill as plain rupee strings ("400.00"), same as the fee.
      revisitTiers: doctor.revisit_tiers.map((t) => ({
        throughDay: t.through_day,
        price: formatPaise(t.price_paise).replace(/,/g, ""),
      })),
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
      description="Update name, department, phone, status, fee, revisit pricing and print design."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
          <DoctorFields
            register={register}
            control={control}
            errors={errors}
            departments={departments}
            consultationDesigns={consultationDesigns}
            idPrefix="ed"
          />
          {errors.root ? <FieldError errors={[errors.root]} /> : null}
        </div>
        <DialogFooter className="mt-4 shrink-0 flex-row justify-start gap-2 border-t pt-4">
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
