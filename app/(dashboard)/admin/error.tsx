"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// Error boundary for /admin/*. The (dashboard) boundary already catches these, but it
// speaks to counter staff mid-bill ("nothing you were entering was saved") - wrong
// audience and wrong reassurance for an admin whose reports screen failed to load.
//
// The distinction that matters here: a failed admin screen is a READ failure. No
// money moved, no bill changed. Say that plainly, because the alternative is an admin
// wondering whether the hospital's data is damaged (§5, honest system state).
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] render error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-xl font-bold text-foreground">This admin screen could not load</h1>
      <p className="text-sm text-muted-foreground">
        Reading the data failed - most often the database is briefly unreachable. No bills,
        patients, or settings were changed, and the counters are unaffected. Try again.
      </p>
      {error.digest && (
        <p className="text-xs font-medium text-muted-foreground">
          Reference: <span className="font-mono tabular-nums">{error.digest}</span>
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="button" autoFocus onClick={reset}>
          Try again
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/admin">Back to Admin</Link>
        </Button>
      </div>
    </div>
  );
}
