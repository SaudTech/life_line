import { useEffect, useState } from "react";

// The card/list layout toggle shared by the list-manager screens (users,
// patients, doctors). The choice is remembered in localStorage per screen and
// defaults to "list" (dev-rules §5: a fixed, predictable counter layout - list is
// the dense default a busy desk expects).
//
// SSR-safe: localStorage is client-only, so the first render always uses the
// default and the stored choice is applied in an effect after mount. That avoids a
// hydration mismatch (server and first client render agree on the default); the
// persisted view is picked up a tick later.
export type ViewLayout = "card" | "list";

export function usePersistentView(
  storageKey: string,
  fallback: ViewLayout = "list",
): [ViewLayout, (next: ViewLayout) => void] {
  const [layout, setLayoutState] = useState<ViewLayout>(fallback);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "card" || stored === "list") setLayoutState(stored);
    } catch {
      // localStorage can be unavailable (privacy mode, disabled) - just keep the
      // default; the toggle still works in-session.
    }
  }, [storageKey]);

  function setLayout(next: ViewLayout) {
    setLayoutState(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Persist is best-effort; a failure never breaks the toggle.
    }
  }

  return [layout, setLayout];
}
