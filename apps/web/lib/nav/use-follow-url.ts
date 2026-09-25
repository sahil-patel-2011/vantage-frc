"use client";

import { useEffect, useRef } from "react";
import { URL_CHANGE_EVENT } from "./url-change";

/**
 * Run `onChange` when the address changes without the page remounting: an in-app link to this
 * same page with another `?tab=` (the app frame fires URL_CHANGE_EVENT after following it), and
 * Back/Forward. Pages that read their tab from the address once, on load, otherwise showed the
 * old tab under the new address.
 */
export function useFollowUrl(onChange: () => void): void {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    const follow = () => latest.current();
    window.addEventListener(URL_CHANGE_EVENT, follow);
    window.addEventListener("popstate", follow);
    return () => {
      window.removeEventListener(URL_CHANGE_EVENT, follow);
      window.removeEventListener("popstate", follow);
    };
  }, []);
}
