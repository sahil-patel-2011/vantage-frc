"use client";

import { useEffect } from "react";
import { PRODUCT_TITLE_SUFFIX } from "../nav/hub-title";

/**
 * Keep the browser tab title on what this view shows, for views that change without a navigation
 * (a hub's tabs rewrite the address in place, so Next's metadata never runs for them).
 *
 * `title` is the page part; the product name is appended the same way the root layout's template
 * does it. While mounted, a late metadata write (a client navigation can commit the head after the
 * page) is put back, so the tab never settles on the hub's generic name.
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    const full = `${title}${PRODUCT_TITLE_SUFFIX}`;
    document.title = full;
    const element = document.querySelector("head > title");
    if (!element || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      if (document.title !== full) document.title = full;
    });
    observer.observe(element, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [title]);
}
