"use client";

import { useEffect, useState } from "react";

/**
 * A value that only the browser can answer, read safely for rendering.
 *
 * The tempting shape is a ternary:
 *
 *     const orgId = typeof window === "undefined" ? null : readOrgIdFromUrl();
 *
 * It looks defensive and it is wrong. React renders a client component twice:
 * once on the server, where `window` is absent and the expression is `null`,
 * and once in the browser during hydration, where it is the real id. Those two
 * renders must produce identical HTML. When the value reaches an `href`, a
 * `value`, or any text, React finds the mismatch, logs a hydration error, and
 * throws away the server HTML for that subtree — so the page flashes, loses
 * focus and scroll position, and any state in the discarded tree is reset.
 *
 * The bug is invisible in normal use: the second render is correct, so the
 * page looks right a few milliseconds later and only the console complains.
 *
 * This returns `fallback` for both the server render *and* the first client
 * render, so the two match, then the real value once mounted. That is one
 * extra render, deliberately, in exchange for a correct hydration.
 *
 *     const orgId = useBrowserValue(readOrgIdFromUrl, null);
 *
 * Do not use it for values that are only ever read inside an event handler or
 * an effect — those never reach the server HTML, and reading `window` directly
 * there is already correct.
 *
 * `read` is called only in an effect, so it may touch `window` unguarded.
 */
export function useBrowserValue<T>(read: () => T, fallback: T): T {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    setValue(read());
    // Deliberately once, on mount. Callers pass an inline arrow, so depending
    // on `read` would re-run this every render. These values come from the URL
    // and the document, and a navigation remounts the page that owns them.
  }, []);
  return value;
}

/**
 * The current path and query, for a "come back here afterwards" link.
 *
 * This is the single most common use of the pattern above in this app — a
 * return path handed to a sign-in or setup detour — and it is always rendered
 * into an `href`, so it always has to survive hydration.
 */
export function useReturnPath(): string | null {
  return useBrowserValue(() => `${window.location.pathname}${window.location.search}`, null);
}
