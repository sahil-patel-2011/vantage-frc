"use client";

import { useEffect, useState } from "react";
import { DEFAULT_COCKPIT_PREFS, parseCockpitPrefs, type CockpitPrefs } from "./prefs";

export const COCKPIT_CHANGED_EVENT = "vantage:cockpit-changed";

/** Tell every open reader of the cockpit about a change the moment it is made (before the save lands). */
export function announceCockpitPrefs(prefs: CockpitPrefs) {
  window.dispatchEvent(new CustomEvent(COCKPIT_CHANGED_EVENT, { detail: prefs }));
}

/** Load the signed-in member's cockpit. Defaults until the request returns. */
export function useCockpitPrefs(): CockpitPrefs {
  const [prefs, setPrefs] = useState<CockpitPrefs>({ ...DEFAULT_COCKPIT_PREFS });

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/account/cockpit", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { cockpit?: unknown } | null) => {
        if (cancelled || !data) return;
        setPrefs(parseCockpitPrefs(data.cockpit));
      })
      .catch(() => {
        /* keep defaults — never invent a stored cockpit */
      });
    // A setting changed on this page (Code's Scan settings) applies at once: the checkbox
    // used to snap back and the old value kept being used until a reload.
    const follow = (event: Event) => {
      if (!cancelled) setPrefs(parseCockpitPrefs((event as CustomEvent<unknown>).detail));
    };
    window.addEventListener(COCKPIT_CHANGED_EVENT, follow);
    return () => {
      cancelled = true;
      window.removeEventListener(COCKPIT_CHANGED_EVENT, follow);
    };
  }, []);

  return prefs;
}
