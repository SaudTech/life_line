"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/dal";
import { logActivity } from "@/lib/audit";
import { zodFieldErrors } from "@/lib/forms/action-result";
import type { ActionResult } from "@/lib/forms/action-result";
import { getUserLocationId } from "@/lib/users/repository";
import { newSuggestionSchema } from "./schema";
import { createSuggestion } from "./repository";

// Any signed-in staff member can leave a suggestion - not admin-only, since the
// whole point is to hear from the people actually working the counter.
// requireSession() re-checks server-side even though every dashboard page is
// already gated (hiding UI is not security, §8).
export async function createSuggestionAction(
  input: unknown,
): Promise<ActionResult> {
  const s = await requireSession();

  const parsed = newSuggestionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const locationId = await getUserLocationId(s.sub);
  if (!locationId) {
    return {
      ok: false,
      formError: "Could not resolve your location. Please sign in again.",
    };
  }

  const { id } = await createSuggestion({
    message: v.message,
    page_path: v.pagePath ?? null,
    user_id: s.sub,
    location_id: locationId,
  });

  await logActivity({
    actorId: s.sub,
    action: "suggestion.create",
    entity: "suggestion",
    targetId: id,
    locationId,
  });

  revalidatePath("/admin/suggestions");
  return { ok: true };
}
