import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/dal";
import { listSuggestions } from "@/lib/suggestions/repository";
import { relativeTime } from "@/lib/admin/activity";

export const metadata: Metadata = {
  title: "Suggestions - Life Line Hospital",
};

// Admin-only read view of the always-visible suggestion widget (migration
// 0022). requireAdmin() is this page's own server check (hiding UI ≠
// security, §8) even though the (dashboard) layout already gates the group.
// Display only: notes are never edited, resolved, or deleted here - developers
// read them and act outside the app, keeping this table (and page) append-only.
export default async function SuggestionsPage() {
  await requireAdmin();
  const suggestions = await listSuggestions();
  const now = new Date();

  return (
    <div className="mx-auto max-w-[840px]">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Suggestions</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          Notes staff have sent in from the &quot;Suggest&quot; button, newest first.
        </p>
      </div>

      {suggestions.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center">
          <p className="text-sm font-medium text-muted-foreground">No suggestions yet.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {suggestions.map((s) => (
            <li key={s.id} className="rounded-xl border bg-card p-4.5">
              <p className="whitespace-pre-wrap text-sm text-foreground">{s.message}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-muted-foreground">
                <span>{relativeTime(new Date(s.created_at), now)}</span>
                {s.user_name ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{s.user_name}</span>
                  </>
                ) : null}
                {s.page_path ? (
                  <>
                    <span aria-hidden>·</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{s.page_path}</code>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
