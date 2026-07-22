"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MessageSquarePlus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldError, FieldGroup } from "@/components/ui/field";
import { newSuggestionSchema, type NewSuggestionValues } from "@/lib/suggestions/schema";
import { createSuggestionAction } from "@/lib/suggestions/actions";

// A tiny, always-visible entry point for "something about this app should be
// better" - a fixed corner button on every dashboard page, never a blocking
// popup on its own (§5: no confirmation popups on routine actions). Opens a
// one-field dialog on click; closing it (Cancel, X, Esc, backdrop) is always
// free - nothing is submitted until the staff member chooses to.
export function SuggestionWidget() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<NewSuggestionValues>({
    resolver: zodResolver(newSuggestionSchema),
    mode: "onTouched",
    defaultValues: { message: "", pagePath: "" },
  });

  function close() {
    setOpen(false);
    reset();
  }

  async function onSubmit(values: NewSuggestionValues) {
    const res = await createSuggestionAction({ ...values, pagePath: pathname });
    if (!res.ok) {
      toast.error(res.formError ?? res.fieldErrors?.message ?? "Could not send that. Try again.");
      return;
    }
    toast.success("Thanks - we'll take a look.");
    close();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Suggest an improvement"
        aria-label="Suggest an improvement"
        // Fixed elements repeat on EVERY printed page - keep the widget off the
        // End-Day sheet (and any other print), like the report toolbar.
        data-no-print
        className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full border bg-card px-3.5 py-2.5 text-[13px] font-semibold text-muted-foreground shadow-md transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MessageSquarePlus className="size-4" aria-hidden />
        <span className="hidden sm:inline">Suggest</span>
      </button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Suggest an improvement</DialogTitle>
            <DialogDescription>
              Tell us what&apos;s slowing you down or what you&apos;d like to see - the team reads every note.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <FieldGroup>
              <Field data-invalid={errors.message ? true : undefined}>
                <Textarea
                  autoFocus
                  rows={4}
                  placeholder="e.g. The discount PIN prompt is easy to miss on the bill screen…"
                  aria-invalid={errors.message ? true : undefined}
                  aria-label="Your suggestion"
                  {...register("message")}
                />
                <FieldError errors={[errors.message]} />
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-6 flex-row justify-start gap-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Sending…" : "Send suggestion"}
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
