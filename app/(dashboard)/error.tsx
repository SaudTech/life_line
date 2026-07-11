"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// Error boundary for the whole signed-in area. Without it, a throw in any server
// component under (dashboard) - e.g. Postgres briefly down while loading
// /consultations or /admin - renders a blank/generic screen with no way back
// (DEVELOPMENT_RULES §1/§3: the staff must never be left guessing). This catches
// that, logs it where an operator can see it, and offers an immediate retry.
//
// Note: this does NOT catch a rejected server ACTION awaited inside a client event
// handler (those are handled at the call site, e.g. the consultation confirm/
// authorize handlers) - only render/data-load throws in the route tree.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] render error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-xl font-bold text-foreground">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        This screen could not load. Nothing you were entering was saved. Try again -
        if it keeps happening, tell the administrator.
      </p>
      <Button type="button" autoFocus onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
