import { useEffect, useState } from "react";

/**
 * Returns false during SSR and the first client render (so it matches the
 * server-rendered HTML), then true after mount. Used to gate effects that must
 * not run against the pre-hydration snapshot — e.g. redirecting away from a
 * "missing" chat session before localStorage has actually been read.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
